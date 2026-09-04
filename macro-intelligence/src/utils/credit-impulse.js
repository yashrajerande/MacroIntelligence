/**
 * Credit Impulse Skill — Steve Keen / Minsky private-debt framework.
 *
 * Keen's core claim: aggregate demand tracks the CHANGE in private debt,
 * not its level. So the level tells you how much dry tinder exists; the
 * "credit impulse" (the 2nd derivative — is new borrowing accelerating or
 * decelerating) tells you whether that tinder is about to catch or is
 * already cooling. Minsky's taxonomy gives the qualitative read: a high
 * level with a decelerating impulse is the classic pre-shock signature.
 *
 * Pure code. No LLM. Reads the trailing series already fetched for the
 * validator's dynamic ranges (agents/Production/Validator/skills/dynamic-ranges.js)
 * — no extra Supabase queries.
 *
 * IMPORTANT — maturity: a clean YoY-of-YoY impulse for a quarterly series
 * needs ~9 distinct quarterly prints (~2 years of real calendar time) to
 * compute. Brand-new indicators will report maturity:'building' for a
 * long stretch — this is honest, not a bug. Level readings are available
 * immediately; impulse readings accumulate over the following quarters.
 */

// Quarterly slugs need >=5 distinct prints for one YoY read, >=9 for impulse.
// Monthly slugs need >=13 distinct prints for one YoY read, >=25 for impulse.
const MIN_PRINTS = { quarterly: { yoy: 5, impulse: 9 }, monthly: { yoy: 13, impulse: 25 } };

/**
 * Collapse daily snapshots into one print per CALENDAR PERIOD (month or
 * quarter), keeping the last observation in each period.
 *
 * Deduping by value (the previous approach) failed in both directions:
 * two genuinely different quarters printing the same rounded value merged
 * into one (index arithmetic then compared the wrong periods), and daily
 * LLM-sourced wobble (42.6→42.5→42.6) created fake "prints" that let a
 * quarterly series claim impulse maturity from values days apart.
 */
function distinctPrints(series, frequency) {
  const out = [];
  let lastBucket = null;
  for (const p of series || []) {
    if (!Number.isFinite(p.v)) continue;
    const d = String(p.d || '');
    const year = d.slice(0, 4);
    const month = parseInt(d.slice(5, 7), 10);
    if (!year || !Number.isFinite(month)) continue;
    const bucket = frequency === 'quarterly'
      ? `${year}-Q${Math.ceil(month / 3)}`
      : `${year}-${String(month).padStart(2, '0')}`;
    if (bucket === lastBucket) {
      out[out.length - 1] = p; // keep the LAST observation in the period
    } else {
      out.push(p);
      lastBucket = bucket;
    }
  }
  return out;
}

/**
 * Compute the credit impulse for one slug.
 * @param {string} frequency — 'quarterly' | 'monthly'
 * @param {Array<{d:string,v:number}>|undefined} series — trailing observations, oldest→newest
 * @returns {{maturity:'building'|'ready', printsAvailable:number, yoyGrowth:number|null,
 *            yoyGrowthPrior:number|null, impulse:number|null}}
 */
export function computeImpulse(frequency, series) {
  const need = MIN_PRINTS[frequency] || MIN_PRINTS.monthly;
  const prints = distinctPrints(series, frequency);

  if (prints.length < need.yoy) {
    return { maturity: 'building', printsAvailable: prints.length, yoyGrowth: null, yoyGrowthPrior: null, impulse: null };
  }

  const periodsPerYear = frequency === 'quarterly' ? 4 : 12;
  const vals = prints.map(p => p.v);
  const latest = vals[vals.length - 1];
  const yearAgo = vals[vals.length - 1 - periodsPerYear];
  const yoyGrowth = yearAgo !== 0 ? Math.round(((latest - yearAgo) / Math.abs(yearAgo)) * 10000) / 100 : null;

  if (prints.length < need.impulse) {
    return { maturity: 'building', printsAvailable: prints.length, yoyGrowth, yoyGrowthPrior: null, impulse: null };
  }

  const latestPrior = vals[vals.length - 1 - periodsPerYear];
  const yearAgoPrior = vals[vals.length - 1 - periodsPerYear * 2];
  const yoyGrowthPrior = yearAgoPrior !== 0
    ? Math.round(((latestPrior - yearAgoPrior) / Math.abs(yearAgoPrior)) * 10000) / 100
    : null;

  const impulse = (yoyGrowth !== null && yoyGrowthPrior !== null)
    ? Math.round((yoyGrowth - yoyGrowthPrior) * 100) / 100
    : null;

  return { maturity: 'ready', printsAvailable: prints.length, yoyGrowth, yoyGrowthPrior, impulse };
}

/**
 * Classify a level (percentile 0-100 against expected_range) and an impulse
 * sign into Minsky's quadrant. This is the instinct-building read: level
 * sets fragility, impulse sets timing.
 */
export function classifyQuadrant(levelPct, impulse) {
  if (impulse === null || impulse === undefined) {
    return levelPct >= 70 ? 'high-level (impulse building)' : 'normal (impulse building)';
  }
  const highLevel = levelPct >= 70;
  const accelerating = impulse > 0.3;
  const decelerating = impulse < -0.3;

  if (highLevel && decelerating) return 'danger';        // classic pre-shock: high stock, cooling flow
  if (highLevel && accelerating) return 'ponzi-drift';    // levering further from an already-high base
  if (!highLevel && accelerating) return 'expansion';     // healthy credit-led growth from a low base
  if (!highLevel && decelerating) return 'deleveraging';  // low base, still pulling back — demand drag
  return 'steady';
}

export const QUADRANT_LABELS = {
  'danger':        { label: 'Danger — high debt, decelerating',   badge: 'b-risk' },
  'ponzi-drift':   { label: 'Ponzi drift — high debt, still levering', badge: 'b-slow' },
  'expansion':     { label: 'Healthy expansion — low debt, accelerating', badge: 'b-exp' },
  'deleveraging':  { label: 'Deleveraging drag — low debt, decelerating', badge: 'b-slow' },
  'steady':        { label: 'Steady', badge: 'b-neu' },
  'high-level (impulse building)': { label: 'High debt — impulse data accumulating', badge: 'b-slow' },
  'normal (impulse building)':     { label: 'Normal debt — impulse data accumulating', badge: 'b-neu' },
};
