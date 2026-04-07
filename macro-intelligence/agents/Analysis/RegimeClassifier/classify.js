/**
 * RegimeClassifier — Pure deterministic classification with template-based narratives.
 * No LLM calls. signal_text is generated from badge_type + indicator values.
 */

import { classifyAll } from './skills/regime-logic.js';

/**
 * Template map: dimension -> badge_type -> signal_text template function.
 * Each function receives the flat indicators map and returns a narrative string.
 */
const SIGNAL_TEMPLATES = {
  growth: {
    'b-exp': (i) =>
      `GDP at ${v(i, 'india_gdp_yoy')}% with PMI Composite at ${v(i, 'pmi_composite')} signals strong expansion. Manufacturing and services both in growth territory.`,
    'b-risk': (i) =>
      `GDP slowing to ${v(i, 'india_gdp_yoy')}% while PMI Composite at ${v(i, 'pmi_composite')} flags contraction risk. Watch IIP and core sector for confirmation.`,
    'b-slow': (i) =>
      `GDP moderating at ${v(i, 'india_gdp_yoy')}% with PMI at ${v(i, 'pmi_composite')}. Growth is positive but losing momentum quarter-on-quarter.`,
    'b-neu': (i) =>
      `GDP steady at ${v(i, 'india_gdp_yoy')}% with PMI at ${v(i, 'pmi_composite')}. Economy in cruise control with no clear directional signals.`,
  },
  inflation: {
    'b-risk': (i) =>
      `CPI at ${v(i, 'cpi_headline')}% with fuel inflation at ${v(i, 'fuel_inflation')}% indicates overshoot beyond RBI's comfort zone. Price pressures broad-based.`,
    'b-slow': (i) =>
      `CPI rising to ${v(i, 'cpi_headline')}% with fuel at ${v(i, 'fuel_inflation')}%. Inflation trending up but still within tolerance band — bears monitoring.`,
    'b-exp': (i) =>
      `CPI at ${v(i, 'cpi_headline')}% with fuel at ${v(i, 'fuel_inflation')}% signals disinflationary trend. Benign price environment supports accommodative policy.`,
    'b-neu': (i) =>
      `CPI at ${v(i, 'cpi_headline')}% with fuel at ${v(i, 'fuel_inflation')}%. Inflation within RBI's 2-6% target band — no policy urgency.`,
  },
  credit: {
    'b-exp': (i) =>
      `Bank credit growing at ${v(i, 'bank_credit_growth')}% with CD ratio at ${v(i, 'cd_ratio')}% signals credit boom. Lending conditions highly expansionary.`,
    'b-risk': (i) =>
      `Bank credit at ${v(i, 'bank_credit_growth')}% with CD ratio at ${v(i, 'cd_ratio')}% flags credit stress. Deposit mobilisation lagging or loan demand weak.`,
    'b-slow': (i) =>
      `Bank credit growing at ${v(i, 'bank_credit_growth')}% with CD ratio at ${v(i, 'cd_ratio')}%. Credit expansion moderate — neither overheating nor contracting.`,
    'b-neu': (i) =>
      `Bank credit at ${v(i, 'bank_credit_growth')}% with CD ratio at ${v(i, 'cd_ratio')}%. Credit conditions stable with balanced deposit-lending dynamics.`,
  },
  policy: {
    'b-exp': (i) =>
      `Repo rate at ${v(i, 'rbi_repo_rate')}% with RBI in easing cycle. Rate cuts signal accommodative stance — supportive for duration and equities.`,
    'b-risk': (i) =>
      `Repo rate at ${v(i, 'rbi_repo_rate')}% under emergency tightening. Aggressive hikes indicate RBI prioritising inflation control over growth.`,
    'b-slow': (i) =>
      `Repo rate at ${v(i, 'rbi_repo_rate')}% with RBI in tightening mode. Incremental hikes aimed at anchoring inflation expectations.`,
    'b-neu': (i) =>
      `Repo rate steady at ${v(i, 'rbi_repo_rate')}%. RBI on extended pause — data-dependent stance with no near-term rate action expected.`,
  },
  capex: {
    'b-exp': (i) =>
      `IIP capital goods at ${v(i, 'iip_capgoods')}% with capacity utilisation at ${v(i, 'capacity_utilisation')}% signals capex upcycle. Investment cycle firmly underway.`,
    'b-risk': (i) =>
      `IIP capital goods at ${v(i, 'iip_capgoods')}% with capacity utilisation at ${v(i, 'capacity_utilisation')}% flags capex stall. Private investment cycle yet to materialise.`,
    'b-slow': (i) =>
      `IIP capital goods at ${v(i, 'iip_capgoods')}% with capacity utilisation at ${v(i, 'capacity_utilisation')}%. Capex growth moderate — government-led but private sector tentative.`,
    'b-neu': (i) =>
      `IIP capital goods at ${v(i, 'iip_capgoods')}% with capacity utilisation at ${v(i, 'capacity_utilisation')}%. Investment holding steady with no acceleration or deceleration.`,
  },
  consumption: {
    'b-exp': (i) =>
      `GST collections at ${v(i, 'gst_month')} YoY with PV sales at ${v(i, 'pv_sales')}% signals demand surge. Consumer spending broad-based across durables and non-durables.`,
    'b-risk': (i) =>
      `GST collections at ${v(i, 'gst_month')} YoY with PV sales at ${v(i, 'pv_sales')}% flags demand weakness. Urban and rural consumption both under pressure.`,
    'b-slow': (i) =>
      `GST collections at ${v(i, 'gst_month')} YoY with PV sales at ${v(i, 'pv_sales')}%. Demand tepid — consumers cautious amid mixed macro signals.`,
    'b-neu': (i) =>
      `GST collections at ${v(i, 'gst_month')} YoY with PV sales at ${v(i, 'pv_sales')}%. Consumption stable — neither accelerating nor fading.`,
  },
};

/** Extract display value from indicators map; falls back to '~' if missing. */
function v(indicators, slug) {
  return indicators[slug]?.value ?? '~';
}

export class RegimeClassifier {
  async classify(allData) {
    const start = Date.now();

    // Merge all indicators into a single flat map
    const indicators = {
      ...allData.marketData.data.prices,
      ...allData.macroData.data.indicators,
      ...allData.reData.data.indicators,
    };

    // Step 1: Deterministic classification
    const regimeBase = classifyAll(indicators);

    // Step 2: Deterministic signal_text from templates
    for (const r of regimeBase) {
      const templateFn = SIGNAL_TEMPLATES[r.dimension]?.[r.badge_type];
      r.signal_text = templateFn
        ? templateFn(indicators)
        : `Current reading: ${r.metric_summary}.`;
    }

    const latency = Date.now() - start;
    console.log(`[RegimeClassifier] Done in ${latency}ms.`);

    return {
      data: regimeBase,
      meta: {
        agent: 'RegimeClassifier',
        model: 'none',
        latency_ms: latency,
        tokens: { input: 0, output: 0 },
      },
    };
  }
}

if (process.argv[1] && process.argv[1].includes('RegimeClassifier')) {
  console.log('[RegimeClassifier] Standalone mode — requires piped input data');
}
