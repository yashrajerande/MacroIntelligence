/**
 * Summary Card Skill — Generates a mobile-friendly HTML card for screenshot.
 * 1080×1350px, Jony Ive aesthetic, 4 key numbers + verdict + CTA.
 */

/**
 * Pick the 4 most interesting indicators for the card.
 * Prioritizes extreme percentiles and key market movers.
 */
function pickKeyNumbers(macroDataObj) {
  const indicators = macroDataObj.indicators || [];
  const priority = ['nifty50', 'inr_usd', 'cpi_headline', 'brent_usd', 'gold_usd', 'cd_ratio', 'india_gdp_yoy', 'pmi_composite', 'fed_funds_rate', 'sip_inflows'];

  // Pick from priority list first, then fill with extreme percentiles
  const picked = [];
  const used = new Set();

  for (const slug of priority) {
    if (picked.length >= 4) break;
    const ind = indicators.find(i => i.indicator_slug === slug && i.latest_numeric !== null);
    if (ind) {
      picked.push(ind);
      used.add(slug);
    }
  }

  // Fill remaining slots with most extreme percentile indicators
  if (picked.length < 4) {
    const remaining = indicators
      .filter(i => !used.has(i.indicator_slug) && i.latest_numeric !== null && i.pct_10y !== undefined)
      .sort((a, b) => Math.abs(b.pct_10y - 50) - Math.abs(a.pct_10y - 50));
    for (const ind of remaining) {
      if (picked.length >= 4) break;
      picked.push(ind);
    }
  }

  return picked.map(ind => ({
    name: ind.indicator_name,
    value: ind.latest_value,
    direction: ind.direction,
    pct: ind.pct_10y,
  }));
}

/**
 * Generate the HTML for the summary card.
 */
export function generateCardHTML({ verdictLine, macroDataObj, dateStr, dashboardUrl }) {
  const keyNumbers = pickKeyNumbers(macroDataObj);
  const regimes = (macroDataObj.regime || []).map(r => ({
    dim: r.dimension.charAt(0).toUpperCase() + r.dimension.slice(1),
    badge: r.badge_label,
    type: r.badge_type,
  }));

  const dirArrow = (d) => d === 'up' ? '↑' : d === 'down' ? '↓' : '→';
  const dirColor = (d) => d === 'up' ? '#34c759' : d === 'down' ? '#ff3b30' : '#86868b';
  const badgeColor = (t) => {
    if (t === 'b-exp') return { bg: 'rgba(52,199,89,0.1)', text: '#34c759', border: 'rgba(52,199,89,0.3)' };
    if (t === 'b-risk') return { bg: 'rgba(255,59,48,0.08)', text: '#ff3b30', border: 'rgba(255,59,48,0.25)' };
    if (t === 'b-slow') return { bg: 'rgba(255,149,0,0.08)', text: '#ff9500', border: 'rgba(255,149,0,0.25)' };
    return { bg: 'rgba(0,113,227,0.06)', text: '#0071e3', border: 'rgba(0,113,227,0.2)' };
  };

  const numbersHTML = keyNumbers.map(n => `
    <div style="background:#fafafa;border-radius:16px;padding:20px;display:flex;flex-direction:column;gap:6px;">
      <div style="font-size:13px;color:#86868b;font-weight:500;letter-spacing:0.02em;">${n.name}</div>
      <div style="font-size:28px;font-weight:700;color:#1d1d1f;letter-spacing:-0.02em;">${n.value}</div>
      <div style="display:flex;align-items:center;gap:6px;">
        <span style="font-size:16px;font-weight:600;color:${dirColor(n.direction)};">${dirArrow(n.direction)}</span>
        <span style="font-size:12px;color:#86868b;">10Y: ${n.pct ?? '—'}%</span>
      </div>
    </div>
  `).join('');

  const badgesHTML = regimes.map(r => {
    const c = badgeColor(r.type);
    return `<div style="background:${c.bg};border:1px solid ${c.border};border-radius:20px;padding:6px 14px;font-size:11px;font-weight:600;color:${c.text};white-space:nowrap;">${r.dim}</div>`;
  }).join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    width:1080px; height:1350px;
    font-family:'Inter',-apple-system,sans-serif;
    background:#ffffff;
    color:#1d1d1f;
    display:flex;
    flex-direction:column;
    padding:60px 56px;
    -webkit-font-smoothing:antialiased;
  }
</style>
</head>
<body>
  <!-- Header -->
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:40px;">
    <div style="display:flex;align-items:center;gap:14px;">
      <div style="width:44px;height:44px;background:linear-gradient(135deg,#0071e3,#5856d6);border-radius:12px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:18px;">M</div>
      <div>
        <div style="font-size:15px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;">Macro Intelligence</div>
        <div style="font-size:12px;color:#86868b;letter-spacing:0.06em;">Daily Macro Brief</div>
      </div>
    </div>
    <div style="font-size:14px;color:#86868b;font-weight:500;">${dateStr}</div>
  </div>

  <!-- Verdict -->
  <div style="margin-bottom:44px;">
    <div style="font-size:11px;font-weight:600;color:#0071e3;letter-spacing:0.14em;text-transform:uppercase;margin-bottom:14px;">TODAY'S VERDICT</div>
    <div style="font-size:32px;font-weight:700;line-height:1.28;letter-spacing:-0.02em;color:#1d1d1f;">${verdictLine || 'Dashboard generated — see full report for details.'}</div>
  </div>

  <!-- Regime Badges -->
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:44px;">
    ${badgesHTML}
  </div>

  <!-- Key Numbers Grid -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:auto;">
    ${numbersHTML}
  </div>

  <!-- Audio mention -->
  <div style="display:flex;align-items:center;gap:10px;padding:18px 22px;background:#fafafa;border-radius:14px;margin-bottom:32px;">
    <div style="width:40px;height:40px;background:#1d1d1f;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:14px;flex-shrink:0;">&#9654;</div>
    <div>
      <div style="font-size:14px;font-weight:600;">60-Second Macro</div>
      <div style="font-size:12px;color:#86868b;">Listen to today's audio briefing</div>
    </div>
  </div>

  <!-- CTA -->
  <a href="${dashboardUrl}" style="display:block;text-align:center;padding:20px;background:#1d1d1f;color:#ffffff;border-radius:14px;font-size:16px;font-weight:600;text-decoration:none;letter-spacing:0.01em;">
    Explore the Full Dashboard →
  </a>

  <!-- Footer -->
  <div style="text-align:center;margin-top:20px;font-size:11px;color:#aeaeb2;">
    macrointelligence.corp · Not investment advice
  </div>
</body>
</html>`;
}
