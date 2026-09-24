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
import { trendSuffix, TREND_GUIDANCE } from '../../../src/utils/trend-context.js';
import { formatSoWhat, hasSoWhatFields, lintSoWhat, inlineOnly } from './skills/so-what-format.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const persona = readFileSync(join(__dirname, 'Persona.md'), 'utf-8');
const styleGuide = readFileSync(join(__dirname, 'skills', 'summary-style.md'), 'utf-8');
const soWhatGuide = readFileSync(join(__dirname, 'skills', 'so-what-format.md'), 'utf-8');
const client = new Anthropic();

// Persona + both skills go in the system prompt. summary-style.md was
// being read and never sent — the model had the persona's voice rules but
// none of the style skill's mandatory rules.
const SYSTEM_PROMPT = `${persona}

════════════════════════════════════════
SKILL: summary-style.md
════════════════════════════════════════
${styleGuide}

════════════════════════════════════════
SKILL: so-what-format.md
════════════════════════════════════════
${soWhatGuide}`;

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

    // Build comprehensive indicator context for richer analysis.
    // API-sourced market prices LAST — they must win the overlap with the
    // LLM web-search set (us_cpi, fed_funds_rate, etc.).
    const allIndicators = {
      ...allData.macroData.data.indicators,
      ...(allData.reData?.data?.indicators || {}),
      ...(allData.leverageData?.data?.indicators || {}),
      ...allData.marketData.data.prices,
    };
    const dynamicRanges = allData.dynamicRanges || null;
    const indicatorSummary = Object.entries(allIndicators)
      .filter(([, v]) => v.value !== null && v.value !== undefined && v.value_str !== 'Awaited')
      .map(([slug, v]) => `${slug}: ${v.value_str || v.value} (prev: ${v.previous ?? '—'}, ${v.direction || 'flat'}, 10y pct: ${v.pct_10y ?? '—'}%)${trendSuffix(slug, dynamicRanges)}`)
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
${TREND_GUIDANCE}
${indicatorSummary}

───────────────────────────────────────────

${hookContext.text}

───────────────────────────────────────────

Write the morning brief. Your Persona.md and summary-style.md define your voice and rules. Follow them precisely.

Return JSON wrapped in <<<JSON and >>> markers:
{
  "verdict_line": "Max 25 words. The single most important tension in TODAY's data — not last quarter's. You are Neelkanth Mishra crossed with Charlie Munger writing in the FT's voice. The hook MUST (a) anchor on a fresh move from the Top Hook Candidates list above, (b) apply Munger inversion or a Mishra high-frequency proxy, (c) contain a specific number, (d) avoid every theme in the BANNED THEMES list, (e) differ in topic from yesterday's hook. NEVER name Mishra/Munger/FT/Economist in the output itself — these are private anchors. If your first draft uses a banned theme, throw it out and try another angle.",

  "regime_narratives": {
    "growth": "2-3 sentences. Apply Mishra: triangulate GDP with IIP, PMI sub-components, core sector, capacity utilisation. Apply Munger: what's the quality of this growth? What breaks?",
    "inflation": "2-3 sentences. Decompose: food vs core vs fuel. What does the gap between headline CPI and core tell you? Apply Munger: if RBI is cutting while food inflation is sticky, what's the second-order effect?",
    "credit": "2-3 sentences. THE most important story today if CD ratio is elevated. Credit-deposit divergence → NBFC funding stress → macro-prudential tightening risk. Apply Munger: what happened last time this ratio was here?",
    "policy": "2-3 sentences. RBI stance vs curve pricing. Real rate trajectory. Apply Mishra: what does the rate signal for housing affordability, corporate capex IRRs, and FX management?",
    "capex": "2-3 sentences. IIP capital goods + capacity utilisation + cement/steel dispatch = actual investment, not press releases. Apply Munger: if capacity utilisation is below 75%, why would private capex accelerate?",
    "consumption": "2-3 sentences. GST as formalization proxy (Mishra insight). Vehicle sales by segment. Apply Munger: is urban discretionary strong while rural staples are weak? What does that divergence predict?"
  },

  "sections": [
    {
      "para_num": 1, "para_label": "India Macro Regime",
      "title": "4-12 words naming the TENSION, not the topic. e.g. 'Growth Headline vs Goods Economy — Services Carry the Load'",
      "facts": ["3-5 bullets. Each: one fact, one number, <strong> around the figure. Open a contradicting bullet with 'But'. Never start with 'The'."],
      "tension": "1-2 sentences, max 45 words. Name the two things that disagree and why.",
      "bottom_line": "1 sentence, max 30 words. A positioning call (overweight/avoid/hedge) OR the one thing to watch with a threshold."
    },
    { "para_num": 2, "para_label": "Global Macro Regime", "title": "...", "facts": ["..."], "tension": "...", "bottom_line": "..." },
    { "para_num": 3, "para_label": "Liquidity Conditions", "title": "...", "facts": ["..."], "tension": "...", "bottom_line": "..." },
    { "para_num": 4, "para_label": "Equity + Real Estate Implications", "title": "...", "facts": ["..."], "tension": "...", "bottom_line": "..." },
    { "para_num": 5, "para_label": "Key Risks to Monitor", "title": "...", "facts": ["risks ranked by probability × impact, one per bullet, each with the number that makes it a risk"], "tension": "...", "bottom_line": "the single data point to watch this week, with its threshold" }
  ]
}

SECTION FORMAT IS NON-NEGOTIABLE: the so-what-format.md skill in your system prompt shows the canonical example. Return the FIELDS (title / facts / tension / bottom_line) — the HTML is assembled for you. Do not return prose paragraphs and do not return HTML blocks. Under 130 words per section; if over, cut a fact, never the bottom line.

REMEMBER: Your persona defines three voices (Mishra, Munger, Economist). USE THEM TO THINK — never to attribute. Every regime narrative must show at least one inversion (Munger), one proxy-vs-headline tension (Mishra), and zero banned phrases (Economist test). The names are your private analytical anchors and MUST NOT appear in the output. Do not write "as Mishra notes", "applying Munger", "in the FT's voice", or any variant. Present every conclusion as your own, unattributed.`;

    const stream = client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      temperature: 0.3,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: prompt }],
    });
    const response = await stream.finalMessage();

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
      paragraphs = parsed.sections || parsed.paragraphs || [];
    }

    // Enforce structure. The "so what" fields are assembled into HTML here
    // (see skills/so-what-format.js) so the layout can never drift; a
    // legacy prose answer still renders via para_html. Structured fields
    // are kept on the object for any consumer that wants them raw.
    const lintProblems = [];
    paragraphs = paragraphs.slice(0, PARA_LABELS.length).map((p, i) => {
      const para_label = PARA_LABELS[i] || p.para_label;
      if (hasSoWhatFields(p)) {
        lintProblems.push(...lintSoWhat(p, para_label));
        return {
          para_num: i + 1,
          para_label,
          para_html: formatSoWhat(p, para_label),
          title: inlineOnly(p.title),
          facts: (Array.isArray(p.facts) ? p.facts : []).map(inlineOnly).filter(Boolean),
          tension: inlineOnly(p.tension),
          bottom_line: inlineOnly(p.bottom_line),
        };
      }
      lintProblems.push(`[${para_label}] answered in legacy prose, not so-what fields`);
      return {
        para_num: i + 1,
        para_label,
        para_html: p.para_html || `<p>${p.text || 'Awaited'}</p>`,
      };
    });
    while (paragraphs.length < PARA_LABELS.length) {
      const i = paragraphs.length;
      lintProblems.push(`[${PARA_LABELS[i]}] missing — model returned ${paragraphs.length} sections`);
      paragraphs.push({ para_num: i + 1, para_label: PARA_LABELS[i], para_html: '<p>Awaited</p>' });
    }
    if (lintProblems.length) {
      console.warn(`[ExecutiveSummaryWriter] So-what lint: ${lintProblems.length} issue(s)`);
      for (const pr of lintProblems) console.warn(`  ↳ ${pr}`);
    }

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
        so_what_lint: lintProblems,
      },
    };
  }
}
