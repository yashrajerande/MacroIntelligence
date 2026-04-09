/**
 * Validation Rules Skill — 6-Layer Reliability Architecture.
 * 22 deterministic checks + 6 reliability layers.
 * Returns { valid, errors, warnings }.
 */

import { HISTORICAL_RANGES, VALID_SLUGS } from '../../../../src/utils/indicator-schema.js';

const VALID_DIRECTIONS = new Set(['up', 'down', 'flat']);
const VALID_TIERS = new Set(['hi', 'mid', 'lo']);
const VALID_DIMENSIONS = new Set(['growth', 'inflation', 'credit', 'policy', 'capex', 'consumption']);
const VALID_BADGE_TYPES = new Set(['b-exp', 'b-slow', 'b-risk', 'b-neu']);
const VALID_SIGNAL_STATUSES = new Set(['positive', 'risk', 'watch', 'surprise']);
const VALID_NEWS_CATEGORIES = new Set(['geo', 'ai', 'india', 'fintech', 'ifs']);
const VALID_CONFIDENCES = new Set(['high', 'medium', 'low']);

// Known unavailable indicators (not on Yahoo/FRED — would need RBI direct feed)
const KNOWN_UNAVAILABLE = new Set(['gsec_10y', 'rbi_fx_reserves']);
const EFFECTIVE_SLUG_COUNT = VALID_SLUGS.length - KNOWN_UNAVAILABLE.size; // 95

// ── ROUND NUMBER DETECTION (Layer 5) ─────────────────────────────────────
// Slugs exempt from round-number warnings (rates, indices, counts where integer/round values are normal)
const ROUND_EXEMPT = new Set([
  'rbi_repo_rate', 'fed_funds_rate', 'ecb_deposit_rate', 'boj_rate',
  'capacity_utilisation', 'india_vix', 'us_vix', 'us_10y_treasury',
  'gst_month', 'gst_ytd', 'corp_bond_issuance', 'home_loan_disbursements',
  're_launches_units', 're_sales_units', 're_unsold_inventory',
  'fii_equity_net', 'dii_equity_net', 'sip_inflows', 'equity_mf_net',
  'nfo_collections', 'nifty50', 'sensex', 'bank_nifty',
  'fed_balance_sheet', 'rbi_fx_reserves', 'office_absorption',
]);

function isSuspiciouslyRound(value, slug) {
  if (ROUND_EXEMPT.has(slug)) return false;
  if (value === null || value === undefined) return false;
  if (value === 0) return false;
  // Flag values that are exactly integers ending in 0 (e.g. 100, 7.0, 50000)
  return Number.isInteger(value) && value % 10 === 0;
}

// ── DATE HELPERS ─────────────────────────────────────────────────────────
const MONTH_NAMES = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];

function isVintageInFuture(vintage, runDate) {
  if (!vintage || vintage === 'Awaited') return false;
  const lower = vintage.toLowerCase().trim();

  // Try ISO date: "2026-04-07"
  if (/^\d{4}-\d{2}-\d{2}$/.test(lower)) {
    return new Date(lower) > new Date(runDate);
  }

  // Try "DD Mon YYYY" or "Mon YYYY"
  for (let i = 0; i < MONTH_NAMES.length; i++) {
    if (lower.includes(MONTH_NAMES[i])) {
      const yearMatch = lower.match(/\d{4}/);
      if (yearMatch) {
        const year = parseInt(yearMatch[0]);
        const month = i;
        const vintageMonth = new Date(year, month, 1); // start of month
        const runMonth = new Date(new Date(runDate).getFullYear(), new Date(runDate).getMonth(), 1);
        return vintageMonth > runMonth; // allow current month
      }
    }
  }

  // Try "Q3 FY26" → FY26 = 2025-26, Q3 = Oct-Dec 2025
  const fyMatch = lower.match(/q(\d)\s*fy(\d{2})/);
  if (fyMatch) {
    const q = parseInt(fyMatch[1]);
    const fy = parseInt(fyMatch[2]) + 2000;
    // FY26 Q1=Apr-Jun 2025, Q2=Jul-Sep 2025, Q3=Oct-Dec 2025, Q4=Jan-Mar 2026
    const yearMap = { 1: fy - 1, 2: fy - 1, 3: fy - 1, 4: fy };
    const monthEnd = { 1: 5, 2: 8, 3: 11, 4: 2 }; // end months (0-indexed)
    const endDate = new Date(yearMap[q], monthEnd[q] + 1, 0);
    return endDate > new Date(runDate);
  }

  return false;
}

// ═════════════════════════════════════════════════════════════════════════
// MAIN VALIDATION — 22 structural checks + 6 reliability layers
// ═════════════════════════════════════════════════════════════════════════

export function runAllChecks(html, macroData, expectedDate) {
  const errors = [];
  const warnings = [];

  // macroData is now nested: { run: {...}, regime: [...], indicators: [...], ... }
  const run = macroData?.run || {};

  // ── STRUCTURAL CHECKS (Rules 1–22) ─────────────────────────────────

  // 1. HTML completeness
  if (!html.includes('<!DOCTYPE html>') && !html.includes('<!doctype html>')) {
    errors.push('Rule 1: Missing <!DOCTYPE html>');
  }
  if (!html.includes('</html>')) {
    errors.push('Rule 1: Missing </html>');
  }

  // 2. No FILL markers
  const fillCount = (html.match(/<!--\s*FILL[^>]*-->/g) || []).length;
  if (fillCount > 0) {
    errors.push(`Rule 2: ${fillCount} <!-- FILL --> placeholders remain`);
  }

  // 3. __MACRO_DATA__ parseable
  if (!macroData || typeof macroData !== 'object') {
    errors.push('Rule 3: __MACRO_DATA__ is not a valid object');
    return { valid: false, errors, warnings };
  }

  // 4. run_date matches (now under macroData.run.run_date)
  if (run.run_date !== expectedDate) {
    errors.push(`Rule 4: run.run_date "${run.run_date}" does not match expected "${expectedDate}"`);
  }

  // 5-6. Indicators count and slugs
  const indicators = macroData.indicators || [];
  const indicatorSlugs = indicators.map(i => i.indicator_slug);
  if (indicators.length < 88) {
    errors.push(`Rule 5: indicators[] has ${indicators.length} entries (minimum 88)`);
  } else if (indicators.length < EFFECTIVE_SLUG_COUNT) {
    // Only warn if missing more than the known unavailable ones
    const unexpectedMissing = VALID_SLUGS.filter(s => !indicatorSlugs.includes(s) && !KNOWN_UNAVAILABLE.has(s));
    if (unexpectedMissing.length > 0) {
      warnings.push(`W2: Missing ${unexpectedMissing.length} indicators: ${unexpectedMissing.join(', ')}`);
    }
  }

  const missingSlugs = VALID_SLUGS.filter(s => !indicatorSlugs.includes(s) && !KNOWN_UNAVAILABLE.has(s));
  if (missingSlugs.length > 5) {
    errors.push(`Rule 6: ${missingSlugs.length} unexpected slugs missing from indicators[]`);
  } else if (missingSlugs.length > 0) {
    warnings.push(`W2: Missing slugs: ${missingSlugs.join(', ')}`);
  }

  // 7-9. Indicator field validation
  for (const ind of indicators) {
    const slug = ind.indicator_slug || 'unknown';
    if (!VALID_DIRECTIONS.has(ind.direction)) {
      errors.push(`Rule 7: indicator "${slug}" has invalid direction "${ind.direction}"`);
    }
    if (!VALID_TIERS.has(ind.pct_10y_tier)) {
      errors.push(`Rule 8: indicator "${slug}" has invalid pct_10y_tier "${ind.pct_10y_tier}"`);
    }
    if (typeof ind.pct_10y !== 'number' || ind.pct_10y < 0 || ind.pct_10y > 100) {
      errors.push(`Rule 9: indicator "${slug}" has invalid pct_10y "${ind.pct_10y}"`);
    }
  }

  // 10-12. Regime
  const regime = macroData.regime || [];
  if (regime.length !== 6) {
    errors.push(`Rule 10: regime[] has ${regime.length} entries (expected 6)`);
  }
  for (const r of regime) {
    if (!VALID_DIMENSIONS.has(r.dimension)) {
      errors.push(`Rule 11: regime dimension "${r.dimension}" is invalid`);
    }
    if (!VALID_BADGE_TYPES.has(r.badge_type)) {
      errors.push(`Rule 12: regime badge_type "${r.badge_type}" is invalid`);
    }
  }

  // 13-15. Signals
  const signals = macroData.signals || [];
  if (signals.length !== 7) {
    errors.push(`Rule 13: signals[] has ${signals.length} entries (expected 7)`);
  }
  if (signals.length >= 7 && !signals[6].is_surprise) {
    errors.push('Rule 14: signals[6].is_surprise must be true (Sig7 = Surprise)');
  }
  for (const s of signals) {
    if (!VALID_SIGNAL_STATUSES.has(s.status)) {
      errors.push(`Rule 15: signal ${s.signal_num} has invalid status "${s.status}"`);
    }
  }

  // 16-17. News
  const news = macroData.news || [];
  if (news.length !== 5) {
    errors.push(`Rule 16: news[] has ${news.length} entries (expected 5)`);
  }
  for (const n of news) {
    if (!VALID_NEWS_CATEGORIES.has(n.category)) {
      errors.push(`Rule 17: news category "${n.category}" is invalid`);
    }
  }

  // 18. Exec summary
  const execSummary = macroData.executive_summary || [];
  if (execSummary.length !== 5) {
    errors.push(`Rule 18: executive_summary[] has ${execSummary.length} entries (expected 5)`);
  }

  // 19. Scenario probs (now under run.*)
  if (run.scenario_base_prob !== 0 || run.scenario_bull_prob !== 0 || run.scenario_bear_prob !== 0) {
    errors.push('Rule 19: scenario_*_prob must all be 0');
  }

  // 20. HTML size
  const htmlBytes = Buffer.byteLength(html, 'utf8');
  if (htmlBytes < 100000) {
    errors.push(`Rule 20: HTML file is ${htmlBytes} bytes (minimum 100,000 — likely truncated)`);
  }

  // 21. snap-verdict
  const verdictMatch = html.match(/id="snap-verdict"[^>]*>([^<]*)</);
  if (verdictMatch) {
    const verdict = verdictMatch[1].trim();
    if (!verdict || verdict.includes('FILL') || verdict === '—') {
      errors.push('Rule 21: snap-verdict is empty or placeholder');
    }
  }

  // 22. News URLs
  for (const n of news) {
    if (!n.url || n.url === '#') {
      errors.push(`Rule 22: news "${n.category}" has placeholder URL "#"`);
    }
  }

  // ── LAYER 1: SOURCE HIERARCHY ──────────────────────────────────────
  // Confidence must be valid; low-confidence indicators are flagged
  let lowConfCount = 0;
  for (const ind of indicators) {
    const slug = ind.indicator_slug || 'unknown';
    const conf = ind.confidence;
    if (conf && !VALID_CONFIDENCES.has(conf)) {
      warnings.push(`L1: indicator "${slug}" has unknown confidence "${conf}"`);
    }
    if (conf === 'low') {
      lowConfCount++;
    }
  }
  if (lowConfCount > 0) {
    warnings.push(`L1: ${lowConfCount} indicator(s) with confidence=low`);
  }

  // ── LAYER 2: VINTAGE ENFORCEMENT ───────────────────────────────────
  // Every indicator should have a data_vintage. No vintage in the future.
  let missingVintageCount = 0;
  for (const ind of indicators) {
    const slug = ind.indicator_slug || 'unknown';
    const vintage = ind.data_vintage;

    if (!vintage || vintage === 'Awaited') {
      missingVintageCount++;
      continue;
    }

    if (isVintageInFuture(vintage, expectedDate)) {
      errors.push(`L2: indicator "${slug}" vintage "${vintage}" is in the future (run_date=${expectedDate})`);
    }
  }
  if (missingVintageCount > 15) {
    errors.push(`L2: ${missingVintageCount} indicators have missing/Awaited vintage (max 15)`);
  } else if (missingVintageCount > 8) {
    warnings.push(`L2: ${missingVintageCount} indicator(s) with missing vintage`);
  }
  // <= 8 missing vintages is normal (LLM extraction doesn't always include dates)

  // ── LAYER 3: SCHEMA VALIDATION ─────────────────────────────────────
  // Check required fields on each data contract element
  for (const ind of indicators) {
    const slug = ind.indicator_slug || 'unknown';
    if (!ind.section || !ind.sub_section) {
      errors.push(`L3: indicator "${slug}" missing section/sub_section`);
    }
    if (!ind.indicator_name) {
      errors.push(`L3: indicator "${slug}" missing indicator_name`);
    }
    if (ind.latest_value === undefined || ind.latest_value === null) {
      errors.push(`L3: indicator "${slug}" missing latest_value`);
    }
  }

  for (const r of regime) {
    if (!r.metric_summary || !r.signal_text || !r.badge_label) {
      errors.push(`L3: regime "${r.dimension}" has empty metric_summary/signal_text/badge_label`);
    }
  }

  for (const s of signals) {
    if (!s.title || !s.data_text || !s.implication) {
      errors.push(`L3: signal ${s.signal_num} has empty title/data_text/implication`);
    }
  }

  for (const p of execSummary) {
    if (!p.para_html || p.para_html.trim().length < 20) {
      warnings.push(`L3: executive_summary para ${p.para_num} is too short or empty`);
    }
  }

  // ── LAYER 4: CROSS-AGENT CONSISTENCY ───────────────────────────────
  // Verify that key indicator values used in snap texts match the indicators array
  const niftyInd = indicators.find(i => i.indicator_slug === 'nifty50');
  if (niftyInd && run.snap_india) {
    const niftyVal = niftyInd.latest_numeric;
    // Check that snap_india references a Nifty value reasonably close
    const snapNiftyMatch = run.snap_india.match(/Nifty\s+([\d,]+)/i);
    if (snapNiftyMatch && niftyVal) {
      const snapVal = parseFloat(snapNiftyMatch[1].replace(/,/g, ''));
      if (Math.abs(snapVal - niftyVal) / niftyVal > 0.01) {
        warnings.push(`L4: snap_india Nifty value (${snapVal}) differs from indicators array (${niftyVal}) by >1%`);
      }
    }
  }

  // Regime badge should match india_regime text
  const growthRegime = regime.find(r => r.dimension === 'growth');
  if (growthRegime && run.india_regime && growthRegime.badge_label !== run.india_regime) {
    warnings.push(`L4: run.india_regime "${run.india_regime}" doesn't match growth regime badge_label "${growthRegime.badge_label}"`);
  }

  // ── LAYER 5: FABRICATION DETECTION ─────────────────────────────────
  // Flag null values passed off as real and suspiciously round numbers
  let nullAsReal = 0;
  let roundCount = 0;
  for (const ind of indicators) {
    const slug = ind.indicator_slug || 'unknown';

    // Check for fabrication: latest_numeric is null but latest_value looks like a real number
    if (ind.latest_numeric === null && ind.latest_value && ind.latest_value !== 'Awaited') {
      const parsed = parseFloat(ind.latest_value.replace(/[^0-9.\-]/g, ''));
      if (!isNaN(parsed) && parsed !== 0) {
        warnings.push(`L5: indicator "${slug}" has latest_value="${ind.latest_value}" but latest_numeric is null`);
      }
    }

    // Flag suspiciously round numbers
    if (isSuspiciouslyRound(ind.latest_numeric, slug)) {
      roundCount++;
    }
  }
  if (roundCount >= 5) {
    warnings.push(`L5: ${roundCount} indicators have suspiciously round values — possible fabrication`);
  }

  // Check that no indicator_slug appears twice
  const slugCounts = {};
  for (const ind of indicators) {
    const s = ind.indicator_slug;
    slugCounts[s] = (slugCounts[s] || 0) + 1;
  }
  for (const [slug, count] of Object.entries(slugCounts)) {
    if (count > 1) {
      errors.push(`L5: indicator_slug "${slug}" appears ${count} times (must be unique)`);
    }
  }

  // ── LAYER 6: HISTORICAL RANGE BOUNDS ───────────────────────────────
  // If a value is outside the 10-year min/max, flag as error (likely fetch bug)
  let outOfBoundsCount = 0;
  for (const ind of indicators) {
    const slug = ind.indicator_slug;
    const val  = ind.latest_numeric;
    if (val === null || val === undefined) continue;

    const range = HISTORICAL_RANGES[slug];
    if (!range) continue;

    // Allow 20% buffer beyond historical extremes for genuinely new records
    const buffer = Math.abs(range.max - range.min) * 0.20;
    const loBound = range.min - buffer;
    const hiBound = range.max + buffer;

    if (val < loBound || val > hiBound) {
      errors.push(
        `L6: indicator "${slug}" value ${val} is outside historical range ` +
        `[${range.min}, ${range.max}] with 20% buffer — likely fetch bug`
      );
      outOfBoundsCount++;
    }
  }
  if (outOfBoundsCount > 5) {
    errors.push(`L6: ${outOfBoundsCount} indicators out of historical bounds — data source may be corrupted`);
  }

  // ── WARNINGS ───────────────────────────────────────────────────────
  if (macroData._market_fetch_errors && macroData._market_fetch_errors.length > 0) {
    warnings.push(`W3: ${macroData._market_fetch_errors.length} market data fetch errors`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

export { VALID_SLUGS };
