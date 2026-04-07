/**
 * Scenario Logic Skill — Deterministic scenario structure generation.
 * The LLM fills in narrative descriptions only.
 */

export const SCENARIO_TEMPLATE = {
  base: {
    type: 'base',
    prob_label: '◉ Most Likely',
    name: '',
    description: '',
  },
  bull: {
    type: 'bull',
    prob_label: '↑ Requires Co-incidence',
    name: '',
    description: '',
  },
  bear: {
    type: 'bear',
    prob_label: '⚠ Plausible Tail',
    name: '',
    description: '',
  },
};

/**
 * Build the scenario prompt context from regime and signals data.
 */
export function buildScenarioContext(regime, signals) {
  const regimeSummary = regime.map(r =>
    `${r.dimension}: ${r.badge_label} (${r.badge_type}) — ${r.metric_summary}`
  ).join('\n');

  const signalSummary = signals.map(s =>
    `Sig${s.signal_num} [${s.status}]: ${s.title} — ${s.data_text}`
  ).join('\n');

  return `Current Regime:\n${regimeSummary}\n\nActive Signals:\n${signalSummary}`;
}

/**
 * Merge LLM-generated scenario narratives with the fixed template.
 */
export function mergeScenarios(llmOutput) {
  return {
    scenario_base_prob: 0,
    scenario_bull_prob: 0,
    scenario_bear_prob: 0,
    base: { ...SCENARIO_TEMPLATE.base, name: llmOutput.base_name || '', description: llmOutput.base_desc || '' },
    bull: { ...SCENARIO_TEMPLATE.bull, name: llmOutput.bull_name || '', description: llmOutput.bull_desc || '' },
    bear: { ...SCENARIO_TEMPLATE.bear, name: llmOutput.bear_name || '', description: llmOutput.bear_desc || '' },
  };
}
