/**
 * CANONICAL INDICATOR SCHEMA — Single Source of Truth
 *
 * Every indicator in the MacroIntelligence pipeline is defined here with:
 *   - slug: unique identifier
 *   - name: display name
 *   - section/sub_section: dashboard location
 *   - unit: canonical unit string
 *   - unit_desc: human-readable unit description
 *   - data_type: 'percentage' | 'index' | 'currency' | 'count' | 'ratio' | 'price'
 *   - expected_range: [min, max] — hard bounds for the canonical unit
 *   - p50: median value (anchor for normalization)
 *   - inverse: true if higher = worse (for coloring)
 *   - frequency: 'daily' | 'monthly' | 'quarterly'
 *
 * ALL other files (slug-map, signal-scoring, unit-normalizer, validator)
 * must import from this file. No duplicate definitions.
 */

const INDICATOR_SCHEMA = {
  // ═══════════════════════════════════════════════════════════════════
  // S2 — INDIA GROWTH
  // ═══════════════════════════════════════════════════════════════════
  india_gdp_yoy:         { name: 'India GDP YoY',            section: 'S2', sub_section: 'growth',      unit: '%',          unit_desc: 'percent YoY',            data_type: 'percentage', expected_range: [-10, 15],       p50: 6.5,   inverse: false, frequency: 'quarterly' },
  india_gdp_fy_estimate: { name: 'India GDP FY Estimate',    section: 'S2', sub_section: 'growth',      unit: '%',          unit_desc: 'percent YoY',            data_type: 'percentage', expected_range: [-10, 12],       p50: 6.7,   inverse: false, frequency: 'quarterly' },
  rbi_gdp_forecast:      { name: 'RBI GDP Forecast',         section: 'S2', sub_section: 'growth',      unit: '%',          unit_desc: 'percent YoY',            data_type: 'percentage', expected_range: [-10, 12],       p50: 6.5,   inverse: false, frequency: 'quarterly' },
  pmi_mfg:               { name: 'PMI Manufacturing',        section: 'S2', sub_section: 'growth',      unit: 'index',      unit_desc: 'diffusion index 0-100',  data_type: 'index',      expected_range: [25, 65],        p50: 54.0,  inverse: false, frequency: 'monthly' },
  pmi_services:          { name: 'PMI Services',             section: 'S2', sub_section: 'growth',      unit: 'index',      unit_desc: 'diffusion index 0-100',  data_type: 'index',      expected_range: [5, 65],         p50: 54.5,  inverse: false, frequency: 'monthly' },
  pmi_composite:         { name: 'PMI Composite',            section: 'S2', sub_section: 'growth',      unit: 'index',      unit_desc: 'diffusion index 0-100',  data_type: 'index',      expected_range: [5, 65],         p50: 54.0,  inverse: false, frequency: 'monthly' },
  iip_yoy:               { name: 'IIP YoY',                  section: 'S2', sub_section: 'growth',      unit: '%',          unit_desc: 'percent YoY',            data_type: 'percentage', expected_range: [-60, 140],      p50: 4.5,   inverse: false, frequency: 'monthly' },
  iip_capgoods:          { name: 'IIP Capital Goods',        section: 'S2', sub_section: 'growth',      unit: '%',          unit_desc: 'percent YoY',            data_type: 'percentage', expected_range: [-80, 200],      p50: 5.0,   inverse: false, frequency: 'monthly' },
  capacity_utilisation:  { name: 'Capacity Utilisation',     section: 'S2', sub_section: 'growth',      unit: '%',          unit_desc: 'percent of capacity',    data_type: 'percentage', expected_range: [55, 85],        p50: 73.0,  inverse: false, frequency: 'quarterly' },
  core_sector_yoy:       { name: 'Core Sector YoY',          section: 'S2', sub_section: 'growth',      unit: '%',          unit_desc: 'percent YoY',            data_type: 'percentage', expected_range: [-40, 70],       p50: 5.0,   inverse: false, frequency: 'monthly' },

  // ═══════════════════════════════════════════════════════════════════
  // S3 — INDIA INFLATION
  // ═══════════════════════════════════════════════════════════════════
  cpi_headline:          { name: 'CPI Headline',             section: 'S3', sub_section: 'inflation',   unit: '%',          unit_desc: 'percent YoY',            data_type: 'percentage', expected_range: [0, 12],         p50: 5.2,   inverse: true,  frequency: 'monthly' },
  cpi_core:              { name: 'CPI Core',                 section: 'S3', sub_section: 'inflation',   unit: '%',          unit_desc: 'percent YoY',            data_type: 'percentage', expected_range: [2, 9],          p50: 5.0,   inverse: true,  frequency: 'monthly' },
  cfpi_food:             { name: 'CFPI Food',                section: 'S3', sub_section: 'inflation',   unit: '%',          unit_desc: 'percent YoY',            data_type: 'percentage', expected_range: [-5, 18],        p50: 6.0,   inverse: true,  frequency: 'monthly' },
  wpi:                   { name: 'WPI',                      section: 'S3', sub_section: 'inflation',   unit: '%',          unit_desc: 'percent YoY',            data_type: 'percentage', expected_range: [-8, 20],        p50: 3.0,   inverse: true,  frequency: 'monthly' },
  fuel_inflation:        { name: 'Fuel Inflation',           section: 'S3', sub_section: 'inflation',   unit: '%',          unit_desc: 'percent YoY',            data_type: 'percentage', expected_range: [-20, 25],       p50: 5.0,   inverse: true,  frequency: 'monthly' },
  rbi_repo_rate:         { name: 'RBI Repo Rate',            section: 'S3', sub_section: 'inflation',   unit: '%',          unit_desc: 'percent per annum',      data_type: 'percentage', expected_range: [3, 9],          p50: 6.0,   inverse: true,  frequency: 'quarterly' },
  rbi_inflation_forecast:{ name: 'RBI Inflation Forecast',   section: 'S3', sub_section: 'inflation',   unit: '%',          unit_desc: 'percent YoY',            data_type: 'percentage', expected_range: [1, 9],          p50: 4.8,   inverse: true,  frequency: 'quarterly' },

  // ═══════════════════════════════════════════════════════════════════
  // S4 — INDIA CONSUMPTION
  // ═══════════════════════════════════════════════════════════════════
  gst_month:             { name: 'GST Collections (Month)',  section: 'S4', sub_section: 'consumption', unit: '₹ cr',       unit_desc: 'INR crore',              data_type: 'currency',   expected_range: [80000, 250000], p50: 145000, inverse: false, frequency: 'monthly' },
  gst_ytd:               { name: 'GST Collections (YTD)',    section: 'S4', sub_section: 'consumption', unit: '₹ cr',       unit_desc: 'INR crore',              data_type: 'currency',   expected_range: [800000, 2500000], p50: 1600000, inverse: false, frequency: 'quarterly' },
  pv_sales:              { name: 'Passenger Vehicle Sales',  section: 'S4', sub_section: 'consumption', unit: '%',          unit_desc: 'percent YoY',            data_type: 'percentage', expected_range: [-75, 130],      p50: 8.0,   inverse: false, frequency: 'monthly' },
  '2w_sales':            { name: '2-Wheeler Sales',          section: 'S4', sub_section: 'consumption', unit: '%',          unit_desc: 'percent YoY',            data_type: 'percentage', expected_range: [-75, 110],      p50: 8.0,   inverse: false, frequency: 'monthly' },
  cv_sales:              { name: 'Commercial Vehicle Sales', section: 'S4', sub_section: 'consumption', unit: '%',          unit_desc: 'percent YoY',            data_type: 'percentage', expected_range: [-85, 160],      p50: 8.0,   inverse: false, frequency: 'monthly' },
  airline_pax:           { name: 'Airline Passengers',       section: 'S4', sub_section: 'consumption', unit: 'mn',         unit_desc: 'millions per month',     data_type: 'count',      expected_range: [25, 180],       p50: 120,   inverse: false, frequency: 'monthly' },
  ecom_gmv_growth:       { name: 'E-commerce GMV Growth',    section: 'S4', sub_section: 'consumption', unit: '%',          unit_desc: 'percent YoY',            data_type: 'percentage', expected_range: [5, 55],         p50: 28.0,  inverse: false, frequency: 'quarterly' },

  // ═══════════════════════════════════════════════════════════════════
  // S5 — INDIA CREDIT
  // ═══════════════════════════════════════════════════════════════════
  bank_credit_growth:    { name: 'Bank Credit Growth',       section: 'S5', sub_section: 'credit',      unit: '%',          unit_desc: 'percent YoY',            data_type: 'percentage', expected_range: [3, 25],         p50: 11.0,  inverse: false, frequency: 'monthly' },
  deposit_growth:        { name: 'Deposit Growth',           section: 'S5', sub_section: 'credit',      unit: '%',          unit_desc: 'percent YoY',            data_type: 'percentage', expected_range: [5, 20],         p50: 11.5,  inverse: false, frequency: 'monthly' },
  cd_ratio:              { name: 'CD Ratio',                 section: 'S5', sub_section: 'credit',      unit: '%',          unit_desc: 'credit-deposit ratio %', data_type: 'percentage', expected_range: [62, 88],        p50: 76.0,  inverse: true,  frequency: 'monthly' },
  nbfc_credit_growth:    { name: 'NBFC Credit Growth',       section: 'S5', sub_section: 'credit',      unit: '%',          unit_desc: 'percent YoY',            data_type: 'percentage', expected_range: [-8, 30],        p50: 14.0,  inverse: false, frequency: 'monthly' },
  corp_bond_issuance:    { name: 'Corp Bond Issuance',       section: 'S5', sub_section: 'credit',      unit: '₹ cr',       unit_desc: 'INR crore',              data_type: 'currency',   expected_range: [15000, 1500000], p50: 65000, inverse: false, frequency: 'quarterly' },

  // ═══════════════════════════════════════════════════════════════════
  // S6 — FLOWS
  // ═══════════════════════════════════════════════════════════════════
  fii_equity_net:        { name: 'FII Equity Net',           section: 'S6', sub_section: 'flows',       unit: '₹ cr',       unit_desc: 'INR crore net',          data_type: 'currency',   expected_range: [-70000, 50000],  p50: 2000,  inverse: false, frequency: 'monthly' },
  dii_equity_net:        { name: 'DII Equity Net',           section: 'S6', sub_section: 'flows',       unit: '₹ cr',       unit_desc: 'INR crore net',          data_type: 'currency',   expected_range: [-15000, 55000],  p50: 15000, inverse: false, frequency: 'monthly' },
  sip_inflows:           { name: 'SIP Inflows',              section: 'S6', sub_section: 'flows',       unit: '₹ cr',       unit_desc: 'INR crore',              data_type: 'currency',   expected_range: [800, 35000],     p50: 12000, inverse: false, frequency: 'monthly' },
  sip_yoy_growth:        { name: 'SIP YoY Growth',           section: 'S6', sub_section: 'flows',       unit: '%',          unit_desc: 'percent YoY',            data_type: 'percentage', expected_range: [-8, 55],         p50: 22.0,  inverse: false, frequency: 'monthly' },
  mf_aum:                { name: 'MF AUM',                   section: 'S6', sub_section: 'flows',       unit: '₹ lakh cr',  unit_desc: 'INR lakh crore',         data_type: 'currency',   expected_range: [8, 100],         p50: 40,    inverse: false, frequency: 'monthly' },
  mf_avg_aum:            { name: 'MF Average AUM',           section: 'S6', sub_section: 'flows',       unit: '₹ lakh cr',  unit_desc: 'INR lakh crore',         data_type: 'currency',   expected_range: [6, 100],         p50: 40,    inverse: false, frequency: 'monthly' },
  equity_mf_net:         { name: 'Equity MF Net',            section: 'S6', sub_section: 'flows',       unit: '₹ cr',       unit_desc: 'INR crore net',          data_type: 'currency',   expected_range: [-8000, 50000],   p50: 12000, inverse: false, frequency: 'monthly' },
  nfo_collections:       { name: 'NFO Collections',          section: 'S6', sub_section: 'flows',       unit: '₹ cr',       unit_desc: 'INR crore',              data_type: 'currency',   expected_range: [300, 30000],     p50: 6000,  inverse: false, frequency: 'monthly' },
  sip_accounts:          { name: 'SIP Accounts',             section: 'S6', sub_section: 'flows',       unit: 'mn',         unit_desc: 'millions',               data_type: 'count',      expected_range: [8, 120],         p50: 45,    inverse: false, frequency: 'monthly' },
  sip_aum:               { name: 'SIP AUM',                  section: 'S6', sub_section: 'flows',       unit: '₹ lakh cr',  unit_desc: 'INR lakh crore',         data_type: 'currency',   expected_range: [1, 20],          p50: 7,     inverse: false, frequency: 'monthly' },

  // ═══════════════════════════════════════════════════════════════════
  // S7 — INDIA MARKETS
  // ═══════════════════════════════════════════════════════════════════
  nifty50:               { name: 'Nifty 50',                 section: 'S7', sub_section: 'markets',     unit: 'index',      unit_desc: 'NSE index points',       data_type: 'index',      expected_range: [4000, 30000],    p50: 14000, inverse: false, frequency: 'daily' },
  sensex:                { name: 'Sensex',                   section: 'S7', sub_section: 'markets',     unit: 'index',      unit_desc: 'BSE index points',       data_type: 'index',      expected_range: [15000, 100000],  p50: 48000, inverse: false, frequency: 'daily' },
  bank_nifty:            { name: 'Bank Nifty',               section: 'S7', sub_section: 'markets',     unit: 'index',      unit_desc: 'NSE Bank index points',  data_type: 'index',      expected_range: [8000, 60000],    p50: 35000, inverse: false, frequency: 'daily' },
  india_vix:             { name: 'India VIX',                section: 'S7', sub_section: 'markets',     unit: 'index',      unit_desc: 'volatility index',       data_type: 'index',      expected_range: [6, 95],          p50: 16,    inverse: true,  frequency: 'daily' },
  gsec_10y:              { name: 'G-Sec 10Y',                section: 'S7', sub_section: 'markets',     unit: '%',          unit_desc: 'percent yield',          data_type: 'percentage', expected_range: [5, 10],          p50: 7.2,   inverse: true,  frequency: 'daily' },
  inr_usd:               { name: 'INR/USD',                  section: 'S7', sub_section: 'markets',     unit: '₹',          unit_desc: 'INR per 1 USD',          data_type: 'price',      expected_range: [60, 100],        p50: 75,    inverse: true,  frequency: 'daily' },
  gold_inr_gram:         { name: 'Gold INR/gram',            section: 'S7', sub_section: 'markets',     unit: '₹/g',        unit_desc: 'INR per gram',           data_type: 'price',      expected_range: [2000, 12000],    p50: 5200,  inverse: false, frequency: 'daily' },
  brent_usd:             { name: 'Brent Crude',              section: 'S7', sub_section: 'markets',     unit: '$/bbl',      unit_desc: 'USD per barrel',         data_type: 'price',      expected_range: [15, 140],        p50: 65,    inverse: true,  frequency: 'daily' },
  rbi_fx_reserves:       { name: 'RBI FX Reserves',          section: 'S7', sub_section: 'markets',     unit: '$ bn',       unit_desc: 'USD billions',           data_type: 'currency',   expected_range: [300, 750],       p50: 520,   inverse: false, frequency: 'daily' },

  // ═══════════════════════════════════════════════════════════════════
  // S8 — REAL ESTATE (RESIDENTIAL)
  // ═══════════════════════════════════════════════════════════════════
  re_launches_units:     { name: 'RE Launches',              section: 'S8', sub_section: 're_residential', unit: 'units',   unit_desc: 'dwelling units',         data_type: 'count',      expected_range: [15000, 140000],  p50: 65000, inverse: false, frequency: 'quarterly' },
  re_sales_units:        { name: 'RE Sales',                 section: 'S8', sub_section: 're_residential', unit: 'units',   unit_desc: 'dwelling units',         data_type: 'count',      expected_range: [15000, 150000],  p50: 70000, inverse: false, frequency: 'quarterly' },
  re_unsold_inventory:   { name: 'Unsold Inventory',         section: 'S8', sub_section: 're_residential', unit: 'units',   unit_desc: 'dwelling units',         data_type: 'count',      expected_range: [300000, 800000], p50: 550000, inverse: true, frequency: 'quarterly' },
  hpi_mumbai:            { name: 'HPI Mumbai',               section: 'S8', sub_section: 're_residential', unit: 'index',   unit_desc: 'NHB HPI (base=100)',     data_type: 'index',      expected_range: [90, 250],        p50: 145,   inverse: false, frequency: 'quarterly' },
  hpi_delhi:             { name: 'HPI Delhi',                section: 'S8', sub_section: 're_residential', unit: 'index',   unit_desc: 'NHB HPI (base=100)',     data_type: 'index',      expected_range: [90, 220],        p50: 135,   inverse: false, frequency: 'quarterly' },
  hpi_bengaluru:         { name: 'HPI Bengaluru',            section: 'S8', sub_section: 're_residential', unit: 'index',   unit_desc: 'NHB HPI (base=100)',     data_type: 'index',      expected_range: [90, 250],        p50: 150,   inverse: false, frequency: 'quarterly' },
  hpi_hyderabad:         { name: 'HPI Hyderabad',            section: 'S8', sub_section: 're_residential', unit: 'index',   unit_desc: 'NHB HPI (base=100)',     data_type: 'index',      expected_range: [90, 270],        p50: 155,   inverse: false, frequency: 'quarterly' },
  affordability_index:   { name: 'Affordability Index',      section: 'S8', sub_section: 're_residential', unit: 'ratio',   unit_desc: 'price-to-income ratio',  data_type: 'ratio',      expected_range: [2, 10],          p50: 5.0,   inverse: true,  frequency: 'quarterly' },
  home_loan_disbursements:{ name: 'Home Loan Disbursements', section: 'S8', sub_section: 're_residential', unit: '₹ cr',    unit_desc: 'INR crore',              data_type: 'currency',   expected_range: [50000, 700000],  p50: 230000, inverse: false, frequency: 'quarterly' },
  avg_home_loan_rate:    { name: 'Avg Home Loan Rate',       section: 'S8', sub_section: 're_residential', unit: '%',       unit_desc: 'percent per annum',      data_type: 'percentage', expected_range: [6, 11],          p50: 8.2,   inverse: true,  frequency: 'quarterly' },

  // ═══════════════════════════════════════════════════════════════════
  // S8 — REAL ESTATE (COMMERCIAL)
  // ═══════════════════════════════════════════════════════════════════
  office_absorption:     { name: 'Office Absorption',        section: 'S8', sub_section: 're_commercial', unit: 'mn sq ft', unit_desc: 'million sq ft per quarter', data_type: 'count',   expected_range: [8, 100],         p50: 40,    inverse: false, frequency: 'quarterly' },
  office_vacancy:        { name: 'Office Vacancy',           section: 'S8', sub_section: 're_commercial', unit: '%',        unit_desc: 'percent vacant',           data_type: 'percentage', expected_range: [6, 28],       p50: 16,    inverse: true,  frequency: 'quarterly' },
  rent_bengaluru:        { name: 'Rent Bengaluru',           section: 'S8', sub_section: 're_commercial', unit: '₹/sqft/mo', unit_desc: 'INR per sqft per month', data_type: 'price',     expected_range: [40, 170],        p50: 85,    inverse: false, frequency: 'quarterly' },
  rent_mumbai:           { name: 'Rent Mumbai',              section: 'S8', sub_section: 're_commercial', unit: '₹/sqft/mo', unit_desc: 'INR per sqft per month', data_type: 'price',     expected_range: [70, 220],        p50: 140,   inverse: false, frequency: 'quarterly' },
  retail_mall_vacancy:   { name: 'Retail Mall Vacancy',      section: 'S8', sub_section: 're_commercial', unit: '%',        unit_desc: 'percent vacant',           data_type: 'percentage', expected_range: [3, 28],       p50: 14,    inverse: true,  frequency: 'quarterly' },
  embassy_reit:          { name: 'Embassy REIT',             section: 'S8', sub_section: 're_commercial', unit: '₹/unit',   unit_desc: 'INR per REIT unit',        data_type: 'price',    expected_range: [220, 500],       p50: 350,   inverse: false, frequency: 'daily' },
  mindspace_reit:        { name: 'Mindspace REIT',           section: 'S8', sub_section: 're_commercial', unit: '₹/unit',   unit_desc: 'INR per REIT unit',        data_type: 'price',    expected_range: [180, 520],       p50: 310,   inverse: false, frequency: 'daily' },
  brookfield_reit:       { name: 'Brookfield REIT',          section: 'S8', sub_section: 're_commercial', unit: '₹/unit',   unit_desc: 'INR per REIT unit',        data_type: 'price',    expected_range: [180, 420],       p50: 290,   inverse: false, frequency: 'daily' },

  // ═══════════════════════════════════════════════════════════════════
  // S9 — GLOBAL GROWTH
  // ═══════════════════════════════════════════════════════════════════
  us_gdp_saar:           { name: 'US GDP SAAR',              section: 'S9', sub_section: 'global_growth',    unit: '%',     unit_desc: 'percent SAAR',           data_type: 'percentage', expected_range: [-35, 38],        p50: 2.5,   inverse: false, frequency: 'quarterly' },
  china_gdp:             { name: 'China GDP',                section: 'S9', sub_section: 'global_growth',    unit: '%',     unit_desc: 'percent YoY',            data_type: 'percentage', expected_range: [-10, 22],        p50: 5.5,   inverse: false, frequency: 'quarterly' },
  ez_gdp:                { name: 'Eurozone GDP',             section: 'S9', sub_section: 'global_growth',    unit: '%',     unit_desc: 'percent YoY',            data_type: 'percentage', expected_range: [-18, 15],        p50: 1.5,   inverse: false, frequency: 'quarterly' },
  global_pmi_composite:  { name: 'Global PMI Composite',     section: 'S9', sub_section: 'global_growth',    unit: 'index', unit_desc: 'diffusion index 0-100',  data_type: 'index',      expected_range: [24, 60],         p50: 52.0,  inverse: false, frequency: 'monthly' },
  us_pmi_composite:      { name: 'US PMI Composite',         section: 'S9', sub_section: 'global_growth',    unit: 'index', unit_desc: 'diffusion index 0-100',  data_type: 'index',      expected_range: [24, 62],         p50: 53.0,  inverse: false, frequency: 'monthly' },
  china_pmi_composite:   { name: 'China PMI Composite',      section: 'S9', sub_section: 'global_growth',    unit: 'index', unit_desc: 'diffusion index 0-100',  data_type: 'index',      expected_range: [25, 60],         p50: 51.5,  inverse: false, frequency: 'monthly' },

  // ═══════════════════════════════════════════════════════════════════
  // S9 — GLOBAL INFLATION
  // ═══════════════════════════════════════════════════════════════════
  us_cpi:                { name: 'US CPI',                   section: 'S9', sub_section: 'global_inflation', unit: '%',     unit_desc: 'percent YoY',            data_type: 'percentage', expected_range: [-1, 11],         p50: 2.8,   inverse: true,  frequency: 'monthly' },
  us_core_cpi:           { name: 'US Core CPI',              section: 'S9', sub_section: 'global_inflation', unit: '%',     unit_desc: 'percent YoY',            data_type: 'percentage', expected_range: [0, 8],           p50: 2.5,   inverse: true,  frequency: 'monthly' },
  us_core_pce:           { name: 'US Core PCE',              section: 'S9', sub_section: 'global_inflation', unit: '%',     unit_desc: 'percent YoY',            data_type: 'percentage', expected_range: [0, 7],           p50: 2.2,   inverse: true,  frequency: 'monthly' },
  ez_cpi:                { name: 'Eurozone CPI',             section: 'S9', sub_section: 'global_inflation', unit: '%',     unit_desc: 'percent YoY',            data_type: 'percentage', expected_range: [-1, 13],         p50: 2.0,   inverse: true,  frequency: 'monthly' },
  china_cpi:             { name: 'China CPI',                section: 'S9', sub_section: 'global_inflation', unit: '%',     unit_desc: 'percent YoY',            data_type: 'percentage', expected_range: [-2, 7],          p50: 2.0,   inverse: true,  frequency: 'monthly' },
  fao_food_index:        { name: 'FAO Food Index',           section: 'S9', sub_section: 'global_inflation', unit: 'index', unit_desc: 'FAO price index',        data_type: 'index',      expected_range: [85, 180],        p50: 120,   inverse: true,  frequency: 'monthly' },

  // ═══════════════════════════════════════════════════════════════════
  // S9 — GLOBAL LIQUIDITY
  // ═══════════════════════════════════════════════════════════════════
  fed_funds_rate:        { name: 'Fed Funds Rate',           section: 'S9', sub_section: 'global_liquidity', unit: '%',     unit_desc: 'percent per annum',      data_type: 'percentage', expected_range: [0, 6],           p50: 1.75,  inverse: true,  frequency: 'monthly' },
  fed_balance_sheet:     { name: 'Fed Balance Sheet',        section: 'S9', sub_section: 'global_liquidity', unit: '$ bn',  unit_desc: 'USD billions',           data_type: 'currency',   expected_range: [3500, 9500],     p50: 7000,  inverse: false, frequency: 'monthly' },
  ecb_deposit_rate:      { name: 'ECB Deposit Rate',         section: 'S9', sub_section: 'global_liquidity', unit: '%',     unit_desc: 'percent per annum',      data_type: 'percentage', expected_range: [-1, 5],          p50: 1.5,   inverse: true,  frequency: 'monthly' },
  boj_rate:              { name: 'BOJ Rate',                 section: 'S9', sub_section: 'global_liquidity', unit: '%',     unit_desc: 'percent per annum',      data_type: 'percentage', expected_range: [-0.2, 1.2],      p50: 0.1,   inverse: true,  frequency: 'monthly' },
  us_10y_treasury:       { name: 'US 10Y Treasury',          section: 'S9', sub_section: 'global_liquidity', unit: '%',     unit_desc: 'percent yield',          data_type: 'percentage', expected_range: [0.3, 5.5],       p50: 2.8,   inverse: true,  frequency: 'daily' },
  dxy:                   { name: 'DXY',                      section: 'S9', sub_section: 'global_liquidity', unit: 'index', unit_desc: 'US Dollar Index',        data_type: 'index',      expected_range: [86, 118],        p50: 100,   inverse: true,  frequency: 'daily' },

  // ═══════════════════════════════════════════════════════════════════
  // S9 — GLOBAL MARKETS
  // ═══════════════════════════════════════════════════════════════════
  sp500:                 { name: 'S&P 500',                  section: 'S9', sub_section: 'global_markets',   unit: 'index', unit_desc: 'index points',           data_type: 'index',      expected_range: [2000, 7000],     p50: 4300,  inverse: false, frequency: 'daily' },
  nasdaq:                { name: 'Nasdaq',                   section: 'S9', sub_section: 'global_markets',   unit: 'index', unit_desc: 'index points',           data_type: 'index',      expected_range: [6000, 22000],    p50: 14000, inverse: false, frequency: 'daily' },
  euro_stoxx50:          { name: 'Euro Stoxx 50',            section: 'S9', sub_section: 'global_markets',   unit: 'index', unit_desc: 'index points',           data_type: 'index',      expected_range: [2000, 6000],     p50: 3800,  inverse: false, frequency: 'daily' },
  hang_seng:             { name: 'Hang Seng',                section: 'S9', sub_section: 'global_markets',   unit: 'index', unit_desc: 'index points',           data_type: 'index',      expected_range: [13000, 38000],   p50: 24000, inverse: false, frequency: 'daily' },
  nikkei225:             { name: 'Nikkei 225',               section: 'S9', sub_section: 'global_markets',   unit: 'index', unit_desc: 'index points',           data_type: 'index',      expected_range: [14000, 58000],   p50: 35000, inverse: false, frequency: 'daily' },
  us_vix:                { name: 'US VIX',                   section: 'S9', sub_section: 'global_markets',   unit: 'index', unit_desc: 'CBOE volatility index',  data_type: 'index',      expected_range: [8, 90],          p50: 18,    inverse: true,  frequency: 'daily' },
  brent_usd_global:      { name: 'Brent (Global)',           section: 'S9', sub_section: 'global_markets',   unit: '$/bbl', unit_desc: 'USD per barrel',         data_type: 'price',      expected_range: [15, 140],        p50: 65,    inverse: true,  frequency: 'daily' },
  wti_usd:               { name: 'WTI Crude',                section: 'S9', sub_section: 'global_markets',   unit: '$/bbl', unit_desc: 'USD per barrel',         data_type: 'price',      expected_range: [-40, 130],       p50: 62,    inverse: true,  frequency: 'daily' },
  nat_gas:               { name: 'Natural Gas',              section: 'S9', sub_section: 'global_markets',   unit: '$/MMBtu', unit_desc: 'USD per MMBtu',        data_type: 'price',      expected_range: [1, 12],          p50: 3.5,   inverse: true,  frequency: 'daily' },
  gold_usd:              { name: 'Gold (USD)',                section: 'S9', sub_section: 'global_markets',   unit: '$/oz',  unit_desc: 'USD per troy ounce',     data_type: 'price',      expected_range: [1000, 5500],     p50: 2200,  inverse: false, frequency: 'daily' },
  copper:                { name: 'Copper',                   section: 'S9', sub_section: 'global_markets',   unit: '$/lb',  unit_desc: 'USD per pound',          data_type: 'price',      expected_range: [1.5, 6],         p50: 3.8,   inverse: false, frequency: 'daily' },
  iron_ore:              { name: 'Iron Ore',                 section: 'S9', sub_section: 'global_markets',   unit: '$/t',   unit_desc: 'USD per metric tonne',   data_type: 'price',      expected_range: [50, 260],        p50: 115,   inverse: false, frequency: 'daily' },
  bdi:                   { name: 'Baltic Dry Index',         section: 'S9', sub_section: 'global_markets',   unit: 'index', unit_desc: 'freight rate index',     data_type: 'index',      expected_range: [250, 6000],      p50: 1600,  inverse: false, frequency: 'daily' },
};

// ── Derived exports for backward compatibility ──────────────────────

/** slug → { section, sub_section, indicator_name, unit } (replaces slug-map.js) */
export const SLUG_MAP = Object.fromEntries(
  Object.entries(INDICATOR_SCHEMA).map(([slug, s]) => [
    slug,
    { section: s.section, sub_section: s.sub_section, indicator_name: s.name, unit: s.unit },
  ])
);

/** slug → { min, max, p10, p25, p50, p75, p90 } (replaces HISTORICAL_RANGES) */
export const HISTORICAL_RANGES = Object.fromEntries(
  Object.entries(INDICATOR_SCHEMA).map(([slug, s]) => {
    const [min, max] = s.expected_range;
    const span = max - min;
    return [slug, {
      min, max,
      p10: Math.round((min + span * 0.10) * 100) / 100,
      p25: Math.round((min + span * 0.25) * 100) / 100,
      p50: s.p50,
      p75: Math.round((min + span * 0.75) * 100) / 100,
      p90: Math.round((min + span * 0.90) * 100) / 100,
    }];
  })
);

/** slug → 'daily' | 'monthly' | 'quarterly' (replaces indicator-freshness.js) */
export const INDICATOR_FRESHNESS = Object.fromEntries(
  Object.entries(INDICATOR_SCHEMA).map(([slug, s]) => [slug, s.frequency])
);

/** Set of slugs where higher = worse (replaces INVERSE_INDICATORS in template-filler) */
export const INVERSE_INDICATORS = new Set(
  Object.entries(INDICATOR_SCHEMA).filter(([, s]) => s.inverse).map(([slug]) => slug)
);

/** All valid slugs */
export const VALID_SLUGS = Object.keys(INDICATOR_SCHEMA);

/** Full schema for any consumer that needs all fields */
export { INDICATOR_SCHEMA };
