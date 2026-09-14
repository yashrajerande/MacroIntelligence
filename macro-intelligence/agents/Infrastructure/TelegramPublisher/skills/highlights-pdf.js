/**
 * Highlights PDF Skill — "Daily Highlights" brief as a phone-readable PDF.
 *
 * The PNG card is a glance; this is the read. It carries everything a
 * reader needs to understand the day without opening the dashboard:
 * verdict, the three snap tiles, the six-dimension regime board, the
 * executive summary, all signals with their "so what", surprising
 * risks/strengths, scenarios, the private-debt read, and the news.
 *
 * Page size is A5 portrait on purpose: Telegram's in-app PDF viewer fits
 * a page to the phone's width, so a narrow page renders at a comfortable
 * body size instead of the unreadable shrunken A4/Letter.
 *
 * Two exports, deliberately separated so the HTML builder is a pure
 * function the pre-flight suite can exercise without a browser:
 *
 *   generateHighlightsHTML(macroDataObj, { dateStr, dashboardUrl }) → string
 *   htmlToPdf(html, outputPath)                                     → Buffer
 *
 * Polarity (which indicators are risks vs strengths) is delegated to the
 * Polarity Skill — same single source of truth the card uses.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { pickTopSignals } from '../../../../src/utils/polarity.js';
import { findChrome } from './screenshot.js';

// ── Text helpers ────────────────────────────────────────────────────────

/** Escape a plain-text field for HTML. */
export function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * LLM-authored rich text (executive-summary paragraphs, regime narratives)
 * arrives as HTML with <strong>/<p> emphasis. Keep that emphasis, drop
 * every other tag and every attribute, so nothing the model wrote can
 * inject markup or scripts into the brief.
 */
export function sanitizeRich(html) {
  if (!html) return '';
  return String(html)
    // Strip every tag that is not in the allow-list.
    .replace(/<(?!\/?(?:strong|em|b|i|p|br)\b)[^>]*>/gi, '')
    // Strip attributes from the allowed tags.
    .replace(/<(\/?)(strong|em|b|i|p|br)\b[^>]*>/gi, '<$1$2>');
}

/** Regime / signal badge → colour role. */
function tone(badgeType) {
  if (badgeType === 'b-exp') return 'good';
  if (badgeType === 'b-risk') return 'bad';
  if (badgeType === 'b-slow') return 'warn';
  return 'neu';
}

function signalTone(status) {
  if (status === 'risk') return 'bad';
  if (status === 'positive') return 'good';
  if (status === 'watch') return 'warn';
  if (status === 'surprise') return 'accent';
  return 'neu';
}

function cap(s) {
  s = String(s || '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  return String(value).trim();
}

// ── HTML builder ────────────────────────────────────────────────────────

/**
 * Build the Daily Highlights brief.
 *
 * @param {object} macroDataObj — the renderer's __MACRO_DATA__ object
 * @param {object} opts
 * @param {string} opts.dateStr       — e.g. "14 SEP 2026"
 * @param {string} opts.dashboardUrl
 * @returns {string} full HTML document
 */
export function generateHighlightsHTML(macroDataObj, { dateStr, dashboardUrl } = {}) {
  const d = macroDataObj || {};
  const run = d.run || {};
  const regime = Array.isArray(d.regime) ? d.regime : [];
  const signals = Array.isArray(d.signals) ? d.signals : [];
  const news = Array.isArray(d.news) ? d.news : [];
  const indicators = Array.isArray(d.indicators) ? d.indicators : [];
  const execSummary = Array.isArray(d.executive_summary) ? d.executive_summary : [];
  const leverage = d.leverage || {};
  const url = dashboardUrl || 'https://yashrajerande.github.io/MacroIntelligence/';
  const date = dateStr || run.run_date || '';

  // Top risk: the renderer stores only the title in run.snap_risk; pull
  // the evidence line from the matching signal when it exists.
  const topRiskSignal = signals.find(s => s.title === run.snap_risk) || null;

  const risks = pickTopSignals(indicators, 4, 'negative');
  const strengths = pickTopSignals(indicators, 4, 'positive');

  // ── Sections ──────────────────────────────────────────────────────
  const regimeRows = regime.map(r => `
    <tr>
      <td class="dim">${esc(cap(r.dimension))}</td>
      <td><span class="pill ${tone(r.badge_type)}">${esc(r.badge_label || '—')}</span></td>
      <td class="metric">${esc(r.metric_summary || '')}</td>
    </tr>`).join('');

  const execParas = execSummary.map(p => `
    <div class="para">
      <div class="para-label">${esc(p.para_label || `Section ${p.para_num || ''}`)}</div>
      <div class="para-body">${sanitizeRich(p.para_html)}</div>
    </div>`).join('');

  const signalBlocks = signals.map(s => `
    <div class="signal">
      <div class="signal-head">
        <span class="theme">${esc(s.signal_theme || '')}</span>
        <span class="pill ${signalTone(s.status)}">${esc(cap(s.status || ''))}${
          s.pct_10y !== undefined && s.pct_10y !== null ? ` · P${esc(s.pct_10y)}` : ''}</span>
      </div>
      <div class="signal-title">${esc(s.title || '')}</div>
      ${s.data_text ? `<div class="signal-data">${esc(s.data_text)}</div>` : ''}
      ${s.implication ? `<div class="signal-so"><span>So what:</span> ${esc(s.implication)}</div>` : ''}
    </div>`).join('');

  const indRow = (ind, cls) => `
    <tr>
      <td class="ind-name">${esc(ind.indicator_name)}</td>
      <td class="ind-val">${esc(formatValue(ind.latest_value))}</td>
      <td class="ind-pct"><span class="pill ${cls}">P${esc(ind.pct_10y)}</span></td>
    </tr>`;
  const riskRows = risks.map(i => indRow(i, 'bad')).join('');
  const strengthRows = strengths.map(i => indRow(i, 'good')).join('');

  const scenario = (name, prob, txt, cls) => (name ? `
    <div class="scenario">
      <div class="scenario-head">
        <span class="pill ${cls}">${esc(name)}</span>
        ${prob ? `<span class="prob">${esc(prob)}%</span>` : ''}
      </div>
      <div class="scenario-body">${esc(txt || '')}</div>
    </div>` : '');
  const scenarios =
    scenario(run.scenario_base_name, run.scenario_base_prob, run.scenario_base_txt, 'neu') +
    scenario(run.scenario_bull_name, run.scenario_bull_prob, run.scenario_bull_txt, 'good') +
    scenario(run.scenario_bear_name, run.scenario_bear_prob, run.scenario_bear_txt, 'bad');

  // RSS feeds deliver URLs with '&amp;' already entity-encoded; decode
  // once so esc() does not produce '&amp;amp;' and break the query string.
  const newsItems = news.map(n => `
    <li>
      <a href="${esc(String(n.url || '#').replace(/&amp;/g, '&'))}">${esc(n.headline || '')}</a>
      <span class="src">${esc(n.source_name || n.category || '')}</span>
    </li>`).join('');

  const hasLeverage = leverage.narrative && String(leverage.narrative).trim().length > 0;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>MacroIntelligence — Daily Highlights — ${esc(date)}</title>
<style>
  @page { size: 148mm 210mm; margin: 11mm 10mm 13mm 10mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif;
    color: #111827;
    font-size: 10.5pt;
    line-height: 1.45;
    background: #ffffff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  a { color: #1d4ed8; text-decoration: none; }

  /* Header */
  .masthead { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #111827; padding-bottom: 6px; margin-bottom: 12px; }
  .brand { font-size: 8.5pt; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: #1d4ed8; }
  .title { font-size: 17pt; font-weight: 800; letter-spacing: -0.02em; line-height: 1.1; margin-top: 2px; }
  .date { text-align: right; font-size: 9pt; color: #6b7280; }
  .date b { display: block; color: #111827; font-size: 10.5pt; }

  /* Verdict */
  .verdict { background: #111827; color: #ffffff; border-radius: 10px; padding: 12px 14px; margin-bottom: 12px; page-break-inside: avoid; }
  .verdict .kicker { font-size: 7.5pt; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: #93c5fd; margin-bottom: 4px; }
  .verdict .line { font-size: 12.5pt; font-weight: 700; line-height: 1.3; letter-spacing: -0.01em; }

  /* Snap tiles */
  .tiles { display: grid; grid-template-columns: 1fr; gap: 6px; margin-bottom: 14px; }
  .tile { border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px 10px; page-break-inside: avoid; }
  .tile .k { font-size: 7.5pt; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #6b7280; margin-bottom: 3px; }
  .tile .v { font-size: 10.5pt; font-weight: 600; }
  .tile .sub { font-size: 9pt; color: #4b5563; margin-top: 2px; }

  /* Section headings */
  h2 { font-size: 9pt; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; color: #111827; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; margin: 16px 0 8px; page-break-after: avoid; }

  /* Pills */
  .pill { display: inline-block; font-size: 8pt; font-weight: 700; padding: 2px 7px; border-radius: 999px; white-space: nowrap; line-height: 1.3; }
  .pill.good { background: #dcfce7; color: #166534; }
  .pill.bad { background: #fee2e2; color: #991b1b; }
  .pill.warn { background: #fef3c7; color: #92400e; }
  .pill.neu { background: #dbeafe; color: #1e40af; }
  .pill.accent { background: #ede9fe; color: #5b21b6; }

  /* Regime table */
  table { width: 100%; border-collapse: collapse; }
  .regime td { padding: 5px 4px; border-bottom: 1px solid #f3f4f6; vertical-align: middle; font-size: 9.5pt; }
  .regime .dim { font-weight: 700; width: 26%; }
  .regime .metric { color: #4b5563; text-align: right; font-variant-numeric: tabular-nums; }

  /* Executive summary */
  .para { margin-bottom: 9px; page-break-inside: avoid; }
  .para-label { font-size: 8pt; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #1d4ed8; margin-bottom: 2px; }
  .para-body p { margin: 0 0 4px; }
  .para-body strong { font-weight: 700; color: #111827; }

  /* Signals */
  .signal { border-left: 3px solid #e5e7eb; padding: 4px 0 4px 10px; margin-bottom: 10px; page-break-inside: avoid; }
  .signal-head { display: flex; justify-content: space-between; align-items: center; gap: 6px; margin-bottom: 2px; }
  .theme { font-size: 7.5pt; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #6b7280; }
  .signal-title { font-size: 11pt; font-weight: 700; line-height: 1.25; margin-bottom: 3px; }
  .signal-data { font-size: 9pt; color: #4b5563; margin-bottom: 3px; }
  .signal-so { font-size: 9.5pt; }
  .signal-so span { font-weight: 700; color: #1d4ed8; }

  /* Indicators */
  .ind td { padding: 4px 4px; border-bottom: 1px solid #f3f4f6; font-size: 9.5pt; vertical-align: middle; }
  .ind .ind-val { text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .ind .ind-pct { text-align: right; width: 14%; }
  .two-col { display: grid; grid-template-columns: 1fr; gap: 10px; }
  .sub-h { font-size: 8pt; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 4px; }
  .sub-h.bad { color: #991b1b; } .sub-h.good { color: #166534; }

  /* Scenarios */
  .scenario { margin-bottom: 8px; page-break-inside: avoid; }
  .scenario-head { display: flex; align-items: center; gap: 8px; margin-bottom: 2px; }
  .prob { font-weight: 700; font-variant-numeric: tabular-nums; }
  .scenario-body { font-size: 9.5pt; color: #374151; }

  /* Leverage */
  .lev { font-size: 9.5pt; color: #374151; }

  /* News */
  ul.news { list-style: none; padding: 0; margin: 0; }
  ul.news li { padding: 4px 0; border-bottom: 1px solid #f3f4f6; font-size: 9.5pt; }
  ul.news .src { display: block; font-size: 8pt; color: #6b7280; }

  /* Footer */
  .foot { margin-top: 16px; padding-top: 8px; border-top: 1px solid #e5e7eb; font-size: 8pt; color: #6b7280; display: flex; justify-content: space-between; gap: 10px; }
  .cta { display: block; text-align: center; margin-top: 14px; padding: 10px; background: #1d4ed8; color: #ffffff; border-radius: 8px; font-weight: 700; font-size: 10pt; }
  .empty { color: #9ca3af; font-size: 9pt; }
</style>
</head>
<body>

  <div class="masthead">
    <div>
      <div class="brand">MacroIntelligence Corp</div>
      <div class="title">Daily Highlights</div>
    </div>
    <div class="date"><b>${esc(date)}</b>${run.ist_time ? esc(run.ist_time) : ''}</div>
  </div>

  <div class="verdict">
    <div class="kicker">Today's verdict</div>
    <div class="line">${esc(run.snap_verdict || 'Dashboard generated — see full report.')}</div>
  </div>

  <div class="tiles">
    <div class="tile">
      <div class="k">India</div>
      <div class="v">${run.india_regime ? `<span class="pill ${tone((regime.find(r => r.dimension === 'growth') || {}).badge_type)}">${esc(run.india_regime)}</span> ` : ''}${esc(run.snap_india || '')}</div>
    </div>
    <div class="tile">
      <div class="k">Global regime</div>
      <div class="v">${run.global_regime ? `<span class="pill neu">${esc(run.global_regime)}</span>` : ''}</div>
      ${run.snap_global ? `<div class="sub">${esc(run.snap_global)}</div>` : ''}
    </div>
    <div class="tile">
      <div class="k">Top risk now</div>
      <div class="v">${topRiskSignal ? `<span class="pill bad">Risk${topRiskSignal.pct_10y !== undefined ? ` · P${esc(topRiskSignal.pct_10y)}` : ''}</span> ` : ''}${esc(run.snap_risk || 'Monitoring')}</div>
      ${topRiskSignal && topRiskSignal.data_text ? `<div class="sub">${esc(topRiskSignal.data_text)}</div>` : ''}
    </div>
  </div>

  <h2>Regime board</h2>
  ${regimeRows ? `<table class="regime">${regimeRows}</table>` : '<div class="empty">No regime classification today.</div>'}

  <h2>Executive summary</h2>
  ${execParas || '<div class="empty">No executive summary today.</div>'}

  <h2>Signals</h2>
  ${signalBlocks || '<div class="empty">No signals today.</div>'}

  <h2>Surprising moves</h2>
  <div class="two-col">
    <div>
      <div class="sub-h bad">Risks — extreme on a 10-year view</div>
      ${riskRows ? `<table class="ind">${riskRows}</table>` : '<div class="empty">No extreme risk signals today.</div>'}
    </div>
    <div>
      <div class="sub-h good">Strengths — extreme on a 10-year view</div>
      ${strengthRows ? `<table class="ind">${strengthRows}</table>` : '<div class="empty">No extreme strength signals today.</div>'}
    </div>
  </div>

  ${scenarios ? `<h2>Scenarios</h2>${scenarios}` : ''}

  ${hasLeverage ? `<h2>Private debt (Keen / Minsky read)</h2><div class="lev">${esc(leverage.narrative)}</div>` : ''}

  ${newsItems ? `<h2>In the news</h2><ul class="news">${newsItems}</ul>` : ''}

  <a class="cta" href="${esc(url)}">Open the full dashboard →</a>

  <div class="foot">
    <span>MacroIntelligence Corp · Daily Highlights · ${esc(date)}</span>
    <span>Not investment advice</span>
  </div>

</body>
</html>`;
}

// ── PDF renderer ────────────────────────────────────────────────────────

/**
 * Render HTML to a PDF file with headless Chrome (puppeteer-core, same
 * engine the PNG card uses). Returns the PDF bytes.
 *
 * @param {string} html
 * @param {string} outputPath
 * @param {object} [options]
 * @param {string} [options.width='148mm']   — A5 portrait
 * @param {string} [options.height='210mm']
 * @returns {Promise<Buffer>}
 */
export async function htmlToPdf(html, outputPath, options = {}) {
  const { width = '148mm', height = '210mm' } = options;

  let puppeteer;
  try {
    puppeteer = await import('puppeteer-core');
  } catch {
    throw new Error('[HighlightsPDF] puppeteer-core not installed. Run: npm install puppeteer-core');
  }

  const executablePath = findChrome();
  if (!executablePath) {
    throw new Error('[HighlightsPDF] No Chrome/Chromium found on system');
  }

  const browser = await puppeteer.default.launch({
    executablePath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();
    // No external fonts are referenced, so 'load' is enough and the render
    // cannot hang on a blocked font CDN.
    await page.setContent(html, { waitUntil: 'load', timeout: 15000 });
    await page.emulateMediaType('print');
    await page.evaluate(() => document.fonts.ready);

    const buffer = Buffer.from(await page.pdf({
      width,
      height,
      printBackground: true,
      preferCSSPageSize: true,
    }));

    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, buffer);
    console.log(`[HighlightsPDF] Saved ${outputPath} (${buffer.length} bytes, ${width} x ${height})`);
    return buffer;
  } finally {
    await browser.close();
  }
}
