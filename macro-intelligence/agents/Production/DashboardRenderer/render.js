/**
 * DashboardRenderer — Pure code. No LLM.
 * Assembles all data contracts into the master HTML template.
 * Template IDs are locked to macro-intelligence-light.html v1.0.0.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SLUG_MAP, INDICATOR_SCHEMA } from '../../../src/utils/indicator-schema.js';
import { isInversePolarity } from '../../../src/utils/polarity.js';
import { QUADRANT_LABELS } from '../../../src/utils/credit-impulse.js';
import { rankRiskSignals, getStreak, recordTopRisk, classifyRiskSeverity } from '../../../src/utils/risk-tracker.js';
import { classifyGlobalRegime } from '../../../src/utils/global-regime.js';
import { row, fillId, fillTbody, fillMacroData, fillTickerData, escHtml } from './skills/template-filler.js';

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
    // Dropped here for months — Validator Layer 1's low-confidence check
    // was structurally unreachable and Supabase's confidence column was
    // always null. Only meaningful when a value exists.
    confidence:       latestNum !== null ? (raw.confidence || undefined) : undefined,
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
      marketData, macroData, reData, leverageData,
      regime, signals, scenarios, news, execSummary,
      dateStr, isoDate, dynamicRanges, leverage,
    } = allData;

    // ── Merge all raw indicators ─────────────────────────────────────
    // API-sourced market prices spread LAST so they win the 7-slug
    // overlap with the LLM web-search set (us_cpi, fed_funds_rate, etc.).
    const allRaw = {
      ...macroData.data.indicators,
      ...reData.data.indicators,
      ...leverageData.data.indicators,
      ...marketData.data.prices,
    };

    // ── Sanitize: swap suspect values for previous data ─────────────
    // DAILY-frequency indicators only. A monthly/quarterly series
    // snapshotted daily has near-zero trailing stddev, so a genuine new
    // print (credit-card growth 20% → 12%) computed as z≈8 and got
    // silently reverted to the old value — suppressing exactly the large
    // decelerations the Keen/Minsky section exists to surface.
    const staleIndicators = [];
    if (dynamicRanges) {
      for (const [slug, raw] of Object.entries(allRaw)) {
        if (typeof raw.value !== 'number') continue;
        if (INDICATOR_SCHEMA[slug]?.frequency !== 'daily') continue;
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

    const nifty   = allRaw.nifty50 || {};
    const inrUsd  = allRaw.inr_usd || {};
    const brent   = allRaw.brent_usd || {};
    const dxy     = allRaw.dxy || {};

    // Use the ExecSummaryWriter's verdict_line if available, fall back to regime labels
    const snapVerdict = allData.execSummary?.verdict_line
      || `${growthRegime.badge_label || 'Steady'} Growth | ${inflRegime.badge_label || 'Moderate'} Inflation`;
    const inrVal = inrUsd.value && inrUsd.value < 1 ? (1 / inrUsd.value).toFixed(2) : inrUsd.value;
    const snapIndia   = `Nifty ${nifty.value_str || nifty.value || '—'} | INR/USD ${inrVal || '—'}`;

    // ── Global Regime: classify, don't just print two tickers ─────────
    // This box was labeled "Global Regime" but showed nothing but raw
    // Brent/DXY numbers — no classification, and the badge it borrowed
    // (`policyRegime.badge_label`) was actually India's own RBI repo-rate
    // stance, not anything about global conditions. classifyGlobalRegime
    // gives it a real read: growth (US GDP SAAR + global PMI) + risk
    // appetite (VIX), same "language, then numbers" convention as the
    // rest of the regime system.
    const globalRegimeRead = classifyGlobalRegime(allRaw);
    const snapGlobal = globalRegimeRead.narrative; // plain text for Supabase/JSON consumers
    const snapGlobalHtml =
      `<span class="ph-badge ${globalRegimeRead.badge_type}">${globalRegimeRead.badge_label}</span>` +
      `<span class="ctrio-line">${globalRegimeRead.narrative}</span>` +
      `<span class="ctrio-sub">Brent $${brent.value || '—'} | DXY ${dxy.value || '—'}</span>`;

    // ── Top Risk Now: rank by severity, not array position ────────────
    // Previously `signals.data.find(s => s.status === 'risk')` — the FIRST
    // risk-tagged signal in a FIXED thematic order (Sig1 is always CREDIT
    // CYCLE). Since India's CD ratio is a slow-moving structural indicator,
    // it tends to stay 'risk'-tagged for months, so it won this slot almost
    // every day regardless of what else was happening — a selection-bias
    // bug, not a data problem. Now ranked by extremity (distance from the
    // 50th percentile) via the pure rankRiskSignals(); when the same theme
    // wins repeatedly, that persistence is shown explicitly (streak +
    // today's number + the runner-up it beat) instead of silently
    // repeating the headline.
    const ranked = rankRiskSignals(signals.data);

    // Plain-text title — goes into macroDataObj.run.snap_risk, which
    // SupabaseWriter persists verbatim into the dashboard_runs column and
    // other consumers (Telegram, Rabbit Hole) may read as plain text.
    let snapRisk = 'Monitoring';
    // Rich HTML (severity badge + streak + evidence + runner-up) — template cell only.
    let snapRiskHtml = 'Monitoring';
    if (ranked) {
      const { top, runnerUp } = ranked;
      const severity = classifyRiskSeverity(top.pct_10y);
      // Pass today's date so a same-day re-run (which already recorded an
      // entry) doesn't count today twice and print "Day N+2".
      const streak = getStreak(top.signal_theme, isoDate);
      recordTopRisk(isoDate, top.signal_theme, top.title);

      snapRisk = top.title;

      const streakTag = streak >= 1 ? ` · Day ${streak + 1}` : '';
      const evidence = top.data_text || top.pct_note || '';
      const nextTag = runnerUp ? ` — next: ${escHtml(runnerUp.title)}` : '';

      snapRiskHtml =
        `<span class="ph-badge ${severity.badge_type}">${severity.badge_label}</span>` +
        `<span class="ctrio-line">${escHtml(top.title)}${streakTag}</span>` +
        (evidence ? `<span class="ctrio-sub">${escHtml(evidence)}${nextTag}</span>` : '');
    }

    // ── Derive real estate summary ───────────────────────────────────
    // REIT-vs-G-Sec spread intentionally null: the old computation divided
    // Embassy's UNIT PRICE by 100 and called it a distribution yield —
    // ₹369.92/unit became a "3.70% yield" purely because the price was
    // near 370. A fabricated bps figure is worse than no figure; needs a
    // real DPU/price feed to compute honestly.
    const reitVsGsecBps = null;

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
        global_regime:      globalRegimeRead.badge_label || '',
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
      leverage: leverage.data,
    };

    // ── Fill template slot-IDs ───────────────────────────────────────

    // Snap bar
    html = fillId(html, 'snap-verdict', snapVerdict);
    html = fillId(html, 'snap-india',   snapIndia);
    html = fillId(html, 'snap-global',  snapGlobalHtml);
    html = fillId(html, 'snap-risk',    snapRiskHtml);

    // Header / footer dates
    html = fillId(html, 'header-date', dateStr);
    html = fillId(html, 'footer-date', dateStr);

    // S1 badge and summary. The template hardcodes class="ph-badge b-exp"
    // on s1-badge, so a contraction regime rendered as a green expansion
    // pill — swap the color class to the growth regime's actual badge_type.
    const s1Badge   = `${growthRegime.badge_label || 'Steady'} — ${inflRegime.badge_label || 'Moderate'}`;
    const s1Summary = growthRegime.metric_summary || '';
    html = html.replace(
      /(<span class="ph-badge )[\w-]*(" id="s1-badge")/,
      `$1${growthRegime.badge_type || 'b-neu'}$2`
    );
    html = fillId(html, 's1-badge',   s1Badge);
    html = fillId(html, 's1-summary', s1Summary);

    // Regime cards (6 dimensions). RegimeClassifier computes badge_type
    // (b-exp/b-slow/b-risk/b-neu) but it was dropped on the floor — every
    // badge rendered as the same uncolored pill, so "Deposit Gap Stress"
    // looked identical to "Expansion Mode". Inject the class too.
    for (const r of regime.data) {
      const id = DIM_ID[r.dimension] || r.dimension;
      html = fillId(html, `rc-${id}-m`, r.metric_summary || '');
      html = fillId(html, `rc-${id}-s`, r.signal_text    || '');
      html = html.replace(
        new RegExp(`(<span class="ph-badge)[\\w -]*(" id="rc-${id}-b")`),
        `$1 ${r.badge_type || 'b-neu'}$2`
      );
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
      // escHtml: titles/data_text are LLM-generated — a stray "<" would
      // parse as markup. The "Data:"/"10Y %ile:" prefixes restore the
      // template's designed labels, which fillId's full-content replace
      // was wiping out (the percentile rendered as a bare cryptic "81%").
      html = fillId(html, `sig${n}-title`, escHtml(s.title || ''));
      html = fillId(html, `sig${n}-data`,  `<strong>Data:</strong> ${escHtml(s.data_text || '')}`);
      html = fillId(html, `sig${n}-impl`,  escHtml(s.implication || ''));
      html = fillId(html, `sig${n}-pct`,   `10Y %ile: <strong>${s.pct_10y ?? 0}%</strong>`);

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
      html = fillId(html, `news-${cat}-src`, escHtml(n.source_name || ''));
      // Fill headline text — third-party RSS content, always escaped
      html = fillId(html, `news-${cat}-hl`, escHtml(n.headline || ''));
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

    // ── Minsky quadrant flags (Leverage section only) ────────────────
    // Only surface a chip for the reads worth a second glance — steady/
    // still-accumulating-history states stay chip-free to avoid noise.
    const NOTABLE_QUADRANTS = new Set(['danger', 'ponzi-drift', 'expansion', 'deleveraging', 'high-level (impulse building)']);
    const leverageFlags = {};
    if (leverage?.data) {
      for (const c of leverage.data.countries) {
        for (const leg of [c.household, c.corporate]) {
          if (leg.quadrant && NOTABLE_QUADRANTS.has(leg.quadrant)) {
            leverageFlags[leg.slug] = QUADRANT_LABELS[leg.quadrant].label;
          }
        }
      }
      for (const s of leverage.data.sectors) {
        if (s.flag === 'watch') leverageFlags[s.slug] = 'Ponzi-drift watch — elevated & accelerating';
      }
    }

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
        leverageFlags[slug],
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

    // S11 Private Debt & Leverage (Steve Keen / Minsky framework)
    html = fillTbody(html, 's11-countries', makeRows([
      'india_hh_debt_gdp', 'india_corp_debt_gdp', 'us_hh_debt_gdp', 'us_corp_debt_gdp',
      'china_hh_debt_gdp', 'china_corp_debt_gdp', 'japan_hh_debt_gdp', 'japan_corp_debt_gdp',
      'ez_hh_debt_gdp', 'ez_corp_debt_gdp', 'uk_hh_debt_gdp', 'uk_corp_debt_gdp',
    ]));
    html = fillTbody(html, 's11-sectoral', makeRows([
      'india_credit_industry_yoy', 'india_credit_services_yoy', 'india_credit_personal_yoy',
      'india_credit_agri_yoy', 'india_credit_housing_yoy', 'india_credit_vehicle_yoy',
      'india_credit_creditcard_yoy', 'india_credit_nbfc_yoy',
    ]));
    html = fillId(html, 's11-leverage-summary', leverage?.data?.narrative || '');

    // ── Top movers strip: biggest polarity-aware daily MARKET moves ──
    // Restricted to daily-frequency price/index series with a sane cap.
    // Unrestricted, change_pct on a rate (China CPI 0.2→1.3 = "+550%") or
    // a net-flow crossing zero (FII "-604%") permanently occupied all five
    // slots with percent-of-a-percent artifacts.
    const MOVER_TYPES = new Set(['price', 'index']);
    const movers = Object.entries(allRaw)
      .filter(([slug, r]) =>
        INDICATOR_SCHEMA[slug]?.frequency === 'daily' &&
        MOVER_TYPES.has(INDICATOR_SCHEMA[slug]?.data_type) &&
        typeof r.value === 'number' &&
        typeof r.change_pct === 'number' &&
        !r.fetch_error &&
        Math.abs(r.change_pct) >= 0.5 &&
        Math.abs(r.change_pct) <= 25)
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
        `<li><b>${escHtml(s.name)}</b> — using previous value (${escHtml(s.previousValue)}) because today's fetch (${escHtml(s.badValue)}) was ${s.zScore}σ from the trailing mean. Last good data: ${escHtml(s.vintage)}.</li>`
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
