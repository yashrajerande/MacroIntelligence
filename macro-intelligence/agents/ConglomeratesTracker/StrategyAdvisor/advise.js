/**
 * StrategyAdvisor — Senior partner synthesis. One Sonnet call covering
 * all 13 output sections of the scoring framework.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import { UNIVERSE } from '../skills/universe.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const persona = readFileSync(join(__dirname, 'Persona.md'), 'utf-8');
const framework = readFileSync(
  join(__dirname, '..', 'skills', 'scoring-framework.md'),
  'utf-8',
);
const LOG_DIR = join(__dirname, '..', '..', '..', 'logs');
const client = new Anthropic();

function extractJSON(text) {
  const tagged = text.match(/<<<JSON\s*([\s\S]*?)\s*>>>/);
  if (tagged) return JSON.parse(tagged[1]);
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return JSON.parse(fenced[1]);
  const naked = text.match(/\{[\s\S]*\}/);
  if (naked) return JSON.parse(naked[0]);
  throw new Error('[StrategyAdvisor] no JSON in response');
}

function dumpRawResponse(text, response, label) {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const path = join(LOG_DIR, `advisor-${label}-${ts}.txt`);
    const stopReason = response?.stop_reason || 'unknown';
    const out = `# StrategyAdvisor ${label}\n` +
      `# stop_reason: ${stopReason}\n` +
      `# input_tokens: ${response?.usage?.input_tokens}\n` +
      `# output_tokens: ${response?.usage?.output_tokens}\n` +
      `# raw_length: ${text.length}\n\n${text}\n`;
    writeFileSync(path, out);
    console.error(`[StrategyAdvisor] Raw response dumped to ${path}`);
    return path;
  } catch (err) {
    console.error(`[StrategyAdvisor] Failed to dump raw response: ${err.message}`);
    return null;
  }
}

function summariseFindings(findings) {
  return findings
    .map(f => {
      if (!f.moves?.length) return `- ${f.group}: NO MATERIAL MOVEMENT`;
      const lines = f.moves
        .slice(0, 6)
        .map(
          m =>
            `    · [${m.date || '—'}] ${m.category || '?'} — ${m.headline || ''}` +
            (m.value_inr_cr ? ` (₹${m.value_inr_cr} cr)` : '') +
            (m.value_usd_mn ? ` ($${m.value_usd_mn}M)` : '') +
            ` — ${m.source || 'src?'}`,
        )
        .join('\n');
      return `- ${f.group}:\n${lines}`;
    })
    .join('\n');
}

function summarisePrior(prior) {
  if (!prior?.power_dashboard?.length) return 'No prior cycle. Treat all deltas as 0.';
  return prior.power_dashboard
    .map(
      r =>
        `${r.group}: V${r.vision?.score} T${r.talent?.score} E${r.exec?.score} ` +
        `Tr${r.trust?.score} A${r.access?.score} Ed${r.edge?.score} C${r.capital?.score}`,
    )
    .join('\n');
}

export class StrategyAdvisor {
  async advise({ findings, prior, cycleLabel, windowStart, windowEnd, critique }) {
    const start = Date.now();

    const prompt = `${critique ? `REVISION REQUEST FROM CRITIC REVIEWER:\n${critique}\n\nApply these fixes and re-emit the FULL JSON. Do not partial-update.\n\n` : ''}CYCLE: ${cycleLabel}
WINDOW: ${windowStart} → ${windowEnd}
UNIVERSE (${UNIVERSE.length} groups): ${UNIVERSE.join(', ')}

═══════════════════════════════════════════════════
SCORING FRAMEWORK (canonical rubric — do not deviate):
═══════════════════════════════════════════════════
${framework}

═══════════════════════════════════════════════════
RESEARCH ANALYST FINDINGS (last 30-60 days):
═══════════════════════════════════════════════════
${summariseFindings(findings)}

═══════════════════════════════════════════════════
PRIOR CYCLE SCORES (use to compute deltas):
═══════════════════════════════════════════════════
${summarisePrior(prior)}

═══════════════════════════════════════════════════
TASK
═══════════════════════════════════════════════════
Produce the FULL cycle output for all 13 sections per your Persona's
Output Contract. Every group in the universe must appear in: power_dashboard,
power_map, debt_wall, execution_receipts, momentum, future_dominance,
control_map, ranking (exactly one tier each), and typology (exactly one
bucket each).

The "moves" section must include only groups with material movement; if
no group moved meaningfully this cycle, return an empty moves array AND
a red_flags entry noting the unusually quiet cycle.

Wrap the JSON in <<<JSON ... >>>.`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      // 21 groups × 8 tables × commentary fields ≈ 12-15K output tokens.
      // 8192 truncates mid-JSON; 32768 leaves comfortable headroom.
      max_tokens: 32768,
      temperature: 0.25,
      system: [{ type: 'text', text: persona, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: prompt }],
    });

    const tokens = {
      input: response.usage?.input_tokens || 0,
      output: response.usage?.output_tokens || 0,
    };
    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');

    if (response.stop_reason === 'max_tokens') {
      dumpRawResponse(text, response, 'truncated');
      throw new Error(
        `[StrategyAdvisor] Response hit max_tokens (output_tokens=${response.usage?.output_tokens}). ` +
        `Raw response saved to logs/. Bump max_tokens or split the call.`,
      );
    }

    let data;
    try {
      data = extractJSON(text);
    } catch (err) {
      dumpRawResponse(text, response, 'parse-failure');
      throw new Error(`[StrategyAdvisor] JSON parse failed: ${err.message}. Raw response saved to logs/.`);
    }

    const latency = Date.now() - start;
    console.log(
      `[StrategyAdvisor] Done in ${latency}ms. ` +
        `${data.power_dashboard?.length || 0} groups scored, ` +
        `${data.moves?.length || 0} moves, ` +
        `${data.red_flags?.length || 0} red flags.`,
    );

    return {
      data,
      meta: {
        agent: 'StrategyAdvisor',
        model: 'claude-sonnet-4-6',
        latency_ms: latency,
        tokens,
        revision: !!critique,
      },
    };
  }
}
