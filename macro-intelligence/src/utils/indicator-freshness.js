/**
 * Indicator Freshness — Maps each indicator slug to its update frequency.
 * Used by data-cache to determine which indicators need re-fetching.
 *
 * Frequencies:
 *   daily     — market prices that change every trading day
 *   monthly   — data released once a month
 *   quarterly — data released once a quarter
 */

export const INDICATOR_FRESHNESS = {
  // ── Daily (market prices) ─────────────────────────────────────────
  nifty50:            'daily',
  sensex:             'daily',
  bank_nifty:         'daily',
  india_vix:          'daily',
  inr_usd:            'daily',
  gold_usd:           'daily',
  gold_inr_gram:      'daily',
  brent_usd:          'daily',
  sp500:              'daily',
  nasdaq:             'daily',
  us_vix:             'daily',
  dxy:                'daily',
  nat_gas:            'daily',
  copper:             'daily',
  iron_ore:           'daily',
  nikkei225:          'daily',
  hang_seng:          'daily',
  euro_stoxx50:       'daily',
  brent_usd_global:   'daily',
  wti_usd:            'daily',
  bdi:                'daily',
  us_10y_treasury:    'daily',
  embassy_reit:       'daily',
  mindspace_reit:     'daily',
  brookfield_reit:    'daily',
  gsec_10y:           'daily',
  rbi_fx_reserves:    'daily',

  // ── Monthly ───────────────────────────────────────────────────────
  cpi_headline:       'monthly',
  cpi_core:           'monthly',
  cfpi_food:          'monthly',
  wpi:                'monthly',
  fuel_inflation:     'monthly',
  pmi_mfg:            'monthly',
  pmi_services:       'monthly',
  pmi_composite:      'monthly',
  iip_yoy:            'monthly',
  iip_capgoods:       'monthly',
  core_sector_yoy:    'monthly',
  gst_month:          'monthly',
  pv_sales:           'monthly',
  '2w_sales':         'monthly',
  cv_sales:           'monthly',
  airline_pax:        'monthly',
  bank_credit_growth: 'monthly',
  deposit_growth:     'monthly',
  cd_ratio:           'monthly',
  nbfc_credit_growth: 'monthly',
  fii_equity_net:     'monthly',
  dii_equity_net:     'monthly',
  sip_inflows:        'monthly',
  sip_yoy_growth:     'monthly',
  mf_aum:             'monthly',
  mf_avg_aum:         'monthly',
  equity_mf_net:      'monthly',
  nfo_collections:    'monthly',
  sip_accounts:       'monthly',
  sip_aum:            'monthly',
  us_cpi:             'monthly',
  us_core_cpi:        'monthly',
  us_core_pce:        'monthly',
  ez_cpi:             'monthly',
  china_cpi:          'monthly',
  fao_food_index:     'monthly',
  fed_funds_rate:     'monthly',
  ecb_deposit_rate:   'monthly',
  boj_rate:           'monthly',
  fed_balance_sheet:  'monthly',
  us_pmi_composite:   'monthly',
  china_pmi_composite:'monthly',
  global_pmi_composite:'monthly',

  // ── Quarterly ─────────────────────────────────────────────────────
  india_gdp_yoy:          'quarterly',
  india_gdp_fy_estimate:  'quarterly',
  rbi_gdp_forecast:       'quarterly',
  capacity_utilisation:    'quarterly',
  rbi_inflation_forecast:  'quarterly',
  rbi_repo_rate:           'quarterly',
  us_gdp_saar:             'quarterly',
  china_gdp:               'quarterly',
  ez_gdp:                  'quarterly',
  gst_ytd:                 'quarterly',
  corp_bond_issuance:      'quarterly',
  ecom_gmv_growth:         'quarterly',
  office_absorption:       'quarterly',
  office_vacancy:          'quarterly',
  rent_bengaluru:          'quarterly',
  rent_mumbai:             'quarterly',
  retail_mall_vacancy:     'quarterly',
  re_launches_units:       'quarterly',
  re_sales_units:          'quarterly',
  re_unsold_inventory:     'quarterly',
  hpi_mumbai:              'quarterly',
  hpi_delhi:               'quarterly',
  hpi_bengaluru:           'quarterly',
  hpi_hyderabad:           'quarterly',
  affordability_index:     'quarterly',
  home_loan_disbursements: 'quarterly',
  avg_home_loan_rate:      'quarterly',
};

/** Maximum age (in calendar days) before an indicator is considered stale. */
const FRESHNESS_THRESHOLDS = {
  daily:     1,
  monthly:   32,
  quarterly: 95,
};

/**
 * Return the update frequency for a slug.
 * @param {string} slug
 * @returns {'daily'|'monthly'|'quarterly'|undefined}
 */
export function getFrequency(slug) {
  return INDICATOR_FRESHNESS[slug];
}

/**
 * Returns true if the indicator needs re-fetching.
 * @param {string}      slug          — indicator slug
 * @param {string|null} lastFetchDate — ISO date string of last fetch (or null/undefined)
 * @param {string}      currentDate   — ISO date string of "today"
 * @returns {boolean}
 */
export function isStale(slug, lastFetchDate, currentDate) {
  if (!lastFetchDate) return true;

  const freq = getFrequency(slug);
  if (!freq) return true;                     // unknown slug → always re-fetch

  const threshold = FRESHNESS_THRESHOLDS[freq];
  const last = new Date(lastFetchDate + 'T00:00:00Z');
  const now  = new Date(currentDate   + 'T00:00:00Z');
  const daysDiff = Math.floor((now - last) / (1000 * 60 * 60 * 24));

  return daysDiff >= threshold;
}
