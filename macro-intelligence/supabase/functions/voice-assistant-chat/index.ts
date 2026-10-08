// Voice Assistant — the spoken-word front door to the day's published
// dashboard. See agents/VoiceAssistant/Persona.md for the full brief.
//
// Differs from rabbit-hole-chat in three ways, each driven by the car
// use case:
//   1. Context is the WHOLE published day (getFullDayContext), not one
//      pre-tapped signal or regime — a spoken question can span domains
//      a reader would have had to pick a single card to ask about.
//   2. "Go deeper" is a TOOL the model calls mid-conversation
//      (get_signal_detail / get_regime_detail), driven by what the
//      driver says, not by a UI element they tapped. The tools are
//      backed by the exact same functions Rabbit Hole uses on screen.
//   3. Non-streaming: a tool-use round trip (model → tool call → tool
//      result → final answer) is far simpler to get right as one
//      request/response than interleaved with SSE. A voice reply is
//      short by design (see the Persona's word limits), so the extra
//      latency is a non-issue; this is a candidate for a Phase 2
//      streaming upgrade once the question/answer shape is proven.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getSignalContext, getRegimeContext, getFullDayContext, BANNED_NAMES_RULE } from "../_shared/macro-context.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// A drive can run many short turns ("what's the highlight", "go deeper
// on that", "what about real estate") — budget for turn COUNT, not for
// one long essay. Full-day context is bigger than Rabbit Hole's
// per-card slice, so the per-message cost is higher; the daily cap is
// sized accordingly and is independent of Rabbit Hole's own cap so
// neither feature can starve the other's budget.
const DAILY_BUDGET_USD = 3.0;
const MAX_MESSAGES_PER_IP = 40;
const MAX_TOOL_ROUNDS = 3;
const MODEL = "claude-haiku-4-5-20251001";

const PERSONA = `You are the MacroIntelligence Voice Assistant. A driver presses one
button, asks a question out loud, and you answer out loud. You are not
writing for a screen — you are talking to someone whose eyes are on the
road.

Your analytical DNA combines three voices:

NEELKANTH MISHRA (India structural depth):
- Triangulate official numbers with high-frequency proxies: e-way bills, UPI volumes,
  cement dispatch, auto dealer inventory, two-wheeler registrations
- Understand India's dual economy: formal vs informal, urban vs rural
- Never take government estimates at face value

CHARLIE MUNGER (inversion + second-order effects):
- Always invert FIRST: before any claim, state what would make it wrong
- Trace second-order effects to their logical end
- Spot incentive misalignments

ECONOMIST / FT (prose craft, adapted for the ear not the eye):
- Every sentence must contain a number or a non-obvious insight
- Understated authority over breathless alarm
- Banned phrases: "remains robust", "cautiously optimistic", "mixed signals",
  "amid uncertainty", "it remains to be seen", "going forward"

SPOKEN-WORD OUTPUT RULES (these override any text-writing convention):
1. Lead with the number, then the one-sentence takeaway. No headline, no
   bullet list, no markdown, no asterisks — say it the way you'd say it
   to a person in the car with you.
2. Short sentences. One idea per sentence.
3. Answer first, THEN offer depth: "...that's the deposit-gap story. Want
   me to go deeper on it?"
4. Never say "as the table shows," "see the chart," "the green badge" —
   there is no chart, there is only your voice.
5. Units stay in the sentence, spoken naturally — "ninety-six point one
   five rupees to the dollar," not a bare symbol.
6. If you don't have the data, say so plainly. Never hallucinate because
   silence feels awkward.
7. Under 60 words unless the driver asks for more detail. "Give me the
   highlights" means one headline sentence per section of today's
   executive summary, not the full detail read verbatim.
8. ${BANNED_NAMES_RULE.trim()}

GOING DEEPER — TOOLS:
You have two tools: get_signal_detail and get_regime_detail. When the
driver asks to go deeper on something named in today's overview — a
specific signal or a specific regime dimension (growth, inflation,
credit, policy, capex, consumption) — CALL the matching tool rather than
guessing from memory or from what's already in your context. These
tools run the exact same lookup a reader gets by tapping that card on
screen. Do not call a tool for a topic that isn't one of today's named
signals or regime dimensions — answer from the overview context instead,
or say you don't have a deeper breakdown for that topic.`;

const TOOLS = [
  {
    name: "get_signal_detail",
    description: "Fetch the full detail and 30-day related-indicator history for one of today's 7 numbered signals. Use when the driver asks to go deeper on a signal named in the overview.",
    input_schema: {
      type: "object",
      properties: { signal_num: { type: "integer", minimum: 1, maximum: 7, description: "The signal number (1-7) from today's overview." } },
      required: ["signal_num"],
    },
  },
  {
    name: "get_regime_detail",
    description: "Fetch the full detail and 30-day related-indicator history for one of today's 6 regime dimensions. Use when the driver asks to go deeper on growth, inflation, credit, policy, capex, or consumption.",
    input_schema: {
      type: "object",
      properties: { dimension: { type: "string", enum: ["growth", "inflation", "credit", "policy", "capex", "consumption"] } },
      required: ["dimension"],
    },
  },
];

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface RequestBody {
  run_date: string;
  conversation: Message[];
  question: string;
}

async function checkRateLimit(ip: string): Promise<{ allowed: boolean; reason?: string }> {
  const today = new Date().toISOString().slice(0, 10);

  const { count: ipCount } = await supabase
    .from("voice_assistant_usage")
    .select("*", { count: "exact", head: true })
    .eq("user_ip", ip)
    .eq("run_date", today);

  if ((ipCount || 0) >= MAX_MESSAGES_PER_IP) {
    return { allowed: false, reason: `Daily limit reached (${MAX_MESSAGES_PER_IP} messages/day). Come back tomorrow.` };
  }

  const { data: costs } = await supabase
    .from("voice_assistant_usage")
    .select("cost_usd")
    .eq("run_date", today);

  const totalCost = (costs || []).reduce((sum: number, r: any) => sum + (r.cost_usd || 0), 0);
  if (totalCost >= DAILY_BUDGET_USD) {
    return { allowed: false, reason: "Daily voice budget exhausted. The assistant reopens tomorrow." };
  }

  return { allowed: true };
}

async function logUsage(ip: string, messageNum: number, inputTokens: number, outputTokens: number) {
  const cost = (inputTokens / 1_000_000) * 0.80 + (outputTokens / 1_000_000) * 4.00;
  await supabase.from("voice_assistant_usage").insert({
    user_ip: ip,
    message_num: messageNum,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: Math.round(cost * 1_000_000) / 1_000_000,
  });
}

async function runTool(name: string, input: any, runDate: string): Promise<string> {
  try {
    if (name === "get_signal_detail") {
      const n = parseInt(input?.signal_num, 10);
      if (!Number.isFinite(n) || n < 1 || n > 7) return "Invalid signal number — must be 1 through 7.";
      return await getSignalContext(supabase, n, runDate);
    }
    if (name === "get_regime_detail") {
      const dim = String(input?.dimension || "");
      return await getRegimeContext(supabase, dim, runDate);
    }
    return `Unknown tool: ${name}`;
  } catch (err) {
    console.error("Tool error:", name, err);
    return "That lookup failed — answer from what you already have, or tell the driver that detail isn't available right now.";
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  try {
    const body: RequestBody = await req.json();
    const { run_date, conversation = [], question } = body;

    if (!run_date || !question) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    }

    const ip = req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "unknown";
    const rateCheck = await checkRateLimit(ip);
    if (!rateCheck.allowed) {
      return new Response(JSON.stringify({ error: rateCheck.reason }), {
        status: 429,
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    }

    const dayContext = await getFullDayContext(supabase, run_date);
    const systemPrompt = `${PERSONA}\n\n--- TODAY'S PUBLISHED DASHBOARD (${run_date}) ---\n${dayContext}`;
    const messageNum = conversation.filter((m) => m.role === "user").length + 1;

    // deno-lint-ignore no-explicit-any
    const messages: any[] = [
      ...conversation.slice(-10),
      { role: "user", content: question },
    ];

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let finalText = "";

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 512,
          system: systemPrompt,
          tools: TOOLS,
          messages,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error("Anthropic error:", res.status, errText);
        return new Response(JSON.stringify({ error: "AI service error" }), {
          status: 502,
          headers: { "Access-Control-Allow-Origin": "*" },
        });
      }

      const data = await res.json();
      totalInputTokens += data.usage?.input_tokens || 0;
      totalOutputTokens += data.usage?.output_tokens || 0;

      if (data.stop_reason === "tool_use") {
        messages.push({ role: "assistant", content: data.content });
        const toolResults = [];
        for (const block of data.content) {
          if (block.type !== "tool_use") continue;
          const result = await runTool(block.name, block.input, run_date);
          toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
        }
        messages.push({ role: "user", content: toolResults });
        continue; // ask the model again with the tool result in hand
      }

      finalText = (data.content || [])
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("");
      break;
    }

    if (!finalText) {
      finalText = "I wasn't able to put together an answer for that one — try asking it a different way.";
    }

    await logUsage(ip, messageNum, totalInputTokens, totalOutputTokens);

    return new Response(JSON.stringify({
      answer: finalText,
      usage: { input_tokens: totalInputTokens, output_tokens: totalOutputTokens },
    }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  } catch (err) {
    console.error("Handler error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  }
});
