// Anthropic list pricing for the chat Edge Functions (Rabbit Hole, Voice
// Assistant). Mirrors src/utils/usage-meter.js in the pipeline; the two
// budgets stay separate — these functions only write their own
// *_usage tables, never the pipeline's cost-ledger.json.
//
// Source: https://platform.claude.com/docs/en/about-claude/pricing
// (verified 2026-11-22). Claude Haiku 4.5: $1 input / $5 output per MTok;
// 5-minute cache write 1.25x input, 1-hour cache write 2x input, cache
// read 0.1x input; web search $10 per 1,000 searches.

export const PRICING_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5-20251001": { input: 1.0, output: 5.0 },
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
};
export const CACHE_WRITE_5M = 1.25;
export const CACHE_WRITE_1H = 2.0;
export const CACHE_READ = 0.1;
export const WEB_SEARCH_USD_PER_REQUEST = 10 / 1000;

// deno-lint-ignore no-explicit-any
type Usage = Record<string, any> | null | undefined;

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

// Cumulative-usage merge for SSE streams: message_delta usage fields are
// running totals, so a non-null later value REPLACES the earlier one.
export function mergeUsage(base: Usage, update: Usage): Record<string, unknown> {
  // deno-lint-ignore no-explicit-any
  const out: Record<string, any> = base && typeof base === "object" ? { ...base } : {};
  if (!update || typeof update !== "object") return out;
  for (const [k, v] of Object.entries(update)) {
    if (v === null || v === undefined) continue;
    out[k] = typeof v === "object" && !Array.isArray(v) ? mergeUsage(out[k], v) : v;
  }
  return out;
}

// USD cost of one response's usage. input_tokens, cache_creation and
// cache_read are disjoint in the API, so adding them never double counts.
// Cache writes without a TTL split are priced at the 5-minute default.
// Returns null for a model with no price (never silently $0).
export function costOfUsage(model: string, usage: Usage): number | null {
  const r = PRICING_PER_MTOK[model];
  if (!r || !usage) return null;
  const perTok = r.input / 1e6;
  const cc = usage.cache_creation || {};
  let w5 = n(cc.ephemeral_5m_input_tokens);
  const w1 = n(cc.ephemeral_1h_input_tokens);
  const total = Math.max(n(usage.cache_creation_input_tokens), w5 + w1);
  w5 += total - (w5 + w1);
  const cost =
    n(usage.input_tokens) * perTok +
    w5 * perTok * CACHE_WRITE_5M +
    w1 * perTok * CACHE_WRITE_1H +
    n(usage.cache_read_input_tokens) * perTok * CACHE_READ +
    n(usage.output_tokens) * (r.output / 1e6) +
    n(usage.server_tool_use?.web_search_requests) * WEB_SEARCH_USD_PER_REQUEST;
  return Math.round(cost * 1e6) / 1e6;
}
