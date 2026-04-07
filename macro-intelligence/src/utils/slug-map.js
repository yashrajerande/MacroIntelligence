/**
 * Slug → { section, sub_section, indicator_name, unit } mapping.
 * Used by SupabaseWriter to populate macro_indicators correctly.
 */

export const SLUG_MAP = {
  // S2 — India Growth
  india_gdp_yoy:        { section: 'S2', sub_section: 'growth',      indicator_name: 'India GDP YoY',              unit: '%' },
  india_gdp_fy_estimate:{ section: 'S2', sub_section: 'growth',      indicator_name: 'India GDP FY Estimate',      unit: '%' },
  rbi_gdp_forecast:     { section: 'S2', sub_section: 'growth',      indicator_name: 'RBI GDP Forecast',           unit: '%' },
  pmi_mfg:              { section: 'S2', sub_section: 'growth',      indicator_name: 'PMI Manufacturing',          unit: 'index' },
  pmi_services:         { section: 'S2', sub_section: 'growth',      indicator_name: 'PMI Services',               unit: 'index' },
  pmi_composite:        { section: 'S2', sub_section: 'growth',      indicator_name: 'PMI Composite',              unit: 'index' },
  iip_yoy:              { section: 'S2', sub_section: 'growth',      indicator_name: 'IIP YoY',                    unit: '%' },
  iip_capgoods:         { section: 'S2', sub_section: 'growth',      indicator_name: 'IIP Capital Goods',          unit: '%' },
  capacity_utilisation: { section: 'S2', sub_section: 'growth',      indicator_name: 'Capacity Utilisation',       unit: '%' },
  core_sector_yoy:      { section: 'S2', sub_section: 'growth',      indicator_name: 'Core Sector YoY',            unit: '%' },

  // S3 — India Inflation
  cpi_headline:         { section: 'S3', sub_section: 'inflation',   indicator_name: 'CPI Headline',               unit: '%' },
  cpi_core:             { section: 'S3', sub_section: 'inflation',   indicator_name: 'CPI Core',                   unit: '%' },
  cfpi_food:            { section: 'S3', sub_section: 'inflation',   indicator_name: 'CFPI Food',                  unit: '%' },
  wpi:                  { section: 'S3', sub_section: 'inflation',   indicator_name: 'WPI',                        unit: '%' },
  fuel_inflation:       { section: 'S3', sub_section: 'inflation',   indicator_name: 'Fuel Inflation',             unit: '%' },
  rbi_repo_rate:        { section: 'S3', sub_section: 'inflation',   indicator_name: 'RBI Repo Rate',              unit: '%' },
  rbi_inflation_forecast:{ section: 'S3', sub_section: 'inflation',  indicator_name: 'RBI Inflation Forecast',     unit: '%' },

  // S4 — India Consumption
  gst_month:            { section: 'S4', sub_section: 'consumption', indicator_name: 'GST Collections (Month)',    unit: '₹ cr' },
  gst_ytd:              { section: 'S4', sub_section: 'consumption', indicator_name: 'GST Collections (YTD)',      unit: '₹ cr' },
  pv_sales:             { section: 'S4', sub_section: 'consumption', indicator_name: 'Passenger Vehicle Sales',   unit: '%' },
  '2w_sales':           { section: 'S4', sub_section: 'consumption', indicator_name: '2-Wheeler Sales',            unit: '%' },
  cv_sales:             { section: 'S4', sub_section: 'consumption', indicator_name: 'Commercial Vehicle Sales',   unit: '%' },
  airline_pax:          { section: 'S4', sub_section: 'consumption', indicator_name: 'Airline Passengers',         unit: 'mn' },
  ecom_gmv_growth:      { section: 'S4', sub_section: 'consumption', indicator_name: 'E-commerce GMV Growth',      unit: '%' },

  // S5 — India Credit
  bank_credit_growth:   { section: 'S5', sub_section: 'credit',     indicator_name: 'Bank Credit Growth',         unit: '%' },
  deposit_growth:       { section: 'S5', sub_section: 'credit',     indicator_name: 'Deposit Growth',             unit: '%' },
  cd_ratio:             { section: 'S5', sub_section: 'credit',     indicator_name: 'CD Ratio',                   unit: '%' },
  nbfc_credit_growth:   { section: 'S5', sub_section: 'credit',     indicator_name: 'NBFC Credit Growth',         unit: '%' },
  corp_bond_issuance:   { section: 'S5', sub_section: 'credit',     indicator_name: 'Corp Bond Issuance',         unit: '₹ cr' },

  // S6 — Flows
  fii_equity_net:       { section: 'S6', sub_section: 'flows',      indicator_name: 'FII Equity Net',             unit: '₹ cr' },
  dii_equity_net:       { section: 'S6', sub_section: 'flows',      indicator_name: 'DII Equity Net',             unit: '₹ cr' },
  sip_inflows:          { section: 'S6', sub_section: 'flows',      indicator_name: 'SIP Inflows',                unit: '₹ cr' },
  sip_yoy_growth:       { section: 'S6', sub_section: 'flows',      indicator_name: 'SIP YoY Growth',             unit: '%' },
  mf_aum:               { section: 'S6', sub_section: 'flows',      indicator_name: 'MF AUM',                     unit: '₹ lakh cr' },
  mf_avg_aum:           { section: 'S6', sub_section: 'flows',      indicator_name: 'MF Average AUM',             unit: '₹ lakh cr' },
  equity_mf_net:        { section: 'S6', sub_section: 'flows',      indicator_name: 'Equity MF Net',              unit: '₹ cr' },
  nfo_collections:      { section: 'S6', sub_section: 'flows',      indicator_name: 'NFO Collections',            unit: '₹ cr' },
  sip_accounts:         { section: 'S6', sub_section: 'flows',      indicator_name: 'SIP Accounts',               unit: 'mn' },
  sip_aum:              { section: 'S6', sub_section: 'flows',      indicator_name: 'SIP AUM',                    unit: '₹ lakh cr' },

  // S7 — India Markets
  nifty50:              { section: 'S7', sub_section: 'markets',    indicator_name: 'Nifty 50',                   unit: 'index' },
  sensex:               { section: 'S7', sub_section: 'markets',    indicator_name: 'Sensex',                     unit: 'index' },
  bank_nifty:           { section: 'S7', sub_section: 'markets',    indicator_name: 'Bank Nifty',                 unit: 'index' },
  india_vix:            { section: 'S7', sub_section: 'markets',    indicator_name: 'India VIX',                  unit: 'index' },
  gsec_10y:             { section: 'S7', sub_section: 'markets',    indicator_name: 'G-Sec 10Y',                  unit: '%' },
  inr_usd:              { section: 'S7', sub_section: 'markets',    indicator_name: 'INR/USD',                    unit: '₹' },
  gold_inr_gram:        { section: 'S7', sub_section: 'markets',    indicator_name: 'Gold (₹/gram)',              unit: '₹/g' },
  brent_usd:            { section: 'S7', sub_section: 'markets',    indicator_name: 'Brent Crude',                unit: '$/bbl' },
  rbi_fx_reserves:      { section: 'S7', sub_section: 'markets',    indicator_name: 'RBI FX Reserves',            unit: '$ bn' },

  // S8 — Real Estate Residential
  re_launches_units:    { section: 'S8', sub_section: 're_residential', indicator_name: 'RE Launches (Units)',    unit: 'units' },
  re_sales_units:       { section: 'S8', sub_section: 're_residential', indicator_name: 'RE Sales (Units)',       unit: 'units' },
  re_unsold_inventory:  { section: 'S8', sub_section: 're_residential', indicator_name: 'Unsold Inventory',       unit: 'units' },
  hpi_mumbai:           { section: 'S8', sub_section: 're_residential', indicator_name: 'HPI Mumbai',             unit: 'index' },
  hpi_delhi:            { section: 'S8', sub_section: 're_residential', indicator_name: 'HPI Delhi',              unit: 'index' },
  hpi_bengaluru:        { section: 'S8', sub_section: 're_residential', indicator_name: 'HPI Bengaluru',          unit: 'index' },
  hpi_hyderabad:        { section: 'S8', sub_section: 're_residential', indicator_name: 'HPI Hyderabad',          unit: 'index' },
  affordability_index:  { section: 'S8', sub_section: 're_residential', indicator_name: 'Affordability Index',    unit: 'ratio' },
  home_loan_disbursements:{ section: 'S8', sub_section: 're_residential', indicator_name: 'Home Loan Disbursements', unit: '₹ cr' },
  avg_home_loan_rate:   { section: 'S8', sub_section: 're_residential', indicator_name: 'Avg Home Loan Rate',     unit: '%' },

  // S8 — Real Estate Commercial
  office_absorption:    { section: 'S8', sub_section: 're_commercial', indicator_name: 'Office Absorption',       unit: 'mn sq ft' },
  office_vacancy:       { section: 'S8', sub_section: 're_commercial', indicator_name: 'Office Vacancy',          unit: '%' },
  rent_bengaluru:       { section: 'S8', sub_section: 're_commercial', indicator_name: 'Grade-A Rent Bengaluru',  unit: '₹/sqft/mo' },
  rent_mumbai:          { section: 'S8', sub_section: 're_commercial', indicator_name: 'Grade-A Rent Mumbai',     unit: '₹/sqft/mo' },
  retail_mall_vacancy:  { section: 'S8', sub_section: 're_commercial', indicator_name: 'Retail Mall Vacancy',     unit: '%' },
  embassy_reit:         { section: 'S8', sub_section: 're_commercial', indicator_name: 'Embassy REIT',            unit: '₹/unit' },
  mindspace_reit:       { section: 'S8', sub_section: 're_commercial', indicator_name: 'Mindspace REIT',          unit: '₹/unit' },
  brookfield_reit:      { section: 'S8', sub_section: 're_commercial', indicator_name: 'Brookfield REIT',         unit: '₹/unit' },

  // S9 — Global Growth
  us_gdp_saar:          { section: 'S9', sub_section: 'global_growth',     indicator_name: 'US GDP SAAR',         unit: '%' },
  china_gdp:            { section: 'S9', sub_section: 'global_growth',     indicator_name: 'China GDP',           unit: '%' },
  ez_gdp:               { section: 'S9', sub_section: 'global_growth',     indicator_name: 'Eurozone GDP',        unit: '%' },
  global_pmi_composite: { section: 'S9', sub_section: 'global_growth',     indicator_name: 'Global PMI Composite',unit: 'index' },
  us_pmi_composite:     { section: 'S9', sub_section: 'global_growth',     indicator_name: 'US PMI Composite',    unit: 'index' },
  china_pmi_composite:  { section: 'S9', sub_section: 'global_growth',     indicator_name: 'China PMI Composite', unit: 'index' },

  // S9 — Global Inflation
  us_cpi:               { section: 'S9', sub_section: 'global_inflation',  indicator_name: 'US CPI',              unit: '%' },
  us_core_cpi:          { section: 'S9', sub_section: 'global_inflation',  indicator_name: 'US Core CPI',         unit: '%' },
  us_core_pce:          { section: 'S9', sub_section: 'global_inflation',  indicator_name: 'US Core PCE',         unit: '%' },
  ez_cpi:               { section: 'S9', sub_section: 'global_inflation',  indicator_name: 'Eurozone CPI',        unit: '%' },
  china_cpi:            { section: 'S9', sub_section: 'global_inflation',  indicator_name: 'China CPI',           unit: '%' },
  fao_food_index:       { section: 'S9', sub_section: 'global_inflation',  indicator_name: 'FAO Food Index',      unit: 'index' },

  // S9 — Global Liquidity
  fed_funds_rate:       { section: 'S9', sub_section: 'global_liquidity',  indicator_name: 'Fed Funds Rate',      unit: '%' },
  fed_balance_sheet:    { section: 'S9', sub_section: 'global_liquidity',  indicator_name: 'Fed Balance Sheet',   unit: '$ bn' },
  ecb_deposit_rate:     { section: 'S9', sub_section: 'global_liquidity',  indicator_name: 'ECB Deposit Rate',    unit: '%' },
  boj_rate:             { section: 'S9', sub_section: 'global_liquidity',  indicator_name: 'BOJ Rate',            unit: '%' },
  us_10y_treasury:      { section: 'S9', sub_section: 'global_liquidity',  indicator_name: 'US 10Y Treasury',     unit: '%' },
  dxy:                  { section: 'S9', sub_section: 'global_liquidity',  indicator_name: 'DXY Dollar Index',    unit: 'index' },

  // S9 — Global Markets
  sp500:                { section: 'S9', sub_section: 'global_markets',    indicator_name: 'S&P 500',             unit: 'index' },
  nasdaq:               { section: 'S9', sub_section: 'global_markets',    indicator_name: 'Nasdaq',              unit: 'index' },
  euro_stoxx50:         { section: 'S9', sub_section: 'global_markets',    indicator_name: 'Euro Stoxx 50',       unit: 'index' },
  hang_seng:            { section: 'S9', sub_section: 'global_markets',    indicator_name: 'Hang Seng',           unit: 'index' },
  nikkei225:            { section: 'S9', sub_section: 'global_markets',    indicator_name: 'Nikkei 225',          unit: 'index' },
  us_vix:               { section: 'S9', sub_section: 'global_markets',    indicator_name: 'US VIX',              unit: 'index' },
  brent_usd_global:     { section: 'S9', sub_section: 'global_markets',    indicator_name: 'Brent Crude (Global)',unit: '$/bbl' },
  wti_usd:              { section: 'S9', sub_section: 'global_markets',    indicator_name: 'WTI Crude',           unit: '$/bbl' },
  nat_gas:              { section: 'S9', sub_section: 'global_markets',    indicator_name: 'Natural Gas',         unit: '$/MMBtu' },
  gold_usd:             { section: 'S9', sub_section: 'global_markets',    indicator_name: 'Gold (USD)',          unit: '$/oz' },
  copper:               { section: 'S9', sub_section: 'global_markets',    indicator_name: 'Copper',              unit: '$/lb' },
  iron_ore:             { section: 'S9', sub_section: 'global_markets',    indicator_name: 'Iron Ore',            unit: '$/t' },
  bdi:                  { section: 'S9', sub_section: 'global_markets',    indicator_name: 'Baltic Dry Index',    unit: 'index' },
};
