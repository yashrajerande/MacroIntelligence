/**
 * Template Filler Skill — Deterministic slot-filling engine.
 * No LLM. Pure regex + string replacement.
 */

import { INVERSE_INDICATORS } from '../../../../src/utils/indicator-schema.js';

/**
 * Generate a table row HTML string.
 * For inverse indicators, arrow colors are flipped (up=red, down=green).
 */
export function row(label, value, previous, direction, momentum, pct10y, tier, slug) {
  const inverse = slug ? INVERSE_INDICATORS.has(slug) : false;

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

  return `<tr>
  <td>${label}</td>
  <td>${value ?? 'Awaited'}</td>
  <td>${previous ?? '—'}</td>
  <td><span class="${arrClass}">${arrChar}</span></td>
  <td>${momentum || '—'}</td>
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
