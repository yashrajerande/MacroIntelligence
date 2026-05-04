/**
 * ResearchAnalyst — Per-group evidence collection via web_search.
 * One Haiku call per group, sequenced to keep rate limits and cost predictable.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import { UNIVERSE } from '../skills/universe.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const persona = readFileSync(join(__dirname, 'Persona.md'), 'utf-8');
const client = new Anthropic();

function extractJSON(text) {
  const tagged = text.match(/<<<JSON\s*([\s\S]*?)\s*>>>/);
  if (tagged) return JSON.parse(tagged[1]);
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return JSON.parse(fenced[1]);
  const naked = text.match(/\{[\s\S]*\}/);
  if (naked) return JSON.parse(naked[0]);
  throw new Error('[ResearchAnalyst] no JSON in response');
}

async function researchOne(group, windowStart, windowEnd, logger) {
  const start = Date.now();
  const prompt = `GROUP: ${group}
WINDOW: ${windowStart} to ${windowEnd}

Search for material strategic developments in this window for the ${group}
group of companies (India). Material = capex >₹5,000 cr, M&A >$200M,
financing >₹2,000 cr, top-three executive change, regulatory enforcement,
one-notch+ rating action, NCLT/court order with strategic bearing.

Return your findings in the exact JSON contract from your Persona, wrapped
in <<<JSON ... >>>. If no material movement, return moves=[] and
no_material_movement=true.`;

  let response;
  try {
    response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      temperature: 0.1,
      system: [{ type: 'text', text: persona, cache_control: { type: 'ephemeral' } }],
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }],
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (err) {
    logger?.warn?.(`[ResearchAnalyst] ${group} fetch failed`, err.message);
    return { group, no_material_movement: true, moves: [], error: err.message };
  }

  const tokens = {
    input: response.usage?.input_tokens || 0,
    output: response.usage?.output_tokens || 0,
  };
  const text = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');

  let parsed;
  try {
    parsed = extractJSON(text);
  } catch (err) {
    logger?.warn?.(`[ResearchAnalyst] ${group} JSON parse failed`, err.message);
    parsed = { group, no_material_movement: true, moves: [], parse_error: true };
  }

  const latency = Date.now() - start;
  console.log(`[ResearchAnalyst] ${group} · ${parsed.moves?.length || 0} moves · ${latency}ms`);
  return { ...parsed, group, _meta: { tokens, latency_ms: latency } };
}

export class ResearchAnalyst {
  async research({ windowStart, windowEnd, logger }) {
    const start = Date.now();
    const findings = [];
    const tokens = { input: 0, output: 0 };

    for (const group of UNIVERSE) {
      const r = await researchOne(group, windowStart, windowEnd, logger);
      findings.push(r);
      if (r._meta?.tokens) {
        tokens.input += r._meta.tokens.input;
        tokens.output += r._meta.tokens.output;
      }
    }

    const totalMoves = findings.reduce((n, f) => n + (f.moves?.length || 0), 0);
    const latency = Date.now() - start;
    console.log(`[ResearchAnalyst] Done. ${UNIVERSE.length} groups · ${totalMoves} moves · ${latency}ms`);

    return {
      data: { window_start: windowStart, window_end: windowEnd, findings },
      meta: {
        agent: 'ResearchAnalyst',
        model: 'claude-haiku-4-5-20251001',
        latency_ms: latency,
        tokens,
        groups_with_moves: findings.filter(f => (f.moves?.length || 0) > 0).length,
      },
    };
  }
}
