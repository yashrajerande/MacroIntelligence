/**
 * RealEstateAnalyst — Uses Claude Haiku + web_search for RE data.
 */

import { fetchRealEstateData } from './skills/re-search.js';
import { extractIndicator } from '../../DataIntelligence/MacroDataAnalyst/skills/data-extractor.js';
import { scorePct10y } from '../../Analysis/SignalDetector/skills/signal-scoring.js';

const RE_SLUGS = [
  're_launches_units', 're_sales_units', 're_unsold_inventory',
  'hpi_mumbai', 'hpi_delhi', 'hpi_bengaluru', 'hpi_hyderabad',
  'affordability_index', 'home_loan_disbursements', 'avg_home_loan_rate',
  'office_absorption', 'office_vacancy', 'rent_bengaluru', 'rent_mumbai',
  'retail_mall_vacancy', 'embassy_reit', 'mindspace_reit', 'brookfield_reit',
];

export class RealEstateAnalyst {
  async fetch(isoDate) {
    const start = Date.now();

    console.log('[RealEstateAnalyst] Fetching real estate data...');
    const result = await fetchRealEstateData();

    const indicators = {};
    for (const slug of RE_SLUGS) {
      const raw = result.data[slug] || null;
      const extracted = extractIndicator(raw, slug);
      const scored = scorePct10y(slug, extracted.value);
      indicators[slug] = {
        ...extracted,
        ...scored,
        is_estimated: ['embassy_reit', 'mindspace_reit', 'brookfield_reit'].includes(slug)
          ? true
          : extracted.is_estimated,
      };
    }

    const latency = Date.now() - start;
    console.log(`[RealEstateAnalyst] Done in ${latency}ms. ${Object.keys(indicators).length} indicators.`);

    return {
      data: {
        generated_at: new Date().toISOString(),
        run_date: isoDate,
        indicators,
      },
      meta: {
        agent: 'RealEstateAnalyst',
        model: 'claude-haiku-4-5-20251001',
        latency_ms: latency,
        tokens: result.tokens || { input: 0, output: 0 },
      },
    };
  }
}

if (process.argv[1] && process.argv[1].includes('RealEstateAnalyst')) {
  const { isoDate } = (await import('../../../src/utils/ist-date.js')).getISTDate();
  new RealEstateAnalyst().fetch(isoDate).then(r => {
    console.log(JSON.stringify(r.meta, null, 2));
  }).catch(err => { console.error(err); process.exit(1); });
}
