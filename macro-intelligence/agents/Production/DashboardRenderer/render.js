/**
 * DashboardRenderer — Pure code. No LLM.
 * Assembles all data contracts into the master HTML template.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { row, fillId, fillTbody, fillMacroData, fillTickerData, assertNoFillMarkers } from './skills/template-filler.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');

export class DashboardRenderer {
  render(allData) {
    const start = Date.now();

    // Load template
    let html = readFileSync(join(ROOT, 'template', 'macro-intelligence-light.html'), 'utf-8');

    const { marketData, macroData, reData, regime, signals, scenarios, news, execSummary, dateStr, isoDate } = allData;

    // ── Build the __MACRO_DATA__ object ──────────────────────────────
    const allIndicators = {
      ...marketData.data.prices,
      ...macroData.data.indicators,
      ...reData.data.indicators,
    };

    const indicatorsArray = Object.entries(allIndicators).map(([slug, ind]) => ({
      indicator_slug: slug,
      label: slug.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      value: ind.value,
      value_str: ind.value_str || String(ind.value ?? 'Awaited'),
      previous: ind.previous,
      change_pct: ind.change_pct || 0,
      direction: ind.direction || 'flat',
      momentum_label: ind.momentum_label || '',
      pct_10y: ind.pct_10y ?? 50,
      pct_10y_tier: ind.pct_10y_tier || 'mid',
      pct_note: ind.pct_note || '',
      source: ind.source || '',
      vintage: ind.vintage || '',
      is_estimated: ind.is_estimated || false,
      confidence: ind.confidence || 'medium',
    }));

    // Build the snap verdicts
    const growthRegime = regime.data.find(r => r.dimension === 'growth') || {};
    const inflationRegime = regime.data.find(r => r.dimension === 'inflation') || {};
    const snapVerdict = `${growthRegime.badge_label || 'Steady'} Growth | ${inflationRegime.badge_label || 'Moderate'} Inflation`;

    const nifty = allIndicators.nifty50 || {};
    const brent = allIndicators.brent_usd || {};
    const snapIndia = `Nifty ${nifty.value_str || nifty.value || '—'} | INR ${allIndicators.inr_usd?.value || '—'}`;
    const snapGlobal = `Brent $${brent.value || '—'} | DXY ${allIndicators.dxy?.value || '—'}`;
    const snapRisk = signals.data.find(s => s.status === 'risk')?.title || 'Monitoring';

    const macroDataObj = {
      run_date: isoDate,
      generated_at: new Date().toISOString(),
      snap_verdict: snapVerdict,
      snap_india: snapIndia,
      snap_global: snapGlobal,
      snap_risk: snapRisk,
      s1_badge: `${growthRegime.badge_label || 'Steady'} — ${inflationRegime.badge_label || 'Moderate'}`,
      indicators: indicatorsArray,
      regime: regime.data,
      signals: signals.data,
      news: news.data,
      executive_summary: execSummary.data,
      scenario_base_prob: 0,
      scenario_bull_prob: 0,
      scenario_bear_prob: 0,
      scenario_base: scenarios.data.base,
      scenario_bull: scenarios.data.bull,
      scenario_bear: scenarios.data.bear,
      real_estate: {
        residential: Object.entries(reData.data.indicators)
          .filter(([slug]) => slug.startsWith('re_') || slug.startsWith('hpi_') || ['affordability_index', 'home_loan_disbursements', 'avg_home_loan_rate'].includes(slug))
          .reduce((acc, [slug, v]) => { acc[slug] = v; return acc; }, {}),
        commercial: Object.entries(reData.data.indicators)
          .filter(([slug]) => ['office_absorption', 'office_vacancy', 'rent_bengaluru', 'rent_mumbai', 'retail_mall_vacancy', 'embassy_reit', 'mindspace_reit', 'brookfield_reit'].includes(slug))
          .reduce((acc, [slug, v]) => { acc[slug] = v; return acc; }, {}),
      },
    };

    // ── Fill template slots ──────────────────────────────────────────

    // Snap bar
    html = fillId(html, 'snap-verdict', snapVerdict);
    html = fillId(html, 'snap-india', snapIndia);
    html = fillId(html, 'snap-global', snapGlobal);
    html = fillId(html, 'snap-risk', snapRisk);

    // S1 badge
    html = fillId(html, 's1-badge', macroDataObj.s1_badge);

    // Regime cards
    for (const r of regime.data) {
      const dim = r.dimension;
      html = fillId(html, `rc-${dim}-m`, r.metric_summary);
      html = fillId(html, `rc-${dim}-s`, r.signal_text);
      html = fillId(html, `rc-${dim}-b`, r.badge_label);
    }

    // Signal cards
    for (const s of signals.data) {
      const n = s.signal_num;
      html = fillId(html, `sig${n}-title`, s.title);
      html = fillId(html, `sig${n}-data`, s.data_text);
      html = fillId(html, `sig${n}-impl`, s.implication);
      html = fillId(html, `sig${n}-pct`, `${s.pct_10y}%`);
    }

    // Executive summary
    for (const p of execSummary.data) {
      html = fillId(html, `exec-0${p.para_num}`, p.para_html);
    }

    // News cards
    for (const n of news.data) {
      html = fillId(html, `news-${n.category}-hl`, n.headline);
      html = fillId(html, `news-${n.category}-src`, n.source_name);
      // Fill URL via href attribute replacement
      html = html.replace(
        new RegExp(`(id="news-${n.category}-url"[^>]*href=")[^"]*"`, 'i'),
        `$1${n.url}"`
      );
    }

    // Scenarios
    html = fillId(html, 'sc-base-name', scenarios.data.base.name);
    html = fillId(html, 'sc-base-desc', scenarios.data.base.description);
    html = fillId(html, 'sc-base-prob', scenarios.data.base.prob_label);
    html = fillId(html, 'sc-bull-name', scenarios.data.bull.name);
    html = fillId(html, 'sc-bull-desc', scenarios.data.bull.description);
    html = fillId(html, 'sc-bull-prob', scenarios.data.bull.prob_label);
    html = fillId(html, 'sc-bear-name', scenarios.data.bear.name);
    html = fillId(html, 'sc-bear-desc', scenarios.data.bear.description);
    html = fillId(html, 'sc-bear-prob', scenarios.data.bear.prob_label);

    // Date stamp
    html = fillId(html, 'run-date', dateStr);

    // Fill __MACRO_DATA__
    html = fillMacroData(html, macroDataObj);

    // Fill ticker
    html = fillTickerData(html, marketData.data.prices);

    // Build data table rows for each section
    const sectionSlugs = {
      'tbody-growth': ['india_gdp_yoy', 'india_gdp_fy_estimate', 'rbi_gdp_forecast', 'pmi_mfg', 'pmi_services', 'pmi_composite', 'iip_yoy', 'iip_capgoods', 'capacity_utilisation', 'core_sector_yoy'],
      'tbody-inflation': ['cpi_headline', 'cpi_core', 'cfpi_food', 'wpi', 'fuel_inflation', 'rbi_repo_rate', 'rbi_inflation_forecast'],
      'tbody-consumption': ['gst_month', 'gst_ytd', 'pv_sales', '2w_sales', 'cv_sales', 'airline_pax', 'ecom_gmv_growth'],
      'tbody-credit': ['bank_credit_growth', 'deposit_growth', 'cd_ratio', 'nbfc_credit_growth', 'corp_bond_issuance'],
      'tbody-flows': ['fii_equity_net', 'dii_equity_net', 'sip_inflows', 'sip_yoy_growth', 'mf_aum', 'mf_avg_aum', 'equity_mf_net', 'nfo_collections', 'sip_accounts', 'sip_aum'],
      'tbody-markets': ['nifty50', 'sensex', 'bank_nifty', 'india_vix', 'gsec_10y', 'inr_usd', 'gold_inr_gram', 'brent_usd', 'rbi_fx_reserves'],
    };

    for (const [tbodyId, slugs] of Object.entries(sectionSlugs)) {
      const rows = slugs.map(slug => {
        const ind = allIndicators[slug] || {};
        const label = slug.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        return row(label, ind.value_str || ind.value, ind.previous, ind.direction || 'flat', ind.momentum_label || '', ind.pct_10y ?? 50, ind.pct_10y_tier || 'mid');
      }).join('\n');
      html = fillTbody(html, tbodyId, rows);
    }

    // Remove remaining FILL markers (best effort)
    html = html.replace(/<!--\s*FILL\s*-->/g, '');

    // ── Write output ─────────────────────────────────────────────────
    const filename = `macro-dashboard-${dateStr.replace(/\s/g, '')}.html`;
    const outputPath = join(ROOT, 'output', filename);
    mkdirSync(join(ROOT, 'output'), { recursive: true });
    writeFileSync(outputPath, html, 'utf-8');

    const latency = Date.now() - start;
    console.log(`[DashboardRenderer] Done in ${latency}ms. Output: ${outputPath}`);

    return { html, macroDataObj, outputPath };
  }
}
