/**
 * Cost Ledger — Persistent monthly cost tracker.
 * Reads/writes cost-ledger.json in the output/ directory (committed to repo).
 * Enforces $5/month hard budget cap.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const LEDGER_PATH = join(ROOT, 'output', 'cost-ledger.json');

const MONTHLY_BUDGET_USD = 5.00;

function getMonthKey(isoDate) {
  return isoDate.slice(0, 7); // "2026-04"
}

function readLedger() {
  if (!existsSync(LEDGER_PATH)) {
    return { months: {}, lifetime_usd: 0 };
  }
  try {
    return JSON.parse(readFileSync(LEDGER_PATH, 'utf-8'));
  } catch {
    return { months: {}, lifetime_usd: 0 };
  }
}

function writeLedger(ledger) {
  writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2), 'utf-8');
}

/**
 * Get month-to-date spend.
 */
export function getMonthSpend(isoDate) {
  const ledger = readLedger();
  const key = getMonthKey(isoDate);
  const month = ledger.months[key];
  if (!month) return { runs: 0, cost_usd: 0 };
  return { runs: month.runs.length, cost_usd: month.total_usd };
}

/**
 * Check if running would exceed the monthly budget.
 * Returns { allowed, remaining_usd, month_spend_usd, budget_usd }
 */
export function checkBudget(isoDate, estimatedCost = 0.18) {
  const { cost_usd } = getMonthSpend(isoDate);
  const remaining = MONTHLY_BUDGET_USD - cost_usd;
  return {
    allowed: remaining >= estimatedCost,
    remaining_usd: Math.round(remaining * 100) / 100,
    month_spend_usd: Math.round(cost_usd * 100) / 100,
    budget_usd: MONTHLY_BUDGET_USD,
  };
}

/**
 * Record a completed run's cost.
 */
export function recordRunCost(isoDate, runCostUSD, runId) {
  const ledger = readLedger();
  const key = getMonthKey(isoDate);

  if (!ledger.months[key]) {
    ledger.months[key] = { total_usd: 0, runs: [] };
  }

  ledger.months[key].runs.push({
    date: isoDate,
    run_id: runId,
    cost_usd: Math.round(runCostUSD * 10000) / 10000,
    timestamp: new Date().toISOString(),
  });
  ledger.months[key].total_usd = Math.round(
    (ledger.months[key].total_usd + runCostUSD) * 10000
  ) / 10000;

  ledger.lifetime_usd = Math.round(
    Object.values(ledger.months).reduce((s, m) => s + m.total_usd, 0) * 10000
  ) / 10000;

  writeLedger(ledger);
  return ledger;
}

/**
 * Get cost summary string for the dashboard footer.
 */
export function getCostSummary(isoDate, thisRunCost) {
  const { cost_usd, runs } = getMonthSpend(isoDate);
  const mtd = Math.round((cost_usd + thisRunCost) * 100) / 100;
  return `Run: $${thisRunCost.toFixed(2)} · MTD: $${mtd.toFixed(2)}/$${MONTHLY_BUDGET_USD.toFixed(2)} · Runs: ${runs + 1}`;
}
