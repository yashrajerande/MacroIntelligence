/**
 * Yahoo Finance Skill — Fetches live market prices via Yahoo Finance v8 API.
 * No API key required. Uses unofficial chart endpoint.
 */

import { getISTDate } from '../../../../src/utils/ist-date.js';

const SYMBOL_MAP = {
  nifty50:         '^NSEI',
  sensex:          '^BSESN',
  bank_nifty:      '^NSEBANK',
  india_vix:       '^INDIAVIX',
  inr_usd:         'INRUSD=X',
  brent_usd:       'BZ=F',
  wti_usd:         'CL=F',
  gold_usd:        'GC=F',
  sp500:           '^GSPC',
  nasdaq:          '^IXIC',
  us_vix:          '^VIX',
  dxy:             'DX-Y.NYB',
  nat_gas:         'NG=F',
  copper:          'HG=F',
  iron_ore:        'TIO=F',
  nikkei225:       '^N225',
  hang_seng:       '^HSI',
  euro_stoxx50:    '^STOXX50E',
  brent_usd_global:'BZ=F',
  // bdi removed: '^BDI' is not a Yahoo symbol — it 404'd on every run
  // since launch. Listed in the validator's KNOWN_UNAVAILABLE instead.
  embassy_reit:    'EMBASSY.NS',
  mindspace_reit:  'MINDSPACE.NS',
  brookfield_reit: 'BIRET.NS',
};

function computeDirection(current, previous) {
  if (previous === 0) return 'flat';
  const pctChange = ((current - previous) / Math.abs(previous)) * 100;
  if (pctChange > 0.1) return 'up';
  if (pctChange < -0.1) return 'down';
  return 'flat';
}

async function fetchWithRetry(url, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
      });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
}

async function fetchSymbol(slug, symbol) {
  // range=5d so the close series reliably contains at least two sessions.
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`;
  try {
    const data = await fetchWithRetry(url);
    const result = data.chart.result[0];
    const meta = result.meta;
    const current = meta.regularMarketPrice;

    // Derive `previous` from the actual close series. meta.chartPreviousClose
    // is the close before the CHART RANGE, not the prior session — for
    // thinly-traded symbols (the NSE REITs, iron ore) it produced impossible
    // one-day moves like -31% that then poisoned momentum labels AND the
    // renderer's suspect-value substitution fallback.
    const closes = (result.indicators?.quote?.[0]?.close || []).filter(Number.isFinite);
    let previous;
    if (closes.length >= 2) {
      const last = closes[closes.length - 1];
      // If the last close IS today's price, the prior session is one back.
      previous = Math.abs(last - current) < 1e-9 && closes.length >= 2
        ? closes[closes.length - 2]
        : last;
    } else {
      previous = meta.chartPreviousClose;
    }

    const changePct = previous
      ? Math.round(((current - previous) / Math.abs(previous)) * 10000) / 100
      : 0;

    return {
      value: current,
      value_str: String(current),
      previous,
      change_pct: changePct,
      direction: computeDirection(current, previous),
      source: 'Yahoo Finance',
      vintage: getISTDate().isoDate, // was UTC — disagreed with run_date for pre-05:30-IST runs
      is_estimated: false,
    };
  } catch (err) {
    return {
      value: 0,
      value_str: 'Awaited',
      previous: 0,
      change_pct: 0,
      direction: 'flat',
      source: 'Yahoo Finance',
      vintage: 'Awaited',
      is_estimated: true,
      fetch_error: `${slug}: ${err.message}`,
    };
  }
}

export async function fetchAllYahoo() {
  const entries = Object.entries(SYMBOL_MAP);
  const results = await Promise.allSettled(
    entries.map(([slug, symbol]) => fetchSymbol(slug, symbol))
  );

  const prices = {};
  entries.forEach(([slug], i) => {
    prices[slug] = results[i].status === 'fulfilled'
      ? results[i].value
      : {
          value: 0, value_str: 'Awaited', previous: 0, change_pct: 0,
          direction: 'flat', source: 'Yahoo Finance', vintage: 'Awaited',
          is_estimated: true, fetch_error: results[i].reason?.message || 'Unknown error',
        };
  });

  return prices;
}
