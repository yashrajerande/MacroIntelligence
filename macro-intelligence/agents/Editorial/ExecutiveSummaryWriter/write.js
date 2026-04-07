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

    const prompt = `Write the 5-paragraph executive summary for today's macro dashboard.

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

Return JSON array of 5 objects wrapped in <<<JSON and >>> markers:
[{ "para_num": 1, "para_label": "India Macro Regime", "para_html": "<p>...</p>" }, ...]

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

    let paragraphs;
    const jsonMatch = text.match(/<<<JSON\s*([\s\S]*?)\s*>>>/) || text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      paragraphs = JSON.parse(jsonMatch[1] || jsonMatch[0]);
    } else {
      throw new Error('[ExecutiveSummaryWriter] Failed to extract JSON from response');
    }

    // Enforce structure
    paragraphs = paragraphs.map((p, i) => ({
      para_num: i + 1,
      para_label: PARA_LABELS[i] || p.para_label,
      para_html: p.para_html || `<p>${p.text || 'Awaited'}</p>`,
    }));

    const latency = Date.now() - start;
    console.log(`[ExecutiveSummaryWriter] Done in ${latency}ms. 5 paragraphs.`);

    return {
      data: paragraphs,
      meta: {
        agent: 'ExecutiveSummaryWriter',
        model: 'claude-sonnet-4-6',
        latency_ms: latency,
        tokens,
      },
    };
  }
}
