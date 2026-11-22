/**
 * Metered Anthropic calls — charge usage at the response boundary.
 *
 * These wrappers send exactly the request they are given (same model,
 * params, prompts, cache_control, tools, SDK retry settings); they only
 * observe the usage that comes back and charge it to the meter BEFORE the
 * caller parses anything. Agent code that throws on malformed JSON, a
 * max_tokens stop, or any downstream error can therefore no longer drop
 * tokens that were already billed.
 *
 * Streaming caveat this file exists to fix: @anthropic-ai/sdk 0.39's
 * MessageStream.finalMessage() copies only output_tokens from the
 * message_delta event. The cumulative cache counts and
 * server_tool_use.web_search_requests that the API reports there were
 * discarded, so web searches were never charged. meteredStream listens to
 * the raw stream events and merges every cumulative usage field itself.
 */

import { randomUUID } from 'crypto';
import { meter as defaultMeter, mergeUsage, failureIsUnbilled } from './usage-meter.js';

function recordFailure(m, err, model, agent) {
  if (failureIsUnbilled(err)) return null; // API error response — not billed
  return m.chargeUnknown({
    model,
    agent,
    reason: `request failed without usage: ${err?.name || 'Error'}: ${err?.message || err}`,
  });
}

/** client.messages.create(params), charged on return. */
export async function meteredCreate(client, params, { agent = null, meter = defaultMeter } = {}) {
  const who = agent || meter.currentAgent();
  let response;
  try {
    response = await client.messages.create(params);
  } catch (err) {
    recordFailure(meter, err, params.model, who);
    throw err;
  }
  meter.chargeResponse({ model: params.model, usage: response?.usage, responseId: response?.id, agent: who });
  return response;
}

/**
 * client.messages.stream(params).finalMessage(), charged on return.
 * The returned message's `usage` is replaced by the merged cumulative
 * usage (input, cache, output, server_tool_use), so any caller that reads
 * it sees the same numbers the meter charged.
 */
//
// Every observed usage update (message_start, each message_delta) is
// charged immediately as an in-progress PARTIAL observation under the
// message id, so it is in the journal even if the process is killed before
// finalMessage() resolves. Each later observation — and finally the
// complete record — replaces it (cumulative per id, never summed). An
// in-progress or broken-stream amount is labelled a lower bound.
export async function meteredStream(client, params, { agent = null, meter = defaultMeter } = {}) {
  const who = agent || meter.currentAgent();
  const acc = { id: null, usage: null, key: null };
  let stream;
  try {
    stream = client.messages.stream(params);
  } catch (err) {
    recordFailure(meter, err, params.model, who);
    throw err;
  }
  const observe = (update) => {
    acc.usage = mergeUsage(acc.usage, update);
    acc.key ||= acc.id || `stream-${randomUUID()}`;
    meter.chargeResponse({
      model: params.model, usage: acc.usage, responseId: acc.key, agent: who,
      partial: true, note: 'in-progress stream observation (lower bound)',
    });
  };
  stream.on('streamEvent', (event) => {
    if (!event || typeof event !== 'object') return;
    if (event.type === 'message_start' && event.message) {
      acc.id = event.message.id || acc.id;
      if (event.message.usage) observe(event.message.usage);
    } else if (event.type === 'message_delta' && event.usage) {
      observe(event.usage);
    }
  });

  let final;
  try {
    final = await stream.finalMessage();
  } catch (err) {
    if (acc.usage) {
      // The model started generating: input (and any output so far) is
      // billed. Charge what the stream reported, flagged partial — a lower
      // bound, since output after the last received event is not counted.
      meter.chargeResponse({
        model: params.model, usage: acc.usage, responseId: acc.key, agent: who,
        partial: true, note: `stream error (lower bound): ${err?.message || err}`,
      });
    } else {
      recordFailure(meter, err, params.model, who);
    }
    throw err;
  }

  // A returned message with absent/null/empty usage stays UNKNOWN:
  // mergeUsage(undefined, null) is {}, which normalizeUsage treats as "no
  // usage observed", never as a known $0.
  const usage = mergeUsage(final?.usage, acc.usage);
  if (final) final.usage = usage;
  meter.chargeResponse({ model: params.model, usage, responseId: acc.key || final?.id || null, agent: who });
  return final;
}
