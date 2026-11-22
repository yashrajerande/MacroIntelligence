/**
 * RunLogger — Structured run ledger for the CEO.
 * Tracks phases, agents, tokens, costs, and errors.
 * Output format matches Part XII specification.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { meter as defaultMeter, MODEL_PRICING_PER_MTOK, PRICING_SOURCE, ACCOUNTING_VERSION } from '../../src/utils/usage-meter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

// Base input/output cost per 1K tokens, derived from the single pricing
// table in src/utils/usage-meter.js (official list prices). Exported so a
// pre-flight test can assert every hardcoded model-ID literal used
// elsewhere in the codebase has a matching entry here.
//
// This table is only the FALLBACK for an agent whose calls did not go
// through the usage meter. Real run cost comes from the meter, which also
// prices cache writes (5m 1.25x / 1h 2x), cache reads (0.1x) and web
// searches ($10 per 1,000) — none of which input/output rates can see.
export const MODEL_COSTS = {
  ...Object.fromEntries(Object.entries(MODEL_PRICING_PER_MTOK).map(([id, r]) => [
    id, { input: r.input / 1000, output: r.output / 1000 },
  ])),
  'none': { input: 0, output: 0 },
};

function agentCost(model, tokens) {
  const rates = MODEL_COSTS[model] || MODEL_COSTS['none'];
  return (tokens.input / 1000) * rates.input + (tokens.output / 1000) * rates.output;
}

export class RunLogger {
  constructor(isoDate, { meter = defaultMeter } = {}) {
    this.isoDate = isoDate;
    this.meter = meter;
    // Cost reported by agents whose calls bypassed the meter (should be
    // none in production; kept so such a cost is never dropped).
    this._unmeteredUsd = 0;
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
    // Metered agents (every Anthropic call goes through the usage meter,
    // plus VoiceBroadcaster's OpenAI TTS charge) are costed from the
    // meter: that includes failed attempts that withRetry() repeated,
    // cache/search charges, and partial responses. The meta-based estimate
    // is only a fallback for an agent with no metered calls, and that
    // fallback is added to the run total separately so it is counted
    // exactly once.
    const metered = this.meter.hasChargesFor(name);
    const agentUsage = metered ? this.meter.summary(c => c.agent === name) : null;
    let cost;
    if (metered) {
      cost = Math.round(agentUsage.cost_usd * 100000) / 100000;
    } else {
      cost = typeof meta.cost_usd === 'number'
        ? Math.round(meta.cost_usd * 100000) / 100000
        : Math.round(agentCost(model, tokens) * 100000) / 100000;
      if (cost > 0) {
        this._unmeteredUsd += cost;
        this.warn(`Unmetered agent cost for ${name}`, `$${cost} estimated from meta (input/output only)`);
      }
    }

    // Per-agent entry
    this.log.agents[name] = {
      status: 'ok',
      model,
      latency_ms: latency,
      input_tokens: tokens.input,
      output_tokens: tokens.output,
      cost_usd: cost,
      ...(agentUsage ? {
        metered_calls: agentUsage.calls,
        cache_creation_input_tokens: agentUsage.cache_creation_input_tokens,
        cache_read_input_tokens: agentUsage.cache_read_input_tokens,
        web_search_requests: agentUsage.web_search_requests,
        ...(agentUsage.unknown_usage_calls ? { unknown_usage_calls: agentUsage.unknown_usage_calls } : {}),
      } : {}),
      // Additional metadata passed by agents (slots_filled, checks_passed, etc.)
      ...(meta.checks   ? { checks: meta.checks } : {}),
      ...(meta.rows     ? { rows_written: meta.rows } : {}),
      ...(meta.commit   ? { commit: meta.commit } : {}),
    };

    // Run totals are rebuilt from the meter in _syncCostSummary(); only
    // the unmetered fallback needs tracking here.

    const tokenStr = `${tokens.input}in/${tokens.output}out`;
    const costStr  = cost > 0 ? ` — $${cost.toFixed(4)}` : '';
    console.log(`  ✓ ${name} — ${latency}ms — ${tokenStr}${costStr}`);
  }

  /** Record validation results */
  validation(result) {
    this.log.validation = {
      // Layers can push one error per indicator, so clamp at 0 — this
      // used to go negative past 22 errors.
      checks_passed: Math.max(0, 22 - result.errors.length),
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

  /** Known run spend so far: every metered charge + unmetered fallbacks. */
  estimateCost() {
    return Math.round((this.meter.summary().cost_usd + this._unmeteredUsd) * 10000) / 10000;
  }

  /** Ledger `details` for this run (status set by the caller). */
  costDetails(status) {
    const s = this.meter.summary();
    return {
      status,
      pipeline: 'daily',
      cost_complete: s.cost_complete,
      unknown_usage_calls: s.unknown_usage_calls,
      lower_bound_calls: s.lower_bound_calls,
      cost_is_lower_bound: s.cost_is_lower_bound,
      partial_calls: s.partial_calls,
      calls: s.calls,
      usage: {
        input_tokens: s.input_tokens,
        output_tokens: s.output_tokens,
        cache_creation_5m_input_tokens: s.cache_creation_5m_input_tokens,
        cache_creation_1h_input_tokens: s.cache_creation_1h_input_tokens,
        cache_read_input_tokens: s.cache_read_input_tokens,
        web_search_requests: s.web_search_requests,
      },
      ...(this._unmeteredUsd > 0 ? { unmetered_usd: Math.round(this._unmeteredUsd * 100000) / 100000 } : {}),
    };
  }

  _syncCostSummary() {
    const s = this.meter.summary();
    this.log.cost_summary = {
      accounting_version: ACCOUNTING_VERSION,
      pricing_source: PRICING_SOURCE,
      total_input_tokens: s.input_tokens,
      total_output_tokens: s.output_tokens,
      total_cache_creation_input_tokens: s.cache_creation_input_tokens,
      total_cache_creation_5m_input_tokens: s.cache_creation_5m_input_tokens,
      total_cache_creation_1h_input_tokens: s.cache_creation_1h_input_tokens,
      total_cache_read_input_tokens: s.cache_read_input_tokens,
      total_web_search_requests: s.web_search_requests,
      total_cost_usd: this.estimateCost(),
      cost_complete: s.cost_complete,
      unknown_usage_calls: s.unknown_usage_calls,
      lower_bound_calls: s.lower_bound_calls,
      cost_is_lower_bound: s.cost_is_lower_bound,
      partial_calls: s.partial_calls,
      metered_calls: s.calls,
      unmetered_usd: Math.round(this._unmeteredUsd * 100000) / 100000,
      model_breakdown: s.by_model,
      agent_breakdown: s.by_agent,
    };
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

    this._syncCostSummary();

    this._writeLog();

    console.log(`\n═══════════════════════════════════════════════════════════`);
    console.log(`  Run Complete: SUCCESS`);
    console.log(`  Duration: ${this.log.duration_seconds}s`);
    console.log(`  Tokens: ${this.log.cost_summary.total_input_tokens}in / ${this.log.cost_summary.total_output_tokens}out`);
    console.log(`  Cache: ${this.log.cost_summary.total_cache_creation_input_tokens} write / ${this.log.cost_summary.total_cache_read_input_tokens} read · Web searches: ${this.log.cost_summary.total_web_search_requests}`);
    console.log(`  Estimated Cost: $${this.log.cost_summary.total_cost_usd}${this.log.cost_summary.cost_complete ? '' : ` (LOWER BOUND: ${this.log.cost_summary.unknown_usage_calls} call(s) with UNKNOWN usage, ${this.log.cost_summary.lower_bound_calls} partial)`}`);
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
    this._syncCostSummary();
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
