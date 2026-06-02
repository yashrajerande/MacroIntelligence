/**
 * Fetches historical indicator values from Supabase and computes
 * dynamic min/max ranges so the validator adapts as markets evolve.
 * Falls back to null (triggering static ranges) if Supabase is unavailable.
 */

const LOOKBACK_DAYS = 180;
const MIN_DATA_POINTS = 10;
const PAGE_SIZE = 1000;

async function fetchPage(url, serviceKey, offset) {
  const pageUrl = `${url}&offset=${offset}&limit=${PAGE_SIZE}`;
  const res = await fetch(pageUrl, {
    headers: {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchDynamicRanges() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !serviceKey || process.env.SKIP_SUPABASE === 'true') {
    return null;
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - LOOKBACK_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const baseUrl = `${supabaseUrl}/rest/v1/macro_indicators` +
    `?select=indicator_slug,latest_numeric` +
    `&run_date=gte.${cutoffStr}` +
    `&latest_numeric=not.is.null` +
    `&order=run_date`;

  try {
    let allRows = [];
    let offset = 0;
    while (true) {
      const page = await fetchPage(baseUrl, serviceKey, offset);
      allRows = allRows.concat(page);
      if (page.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    const bySlug = {};
    for (const { indicator_slug, latest_numeric } of allRows) {
      if (latest_numeric === null || latest_numeric === undefined) continue;
      if (!bySlug[indicator_slug]) bySlug[indicator_slug] = [];
      bySlug[indicator_slug].push(latest_numeric);
    }

    const ranges = {};
    for (const [slug, values] of Object.entries(bySlug)) {
      if (values.length < MIN_DATA_POINTS) continue;
      ranges[slug] = { min: Math.min(...values), max: Math.max(...values) };
    }

    console.log(
      `[DynamicRanges] Computed ranges for ${Object.keys(ranges).length} indicators ` +
      `from ${allRows.length} records (last ${LOOKBACK_DAYS} days)`
    );
    return ranges;
  } catch (err) {
    console.warn(`[DynamicRanges] ${err.message} — falling back to static ranges`);
    return null;
  }
}
