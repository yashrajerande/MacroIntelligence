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

export class RealEstateSegmentAnalyst {
  async fetch(isoDate, { force = process.env.FORCE_RE_SEGMENTS === 'true', historyPath = SEGMENTS_HISTORY_PATH } = {}) {
    const start = Date.now();
    const store = loadSegmentHistory(historyPath);
    const cachedMeta = { agent: 'RealEstateSegmentAnalyst', model: 'none', latency_ms: 0, tokens: { input: 0, output: 0 } };

    if (!force && !needsSegmentRefresh(store, isoDate)) {
      const latest = store.history.at(-1);
      console.log(`[RealEstateSegmentAnalyst] Serving snapshot from ${latest.fetched_at.slice(0, 10)} (refresh every ${REFRESH_DAYS} days)`);
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

    const latest = store.history.at(-1) || entry;
    const latency = Date.now() - start;
    console.log(`[RealEstateSegmentAnalyst] Done in ${latency}ms. ${result.errors.length ? result.errors.length + ' block(s) failed. ' : ''}${store.history.length} snapshot(s) in history.`);

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
