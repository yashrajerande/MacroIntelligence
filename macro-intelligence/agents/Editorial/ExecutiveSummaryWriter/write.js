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

    const keyPrices = Object.entries(allData.marketData.data.prices)
      .filter(([slug]) => ['nifty50', 'sensex', 'inr_usd', 'brent_usd', 'gold_usd', 'us_10y_treasury', 'india_vix', 'dxy'].includes(slug))
      .map(([slug, p]) => `${slug}: ${p.value} (${p.direction} ${p.change_pct}%)`)
      .join('\n');

    const prompt = `Write the executive summary for today's macro dashboard.

STYLE GUIDE:
${styleGuide}

REGIME:
${regimeSummary}

SIGNALS:
${signalSummary}

SCENARIOS:
${scenarioSummary}

KEY PRICES:
${keyPrices}

DATE: ${allData.dateStr}

Return JSON wrapped in <<<JSON and >>> markers with this exact structure:
{
  "verdict_line": "One sentence. The sharpest possible summary of today's macro state. Must contain the single most important tension or insight. Reference specific numbers. Think like a CIO opening a morning call — what is the ONE thing that matters today? No more than 25 words. No generic phrases like 'expansion mode' or 'steady growth'. Be specific, be bold, be provocative.",
  "paragraphs": [
    { "para_num": 1, "para_label": "India Macro Regime", "para_html": "<p>...</p>" },
    { "para_num": 2, "para_label": "Global Macro Regime", "para_html": "<p>...</p>" },
    { "para_num": 3, "para_label": "Liquidity Conditions", "para_html": "<p>...</p>" },
    { "para_num": 4, "para_label": "Equity + Real Estate Implications", "para_html": "<p>...</p>" },
    { "para_num": 5, "para_label": "Key Risks to Monitor", "para_html": "<p>...</p>" }
  ]
}

Use <strong> tags for key figures. Maximum 4 sentences per paragraph. Open each with the most important number. Never start a sentence with "The".`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 3000,
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

    // Handle both old format (array) and new format (object with verdict_line)
    let verdictLine = '';
    let paragraphs;
    if (Array.isArray(parsed)) {
      paragraphs = parsed;
    } else {
      verdictLine = parsed.verdict_line || '';
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
      meta: {
        agent: 'ExecutiveSummaryWriter',
        model: 'claude-sonnet-4-6',
        latency_ms: latency,
        tokens,
      },
    };
  }
}
