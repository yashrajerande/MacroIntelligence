/**
 * ExecutiveSummaryWriter — Uses claude-sonnet-4-6 for dense prose.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';

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

    const prompt = `You are the Chief Investment Strategist writing the morning macro brief. Your audience is India's most demanding capital allocators — CIOs, fund managers, family offices. They will judge every sentence. Generic language is a firing offence.

STYLE GUIDE:
${styleGuide}

TODAY'S REGIME CLASSIFICATION:
${regimeSummary}

SIGNAL CARDS:
${signalSummary}

SCENARIOS:
${scenarioSummary}

ALL INDICATORS (${Object.keys(allIndicators).length} total — use these numbers):
${indicatorSummary}

DATE: ${allData.dateStr}

Return JSON wrapped in <<<JSON and >>> markers with this exact structure:
{
  "verdict_line": "THE single most important macro insight today in one sentence. Max 25 words. Must name specific numbers and the tension between them. Think: what would Ray Dalio or Raghuram Rajan say first in a morning call? Not 'growth is strong' — WHY it matters, what contradiction it reveals, what breaks next.",

  "regime_narratives": {
    "growth": "2-3 sentences. Not just 'GDP is 7.8%' — what does 7.8% GDP MEAN when IIP capital goods is declining? What's the quality of this growth? Where are the cracks? Cross-reference with PMI sub-components, core sector, capacity utilisation.",
    "inflation": "2-3 sentences. The story behind the CPI number. Food vs core vs fuel decomposition. What does the RBI see that the headline doesn't show? Where is inflation pressure building or receding?",
    "credit": "2-3 sentences. The CD ratio story is critical. How does credit growth vs deposit growth create systemic risk? What happens to NBFCs? Is the banking system lending beyond its deposit base?",
    "policy": "2-3 sentences. RBI's actual stance vs market expectations. Rate trajectory. What the repo rate level signals for mortgage markets, corporate borrowing, and FX management.",
    "capex": "2-3 sentences. IIP capital goods + capacity utilisation = is India actually investing or just consuming? Public vs private capex story. Order book evidence.",
    "consumption": "2-3 sentences. GST collections + vehicle sales + airline passengers = demand pulse. Urban vs rural divergence. Discretionary vs staple spending split."
  },

  "paragraphs": [
    { "para_num": 1, "para_label": "India Macro Regime", "para_html": "<p>DENSE paragraph. Lead with the most important number. Use <strong> tags. Every sentence must have a specific number. Connect dots that aren't obvious from the data tables.</p>" },
    { "para_num": 2, "para_label": "Global Macro Regime", "para_html": "<p>Fed, ECB, BOJ policy divergence. US growth vs inflation stickiness. China's trajectory. What global macro means for Indian flows and FX.</p>" },
    { "para_num": 3, "para_label": "Liquidity Conditions", "para_html": "<p>FII/DII balance. SIP flows. Deposit mobilisation. CD ratio stress. System liquidity.</p>" },
    { "para_num": 4, "para_label": "Equity + Real Estate Implications", "para_html": "<p>Nifty valuation vs earnings. Sectoral rotation signals. RE absorption, launches, pricing. REIT yields vs G-Sec spread.</p>" },
    { "para_num": 5, "para_label": "Key Risks to Monitor", "para_html": "<p>Rank by probability × impact. Final sentence: the single most important data point this week.</p>" }
  ]
}

CRITICAL RULES:
- Every sentence must contain at least one specific number from the indicators above.
- Never use generic phrases: "remains robust", "steady growth", "moderate pace", "continues to", "it is worth noting".
- Regime narratives must identify TENSIONS and CONTRADICTIONS — not just describe levels.
- Use em-dashes for causation: "CD ratio 83% — deposits growing 10.8% vs credit 14.3% — a 350bps gap that compounds quarterly".
- Be opinionated. Take a position. What matters and what doesn't.`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      temperature: 0,
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

    const latency = Date.now() - start;
    console.log(`[ExecutiveSummaryWriter] Done in ${latency}ms. 5 paragraphs.`);
    if (verdictLine) console.log(`[ExecutiveSummaryWriter] Verdict: ${verdictLine}`);

    return {
      data: paragraphs,
      verdict_line: verdictLine,
      regime_narratives: regimeNarratives,
      meta: {
        agent: 'ExecutiveSummaryWriter',
        model: 'claude-sonnet-4-6',
        latency_ms: latency,
        tokens,
      },
    };
  }
}
