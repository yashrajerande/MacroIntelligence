/**
 * POLARITY SKILL — Single Source of Truth for "is this positive or negative?"
 *
 * Every indicator in MacroIntelligence has a polarity: whether its direction
 * of movement is favourable or unfavourable for the economy.
 *
 *   - gst_month UP             = POSITIVE (tax collections rising = real activity)
 *   - inr_usd UP               = NEGATIVE (rupee depreciating vs dollar)
 *   - re_unsold_inventory UP   = NEGATIVE (real-estate stress)
 *   - india_vix UP             = NEGATIVE (risk-off)
 *   - cpi_headline UP          = NEGATIVE (inflation rising)
 *
 * This skill is the ONLY place in the codebase that makes polarity judgments.
 * Any agent that classifies an indicator as "positive", "risk", "strength",
 * or similar MUST call this skill. Do not duplicate polarity logic elsewhere.
 *
 * Public API:
 *   getPolarity(slug)           → 'positive' | 'negative' | 'neutral'
 *   isValidSignal(indicator)    → boolean (rejects garbage data)
 *   scoreIndicator(indicator)   → signed integer in [-100, +100]
 *   classifyIndicator(indicator)→ 'strong-positive' | 'mild-positive' |
 *                                 'neutral' | 'mild-negative' | 'strong-negative' | 'unknown'
 *   pickTopSignals(arr, n, type)→ top N indicators by signed score
 *   isInversePolarity(slug)     → boolean (backward-compat with template-filler)
 */

import { INDICATOR_SCHEMA } from './indicator-schema.js';

/**
 * Polarity overrides for indicators where the simple `inverse` flag is not
 * enough. Most indicators use the schema's `inverse` field directly. Add to
 * this map only when polarity is context-dependent or genuinely ambiguous.
 *
 * 'neutral' polarity means the indicator can never be picked as a top signal
 * — it's noisy or its direction does not map cleanly to "good" or "bad".
 */
const POLARITY_OVERRIDES = {
  gold_inr_gram:  'neutral', // Gold rising = risk-off signal OR wealth appreciation
  gold_usd:       'neutral', // Same ambiguity
  embassy_reit:   'neutral', // REIT unit prices are just prices
  mindspace_reit: 'neutral',
  brookfield_reit:'neutral',
};

/**
 * Return the polarity of an indicator.
 *
 *   'positive' — higher value = better for the economy
 *   'negative' — higher value = worse for the economy (inverse metrics)
 *   'neutral'  — context-dependent; never picked as a top signal
 */
export function getPolarity(slug) {
  if (!slug) return 'neutral';
  if (slug in POLARITY_OVERRIDES) return POLARITY_OVERRIDES[slug];
  const schema = INDICATOR_SCHEMA[slug];
  if (!schema) return 'neutral';
  return schema.inverse ? 'negative' : 'positive';
}

/**
 * Check whether an indicator has enough valid data to score.
 *
 * Rejects:
 *   - missing / null / NaN latest_numeric
 *   - missing pct_10y
 *   - pct_10y clamped to 0 or 100 while the underlying value is within the
 *     schema's expected_range (this is a parsing/data bug, not a real
 *     extreme — the picker must not trust it)
 */
export function isValidSignal(indicator) {
  if (!indicator) return false;

  const slug = indicator.indicator_slug || indicator.slug;
  if (!slug) return false;

  const rawVal = indicator.latest_numeric ?? indicator.value;
  if (rawVal === null || rawVal === undefined || rawVal === '') return false;
  const numVal = Number(rawVal);
  if (Number.isNaN(numVal)) return false;

  if (indicator.pct_10y === undefined || indicator.pct_10y === null) return false;

  // Cross-check: detect values that are clearly wrong.
  const schema = INDICATOR_SCHEMA[slug];
  if (schema && schema.expected_range) {
    const [min, max] = schema.expected_range;
    const inRange = numVal >= min && numVal <= max;

    // Guard 1: value is within range but pct is clamped to 0/100.
    // This is inconsistent — a within-range value cannot be at a percentile
    // extreme. Almost always a parse failure upstream.
    if (inRange && (indicator.pct_10y === 0 || indicator.pct_10y === 100)) {
      return false;
    }

    // Guard 2: value is wildly below range minimum. When the value is less
    // than 1/3 of the range minimum, it's almost certainly a unit parsing
    // error (e.g., RE Launches at 126 when the range is [15000, 140000] —
    // the value was scraped in hundreds instead of units).
    if (min > 0 && numVal >= 0 && numVal < min / 3) {
      return false;
    }

    // Guard 3: value is wildly above range maximum. If it's more than 5×
    // the max, it's likely a unit error (e.g., GST in paisa instead of crore).
    // We use a generous 5× threshold to avoid rejecting legitimate new highs
    // (Nasdaq at 23,000 vs old max 22,000 = 1.05× — that's real).
    if (max > 0 && numVal > max * 5) {
      return false;
    }
  }

  return true;
}

/**
 * Score an indicator on a signed [-100, +100] scale.
 *
 *   +100 = strongest possible positive signal (surprising strength)
 *   -100 = strongest possible negative signal (surprising risk)
 *      0 = neutral / insufficient evidence / invalid data
 *
 * Scoring:
 *   1. Invalid signals → 0
 *   2. Raw extremity = (pct_10y - 50) * 2  (scales [0,100] → [-100,+100])
 *   3. Positive-polarity: score = raw_extremity (top of range is good)
 *      Negative-polarity: score = -raw_extremity (top of range is bad)
 *      Neutral-polarity:  score = raw_extremity * 0.3 (dampen to ±30 max)
 *   4. Flat / missing direction → multiply score by 0.5 (not a surprise)
 */
export function scoreIndicator(indicator) {
  if (!isValidSignal(indicator)) return 0;

  const slug = indicator.indicator_slug || indicator.slug;
  const polarity = getPolarity(slug);
  const pct = Number(indicator.pct_10y);

  const rawExtremity = (pct - 50) * 2; // maps [0..100] → [-100..+100]

  let score;
  if (polarity === 'positive') {
    score = rawExtremity;       // top of range = good
  } else if (polarity === 'negative') {
    score = -rawExtremity;      // top of range = bad (flip sign)
  } else {
    score = rawExtremity * 0.3; // neutral — dampen, never top signal
  }

  // Direction-of-change weighting: flat / missing = not a surprise
  if (!indicator.direction || indicator.direction === 'flat') {
    score *= 0.5;
  }

  return Math.round(Math.max(-100, Math.min(100, score)));
}

/**
 * Classify an indicator into a named category based on its signed score.
 * Returns 'unknown' for invalid signals.
 */
export function classifyIndicator(indicator) {
  if (!isValidSignal(indicator)) return 'unknown';
  const score = scoreIndicator(indicator);
  if (score >= 70)  return 'strong-positive';
  if (score >= 30)  return 'mild-positive';
  if (score <= -70) return 'strong-negative';
  if (score <= -30) return 'mild-negative';
  return 'neutral';
}

/**
 * Pick the top N indicators by signed score.
 *
 *   type === 'positive' → top N strengths  (sorted by most-positive score)
 *   type === 'negative' → top N risks      (sorted by most-negative score)
 *
 * Returns an empty array if no valid signals match.
 */
export function pickTopSignals(indicators, count, type) {
  if (!Array.isArray(indicators)) return [];

  const scored = indicators
    .map(ind => ({ ind, score: scoreIndicator(ind) }))
    .filter(({ score }) => score !== 0);

  if (type === 'positive') {
    return scored
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, count)
      .map(({ ind, score }) => ({ ...ind, polarity_score: score }));
  }

  if (type === 'negative') {
    return scored
      .filter(({ score }) => score < 0)
      .sort((a, b) => a.score - b.score)
      .slice(0, count)
      .map(({ ind, score }) => ({ ...ind, polarity_score: score }));
  }

  return [];
}

/** True if a valid signal scores positive. */
export function isPositiveSignal(indicator) {
  return scoreIndicator(indicator) > 0;
}

/** True if a valid signal scores negative. */
export function isNegativeSignal(indicator) {
  return scoreIndicator(indicator) < 0;
}

/**
 * Backward-compatible helper: is this indicator's polarity "negative"
 * (higher = worse)? Used by template-filler to flip arrow colours.
 */
export function isInversePolarity(slug) {
  return getPolarity(slug) === 'negative';
}
