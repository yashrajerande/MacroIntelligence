/**
 * Truncation-aware model calls.
 *
 * A response that stops with stop_reason === 'max_tokens' was cut off by
 * the output cap. Parsing it used to surface as a misleading "Failed to
 * extract JSON from response", and the orchestrator's generic retry then
 * re-sent the IDENTICAL request (same prompt, temperature 0, same cap),
 * which truncated again and paid twice — the 24 & 25 NOV 2026 03:00 IST
 * failures (both SignalDetector attempts stopped at exactly 4,096 output
 * tokens).
 *
 * streamUntilComplete() checks stop_reason explicitly:
 *   1. first attempt at params.max_tokens;
 *   2. if truncated and escalateTo > max_tokens, ONE retry at escalateTo;
 *   3. if still truncated, throw OutputTruncatedError (code
 *      'output_truncated'), which resilience.js classifies as 'truncated'
 *      with no further retries — repeating the same capped request cannot
 *      help.
 *
 * Every attempt goes through meteredStream, so each response (including a
 * truncated one) is charged once to the usage meter at the response
 * boundary; the cost guard sees all of them.
 */

import { meteredStream } from './metered-claude.js';
import { meter as defaultMeter } from './usage-meter.js';

export class OutputTruncatedError extends Error {
  constructor({ agent, maxTokens, outputTokens }) {
    super(`[${agent}] Model output truncated at max_tokens=${maxTokens} ` +
      `(output_tokens=${outputTokens ?? 'unknown'}) — response incomplete, not parsed`);
    this.name = 'OutputTruncatedError';
    this.code = 'output_truncated';
    this.agent = agent;
    this.maxTokens = maxTokens;
    this.outputTokens = outputTokens ?? null;
  }
}

export function isTruncated(response) {
  return response?.stop_reason === 'max_tokens';
}

export async function streamUntilComplete(client, params, { agent, escalateTo = null, meter = defaultMeter } = {}) {
  let response = await meteredStream(client, params, { agent, meter });
  if (!isTruncated(response)) return response;

  let cap = params.max_tokens;
  if (escalateTo && escalateTo > cap) {
    console.warn(`[${agent}] Output hit max_tokens=${cap} (output_tokens=${response.usage?.output_tokens}) — retrying once with max_tokens=${escalateTo}`);
    cap = escalateTo;
    response = await meteredStream(client, { ...params, max_tokens: cap }, { agent, meter });
    if (!isTruncated(response)) return response;
  }
  throw new OutputTruncatedError({ agent, maxTokens: cap, outputTokens: response.usage?.output_tokens });
}
