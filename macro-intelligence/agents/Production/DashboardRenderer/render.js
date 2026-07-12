/**
 * DashboardRenderer — Pure code. No LLM.
 * Assembles all data contracts into the master HTML template.
 * Template IDs are locked to macro-intelligence-light.html v1.0.0.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SLUG_MAP } from '../../../src/utils/indicator-schema.js';
import { isInversePolarity } from '../../../src/utils/polarity.js';
import { row, fillId, fillTbody, fillMacroData, fillTickerData } from './skills/template-filler.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');

/** Format IST time as "HH:MM IST" */
function getISTTime() {
  const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const h = String(ist.getHours()).padStart(2, '0');
  const m = String(ist.getMinutes()).padStart(2, '0');
  return `${h}:${m} IST`;
}

/** Map regime dimension to the abbreviated ID used in the template */
const DIM_ID = {
  growth:      'growth',
  inflation:   'infl',
  credit:      'credit',
  policy:      'policy',
  capex:       'capex',
  consumption: 'cons',
};

/** Build an indicator object in the __MACRO_DATA__ format */
function buildIndicatorObj(slug, raw) {
  const meta = SLUG_MAP[slug] || {
    section: 'S9', sub_section: 'unknown',
    indicator_name: slug.replace(/_/g, ' '), unit: '',
  };

  const latestNum = typeof raw.value === 'number' ? raw.value : null;
  const prevNum   = typeof raw.previous === 'number' ? raw.previous : null;

  const prefix = raw.is_estimated ? '~' : '';
  const unit   = meta.unit || '';
  const latestValue = latestNum !== null
    ? `${prefix}${raw.value_str || latestNum}${unit ? ' ' + unit : ''}`
    : 'Awaited';

  return {
    section:          meta.section,
    sub_section:      meta.sub_section,
    indicator_name:   meta.indicator_name,
    indicator_slug:   slug,
    latest_value:     latestValue,
    latest_numeric:   latestNum,
    latest_unit:      meta.unit,
    previous_value:   prevNum !== null ? String(prevNum) : null,
    previous_numeric: prevNum,
    data_vintage:     raw.vintage || 'Awaited',
    direction:        raw.direction || 'flat',
    momentum_label:   raw.momentum_label || '',
    pct_10y:          raw.pct_10y ?? 50,
    pct_10y_tier:     raw.pct_10y_tier || 'mid',
    pct_note:         raw.pct_note || '',
    is_estimated:     raw.is_estimated || false,
    source:           raw.source || '',
  };
}

export class DashboardRenderer {
  render(allData) {
    const start = Date.now();

    // Load template
    let html = readFileSync(join(ROOT, 'template', 'macro-intelligence-light.html'), 'utf-8');

    // Inject Rabbit Hole Edge Function URL
    const rabbitHoleUrl = process.env.RABBIT_HOLE_URL || '';
    html = html.replace('%%RABBIT_HOLE_URL%%', rabbitHoleUrl);

    const {
      marketData, macroData, reData,
      regime, signals, scenarios, news, execSummary,
      dateStr, isoDate, dynamicRanges,
    } = allData;

    // ── Merge all raw indicators ─────────────────────────────────────
    const allRaw = {
      ...marketData.data.prices,
      ...macroData.data.indicators,
      ...reData.data.indicators,
    };

    // ── Sanitize: swap suspect values for previous data ─────────────
    const staleIndicators = [];
    if (dynamicRanges) {
      for (const [slug, raw] of Object.entries(allRaw)) {
        if (typeof raw.value !== 'number') continue;
        const stats = dynamicRanges[slug];
        if (!stats || !stats.stddev) continue;

        const effectiveStddev = Math.max(stats.stddev, Math.abs(stats.mean) * 0.05);
        const z = Math.abs(raw.value - stats.mean) / effectiveStddev;

        if (z > 4 && raw.previous != null) {
          staleIndicators.push({
            slug,
            name: (SLUG_MAP[slug] || {}).indicator_name || slug,
            badValue: raw.value,
            zScore: z.toFixed(1),
            previousValue: raw.previous,
            vintage: raw.vintage || 'unknown',
          });
          raw.value = raw.previous;
          raw.value_str = String(raw.previous);
          raw.direction = 'flat';
          raw.momentum_label = '(stale)';
        }
      }
      if (staleIndicators.length > 0) {
        console.log(`[DashboardRenderer] Substituted ${staleIndicators.length} suspect indicator(s) with previous values:`);
        for (const s of staleIndicators) {
          console.log(`  ↳ ${s.slug}: ${s.badValue} (${s.zScore}σ) → ${s.previousValue}`);
        }
      }
    }

    // ── Build indicators array (template format) ─────────────────────
    const indicators = Object.entries(allRaw).map(([slug, raw]) =>
      buildIndicatorObj(slug, raw)
    );

    // ── Derive snap texts ────────────────────────────────────────────
    const growthRegime  = regime.data.find(r => r.dimension === 'growth') || {};
    const inflRegime    = regime.data.find(r => r.dimension === 'inflation') || {};
    const policyRegime  = regime.data.find(r => r.dimension === 'policy') || {};

    const nifty   = allRaw.nifty50 || {};
    const inrUsd  = allRaw.inr_usd || {};
    const brent   = allRaw.brent_usd || {};
    const dxy     = allRaw.dxy || {};

    // Use the ExecSummaryWriter's verdict_line if available, fall back to regime labels
    const snapVerdict = allData.execSummary?.verdict_line
      || `${growthRegime.badge_label || 'Steady'} Growth | ${inflRegime.badge_label || 'Moderate'} Inflation`;
    const inrVal = inrUsd.value && inrUsd.value < 1 ? (1 / inrUsd.value).toFixed(2) : inrUsd.value;
    const snapIndia   = `Nifty ${nifty.value_str || nifty.value || '—'} | INR/USD ${inrVal || '—'}`;
    const snapGlobal  = `Brent $${brent.value || '—'} | DXY ${dxy.value || '—'}`;
    const snapRisk    = signals.data.find(s => s.status === 'risk')?.title || 'Monitoring';

    // ── Derive real estate summary ───────────────────────────────────
    const embassyRaw    = allRaw.embassy_reit || {};
    const gsecRaw       = allRaw.gsec_10y || {};
    const embassyYield  = embassyRaw.value ? (embassyRaw.value / 100) : null; // unit: ₹/unit → yield estimated
    const gsecYield     = typeof gsecRaw.value === 'number' ? gsecRaw.value : null;

    // Spread: approximate from raw REIT distribution yield if available
    const reitVsGsecBps = gsecYield !== null && embassyYield !== null
      ? Math.round((embassyYield - gsecYield) * 100)
      : null;

    const launchesDir = (allRaw.re_launches_units || {}).direction || 'flat';
    const absorbDir   = (allRaw.office_absorption || {}).direction || 'flat';
    const residentialRegime = launchesDir === 'up' ? 'Hot' : launchesDir === 'down' ? 'Cooling' : 'Stable';
    const commercialRegime  = absorbDir   === 'up' ? 'Hot' : absorbDir   === 'down' ? 'Cooling' : 'Stable';

    const bearScenario  = scenarios.data.bear;
    const keyRiskNote   = bearScenario?.description?.split('.')[0] || '';

    const reSummaryText =
      `Residential market is ${residentialRegime.toLowerCase()}; ` +
      `commercial absorption is ${absorbDir === 'up' ? 'strong' : absorbDir === 'down' ? 'weakening' : 'steady'}.`;

    // ── Build __MACRO_DATA__ object ──────────────────────────────────
    const macroDataObj = {
      run: {
        run_date:           isoDate,
        ist_time:           getISTTime(),
        snap_verdict:       snapVerdict,
        snap_india:         snapIndia,
        snap_global:        snapGlobal,
        snap_risk:          snapRisk,
        india_regime:       growthRegime.badge_label || '',
        global_regime:      policyRegime.badge_label || '',
        scenario_base_prob: scenarios.data.scenario_base_prob || 0,
        scenario_base_name: scenarios.data.base?.name || '',
        scenario_base_txt:  scenarios.data.base?.description || '',
        scenario_bull_prob: scenarios.data.scenario_bull_prob || 0,
        scenario_bull_name: scenarios.data.bull?.name || '',
        scenario_bull_txt:  scenarios.data.bull?.description || '',
        scenario_bear_prob: scenarios.data.scenario_bear_prob || 0,
        scenario_bear_name: scenarios.data.bear?.name || '',
        scenario_bear_txt:  scenarios.data.bear?.description || '',
      },
      regime:            regime.data,
      signals:           signals.data,
      news:              news.data,
      indicators,
      executive_summary: execSummary.data,
      real_estate: {
        re_summary_text:         reSummaryText,
        residential_regime:      residentialRegime,
        commercial_regime:       commercialRegime,
        reit_vs_gsec_spread_bps: reitVsGsecBps,
        key_risk_note:           keyRiskNote,
      },
    };

    // ── Fill template slot-IDs ───────────────────────────────────────

    // Snap bar
    html = fillId(html, 'snap-verdict', snapVerdict);
    html = fillId(html, 'snap-india',   snapIndia);
    html = fillId(html, 'snap-global',  snapGlobal);
    html = fillId(html, 'snap-risk',    snapRisk);

    // Header / footer dates
    html = fillId(html, 'header-date', dateStr);
    html = fillId(html, 'footer-date', dateStr);

    // S1 badge and summary
    const s1Badge   = `${growthRegime.badge_label || 'Steady'} — ${inflRegime.badge_label || 'Moderate'}`;
    const s1Summary = growthRegime.metric_summary || '';
    html = fillId(html, 's1-badge',   s1Badge);
    html = fillId(html, 's1-summary', s1Summary);

    // Regime cards (6 dimensions)
    for (const r of regime.data) {
      const id = DIM_ID[r.dimension] || r.dimension;
      html = fillId(html, `rc-${id}-m`, r.metric_summary || '');
      html = fillId(html, `rc-${id}-s`, r.signal_text    || '');
      html = fillId(html, `rc-${id}-b`, r.badge_label    || '');
    }

    // Signal cards (7 signals) — update status class + label dynamically
    const STATUS_LABELS = {
      positive: '✦ Positive',
      risk:     '⚠ Risk',
      watch:    '◎ Watch',
      surprise: '⚡ Surprise',
    };
    for (const s of signals.data) {
      const n = s.signal_num;
      const status = s.status || 'watch';
      html = fillId(html, `sig${n}-title`, s.title      || '');
      html = fillId(html, `sig${n}-data`,  s.data_text  || '');
      html = fillId(html, `sig${n}-impl`,  s.implication|| '');
      html = fillId(html, `sig${n}-pct`,   `${s.pct_10y ?? 0}%`);

      // Update the signal card's CSS class and status badge together
      // Match: <div class="sc OLDSTATUS" id="sigN">...<div class="sc-status OLDSTATUS">OLD LABEL</div>
      const sigBlockRegex = new RegExp(
        `(<div class="sc )\\w+(" id="sig${n}">[\\s\\S]*?<div class="sc-status )\\w+(">)[^<]*(</div>)`,
        'i'
      );
      html = html.replace(sigBlockRegex, (_, p1, p2, p3, p4) =>
        `${p1}${status}${p2}${status}${p3}${STATUS_LABELS[status] || STATUS_LABELS.watch}${p4}`
      );
    }

    // Executive summary (5 paragraphs)
    for (const p of execSummary.data) {
      const padded = String(p.para_num).padStart(2, '0');
      html = fillId(html, `exec-${padded}`, p.para_html || '');
    }

    // News cards — text and URL
    for (const n of news.data) {
      const cat = n.category;
      html = fillId(html, `news-${cat}-src`, n.source_name || '');
      // Fill headline text (the anchor element's inner content via news-{cat}-hl id)
      html = fillId(html, `news-${cat}-hl`, n.headline || '');
      // Fix href via the news-{cat}-url id (href precedes the id in template)
      const url = n.url && n.url !== '#' ? n.url : '#';
      html = html.replace(
        new RegExp(`(<a href=")[^"]*(" id="news-${cat}-url")`, 'i'),
        `$1${url}$2`
      );
    }

    // Scenarios
    const sc = scenarios.data;
    html = fillId(html, 'sc-base-name', sc.base?.name        || '');
    html = fillId(html, 'sc-base-txt',  sc.base?.description || '');
    html = fillId(html, 'sc-base-prob', sc.base?.prob_label  || '');
    html = fillId(html, 'sc-bull-name', sc.bull?.name        || '');
    html = fillId(html, 'sc-bull-txt',  sc.bull?.description || '');
    html = fillId(html, 'sc-bull-prob', sc.bull?.prob_label  || '');
    html = fillId(html, 'sc-bear-name', sc.bear?.name        || '');
    html = fillId(html, 'sc-bear-txt',  sc.bear?.description || '');
    html = fillId(html, 'sc-bear-prob', sc.bear?.prob_label  || '');

    // Real estate summary text
    html = fillId(html, 's10-re-summary', reSummaryText);

    // ── Fill data tables ─────────────────────────────────────────────
    const makeRows = (slugs) => slugs.map(slug => {
      const ind = allRaw[slug] || {};
      const meta = SLUG_MAP[slug] || {};
      const label = meta.indicator_name || slug.replace(/_/g, ' ');
      const stats = dynamicRanges?.[slug] || null;
      return row(
        label,
        ind.value_str || ind.value,
        ind.previous,
        ind.direction    || 'flat',
        ind.momentum_label || '',
        ind.pct_10y      ?? 50,
        ind.pct_10y_tier || 'mid',
        slug,
        ind.value,
        stats,
      );
    }).join('\n');

    // India sections (S2–S7)
    html = fillTbody(html, 's2-body', makeRows([
      'india_gdp_yoy', 'india_gdp_fy_estimate', 'rbi_gdp_forecast',
      'pmi_mfg', 'pmi_services', 'pmi_composite',
      'iip_yoy', 'iip_capgoods', 'capacity_utilisation', 'core_sector_yoy',
    ]));
    html = fillTbody(html, 's3-body', makeRows([
      'cpi_headline', 'cpi_core', 'cfpi_food', 'wpi',
      'fuel_inflation', 'rbi_repo_rate', 'rbi_inflation_forecast',
    ]));
    html = fillTbody(html, 's4-body', makeRows([
      'gst_month', 'gst_ytd', 'pv_sales', '2w_sales',
      'cv_sales', 'airline_pax', 'ecom_gmv_growth',
    ]));
    html = fillTbody(html, 's5-body', makeRows([
      'bank_credit_growth', 'deposit_growth', 'cd_ratio',
      'nbfc_credit_growth', 'corp_bond_issuance',
    ]));
    html = fillTbody(html, 's6-body', makeRows([
      'fii_equity_net', 'dii_equity_net', 'sip_inflows', 'sip_yoy_growth',
      'mf_aum', 'mf_avg_aum', 'equity_mf_net', 'nfo_collections',
      'sip_accounts', 'sip_aum',
    ]));
    html = fillTbody(html, 's7-body', makeRows([
      'nifty50', 'sensex', 'bank_nifty', 'india_vix',
      'gsec_10y', 'inr_usd', 'gold_inr_gram', 'brent_usd', 'rbi_fx_reserves',
    ]));

    // Real estate (S8)
    html = fillTbody(html, 's10-residential', makeRows([
      're_launches_units', 're_sales_units', 're_unsold_inventory',
      'hpi_mumbai', 'hpi_delhi', 'hpi_bengaluru', 'hpi_hyderabad',
      'affordability_index', 'home_loan_disbursements', 'avg_home_loan_rate',
    ]));
    html = fillTbody(html, 's10-commercial', makeRows([
      'office_absorption', 'office_vacancy', 'rent_bengaluru', 'rent_mumbai',
      'retail_mall_vacancy', 'embassy_reit', 'mindspace_reit', 'brookfield_reit',
    ]));

    // Global (S9) — tables use s8-* IDs in template
    html = fillTbody(html, 's8-growth', makeRows([
      'us_gdp_saar', 'china_gdp', 'ez_gdp',
      'global_pmi_composite', 'us_pmi_composite', 'china_pmi_composite',
    ]));
    html = fillTbody(html, 's8-inflation', makeRows([
      'us_cpi', 'us_core_cpi', 'us_core_pce',
      'ez_cpi', 'china_cpi', 'fao_food_index',
    ]));
    html = fillTbody(html, 's8-liquidity', makeRows([
      'fed_funds_rate', 'fed_balance_sheet', 'ecb_deposit_rate',
      'boj_rate', 'us_10y_treasury', 'dxy',
    ]));
    html = fillTbody(html, 's8-markets', makeRows([
      'sp500', 'nasdaq', 'euro_stoxx50', 'hang_seng', 'nikkei225', 'us_vix',
      'brent_usd_global', 'wti_usd', 'nat_gas', 'gold_usd', 'copper', 'iron_ore', 'bdi',
    ]));

    // ── Top movers strip: biggest polarity-aware daily moves ─────────
    const movers = Object.entries(allRaw)
      .filter(([slug, r]) =>
        SLUG_MAP[slug] &&
        typeof r.value === 'number' &&
        typeof r.change_pct === 'number' &&
        !r.fetch_error &&
        Math.abs(r.change_pct) >= 0.5)
      .sort((a, b) => Math.abs(b[1].change_pct) - Math.abs(a[1].change_pct))
      .slice(0, 5);
    if (movers.length >= 2) {
      const chips = movers.map(([slug, r]) => {
        const meta = SLUG_MAP[slug];
        const good = isInversePolarity(slug) ? r.change_pct < 0 : r.change_pct > 0;
        const sign = r.change_pct > 0 ? '+' : '';
        return `<div class="mover ${good ? 'good' : 'bad'}"><b>${meta.indicator_name}</b>` +
          `<span class="mv-val">${r.value_str || r.value}</span>` +
          `<span class="mv-chg">${sign}${r.change_pct}%</span></div>`;
      }).join('');
      html = fillId(html, 'top-movers', `<span class="movers-lbl">Top Movers</span>${chips}`);
    }

    // ── Fill __MACRO_DATA__ JSON ─────────────────────────────────────
    html = fillMacroData(html, macroDataObj);

    // ── Fill ticker strip ────────────────────────────────────────────
    html = fillTickerData(html, marketData.data.prices);

    // ── Fill cost tag ─────────────────────────────────────────────────
    if (allData.costSummary) {
      html = fillId(html, 'cost-tag', allData.costSummary);
    }

    // ── Inject stale-data footnote ─────────────────────────────────────
    if (staleIndicators.length > 0) {
      const items = staleIndicators.map(s =>
        `<li><b>${s.name}</b> — using previous value (${s.previousValue}) because today's fetch (${s.badValue}) was ${s.zScore}σ from the 180-day mean. Last good data: ${s.vintage}.</li>`
      ).join('\n');
      const footnote = `
<div class="stale-footnote">
  <b>⚠ Data Note</b> — The following indicator(s) are showing previous values due to suspect data today:
  <ul>${items}</ul>
</div>`;
      html = html.replace('</body>', `${footnote}\n</body>`);
    }

    // ── Strip unfilled FILL markers (best-effort) ────────────────────
    html = html.replace(/<!--\s*FILL[^>]*-->/g, '');

    // ── Write output ─────────────────────────────────────────────────
    const filename = `macro-dashboard-${isoDate}.html`;
    const outputPath = join(ROOT, 'output', filename);
    const indexPath  = join(ROOT, 'output', 'index.html');
    mkdirSync(join(ROOT, 'output'), { recursive: true });
    writeFileSync(outputPath, html, 'utf-8');
    writeFileSync(indexPath,  html, 'utf-8'); // GitHub Pages stable URL

    // ── Archive index: browsable list of every published dashboard ──
    const dated = readdirSync(join(ROOT, 'output'))
      .filter(f => /^macro-dashboard-\d{4}-\d{2}-\d{2}\.html$/.test(f))
      .sort()
      .reverse();
    const byMonth = {};
    for (const f of dated) {
      const d = f.slice(16, 26); // YYYY-MM-DD
      const month = new Date(d + 'T00:00:00Z')
        .toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      (byMonth[month] ||= []).push({ file: f, date: d });
    }
    const monthBlocks = Object.entries(byMonth).map(([month, entries]) => {
      const links = entries.map(e => {
        const label = new Date(e.date + 'T00:00:00Z')
          .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
        return `<a href="${e.file}">${label}</a>`;
      }).join('');
      return `<h2>${month}</h2><div class="days">${links}</div>`;
    }).join('\n');
    const archiveHtml = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MacroIntelligence — Dashboard Archive</title>
<style>
  body{font-family:-apple-system,'Segoe UI',sans-serif;max-width:820px;margin:0 auto;padding:40px 20px;background:#f5f6fa;color:#1d1d2b;}
  h1{font-size:1.3rem;letter-spacing:0.02em;} h2{font-size:0.85rem;color:#666;margin:26px 0 10px;text-transform:uppercase;letter-spacing:0.1em;}
  .days{display:flex;flex-wrap:wrap;gap:8px;}
  .days a{padding:8px 14px;background:#fff;border:1px solid rgba(0,0,60,0.1);border-radius:8px;text-decoration:none;color:#1a00cc;font-size:0.82rem;}
  .days a:hover{background:#eef;}
  .back{font-size:0.8rem;}
</style></head><body>
<p class="back"><a href="index.html">← Today's dashboard</a></p>
<h1>📚 Dashboard Archive — ${dated.length} editions</h1>
${monthBlocks}
</body></html>`;
    writeFileSync(join(ROOT, 'output', 'archive.html'), archiveHtml, 'utf-8');

    const latency = Date.now() - start;
    console.log(`[DashboardRenderer] Done in ${latency}ms → ${outputPath}`);

    return { html, macroDataObj, outputPath, indexPath };
  }
}
