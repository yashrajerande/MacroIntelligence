/**
 * RealEstateSegmentAnalyst — fetches the SEGMENTED real-estate picture
 * (ticket-size bands, city split, domestic vs NRI buyers, commercial
 * leasing by city and occupier) and keeps a dated history so the
 * Analyzer can say whether NRI buying is rising or falling, not just
 * what it is today.
 *
 * Separation of concerns (Charter): this agent only fetches and stores.
 * Every judgement — supply/demand balance, city ranking, NRI direction,
 * the narrative — lives in agents/Analysis/RealEstateSegmentAnalyzer.
 *
 * Refresh policy: the underlying reports are quarterly and the NRI
 * commentary is monthly, so a fetch every 7 days is plenty. Between
 * fetches the last stored snapshot is served (cost ≈ $0.03 per fetch
 * instead of per day). FORCE_RE_SEGMENTS=true forces a fetch.
 *
 * History file: output/re-segments-history.json (committed by
 * GitPublisher like risk-history.json), one entry per fetch:
 *   { fetched_at, run_date, residential, buyers, commercial, errors }
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { fetchSegmentData } from './skills/segment-search.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');
export const SEGMENTS_HISTORY_PATH = join(ROOT, 'output', 're-segments-history.json');
export const REFRESH_DAYS = 7;
const MAX_HISTORY = 60; // ~ a year of weekly fetches

export function loadSegmentHistory(path = SEGMENTS_HISTORY_PATH) {
  try {
    if (!existsSync(path)) return { history: [] };
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return Array.isArray(parsed?.history) ? parsed : { history: [] };
  } catch {
    return { history: [] };
  }
}

export function saveSegmentHistory(store, path = SEGMENTS_HISTORY_PATH) {
  mkdirSync(dirname(path), { recursive: true });
  const trimmed = { history: (store.history || []).slice(-MAX_HISTORY) };
  writeFileSync(path, JSON.stringify(trimmed, null, 2), 'utf8');
}

/** Pure: true when the newest entry is older than REFRESH_DAYS or absent. */
export function needsSegmentRefresh(store, isoDate, refreshDays = REFRESH_DAYS) {
  const latest = (store?.history || []).at(-1);
  if (!latest?.fetched_at) return true;
  const ageDays = (new Date(isoDate) - new Date(latest.fetched_at.slice(0, 10))) / 86400000;
  return ageDays >= refreshDays;
}

/**
 * True when a fetched entry carries at least one usable block. A fetch
 * where all three searches failed must not overwrite a good snapshot.
 */
export function isUsableEntry(entry) {
  if (!entry) return false;
  const r = entry.residential, b = entry.buyers, c = entry.commercial;
  return !!(
    (Array.isArray(r?.bands) && r.bands.length) ||
    (Array.isArray(r?.cities) && r.cities.length) ||
    (b && (typeof b.nri_share_pct === 'number' || b.nri_trend_note)) ||
    (Array.isArray(c?.cities) && c.cities.length)
  );
}

/**
 * Consolidate the served snapshot across recent fetches: start from the
 * newest entry and fill every null field from the next-older entry
 * within `maxAgeDays`, so one thin fetch (the residential search came
 * back empty on the second live run) can never erase a good one. The
 * reports behind these numbers are quarterly, so a 35-day window stays
 * inside one vintage. Pure; exported for the pre-flight suite.
 *
 * Returns the consolidated entry plus `carried_fields` (how many values
 * were carried from older fetches) so the ops log shows it.
 */
export function consolidateSnapshot(history, isoDate, { maxAgeDays = 35 } = {}) {
  const entries = (history || []).filter(e => e?.fetched_at);
  if (!entries.length) return null;
  const newest = entries[entries.length - 1];
  const cutoff = new Date(isoDate || newest.fetched_at) - maxAgeDays * 86400000;
  const older = entries.slice(0, -1).filter(e => new Date(e.fetched_at) >= cutoff).reverse(); // newest-first
  let carried = 0;

  const isNull = v => v === null || v === undefined || v === '';
  const fillScalars = (target, src) => {
    if (!src) return;
    for (const [k, v] of Object.entries(src)) {
      if (Array.isArray(v) || (v && typeof v === 'object')) continue;
      if (isNull(target[k]) && !isNull(v)) { target[k] = v; carried++; }
    }
  };
  const fillKeyedArray = (target, src, keyField, normalize = x => String(x || '').toLowerCase()) => {
    if (!Array.isArray(src)) return target;
    const out = Array.isArray(target) ? target.map(x => ({ ...x })) : [];
    for (const s of src) {
      const key = normalize(s?.[keyField]);
      let t = out.find(x => normalize(x?.[keyField]) === key);
      if (!t) { t = { [keyField]: s[keyField] }; out.push(t); carried++; }
      fillScalars(t, s);
    }
    return out;
  };

  const out = {
    ...newest,
    residential: newest.residential ? { ...newest.residential, bands: (newest.residential.bands || []).map(b => ({ ...b })), cities: (newest.residential.cities || []).map(c => ({ ...c })) } : null,
    buyers: newest.buyers ? { ...newest.buyers } : null,
    commercial: newest.commercial ? { ...newest.commercial, cities: (newest.commercial.cities || []).map(c => ({ ...c })), occupiers: { ...(newest.commercial.occupiers || {}) } } : null,
    consolidated_from: [],
  };

  for (const e of older) {
    const before = carried;
    if (e.residential) {
      if (!out.residential) out.residential = { bands: [], cities: [] };
      fillScalars(out.residential, e.residential);
      out.residential.bands = fillKeyedArray(out.residential.bands, e.residential.bands, 'band');
      out.residential.cities = fillKeyedArray(out.residential.cities, e.residential.cities, 'city');
    }
    if (e.buyers) {
      if (!out.buyers) out.buyers = {};
      fillScalars(out.buyers, e.buyers);
      for (const k of ['nri_top_cities', 'nri_source_regions', 'developer_nri_shares']) {
        if ((!Array.isArray(out.buyers[k]) || !out.buyers[k].length) && Array.isArray(e.buyers[k]) && e.buyers[k].length) { out.buyers[k] = e.buyers[k]; carried++; }
      }
    }
    if (e.commercial) {
      if (!out.commercial) out.commercial = { cities: [], occupiers: {} };
      fillScalars(out.commercial, e.commercial);
      out.commercial.cities = fillKeyedArray(out.commercial.cities, e.commercial.cities, 'city');
      out.commercial.occupiers = out.commercial.occupiers || {};
      fillScalars(out.commercial.occupiers, e.commercial.occupiers);
    }
    if (carried > before) out.consolidated_from.push(e.fetched_at.slice(0, 10));
  }
  out.carried_fields = carried;
  return out;
}

export class RealEstateSegmentAnalyst {
  async fetch(isoDate, { force = process.env.FORCE_RE_SEGMENTS === 'true', historyPath = SEGMENTS_HISTORY_PATH } = {}) {
    const start = Date.now();
    const store = loadSegmentHistory(historyPath);
    const cachedMeta = { agent: 'RealEstateSegmentAnalyst', model: 'none', latency_ms: 0, tokens: { input: 0, output: 0 } };

    if (!force && !needsSegmentRefresh(store, isoDate)) {
      const latest = consolidateSnapshot(store.history, isoDate);
      console.log(`[RealEstateSegmentAnalyst] Serving snapshot from ${latest.fetched_at.slice(0, 10)} (refresh every ${REFRESH_DAYS} days${latest.carried_fields ? `; ${latest.carried_fields} field(s) carried from ${latest.consolidated_from.join(', ')}` : ''})`);
      return { data: { latest, history: store.history, served_from_cache: true }, meta: cachedMeta };
    }

    console.log('[RealEstateSegmentAnalyst] Fetching segmented residential / NRI / commercial data...');
    const result = await fetchSegmentData();
    const entry = {
      fetched_at: new Date().toISOString(),
      run_date: isoDate,
      residential: result.data.residential || null,
      buyers: result.data.buyers || null,
      commercial: result.data.commercial || null,
      errors: result.errors,
    };

    if (isUsableEntry(entry)) {
      store.history.push(entry);
      saveSegmentHistory(store, historyPath);
    } else {
      console.warn('[RealEstateSegmentAnalyst] All segment searches failed — keeping the previous snapshot');
    }

    const latest = consolidateSnapshot(store.history, isoDate) || entry;
    const latency = Date.now() - start;
    console.log(`[RealEstateSegmentAnalyst] Done in ${latency}ms. ${result.errors.length ? result.errors.length + ' block(s) failed. ' : ''}${store.history.length} snapshot(s) in history${latest.carried_fields ? `; ${latest.carried_fields} field(s) carried from ${latest.consolidated_from.join(', ')}` : ''}.`);

    return {
      data: { latest, history: store.history, served_from_cache: !isUsableEntry(entry) },
      meta: {
        agent: 'RealEstateSegmentAnalyst',
        model: 'claude-haiku-4-5-20251001',
        latency_ms: latency,
        tokens: result.tokens,
        errors: result.errors,
      },
    };
  }
}

if (process.argv[1] && process.argv[1].includes('RealEstateSegmentAnalyst')) {
  const { isoDate } = (await import('../../../src/utils/ist-date.js')).getISTDate();
  new RealEstateSegmentAnalyst().fetch(isoDate, { force: true }).then(r => {
    console.log(JSON.stringify(r.data.latest, null, 2));
    console.log(JSON.stringify(r.meta, null, 2));
  }).catch(err => { console.error(err); process.exit(1); });
}
