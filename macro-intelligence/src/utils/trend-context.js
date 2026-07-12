/**
 * Trend Context Skill — compact recent-history strings for LLM prompts.
 *
 * The personas ask for multi-period claims ("widened 3 consecutive months"),
 * but until now agents only saw today + one previous value, so any such claim
 * was fabricated. This skill renders the trailing Supabase series per slug
 * into a short "recent:" sequence the model can actually ground claims in.
 *
 * Monthly/quarterly indicators are stored once per day, so consecutive
 * duplicate values are collapsed — the sequence shows true print-to-print
 * changes, not 30 copies of the same release.
 */

const MAX_POINTS = 6;

function fmt(v) {
  if (!Number.isFinite(v)) return String(v);
  const abs = Math.abs(v);
  if (abs >= 10000) return String(Math.round(v));
  if (abs >= 100)   return String(Math.round(v * 10) / 10);
  return String(Math.round(v * 100) / 100);
}

/**
 * Build a compact trend suffix for one slug, e.g.
 * " | recent: 158.1→160.4→159.8→162.0 (up 2 of last 3)"
 * Returns '' when no series is available.
 *
 * @param {string} slug
 * @param {Record<string, {series?: Array<{d:string,v:number}>}>|null} dynamicRanges
 */
export function trendSuffix(slug, dynamicRanges) {
  const series = dynamicRanges?.[slug]?.series;
  if (!Array.isArray(series) || series.length < 3) return '';

  // Collapse consecutive duplicates (daily-stored monthly prints)
  const distinct = [];
  for (const p of series) {
    if (!Number.isFinite(p.v)) continue;
    if (distinct.length === 0 || distinct[distinct.length - 1] !== p.v) {
      distinct.push(p.v);
    }
  }
  if (distinct.length < 3) return '';

  const tail = distinct.slice(-MAX_POINTS);
  let ups = 0, downs = 0;
  for (let i = 1; i < tail.length; i++) {
    if (tail[i] > tail[i - 1]) ups++;
    else if (tail[i] < tail[i - 1]) downs++;
  }
  const steps = tail.length - 1;
  const shape = ups === steps ? `rising ${steps} in a row`
    : downs === steps ? `falling ${steps} in a row`
    : `up ${ups} of last ${steps}`;

  return ` | recent: ${tail.map(fmt).join('→')} (${shape})`;
}

/**
 * Prompt guidance to include whenever trend suffixes are present.
 */
export const TREND_GUIDANCE =
  `TREND DATA: where an indicator line ends with "recent: a→b→c (…)", those are its last ` +
  `distinct observed values in chronological order (oldest → newest, spanning up to ~6 months). ` +
  `Any multi-period claim you make ("third consecutive month", "reversing a quarter-long slide") ` +
  `MUST be supported by one of these sequences. If an indicator has no "recent:" data, do not ` +
  `claim a multi-period trend for it.`;
