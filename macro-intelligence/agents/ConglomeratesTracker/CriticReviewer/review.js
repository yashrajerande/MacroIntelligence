/**
 * CriticReviewer — Stress-tests the StrategyAdvisor's draft. Returns
 * verdict PASS or REVISE; if REVISE, the orchestrator runs one revision
 * pass before publishing.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import { UNIVERSE } from '../skills/universe.js';
import { scanBannedNames } from '../../../src/utils/banned-names.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const persona = readFileSync(join(__dirname, 'Persona.md'), 'utf-8');
const LOG_DIR = join(__dirname, '..', '..', '..', 'logs');
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

function dumpRawResponse(text, response, label) {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const path = join(LOG_DIR, `critic-${label}-${ts}.txt`);
    const out = `# CriticReviewer ${label}\n` +
      `# stop_reason: ${response?.stop_reason || 'unknown'}\n` +
      `# input_tokens: ${response?.usage?.input_tokens}\n` +
      `# output_tokens: ${response?.usage?.output_tokens}\n` +
      `# raw_length: ${text.length}\n\n${text}\n`;
    writeFileSync(path, out);
    console.error(`[CriticReviewer] Raw response dumped to ${path}`);
  } catch (err) {
    console.error(`[CriticReviewer] Failed to dump raw response: ${err.message}`);
  }
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
  async review({ draft, cycleLabel, priorBlockers }) {
    const start = Date.now();

    const deterministic = deterministicChecks(draft);

    const priorBlock = priorBlockers?.length
      ? `PREVIOUS BLOCKERS (you raised these on the prior draft — this draft is a revision):
${priorBlockers.map(b => '- ' + b).join('\n')}

For each previous blocker, FIRST verify whether the revision addressed it.
A blocker that has been fixed must NOT be re-raised. Only raise a previous
blocker again if the offending text is verbatim still present. New blockers
require new defects.

` : '';

    const prompt = `CYCLE: ${cycleLabel}

${priorBlock}DETERMINISTIC PRE-CHECK FINDINGS (already failed — do not contradict):
${deterministic.length ? deterministic.map(b => '- ' + b).join('\n') : '(none)'}

DRAFT FROM STRATEGY ADVISOR:
${JSON.stringify(draft, null, 2)}

Apply your Persona's review discipline. Return verdict PASS only if every
score reconciles, every commentary line carries a fact, and no banned
phrases survived. Otherwise REVISE with specific blockers.`;

    const stream = client.messages.stream({
      model: 'claude-sonnet-4-6',
      // The draft Sonnet reads is 30-40KB of nested JSON across 21 groups
      // and 8 tables. A REVISE verdict with specific blockers and suggested
      // fixes routinely runs 3-5K output tokens. 4096 truncated mid-JSON
      // on the June 1 cron; 16384 leaves comfortable headroom.
      max_tokens: 16384,
      temperature: 0.1,
      system: [{ type: 'text', text: persona, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: prompt }],
    });
    const response = await stream.finalMessage();

    const tokens = {
      input: response.usage?.input_tokens || 0,
      output: response.usage?.output_tokens || 0,
    };
    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');

    if (response.stop_reason === 'max_tokens') {
      dumpRawResponse(text, response, 'truncated');
      throw new Error(
        `[CriticReviewer] Response hit max_tokens (output_tokens=${response.usage?.output_tokens}). ` +
        `Raw response saved to logs/. Bump max_tokens.`,
      );
    }

    let data;
    try {
      data = extractJSON(text);
    } catch (err) {
      dumpRawResponse(text, response, 'parse-failure');
      throw new Error(`[CriticReviewer] JSON parse failed: ${err.message}. Raw response saved to logs/.`);
    }

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

  /**
   * Red-pen pass. When the Advisor has exhausted its revision passes and a
   * small number of concrete blockers remain, the critic applies its OWN
   * fixes directly to the draft — the entity demanding the change makes the
   * change, instead of sending the manuscript back a third time. The result
   * must still clear the deterministic validators before publishing.
   */
  async applyFixes({ draft, blockers, cycleLabel }) {
    const start = Date.now();

    const prompt = `CYCLE: ${cycleLabel}

You are performing the RED-PEN PASS. The StrategyAdvisor failed to apply
these blockers after two revision attempts. You will now apply them
yourself, directly.

BLOCKERS TO APPLY (yours, from your last review):
${blockers.map(b => '- ' + b).join('\n')}

DRAFT TO EDIT:
${JSON.stringify(draft, null, 2)}

Rules — absolute:
1. Apply EXACTLY the fixes your blockers demand. Where a blocker offers
   replacement text, use it (or the minimal correct variant).
2. Change NOTHING else. Every other field is copied verbatim — same
   scores, same sentences, same numbers.
3. Do NOT add new facts, names, numbers, or commentary.
4. Re-emit the FULL corrected JSON with the exact same schema as the
   draft, wrapped in <<<JSON ... >>>. No prose before or after.`;

    const stream = client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 32768,
      temperature: 0,
      system: [{ type: 'text', text: persona, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: prompt }],
    });
    const response = await stream.finalMessage();

    const tokens = {
      input: response.usage?.input_tokens || 0,
      output: response.usage?.output_tokens || 0,
    };
    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');

    if (response.stop_reason === 'max_tokens') {
      dumpRawResponse(text, response, 'redpen-truncated');
      throw new Error('[CriticReviewer] Red-pen pass hit max_tokens. Raw saved to logs/.');
    }

    let data;
    try {
      data = extractJSON(text);
    } catch (err) {
      dumpRawResponse(text, response, 'redpen-parse-failure');
      throw new Error(`[CriticReviewer] Red-pen JSON parse failed: ${err.message}. Raw saved to logs/.`);
    }

    // The red-pen output must itself be clean on deterministic checks.
    const residual = deterministicChecks(data);
    if (residual.length) {
      throw new Error(
        `[CriticReviewer] Red-pen output failed deterministic checks: ${residual.join(' | ')}`,
      );
    }

    const latency = Date.now() - start;
    console.log(`[CriticReviewer] Red-pen pass applied ${blockers.length} fixes · ${latency}ms`);

    return {
      data,
      meta: {
        agent: 'CriticReviewer(red-pen)',
        model: 'claude-sonnet-4-6',
        latency_ms: latency,
        tokens,
        fixes_applied: blockers.length,
      },
    };
  }
}
