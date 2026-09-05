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

// ── Domain slug sets — single source of truth ────────────────────────
// (Previously duplicated 3x across orchestrate.js; consolidated here so
// adding a new domain means editing one place, not three.)
export const MARKET_SLUGS = new Set([
  'nifty50','sensex','bank_nifty','india_vix','inr_usd','gold_usd','gold_inr_gram',
  'brent_usd','sp500','nasdaq','us_vix','dxy','nat_gas','copper','iron_ore',
  'nikkei225','hang_seng','euro_stoxx50','brent_usd_global','wti_usd','bdi',
  'us_10y_treasury','gsec_10y','rbi_fx_reserves','embassy_reit','mindspace_reit','brookfield_reit',
]);

export const RE_SLUGS = new Set([
  're_launches_units','re_sales_units','re_unsold_inventory',
  'hpi_mumbai','hpi_delhi','hpi_bengaluru','hpi_hyderabad',
  'affordability_index','home_loan_disbursements','avg_home_loan_rate',
  'office_absorption','office_vacancy','rent_bengaluru','rent_mumbai',
  'retail_mall_vacancy',
]);

export const LEVERAGE_SLUGS = new Set([
  'india_hh_debt_gdp','india_corp_debt_gdp','us_hh_debt_gdp','us_corp_debt_gdp',
  'china_hh_debt_gdp','china_corp_debt_gdp','japan_hh_debt_gdp','japan_corp_debt_gdp',
  'ez_hh_debt_gdp','ez_corp_debt_gdp','uk_hh_debt_gdp','uk_corp_debt_gdp',
  'india_credit_industry_yoy','india_credit_services_yoy','india_credit_personal_yoy',
  'india_credit_agri_yoy','india_credit_housing_yoy','india_credit_vehicle_yoy',
  'india_credit_creditcard_yoy','india_credit_nbfc_yoy',
]);

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
  if (d.getUTCFullYear() > 2026) {
    console.warn('[DataCache] Holiday table only covers 2026 — every non-weekend day is treated as a trading day. Update INDIAN_HOLIDAYS.');
  }
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

  // The cached data must come from a recent trading day. The old check
  // used isStale(), whose daily threshold is >= 1 day — data stamped
  // YESTERDAY was already "stale", so on a Saturday this always failed
  // and the weekend/holiday cost-saving path was dead code. A <= 3-day
  // window covers Sat/Sun and a Monday holiday following a Friday run.
  const recentCount = cachedDailySlugs.filter(s => {
    const days = (new Date(isoDate + 'T00:00:00Z') - new Date(cache.last_updated[s] + 'T00:00:00Z')) / 86400000;
    return days >= 0 && days <= NON_TRADING_MAX_AGE_DAYS;
  }).length;

  return recentCount === cachedDailySlugs.length;
}

// ── Core cache read/write ───────────────────────────────────────────

/**
 * Read the cache file. Returns a default structure if missing or corrupt.
 * @returns {{ indicators: Record<string,any>, last_updated: Record<string,string>, supabase_snapshot: Record<string,any> }}
 */
export function readCache() {
  if (!existsSync(CACHE_PATH)) {
    return { indicators: {}, last_updated: {}, last_changed: {}, supabase_snapshot: {} };
  }
  try {
    const raw = JSON.parse(readFileSync(CACHE_PATH, 'utf-8'));
    return {
      indicators:        raw.indicators        || {},
      last_updated:      raw.last_updated      || {},
      last_changed:      raw.last_changed      || {},
      supabase_snapshot: raw.supabase_snapshot  || {},
    };
  } catch {
    return { indicators: {}, last_updated: {}, last_changed: {}, supabase_snapshot: {} };
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

// Weekend/holiday window: how old a "daily" cache entry may be and still
// be served on a non-trading day (Fri data on Sat/Sun/Mon-holiday).
// MUST stay in sync with shouldSkipDataIntelligence — the skip decision
// and the cache read used to disagree (skip said yes, the reader then
// dropped every daily slug as stale) and the run failed on 24 missing
// market indicators the very first time the skip path fired.
export const NON_TRADING_MAX_AGE_DAYS = 3;

/**
 * Returns an object of cached indicators that are still fresh (not stale).
 * @param {string} currentDate — ISO date
 * @param {{ maxAgeDays?: number }} [opts] — when set, an entry is ALSO served
 *        if its last_updated is within maxAgeDays, in addition to the normal
 *        per-frequency rule (weekend/holiday path: Friday's daily prices
 *        survive the window; monthly/quarterly entries survive their rule).
 * @returns {Record<string,any>}
 */
export function getCachedIndicators(currentDate, opts = {}) {
  const cache = readCache();
  const fresh = {};
  for (const slug of Object.keys(cache.indicators)) {
    const stamp = cache.last_updated[slug];
    let keep = !isStale(slug, stamp, currentDate);
    if (!keep && typeof opts.maxAgeDays === 'number' && stamp) {
      const days = (new Date(currentDate + 'T00:00:00Z') - new Date(stamp + 'T00:00:00Z')) / 86400000;
      keep = days >= 0 && days <= opts.maxAgeDays;
    }
    if (keep) fresh[slug] = cache.indicators[slug];
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
  let kept = 0;
  for (const [slug, value] of Object.entries(freshIndicators)) {
    // A failed fetch (fetch_error sentinel or null value) must NEVER be
    // written to the cache, whether or not a prior good value exists.
    // Writing a null used to stamp it "fresh", which froze brand-new slugs
    // at Awaited for a whole freshness cycle (95 days for quarterly) —
    // 9 of the 20 leverage slugs were stuck that way in production.
    const failed = !value || value.fetch_error || value.value === null || value.value === undefined
      || (typeof value.value === 'number' && !Number.isFinite(value.value));
    if (failed) {
      if (cache.indicators[slug]) kept++;
      continue; // stays stale/uncached → refetch keeps triggering
    }

    // Track when a genuinely NEW print landed — used by the hook-writer to
    // re-admit quarterly indicators in their release window. Requires the
    // vintage to move too (when both sides have one): LLM-sourced values
    // wobble a decimal day-to-day without any new release, and a bare
    // numeric-diff check counted every wobble as a fresh print.
    const old = cache.indicators[slug];
    if (typeof value.value === 'number' && value.value !== old?.value) {
      const vintageMoved = value.vintage && old?.vintage
        ? value.vintage !== old.vintage
        : true;
      if (vintageMoved) cache.last_changed[slug] = currentDate;
    }

    cache.indicators[slug]   = value;
    cache.last_updated[slug] = currentDate;
  }
  if (kept > 0) {
    console.log(`[DataCache] Kept previous values for ${kept} indicator(s) with failed fetches`);
  }
  writeCache(cache);
}

/**
 * Returns the date each slug's numeric value last changed (or {} if unknown).
 */
export function getLastChanged() {
  return readCache().last_changed;
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

/**
 * Check if the expensive web_search agents (MacroData + RealEstate) need to run.
 * Returns true ONLY if there are stale non-market indicators that need refreshing.
 * Market indicators (daily prices) are fetched for free via Yahoo/FRED.
 *
 * @param {string} currentDate — ISO date
 * @returns {{ needsMacroRefresh: boolean, needsRERefresh: boolean, staleSlugs: string[], cachedCount: number }}
 */
export function checkWebSearchNeeded(currentDate) {
  const cache = readCache();

  const allStale = getStaleSlugs(currentDate);
  const staleMacro = allStale.filter(s => !MARKET_SLUGS.has(s) && !RE_SLUGS.has(s) && !LEVERAGE_SLUGS.has(s));
  const staleRE = allStale.filter(s => RE_SLUGS.has(s));
  const staleLeverage = allStale.filter(s => LEVERAGE_SLUGS.has(s));

  // Only entries with a real numeric value count as "cached" — a null
  // sentinel must keep its domain's refresh firing, not satisfy it.
  const usable = (s) => cache.indicators[s] && typeof cache.indicators[s].value === 'number';
  const usableSlugs = Object.keys(cache.indicators).filter(usable);

  // Scope each floor to its own domain. cachedNonMarket previously counted
  // RE + leverage entries, so 5 real macro indicators were enough to clear
  // a floor of 40; and the RE floor was a hardcoded 10 against 15 slugs.
  const cachedMacro = usableSlugs.filter(s => !MARKET_SLUGS.has(s) && !RE_SLUGS.has(s) && !LEVERAGE_SLUGS.has(s)).length;
  const cachedRE = usableSlugs.filter(s => RE_SLUGS.has(s)).length;
  const cachedLeverage = usableSlugs.filter(s => LEVERAGE_SLUGS.has(s)).length;

  return {
    needsMacroRefresh: staleMacro.length > 0 || cachedMacro < 40,
    needsRERefresh: staleRE.length > 0 || cachedRE < RE_SLUGS.size,
    needsLeverageRefresh: staleLeverage.length > 0 || cachedLeverage < LEVERAGE_SLUGS.size,
    staleSlugs: [...staleMacro, ...staleRE, ...staleLeverage],
    cachedCount: Object.keys(cache.indicators).length,
  };
}

// ── Supabase dedup helpers ─────────────────────────────────────────

// Bump when the key/hash scheme changes — stale snapshots under the old
// scheme are dropped wholesale on first read (the affected rows re-push
// once, harmlessly, via upsert). v2: run_date removed from keys AND
// hashes. Under v1, run_date was in both, so every day produced brand-new
// keys, the dedup NEVER fired ("0 skipped" on every run since launch),
// and the snapshot grew ~115 permanent entries per day — 8.6 MB of the
// committed data-cache.json was dead snapshot weight.
const SNAPSHOT_VERSION = 2;

/**
 * Hash a row object into a short string for comparison.
 * Strips run_id AND run_date (both change every run/day) so the hash
 * reflects only the data content — "changed since last push" must mean
 * the numbers moved, not that the calendar did.
 */
function hashRow(row) {
  const { run_id, run_date, ...data } = row;
  return JSON.stringify(data);
}

function getSnapshot(cache) {
  if (cache.supabase_snapshot._v !== SNAPSHOT_VERSION) {
    cache.supabase_snapshot = { _v: SNAPSHOT_VERSION };
  }
  return cache.supabase_snapshot;
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
  const snapshot = getSnapshot(cache)[table] || {};
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
  const snapshot = getSnapshot(cache);
  if (!snapshot[table]) {
    snapshot[table] = {};
  }
  for (const row of rows) {
    const key = keyFn(row);
    snapshot[table][key] = hashRow(row);
  }
  writeCache(cache);
}
