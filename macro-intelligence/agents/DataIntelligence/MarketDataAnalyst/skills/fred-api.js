/**
 * FRED API Skill — Fetches macro data from Federal Reserve Economic Data.
 * Requires FRED_API_KEY environment variable.
 */

const SERIES_MAP = {
  us_10y_treasury:  'DGS10',
  fed_funds_rate:   'FEDFUNDS',
  fed_balance_sheet:'WALCL',
  us_cpi:           'CPIAUCSL',
  us_core_cpi:      'CPILFESL',
  us_core_pce:      'PCEPILFE',
  us_gdp_saar:      'A191RL1Q225SBEA',
};

function computeDirection(current, previous) {
  if (!previous || previous === 0) return 'flat';
  const pctChange = ((current - previous) / Math.abs(previous)) * 100;
  if (pctChange > 0.1) return 'up';
  if (pctChange < -0.1) return 'down';
  return 'flat';
}

async function fetchSeries(seriesId, apiKey) {
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&sort_order=desc&limit=2&api_key=${apiKey}&file_type=json`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const obs = data.observations;
    if (!obs || obs.length === 0) throw new Error('No observations');

    const latest = parseFloat(obs[0].value);
    const previous = obs.length > 1 ? parseFloat(obs[1].value) : latest;
    const changePct = previous !== 0
      ? Math.round(((latest - previous) / Math.abs(previous)) * 10000) / 100
      : 0;

    return {
      value: latest,
      value_str: String(latest),
      previous,
      change_pct: changePct,
      direction: computeDirection(latest, previous),
      source: 'FRED',
      vintage: obs[0].date,
      is_estimated: false,
    };
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

export async function fetchAllFred() {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) {
    console.warn('[FRED] No FRED_API_KEY set — returning estimated values');
    const results = {};
    for (const slug of Object.keys(SERIES_MAP)) {
      results[slug] = {
        value: 0, value_str: 'Awaited', previous: 0, change_pct: 0,
        direction: 'flat', source: 'FRED', vintage: 'Awaited',
        is_estimated: true, fetch_error: 'No FRED_API_KEY configured',
      };
    }
    return results;
  }

  const entries = Object.entries(SERIES_MAP);
  const results = await Promise.allSettled(
    entries.map(([, seriesId]) => fetchSeries(seriesId, apiKey))
  );

  const prices = {};
  entries.forEach(([slug], i) => {
    prices[slug] = results[i].status === 'fulfilled'
      ? results[i].value
      : {
          value: 0, value_str: 'Awaited', previous: 0, change_pct: 0,
          direction: 'flat', source: 'FRED', vintage: 'Awaited',
          is_estimated: true, fetch_error: results[i].reason?.message || 'Unknown error',
        };
  });

  return prices;
}
