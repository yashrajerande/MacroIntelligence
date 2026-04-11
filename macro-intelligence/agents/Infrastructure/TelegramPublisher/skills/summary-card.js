/**
 * Summary Card Skill — Dark vibrant mobile-friendly card for Telegram/WhatsApp.
 * 1080×1350px. Hero verdict, regime badges, 4 risks, 4 strengths, CTA.
 *
 * Polarity (which indicators count as risks vs strengths) is delegated
 * entirely to the Polarity Skill — see src/utils/polarity.js. This file
 * contains NO inline polarity logic. That is deliberate: polarity is a
 * single source of truth, and any agent that classifies indicators as
 * positive/negative MUST go through the skill.
 */

import { pickTopSignals } from '../../../../src/utils/polarity.js';

/**
 * Shape a scored indicator into the fields the card renderer needs.
 */
function toCardNode(ind) {
  return {
    name: ind.indicator_name,
    value: ind.latest_value,
    pct: ind.pct_10y,
    direction: ind.direction,
  };
}

/**
 * Format a number with proper commas and units for display on the card.
 */
function formatValue(value) {
  if (value === null || value === undefined) return '—';
  const str = String(value).trim();
  // Already formatted with units — just add commas to the numeric part
  const numMatch = str.match(/^([~]?)([₹$]?)(\d[\d.]*)(.*)/);
  if (!numMatch) return str;
  const [, prefix, currency, numStr, suffix] = numMatch;
  const num = parseFloat(numStr);
  if (isNaN(num)) return str;
  // Format with commas (Indian style for ₹, international otherwise)
  let formatted;
  if (currency === '₹' || suffix.includes('cr') || suffix.includes('lakh')) {
    formatted = num.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  } else {
    formatted = num.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
  return `${prefix}${currency}${formatted}${suffix}`;
}

/**
 * Generate the percentile badge HTML — bigger for the dark card.
 */
function pctBadge(pct, isRisk) {
  const color = isRisk ? '#ff453a' : '#30d158';
  const bgColor = isRisk ? 'rgba(255,69,58,0.18)' : 'rgba(48,209,88,0.18)';
  return `<div style="display:inline-flex;align-items:center;gap:5px;background:${bgColor};border-radius:8px;padding:4px 10px;">
    <div style="width:${Math.max(pct * 0.5, 5)}px;height:5px;background:${color};border-radius:3px;"></div>
    <span style="font-size:15px;font-weight:700;color:${color};">${pct}%</span>
  </div>`;
}

/**
 * Generate the HTML for the dark vibrant summary card.
 */
export function generateCardHTML({ verdictLine, macroDataObj, dateStr, dashboardUrl }) {
  const indicators = macroDataObj.indicators || [];
  // Polarity classification is delegated to the Polarity Skill.
  // It rejects garbage data (pct_10y at sentinel 0/100 with in-range values)
  // and scores each indicator on a signed [-100, +100] scale using the schema
  // inverse flag plus direction-of-change weighting.
  const risks = pickTopSignals(indicators, 4, 'negative').map(toCardNode);
  const strengths = pickTopSignals(indicators, 4, 'positive').map(toCardNode);

  const regimes = (macroDataObj.regime || []).map(r => {
    const dim = r.dimension.charAt(0).toUpperCase() + r.dimension.slice(1);
    const arrow = r.badge_type === 'b-exp' ? '↑' : r.badge_type === 'b-risk' ? '⚠' : r.badge_type === 'b-slow' ? '→' : '—';
    let color, bg, border;
    if (r.badge_type === 'b-exp') { color = '#30d158'; bg = 'rgba(48,209,88,0.12)'; border = 'rgba(48,209,88,0.30)'; }
    else if (r.badge_type === 'b-risk') { color = '#ff453a'; bg = 'rgba(255,69,58,0.12)'; border = 'rgba(255,69,58,0.30)'; }
    else if (r.badge_type === 'b-slow') { color = '#ff9f0a'; bg = 'rgba(255,159,10,0.12)'; border = 'rgba(255,159,10,0.30)'; }
    else { color = '#0a84ff'; bg = 'rgba(10,132,255,0.10)'; border = 'rgba(10,132,255,0.25)'; }
    return `<div style="background:${bg};border:1px solid ${border};border-radius:24px;padding:9px 18px;font-size:15px;font-weight:700;color:${color};white-space:nowrap;">${dim} ${arrow}</div>`;
  }).join('');

  const riskCards = risks.map(n => `
    <div style="background:rgba(255,255,255,0.05);border-radius:16px;padding:20px 18px;border-left:4px solid #ff453a;">
      <div style="font-size:16px;color:rgba(255,255,255,0.65);font-weight:500;margin-bottom:6px;">${n.name}</div>
      <div style="font-size:40px;font-weight:800;color:#ffffff;letter-spacing:-0.03em;line-height:1.1;">${formatValue(n.value)}</div>
      <div style="margin-top:10px;">
        ${pctBadge(n.pct, true)}
      </div>
    </div>
  `).join('');

  const strengthCards = strengths.map(n => `
    <div style="background:rgba(255,255,255,0.05);border-radius:16px;padding:20px 18px;border-left:4px solid #30d158;">
      <div style="font-size:16px;color:rgba(255,255,255,0.65);font-weight:500;margin-bottom:6px;">${n.name}</div>
      <div style="font-size:40px;font-weight:800;color:#ffffff;letter-spacing:-0.03em;line-height:1.1;">${formatValue(n.value)}</div>
      <div style="margin-top:10px;">
        ${pctBadge(n.pct, false)}
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
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;position:relative;z-index:1;">
    <div style="display:flex;align-items:center;gap:14px;">
      <div style="width:48px;height:48px;background:linear-gradient(135deg,#0a84ff,#bf5af2);border-radius:14px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:22px;box-shadow:0 4px 24px rgba(10,132,255,0.35);">M</div>
      <div>
        <div style="font-size:18px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#ffffff;">Macro Intelligence</div>
        <div style="font-size:13px;color:rgba(255,255,255,0.45);letter-spacing:0.04em;">${dateStr}</div>
      </div>
    </div>
  </div>

  <!-- Thin divider -->
  <div style="height:1px;background:rgba(255,255,255,0.08);margin-bottom:28px;position:relative;z-index:1;"></div>

  <!-- HERO VERDICT -->
  <div style="margin-bottom:30px;position:relative;z-index:1;">
    <div style="font-size:13px;font-weight:700;color:#0a84ff;letter-spacing:0.16em;text-transform:uppercase;margin-bottom:14px;">TODAY'S VERDICT</div>
    <div style="font-size:34px;font-weight:700;line-height:1.22;letter-spacing:-0.02em;color:#ffffff;">${verdictLine || 'Dashboard generated — see full report.'}</div>
  </div>

  <!-- REGIME STRIP -->
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:30px;position:relative;z-index:1;">
    ${regimes}
  </div>

  <!-- SURPRISING RISKS -->
  <div style="margin-bottom:22px;position:relative;z-index:1;">
    <div style="font-size:14px;font-weight:700;color:#ff453a;letter-spacing:0.14em;text-transform:uppercase;margin-bottom:14px;">⚠ SURPRISING RISKS</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      ${riskCards || '<div style="color:rgba(255,255,255,0.3);font-size:13px;grid-column:span 2;">No extreme risk signals today.</div>'}
    </div>
  </div>

  <!-- SURPRISING STRENGTHS -->
  <div style="margin-bottom:auto;position:relative;z-index:1;">
    <div style="font-size:14px;font-weight:700;color:#30d158;letter-spacing:0.14em;text-transform:uppercase;margin-bottom:14px;">✦ SURPRISING STRENGTHS</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      ${strengthCards || '<div style="color:rgba(255,255,255,0.3);font-size:13px;grid-column:span 2;">No extreme strength signals today.</div>'}
    </div>
  </div>

  <!-- CTA -->
  <a href="${dashboardUrl}" style="display:block;text-align:center;padding:20px;background:linear-gradient(135deg,#0a84ff,#5e5ce6);color:#ffffff;border-radius:16px;font-size:18px;font-weight:700;text-decoration:none;letter-spacing:0.02em;margin-top:20px;position:relative;z-index:1;box-shadow:0 4px 24px rgba(10,132,255,0.30);">
    Explore Full Dashboard →
  </a>

  <!-- Footer -->
  <div style="text-align:center;margin-top:14px;font-size:11px;color:rgba(255,255,255,0.3);position:relative;z-index:1;">
    macrointelligence.corp · Not investment advice
  </div>

</body>
</html>`;
}
