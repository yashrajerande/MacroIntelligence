/**
 * RunLogger — Structured run ledger for the CEO.
 * Tracks phases, agents, tokens, costs, and errors.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

// Cost per 1K tokens (approximate, as of 2026)
const MODEL_COSTS = {
  'claude-haiku-4-5-20251001': { input: 0.0008, output: 0.001 },
  'claude-sonnet-4-6':         { input: 0.003,  output: 0.015 },
  'none':                      { input: 0,      output: 0 },
};

export class RunLogger {
  constructor(isoDate) {
    this.isoDate = isoDate;
    this.startTime = null;
    this.log = {
      run_date: isoDate,
      started_at: null,
      completed_at: null,
      status: 'running',
      phases: [],
      agents: [],
      errors: [],
      warnings: [],
      total_tokens: { input: 0, output: 0 },
      estimated_cost_usd: 0,
    };
  }

  start(dateStr) {
    this.startTime = Date.now();
    this.log.started_at = new Date().toISOString();
    console.log(`\n═══════════════════════════════════════════════════════════`);
    console.log(`  MacroIntelligence Corp — Daily Run: ${dateStr}`);
    console.log(`  Started: ${this.log.started_at}`);
    console.log(`═══════════════════════════════════════════════════════════\n`);
  }

  phase(name) {
    console.log(`\n── Phase: ${name} ──────────────────────────────────────────`);
    this.log.phases.push({ name, started_at: new Date().toISOString() });
  }

  agent(name, meta) {
    const entry = {
      name,
      model: meta.model || 'none',
      latency_ms: meta.latency_ms || 0,
      tokens: meta.tokens || { input: 0, output: 0 },
      timestamp: new Date().toISOString(),
    };

    // Accumulate tokens
    this.log.total_tokens.input += (meta.tokens?.input || 0);
    this.log.total_tokens.output += (meta.tokens?.output || 0);

    this.log.agents.push(entry);

    const tokenStr = meta.tokens
      ? `${meta.tokens.input}in/${meta.tokens.output}out`
      : 'no tokens';
    console.log(`  ✓ ${name} — ${meta.latency_ms || 0}ms — ${tokenStr}`);
  }

  warn(message, detail) {
    this.log.warnings.push({ message, detail, timestamp: new Date().toISOString() });
    console.warn(`  ⚠ ${message}${detail ? ': ' + detail : ''}`);
  }

  error(message, detail, stack) {
    this.log.errors.push({ message, detail, stack, timestamp: new Date().toISOString() });
    console.error(`  ✗ ${message}${detail ? ': ' + detail : ''}`);
  }

  estimateCost() {
    let total = 0;
    for (const agent of this.log.agents) {
      const rates = MODEL_COSTS[agent.model] || MODEL_COSTS['none'];
      const cost = (agent.tokens.input / 1000) * rates.input
                 + (agent.tokens.output / 1000) * rates.output;
      total += cost;
    }
    return Math.round(total * 10000) / 10000;
  }

  complete(extra = {}) {
    this.log.completed_at = new Date().toISOString();
    this.log.status = 'success';
    this.log.estimated_cost_usd = extra.totalCostUSD || this.estimateCost();
    this.log.total_latency_ms = Date.now() - this.startTime;

    this._writeLog();

    console.log(`\n═══════════════════════════════════════════════════════════`);
    console.log(`  Run Complete: ${this.log.status.toUpperCase()}`);
    console.log(`  Duration: ${(this.log.total_latency_ms / 1000).toFixed(1)}s`);
    console.log(`  Tokens: ${this.log.total_tokens.input}in / ${this.log.total_tokens.output}out`);
    console.log(`  Estimated Cost: $${this.log.estimated_cost_usd}`);
    console.log(`  Warnings: ${this.log.warnings.length}`);
    console.log(`═══════════════════════════════════════════════════════════\n`);
  }

  fail(reason) {
    this.log.completed_at = new Date().toISOString();
    this.log.status = 'failed';
    this.log.failure_reason = reason;
    this.log.estimated_cost_usd = this.estimateCost();
    this.log.total_latency_ms = Date.now() - this.startTime;
    this._writeLog();
  }

  _writeLog() {
    const logsDir = join(ROOT, 'logs');
    mkdirSync(logsDir, { recursive: true });

    const filename = this.log.status === 'success'
      ? `${this.isoDate}-run.json`
      : `${this.isoDate}-error.json`;

    const filepath = join(logsDir, filename);
    writeFileSync(filepath, JSON.stringify(this.log, null, 2), 'utf-8');
    console.log(`  Log written: ${filepath}`);
  }
}
