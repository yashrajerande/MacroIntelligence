/**
 * FRED API Skill — Fetches macro data from Federal Reserve Economic Data.
 * Requires FRED_API_KEY environment variable.
 */

// units: FRED transformation applied server-side ('pc1' = percent change
// from year ago — turns index levels into YoY %, matching the schema).
// transform: local unit conversion applied after fetch (known units, no guessing).
const SERIES_MAP = {
  us_10y_treasury:  { id: 'DGS10' },
  fed_funds_rate:   { id: 'FEDFUNDS' },
  fed_balance_sheet:{ id: 'WALCL', transform: v => v / 1000 },  // $ millions → $ billions
  us_cpi:           { id: 'CPIAUCSL', units: 'pc1' },
  us_core_cpi:      { id: 'CPILFESL', units: 'pc1' },
  us_core_pce:      { id: 'PCEPILFE', units: 'pc1' },
  us_gdp_saar:      { id: 'A191RL1Q225SBEA' },
};

function computeDirection(current, previous) {
  if (!previous || previous === 0) return 'flat';
  const pctChange = ((current - previous) / Math.abs(previous)) * 100;
  if (pctChange > 0.1) return 'up';
  if (pctChange < -0.1) return 'down';
  return 'flat';
}

async function fetchSeries(spec, apiKey) {
  const unitsParam = spec.units ? `&units=${spec.units}` : '';
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${spec.id}&sort_order=desc&limit=2&api_key=${apiKey}&file_type=json${unitsParam}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const obs = data.observations;
    if (!obs || obs.length === 0) throw new Error('No observations');

    const xform = spec.transform || (v => v);
    const round4 = v => Math.round(v * 10000) / 10000;
    const latest = round4(xform(parseFloat(obs[0].value)));
    const previous = obs.length > 1 ? round4(xform(parseFloat(obs[1].value))) : latest;
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
    entries.map(([, spec]) => fetchSeries(spec, apiKey))
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
