/**
 * Usage Meter — the single source of truth for what a pipeline run spent.
 *
 * Every Anthropic response is charged HERE, at the response boundary
 * (see metered-claude.js), before any agent code gets a chance to parse
 * the text and throw. A parse failure, a max_tokens truncation, an
 * exhausted retry or a downstream crash therefore can no longer make
 * billed tokens vanish from the ledger.
 *
 * What a charge prices (official list prices, see PRICING_SOURCE):
 *   - input_tokens                     × base input
 *   - cache_creation (5-minute TTL)    × base input × 1.25
 *   - cache_creation (1-hour TTL)      × base input × 2
 *   - cache_read_input_tokens          × base input × 0.1
 *   - output_tokens                    × output
 *   - server_tool_use.web_search_requests × $10 / 1,000
 * input_tokens, cache_creation_input_tokens and cache_read_input_tokens
 * are disjoint in the API's usage object, so summing them never double
 * counts. Search-result tokens are already inside the token counts; the
 * per-search fee is the only extra.
 *
 * Charges are de-duplicated by charge_id (the Anthropic message id for
 * model calls), so the same response can never be counted twice — not
 * on a retry, not on success, not on a failure path that re-records.
 *
 * Usage that cannot be recovered (connection dropped before any usage
 * arrived, client-side timeout, a response with absent/null/empty usage)
 * is recorded as an UNKNOWN charge: cost_usd = null, cost_known = false.
 * Missing usage is never treated as zero usage. Usage that was only
 * partly observed (a stream that broke or is still in progress, or a
 * usage object without input or output counts) is priced as a LOWER
 * BOUND (lower_bound = true), and any run containing one reports
 * cost_complete = false.
 *
 * When a journal path is attached, every charge — including each
 * in-progress stream observation (message_start, message_delta) — is
 * appended synchronously to a JSONL file, replaced cumulatively per
 * message id on replay. persist-cost-ledger.js replays it when a job
 * fails. Limits: an observation is only on disk once its event has been
 * received and appended; output generated after the last received event
 * is not in the journal. If the runner itself disappears, or GitHub does
 * not run the post-failure step (e.g. a job-level timeout), nothing
 * replays the journal and that run's spend is NOT recovered.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'fs';
import { dirname } from 'path';
import { randomUUID } from 'crypto';

export const ACCOUNTING_VERSION = 2;

export const PRICING_SOURCE = 'https://platform.claude.com/docs/en/about-claude/pricing';
export const PRICING_VERIFIED_ON = '2026-11-22';

// USD per million tokens (base rates, Claude API first-party, global routing).
export const MODEL_PRICING_PER_MTOK = Object.freeze({
  'claude-haiku-4-5-20251001': Object.freeze({ input: 1.00, output: 5.00 }),
  'claude-haiku-4-5':          Object.freeze({ input: 1.00, output: 5.00 }),
  'claude-sonnet-4-6':         Object.freeze({ input: 3.00, output: 15.00 }),
});

// Multipliers on the base input price. Cache reads are 0.1x for every
// model priced above (the 0.05x / 0.025x tiers only apply to newer
// models this codebase does not call).
export const CACHE_MULTIPLIERS = Object.freeze({ write_5m: 1.25, write_1h: 2.0, read: 0.1 });

export const WEB_SEARCH_USD_PER_REQUEST = 10 / 1000;

const round6 = x => Math.round(x * 1e6) / 1e6;
const nonNeg = v => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/**
 * Normalize an Anthropic `usage` object (Messages API or a merged stream
 * snapshot) into the flat shape the meter prices. Returns null when
 * there is no usage object at all.
 *
 * Cache-write TTL: when the API supplies `usage.cache_creation`
 * ({ ephemeral_5m_input_tokens, ephemeral_1h_input_tokens }) that split
 * is used. Any cache-write tokens not covered by the split are priced at
 * the 5-minute rate — the API default TTL, and the only TTL this
 * codebase requests (`cache_control: { type: 'ephemeral' }`). The
 * cache_ttl_source field records which case applied.
 */
//
// Missing usage is NOT zero usage. Returns null (→ priced as UNKNOWN) when
// the object is absent, null, empty, or carries no token/search count at
// all. When some counts are present but input_tokens or output_tokens is
// missing, the result has usage_complete = false and its price is only a
// LOWER BOUND.
const USAGE_COUNT_FIELDS = ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'];
const isCount = v => typeof v === 'number' && Number.isFinite(v) && v >= 0;

export function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const observed = USAGE_COUNT_FIELDS.some(k => isCount(usage[k]))
    || isCount(usage.server_tool_use?.web_search_requests);
  if (!observed) return null;
  const usageComplete = isCount(usage.input_tokens) && isCount(usage.output_tokens);

  const cacheCreationTotal = nonNeg(usage.cache_creation_input_tokens);
  let w5 = 0;
  let w1 = 0;
  let ttlSource = 'none';
  const cc = usage.cache_creation;
  if (cc && typeof cc === 'object') {
    w5 = nonNeg(cc.ephemeral_5m_input_tokens);
    w1 = nonNeg(cc.ephemeral_1h_input_tokens);
    if (w5 + w1 > 0) ttlSource = 'api_breakdown';
  }
  const split = w5 + w1;
  const total = Math.max(cacheCreationTotal, split);
  const unattributed = total - split;
  if (unattributed > 0) {
    w5 += unattributed;
    ttlSource = split > 0 ? 'api_breakdown+default_5m' : 'default_5m';
  }

  const stu = usage.server_tool_use && typeof usage.server_tool_use === 'object' ? usage.server_tool_use : {};

  return {
    input_tokens: nonNeg(usage.input_tokens),
    output_tokens: nonNeg(usage.output_tokens),
    cache_creation_input_tokens: total,
    cache_creation_5m_input_tokens: w5,
    cache_creation_1h_input_tokens: w1,
    cache_read_input_tokens: nonNeg(usage.cache_read_input_tokens),
    web_search_requests: nonNeg(stu.web_search_requests),
    web_fetch_requests: nonNeg(stu.web_fetch_requests),
    cache_ttl_source: ttlSource,
    usage_complete: usageComplete,
  };
}

/**
 * Merge streaming usage. Every numeric field in a message_delta `usage`
 * is CUMULATIVE for the message, so a later non-null value replaces the
 * earlier one (never adds to it). Null/undefined fields leave the earlier
 * value in place. Nested objects (server_tool_use, cache_creation) merge
 * the same way, key by key.
 */
export function mergeUsage(base, update) {
  const out = base && typeof base === 'object' ? { ...base } : {};
  if (!update || typeof update !== 'object') return out;
  for (const [k, v] of Object.entries(update)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'object' && !Array.isArray(v)) {
      out[k] = mergeUsage(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Price normalized usage. Unknown model or no observed usage →
 * cost_known = false and cost_usd = null (never a silent $0). Incomplete
 * usage (input or output count missing) → a known amount flagged
 * lower_bound = true.
 */
export function costOfUsage(model, norm) {
  const rates = MODEL_PRICING_PER_MTOK[model];
  if (!norm) return { cost_usd: null, cost_known: false, lower_bound: false, reason: 'no_usage' };
  if (!rates) return { cost_usd: null, cost_known: false, lower_bound: false, reason: `unpriced_model:${model}` };
  const perTok = rates.input / 1e6;
  const components = {
    input: norm.input_tokens * perTok,
    cache_write_5m: norm.cache_creation_5m_input_tokens * perTok * CACHE_MULTIPLIERS.write_5m,
    cache_write_1h: norm.cache_creation_1h_input_tokens * perTok * CACHE_MULTIPLIERS.write_1h,
    cache_read: norm.cache_read_input_tokens * perTok * CACHE_MULTIPLIERS.read,
    output: norm.output_tokens * (rates.output / 1e6),
    web_search: norm.web_search_requests * WEB_SEARCH_USD_PER_REQUEST,
  };
  const total = Object.values(components).reduce((s, x) => s + x, 0);
  for (const k of Object.keys(components)) components[k] = round6(components[k]);
  return { cost_usd: round6(total), cost_known: true, lower_bound: norm.usage_complete === false, components };
}

/**
 * Was a failed Anthropic request billed? An error that carries an HTTP
 * status came back as an error response before generation (429, 529, 4xx,
 * 5xx) — the API does not bill those. Anything else (connection reset,
 * client timeout, abort, an SSE error after the request was accepted)
 * may have been processed: its usage is unknown.
 */
export function failureIsUnbilled(err) {
  return !!err && typeof err.status === 'number' && err.status >= 400;
}

export class UsageMeter {
  constructor({ runId = null, isoDate = null, pipeline = null, journalPath = null } = {}) {
    this._charges = new Map();
    this._als = new AsyncLocalStorage();
    this.run = { runId, isoDate, pipeline };
    this.journalPath = journalPath;
  }

  /** Bind this meter to a run and (optionally) a crash-safe journal file. */
  attachRun({ runId, isoDate, pipeline, journalPath = null }) {
    this.run = { runId, isoDate, pipeline };
    this.journalPath = journalPath;
    if (journalPath) {
      try { mkdirSync(dirname(journalPath), { recursive: true }); } catch { /* best effort */ }
      // Replay anything already journaled for this path (a resumed
      // process) so the in-memory total and the journal agree.
      for (const c of readJournal(journalPath)) {
        if (c.run_id !== runId) continue;
        const prev = this._charges.get(c.charge_id);
        if (!prev || prev.partial) this._charges.set(c.charge_id, c);
      }
    }
  }

  /** Run fn with every charge inside it attributed to `agent`. */
  runAs(agent, fn) {
    return this._als.run({ agent }, fn);
  }

  currentAgent() {
    return this._als.getStore()?.agent || null;
  }

  _store(charge) {
    const existing = this._charges.get(charge.charge_id);
    // One charge per message id, replaced cumulatively: a later observation
    // (in-progress stream usage, then the final or broken-stream record)
    // REPLACES the earlier one — usage counts are cumulative, never added.
    // Once a final (non-partial) record exists it is never replaced, so a
    // re-charge of the same response is a no-op.
    if (existing && !existing.partial) return existing;
    if (existing && sameCharge(existing, charge)) return existing;
    this._charges.set(charge.charge_id, charge);
    if (this.journalPath) {
      try {
        appendFileSync(this.journalPath, JSON.stringify({
          v: ACCOUNTING_VERSION,
          run_id: this.run.runId,
          iso_date: this.run.isoDate,
          pipeline: this.run.pipeline,
          ...charge,
        }) + '\n', 'utf-8');
      } catch (err) {
        console.warn(`  ⚠ cost journal append failed: ${err.message}`);
      }
    }
    return charge;
  }

  /**
   * Charge a model response. partial = true for in-progress stream
   * observations and broken streams: the amount is then a LOWER BOUND
   * (output and searches after the last observed event are not included).
   */
  chargeResponse({ model, usage, responseId = null, agent = null, partial = false, note = null }) {
    const norm = normalizeUsage(usage);
    const priced = costOfUsage(model, norm);
    return this._store({
      charge_id: responseId || `anon-${randomUUID()}`,
      kind: 'anthropic',
      agent: agent || this.currentAgent() || 'unattributed',
      model,
      usage: norm,
      cost_usd: priced.cost_usd,
      cost_known: priced.cost_known,
      lower_bound: priced.cost_known && (!!partial || priced.lower_bound),
      ...(priced.components ? { components: priced.components } : {}),
      ...(priced.cost_known ? {} : { unknown_reason: priced.reason }),
      partial: !!partial,
      ...(note ? { note: String(note).slice(0, 300) } : {}),
      ts: new Date().toISOString(),
    });
  }

  /** A call that may have been billed but whose usage is unrecoverable. */
  chargeUnknown({ model, agent = null, reason, provider = 'anthropic' }) {
    return this._store({
      charge_id: `unknown-${randomUUID()}`,
      kind: provider,
      agent: agent || this.currentAgent() || 'unattributed',
      model,
      usage: null,
      cost_usd: null,
      cost_known: false,
      unknown_reason: String(reason || 'usage_unavailable').slice(0, 300),
      partial: false,
      ts: new Date().toISOString(),
    });
  }

  /** Non-Anthropic spend priced by the caller (e.g. OpenAI TTS). */
  chargeExternal({ provider, model, cost_usd, agent = null, chargeId = null, detail = null }) {
    const known = typeof cost_usd === 'number' && Number.isFinite(cost_usd);
    return this._store({
      charge_id: chargeId || `${provider}-${randomUUID()}`,
      kind: provider,
      agent: agent || this.currentAgent() || 'unattributed',
      model,
      usage: detail,
      cost_usd: known ? round6(cost_usd) : null,
      cost_known: known,
      ...(known ? {} : { unknown_reason: 'external_cost_unavailable' }),
      partial: false,
      ts: new Date().toISOString(),
    });
  }

  charges() {
    return [...this._charges.values()];
  }

  hasChargesFor(agent) {
    for (const c of this._charges.values()) if (c.agent === agent) return true;
    return false;
  }

  summary(filter = null) {
    return summarizeCharges(filter ? this.charges().filter(filter) : this.charges());
  }

  costForAgent(agent) {
    return this.summary(c => c.agent === agent).cost_usd;
  }
}

/** Aggregate a list of charges. Unknown charges are counted, never priced. */
// cost_usd sums every KNOWN amount (complete charges + lower-bound partial
// charges). cost_complete is false whenever any charge is unknown or a
// lower bound — cost_usd is then itself only a lower bound on real spend.
export function summarizeCharges(charges) {
  const s = {
    accounting_version: ACCOUNTING_VERSION,
    calls: 0,
    cost_usd: 0,
    cost_complete: true,
    cost_is_lower_bound: false,
    unknown_usage_calls: 0,
    lower_bound_calls: 0,
    partial_calls: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_creation_5m_input_tokens: 0,
    cache_creation_1h_input_tokens: 0,
    cache_read_input_tokens: 0,
    web_search_requests: 0,
    by_model: {},
    by_agent: {},
  };
  for (const c of charges) {
    s.calls++;
    if (c.partial) s.partial_calls++;
    if (!c.cost_known) { s.unknown_usage_calls++; s.cost_complete = false; }
    else if (c.lower_bound) { s.lower_bound_calls++; s.cost_complete = false; }
    const cost = c.cost_known ? c.cost_usd : 0;
    s.cost_usd += cost;
    if (c.kind === 'anthropic' && c.usage) {
      for (const k of ['input_tokens', 'output_tokens', 'cache_creation_input_tokens',
        'cache_creation_5m_input_tokens', 'cache_creation_1h_input_tokens',
        'cache_read_input_tokens', 'web_search_requests']) {
        s[k] += c.usage[k] || 0;
      }
    }
    const mKey = c.kind === 'anthropic' ? c.model : `${c.kind}:${c.model}`;
    const m = (s.by_model[mKey] ||= { calls: 0, cost_usd: 0, unknown_usage_calls: 0 });
    m.calls++; m.cost_usd += cost; if (!c.cost_known) m.unknown_usage_calls++;
    const a = (s.by_agent[c.agent] ||= { calls: 0, cost_usd: 0, unknown_usage_calls: 0 });
    a.calls++; a.cost_usd += cost; if (!c.cost_known) a.unknown_usage_calls++;
  }
  s.cost_usd = round6(s.cost_usd);
  s.cost_is_lower_bound = !s.cost_complete;
  for (const m of Object.values(s.by_model)) m.cost_usd = round6(m.cost_usd);
  for (const a of Object.values(s.by_agent)) a.cost_usd = round6(a.cost_usd);
  return s;
}

/** Read a JSONL journal. Malformed lines (a write cut off by a kill) are skipped. */
export function readJournal(path) {
  if (!path || !existsSync(path)) return [];
  const out = [];
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* torn final line */ }
  }
  return out;
}

function sameCharge(a, b) {
  const strip = ({ ts, ...rest }) => rest;
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}

/**
 * Collapse journal lines into one ledger-ready summary per run_id, using
 * the same rule as UsageMeter._store: per charge_id the LAST partial
 * observation replaces earlier ones (cumulative, never summed) until a
 * final record appears, which then wins over anything later.
 */
export function runsFromJournal(lines) {
  const byRun = new Map();
  for (const l of lines) {
    if (!l || !l.run_id || !l.charge_id) continue;
    const r = byRun.get(l.run_id) || { run_id: l.run_id, iso_date: l.iso_date, pipeline: l.pipeline, charges: new Map() };
    const prev = r.charges.get(l.charge_id);
    if (!prev || prev.partial) r.charges.set(l.charge_id, l);
    byRun.set(l.run_id, r);
  }
  return [...byRun.values()].map(r => ({
    run_id: r.run_id,
    iso_date: r.iso_date,
    pipeline: r.pipeline,
    summary: summarizeCharges([...r.charges.values()]),
  }));
}

// Process-wide meter used by the pipelines.
export const meter = new UsageMeter();
