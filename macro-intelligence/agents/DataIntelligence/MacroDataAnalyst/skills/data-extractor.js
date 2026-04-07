/**
 * Data Extractor Skill — Maps raw search results to typed indicator objects.
 */

export function extractIndicator(searchResult, slug) {
  if (!searchResult || searchResult.error) {
    return {
      value: null,
      value_str: 'Awaited',
      previous: null,
      change_pct: null,
      direction: 'flat',
      source: 'Awaited',
      vintage: 'Awaited',
      is_estimated: true,
      pct_10y: 50,
      pct_10y_tier: 'mid',
      momentum_label: 'Awaited',
      confidence: 'low',
    };
  }

  const value = searchResult.value ?? searchResult.latest ?? null;
  const previous = searchResult.previous ?? searchResult.prior ?? null;
  const source = searchResult.source || 'Web Search';
  const vintage = searchResult.vintage || searchResult.date || 'Awaited';

  let direction = 'flat';
  if (value !== null && previous !== null && previous !== 0) {
    const pctChange = ((value - previous) / Math.abs(previous)) * 100;
    if (pctChange > 0.1) direction = 'up';
    else if (pctChange < -0.1) direction = 'down';
  }

  const changePct = (value !== null && previous !== null && previous !== 0)
    ? Math.round(((value - previous) / Math.abs(previous)) * 10000) / 100
    : null;

  // Confidence scoring
  let confidence = 'low';
  const officialSources = ['MOSPI', 'RBI', 'NSE', 'BSE', 'SEBI', 'AMFI', 'NHB'];
  const mediumSources = ['Economic Times', 'Mint', 'Bloomberg', 'Reuters', 'HSBC', 'S&P Global'];
  if (officialSources.some(s => source.includes(s))) confidence = 'high';
  else if (mediumSources.some(s => source.includes(s))) confidence = 'medium';

  return {
    value,
    value_str: value !== null ? String(value) : 'Awaited',
    previous,
    change_pct: changePct,
    direction,
    source,
    vintage,
    is_estimated: value === null || confidence === 'low',
    pct_10y: searchResult.pct_10y ?? 50,
    pct_10y_tier: searchResult.pct_10y_tier || 'mid',
    momentum_label: searchResult.momentum || `${direction === 'up' ? '↑' : direction === 'down' ? '↓' : '→'} ${changePct !== null ? changePct + '%' : 'Awaited'}`,
    confidence,
  };
}
