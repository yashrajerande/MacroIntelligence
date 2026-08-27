/**
 * LeverageAnalyst — Uses Claude Haiku + web_search for private-debt data.
 *
 * Steve Keen / Minsky framework: tracks private-debt-to-GDP LEVELS for
 * six major economies (India, US, China, Japan, Eurozone, UK, split
 * household/corporate) plus India's sectoral bank credit growth. The
 * credit IMPULSE (2nd derivative) is computed downstream, purely from
 * this level history, by agents/Analysis/LeverageAnalyzer — no LLM.
 */

import { fetchLeverageData } from './skills/leverage-search.js';
import { extractIndicator } from '../MacroDataAnalyst/skills/data-extractor.js';
import { scorePct10y } from '../../Analysis/SignalDetector/skills/signal-scoring.js';
import { LEVERAGE_SLUGS } from '../../../src/utils/data-cache.js';

const SLUGS = [...LEVERAGE_SLUGS];

export class LeverageAnalyst {
  async fetch(isoDate) {
    const start = Date.now();

    console.log('[LeverageAnalyst] Fetching private-debt data (BIS levels + RBI sectoral credit)...');
    const result = await fetchLeverageData();

    const indicators = {};
    for (const slug of SLUGS) {
      const raw = result.data[slug] || null;
      const extracted = extractIndicator(raw, slug);
      const scored = scorePct10y(slug, extracted.value);
      indicators[slug] = { ...extracted, ...scored };
    }

    const latency = Date.now() - start;
    console.log(`[LeverageAnalyst] Done in ${latency}ms. ${Object.keys(indicators).length} indicators.`);

    return {
      data: {
        generated_at: new Date().toISOString(),
        run_date: isoDate,
        indicators,
      },
      meta: {
        agent: 'LeverageAnalyst',
        model: 'claude-haiku-4-5-20251001',
        latency_ms: latency,
        tokens: result.tokens || { input: 0, output: 0 },
      },
    };
  }
}

if (process.argv[1] && process.argv[1].includes('LeverageAnalyst')) {
  const { isoDate } = (await import('../../../src/utils/ist-date.js')).getISTDate();
  new LeverageAnalyst().fetch(isoDate).then(r => {
    console.log(JSON.stringify(r.meta, null, 2));
  }).catch(err => { console.error(err); process.exit(1); });
}
