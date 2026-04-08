/**
 * Signal Scoring Skill — percentile scoring for all indicator slugs.
 * Percentile computation is deterministic. LLM only writes pct_note narrative.
 */

import { HISTORICAL_RANGES } from '../../../../src/utils/indicator-schema.js';

/**
 * Compute 10-year percentile for a given indicator.
 * Returns { pct_10y, pct_10y_tier, pct_note }
 */
export function scorePct10y(slug, value) {
  const range = HISTORICAL_RANGES[slug];
  if (!range || value === null || value === undefined) {
    return { pct_10y: 50, pct_10y_tier: 'mid', pct_note: '~Estimated — historical range not available.' };
  }

  // Linear interpolation within known percentile bands
  let pct;
  if (value <= range.min) {
    pct = 0;
  } else if (value >= range.max) {
    pct = 100;
  } else if (value <= range.p10) {
    pct = Math.round(10 * (value - range.min) / (range.p10 - range.min));
  } else if (value <= range.p25) {
    pct = Math.round(10 + 15 * (value - range.p10) / (range.p25 - range.p10));
  } else if (value <= range.p50) {
    pct = Math.round(25 + 25 * (value - range.p25) / (range.p50 - range.p25));
  } else if (value <= range.p75) {
    pct = Math.round(50 + 25 * (value - range.p50) / (range.p75 - range.p50));
  } else if (value <= range.p90) {
    pct = Math.round(75 + 15 * (value - range.p75) / (range.p90 - range.p75));
  } else {
    pct = Math.round(90 + 10 * (value - range.p90) / (range.max - range.p90));
  }

  pct = Math.max(0, Math.min(100, pct));

  let tier;
  if (pct >= 80) tier = 'hi';
  else if (pct >= 40) tier = 'mid';
  else tier = 'lo';

  return { pct_10y: pct, pct_10y_tier: tier, pct_note: '' };
}

/**
 * Score all indicators at once.
 */
export function scoreAllIndicators(indicators) {
  const scored = {};
  for (const [slug, ind] of Object.entries(indicators)) {
    const score = scorePct10y(slug, ind.value);
    scored[slug] = { ...ind, ...score };
  }
  return scored;
}

export { HISTORICAL_RANGES };
