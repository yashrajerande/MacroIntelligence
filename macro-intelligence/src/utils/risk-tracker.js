/**
 * Risk Streak Tracker — makes "Top Risk Now" persistence visible instead
 * of silently repeating.
 *
 * The problem this solves: snapRisk used to be `signals.data.find(s =>
 * s.status === 'risk')` — the FIRST array element tagged 'risk', not the
 * most severe one. Since Sig1 is always the CREDIT CYCLE theme and India's
 * CD ratio is a slow-moving structural indicator, it tends to stay in
 * 'risk' status for months, so it almost always won the slot regardless
 * of what else was happening that day. render.js now ranks risk-status
 * signals by severity instead (distance from the 50th percentile).
 *
 * That alone doesn't make a genuinely persistent risk feel more credible
 * to a reader — it just changes WHY it repeats. So this tracker records
 * which theme wins each day and reports the streak length, so the
 * dashboard can say "persisting 14 days" instead of leaving the reader to
 * wonder if the number is stale or the system forgot to re-check it.
 *
 * File persisted at output/risk-history.json (committed like
 * cost-ledger.json / hook-history.json / data-cache.json).
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const HISTORY_PATH = join(ROOT, 'output', 'risk-history.json');
const MAX_ENTRIES = 60;

/**
 * Pure ranking logic — no I/O, fully unit-testable.
 * Ranks risk-status signals by severity (distance from the 50th
 * percentile) instead of array position, so a slow-moving structural
 * risk (always Sig1/CREDIT CYCLE in the fixed theme order) doesn't
 * automatically win just because it sits first in the list.
 * @param {Array} signalsData — the 7 signal cards
 * @returns {{top: object, runnerUp: object|null} | null} — null if no
 *          signal is tagged 'risk'.
 */
export function rankRiskSignals(signalsData) {
  const riskSignals = (signalsData || [])
    .filter(s => s.status === 'risk')
    .map((s, i) => ({ ...s, _severity: Math.abs((s.pct_10y ?? 50) - 50), _order: i }))
    .sort((a, b) => b._severity - a._severity || a._order - b._order);

  if (riskSignals.length === 0) return null;

  const top = riskSignals[0];
  const runnerUp = riskSignals.find(s => s.title !== top.title) || null;
  return { top, runnerUp };
}

/**
 * Classifies a percentile into a regime-style severity badge, matching
 * the badge_type/badge_label convention used by RegimeClassifier (b-exp/
 * b-slow/b-risk/b-neu) — the same "language, then numbers" pattern, so
 * the reader gets a classification word before the LLM's title, not just
 * a bare headline.
 * @param {number|undefined} pct10y
 */
export function classifyRiskSeverity(pct10y) {
  const severity = Math.abs((pct10y ?? 50) - 50);
  if (severity >= 40) return { badge_type: 'b-risk', badge_label: 'Acute Risk' };
  if (severity >= 25) return { badge_type: 'b-slow', badge_label: 'Elevated Risk' };
  return { badge_type: 'b-neu', badge_label: 'Emerging Risk' };
}

function readHistory() {
  if (!existsSync(HISTORY_PATH)) return { history: [] };
  try {
    const raw = JSON.parse(readFileSync(HISTORY_PATH, 'utf-8'));
    return { history: Array.isArray(raw.history) ? raw.history : [] };
  } catch {
    return { history: [] };
  }
}

/**
 * Returns how many consecutive most-recent days (before today) the given
 * theme already won "Top Risk Now". 0 if it didn't win yesterday.
 * @param {string} theme — signal_theme of today's candidate
 */
export function getStreak(theme) {
  const { history } = readHistory();
  let streak = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].theme === theme) streak++;
    else break;
  }
  return streak;
}

/**
 * Record today's winning theme. Idempotent per date (re-running the same
 * day updates in place rather than double-counting the streak).
 */
export function recordTopRisk(date, theme, title) {
  const state = readHistory();
  const last = state.history[state.history.length - 1];
  if (last && last.date === date) {
    last.theme = theme;
    last.title = title;
  } else {
    state.history.push({ date, theme, title });
  }
  if (state.history.length > MAX_ENTRIES) {
    state.history = state.history.slice(-MAX_ENTRIES);
  }
  writeFileSync(HISTORY_PATH, JSON.stringify(state, null, 2), 'utf-8');
}
