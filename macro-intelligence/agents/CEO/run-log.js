/**
 * RunLogger — Structured run ledger for the CEO.
 * Tracks phases, agents, tokens, costs, and errors.
 * Output format matches Part XII specification.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

// Cost per 1K tokens (as of 2026)
const MODEL_COSTS = {
  'claude-haiku-4-5-20251001': { input: 0.0008, output: 0.001 },
  'claude-sonnet-4-6':         { input: 0.003,  output: 0.015 },
  'none':                      { input: 0,      output: 0 },
};

function agentCost(model, tokens) {
  const rates = MODEL_COSTS[model] || MODEL_COSTS['none'];
  return (tokens.input / 1000) * rates.input + (tokens.output / 1000) * rates.output;
}

export class RunLogger {
  constructor(isoDate) {
    this.isoDate = isoDate;
    this.startTime = null;
    this.currentPhase = null;

    this.log = {
      run_id: randomUUID(),
      run_date: isoDate,
      start_time: null,
      end_time: null,
      duration_seconds: 0,
      status: 'running',
      phases: {},
      agents: {},
      cost_summary: {
        total_input_tokens: 0,
        total_output_tokens: 0,
        total_cost_usd: 0,
        model_breakdown: {},
      },
      validation: {
        checks_passed: 0,
        errors: [],
        warnings: [],
      },
      output_file: null,
      supabase_run_id: null,
      errors: [],
      warnings: [],
    };
  }

  start(dateStr) {
    this.startTime = Date.now();
    this.log.start_time = new Date().toISOString();
    console.log(`\n═══════════════════════════════════════════════════════════`);
    console.log(`  MacroIntelligence Corp — Daily Run: ${dateStr}`);
    console.log(`  Run ID: ${this.log.run_id}`);
    console.log(`  Started: ${this.log.start_time}`);
    console.log(`═══════════════════════════════════════════════════════════\n`);
  }

  phase(name) {
    // Close the previous phase
    if (this.currentPhase && this.log.phases[this.currentPhase]) {
      const p = this.log.phases[this.currentPhase];
      p.end = new Date().toISOString();
      p.duration_ms = Date.now() - p._startMs;
      delete p._startMs;
    }

    // Open new phase
    this.currentPhase = name;
    this.log.phases[name] = {
      start: new Date().toISOString(),
      end: null,
      duration_ms: 0,
      _startMs: Date.now(),
    };

    console.log(`\n── Phase: ${name} ──────────────────────────────────────────`);
  }

  agent(name, meta) {
    const model    = meta.model || 'none';
    const tokens   = meta.tokens || { input: 0, output: 0 };
    const latency  = meta.latency_ms || 0;
    const cost     = Math.round(agentCost(model, tokens) * 100000) / 100000;

    // Per-agent entry
    this.log.agents[name] = {
      status: 'ok',
      model,
      latency_ms: latency,
      input_tokens: tokens.input,
      output_tokens: tokens.output,
      cost_usd: cost,
      // Additional metadata passed by agents (slots_filled, checks_passed, etc.)
      ...(meta.checks   ? { checks: meta.checks } : {}),
      ...(meta.rows     ? { rows_written: meta.rows } : {}),
      ...(meta.commit   ? { commit: meta.commit } : {}),
    };

    // Accumulate cost summary
    this.log.cost_summary.total_input_tokens  += tokens.input;
    this.log.cost_summary.total_output_tokens += tokens.output;
    this.log.cost_summary.total_cost_usd      += cost;

    // Model breakdown
    if (model !== 'none') {
      if (!this.log.cost_summary.model_breakdown[model]) {
        this.log.cost_summary.model_breakdown[model] = { calls: 0, cost_usd: 0 };
      }
      this.log.cost_summary.model_breakdown[model].calls += 1;
      this.log.cost_summary.model_breakdown[model].cost_usd += cost;
    }

    const tokenStr = `${tokens.input}in/${tokens.output}out`;
    const costStr  = cost > 0 ? ` — $${cost.toFixed(4)}` : '';
    console.log(`  ✓ ${name} — ${latency}ms — ${tokenStr}${costStr}`);
  }

  /** Record validation results */
  validation(result) {
    this.log.validation = {
      checks_passed: result.errors.length === 0 ? 22 : 22 - result.errors.length,
      errors: result.errors,
      warnings: result.warnings,
    };
  }

  /** Set the output file path */
  setOutputFile(filepath) {
    this.log.output_file = filepath;
  }

  /** Set the Supabase run_id after sync */
  setSupabaseRunId(id) {
    this.log.supabase_run_id = id;
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
    return Math.round(this.log.cost_summary.total_cost_usd * 10000) / 10000;
  }

  complete(extra = {}) {
    // Close last phase
    if (this.currentPhase && this.log.phases[this.currentPhase]) {
      const p = this.log.phases[this.currentPhase];
      p.end = new Date().toISOString();
      p.duration_ms = Date.now() - p._startMs;
      delete p._startMs;
    }

    this.log.end_time = new Date().toISOString();
    this.log.status = 'success';
    this.log.duration_seconds = Math.round((Date.now() - this.startTime) / 1000);

    // Round model breakdown costs
    for (const m of Object.values(this.log.cost_summary.model_breakdown)) {
      m.cost_usd = Math.round(m.cost_usd * 100000) / 100000;
    }
    this.log.cost_summary.total_cost_usd = this.estimateCost();

    this._writeLog();

    console.log(`\n═══════════════════════════════════════════════════════════`);
    console.log(`  Run Complete: SUCCESS`);
    console.log(`  Duration: ${this.log.duration_seconds}s`);
    console.log(`  Tokens: ${this.log.cost_summary.total_input_tokens}in / ${this.log.cost_summary.total_output_tokens}out`);
    console.log(`  Estimated Cost: $${this.log.cost_summary.total_cost_usd}`);
    console.log(`  Validation: ${this.log.validation.checks_passed}/22 passed, ${this.log.validation.warnings.length} warnings`);
    console.log(`═══════════════════════════════════════════════════════════\n`);
  }

  fail(reason) {
    // Close last phase
    if (this.currentPhase && this.log.phases[this.currentPhase]) {
      const p = this.log.phases[this.currentPhase];
      p.end = new Date().toISOString();
      p.duration_ms = Date.now() - (p._startMs || Date.now());
      delete p._startMs;
    }

    this.log.end_time = new Date().toISOString();
    this.log.status = 'failed';
    this.log.failure_reason = reason;
    this.log.duration_seconds = Math.round((Date.now() - this.startTime) / 1000);
    this.log.cost_summary.total_cost_usd = this.estimateCost();
    this._writeLog();
  }

  _writeLog() {
    const logsDir = join(ROOT, 'logs');
    mkdirSync(logsDir, { recursive: true });

    // Clean internal _startMs from any phases (safety net)
    for (const p of Object.values(this.log.phases)) {
      delete p._startMs;
    }

    const filename = this.log.status === 'success'
      ? `${this.isoDate}-run.json`
      : `${this.isoDate}-error.json`;

    const filepath = join(logsDir, filename);
    writeFileSync(filepath, JSON.stringify(this.log, null, 2), 'utf-8');
    console.log(`  Log written: ${filepath}`);
  }
}
