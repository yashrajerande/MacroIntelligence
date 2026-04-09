/**
 * Summary Card Skill — Dark vibrant mobile-friendly card for Telegram/WhatsApp.
 * 1080×1350px. Hero verdict, regime badges, 4 risks, 4 strengths, CTA.
 */

import { INDICATOR_SCHEMA, INVERSE_INDICATORS } from '../../../../src/utils/indicator-schema.js';

/**
 * Pick the 4 most surprising RISK indicators (high percentile on inverse, or high pctl on non-inverse going wrong).
 */
function pickSurprisingRisks(indicators) {
  return indicators
    .filter(i => i.latest_numeric !== null && i.pct_10y !== undefined)
    .filter(i => {
      const inv = INVERSE_INDICATORS.has(i.indicator_slug);
      // Risk = inverse indicator at high percentile, OR non-inverse at very low percentile
      return (inv && i.pct_10y >= 70) || (!inv && i.pct_10y <= 20);
    })
    .sort((a, b) => {
      const aScore = INVERSE_INDICATORS.has(a.indicator_slug) ? a.pct_10y : (100 - a.pct_10y);
      const bScore = INVERSE_INDICATORS.has(b.indicator_slug) ? b.pct_10y : (100 - b.pct_10y);
      return bScore - aScore;
    })
    .slice(0, 4)
    .map(ind => ({
      name: ind.indicator_name,
      value: ind.latest_value,
      pct: ind.pct_10y,
      direction: ind.direction,
    }));
}

/**
 * Pick the 4 most surprising POSITIVE indicators (high pctl on non-inverse, or low pctl on inverse = good).
 */
function pickSurprisingStrengths(indicators) {
  return indicators
    .filter(i => i.latest_numeric !== null && i.pct_10y !== undefined)
    .filter(i => {
      const inv = INVERSE_INDICATORS.has(i.indicator_slug);
      // Strength = non-inverse at high percentile, OR inverse at very low percentile (good)
      return (!inv && i.pct_10y >= 75) || (inv && i.pct_10y <= 20);
    })
    .sort((a, b) => {
      const aScore = INVERSE_INDICATORS.has(a.indicator_slug) ? (100 - a.pct_10y) : a.pct_10y;
      const bScore = INVERSE_INDICATORS.has(b.indicator_slug) ? (100 - b.pct_10y) : b.pct_10y;
      return bScore - aScore;
    })
    .slice(0, 4)
    .map(ind => ({
      name: ind.indicator_name,
      value: ind.latest_value,
      pct: ind.pct_10y,
      direction: ind.direction,
    }));
}

/**
 * Generate the percentile badge HTML.
 */
function pctBadge(pct, isRisk) {
  const color = isRisk ? '#ff453a' : '#30d158';
  const bgColor = isRisk ? 'rgba(255,69,58,0.15)' : 'rgba(48,209,88,0.15)';
  return `<div style="display:inline-flex;align-items:center;gap:4px;background:${bgColor};border-radius:6px;padding:3px 8px;">
    <div style="width:${Math.max(pct * 0.4, 4)}px;height:4px;background:${color};border-radius:2px;"></div>
    <span style="font-size:12px;font-weight:600;color:${color};">${pct}%</span>
  </div>`;
}

/**
 * Generate the HTML for the dark vibrant summary card.
 */
export function generateCardHTML({ verdictLine, macroDataObj, dateStr, dashboardUrl }) {
  const indicators = macroDataObj.indicators || [];
  const risks = pickSurprisingRisks(indicators);
  const strengths = pickSurprisingStrengths(indicators);

  const regimes = (macroDataObj.regime || []).map(r => {
    const dim = r.dimension.charAt(0).toUpperCase() + r.dimension.slice(1);
    const arrow = r.badge_type === 'b-exp' ? '↑' : r.badge_type === 'b-risk' ? '⚠' : r.badge_type === 'b-slow' ? '→' : '—';
    let color, bg, border;
    if (r.badge_type === 'b-exp') { color = '#30d158'; bg = 'rgba(48,209,88,0.12)'; border = 'rgba(48,209,88,0.30)'; }
    else if (r.badge_type === 'b-risk') { color = '#ff453a'; bg = 'rgba(255,69,58,0.12)'; border = 'rgba(255,69,58,0.30)'; }
    else if (r.badge_type === 'b-slow') { color = '#ff9f0a'; bg = 'rgba(255,159,10,0.12)'; border = 'rgba(255,159,10,0.30)'; }
    else { color = '#0a84ff'; bg = 'rgba(10,132,255,0.10)'; border = 'rgba(10,132,255,0.25)'; }
    return `<div style="background:${bg};border:1px solid ${border};border-radius:20px;padding:7px 14px;font-size:12px;font-weight:600;color:${color};white-space:nowrap;">${dim} ${arrow}</div>`;
  }).join('');

  const riskCards = risks.map(n => `
    <div style="background:rgba(255,255,255,0.04);border-radius:14px;padding:18px 16px;border-left:3px solid #ff453a;">
      <div style="font-size:12px;color:rgba(255,255,255,0.45);font-weight:500;margin-bottom:6px;">${n.name}</div>
      <div style="font-size:28px;font-weight:700;color:#ffffff;letter-spacing:-0.02em;">${n.value}</div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:8px;">
        ${pctBadge(n.pct, true)}
        <span style="font-size:11px;color:rgba(255,255,255,0.35);">10Y percentile</span>
      </div>
    </div>
  `).join('');

  const strengthCards = strengths.map(n => `
    <div style="background:rgba(255,255,255,0.04);border-radius:14px;padding:18px 16px;border-left:3px solid #30d158;">
      <div style="font-size:12px;color:rgba(255,255,255,0.45);font-weight:500;margin-bottom:6px;">${n.name}</div>
      <div style="font-size:28px;font-weight:700;color:#ffffff;letter-spacing:-0.02em;">${n.value}</div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:8px;">
        ${pctBadge(n.pct, false)}
        <span style="font-size:11px;color:rgba(255,255,255,0.35);">10Y percentile</span>
      </div>
    </div>
  `).join('');

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
    background: linear-gradient(170deg, #0c0c1d 0%, #111128 40%, #0a0a1a 100%);
    color:#ffffff;
    display:flex;
    flex-direction:column;
    padding:52px 48px;
    -webkit-font-smoothing:antialiased;
    position:relative;
    overflow:hidden;
  }
  /* Subtle gradient orbs */
  body::before {
    content:'';
    position:absolute;
    top:-120px; right:-80px;
    width:400px; height:400px;
    background:radial-gradient(circle, rgba(10,132,255,0.12), transparent 70%);
    pointer-events:none;
  }
  body::after {
    content:'';
    position:absolute;
    bottom:-100px; left:-60px;
    width:350px; height:350px;
    background:radial-gradient(circle, rgba(191,90,242,0.10), transparent 70%);
    pointer-events:none;
  }
</style>
</head>
<body>

  <!-- Header -->
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:28px;position:relative;z-index:1;">
    <div style="display:flex;align-items:center;gap:12px;">
      <div style="width:42px;height:42px;background:linear-gradient(135deg,#0a84ff,#bf5af2);border-radius:12px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:18px;box-shadow:0 4px 20px rgba(10,132,255,0.3);">M</div>
      <div>
        <div style="font-size:14px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#ffffff;">Macro Intelligence</div>
        <div style="font-size:11px;color:rgba(255,255,255,0.4);letter-spacing:0.06em;">Daily Brief</div>
      </div>
    </div>
    <div style="font-size:13px;color:rgba(255,255,255,0.4);font-weight:500;">${dateStr}</div>
  </div>

  <!-- Thin divider -->
  <div style="height:1px;background:rgba(255,255,255,0.06);margin-bottom:32px;position:relative;z-index:1;"></div>

  <!-- HERO VERDICT -->
  <div style="margin-bottom:32px;position:relative;z-index:1;">
    <div style="font-size:11px;font-weight:600;color:#0a84ff;letter-spacing:0.16em;text-transform:uppercase;margin-bottom:14px;">TODAY'S VERDICT</div>
    <div style="font-size:30px;font-weight:700;line-height:1.25;letter-spacing:-0.02em;color:#ffffff;">${verdictLine || 'Dashboard generated — see full report.'}</div>
  </div>

  <!-- REGIME STRIP -->
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:30px;position:relative;z-index:1;">
    ${regimes}
  </div>

  <!-- SURPRISING RISKS -->
  <div style="margin-bottom:22px;position:relative;z-index:1;">
    <div style="font-size:11px;font-weight:700;color:#ff453a;letter-spacing:0.14em;text-transform:uppercase;margin-bottom:12px;">⚠ SURPRISING RISKS</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      ${riskCards || '<div style="color:rgba(255,255,255,0.3);font-size:13px;grid-column:span 2;">No extreme risk signals today.</div>'}
    </div>
  </div>

  <!-- SURPRISING STRENGTHS -->
  <div style="margin-bottom:auto;position:relative;z-index:1;">
    <div style="font-size:11px;font-weight:700;color:#30d158;letter-spacing:0.14em;text-transform:uppercase;margin-bottom:12px;">✦ SURPRISING STRENGTHS</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      ${strengthCards || '<div style="color:rgba(255,255,255,0.3);font-size:13px;grid-column:span 2;">No extreme strength signals today.</div>'}
    </div>
  </div>

  <!-- CTA -->
  <a href="${dashboardUrl}" style="display:block;text-align:center;padding:18px;background:linear-gradient(135deg,#0a84ff,#5e5ce6);color:#ffffff;border-radius:14px;font-size:15px;font-weight:600;text-decoration:none;letter-spacing:0.01em;margin-top:20px;position:relative;z-index:1;box-shadow:0 4px 20px rgba(10,132,255,0.25);">
    Explore the Full Dashboard →
  </a>

  <!-- Footer -->
  <div style="text-align:center;margin-top:14px;font-size:10px;color:rgba(255,255,255,0.25);position:relative;z-index:1;">
    macrointelligence.corp · Not investment advice
  </div>

</body>
</html>`;
}
