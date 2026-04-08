/**
 * Data Cache — File-based cache that stores indicator data between runs.
 * Cache file lives at output/data-cache.json (committed to repo like cost-ledger.json).
 * Uses indicator-freshness to decide which indicators can be served from cache.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { INDICATOR_FRESHNESS, isStale } from './indicator-freshness.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const CACHE_PATH = join(ROOT, 'output', 'data-cache.json');

// ── Indian market holidays for 2026 (hardcoded) ────────────────────
// Major national & exchange holidays.
const INDIAN_HOLIDAYS_2026 = new Set([
  '2026-01-26', // Republic Day
  '2026-03-10', // Maha Shivaratri
  '2026-03-17', // Holi
  '2026-03-31', // Id-Ul-Fitr (Eid)
  '2026-04-03', // Good Friday
  '2026-04-14', // Dr Ambedkar Jayanti
  '2026-05-01', // Maharashtra Day
  '2026-06-07', // Eid-Ul-Adha (Bakri Id)
  '2026-07-07', // Muharram
  '2026-08-15', // Independence Day
  '2026-08-19', // Janmashtami
  '2026-09-05', // Milad-Un-Nabi
  '2026-10-02', // Gandhi Jayanti / Dussehra
  '2026-10-21', // Dussehra (Vijaya Dashami)
  '2026-11-09', // Diwali (Lakshmi Puja)
  '2026-11-10', // Diwali (Balipratipada)
  '2026-11-30', // Guru Nanak Jayanti
  '2026-12-25', // Christmas
]);

/**
 * Returns true if the given ISO date falls on a Saturday, Sunday,
 * or a major Indian market holiday (2026 dates hardcoded).
 * @param {string} isoDate — e.g. "2026-04-07"
 * @returns {boolean}
 */
export function isWeekendOrHoliday(isoDate) {
  // Parse as UTC midnight to avoid timezone-shift issues
  const d = new Date(isoDate + 'T00:00:00Z');
  const day = d.getUTCDay(); // 0 = Sun, 6 = Sat
  if (day === 0 || day === 6) return true;
  return INDIAN_HOLIDAYS_2026.has(isoDate);
}

/**
 * Returns true if today is a non-trading day AND the cache already has
 * fresh daily market data from the last trading day, meaning we can
 * skip the full data-intelligence run entirely.
 * @param {string} isoDate — current ISO date
 * @returns {boolean}
 */
export function shouldSkipDataIntelligence(isoDate) {
  if (!isWeekendOrHoliday(isoDate)) return false;

  const cache = readCache();
  // Check that at least some daily indicators have cached data
  const dailySlugs = Object.keys(INDICATOR_FRESHNESS).filter(
    s => INDICATOR_FRESHNESS[s] === 'daily'
  );
  const cachedDailySlugs = dailySlugs.filter(
    s => cache.indicators[s] !== undefined && cache.last_updated[s]
  );

  // Need at least 50% of daily indicators cached to consider it sufficient
  if (cachedDailySlugs.length < dailySlugs.length * 0.5) return false;

  // Verify the cached data comes from the most recent trading day
  // (i.e. it is not stale by freshness rules)
  const staleCount = cachedDailySlugs.filter(
    s => isStale(s, cache.last_updated[s], isoDate)
  ).length;

  return staleCount === 0;
}

// ── Core cache read/write ───────────────────────────────────────────

/**
 * Read the cache file. Returns a default structure if missing or corrupt.
 * @returns {{ indicators: Record<string,any>, last_updated: Record<string,string>, supabase_snapshot: Record<string,any> }}
 */
export function readCache() {
  if (!existsSync(CACHE_PATH)) {
    return { indicators: {}, last_updated: {}, supabase_snapshot: {} };
  }
  try {
    const raw = JSON.parse(readFileSync(CACHE_PATH, 'utf-8'));
    return {
      indicators:        raw.indicators        || {},
      last_updated:      raw.last_updated      || {},
      supabase_snapshot: raw.supabase_snapshot  || {},
    };
  } catch {
    return { indicators: {}, last_updated: {}, supabase_snapshot: {} };
  }
}

/**
 * Write the cache object to disk.
 * @param {{ indicators: Record<string,any>, last_updated: Record<string,string> }} cache
 */
export function writeCache(cache) {
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf-8');
}

// ── Higher-level helpers ────────────────────────────────────────────

/**
 * Returns an object of cached indicators that are still fresh (not stale).
 * @param {string} currentDate — ISO date
 * @returns {Record<string,any>}
 */
export function getCachedIndicators(currentDate) {
  const cache = readCache();
  const fresh = {};
  for (const slug of Object.keys(cache.indicators)) {
    if (!isStale(slug, cache.last_updated[slug], currentDate)) {
      fresh[slug] = cache.indicators[slug];
    }
  }
  return fresh;
}

/**
 * Merge freshly-fetched indicator data into the cache and persist.
 * @param {Record<string,any>} freshIndicators — slug → value
 * @param {string}             currentDate     — ISO date of this run
 */
export function updateCache(freshIndicators, currentDate) {
  const cache = readCache();
  for (const [slug, value] of Object.entries(freshIndicators)) {
    cache.indicators[slug]   = value;
    cache.last_updated[slug] = currentDate;
  }
  writeCache(cache);
}

/**
 * Returns an array of slugs that are stale and need re-fetching.
 * @param {string} currentDate — ISO date
 * @returns {string[]}
 */
export function getStaleSlugs(currentDate) {
  const cache = readCache();
  return Object.keys(INDICATOR_FRESHNESS).filter(slug =>
    isStale(slug, cache.last_updated[slug], currentDate)
  );
}

// ── Supabase dedup helpers ─────────────────────────────────────────

/**
 * Hash a row object into a short string for comparison.
 * Strips run_id (changes every run) and compares data fields only.
 */
function hashRow(row) {
  const { run_id, ...data } = row;
  return JSON.stringify(data);
}

/**
 * Filter rows to only those that changed since last push.
 * Returns { changed: [...rows that differ], skipped: count }.
 * @param {string} table — table name used as snapshot key
 * @param {Array} rows — rows to potentially push
 * @param {string} keyFn — function(row) => unique key for dedup
 */
export function filterChangedRows(table, rows, keyFn) {
  const cache = readCache();
  const snapshot = cache.supabase_snapshot[table] || {};
  const changed = [];
  let skipped = 0;

  for (const row of rows) {
    const key = keyFn(row);
    const hash = hashRow(row);
    if (snapshot[key] === hash) {
      skipped++;
    } else {
      changed.push(row);
    }
  }

  return { changed, skipped };
}

/**
 * Record what was pushed to Supabase for future dedup.
 * @param {string} table — table name
 * @param {Array} rows — rows that were pushed
 * @param {string} keyFn — function(row) => unique key
 */
export function recordSnapshot(table, rows, keyFn) {
  const cache = readCache();
  if (!cache.supabase_snapshot[table]) {
    cache.supabase_snapshot[table] = {};
  }
  for (const row of rows) {
    const key = keyFn(row);
    cache.supabase_snapshot[table][key] = hashRow(row);
  }
  writeCache(cache);
}
