/**
 * Cost Ledger — Persistent monthly cost tracker.
 * Reads/writes cost-ledger.json in the output/ directory (committed to repo).
 * Enforces $5/month hard budget cap.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ACCOUNTING_VERSION, PRICING_SOURCE, PRICING_VERIFIED_ON } from './usage-meter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
export const LEDGER_PATH = join(ROOT, 'output', 'cost-ledger.json');

const MONTHLY_BUDGET_USD = 5.00;

function getMonthKey(isoDate) {
  return isoDate.slice(0, 7); // "2026-04"
}

// Entries written before accounting v2 priced Haiku 4.5 at $0.80/$1 per
// MTok (correct: $1/$5) and ignored cache writes, cache reads and the
// $10/1k web-search fee; failed runs were only recorded on the runner's
// local disk. They are LABELED, never re-priced: there is no reliable
// usage record to backfill them from.
export const LEGACY_ACCOUNTING_NOTE =
  'Run entries labeled accounting="legacy_incomplete" predate accounting v2: they priced ' +
  'claude-haiku-4-5 at $0.80/$1 per MTok instead of $1/$5, omitted cache-write, cache-read and ' +
  'web-search ($10 per 1,000) charges, and failed runs were not persisted. They understate real ' +
  'spend and were deliberately not backfilled (no usage record exists to price them from).';

export function readLedger(ledgerPath = LEDGER_PATH) {
  if (!existsSync(ledgerPath)) {
    return { months: {}, lifetime_usd: 0 };
  }
  try {
    return JSON.parse(readFileSync(ledgerPath, 'utf-8'));
  } catch {
    return { months: {}, lifetime_usd: 0 };
  }
}

/** Label pre-v2 entries in place (idempotent; never changes amounts). */
export function labelLegacyEntries(ledger) {
  let legacy = 0;
  for (const m of Object.values(ledger.months || {})) {
    for (const r of m.runs || []) {
      if (!r.accounting_version) {
        if (r.accounting !== 'legacy_incomplete') r.accounting = 'legacy_incomplete';
        legacy++;
      }
    }
  }
  if (legacy > 0) ledger.accounting_notes = LEGACY_ACCOUNTING_NOTE;
  ledger.accounting = {
    version: ACCOUNTING_VERSION,
    pricing_source: PRICING_SOURCE,
    pricing_verified_on: PRICING_VERIFIED_ON,
  };
  return ledger;
}

export function writeLedger(ledger, ledgerPath = LEDGER_PATH) {
  labelLegacyEntries(ledger);
  writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2), 'utf-8');
}

const round4 = x => Math.round(x * 10000) / 10000;

/**
 * Upsert one run's cost into a ledger object (pure — no I/O). Keyed by
 * run_id: recording the same run twice (failure path after a success
 * record, a replayed journal, a re-run of the persist step) REPLACES its
 * entry rather than adding it again. Month totals move by the delta only,
 * so existing totals are never re-derived or rounded differently.
 *
 * @returns {boolean} true when the ledger changed
 */
export function upsertRunCost(ledger, isoDate, runCostUSD, runId, details = {}) {
  ledger.months ||= {};
  const key = getMonthKey(isoDate);
  const cost = round4(runCostUSD || 0);

  const entry = {
    date: isoDate,
    run_id: runId,
    cost_usd: cost,
    timestamp: new Date().toISOString(),
    accounting_version: ACCOUNTING_VERSION,
    ...details,
  };

  let previous = null;
  for (const [mk, m] of Object.entries(ledger.months)) {
    const idx = (m.runs || []).findIndex(r => r.run_id === runId);
    if (idx === -1) continue;
    previous = { mk, run: m.runs[idx] };
    if (sameEntry(m.runs[idx], entry)) return false;
    m.runs.splice(idx, 1);
    m.total_usd = round4(m.total_usd - (previous.run.cost_usd || 0));
    break;
  }

  if (!ledger.months[key]) ledger.months[key] = { total_usd: 0, runs: [] };
  ledger.months[key].runs.push(previous ? { ...entry, timestamp: previous.run.timestamp, updated_at: entry.timestamp } : entry);
  ledger.months[key].total_usd = round4(ledger.months[key].total_usd + cost);

  ledger.lifetime_usd = round4(
    Object.values(ledger.months).reduce((s, m) => s + m.total_usd, 0)
  );
  return true;
}

function sameEntry(a, b) {
  const strip = ({ timestamp, updated_at, ...rest }) => rest;
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}

/**
 * Get month-to-date spend.
 *
 * @param {string} [ledgerPath] — same override convention as
 * alreadyPublished()'s indexPath: production never passes this and gets
 * the real on-disk ledger; tests pass a temp-file path so an assertion
 * can never be at the mercy of however much this month has actually
 * spent when the suite happens to run.
 */
export function getMonthSpend(isoDate, ledgerPath = LEDGER_PATH) {
  const ledger = readLedger(ledgerPath);
  const key = getMonthKey(isoDate);
  const month = ledger.months[key];
  if (!month) return { runs: 0, cost_usd: 0 };
  return { runs: month.runs.length, cost_usd: month.total_usd };
}

/**
 * Check if running would exceed the monthly budget.
 * Returns { allowed, remaining_usd, month_spend_usd, budget_usd }
 */
export function checkBudget(isoDate, estimatedCost = 0.18, ledgerPath = LEDGER_PATH) {
  const { cost_usd } = getMonthSpend(isoDate, ledgerPath);
  const remaining = MONTHLY_BUDGET_USD - cost_usd;
  return {
    allowed: remaining >= estimatedCost,
    remaining_usd: Math.round(remaining * 100) / 100,
    month_spend_usd: Math.round(cost_usd * 100) / 100,
    budget_usd: MONTHLY_BUDGET_USD,
  };
}

/**
 * Record a run's cost (idempotent per run_id — see upsertRunCost).
 * `details` carries v2 accounting fields: status, pipeline,
 * cost_complete, unknown_usage_calls, usage breakdown.
 */
export function recordRunCost(isoDate, runCostUSD, runId, ledgerPath = LEDGER_PATH, details = {}) {
  const ledger = readLedger(ledgerPath);
  upsertRunCost(ledger, isoDate, runCostUSD, runId, details);
  writeLedger(ledger, ledgerPath);
  return ledger;
}

/**
 * Get cost summary string for the dashboard footer.
 */
export function getCostSummary(isoDate, thisRunCost, ledgerPath = LEDGER_PATH) {
  const { cost_usd, runs } = getMonthSpend(isoDate, ledgerPath);
  const mtd = Math.round((cost_usd + thisRunCost) * 100) / 100;
  return `Run: $${thisRunCost.toFixed(2)} · MTD: $${mtd.toFixed(2)}/$${MONTHLY_BUDGET_USD.toFixed(2)} · Runs: ${runs + 1}`;
}
