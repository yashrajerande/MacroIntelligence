/**
 * MarketDataAnalyst — Pure code agent. No LLM.
 * Fetches live prices from Yahoo Finance + FRED.
 */

import { fetchAllYahoo } from './skills/yahoo-finance.js';
import { fetchAllFred } from './skills/fred-api.js';
import { getISTDate } from '../../../src/utils/ist-date.js';
import { scorePct10y } from '../../Analysis/SignalDetector/skills/signal-scoring.js';

export class MarketDataAnalyst {
  async fetch() {
    const start = Date.now();
    const { isoDate } = getISTDate();

    console.log('[MarketDataAnalyst] Fetching Yahoo Finance prices...');
    const yahooPrices = await fetchAllYahoo();

    console.log('[MarketDataAnalyst] Fetching FRED data...');
    const fredPrices = await fetchAllFred();

    // Merge: FRED overrides Yahoo for overlapping keys (more authoritative for rates)
    const prices = { ...yahooPrices, ...fredPrices };

    // Compute gold_inr_gram from gold_usd and inr_usd
    if (prices.gold_usd && prices.inr_usd && prices.gold_usd.value && prices.inr_usd.value) {
      const goldInrPerGram = (prices.gold_usd.value * prices.inr_usd.value) / 31.1035;
      prices.gold_inr_gram = {
        value: Math.round(goldInrPerGram),
        value_str: String(Math.round(goldInrPerGram)),
        previous: prices.gold_inr_gram?.previous || Math.round(goldInrPerGram * 0.99),
        change_pct: prices.gold_usd.change_pct || 0,
        direction: prices.gold_usd.direction || 'flat',
        source: 'Derived (Yahoo Finance)',
        vintage: isoDate,
        is_estimated: false,
      };
    }

    // Score pct_10y and add momentum_label for all market prices
    for (const [slug, p] of Object.entries(prices)) {
      if (p.fetch_error) continue;
      const scored = scorePct10y(slug, p.value);
      if (scored) {
        p.pct_10y      = scored.pct_10y;
        p.pct_10y_tier = scored.pct_10y_tier;
        p.pct_note     = scored.pct_note || '';
      }
      if (!p.momentum_label && p.change_pct !== undefined) {
        const arrow = p.direction === 'up' ? '↑' : p.direction === 'down' ? '↓' : '→';
        const sign  = p.change_pct >= 0 ? '+' : '';
        p.momentum_label = `${arrow} ${sign}${p.change_pct}%`;
      }
    }

    // Collect fetch errors for logging
    const fetchErrors = Object.entries(prices)
      .filter(([, p]) => p.fetch_error)
      .map(([slug, p]) => ({ slug, error: p.fetch_error }));

    if (fetchErrors.length > 0) {
      console.warn(`[MarketDataAnalyst] ${fetchErrors.length} fetch errors:`,
        fetchErrors.map(e => e.slug).join(', '));
    }

    const latency = Date.now() - start;
    console.log(`[MarketDataAnalyst] Done in ${latency}ms. ${Object.keys(prices).length} prices fetched.`);

    return {
      data: {
        generated_at: new Date().toISOString(),
        run_date: isoDate,
        prices,
      },
      meta: {
        agent: 'MarketDataAnalyst',
        model: 'none',
        latency_ms: latency,
        tokens: { input: 0, output: 0 },
        fetch_errors: fetchErrors,
      },
    };
  }
}

// Allow standalone execution
if (process.argv[1] && process.argv[1].includes('MarketDataAnalyst')) {
  new MarketDataAnalyst().fetch().then(r => {
    console.log(JSON.stringify(r.meta, null, 2));
  }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
