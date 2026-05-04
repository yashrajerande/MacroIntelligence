/**
 * CriticReviewer — Stress-tests the StrategyAdvisor's draft. Returns
 * verdict PASS or REVISE; if REVISE, the orchestrator runs one revision
 * pass before publishing.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import { UNIVERSE } from '../skills/universe.js';
import { scanBannedNames } from '../../../src/utils/banned-names.js';

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
  throw new Error('[CriticReviewer] no JSON in response');
}

const REQUIRED_TABLES = [
  'power_dashboard',
  'power_map',
  'debt_wall',
  'execution_receipts',
  'momentum',
  'future_dominance',
  'control_map',
];

function deterministicChecks(draft) {
  const blockers = [];
  for (const tbl of REQUIRED_TABLES) {
    const rows = draft?.[tbl] || [];
    const groups = new Set(rows.map(r => r.group));
    const missing = UNIVERSE.filter(g => !groups.has(g));
    if (missing.length) {
      blockers.push(`Table "${tbl}" is missing groups: ${missing.join(', ')}.`);
    }
  }
  const ranking = draft?.ranking || {};
  const placed = new Set([
    ...(ranking.tier1 || []).map(r => r.group),
    ...(ranking.tier2 || []).map(r => r.group),
    ...(ranking.tier3 || []).map(r => r.group),
    ...(ranking.tier4 || []).map(r => r.group),
  ]);
  const unplaced = UNIVERSE.filter(g => !placed.has(g));
  if (unplaced.length) {
    blockers.push(`Ranking is missing groups: ${unplaced.join(', ')}.`);
  }

  const banned = [
    'cautiously optimistic',
    'remains to be seen',
    'going forward',
    'amid uncertainty',
    'robust growth',
    'headwinds and tailwinds',
    'on the back of',
  ];
  const blob = JSON.stringify(draft).toLowerCase();
  const hits = banned.filter(p => blob.includes(p));
  if (hits.length) blockers.push(`Banned phrases detected: ${hits.join(', ')}.`);

  // Named-voice leak detector — persona anchors must not appear in output.
  const nameLeaks = scanBannedNames(JSON.stringify(draft));
  if (nameLeaks.length) {
    blockers.push(
      `Persona-anchor names leaked into output: ${nameLeaks.join(', ')}. ` +
      `These are private analytical anchors and must never appear in the published report.`,
    );
  }

  return blockers;
}

export class CriticReviewer {
  async review({ draft, cycleLabel }) {
    const start = Date.now();

    const deterministic = deterministicChecks(draft);

    const prompt = `CYCLE: ${cycleLabel}

DETERMINISTIC PRE-CHECK FINDINGS (already failed — do not contradict):
${deterministic.length ? deterministic.map(b => '- ' + b).join('\n') : '(none)'}

DRAFT FROM STRATEGY ADVISOR:
${JSON.stringify(draft, null, 2)}

Apply your Persona's review discipline. Return verdict PASS only if every
score reconciles, every commentary line carries a fact, and no banned
phrases survived. Otherwise REVISE with specific blockers.`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      temperature: 0.1,
      system: [{ type: 'text', text: persona, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: prompt }],
    });

    const tokens = {
      input: response.usage?.input_tokens || 0,
      output: response.usage?.output_tokens || 0,
    };
    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const data = extractJSON(text);

    if (deterministic.length) {
      data.verdict = 'REVISE';
      data.blockers = [...deterministic, ...(data.blockers || [])];
    }

    const latency = Date.now() - start;
    console.log(
      `[CriticReviewer] ${data.verdict} · ${data.blockers?.length || 0} blockers · ${latency}ms`,
    );

    return {
      data,
      meta: {
        agent: 'CriticReviewer',
        model: 'claude-sonnet-4-6',
        latency_ms: latency,
        tokens,
      },
    };
  }
}
