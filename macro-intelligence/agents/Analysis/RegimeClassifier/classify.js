/**
 * RegimeClassifier — Uses Haiku for signal_text narratives.
 * Classification rules are deterministic (regime-logic.js).
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import { classifyAll } from './skills/regime-logic.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const persona = readFileSync(join(__dirname, 'Persona.md'), 'utf-8');
const client = new Anthropic();

export class RegimeClassifier {
  async classify(allData) {
    const start = Date.now();

    // Merge all indicators into a single flat map
    const indicators = {
      ...allData.marketData.data.prices,
      ...allData.macroData.data.indicators,
      ...allData.reData.data.indicators,
    };

    // Step 1: Deterministic classification
    const regimeBase = classifyAll(indicators);

    // Step 2: LLM generates signal_text narratives for each dimension
    const prompt = `Given the following 6 regime classifications, write a 1-2 sentence signal_text for each. Use specific numbers from the data. Be dense and institutional.

${regimeBase.map(r => `${r.dimension} [${r.badge_type}]: ${r.metric_summary}`).join('\n')}

Return JSON array of 6 objects: [{ "dimension": "...", "signal_text": "..." }].
Wrap in <<<JSON and >>> markers.`;

    let tokens = { input: 0, output: 0 };
    try {
      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: [{ type: 'text', text: persona, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: prompt }],
      });

      tokens = { input: response.usage?.input_tokens || 0, output: response.usage?.output_tokens || 0 };

      const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
      const jsonMatch = text.match(/<<<JSON\s*([\s\S]*?)\s*>>>/) || text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const narratives = JSON.parse(jsonMatch[1] || jsonMatch[0]);
        for (const n of narratives) {
          const r = regimeBase.find(x => x.dimension === n.dimension);
          if (r) r.signal_text = n.signal_text;
        }
      }
    } catch (err) {
      console.warn(`[RegimeClassifier] LLM narrative failed: ${err.message}. Using empty signal_text.`);
    }

    // Fill any empty signal_text with metric_summary fallback
    for (const r of regimeBase) {
      if (!r.signal_text) {
        r.signal_text = `Current reading: ${r.metric_summary}.`;
      }
    }

    const latency = Date.now() - start;
    console.log(`[RegimeClassifier] Done in ${latency}ms.`);

    return {
      data: regimeBase,
      meta: {
        agent: 'RegimeClassifier',
        model: 'claude-haiku-4-5-20251001',
        latency_ms: latency,
        tokens,
      },
    };
  }
}

if (process.argv[1] && process.argv[1].includes('RegimeClassifier')) {
  console.log('[RegimeClassifier] Standalone mode — requires piped input data');
}
