/**
 * ScenarioPlanner — Pure deterministic decision tree. No LLM calls.
 * Picks scenario names + descriptions based on regime classifications.
 */

import { mergeScenarios } from './skills/scenario-logic.js';

/**
 * Helper: look up a regime dimension from the regime data array.
 */
function getDimension(regimeData, name) {
  return regimeData.find(r => r.dimension === name) || { badge_type: 'b-neu', metric_summary: '' };
}

/**
 * Build scenario names and descriptions from a deterministic decision tree.
 */
function buildScenariosFromRegime(regimeData) {
  // --- Extract regime dimensions ---
  const growth      = getDimension(regimeData, 'growth');
  const inflation   = getDimension(regimeData, 'inflation');
  const credit      = getDimension(regimeData, 'credit');
  const policy      = getDimension(regimeData, 'policy');
  const capex       = getDimension(regimeData, 'capex');
  const consumption = getDimension(regimeData, 'consumption');

  // --- Count regime signals ---
  const expCount  = regimeData.filter(r => r.badge_type === 'b-exp').length;
  const riskCount = regimeData.filter(r => r.badge_type === 'b-risk').length;
  const slowCount = regimeData.filter(r => r.badge_type === 'b-slow').length;

  // --- BASE scenario (path of least resistance) ---
  let base_name, base_desc;
  if (expCount >= 3) {
    base_name = 'Resilient Growth Continues';
    base_desc =
      `Broad expansion persists with ${expCount} of 6 dimensions in expansion mode. ` +
      `Growth prints at ${growth.metric_summary} while credit channels remain supportive (${credit.metric_summary}). ` +
      `Policy stays accommodative as inflation remains contained.`;
  } else if (riskCount >= 3) {
    base_name = 'Stagflation Grind';
    base_desc =
      `Stress dominates with ${riskCount} of 6 dimensions flagging risk. ` +
      `Inflation runs hot (${inflation.metric_summary}) while credit conditions tighten (${credit.metric_summary}). ` +
      `Growth momentum fades as policy room narrows.`;
  } else if (slowCount >= 3) {
    base_name = 'Gradual Deceleration';
    base_desc =
      `Momentum is easing across ${slowCount} of 6 dimensions. ` +
      `Growth is moderating (${growth.metric_summary}) and consumption shows tepid trends (${consumption.metric_summary}). ` +
      `No acute stress, but the trajectory is clearly downward.`;
  } else {
    base_name = 'Steady State Drift';
    base_desc =
      `Mixed signals across dimensions with no dominant trend. ` +
      `Growth at ${growth.metric_summary}, inflation at ${inflation.metric_summary}. ` +
      `Policy remains on hold and credit conditions are stable.`;
  }

  // --- BULL scenario (what could go better) ---
  let bull_name, bull_desc;
  if (growth.badge_type === 'b-exp' || growth.badge_type === 'b-neu') {
    bull_name = 'Reform Acceleration Boost';
    bull_desc =
      `Policy reforms gain traction and crowd in private capex (${capex.metric_summary}). ` +
      `Growth upgrades from current ${growth.metric_summary} as consumption broadens (${consumption.metric_summary}). ` +
      `Credit transmission improves, amplifying the recovery.`;
  } else if (inflation.badge_type === 'b-exp') {
    bull_name = 'Goldilocks Sweet Spot';
    bull_desc =
      `Disinflation (${inflation.metric_summary}) opens the door to rate cuts, boosting rate-sensitive sectors. ` +
      `RBI policy (${policy.metric_summary}) turns decisively supportive. ` +
      `Lower borrowing costs revive capex and housing demand.`;
  } else {
    bull_name = 'Synchronized Global Recovery';
    bull_desc =
      `Global tailwinds lift exports and FDI flows while domestic indicators stabilize. ` +
      `Growth rebounds from ${growth.metric_summary} as external demand supplements weak domestic trends. ` +
      `Commodity prices ease, relieving margin pressure.`;
  }

  // --- BEAR scenario (what could go wrong) ---
  let bear_name, bear_desc;
  if (credit.badge_type === 'b-risk') {
    bear_name = 'Credit Crunch Cascade';
    bear_desc =
      `Credit stress (${credit.metric_summary}) spreads from NBFCs to the broader banking system. ` +
      `Deposit mobilization falters, pushing up funding costs. ` +
      `Capex (${capex.metric_summary}) stalls as risk aversion rises sharply.`;
  } else if (inflation.badge_type === 'b-risk') {
    bear_name = 'Stagflation Spiral Deepens';
    bear_desc =
      `Oil and food price shocks push inflation higher (${inflation.metric_summary}), forcing emergency tightening. ` +
      `Real incomes erode, dragging consumption (${consumption.metric_summary}) lower. ` +
      `RBI faces an impossible trade-off between growth and price stability.`;
  } else if (growth.badge_type === 'b-risk') {
    bear_name = 'Hard Landing Materializes';
    bear_desc =
      `Growth collapses (${growth.metric_summary}) as PMI breaches contraction territory. ` +
      `Capex (${capex.metric_summary}) freezes amid demand uncertainty. ` +
      `Fiscal revenues disappoint, limiting counter-cyclical response.`;
  } else {
    bear_name = 'Geopolitical Shock Contagion';
    bear_desc =
      `External shocks -- trade disruptions, energy supply stress, or capital flight -- hit India. ` +
      `Current fundamentals (${growth.metric_summary}, ${credit.metric_summary}) offer limited buffer. ` +
      `Rupee depreciation and imported inflation force a policy reversal.`;
  }

  return {
    base_name,
    base_desc,
    bull_name,
    bull_desc,
    bear_name,
    bear_desc,
  };
}

export class ScenarioPlanner {
  async plan(allData) {
    const start = Date.now();

    const regimeData = allData.regime.data;
    const llmOutput = buildScenariosFromRegime(regimeData);
    const scenarios = mergeScenarios(llmOutput);

    const latency = Date.now() - start;
    console.log(`[ScenarioPlanner] Done in ${latency}ms (deterministic, no LLM).`);

    return {
      data: scenarios,
      meta: {
        agent: 'ScenarioPlanner',
        model: 'none',
        latency_ms: latency,
        tokens: { input: 0, output: 0 },
      },
    };
  }
}
