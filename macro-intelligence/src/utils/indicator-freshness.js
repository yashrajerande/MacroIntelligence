/**
 * Indicator Freshness — Re-exports INDICATOR_FRESHNESS from the canonical schema
 * and provides helper functions used by data-cache.
 */

import { INDICATOR_FRESHNESS } from './indicator-schema.js';

export { INDICATOR_FRESHNESS };

/** Maximum age (in calendar days) before an indicator is considered stale. */
const FRESHNESS_THRESHOLDS = {
  daily:     1,
  monthly:   32,
  quarterly: 95,
};

/**
 * Return the update frequency for a slug.
 * @param {string} slug
 * @returns {'daily'|'monthly'|'quarterly'|undefined}
 */
export function getFrequency(slug) {
  return INDICATOR_FRESHNESS[slug];
}

/**
 * Returns true if the indicator needs re-fetching.
 * @param {string}      slug          — indicator slug
 * @param {string|null} lastFetchDate — ISO date string of last fetch (or null/undefined)
 * @param {string}      currentDate   — ISO date string of "today"
 * @returns {boolean}
 */
export function isStale(slug, lastFetchDate, currentDate) {
  if (!lastFetchDate) return true;

  const freq = getFrequency(slug);
  if (!freq) return true;                     // unknown slug → always re-fetch

  const threshold = FRESHNESS_THRESHOLDS[freq];
  const last = new Date(lastFetchDate + 'T00:00:00Z');
  const now  = new Date(currentDate   + 'T00:00:00Z');
  const daysDiff = Math.floor((now - last) / (1000 * 60 * 60 * 24));

  return daysDiff >= threshold;
}
