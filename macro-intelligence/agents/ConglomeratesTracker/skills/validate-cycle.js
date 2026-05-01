/**
 * Cycle output validator. Boundary check between StrategyAdvisor (untrusted)
 * and Publisher (trusted). Fails fast with a structured error list so the
 * orchestrator can decide whether to revise or abort — never publishes a
 * partial report.
 *
 * Aligns with Best Practice #7 (Validate at the Boundary, Trust Internally)
 * and #6 (Hard Rules Fire First — deterministic checks before LLM judgment).
 */

import { UNIVERSE } from './universe.js';

const REQUIRED_TOP_KEYS = [
  'cycle_label', 'window_start', 'window_end',
  'moves',
  'power_dashboard', 'power_map',
  'debt_wall', 'execution_receipts', 'momentum',
  'future_dominance', 'control_map',
  'ranking', 'typology',
  'red_flags', 'emerging_themes', 'bottom_line',
];

const TIER_KEYS = ['tier1', 'tier2', 'tier3', 'tier4'];

const TYPOLOGY_KEYS = [
  'platform_empires', 'institutional_builders', 'industrial_scalers',
  'capital_allocators', 'southern_compounders', 'fragile_leveraged',
];

const SCORE_FIELDS_DASH = ['vision','talent','exec','trust','access','edge','capital'];

function inRange(n, lo, hi) {
  return typeof n === 'number' && n >= lo && n <= hi;
}

export function validateCycleOutput(data) {
  const errors = [];

  // Top-level keys present
  for (const k of REQUIRED_TOP_KEYS) {
    if (!(k in data)) errors.push(`missing top-level key: ${k}`);
  }
  if (errors.length) return { valid: false, errors };

  // Universe coverage in scored tables
  const tablesNeedingFullUniverse = [
    'power_dashboard', 'power_map',
    'debt_wall', 'execution_receipts', 'momentum',
    'future_dominance', 'control_map',
  ];
  for (const tbl of tablesNeedingFullUniverse) {
    const groups = new Set((data[tbl] || []).map(r => r.group));
    const missing = UNIVERSE.filter(g => !groups.has(g));
    if (missing.length) errors.push(`${tbl}: missing groups → ${missing.join(', ')}`);
  }

  // Power dashboard score ranges 1-10
  for (const r of data.power_dashboard || []) {
    for (const f of SCORE_FIELDS_DASH) {
      if (!inRange(r[f]?.score, 1, 10)) {
        errors.push(`power_dashboard[${r.group}].${f}.score out of range (expected 1-10)`);
      }
    }
  }

  // Momentum -5..+5
  for (const r of data.momentum || []) {
    if (!inRange(r.score, -5, 5)) {
      errors.push(`momentum[${r.group}].score out of -5..5 range`);
    }
  }

  // Debt wall, execution receipts, future dominance: 0..10
  const zeroToTen = ['debt_wall', 'execution_receipts', 'future_dominance'];
  for (const tbl of zeroToTen) {
    for (const r of data[tbl] || []) {
      if (!inRange(r.score, 0, 10)) {
        errors.push(`${tbl}[${r.group}].score out of 0..10 range`);
      }
    }
  }

  // Power map fields 1..10
  for (const r of data.power_map || []) {
    for (const f of ['political','capital_markets','control_stability','global','ai_energy']) {
      if (!inRange(r[f], 1, 10)) {
        errors.push(`power_map[${r.group}].${f} out of 1..10`);
      }
    }
  }

  // Control map fields 1..10
  for (const r of data.control_map || []) {
    for (const f of ['promoter','succession','board','partners','political']) {
      if (!inRange(r[f], 1, 10)) {
        errors.push(`control_map[${r.group}].${f} out of 1..10`);
      }
    }
  }

  // Ranking — every group placed exactly once
  const ranking = data.ranking || {};
  const placements = TIER_KEYS.flatMap(k => (ranking[k] || []).map(r => r.group));
  const dupes = placements.filter((g, i) => placements.indexOf(g) !== i);
  if (dupes.length) errors.push(`ranking has duplicates: ${[...new Set(dupes)].join(', ')}`);
  const unplaced = UNIVERSE.filter(g => !placements.includes(g));
  if (unplaced.length) errors.push(`ranking missing groups: ${unplaced.join(', ')}`);

  // Typology — every group in exactly one bucket
  const typology = data.typology || {};
  const typed = TYPOLOGY_KEYS.flatMap(k => typology[k] || []);
  const tdupes = typed.filter((g, i) => typed.indexOf(g) !== i);
  if (tdupes.length) errors.push(`typology has duplicates: ${[...new Set(tdupes)].join(', ')}`);
  const untyped = UNIVERSE.filter(g => !typed.includes(g));
  if (untyped.length) errors.push(`typology missing groups: ${untyped.join(', ')}`);

  // Bottom-line view: 5-7 bullets per the master prompt
  if (!Array.isArray(data.bottom_line) || data.bottom_line.length < 5 || data.bottom_line.length > 7) {
    errors.push(`bottom_line must have 5-7 bullets (got ${data.bottom_line?.length ?? 0})`);
  }

  // Emerging themes: 3-5 per the master prompt
  if (!Array.isArray(data.emerging_themes) || data.emerging_themes.length < 3 || data.emerging_themes.length > 5) {
    errors.push(`emerging_themes must have 3-5 entries (got ${data.emerging_themes?.length ?? 0})`);
  }

  return { valid: errors.length === 0, errors };
}
