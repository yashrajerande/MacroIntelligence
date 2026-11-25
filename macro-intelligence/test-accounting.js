#!/usr/bin/env node
/**
 * Accounting test suite — zero API cost, zero network.
 *
 * Covers: current list pricing, cache (5m/1h/read) and web-search
 * charging, streaming-usage merge, response-boundary accounting on
 * parse/retry/stream failures, unknown-usage labelling, ledger
 * idempotence, failure-journal durability (against a local bare git
 * repo), ConglomeratesTracker record-before-publish ordering, and the
 * chat functions' pricing.
 *
 * Standalone: node test-accounting.js   (also run from test.js)
 */

import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, appendFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Mocks ─────────────────────────────────────────────────────────────

/**
 * Minimal stand-in for @anthropic-ai/sdk 0.39 MessageStream. Like the real
 * one, finalMessage()'s usage only picks up output_tokens from
 * message_delta — so server_tool_use / cache counts reported there are
 * lost unless the caller listens to the raw events.
 */
function mockStreamClient(script) {
  return {
    messages: {
      stream() {
        const listeners = [];
        return {
          on(ev, cb) { if (ev === 'streamEvent') listeners.push(cb); return this; },
          async finalMessage() {
            let snapshot = null;
            for (const ev of script.events || []) {
              if (ev.type === 'message_start') snapshot = JSON.parse(JSON.stringify(ev.message));
              if (ev.type === 'message_delta' && snapshot) snapshot.usage.output_tokens = ev.usage.output_tokens;
              for (const l of listeners) l(ev, snapshot);
            }
            if (script.throwAfterEvents) throw script.throwAfterEvents;
            snapshot.content = script.content || [{ type: 'text', text: script.text || '' }];
            snapshot.stop_reason = 'end_turn';
            return snapshot;
          },
        };
      },
      async create() {
        if (script.throw) throw script.throw;
        return script.response;
      },
    },
  };
}

const startEv = (id, usage) => ({ type: 'message_start', message: { id, type: 'message', role: 'assistant', model: 'x', content: [], stop_reason: null, usage } });
const deltaEv = usage => ({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage });

function sh(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

export async function runAccountingTests({ describe, assert }) {
  const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
  const U = await import('./src/utils/usage-meter.js');
  const { meteredStream, meteredCreate } = await import('./src/utils/metered-claude.js');
  const L = await import('./src/utils/cost-ledger.js');
  const P = await import('./src/utils/persist-cost-ledger.js');
  const { RunLogger, MODEL_COSTS } = await import('./agents/CEO/run-log.js');

  const HAIKU = 'claude-haiku-4-5-20251001';
  const SONNET = 'claude-sonnet-4-6';

  // ── 1. Current official pricing ───────────────────────────────────
  describe('Accounting — current list pricing');
  assert(U.MODEL_PRICING_PER_MTOK[HAIKU].input === 1 && U.MODEL_PRICING_PER_MTOK[HAIKU].output === 5,
    'Haiku 4.5 must be $1 input / $5 output per MTok (was $0.80/$1)');
  assert(U.MODEL_PRICING_PER_MTOK[SONNET].input === 3 && U.MODEL_PRICING_PER_MTOK[SONNET].output === 15,
    'Sonnet 4.6 must be $3 / $15 per MTok');
  assert(U.CACHE_MULTIPLIERS.write_5m === 1.25 && U.CACHE_MULTIPLIERS.write_1h === 2 && U.CACHE_MULTIPLIERS.read === 0.1,
    'Cache multipliers: 5m write 1.25x, 1h write 2x, read 0.1x of base input');
  assert(near(U.WEB_SEARCH_USD_PER_REQUEST, 0.01), 'Web search: $10 per 1,000 requests');
  assert(near(MODEL_COSTS[HAIKU].input, 0.001) && near(MODEL_COSTS[HAIKU].output, 0.005),
    'RunLogger MODEL_COSTS (per 1K) derives from the same table: Haiku $0.001/$0.005');
  assert(near(MODEL_COSTS[SONNET].input, 0.003) && near(MODEL_COSTS[SONNET].output, 0.015),
    'RunLogger MODEL_COSTS (per 1K): Sonnet $0.003/$0.015');
  {
    const srcs = [
      'agents/CEO/run-log.js', 'agents/Production/VoiceBroadcaster/broadcast.js',
      'agents/Infrastructure/OpsManager/skills/ops-cockpit.js',
      'supabase/functions/rabbit-hole-chat/index.ts', 'supabase/functions/voice-assistant-chat/index.ts',
    ].map(f => readFileSync(join(__dirname, f), 'utf8'));
    assert(srcs.every(s => !/0\.0008|\* 0\.80\b|0\.80 \+/.test(s)),
      'No stale $0.80/MTok Haiku rate remains in pipeline or chat-function cost code');
  }

  // ── 2. Cache + web-search pricing, no double counting ─────────────
  describe('Accounting — cache and web-search charges');
  {
    // Haiku: 1,000 in, 2,000 5m-write, 4,000 read, 500 out, 3 searches
    const usage = {
      input_tokens: 1000, output_tokens: 500,
      cache_creation_input_tokens: 2000, cache_read_input_tokens: 4000,
      server_tool_use: { web_search_requests: 3 },
    };
    const c = U.costOfUsage(HAIKU, U.normalizeUsage(usage));
    const expected = 1000 * 1e-6 + 2000 * 1e-6 * 1.25 + 4000 * 1e-6 * 0.1 + 500 * 5e-6 + 3 * 0.01;
    assert(c.cost_known && near(c.cost_usd, Math.round(expected * 1e6) / 1e6),
      `Full Haiku charge = input + 1.25x cache write + 0.1x cache read + output + $0.01/search (got ${c.cost_usd}, want ${expected})`);
    assert(near(c.components.web_search, 0.03), 'Web-search component priced separately from tokens');

    const split = U.normalizeUsage({
      input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 3000,
      cache_creation: { ephemeral_5m_input_tokens: 1000, ephemeral_1h_input_tokens: 2000 },
    });
    assert(split.cache_creation_5m_input_tokens === 1000 && split.cache_creation_1h_input_tokens === 2000 && split.cache_creation_input_tokens === 3000,
      'API TTL breakdown preserved; total not double counted (3000, not 6000)');
    assert(split.cache_ttl_source === 'api_breakdown', 'TTL source recorded as api_breakdown');
    const sc = U.costOfUsage(SONNET, split);
    assert(near(sc.cost_usd, 1000 * 3e-6 * 1.25 + 2000 * 3e-6 * 2), 'Sonnet: 5m tokens at 1.25x, 1h tokens at 2x');

    const noSplit = U.normalizeUsage({ cache_creation_input_tokens: 800 });
    assert(noSplit.cache_creation_5m_input_tokens === 800 && noSplit.cache_ttl_source === 'default_5m',
      'No TTL breakdown → priced at the 5-minute default and labelled default_5m');

    const unknownModel = U.costOfUsage('claude-unpriced-x', U.normalizeUsage({ input_tokens: 10 }));
    assert(!unknownModel.cost_known && unknownModel.cost_usd === null,
      'Unpriced model → cost unknown (null), never silently $0');
  }

  // ── 3. Streaming merge (SDK 0.39 drops message_delta usage) ───────
  describe('Accounting — streaming usage capture');
  {
    const m = new U.UsageMeter();
    const client = mockStreamClient({
      events: [
        startEv('msg_A', { input_tokens: 1200, output_tokens: 1, cache_creation_input_tokens: 900, cache_read_input_tokens: 0 }),
        deltaEv({ output_tokens: 700, input_tokens: 1500, cache_read_input_tokens: 0, server_tool_use: { web_search_requests: 2 } }),
      ],
      text: '<<<JSON {"a":1} >>>',
    });
    const msg = await meteredStream(client, { model: HAIKU }, { meter: m, agent: 'T' });
    const s = m.summary();
    assert(s.web_search_requests === 2, 'web_search_requests from message_delta is charged (SDK finalMessage drops it)');
    assert(s.input_tokens === 1500 && s.output_tokens === 700, 'Cumulative delta values replace, never add (1500 in / 700 out)');
    assert(s.cache_creation_input_tokens === 900, 'message_start cache write retained when delta omits it');
    assert(msg.usage.server_tool_use?.web_search_requests === 2, 'Returned message carries the merged usage');
    assert(s.calls === 1, 'One response → one charge');
    // Same check through the REAL @anthropic-ai/sdk MessageStream accumulator.
    const { MessageStream } = await import('@anthropic-ai/sdk/lib/MessageStream.mjs');
    const sse = [
      startEv('msg_REAL', { input_tokens: 300, output_tokens: 1, cache_read_input_tokens: 50 }),
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hi' } },
      { type: 'content_block_stop', index: 0 },
      deltaEv({ output_tokens: 40, server_tool_use: { web_search_requests: 3 } }),
      { type: 'message_stop' },
    ];
    const realClient = { messages: { stream: () => MessageStream.fromReadableStream(new ReadableStream({
      start(c) { for (const e of sse) c.enqueue(new TextEncoder().encode(JSON.stringify(e) + '\n')); c.close(); },
    })) } };
    const raw = await realClient.messages.stream().finalMessage();
    assert(!raw.usage.server_tool_use?.web_search_requests,
      '(baseline) real SDK 0.39 finalMessage() drops message_delta web_search_requests — the original undercount');
    const mReal = new U.UsageMeter();
    const realMsg = await meteredStream(realClient, { model: HAIKU }, { meter: mReal, agent: 'R' });
    assert(mReal.summary().web_search_requests === 3 && realMsg.usage.output_tokens === 40 && mReal.summary().cache_read_input_tokens === 50,
      'meteredStream over the real SDK stream charges 3 searches, 40 output, 50 cache-read tokens');
    assert(near(mReal.summary().cost_usd, 300e-6 + 50e-6 * 0.1 + 40 * 5e-6 + 0.03), 'Real-SDK stream priced in full');

    const merged = U.mergeUsage({ output_tokens: 5, server_tool_use: { web_search_requests: 1 } },
      { output_tokens: null, server_tool_use: { web_search_requests: 3 } });
    assert(merged.output_tokens === 5 && merged.server_tool_use.web_search_requests === 3,
      'mergeUsage: null leaves earlier value; nested cumulative counts replace');
  }

  // ── 4. Failure accounting at the response boundary ─────────────────
  describe('Accounting — parse failures, retries, partial streams, unknown usage');
  {
    // (a) Parse failure after a successful response: charged before the throw.
    const m = new U.UsageMeter();
    const good = { events: [startEv('msg_P1', { input_tokens: 100 }), deltaEv({ output_tokens: 50 })], text: 'not json' };
    const agentLike = async (meter) => {
      const r = await meteredStream(mockStreamClient(good), { model: SONNET }, { meter });
      JSON.parse(r.content[0].text); // throws like SignalDetector/ExecutiveSummaryWriter
    };
    let threw = false;
    try { await m.runAs('ExecutiveSummaryWriter', () => agentLike(m)); } catch { threw = true; }
    assert(threw && m.summary().calls === 1 && near(m.costForAgent('ExecutiveSummaryWriter'), 100 * 3e-6 + 50 * 15e-6),
      'Malformed-JSON response is still charged, attributed via runAs to the retrying agent');

    // (b) withRetry-style second attempt: both attempts counted, each once.
    const second = { events: [startEv('msg_P2', { input_tokens: 100 }), deltaEv({ output_tokens: 60 })], text: '{}' };
    await m.runAs('ExecutiveSummaryWriter', () => meteredStream(mockStreamClient(second), { model: SONNET }, { meter: m }));
    assert(m.summary().calls === 2, 'Failed attempt + successful retry = 2 charges');
    // (c) Same response id seen again (re-recorded) → not double counted.
    m.chargeResponse({ model: SONNET, usage: { input_tokens: 100, output_tokens: 60 }, responseId: 'msg_P2', agent: 'ExecutiveSummaryWriter' });
    assert(m.summary().calls === 2, 'Re-charging the same message id is a no-op (idempotent)');

    // (d) Stream breaks after message_start → partial charge.
    const m2 = new U.UsageMeter();
    const broken = { events: [startEv('msg_BRK', { input_tokens: 5000, output_tokens: 1 })], throwAfterEvents: Object.assign(new Error('socket hang up'), { status: undefined }) };
    try { await meteredStream(mockStreamClient(broken), { model: HAIKU }, { meter: m2, agent: 'X' }); } catch { /* expected */ }
    const c2 = m2.charges()[0];
    assert(c2?.partial === true && c2.cost_known && near(c2.cost_usd, 5000 * 1e-6 + 1 * 5e-6),
      'Mid-stream failure: billed input from message_start is charged, flagged partial');

    // (e) HTTP error response (e.g. 529 overloaded) → not billed → no charge.
    const m3 = new U.UsageMeter();
    try { await meteredCreate(mockStreamClient({ throw: Object.assign(new Error('overloaded'), { status: 529 }) }), { model: HAIKU }, { meter: m3 }); } catch { /* expected */ }
    assert(m3.summary().calls === 0, 'API error responses (status ≥ 400) are not billed and not charged');

    // (f) Connection error / timeout with no usage → UNKNOWN, not $0.
    try { await meteredCreate(mockStreamClient({ throw: Object.assign(new Error('Request timed out.'), { name: 'APIConnectionTimeoutError' }) }), { model: HAIKU }, { meter: m3, agent: 'MacroDataAnalyst' }); } catch { /* expected */ }
    const s3 = m3.summary();
    assert(s3.unknown_usage_calls === 1 && s3.cost_complete === false && s3.cost_usd === 0,
      'Unrecoverable usage is labelled unknown (cost_complete=false), not priced as zero');

    // (g) meteredCreate success (pre-flight path) is charged.
    const m4 = new U.UsageMeter();
    await meteredCreate(mockStreamClient({ response: { id: 'msg_PF', usage: { input_tokens: 8, output_tokens: 1 } } }), { model: HAIKU }, { meter: m4, agent: 'ModelPreflight' });
    assert(near(m4.summary().cost_usd, 8e-6 + 5e-6), 'Non-streaming create (pre-flight ping) is charged');
  }

  // ── 4b. Missing usage is UNKNOWN; partial usage is a lower bound ───
  describe('Accounting — missing vs zero usage, lower bounds (regression)');
  {
    // The independent-review repro: on() does nothing, finalMessage()
    // returns a message with NO usage.
    const noUsageClient = { messages: { stream: () => ({
      on() { return this; },
      async finalMessage() { return { id: 'mock-no-usage', content: [] }; },
    }) } };
    const m = new U.UsageMeter();
    await meteredStream(noUsageClient, { model: HAIKU }, { meter: m, agent: 'Repro' });
    const s = m.summary();
    assert(s.calls === 1 && s.unknown_usage_calls === 1 && s.cost_complete === false && s.cost_is_lower_bound === true,
      `Repro: final message without usage → 1 UNKNOWN call, cost_complete=false (got unknown=${s.unknown_usage_calls}, complete=${s.cost_complete})`);
    assert(m.charges()[0].cost_usd === null && m.charges()[0].cost_known === false,
      'Repro: the charge is cost_usd=null / cost_known=false, not a known $0');

    for (const [label, usage] of [['absent', undefined], ['null', null], ['empty {}', {}],
      ['mergeUsage(undefined,null)', U.mergeUsage(undefined, null)], ['null counts', { input_tokens: null, output_tokens: null }]]) {
      assert(U.normalizeUsage(usage) === null, `normalizeUsage(${label}) → null (nothing observed)`);
      const mm = new U.UsageMeter();
      mm.chargeResponse({ model: HAIKU, usage, responseId: `msg_${label}` });
      assert(mm.summary().unknown_usage_calls === 1 && !mm.summary().cost_complete, `Charge with ${label} usage → UNKNOWN`);
    }
    for (const [label, client] of [
      ['create without usage', mockStreamClient({ response: { id: 'msg_c0', content: [] } })],
      ['create with usage: null', mockStreamClient({ response: { id: 'msg_c1', usage: null } })],
      ['create with usage: {}', mockStreamClient({ response: { id: 'msg_c2', usage: {} } })],
    ]) {
      const mm = new U.UsageMeter();
      await meteredCreate(client, { model: HAIKU }, { meter: mm });
      assert(mm.summary().unknown_usage_calls === 1 && mm.summary().cost_usd === 0 && !mm.summary().cost_complete,
        `meteredCreate: ${label} → UNKNOWN, total flagged incomplete`);
    }

    // Meaningful partial usage: counts present but output missing.
    const pn = U.normalizeUsage({ input_tokens: 3000, cache_read_input_tokens: 1000 });
    const pc = U.costOfUsage(HAIKU, pn);
    assert(pn.usage_complete === false && pc.cost_known && pc.lower_bound && near(pc.cost_usd, 3000e-6 + 1000e-6 * 0.1),
      'Input-only usage priced from what was observed, flagged lower_bound');
    const zero = U.costOfUsage(HAIKU, U.normalizeUsage({ input_tokens: 0, output_tokens: 0 }));
    assert(zero.cost_known && zero.cost_usd === 0 && !zero.lower_bound, 'Explicit zero counts are a real, complete $0');

    // Received partial stream (truncated output) is NOT a complete total.
    const mt = new U.UsageMeter();
    const truncated = { events: [startEv('msg_TR', { input_tokens: 4000, output_tokens: 1 })], throwAfterEvents: new Error('ECONNRESET') };
    try { await meteredStream(mockStreamClient(truncated), { model: HAIKU }, { meter: mt }); } catch { /* expected */ }
    const ts2 = mt.summary();
    assert(ts2.calls === 1 && ts2.lower_bound_calls === 1 && ts2.cost_complete === false && ts2.cost_is_lower_bound && near(ts2.cost_usd, 4000e-6 + 5e-6),
      'Truncated stream: observed amount kept, labelled lower bound, run total not complete');
  }

  // ── 4c. Incremental journaling mid-stream ──────────────────────────
  describe('Accounting — incremental stream journal (cumulative per message id)');
  {
    const jdir = mkdtempSync(join(tmpdir(), 'acct-journal-'));
    const jpath = P.journalPathFor('run-inc', jdir);
    const m = new U.UsageMeter();
    m.attachRun({ runId: 'run-inc', isoDate: '2026-11-22', pipeline: 'daily', journalPath: jpath });

    // Simulate a hard kill mid-stream: events arrive, finalMessage never resolves.
    let release;
    const hung = { messages: { stream: () => {
      const ls = [];
      return {
        on(ev, cb) { if (ev === 'streamEvent') ls.push(cb); return this; },
        finalMessage() {
          for (const l of ls) l(startEv('msg_KILL', { input_tokens: 6000, output_tokens: 1, cache_read_input_tokens: 2000 }));
          for (const l of ls) l(deltaEv({ output_tokens: 300, server_tool_use: { web_search_requests: 2 } }));
          return new Promise(r => { release = r; }); // never resolved before the "kill"
        },
      };
    } } };
    meteredStream(hung, { model: HAIKU }, { meter: m, agent: 'MacroDataAnalyst' }).catch(() => {});
    await new Promise(r => setImmediate(r));

    // "Process killed": only the on-disk journal remains.
    const lines = U.readJournal(jpath).filter(l => l.charge_id === 'msg_KILL');
    assert(lines.length === 2, `Each observed usage update is journaled as it arrives (got ${lines.length} lines)`);
    const [run] = U.runsFromJournal(U.readJournal(jpath));
    const expected = 6000e-6 + 2000e-6 * 0.1 + 300 * 5e-6 + 2 * 0.01;
    assert(run && run.summary.calls === 1 && near(run.summary.cost_usd, expected)
      && run.summary.web_search_requests === 2 && run.summary.output_tokens === 300,
      'Replay after a mid-stream kill: one charge, latest cumulative usage (no double count across observations)');
    assert(run.summary.lower_bound_calls === 1 && run.summary.cost_complete === false,
      'Mid-stream journal amount is labelled a lower bound');

    // If the stream later completes, the final record replaces the partial.
    release({ id: 'msg_KILL', content: [], usage: { input_tokens: 6000, output_tokens: 300 } });
    await new Promise(r => setImmediate(r));
    const [run2] = U.runsFromJournal(U.readJournal(jpath));
    assert(run2.summary.calls === 1 && run2.summary.lower_bound_calls === 0 && run2.summary.cost_complete === true && near(run2.summary.cost_usd, expected),
      'Completed stream: final record supersedes partial observations, same id counted once, now complete');
    assert(m.summary().calls === 1 && near(m.summary().cost_usd, expected), 'In-memory meter agrees with the journal');

    // A partial observation journaled AFTER a final one never replaces it.
    appendFileSync(jpath, JSON.stringify({ ...U.readJournal(jpath).at(-1), partial: true, lower_bound: true, cost_usd: 0.000001 }) + '\n');
    const [run3] = U.runsFromJournal(U.readJournal(jpath));
    assert(near(run3.summary.cost_usd, expected) && run3.summary.cost_complete, 'Final record is never replaced by a later partial line');

    // Ledger entry for an incomplete run is explicitly a lower bound.
    const d = P.entryDetails(run, 'failed');
    assert(d.cost_is_lower_bound === true && d.lower_bound_calls === 1 && d.cost_complete === false,
      'Durable ledger entry labels partial amounts as a lower bound');
  }

  // ── 5. RunLogger uses the meter; VoiceBroadcaster Claude+OpenAI once ─
  describe('Accounting — RunLogger totals and VoiceBroadcaster combined cost');
  {
    const m = new U.UsageMeter();
    const logger = new RunLogger('2026-11-22', { meter: m });
    m.chargeResponse({ model: HAIKU, usage: { input_tokens: 1000, output_tokens: 200 }, responseId: 'msg_V', agent: 'VoiceBroadcaster' });
    m.chargeExternal({ provider: 'openai', model: 'tts-1-hd', cost_usd: 0.027, agent: 'VoiceBroadcaster' });
    const haiku = 1000 * 1e-6 + 200 * 5e-6;
    logger.agent('VoiceBroadcaster', { model: `${HAIKU}+openai-tts-1-hd`, tokens: { input: 1000, output: 200 }, cost_usd: haiku + 0.027 });
    assert(near(logger.log.agents.VoiceBroadcaster.cost_usd, Math.round((haiku + 0.027) * 1e5) / 1e5),
      'VoiceBroadcaster per-agent cost = Haiku + OpenAI TTS');
    assert(near(logger.estimateCost(), Math.round((haiku + 0.027) * 1e4) / 1e4),
      'Run total counts the combined Claude/OpenAI cost exactly once (meta.cost_usd not added again)');
    // Spend from an agent that failed and was never logged still counts.
    m.chargeResponse({ model: HAIKU, usage: { input_tokens: 2000, output_tokens: 0, server_tool_use: { web_search_requests: 4 } }, responseId: 'msg_SEG', agent: 'RealEstateSegmentAnalyst' });
    assert(near(logger.estimateCost(), Math.round((haiku + 0.027 + 0.002 + 0.04) * 1e4) / 1e4),
      'Charges from an agent that failed non-fatally (never logger.agent()-ed) are in the run total');
    const d = logger.costDetails('failed');
    assert(d.status === 'failed' && d.usage.web_search_requests === 4 && d.cost_complete === true,
      'costDetails carries status, usage breakdown and completeness for the ledger');
    logger.agent('Validator', { model: 'none', tokens: { input: 0, output: 0 } });
    assert(logger.log.agents.Validator.cost_usd === 0, 'Pure-code agents stay at $0');
  }

  // ── 6. Ledger durability and idempotence ──────────────────────────
  describe('Accounting — ledger upsert, idempotence, legacy labels');
  {
    const dir = mkdtempSync(join(tmpdir(), 'ledger-acct-'));
    const lp = join(dir, 'cost-ledger.json');
    writeFileSync(lp, JSON.stringify({ months: { '2026-11': { total_usd: 0.5, runs: [{ date: '2026-11-01', run_id: 'old', cost_usd: 0.5, timestamp: 't' }] } }, lifetime_usd: 0.5 }));
    L.recordRunCost('2026-11-02', 0.2, 'run-x', lp, { status: 'success' });
    L.recordRunCost('2026-11-02', 0.2, 'run-x', lp, { status: 'success' });
    let led = JSON.parse(readFileSync(lp, 'utf8'));
    assert(led.months['2026-11'].runs.filter(r => r.run_id === 'run-x').length === 1 && near(led.months['2026-11'].total_usd, 0.7),
      'Recording the same run_id twice keeps one entry and one charge');
    L.recordRunCost('2026-11-02', 0.25, 'run-x', lp, { status: 'failed' });
    led = JSON.parse(readFileSync(lp, 'utf8'));
    assert(near(led.months['2026-11'].total_usd, 0.75) && led.months['2026-11'].runs.find(r => r.run_id === 'run-x').status === 'failed',
      'Success then failure of the same run: entry replaced, total moves by the delta only');
    const old = led.months['2026-11'].runs.find(r => r.run_id === 'old');
    assert(old.accounting === 'legacy_incomplete' && old.cost_usd === 0.5 && typeof led.accounting_notes === 'string',
      'Pre-v2 entries are labelled legacy_incomplete, amounts untouched (no backfill)');
    assert(led.months['2026-11'].runs.find(r => r.run_id === 'run-x').accounting_version === U.ACCOUNTING_VERSION,
      'New entries carry accounting_version');
    assert(L.checkBudget('2026-11-03', 0.18, lp).budget_usd === 5, '$5/month cap unchanged');
  }

  // ── 7. Journal + durable push (local bare repo, no network) ───────
  describe('Accounting — failure journal persisted to main, idempotent');
  {
    const base = mkdtempSync(join(tmpdir(), 'ledger-git-'));
    const origin = join(base, 'origin.git');
    const seed = join(base, 'seed');
    const work = join(base, 'work');
    sh(base, 'init', '--quiet', '--bare', '-b', 'main', origin);
    sh(base, 'clone', '--quiet', origin, seed);
    for (const d of [seed]) { sh(d, 'config', 'user.email', 't@t'); sh(d, 'config', 'user.name', 't'); }
    mkdirSync(join(seed, 'macro-intelligence', 'output'), { recursive: true });
    const seedLedger = { months: { '2026-11': { total_usd: 1, runs: [{ date: '2026-11-01', run_id: 'prev', cost_usd: 1, timestamp: 't', accounting_version: 2 }] } }, lifetime_usd: 1 };
    writeFileSync(join(seed, 'macro-intelligence', 'output', 'cost-ledger.json'), JSON.stringify(seedLedger, null, 2));
    sh(seed, 'add', '-A'); sh(seed, 'commit', '--quiet', '-m', 'seed'); sh(seed, 'push', '--quiet', 'origin', 'main');
    sh(base, 'clone', '--quiet', origin, work);
    sh(work, 'config', 'user.email', 't@t'); sh(work, 'config', 'user.name', 't');

    // origin advances AFTER the failing job checked out (a parallel push)
    writeFileSync(join(seed, 'other.txt'), 'x'); sh(seed, 'add', '-A'); sh(seed, 'commit', '--quiet', '-m', 'other'); sh(seed, 'push', '--quiet', 'origin', 'main');

    // the failed job's dirty, half-written output must NOT be committed
    writeFileSync(join(work, 'macro-intelligence', 'output', 'half-written.html'), 'partial');

    const jdir = join(work, 'macro-intelligence', 'logs');
    mkdirSync(jdir, { recursive: true });
    const jm = new U.UsageMeter();
    jm.attachRun({ runId: 'run-fail-1', isoDate: '2026-11-22', pipeline: 'daily', journalPath: P.journalPathFor('run-fail-1', jdir) });
    jm.chargeResponse({ model: HAIKU, usage: { input_tokens: 10000, output_tokens: 1000, server_tool_use: { web_search_requests: 5 } }, responseId: 'msg_J1', agent: 'MacroDataAnalyst' });
    jm.chargeResponse({ model: SONNET, usage: { input_tokens: 4000, output_tokens: 2000 }, responseId: 'msg_J2', agent: 'ExecutiveSummaryWriter' });
    jm.chargeUnknown({ model: HAIKU, agent: 'LeverageAnalyst', reason: 'timeout' });
    appendFileSync(P.journalPathFor('run-fail-1', jdir), '{"torn":');  // killed mid-write
    const expected = jm.summary().cost_usd;

    const lp = join(work, 'macro-intelligence', 'output', 'cost-ledger.json');
    const opts = { journalDir: jdir, ledgerPath: lp, repoDir: work, skipPush: false, backoffMs: [10, 10, 10, 10] };
    const r1 = await P.persistFailedRunCosts(opts);
    sh(seed, 'fetch', '--quiet');
    const remote = JSON.parse(sh(seed, 'show', 'origin/main:macro-intelligence/output/cost-ledger.json'));
    const entry = remote.months['2026-11'].runs.find(r => r.run_id === 'run-fail-1');
    assert(r1.pushed === true, 'Failed run spend pushed to main');
    assert(entry && near(entry.cost_usd, Math.round(expected * 1e4) / 1e4) && entry.status === 'failed',
      'Main ledger has the failed run at the journal-derived cost');
    assert(entry.unknown_usage_calls === 1 && entry.cost_complete === false && entry.usage.web_search_requests === 5,
      'Unknown-usage calls and web searches carried into the durable entry');
    assert(near(remote.months['2026-11'].total_usd, Math.round((1 + entry.cost_usd) * 1e4) / 1e4),
      'Next run\'s month spend includes the failed run (prior entries kept)');
    const files = sh(seed, 'show', '--name-only', '--format=', 'origin/main');
    assert(files === 'macro-intelligence/output/cost-ledger.json', `Accounting-only commit touches only the ledger (got: ${files})`);
    assert(sh(seed, 'log', '--format=%s', 'origin/main').includes('other'), 'Concurrent commit on main preserved (built on fresh origin/main)');

    const r2 = await P.persistFailedRunCosts(opts);
    sh(seed, 'fetch', '--quiet');
    const again = JSON.parse(sh(seed, 'show', 'origin/main:macro-intelligence/output/cost-ledger.json'));
    assert(r2.pushed === false && r2.reason === 'already-recorded'
      && again.months['2026-11'].runs.filter(r => r.run_id === 'run-fail-1').length === 1,
      'Re-running the persist step is idempotent (no duplicate entry, no extra commit)');

    // Next run restores: a fresh runner checks out main and its budget
    // check reads the ledger from there.
    const next = join(base, 'next-run');
    sh(base, 'clone', '--quiet', origin, next);
    const nextLp = join(next, 'macro-intelligence', 'output', 'cost-ledger.json');
    assert(near(L.getMonthSpend('2026-11-23', nextLp).cost_usd, again.months['2026-11'].total_usd)
      && L.getMonthSpend('2026-11-23', nextLp).runs === 2,
      'A fresh checkout of main restores the failed run into the next run\'s budget ledger');

    const skip = await P.persistFailedRunCosts({ ...opts, skipPush: true });
    assert(skip.reason === 'skip-git-push', 'SKIP_GIT_PUSH honoured (no push)');
    const empty = await P.persistFailedRunCosts({ ...opts, journalDir: join(base, 'none') });
    assert(empty.reason === 'no-spend', 'No metered calls → nothing persisted');
  }

  // ── 8. ConglomeratesTracker ordering + wiring ─────────────────────
  describe('Accounting — ConglomeratesTracker records before publishing');
  {
    const src = readFileSync(join(__dirname, 'agents', 'ConglomeratesTracker', 'orchestrate.js'), 'utf8');
    const rec = src.indexOf("recordRunCost(cycle.runDate, totalCost, runId");
    const pub = src.indexOf('publishGit({');
    assert(rec > 0 && pub > 0 && rec < pub, 'recordRunCost runs BEFORE publishGit');
    assert(/statePaths: \[[^\]]*LEDGER_PATH/.test(src), 'cost-ledger.json is part of the published commit');
    assert(!src.includes('tokenCostUSD') && src.includes('meter.summary().cost_usd'), 'Cost comes from the usage meter (cache + search included)');
    assert(/randomUUID\(\)/.test(src) && !src.includes("`congs-${cycle.isoMonth}`)"), 'run_id unique per attempt (re-runs cannot overwrite earlier spend)');
    const afterBudget = src.slice(src.indexOf('// ── 1. RESEARCH'));
    assert(!/process\.exit\(1\)/.test(afterBudget), 'Every post-spend abort path records cost (abort()), none exits silently');
    for (const f of ['ResearchAnalyst/research.js', 'StrategyAdvisor/advise.js', 'CriticReviewer/review.js']) {
      const s = readFileSync(join(__dirname, 'agents', 'ConglomeratesTracker', f), 'utf8');
      assert(s.includes('meteredStream(client') && !s.includes('stream.finalMessage()'), `${f} charges at the response boundary`);
    }
  }

  // ── 9. Every pipeline call site is metered; workflows persist ─────
  describe('Accounting — call-site and workflow wiring');
  {
    // SignalDetector goes through streamUntilComplete (src/utils/model-output.js),
    // which meters every attempt via meteredStream.
    const sd = readFileSync(join(__dirname, 'agents/Analysis/SignalDetector/detect.js'), 'utf8');
    const mo = readFileSync(join(__dirname, 'src/utils/model-output.js'), 'utf8');
    assert(sd.includes('streamUntilComplete(this.client') && !/client\.messages\.(stream|create)\(/.test(sd)
      && (mo.match(/meteredStream\(client/g) || []).length === 2 && !/client\.messages\.(stream|create)\(/.test(mo),
      'agents/Analysis/SignalDetector/detect.js meters every attempt (via streamUntilComplete → meteredStream)');
    const daily = [
      'agents/DataIntelligence/MacroDataAnalyst/skills/web-search.js',
      'agents/Editorial/ExecutiveSummaryWriter/write.js', 'agents/Editorial/NewsCurator/curate.js',
      'agents/Production/VoiceBroadcaster/broadcast.js',
    ];
    for (const f of daily) {
      const s = readFileSync(join(__dirname, f), 'utf8');
      assert(s.includes('meteredStream(client') && !/client\.messages\.(stream|create)\(/.test(s), `${f} uses the metered wrapper`);
    }
    const res = readFileSync(join(__dirname, 'src', 'utils', 'resilience.js'), 'utf8');
    assert(res.includes('meteredCreate(client') && !/client\.messages\.create\(/.test(res), 'Pre-flight ping is metered');
    const ceo = readFileSync(join(__dirname, 'agents', 'CEO', 'orchestrate.js'), 'utf8');
    assert(ceo.includes('meter.runAs(agentName, fn)') && ceo.includes('meter.attachRun('), 'CEO attributes retries per agent and journals the run');
    for (const wf of ['daily-dashboard.yml', 'manual-trigger.yml', 'conglomerates-monthly.yml']) {
      const s = readFileSync(join(__dirname, '..', '.github', 'workflows', wf), 'utf8');
      assert(/Persist cost ledger \(accounting only\)\n\s+if: failure\(\) \|\| cancelled\(\)\n\s+working-directory: macro-intelligence\n\s+run: node src\/utils\/persist-cost-ledger\.js/.test(s),
        `${wf} persists failed-run spend (accounting only)`);
      assert(s.includes('group: macrointelligence-publish'), `${wf} keeps the shared concurrency group`);
    }
  }

  // ── 10. Chat functions (separate budgets) ─────────────────────────
  describe('Accounting — Supabase chat functions (code only)');
  {
    const rh = readFileSync(join(__dirname, 'supabase', 'functions', 'rabbit-hole-chat', 'index.ts'), 'utf8');
    const va = readFileSync(join(__dirname, 'supabase', 'functions', 'voice-assistant-chat', 'index.ts'), 'utf8');
    assert(rh.includes('const DAILY_BUDGET_USD = 2.0;') && va.includes('const DAILY_BUDGET_USD = 3.0;'), '$2/day and $3/day chat caps unchanged');
    assert(rh.includes('MAX_MESSAGES_PER_IP = 20') && va.includes('MAX_MESSAGES_PER_IP = 40'), 'Per-IP limits unchanged');
    assert(rh.includes('from("rabbit_hole_usage")') && va.includes('from("voice_assistant_usage")') && !rh.includes('cost-ledger') && !va.includes('cost-ledger'),
      'Chat budgets stay in their own tables, separate from the pipeline ledger');
    assert(rh.includes('costOfUsage(MODEL, usage)') && va.includes('costOfUsage(MODEL, data.usage)'), 'Both price from the full usage object');
    assert(/catch \(err\) \{[\s\S]{0,250}logOnce\(true\)/.test(rh) && /if \(!res\.ok\)[\s\S]{0,200}logOnce\(\)/.test(va),
      'Billed usage is logged on stream/round failure paths');
    assert(/if \(!usage \|\| !usageObserved\(usage\)\)[\s\S]{0,120}UNKNOWN, not logged/.test(rh),
      'Rabbit Hole: absent/empty usage is reported UNKNOWN, never logged as $0');
    assert(/streamBroken \|\| !usageComplete\(usage\)[\s\S]{0,120}LOWER BOUND/.test(rh) && /!usageComplete\(data\.usage\)[\s\S]{0,120}LOWER BOUND/.test(va),
      'Chat functions label broken-stream / incomplete usage as a lower bound');
    let ts = null;
    try { ts = await import('./supabase/functions/_shared/anthropic-pricing.ts'); } catch { /* Node without TS stripping */ }
    if (ts) {
      // Missing-usage regression (shared chat helper)
      assert(ts.costOfUsage(HAIKU, undefined) === null && ts.costOfUsage(HAIKU, null) === null
        && ts.costOfUsage(HAIKU, {}) === null && ts.costOfUsage(HAIKU, ts.mergeUsage(undefined, null)) === null,
        'Chat pricing: absent / null / {} / mergeUsage(undefined,null) usage → null (UNKNOWN), not $0');
      assert(ts.costOfUsage(HAIKU, { input_tokens: null, output_tokens: null }) === null,
        'Chat pricing: usage with only null counts → UNKNOWN');
      const partialTs = { input_tokens: 2000, output_tokens: null };
      assert(near(ts.costOfUsage(HAIKU, partialTs), 0.002) && ts.usageObserved(partialTs) && !ts.usageComplete(partialTs),
        'Chat pricing: input-only usage priced from what was observed and flagged incomplete (lower bound)');
      assert(ts.usageComplete({ input_tokens: 0, output_tokens: 0 }) && ts.costOfUsage(HAIKU, { input_tokens: 0, output_tokens: 0 }) === 0,
        'Chat pricing: explicit zero counts are a real, complete $0');
      const cost = ts.costOfUsage(HAIKU, { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 2000, cache_creation_input_tokens: 400 });
      assert(near(cost, Math.round((1000e-6 + 100 * 5e-6 + 2000e-6 * 0.1 + 400e-6 * 1.25) * 1e6) / 1e6), 'Chat pricing helper matches pipeline pricing');
      assert(ts.costOfUsage('nope', { input_tokens: 1 }) === null, 'Chat pricing: unpriced model → null, not $0');
      const mu = ts.mergeUsage({ input_tokens: 10, output_tokens: 1 }, { output_tokens: 40 });
      assert(mu.input_tokens === 10 && mu.output_tokens === 40, 'Chat stream usage merge is cumulative');
    } else {
      console.log('  (skipped executing anthropic-pricing.ts — this Node cannot strip TypeScript)');
    }
  }
}

// Standalone runner
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let pass = 0, fail = 0;
  const describe = n => console.log(`\n── ${n} ──`);
  const assert = (c, msg) => { if (c) pass++; else { fail++; console.error(`  ✗ FAIL: ${msg}`); } };
  runAccountingTests({ describe, assert })
    .then(() => { console.log(`\nAccounting tests: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); })
    .catch(err => { console.error(err); process.exit(1); });
}
