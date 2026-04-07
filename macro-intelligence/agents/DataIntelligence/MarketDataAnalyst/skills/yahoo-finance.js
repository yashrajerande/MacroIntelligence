/**
 * Yahoo Finance Skill — Fetches live market prices via Yahoo Finance v8 API.
 * No API key required. Uses unofficial chart endpoint.
 */

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
  bdi:             '^BDI',
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
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=2d&interval=1d`;
  try {
    const data = await fetchWithRetry(url);
    const meta = data.chart.result[0].meta;
    const current = meta.regularMarketPrice;
    const previous = meta.chartPreviousClose;
    const changePct = previous !== 0
      ? Math.round(((current - previous) / Math.abs(previous)) * 10000) / 100
      : 0;

    return {
      value: current,
      value_str: String(current),
      previous,
      change_pct: changePct,
      direction: computeDirection(current, previous),
      source: 'Yahoo Finance',
      vintage: new Date().toISOString().split('T')[0],
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
