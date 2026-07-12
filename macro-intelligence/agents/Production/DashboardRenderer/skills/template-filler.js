/**
 * Template Filler Skill — Deterministic slot-filling engine.
 * No LLM. Pure regex + string replacement.
 *
 * Polarity (which indicators flip arrow / percentile colors) is delegated
 * to the Polarity Skill — see src/utils/polarity.js. This file must not
 * duplicate polarity logic.
 */

import { isInversePolarity } from '../../../../src/utils/polarity.js';

/**
 * Render a compact inline-SVG sparkline from a {d, v} series.
 * Pure string generation — no charting library, ~350 bytes per row.
 * Color reflects polarity-aware trend: green = improving, red = worsening.
 */
export function sparkline(series, inverse) {
  if (!Array.isArray(series) || series.length < 3) return '';
  const vals = series.map(p => p.v).filter(Number.isFinite);
  if (vals.length < 3) return '';

  const W = 64, H = 18, PAD = 1;
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const step = (W - 2 * PAD) / (vals.length - 1);
  const pts = vals.map((v, i) => {
    const x = PAD + i * step;
    const y = H - PAD - ((v - min) / span) * (H - 2 * PAD);
    return `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`;
  }).join(' ');

  const rising = vals[vals.length - 1] > vals[0];
  const improving = inverse ? !rising : rising;
  const flat = vals[vals.length - 1] === vals[0];
  const color = flat ? '#8a8aa0' : improving ? '#007a52' : '#cc0033';

  return `<svg class="spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">` +
    `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.4" ` +
    `stroke-linejoin="round" stroke-linecap="round" opacity="0.85"/></svg>`;
}

/**
 * Generate a table row HTML string.
 * For negative-polarity indicators, arrow colors are flipped (up=red, down=green).
 * When dynamic stats exist and |z-score| > 2, a sigma tag + hover tooltip is added.
 * When a trailing series exists, a sparkline renders above the momentum label.
 */
export function row(label, value, previous, direction, momentum, pct10y, tier, slug, numericValue, stats) {
  const inverse = slug ? isInversePolarity(slug) : false;

  // Flip arrow semantics for inverse indicators
  let arrClass, arrChar;
  if (inverse) {
    arrClass = direction === 'up' ? 'arr dn' : direction === 'down' ? 'arr up' : 'arr fl';
  } else {
    arrClass = direction === 'up' ? 'arr up' : direction === 'down' ? 'arr dn' : 'arr fl';
  }
  arrChar = direction === 'up' ? '↑' : direction === 'down' ? '↓' : '→';

  // Flip tier colors for inverse indicators (hi=bad for inverse)
  let tierClass;
  if (inverse) {
    tierClass = tier === 'hi' ? 'pct-lo' : tier === 'lo' ? 'pct-hi' : 'pct-mid';
  } else {
    tierClass = tier === 'hi' ? 'pct-hi' : tier === 'lo' ? 'pct-lo' : 'pct-mid';
  }

  // Z-score anomaly detection
  let sigmaHtml = '';
  let tdClass = '';
  if (stats && stats.stddev > 0 && typeof numericValue === 'number') {
    const z = (numericValue - stats.mean) / stats.stddev;
    const absZ = Math.abs(z);
    if (absZ > 2) {
      const zLabel = absZ.toFixed(1) + 'σ';
      const tagClass = absZ > 3 ? 'sigma-tag alert' : 'sigma-tag warn';
      const dir = z > 0 ? 'above' : 'below';
      const fmt = (n) => Number.isInteger(n) ? n.toLocaleString() : n.toFixed(2);
      sigmaHtml = ` <span class="${tagClass}">${zLabel}</span>` +
        `<div class="stat-tip">` +
        `<b>Historical (180 days)</b><br>` +
        `Mean: ${fmt(stats.mean)} · StdDev: ±${fmt(stats.stddev)}<br>` +
        `Range: ${fmt(stats.min)} – ${fmt(stats.max)}<br>` +
        `Z-score: ${absZ.toFixed(1)}σ ${dir} mean</div>`;
      tdClass = ' class="has-tip"';
    }
  }

  // Sparkline stacked above the momentum label in the same cell —
  // no template column changes needed.
  const spark = sparkline(stats?.series, inverse);
  const momCell = spark
    ? `<div class="spark-wrap">${spark}<span>${momentum || '—'}</span></div>`
    : (momentum || '—');

  return `<tr>
  <td>${label}</td>
  <td${tdClass}>${value ?? 'Awaited'}${sigmaHtml}</td>
  <td>${previous ?? '—'}</td>
  <td><span class="${arrClass}">${arrChar}</span></td>
  <td>${momCell}</td>
  <td><span class="${tierClass}">${pct10y !== undefined ? pct10y + '%' : '~'}</span></td>
</tr>`;
}

/**
 * Generate the percentile bar HTML.
 */
export function pctBar(n, tier) {
  const tierClass = tier === 'hi' ? 'pct-hi' : tier === 'lo' ? 'pct-lo' : 'pct-mid';
  return `<div class="pct-bar"><div class="pct-fill ${tierClass}" style="width:${n}%"></div><span>${n}%</span></div>`;
}

/**
 * Arrow HTML helper.
 */
export function arrHtml(direction) {
  const cls = direction === 'up' ? 'arr-up' : direction === 'down' ? 'arr-down' : 'arr-flat';
  const chr = direction === 'up' ? '↑' : direction === 'down' ? '↓' : '→';
  return `<span class="${cls}">${chr}</span>`;
}

/**
 * Replace the inner content of an element by its id attribute.
 * Handles elements that contain child tags (e.g., <span> inside <div>).
 */
export function fillId(html, id, content) {
  // Match from id="..." opening through ALL content to the closing tag.
  // We extract the tag name first, then match to its specific closing tag.
  const openRegex = new RegExp(`(<(\\w+)[^>]*\\bid="${id}"[^>]*>)`, 'i');
  const openMatch = html.match(openRegex);
  if (!openMatch) {
    // Try alternate order: id might come before other attributes
    const altRegex = new RegExp(`(<(\\w+)\\s+id="${id}"[^>]*>)`, 'i');
    const altMatch = html.match(altRegex);
    if (!altMatch) return html;
    const [, openTag, tagName] = altMatch;
    const closeTag = `</${tagName}>`;
    const startIdx = html.indexOf(openTag);
    const contentStart = startIdx + openTag.length;
    const closeIdx = html.indexOf(closeTag, contentStart);
    if (closeIdx === -1) return html;
    return html.slice(0, contentStart) + content + html.slice(closeIdx);
  }
  const [, openTag, tagName] = openMatch;
  const closeTag = `</${tagName}>`;
  const startIdx = html.indexOf(openTag);
  const contentStart = startIdx + openTag.length;
  const closeIdx = html.indexOf(closeTag, contentStart);
  if (closeIdx === -1) return html;
  return html.slice(0, contentStart) + content + html.slice(closeIdx);
}

/**
 * Replace the content of a tbody by its id attribute.
 */
export function fillTbody(html, tbodyId, rowsHtml) {
  const regex = new RegExp(
    `(<tbody[^>]*id="${tbodyId}"[^>]*>)[\\s\\S]*?(</tbody>)`,
    'i'
  );
  return html.replace(regex, `$1\n${rowsHtml}\n$2`);
}

/**
 * Replace the window.__MACRO_DATA__ scaffold with the actual data object.
 */
export function fillMacroData(html, macroDataObj) {
  const jsonStr = JSON.stringify(macroDataObj, null, 2);
  const regex = /window\.__MACRO_DATA__\s*=\s*\{[\s\S]*?\};\s*\/\*\s*END __MACRO_DATA__\s*\*\//;
  const replacement = `window.__MACRO_DATA__ = ${jsonStr}; /* END __MACRO_DATA__ */`;
  return html.replace(regex, replacement);
}

/**
 * Replace tickerData array with live prices.
 */
export function fillTickerData(html, marketPrices) {
  const tickerItems = Object.entries(marketPrices).map(([slug, p]) => {
    const label = slug.replace(/_/g, ' ').toUpperCase();
    const sign = p.direction === 'up' ? '+' : p.direction === 'down' ? '' : '';
    return `{ label: "${label}", value: "${p.value_str || p.value}", change: "${sign}${p.change_pct}%" }`;
  });

  const regex = /const tickerData\s*=\s*\[[\s\S]*?\];/;
  const replacement = `const tickerData = [\n  ${tickerItems.join(',\n  ')}\n];`;
  return html.replace(regex, replacement);
}

/**
 * Assert no <!-- FILL --> markers remain.
 */
export function assertNoFillMarkers(html) {
  const remaining = (html.match(/<!--\s*FILL\s*-->/g) || []).length;
  if (remaining > 0) {
    throw new Error(`${remaining} <!-- FILL --> markers still present in template`);
  }
}
