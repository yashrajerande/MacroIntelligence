/**
 * Template Filler Skill — Deterministic slot-filling engine.
 * No LLM. Pure regex + string replacement.
 */

/**
 * Generate a table row HTML string.
 */
export function row(label, value, previous, direction, momentum, pct10y, tier) {
  const arrClass = direction === 'up' ? 'arr-up' : direction === 'down' ? 'arr-down' : 'arr-flat';
  const arrChar = direction === 'up' ? '↑' : direction === 'down' ? '↓' : '→';
  const tierClass = tier === 'hi' ? 'pct-hi' : tier === 'lo' ? 'pct-lo' : 'pct-mid';

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
 */
export function fillId(html, id, content) {
  const regex = new RegExp(
    `(id="${id}"[^>]*>)[\\s\\S]*?(</)`,
    'i'
  );
  return html.replace(regex, `$1${content}$2`);
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
