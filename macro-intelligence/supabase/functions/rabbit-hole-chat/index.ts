import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getSignalContext, getRegimeContext, BANNED_NAMES_RULE } from "../_shared/macro-context.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const DAILY_BUDGET_USD = 2.0;
const MAX_MESSAGES_PER_IP = 20;
const MODEL = "claude-haiku-4-5-20251001";

const PERSONA = `You are the MacroIntelligence Rabbit Hole Analyst. You help users go deeper
into any macro signal or regime dimension from India's daily macro dashboard.

Your analytical DNA combines three voices:

NEELKANTH MISHRA (India structural depth):
- Triangulate official numbers with high-frequency proxies: e-way bills, UPI volumes,
  cement dispatch, auto dealer inventory, two-wheeler registrations
- Understand India's dual economy: formal vs informal, urban vs rural
- Never take government estimates at face value

CHARLIE MUNGER (inversion + second-order effects):
- Always invert FIRST: before any claim, state what would make it wrong
- Trace second-order effects to their logical end
- Use historical analogies with surgical precision
- Spot incentive misalignments

ECONOMIST / FT (prose craft):
- Every sentence must contain a number or a non-obvious insight
- Understated authority over breathless alarm
- Em-dashes for causation chains
- Banned phrases: "remains robust", "cautiously optimistic", "mixed signals",
  "amid uncertainty", "it remains to be seen", "going forward"

RULES:
1. Keep responses under 200 words unless the user asks for more detail
2. Always start with an inversion: what would make this thesis wrong?
3. Cite at least one high-frequency proxy when discussing India data
4. Every claim must include a specific number or date
5. If you don't have data, say "I don't have that data point" — never hallucinate
6. Be conversational but rigorous — the user is smart and wants depth, not fluff
7. ${BANNED_NAMES_RULE.trim()}`;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface RequestBody {
  entry_type: "signal" | "regime";
  entry_id: string;
  run_date: string;
  conversation: Message[];
  question: string;
}

async function checkRateLimit(ip: string): Promise<{ allowed: boolean; reason?: string }> {
  const today = new Date().toISOString().slice(0, 10);

  // Check per-IP limit
  const { count: ipCount } = await supabase
    .from("rabbit_hole_usage")
    .select("*", { count: "exact", head: true })
    .eq("user_ip", ip)
    .eq("run_date", today);

  if ((ipCount || 0) >= MAX_MESSAGES_PER_IP) {
    return { allowed: false, reason: `Daily limit reached (${MAX_MESSAGES_PER_IP} messages/day). Come back tomorrow.` };
  }

  // Check global daily budget
  const { data: costs } = await supabase
    .from("rabbit_hole_usage")
    .select("cost_usd")
    .eq("run_date", today);

  const totalCost = (costs || []).reduce((sum: number, r: any) => sum + (r.cost_usd || 0), 0);
  if (totalCost >= DAILY_BUDGET_USD) {
    return { allowed: false, reason: "Daily budget exhausted. Rabbit holes will reopen tomorrow." };
  }

  return { allowed: true };
}

async function logUsage(
  entryType: string, entryId: string, ip: string,
  messageNum: number, inputTokens: number, outputTokens: number
) {
  const cost = (inputTokens / 1_000_000) * 0.80 + (outputTokens / 1_000_000) * 4.00;
  await supabase.from("rabbit_hole_usage").insert({
    entry_type: entryType,
    entry_id: entryId,
    user_ip: ip,
    message_num: messageNum,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: Math.round(cost * 1_000_000) / 1_000_000,
  });
}

Deno.serve(async (req: Request) => {
  // CORS
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
    const { entry_type, entry_id, run_date, conversation = [], question } = body;

    if (!entry_type || !entry_id || !run_date || !question) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400 });
    }

    // Rate limiting
    const ip = req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "unknown";
    const rateCheck = await checkRateLimit(ip);
    if (!rateCheck.allowed) {
      return new Response(JSON.stringify({ error: rateCheck.reason }), { status: 429 });
    }

    // Assemble context (shared with voice-assistant-chat — see _shared/macro-context.ts)
    let context: string;
    if (entry_type === "signal") {
      const sigNum = parseInt(entry_id.replace("sig", ""), 10);
      context = await getSignalContext(supabase, sigNum, run_date);
    } else if (entry_type === "regime") {
      context = await getRegimeContext(supabase, entry_id, run_date);
    } else {
      return new Response(JSON.stringify({ error: "Invalid entry_type" }), { status: 400 });
    }

    // Build messages
    const systemPrompt = `${PERSONA}\n\n--- TODAY'S CONTEXT (${run_date}) ---\n${context}`;

    const messages: Message[] = [
      ...conversation.slice(-10), // Keep last 10 messages for context window
      { role: "user", content: question },
    ];

    const messageNum = conversation.filter((m) => m.role === "user").length + 1;

    // Call Anthropic with streaming
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: systemPrompt,
        messages,
        stream: true,
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error("Anthropic error:", anthropicRes.status, errText);
      return new Response(JSON.stringify({ error: "AI service error" }), { status: 502 });
    }

    // Stream the response through to the client
    const encoder = new TextEncoder();
    let inputTokens = 0;
    let outputTokens = 0;

    const stream = new ReadableStream({
      async start(controller) {
        const reader = anthropicRes.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              const data = line.slice(6).trim();
              if (data === "[DONE]") continue;

              try {
                const event = JSON.parse(data);

                if (event.type === "content_block_delta" && event.delta?.text) {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`));
                }

                if (event.type === "message_delta" && event.usage) {
                  outputTokens = event.usage.output_tokens || 0;
                }

                if (event.type === "message_start" && event.message?.usage) {
                  inputTokens = event.message.usage.input_tokens || 0;
                }
              } catch {
                // Skip unparseable lines
              }
            }
          }

          // Log usage after stream completes
          await logUsage(entry_type, entry_id, ip, messageNum, inputTokens, outputTokens);

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, usage: { input_tokens: inputTokens, output_tokens: outputTokens } })}\n\n`));
          controller.close();
        } catch (err) {
          console.error("Stream error:", err);
          controller.error(err);
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    console.error("Handler error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500 });
  }
});
