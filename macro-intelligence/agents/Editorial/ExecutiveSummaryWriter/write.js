/**
 * ExecutiveSummaryWriter — Uses claude-sonnet-4-6 for dense prose.
 *
 * Verdict-line (hook) writing is gated by the Hook Writer Skill
 * (src/utils/hook-writer.js), which:
 *   - loads the history of the last 30 verdict lines
 *   - extracts themes and bans any used 2+ times in the past week
 *   - scores every indicator on freshness × magnitude × novelty
 *   - builds a prompt-ready context block of fresh candidates
 *
 * After Sonnet produces the verdict line, we record it back to history so
 * tomorrow's run sees it in the banned themes. This is the ONLY way to
 * stop the writer from looping on the same structural story for weeks.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import {
  loadHookHistory,
  recordHook,
  buildHookContext,
} from '../../../src/utils/hook-writer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const persona = readFileSync(join(__dirname, 'Persona.md'), 'utf-8');
const styleGuide = readFileSync(join(__dirname, 'skills', 'summary-style.md'), 'utf-8');
const client = new Anthropic();

const PARA_LABELS = [
  'India Macro Regime',
  'Global Macro Regime',
  'Liquidity Conditions',
  'Equity + Real Estate Implications',
  'Key Risks to Monitor',
];

export class ExecutiveSummaryWriter {
  async write(allData) {
    const start = Date.now();

    const regimeSummary = allData.regime.data.map(r =>
      `${r.dimension} [${r.badge_type}]: ${r.metric_summary} — ${r.signal_text}`
    ).join('\n');

    const signalSummary = allData.signals.data.map(s =>
      `Sig${s.signal_num} [${s.status}]: ${s.title} — ${s.data_text}`
    ).join('\n');

    const scenarioSummary = `Base: ${allData.scenarios.data.base.name} — ${allData.scenarios.data.base.description}
Bull: ${allData.scenarios.data.bull.name} — ${allData.scenarios.data.bull.description}
Bear: ${allData.scenarios.data.bear.name} — ${allData.scenarios.data.bear.description}`;

    // Build comprehensive indicator context for richer analysis
    const allIndicators = {
      ...allData.marketData.data.prices,
      ...allData.macroData.data.indicators,
      ...(allData.reData?.data?.indicators || {}),
    };
    const indicatorSummary = Object.entries(allIndicators)
      .filter(([, v]) => v.value !== null && v.value !== undefined && v.value_str !== 'Awaited')
      .map(([slug, v]) => `${slug}: ${v.value_str || v.value} (prev: ${v.previous ?? '—'}, ${v.direction || 'flat'}, 10y pct: ${v.pct_10y ?? '—'}%)`)
      .join('\n');

    // ── Hook Writer Skill: freshness + anti-repetition context ──
    const hookHistory = loadHookHistory();
    const indicatorsForHook = Object.entries(allIndicators)
      .filter(([, v]) => v.value !== null && v.value !== undefined && v.value_str !== 'Awaited')
      .map(([slug, v]) => ({
        indicator_slug: slug,
        indicator_name: v.name || v.indicator_name || slug,
        latest_value: v.value_str || v.value,
        latest_numeric: typeof v.value === 'number' ? v.value : Number(v.value),
        pct_10y: v.pct_10y,
        direction: v.direction,
      }));
    const hookContext = buildHookContext(indicatorsForHook, hookHistory, { topN: 12 });

    const prompt = `DATE: ${allData.dateStr}

HERE IS TODAY'S COMPLETE DATA SET. Use these numbers — do not invent any.

REGIME CLASSIFICATION (deterministic — your job is to EXPLAIN why, not repeat):
${regimeSummary}

SIGNAL CARDS:
${signalSummary}

SCENARIOS:
${scenarioSummary}

ALL ${Object.keys(allIndicators).length} INDICATORS:
${indicatorSummary}

───────────────────────────────────────────

${hookContext.text}

───────────────────────────────────────────

Write the morning brief. Your Persona.md and summary-style.md define your voice and rules. Follow them precisely.

Return JSON wrapped in <<<JSON and >>> markers:
{
  "verdict_line": "Max 25 words. The single most important tension in TODAY's data — not last quarter's. You are Neelkanth Mishra crossed with Charlie Munger writing in the FT's voice. The hook MUST (a) anchor on a fresh move from the Top Hook Candidates list above, (b) apply Munger inversion or a Mishra high-frequency proxy, (c) contain a specific number, (d) avoid every theme in the BANNED THEMES list, (e) differ in topic from yesterday's hook. If your first draft uses a banned theme, throw it out and try another angle.",

  "regime_narratives": {
    "growth": "2-3 sentences. Apply Mishra: triangulate GDP with IIP, PMI sub-components, core sector, capacity utilisation. Apply Munger: what's the quality of this growth? What breaks?",
    "inflation": "2-3 sentences. Decompose: food vs core vs fuel. What does the gap between headline CPI and core tell you? Apply Munger: if RBI is cutting while food inflation is sticky, what's the second-order effect?",
    "credit": "2-3 sentences. THE most important story today if CD ratio is elevated. Credit-deposit divergence → NBFC funding stress → macro-prudential tightening risk. Apply Munger: what happened last time this ratio was here?",
    "policy": "2-3 sentences. RBI stance vs curve pricing. Real rate trajectory. Apply Mishra: what does the rate signal for housing affordability, corporate capex IRRs, and FX management?",
    "capex": "2-3 sentences. IIP capital goods + capacity utilisation + cement/steel dispatch = actual investment, not press releases. Apply Munger: if capacity utilisation is below 75%, why would private capex accelerate?",
    "consumption": "2-3 sentences. GST as formalization proxy (Mishra insight). Vehicle sales by segment. Apply Munger: is urban discretionary strong while rural staples are weak? What does that divergence predict?"
  },

  "paragraphs": [
    { "para_num": 1, "para_label": "India Macro Regime", "para_html": "<p>...</p>" },
    { "para_num": 2, "para_label": "Global Macro Regime", "para_html": "<p>...</p>" },
    { "para_num": 3, "para_label": "Liquidity Conditions", "para_html": "<p>...</p>" },
    { "para_num": 4, "para_label": "Equity + Real Estate Implications", "para_html": "<p>...</p>" },
    { "para_num": 5, "para_label": "Key Risks to Monitor", "para_html": "<p>...</p>" }
  ]
}

REMEMBER: Your persona defines three voices (Mishra, Munger, Economist). USE THEM. Every regime narrative must show at least one inversion (Munger), one proxy-vs-headline tension (Mishra), and zero banned phrases (Economist test).`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      temperature: 0.3,
      system: [{ type: 'text', text: persona, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: prompt }],
    });

    const tokens = { input: response.usage?.input_tokens || 0, output: response.usage?.output_tokens || 0 };
    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');

    let parsed;
    const jsonMatch = text.match(/<<<JSON\s*([\s\S]*?)\s*>>>/) || text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
    } else {
      throw new Error('[ExecutiveSummaryWriter] Failed to extract JSON from response');
    }

    // Handle both old format (array) and new format (object with verdict_line + regime_narratives)
    let verdictLine = '';
    let regimeNarratives = {};
    let paragraphs;
    if (Array.isArray(parsed)) {
      paragraphs = parsed;
    } else {
      verdictLine = parsed.verdict_line || '';
      regimeNarratives = parsed.regime_narratives || {};
      paragraphs = parsed.paragraphs || [];
    }

    // Enforce structure
    paragraphs = paragraphs.map((p, i) => ({
      para_num: i + 1,
      para_label: PARA_LABELS[i] || p.para_label,
      para_html: p.para_html || `<p>${p.text || 'Awaited'}</p>`,
    }));

    // Persist the verdict line to hook history so tomorrow's run bans
    // today's theme. Use the Top Hook Candidate slugs as the initial
    // referenced set (Sonnet almost always anchors on one of them now).
    if (verdictLine && allData.dateStr) {
      try {
        const topCandidateSlugs = hookContext.candidates.slice(0, 5).map(c => c.slug);
        recordHook(allData.dateStr, verdictLine, topCandidateSlugs);
        console.log(`[ExecutiveSummaryWriter] Recorded hook to history (${topCandidateSlugs.length} candidate slugs).`);
      } catch (e) {
        console.warn(`[ExecutiveSummaryWriter] Failed to record hook history: ${e.message}`);
      }
    }

    const latency = Date.now() - start;
    console.log(`[ExecutiveSummaryWriter] Done in ${latency}ms. 5 paragraphs.`);
    if (verdictLine) console.log(`[ExecutiveSummaryWriter] Verdict: ${verdictLine}`);
    if (hookContext.banned_themes.length) {
      console.log(`[ExecutiveSummaryWriter] Banned themes this run: ${hookContext.banned_themes.join(', ')}`);
    }

    return {
      data: paragraphs,
      verdict_line: verdictLine,
      regime_narratives: regimeNarratives,
      meta: {
        agent: 'ExecutiveSummaryWriter',
        model: 'claude-sonnet-4-6',
        latency_ms: latency,
        tokens,
        hook_banned_themes: hookContext.banned_themes,
        hook_top_candidates: hookContext.candidates.slice(0, 5).map(c => c.slug),
      },
    };
  }
}
