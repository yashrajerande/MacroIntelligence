/**
 * SignalDetector — Uses claude-haiku-4-5 for synthesis.
 * The highest-value analytical agent. Produces 7 signal cards.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import { scoreAllIndicators } from './skills/signal-scoring.js';
import { getPolarity, classifyIndicator, scoreIndicator } from '../../../src/utils/polarity.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const persona = readFileSync(join(__dirname, 'Persona.md'), 'utf-8');
const client = new Anthropic();

const SIGNAL_THEMES = [
  { num: 1, theme: 'CREDIT CYCLE' },
  { num: 2, theme: 'CAPEX TRIGGER' },
  { num: 3, theme: 'SIP / RETAIL FLOWS' },
  { num: 4, theme: 'OIL / COMMODITY RISK' },
  { num: 5, theme: 'GLOBAL LIQUIDITY' },
  { num: 6, theme: 'INR / FX RESERVES' },
  { num: 7, theme: 'UNDER THE RADAR' },
];

export class SignalDetector {
  async detect(allData) {
    const start = Date.now();

    const allIndicators = {
      ...allData.marketData.data.prices,
      ...allData.macroData.data.indicators,
      ...allData.reData.data.indicators,
    };

    const scored = scoreAllIndicators(allIndicators);
    const regimeSummary = allData.regime.data.map(r =>
      `${r.dimension}: ${r.badge_label} — ${r.signal_text}`
    ).join('\n');

    // Tag every indicator with polarity + classification from the Polarity Skill
    // so Haiku never has to re-judge whether rising = good or bad.
    const indicatorSummary = Object.entries(scored).map(([slug, ind]) => {
      const forPolarity = { ...ind, indicator_slug: slug, latest_numeric: ind.value };
      const polarity = getPolarity(slug);
      const classification = classifyIndicator(forPolarity);
      const signedScore = scoreIndicator(forPolarity);
      return `${slug}: ${ind.value_str || ind.value} (prev: ${ind.previous}, dir: ${ind.direction}, 10y: ${ind.pct_10y}% ${ind.pct_10y_tier}) [polarity: ${polarity}, signal: ${classification}, score: ${signedScore}]`;
    }).join('\n');

    const prompt = `Analyze the following data and produce exactly 7 signal cards.

REGIME STATE:
${regimeSummary}

KEY INDICATORS (${Object.keys(scored).length} total):
Each indicator is tagged with [polarity: positive|negative|neutral, signal: classification, score: -100..+100]
from the canonical Polarity Skill. TRUST these tags — do not re-judge polarity from the raw value.
A 'positive' polarity metric rising is good; a 'negative' polarity metric rising is bad.
${indicatorSummary}

FIXED SIGNAL THEMES:
${SIGNAL_THEMES.map(s => `Sig${s.num}: ${s.theme}${s.num === 7 ? ' (SURPRISE — must be non-obvious cross-domain insight)' : ''}`).join('\n')}

For each signal, provide:
- signal_num (1-7)
- signal_theme (from the fixed list)
- status: "positive"|"risk"|"watch"|"surprise" (sig7 MUST be "surprise")
- title: punchy 5-8 word title
- data_text: specific numbers with vintage dates
- implication: what this means for a capital allocator TODAY
- pct_10y: integer 0-100 (use the scored percentiles from the data)
- pct_note: 1-2 sentences with historical context
- is_surprise: false for sig1-6, true for sig7

Return a JSON array of 7 objects wrapped in <<<JSON and >>> markers.`;

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      temperature: 0,
      system: [{ type: 'text', text: persona, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: prompt }],
    });

    const tokens = { input: response.usage?.input_tokens || 0, output: response.usage?.output_tokens || 0 };
    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');

    let signals;
    const jsonMatch = text.match(/<<<JSON\s*([\s\S]*?)\s*>>>/) || text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      signals = JSON.parse(jsonMatch[1] || jsonMatch[0]);
    } else {
      throw new Error('[SignalDetector] Failed to extract JSON from response');
    }

    // Enforce structure
    signals = signals.map((s, i) => ({
      signal_num: i + 1,
      signal_theme: SIGNAL_THEMES[i].theme,
      status: i === 6 ? 'surprise' : (s.status || 'watch'),
      title: s.title || SIGNAL_THEMES[i].theme,
      data_text: s.data_text || '',
      implication: s.implication || '',
      pct_10y: typeof s.pct_10y === 'number' ? Math.max(0, Math.min(100, s.pct_10y)) : 50,
      pct_note: s.pct_note || '',
      is_surprise: i === 6,
    }));

    // Ensure pct_10y_tier consistency
    signals = signals.map(s => ({
      ...s,
      pct_10y_tier: s.pct_10y >= 80 ? 'hi' : s.pct_10y >= 40 ? 'mid' : 'lo',
    }));

    const latency = Date.now() - start;
    console.log(`[SignalDetector] Done in ${latency}ms. 7 signals generated.`);

    return {
      data: signals,
      meta: {
        agent: 'SignalDetector',
        model: 'claude-haiku-4-5-20251001',
        latency_ms: latency,
        tokens,
      },
    };
  }
}
