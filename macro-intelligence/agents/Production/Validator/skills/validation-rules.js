/**
 * Validation Rules Skill — 22 deterministic checks as pure functions.
 * Returns { valid, errors, warnings }.
 */

const VALID_SLUGS = [
  'india_gdp_yoy','india_gdp_fy_estimate','rbi_gdp_forecast',
  'pmi_mfg','pmi_services','pmi_composite','iip_yoy','iip_capgoods',
  'capacity_utilisation','core_sector_yoy',
  'cpi_headline','cpi_core','cfpi_food','wpi','fuel_inflation',
  'rbi_repo_rate','rbi_inflation_forecast',
  'gst_month','gst_ytd','pv_sales','2w_sales','cv_sales',
  'airline_pax','ecom_gmv_growth',
  'bank_credit_growth','deposit_growth','cd_ratio',
  'nbfc_credit_growth','corp_bond_issuance',
  'fii_equity_net','dii_equity_net','sip_inflows','sip_yoy_growth',
  'mf_aum','mf_avg_aum','equity_mf_net','nfo_collections',
  'sip_accounts','sip_aum',
  'nifty50','sensex','bank_nifty','india_vix','gsec_10y','inr_usd',
  'gold_inr_gram','brent_usd','rbi_fx_reserves',
  're_launches_units','re_sales_units','re_unsold_inventory',
  'hpi_mumbai','hpi_delhi','hpi_bengaluru','hpi_hyderabad',
  'affordability_index','home_loan_disbursements','avg_home_loan_rate',
  'office_absorption','office_vacancy','rent_bengaluru','rent_mumbai',
  'retail_mall_vacancy','embassy_reit','mindspace_reit','brookfield_reit',
  'us_gdp_saar','china_gdp','ez_gdp','global_pmi_composite',
  'us_pmi_composite','china_pmi_composite',
  'us_cpi','us_core_cpi','us_core_pce','ez_cpi','china_cpi',
  'fao_food_index',
  'fed_funds_rate','fed_balance_sheet','ecb_deposit_rate','boj_rate',
  'us_10y_treasury','dxy',
  'sp500','nasdaq','euro_stoxx50','hang_seng','nikkei225',
  'us_vix','brent_usd_global','wti_usd','nat_gas','gold_usd',
  'copper','iron_ore','bdi',
];

const VALID_DIRECTIONS = new Set(['up', 'down', 'flat']);
const VALID_TIERS = new Set(['hi', 'mid', 'lo']);
const VALID_DIMENSIONS = new Set(['growth', 'inflation', 'credit', 'policy', 'capex', 'consumption']);
const VALID_BADGE_TYPES = new Set(['b-exp', 'b-slow', 'b-risk', 'b-neu']);
const VALID_SIGNAL_STATUSES = new Set(['positive', 'risk', 'watch', 'surprise']);
const VALID_NEWS_CATEGORIES = new Set(['geo', 'ai', 'india', 'fintech', 'ifs']);

export function runAllChecks(html, macroData, expectedDate) {
  const errors = [];
  const warnings = [];

  // 1. HTML completeness
  if (!html.includes('<!DOCTYPE html>') && !html.includes('<!doctype html>')) {
    errors.push('Rule 1: Missing <!DOCTYPE html>');
  }
  if (!html.includes('</html>')) {
    errors.push('Rule 1: Missing </html>');
  }

  // 2. No FILL markers
  const fillCount = (html.match(/<!--\s*FILL\s*-->/g) || []).length;
  if (fillCount > 0) {
    errors.push(`Rule 2: ${fillCount} <!-- FILL --> placeholders remain`);
  }

  // 3. __MACRO_DATA__ parseable
  if (!macroData || typeof macroData !== 'object') {
    errors.push('Rule 3: __MACRO_DATA__ is not a valid object');
    return { valid: false, errors, warnings };
  }

  // 4. run_date matches
  if (macroData.run_date !== expectedDate) {
    errors.push(`Rule 4: run_date "${macroData.run_date}" does not match expected "${expectedDate}"`);
  }

  // 5-6. Indicators count and slugs
  const indicators = macroData.indicators || [];
  const indicatorSlugs = indicators.map(i => i.indicator_slug || i.slug);
  if (indicators.length < 90) {
    errors.push(`Rule 5: indicators[] has ${indicators.length} entries (minimum 90)`);
  } else if (indicators.length < 97) {
    warnings.push(`W2: indicators[] has ${indicators.length} entries (expected 97)`);
  }

  const missingSlgs = VALID_SLUGS.filter(s => !indicatorSlugs.includes(s));
  if (missingSlgs.length > 0 && missingSlgs.length <= 7) {
    warnings.push(`W2: Missing slugs: ${missingSlgs.join(', ')}`);
  } else if (missingSlgs.length > 7) {
    errors.push(`Rule 6: ${missingSlgs.length} slugs missing from indicators[]`);
  }

  // 7-9. Indicator field validation
  for (const ind of indicators) {
    const slug = ind.indicator_slug || ind.slug || 'unknown';
    if (!VALID_DIRECTIONS.has(ind.direction)) {
      errors.push(`Rule 7: indicator "${slug}" has invalid direction "${ind.direction}"`);
    }
    if (!VALID_TIERS.has(ind.pct_10y_tier)) {
      errors.push(`Rule 8: indicator "${slug}" has invalid pct_10y_tier "${ind.pct_10y_tier}"`);
    }
    if (typeof ind.pct_10y !== 'number' || ind.pct_10y < 0 || ind.pct_10y > 100) {
      errors.push(`Rule 9: indicator "${slug}" has invalid pct_10y "${ind.pct_10y}"`);
    }
    if (ind.confidence === 'low') {
      warnings.push(`W1: indicator "${slug}" has low confidence`);
    }
  }

  // 10-12. Regime
  const regime = macroData.regime || [];
  if (regime.length !== 6) {
    errors.push(`Rule 10: regime[] has ${regime.length} entries (expected 6)`);
  }
  for (const r of regime) {
    if (!VALID_DIMENSIONS.has(r.dimension)) {
      errors.push(`Rule 11: regime dimension "${r.dimension}" is invalid`);
    }
    if (!VALID_BADGE_TYPES.has(r.badge_type)) {
      errors.push(`Rule 12: regime badge_type "${r.badge_type}" is invalid`);
    }
  }

  // 13-15. Signals
  const signals = macroData.signals || [];
  if (signals.length !== 7) {
    errors.push(`Rule 13: signals[] has ${signals.length} entries (expected 7)`);
  }
  if (signals.length >= 7 && !signals[6].is_surprise) {
    errors.push('Rule 14: signals[6].is_surprise must be true (Sig7 = Surprise)');
  }
  for (const s of signals) {
    if (!VALID_SIGNAL_STATUSES.has(s.status)) {
      errors.push(`Rule 15: signal ${s.signal_num} has invalid status "${s.status}"`);
    }
  }

  // 16-17. News
  const news = macroData.news || [];
  if (news.length !== 5) {
    errors.push(`Rule 16: news[] has ${news.length} entries (expected 5)`);
  }
  for (const n of news) {
    if (!VALID_NEWS_CATEGORIES.has(n.category)) {
      errors.push(`Rule 17: news category "${n.category}" is invalid`);
    }
  }

  // 18. Exec summary
  const execSummary = macroData.executive_summary || [];
  if (execSummary.length !== 5) {
    errors.push(`Rule 18: executive_summary[] has ${execSummary.length} entries (expected 5)`);
  }

  // 19. Scenario probs
  if (macroData.scenario_base_prob !== 0 || macroData.scenario_bull_prob !== 0 || macroData.scenario_bear_prob !== 0) {
    errors.push('Rule 19: scenario_*_prob must all be 0');
  }

  // 20. HTML size
  const htmlBytes = Buffer.byteLength(html, 'utf8');
  if (htmlBytes < 100000) {
    errors.push(`Rule 20: HTML file is ${htmlBytes} bytes (minimum 100,000 — likely truncated)`);
  }

  // 21. snap-verdict
  const verdictMatch = html.match(/id="snap-verdict"[^>]*>([^<]*)</);
  if (verdictMatch) {
    const verdict = verdictMatch[1].trim();
    if (!verdict || verdict.includes('FILL') || verdict === '—') {
      errors.push('Rule 21: snap-verdict is empty or placeholder');
    }
  }

  // 22. News URLs
  for (const n of news) {
    if (!n.url || n.url === '#') {
      errors.push(`Rule 22: news "${n.category}" has placeholder URL "#"`);
    }
  }

  // W3. Fetch errors
  if (macroData._market_fetch_errors && macroData._market_fetch_errors.length > 0) {
    warnings.push(`W3: ${macroData._market_fetch_errors.length} market data fetch errors`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

export { VALID_SLUGS };
