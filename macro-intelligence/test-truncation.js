#!/usr/bin/env node
/**
 * Output-truncation tests — zero API cost, zero network (mock clients).
 *
 * Regression for the 24 & 25 NOV 2026 03:00 IST failures: SignalDetector
 * output stopped at exactly max_tokens=4096 on both attempts, surfaced as
 * "Failed to extract JSON from response", and the generic retry re-sent
 * the identical capped request.
 *
 * Standalone: node test-truncation.js   (also run from test.js)
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Mock Anthropic client. `replies` is consumed one per request:
 * { text, stop_reason, output_tokens }. Records each request's params.
 */
function mockClient(replies) {
  const calls = [];
  let n = 0;
  return {
    calls,
    messages: {
      stream(params) {
        calls.push(params);
        const r = replies[Math.min(n, replies.length - 1)];
        const id = `msg_mock_${++n}`;
        const ls = [];
        return {
          on(ev, cb) { if (ev === 'streamEvent') ls.push(cb); return this; },
          async finalMessage() {
            const usage = { input_tokens: 11000, output_tokens: r.output_tokens };
            for (const l of ls) l({ type: 'message_start', message: { id, content: [], usage: { input_tokens: 11000, output_tokens: 1 } } });
            for (const l of ls) l({ type: 'message_delta', delta: { stop_reason: r.stop_reason }, usage: { output_tokens: r.output_tokens } });
            return { id, content: [{ type: 'text', text: r.text }], stop_reason: r.stop_reason, usage };
          },
        };
      },
    },
  };
}

const SIGNALS_JSON = '<<<JSON ' + JSON.stringify(Array.from({ length: 7 }, (_, i) => ({
  status: 'watch', title: `T${i + 1}`, data_text: 'd', implication: 'i', pct_10y: 50, pct_note: 'n',
}))) + ' >>>';
const TRUNCATED_TEXT = '<<<JSON [{"status":"watch","title":"Credit cycle turning","data_text":"Bank credit grew';

const allData = {
  isoDate: '2026-11-25', dateStr: '25 NOV 2026',
  macroData: { data: { indicators: {} } },
  reData: { data: { indicators: {} } },
  leverageData: { data: { indicators: {} } },
  marketData: { data: { prices: {} } },
  regime: { data: [] },
  dynamicRanges: {},
};

export async function runTruncationTests({ describe, assert }) {
  const { streamUntilComplete, OutputTruncatedError, isTruncated } = await import('./src/utils/model-output.js');
  const { UsageMeter } = await import('./src/utils/usage-meter.js');
  const { classifyModelError, isTerminalModelError, retryDelaysFor, formatFailureAlert } = await import('./src/utils/resilience.js');
  const { SignalDetector, SIGNAL_DETECTOR_MAX_TOKENS, SIGNAL_DETECTOR_ESCALATED_MAX_TOKENS } =
    await import('./agents/Analysis/SignalDetector/detect.js');
  const HAIKU = 'claude-haiku-4-5-20251001';
  const near = (a, b) => Math.abs(a - b) < 1e-9;

  // ── Helper ───────────────────────────────────────────────────────
  describe('Truncation — streamUntilComplete');
  {
    const m = new UsageMeter();
    const c = mockClient([{ text: 'ok', stop_reason: 'end_turn', output_tokens: 3000 }]);
    const r = await streamUntilComplete(c, { model: HAIKU, max_tokens: 8192 }, { agent: 'A', escalateTo: 16384, meter: m });
    assert(r.stop_reason === 'end_turn' && c.calls.length === 1 && c.calls[0].max_tokens === 8192,
      'Complete response: one call at the base cap, no escalation');
  }
  {
    const m = new UsageMeter();
    const c = mockClient([
      { text: TRUNCATED_TEXT, stop_reason: 'max_tokens', output_tokens: 8192 },
      { text: 'ok', stop_reason: 'end_turn', output_tokens: 9000 },
    ]);
    const r = await streamUntilComplete(c, { model: HAIKU, max_tokens: 8192, temperature: 0 }, { agent: 'A', escalateTo: 16384, meter: m });
    assert(r.text === undefined && r.stop_reason === 'end_turn' && c.calls.length === 2,
      'Truncated response → exactly one retry');
    assert(c.calls[1].max_tokens === 16384 && c.calls[1].temperature === 0 && c.calls[1].model === HAIKU,
      'Retry raises only max_tokens (to escalateTo); everything else identical');
    const s = m.summary();
    assert(s.calls === 2 && s.output_tokens === 8192 + 9000 && near(s.cost_usd, 2 * 11000e-6 + (8192 + 9000) * 5e-6),
      'Cost guard: BOTH the truncated attempt and the retry are charged, each once');
  }
  {
    const m = new UsageMeter();
    const c = mockClient([{ text: TRUNCATED_TEXT, stop_reason: 'max_tokens', output_tokens: 8192 }]);
    let err = null;
    try { await streamUntilComplete(c, { model: HAIKU, max_tokens: 8192 }, { agent: 'A', escalateTo: 16384, meter: m }); } catch (e) { err = e; }
    assert(err instanceof OutputTruncatedError && err.code === 'output_truncated' && err.maxTokens === 16384,
      'Still truncated at the raised cap → OutputTruncatedError (code output_truncated, maxTokens 16384)');
    assert(c.calls.length === 2 && m.summary().calls === 2, 'Gives up after one escalation; both attempts charged');
    assert(/truncated at max_tokens=16384/.test(err.message) && !/extract JSON/.test(err.message),
      'Error names the truncation, not a generic JSON-parse failure');
  }
  {
    const c = mockClient([{ text: TRUNCATED_TEXT, stop_reason: 'max_tokens', output_tokens: 4096 }]);
    let err = null;
    try { await streamUntilComplete(c, { model: HAIKU, max_tokens: 4096 }, { agent: 'A', meter: new UsageMeter() }); } catch (e) { err = e; }
    assert(err?.code === 'output_truncated' && c.calls.length === 1, 'No escalateTo → fail explicitly after one call');
    assert(isTruncated({ stop_reason: 'max_tokens' }) && !isTruncated({ stop_reason: 'end_turn' }) && !isTruncated(null),
      'isTruncated keys on stop_reason === max_tokens only');
  }

  // ── Retry path ───────────────────────────────────────────────────
  describe('Truncation — orchestrator retry path');
  {
    const err = new OutputTruncatedError({ agent: 'SignalDetector', maxTokens: 16384, outputTokens: 16384 });
    assert(classifyModelError(err) === 'truncated', 'OutputTruncatedError classifies as truncated');
    assert(retryDelaysFor('truncated').length === 0,
      'withRetry does not re-send the identical capped request (escalation already happened in-agent)');
    assert(!isTerminalModelError('truncated'), 'Truncation is not billing/auth-terminal (cache fallback paths unaffected)');
    assert(formatFailureAlert({ dateStr: 'x', kind: 'truncated', reason: err.message }).includes('output cap'),
      'Failure alert explains the truncation and the fix');
    const orch = readFileSync(join(__dirname, 'agents', 'CEO', 'orchestrate.js'), 'utf8');
    assert(/const delays = retryDelaysFor\(kind\);\s*\n\s*if \(attempt >= delays\.length\) throw err;/.test(orch),
      'CEO withRetry throws immediately when retryDelaysFor(kind) is empty');
  }

  // ── SignalDetector end-to-end (mock client) ──────────────────────
  describe('Truncation — SignalDetector');
  assert(SIGNAL_DETECTOR_MAX_TOKENS === 8192 && SIGNAL_DETECTOR_ESCALATED_MAX_TOKENS === 16384,
    'SignalDetector caps: 8192, escalating once to 16384 (was 4096, no check)');
  {
    const c = mockClient([{ text: SIGNALS_JSON, stop_reason: 'end_turn', output_tokens: 3900 }]);
    const out = await new SignalDetector({ client: c }).detect(allData);
    assert(out.data.length === 7 && c.calls.length === 1 && c.calls[0].max_tokens === 8192,
      'Normal day: 7 signals from one call at max_tokens 8192');
  }
  {
    const c = mockClient([
      { text: TRUNCATED_TEXT, stop_reason: 'max_tokens', output_tokens: 8192 },
      { text: SIGNALS_JSON, stop_reason: 'end_turn', output_tokens: 9100 },
    ]);
    const out = await new SignalDetector({ client: c }).detect(allData);
    assert(out.data.length === 7 && c.calls.map(p => p.max_tokens).join(',') === '8192,16384',
      'Truncated first answer: retried once at 16384 and the complete answer is used');
  }
  {
    const c = mockClient([{ text: TRUNCATED_TEXT, stop_reason: 'max_tokens', output_tokens: 8192 }]);
    let err = null;
    try { await new SignalDetector({ client: c }).detect(allData); } catch (e) { err = e; }
    assert(err?.name === 'OutputTruncatedError' && classifyModelError(err) === 'truncated' && c.calls.length === 2,
      'Truncated twice: explicit OutputTruncatedError (not "Failed to extract JSON"), no third call');
  }
  {
    // Old cap reproduces the incident's symptom: truncated text is not parseable.
    assert(!/<<<JSON\s*([\s\S]*?)\s*>>>/.test(TRUNCATED_TEXT) && !/\[[\s\S]*\]/.test(TRUNCATED_TEXT),
      '(baseline) a reply cut at the cap matches neither JSON pattern — the original generic error');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let pass = 0, fail = 0;
  const describe = n => console.log(`\n── ${n} ──`);
  const assert = (c, msg) => { if (c) pass++; else { fail++; console.error(`  ✗ FAIL: ${msg}`); } };
  runTruncationTests({ describe, assert })
    .then(() => { console.log(`\nTruncation tests: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); })
    .catch(err => { console.error(err); process.exit(1); });
}
