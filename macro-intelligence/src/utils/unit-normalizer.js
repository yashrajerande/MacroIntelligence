/**
 * Unit Normalizer Skill — Detects and corrects unit/scale mismatches.
 *
 * The LLM sometimes returns values in the wrong unit (e.g., GST in
 * hundreds of crore instead of crore, or INR/USD inverted). This skill
 * uses the HISTORICAL_RANGES median (p50) as an anchor to detect when
 * a value is off by a known scale factor and auto-corrects it.
 *
 * Shared skill — importable by any agent that handles numeric indicator data.
 */

import { HISTORICAL_RANGES } from './indicator-schema.js';

/**
 * Common scale factors to try when a value is outside the expected range.
 * Order matters — try the most likely correction first.
 */
const SCALE_FACTORS = [10, 100, 1000, 0.001, 0.01, 0.1];

/**
 * Indicators where the value might come inverted (e.g., USD/INR vs INR/USD).
 * Maps slug to: { detect: fn(value) => boolean, fix: fn(value) => number }
 */
const INVERSION_RULES = {
  inr_usd: {
    detect: (v) => v > 0 && v < 1,        // USD per INR instead of INR per USD
    fix:    (v) => Math.round((1 / v) * 100) / 100,
    note:   'Inverted USD/INR → INR/USD',
  },
};

/**
 * Per-indicator hard rules for known unit confusion patterns.
 * These take priority over the generic scale-factor approach.
 */
const HARD_RULES = {
  gst_month: {
    // LLM sometimes returns in hundreds of crore (e.g., 20064 vs 200640)
    detect: (v) => v > 10000 && v < 50000,
    fix:    (v) => v * 10,
    note:   'GST monthly scaled from hundreds of crore to crore',
  },
  gst_ytd: {
    detect: (v) => v > 100000 && v < 500000,
    fix:    (v) => v * 10,
    note:   'GST YTD scaled from hundreds of crore to crore',
  },
  re_unsold_inventory: {
    // Sometimes returned in thousands instead of units
    detect: (v) => v > 100 && v < 5000,
    fix:    (v) => v * 1000,
    note:   'Unsold inventory scaled from thousands to units',
  },
  home_loan_disbursements: {
    // Sometimes returned in billions instead of crore
    detect: (v) => v > 50 && v < 5000,
    fix:    (v) => v * 100,
    note:   'Home loan disbursements scaled from billions to crore',
  },
  gold_inr_gram: {
    // Sometimes returned per 10g or per kg instead of per gram
    detect: (v) => v > 0 && v < 500,
    fix:    (v) => v * 10,
    note:   'Gold INR likely per 10g, scaled to per gram estimate',
  },
  corp_bond_issuance: {
    detect: (v) => v > 100 && v < 10000,
    fix:    (v) => v * 100,
    note:   'Corp bond issuance scaled from hundreds of crore to crore',
  },
  // HPI — LLM sometimes returns YoY growth % instead of index value (base=100)
  hpi_mumbai: {
    detect: (v) => v > -20 && v < 50,
    fix:    (v) => null,  // Can't convert % to index — mark as unusable
    note:   'HPI Mumbai: got YoY % instead of index — discarded',
  },
  hpi_delhi: {
    detect: (v) => v > -20 && v < 50,
    fix:    (v) => null,
    note:   'HPI Delhi: got YoY % instead of index — discarded',
  },
  hpi_bengaluru: {
    detect: (v) => v > -20 && v < 50,
    fix:    (v) => null,
    note:   'HPI Bengaluru: got YoY % instead of index — discarded',
  },
  hpi_hyderabad: {
    detect: (v) => v > -20 && v < 50,
    fix:    (v) => null,
    note:   'HPI Hyderabad: got YoY % instead of index — discarded',
  },
};

/**
 * Check if a value falls within the expected historical range (with 20% buffer).
 * @param {string} slug
 * @param {number} value
 * @returns {boolean}
 */
function isInRange(slug, value) {
  const range = HISTORICAL_RANGES[slug];
  if (!range) return true; // No range defined — assume OK
  const buffer = Math.abs(range.max - range.min) * 0.2;
  return value >= (range.min - buffer) && value <= (range.max + buffer);
}

/**
 * Normalize a single indicator value.
 *
 * Returns { value, corrected, correction_note } where:
 * - value: the (possibly corrected) numeric value
 * - corrected: boolean — was the value changed?
 * - correction_note: human-readable explanation if corrected
 *
 * @param {string} slug — indicator slug
 * @param {number|null} value — raw numeric value
 * @returns {{ value: number|null, corrected: boolean, correction_note: string }}
 */
export function normalizeValue(slug, value) {
  if (value === null || value === undefined || typeof value !== 'number' || isNaN(value)) {
    return { value, corrected: false, correction_note: '' };
  }

  // 1. ALWAYS check hard rules first — they detect known unit confusions
  //    even when the value accidentally falls within the (wide) range.
  const hard = HARD_RULES[slug];
  if (hard && hard.detect(value)) {
    const fixed = hard.fix(value);
    if (fixed === null) {
      return { value: null, corrected: true, correction_note: hard.note };
    }
    if (isInRange(slug, fixed)) {
      return { value: fixed, corrected: true, correction_note: hard.note };
    }
  }

  // 2. ALWAYS check inversion rules — e.g., INR/USD inverted
  const inv = INVERSION_RULES[slug];
  if (inv && inv.detect(value)) {
    const fixed = inv.fix(value);
    if (isInRange(slug, fixed)) {
      return { value: fixed, corrected: true, correction_note: inv.note };
    }
  }

  // 3. If already in range after hard/inversion checks, no correction needed
  if (isInRange(slug, value)) {
    return { value, corrected: false, correction_note: '' };
  }

  // 3. Generic scale-factor detection using p50 as anchor
  const range = HISTORICAL_RANGES[slug];
  if (range && range.p50) {
    for (const factor of SCALE_FACTORS) {
      const candidate = value * factor;
      if (isInRange(slug, candidate)) {
        // Sanity check: the corrected value should be closer to p50
        const distOriginal  = Math.abs(value - range.p50);
        const distCorrected = Math.abs(candidate - range.p50);
        if (distCorrected < distOriginal) {
          return {
            value: Math.round(candidate * 10000) / 10000,
            corrected: true,
            correction_note: `Scaled by ${factor}x to fit expected range [${range.min}, ${range.max}]`,
          };
        }
      }
    }
  }

  // No correction found — return original
  return { value, corrected: false, correction_note: '' };
}

/**
 * Normalize all indicators in a flat slug → data object.
 * Mutates the values in-place and returns a summary of corrections.
 *
 * @param {Record<string, any>} indicators — slug → { value, value_str, ... }
 * @returns {{ corrected: number, corrections: Array<{slug, from, to, note}> }}
 */
export function normalizeAllIndicators(indicators) {
  const corrections = [];

  for (const [slug, ind] of Object.entries(indicators)) {
    if (!ind || ind.value === null || ind.value === undefined) continue;

    const result = normalizeValue(slug, ind.value);
    if (result.corrected) {
      const from = ind.value;
      ind.value = result.value;
      ind.value_str = result.value !== null ? String(result.value) : 'Awaited';
      if (result.value === null) {
        ind.is_estimated = true;
        ind.direction = 'flat';
      }
      corrections.push({
        slug,
        from,
        to: result.value ?? 'discarded',
        note: result.correction_note,
      });
    }
  }

  if (corrections.length > 0) {
    console.log(`[UnitNormalizer] Corrected ${corrections.length} indicators:`);
    for (const c of corrections) {
      console.log(`  ↳ ${c.slug}: ${c.from} → ${c.to} (${c.note})`);
    }
  }

  return { corrected: corrections.length, corrections };
}
