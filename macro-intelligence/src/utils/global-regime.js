/**
 * Global Regime Classifier — pure code, no LLM.
 *
 * Mirrors the style of agents/Analysis/RegimeClassifier/skills/regime-logic.js
 * but for GLOBAL conditions. That classifier's 6 dimensions (growth,
 * inflation, credit, policy, capex, consumption) are all India-specific —
 * "Global Regime" in the command strip was actually reusing India's own
 * policy badge (repo rate driven) and the box itself showed nothing but
 * raw Brent/DXY numbers with no classification behind them at all.
 *
 * This gives the command strip a real global read: growth (US GDP SAAR +
 * global composite PMI) classified into a badge + narrative sentence,
 * with risk appetite (VIX) as a secondary clause — same "language, then
 * numbers" convention as the rest of the regime system.
 */

function fmt(ind) {
  if (!ind) return '—';
  return ind.value_str || ind.value || '—';
}

/**
 * @param {Record<string, any>} indicators — merged allRaw indicator map
 * @returns {{badge_type: string, badge_label: string, narrative: string}}
 */
export function classifyGlobalRegime(indicators) {
  const gdpInd = indicators.us_gdp_saar;
  const pmiInd = indicators.global_pmi_composite;
  const vixInd = indicators.us_vix;

  const gdp = typeof gdpInd?.value === 'number' ? gdpInd.value : null;
  const pmi = typeof pmiInd?.value === 'number' ? pmiInd.value : null;
  const vix = typeof vixInd?.value === 'number' ? vixInd.value : null;

  let badge_type, badge_label, growthNote;
  if (gdp !== null && pmi !== null) {
    if (gdp >= 2.5 && pmi >= 52) {
      badge_type = 'b-exp';
      badge_label = 'Global Expansion';
      growthNote = `US growth is running at ${fmt(gdpInd)}% SAAR with the global composite PMI at ${fmt(pmiInd)} — both comfortably in expansion territory`;
    } else if (gdp < 1.0 || pmi < 48) {
      badge_type = 'b-risk';
      badge_label = 'Global Slowdown';
      growthNote = `US growth has slipped to ${fmt(gdpInd)}% SAAR and the global composite PMI reads ${fmt(pmiInd)} — both flashing a slowdown`;
    } else {
      badge_type = 'b-neu';
      badge_label = 'Global Steady-State';
      growthNote = `US growth at ${fmt(gdpInd)}% SAAR and a global PMI of ${fmt(pmiInd)} point to a steady, unspectacular expansion`;
    }
  } else {
    badge_type = 'b-neu';
    badge_label = 'Global Steady-State';
    growthNote = 'Global growth signals are incomplete this run';
  }

  let riskNote = '';
  if (vix !== null) {
    if (vix < 15) riskNote = `; markets are pricing a risk-on tape (VIX ${fmt(vixInd)})`;
    else if (vix > 22) riskNote = `; markets are pricing risk-off stress (VIX ${fmt(vixInd)})`;
    else riskNote = `; risk appetite is neutral (VIX ${fmt(vixInd)})`;
  }

  return { badge_type, badge_label, narrative: `${growthNote}${riskNote}.` };
}
