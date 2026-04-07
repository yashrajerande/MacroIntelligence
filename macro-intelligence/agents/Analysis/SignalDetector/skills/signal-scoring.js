/**
 * Signal Scoring Skill — 10-year historical ranges for all 97 indicator slugs.
 * Percentile computation is deterministic. LLM only writes pct_note narrative.
 */

const HISTORICAL_RANGES = {
  // S2/growth
  india_gdp_yoy:        { min: -7.4,  max: 9.3,   p10: 4.0,  p25: 5.5,  p50: 6.5,  p75: 7.5,  p90: 8.0  },
  india_gdp_fy_estimate: { min: -6.6, max: 9.1,   p10: 4.5,  p25: 5.8,  p50: 6.7,  p75: 7.5,  p90: 8.2  },
  rbi_gdp_forecast:     { min: -8.0,  max: 9.5,   p10: 4.5,  p25: 5.5,  p50: 6.5,  p75: 7.5,  p90: 8.5  },
  pmi_mfg:              { min: 27.4,  max: 62.0,  p10: 49.0, p25: 51.0, p50: 54.0, p75: 56.5, p90: 58.0 },
  pmi_services:         { min: 5.4,   max: 62.0,  p10: 49.0, p25: 51.5, p50: 54.5, p75: 57.0, p90: 59.5 },
  pmi_composite:        { min: 7.2,   max: 62.0,  p10: 49.0, p25: 51.0, p50: 54.0, p75: 57.0, p90: 59.0 },
  iip_yoy:              { min: -57.3, max: 134.4, p10: -2.0, p25: 1.5,  p50: 4.5,  p75: 7.5,  p90: 12.0 },
  iip_capgoods:         { min: -74.0, max: 200.0, p10: -5.0, p25: 0.0,  p50: 5.0,  p75: 10.0, p90: 20.0 },
  capacity_utilisation: { min: 60.0,  max: 78.0,  p10: 66.0, p25: 69.0, p50: 73.0, p75: 75.0, p90: 76.5 },
  core_sector_yoy:      { min: -37.9, max: 68.3,  p10: -1.0, p25: 2.0,  p50: 5.0,  p75: 8.5,  p90: 12.0 },

  // S3/inflation
  cpi_headline:         { min: 1.2,   max: 9.5,   p10: 2.5,  p25: 3.5,  p50: 5.2,  p75: 6.5,  p90: 7.5  },
  cpi_core:             { min: 3.0,   max: 7.0,   p10: 3.5,  p25: 4.0,  p50: 5.0,  p75: 5.8,  p90: 6.5  },
  cfpi_food:            { min: -3.0,  max: 14.0,  p10: 1.0,  p25: 3.0,  p50: 6.0,  p75: 8.5,  p90: 11.0 },
  wpi:                  { min: -5.5,  max: 16.6,  p10: -1.0, p25: 0.5,  p50: 3.0,  p75: 6.0,  p90: 12.0 },
  fuel_inflation:       { min: -15.0, max: 20.0,  p10: -5.0, p25: 0.0,  p50: 5.0,  p75: 10.0, p90: 14.0 },
  rbi_repo_rate:        { min: 4.0,   max: 8.0,   p10: 4.0,  p25: 5.15, p50: 6.0,  p75: 6.5,  p90: 7.25 },
  rbi_inflation_forecast:{ min: 2.0,  max: 7.5,   p10: 3.0,  p25: 4.0,  p50: 4.8,  p75: 5.5,  p90: 6.5  },

  // S4/consumption
  gst_month:            { min: 80000, max: 230000,p10: 95000,p25: 110000,p50: 145000,p75: 175000,p90: 195000 },
  gst_ytd:              { min: 800000,max: 2400000,p10: 950000,p25: 1200000,p50: 1600000,p75: 2000000,p90: 2200000 },
  pv_sales:             { min: -70.0, max: 120.0, p10: -5.0, p25: 2.0,  p50: 8.0,  p75: 15.0, p90: 25.0 },
  '2w_sales':           { min: -70.0, max: 100.0, p10: -10.0,p25: 0.0,  p50: 8.0,  p75: 15.0, p90: 25.0 },
  cv_sales:             { min: -80.0, max: 150.0, p10: -10.0,p25: 0.0,  p50: 8.0,  p75: 20.0, p90: 35.0 },
  airline_pax:          { min: 30,    max: 170,   p10: 60,   p25: 80,   p50: 120,  p75: 145,  p90: 155  },
  ecom_gmv_growth:      { min: 10.0,  max: 50.0,  p10: 15.0, p25: 20.0, p50: 28.0, p75: 35.0, p90: 42.0 },

  // S5/credit
  bank_credit_growth:   { min: 4.0,   max: 22.0,  p10: 6.0,  p25: 8.5,  p50: 11.0, p75: 14.0, p90: 17.0 },
  deposit_growth:       { min: 6.0,   max: 18.0,  p10: 8.0,  p25: 9.5,  p50: 11.5, p75: 13.5, p90: 15.0 },
  cd_ratio:             { min: 65.0,  max: 82.0,  p10: 68.0, p25: 72.0, p50: 76.0, p75: 78.5, p90: 80.0 },
  nbfc_credit_growth:   { min: -5.0,  max: 25.0,  p10: 2.0,  p25: 8.0,  p50: 14.0, p75: 18.0, p90: 22.0 },
  corp_bond_issuance:   { min: 20000, max: 120000,p10: 30000,p25: 45000,p50: 65000,p75: 85000,p90: 100000 },

  // S6/flows
  fii_equity_net:       { min: -60000,max: 40000, p10: -25000,p25: -10000,p50: 2000, p75: 12000,p90: 25000 },
  dii_equity_net:       { min: -10000,max: 45000, p10: 2000, p25: 8000, p50: 15000,p75: 22000,p90: 30000 },
  sip_inflows:          { min: 1000,  max: 31500, p10: 5000, p25: 8000, p50: 12000,p75: 18000,p90: 25000 },
  sip_yoy_growth:       { min: -5.0,  max: 50.0,  p10: 5.0,  p25: 12.0, p50: 22.0, p75: 32.0, p90: 40.0 },
  mf_aum:               { min: 10,    max: 75,    p10: 15,   p25: 25,   p50: 40,   p75: 55,   p90: 65   },
  mf_avg_aum:           { min: 8,     max: 70,    p10: 12,   p25: 22,   p50: 35,   p75: 50,   p90: 60   },
  equity_mf_net:        { min: -5000, max: 40000, p10: 2000, p25: 5000, p50: 12000,p75: 20000,p90: 30000 },
  nfo_collections:      { min: 500,   max: 25000, p10: 1500, p25: 3000, p50: 6000, p75: 12000,p90: 18000 },
  sip_accounts:         { min: 10,    max: 100,   p10: 15,   p25: 25,   p50: 45,   p75: 70,   p90: 85   },
  sip_aum:              { min: 2,     max: 15,    p10: 3,    p25: 4.5,  p50: 7,    p75: 10,   p90: 13   },

  // S7/markets
  nifty50:              { min: 5000,  max: 26500, p10: 8000, p25: 10500,p50: 14000,p75: 19000,p90: 22000 },
  sensex:               { min: 17000, max: 86000, p10: 27000,p25: 35000,p50: 48000,p75: 65000,p90: 75000 },
  bank_nifty:           { min: 10000, max: 55000, p10: 18000,p25: 25000,p50: 35000,p75: 45000,p90: 50000 },
  india_vix:            { min: 7,     max: 90,    p10: 10,   p25: 12,   p50: 16,   p75: 22,   p90: 30   },
  gsec_10y:             { min: 5.5,   max: 9.5,   p10: 6.0,  p25: 6.5,  p50: 7.2,  p75: 7.5,  p90: 8.0  },
  inr_usd:              { min: 62,    max: 95,    p10: 64,   p25: 68,   p50: 75,   p75: 83,   p90: 87   },
  gold_inr_gram:        { min: 2500,  max: 9500,  p10: 3000, p25: 3800, p50: 5200, p75: 6500, p90: 8000 },
  brent_usd:            { min: 18,    max: 130,   p10: 40,   p25: 55,   p50: 65,   p75: 80,   p90: 95   },
  rbi_fx_reserves:      { min: 350,   max: 700,   p10: 380,  p25: 420,  p50: 520,  p75: 600,  p90: 650  },

  // S8/re_residential
  re_launches_units:    { min: 20000, max: 120000,p10: 30000,p25: 45000,p50: 65000,p75: 85000,p90: 100000 },
  re_sales_units:       { min: 20000, max: 130000,p10: 35000,p25: 50000,p50: 70000,p75: 95000,p90: 110000 },
  re_unsold_inventory:  { min: 400000,max: 750000,p10: 420000,p25: 470000,p50: 550000,p75: 620000,p90: 680000 },
  hpi_mumbai:           { min: 100,   max: 200,   p10: 110,  p25: 125,  p50: 145,  p75: 165,  p90: 185  },
  hpi_delhi:            { min: 100,   max: 180,   p10: 105,  p25: 115,  p50: 135,  p75: 155,  p90: 170  },
  hpi_bengaluru:        { min: 100,   max: 200,   p10: 110,  p25: 125,  p50: 150,  p75: 170,  p90: 190  },
  hpi_hyderabad:        { min: 100,   max: 220,   p10: 110,  p25: 130,  p50: 155,  p75: 180,  p90: 205  },
  affordability_index:  { min: 3.0,   max: 8.0,   p10: 3.5,  p25: 4.0,  p50: 5.0,  p75: 6.0,  p90: 7.0  },
  home_loan_disbursements:{ min: 100000,max: 400000,p10: 120000,p25: 160000,p50: 230000,p75: 300000,p90: 360000 },
  avg_home_loan_rate:   { min: 6.5,   max: 10.0,  p10: 6.8,  p25: 7.5,  p50: 8.2,  p75: 8.8,  p90: 9.5  },

  // S8/re_commercial
  office_absorption:    { min: 10,    max: 70,    p10: 15,   p25: 25,   p50: 40,   p75: 52,   p90: 60   },
  office_vacancy:       { min: 8,     max: 25,    p10: 10,   p25: 12,   p50: 16,   p75: 19,   p90: 22   },
  rent_bengaluru:       { min: 50,    max: 120,   p10: 55,   p25: 65,   p50: 80,   p75: 95,   p90: 110  },
  rent_mumbai:          { min: 80,    max: 200,   p10: 90,   p25: 110,  p50: 140,  p75: 165,  p90: 185  },
  retail_mall_vacancy:  { min: 5,     max: 25,    p10: 7,    p25: 10,   p50: 14,   p75: 18,   p90: 22   },
  embassy_reit:         { min: 250,   max: 450,   p10: 280,  p25: 310,  p50: 350,  p75: 390,  p90: 420  },
  mindspace_reit:       { min: 200,   max: 400,   p10: 230,  p25: 260,  p50: 310,  p75: 350,  p90: 380  },
  brookfield_reit:      { min: 200,   max: 380,   p10: 220,  p25: 250,  p50: 290,  p75: 330,  p90: 360  },

  // S9/global_growth
  us_gdp_saar:          { min: -31.2, max: 33.8,  p10: -1.0, p25: 1.0,  p50: 2.5,  p75: 3.5,  p90: 5.0  },
  china_gdp:            { min: -6.8,  max: 18.3,  p10: 3.5,  p25: 4.5,  p50: 5.5,  p75: 6.5,  p90: 7.5  },
  ez_gdp:               { min: -14.4, max: 12.5,  p10: -0.5, p25: 0.5,  p50: 1.5,  p75: 2.5,  p90: 3.5  },
  global_pmi_composite: { min: 26.0,  max: 58.0,  p10: 48.0, p25: 50.0, p50: 52.0, p75: 54.0, p90: 55.5 },
  us_pmi_composite:     { min: 27.0,  max: 60.0,  p10: 47.0, p25: 50.0, p50: 53.0, p75: 55.5, p90: 57.0 },
  china_pmi_composite:  { min: 27.5,  max: 58.0,  p10: 48.0, p25: 49.5, p50: 51.5, p75: 53.5, p90: 55.0 },

  // S9/global_inflation
  us_cpi:               { min: 0.1,   max: 9.1,   p10: 1.0,  p25: 1.8,  p50: 2.8,  p75: 5.0,  p90: 7.0  },
  us_core_cpi:          { min: 0.3,   max: 6.6,   p10: 1.2,  p25: 1.8,  p50: 2.5,  p75: 4.0,  p90: 5.5  },
  us_core_pce:          { min: 0.9,   max: 5.6,   p10: 1.2,  p25: 1.6,  p50: 2.2,  p75: 3.5,  p90: 4.5  },
  ez_cpi:               { min: -0.3,  max: 10.6,  p10: 0.5,  p25: 1.0,  p50: 2.0,  p75: 4.5,  p90: 7.0  },
  china_cpi:            { min: -1.0,  max: 5.5,   p10: 0.0,  p25: 0.8,  p50: 2.0,  p75: 2.8,  p90: 3.5  },
  fao_food_index:       { min: 90,    max: 170,   p10: 95,   p25: 105,  p50: 120,  p75: 135,  p90: 150  },

  // S9/global_liquidity
  fed_funds_rate:       { min: 0.0,   max: 5.50,  p10: 0.1,  p25: 0.25, p50: 1.75, p75: 4.5,  p90: 5.25 },
  fed_balance_sheet:    { min: 3800,  max: 9000,  p10: 4000, p25: 4500, p50: 7000, p75: 8200, p90: 8700 },
  ecb_deposit_rate:     { min: -0.5,  max: 4.0,   p10: -0.4, p25: 0.0,  p50: 1.5,  p75: 3.0,  p90: 3.75 },
  boj_rate:             { min: -0.1,  max: 0.5,   p10: -0.1, p25: -0.1, p50: 0.0,  p75: 0.1,  p90: 0.25 },
  us_10y_treasury:      { min: 0.5,   max: 5.0,   p10: 0.8,  p25: 1.5,  p50: 2.8,  p75: 4.0,  p90: 4.5  },
  dxy:                  { min: 89,    max: 114,   p10: 92,   p25: 95,   p50: 100,  p75: 105,  p90: 110  },

  // S9/global_markets
  sp500:                { min: 2200,  max: 6500,  p10: 2800, p25: 3500, p50: 4300, p75: 5200, p90: 5800 },
  nasdaq:               { min: 6600,  max: 21000, p10: 8500, p25: 11000,p50: 14000,p75: 17000,p90: 19000 },
  euro_stoxx50:         { min: 2300,  max: 5600,  p10: 2800, p25: 3200, p50: 3800, p75: 4500, p90: 5100 },
  hang_seng:            { min: 14600, max: 33500, p10: 16000,p25: 19000,p50: 24000,p75: 28000,p90: 31000 },
  nikkei225:            { min: 16000, max: 42000, p10: 20000,p25: 24000,p50: 28000,p75: 35000,p90: 39000 },
  us_vix:               { min: 9,     max: 82,    p10: 12,   p25: 14,   p50: 18,   p75: 25,   p90: 33   },
  brent_usd_global:     { min: 18,    max: 130,   p10: 40,   p25: 55,   p50: 65,   p75: 80,   p90: 95   },
  wti_usd:              { min: -37,   max: 120,   p10: 38,   p25: 50,   p50: 62,   p75: 78,   p90: 92   },
  nat_gas:              { min: 1.5,   max: 10.0,  p10: 2.0,  p25: 2.5,  p50: 3.5,  p75: 5.0,  p90: 7.0  },
  gold_usd:             { min: 1100,  max: 3200,  p10: 1250, p25: 1500, p50: 1800, p75: 2200, p90: 2800 },
  copper:               { min: 2.0,   max: 5.2,   p10: 2.5,  p25: 3.0,  p50: 3.8,  p75: 4.3,  p90: 4.8  },
  iron_ore:             { min: 60,    max: 230,   p10: 75,   p25: 90,   p50: 115,  p75: 140,  p90: 170  },
  bdi:                  { min: 300,   max: 5500,  p10: 600,  p25: 1000, p50: 1600, p75: 2500, p90: 3500 },
};

/**
 * Compute 10-year percentile for a given indicator.
 * Returns { pct_10y, pct_10y_tier, pct_note }
 */
export function scorePct10y(slug, value) {
  const range = HISTORICAL_RANGES[slug];
  if (!range || value === null || value === undefined) {
    return { pct_10y: 50, pct_10y_tier: 'mid', pct_note: '~Estimated — historical range not available.' };
  }

  // Linear interpolation within known percentile bands
  let pct;
  if (value <= range.min) {
    pct = 0;
  } else if (value >= range.max) {
    pct = 100;
  } else if (value <= range.p10) {
    pct = Math.round(10 * (value - range.min) / (range.p10 - range.min));
  } else if (value <= range.p25) {
    pct = Math.round(10 + 15 * (value - range.p10) / (range.p25 - range.p10));
  } else if (value <= range.p50) {
    pct = Math.round(25 + 25 * (value - range.p25) / (range.p50 - range.p25));
  } else if (value <= range.p75) {
    pct = Math.round(50 + 25 * (value - range.p50) / (range.p75 - range.p50));
  } else if (value <= range.p90) {
    pct = Math.round(75 + 15 * (value - range.p75) / (range.p90 - range.p75));
  } else {
    pct = Math.round(90 + 10 * (value - range.p90) / (range.max - range.p90));
  }

  pct = Math.max(0, Math.min(100, pct));

  let tier;
  if (pct >= 80) tier = 'hi';
  else if (pct >= 40) tier = 'mid';
  else tier = 'lo';

  return { pct_10y: pct, pct_10y_tier: tier, pct_note: '' };
}

/**
 * Score all indicators at once.
 */
export function scoreAllIndicators(indicators) {
  const scored = {};
  for (const [slug, ind] of Object.entries(indicators)) {
    const score = scorePct10y(slug, ind.value);
    scored[slug] = { ...ind, ...score };
  }
  return scored;
}

export { HISTORICAL_RANGES };
