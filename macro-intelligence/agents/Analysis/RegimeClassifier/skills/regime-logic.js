/**
 * Regime Logic Skill — Deterministic classification rules for 6 macro dimensions.
 * The LLM only writes signal_text narrative. Math is pure code.
 */

export function classifyGrowth(gdp, pmiComposite) {
  if (gdp >= 7.0 && pmiComposite >= 55) {
    return { badge_type: 'b-exp', badge_label: 'Expansion Mode' };
  }
  if (gdp < 5.5 || pmiComposite < 50) {
    return { badge_type: 'b-risk', badge_label: 'Growth At Risk' };
  }
  if ((gdp >= 5.5 && gdp < 7.0) || (pmiComposite >= 50 && pmiComposite < 55)) {
    return { badge_type: 'b-slow', badge_label: 'Slowing Pace' };
  }
  return { badge_type: 'b-neu', badge_label: 'Steady State' };
}

export function classifyInflation(cpi, fuelInflation) {
  if (cpi > 5.5 || fuelInflation > 10) {
    return { badge_type: 'b-risk', badge_label: 'Inflation Overshoot' };
  }
  if (cpi >= 4.0 && cpi <= 5.5) {
    return { badge_type: 'b-slow', badge_label: 'Rising Pressure' };
  }
  if (cpi < 2.5) {
    return { badge_type: 'b-exp', badge_label: 'Disinflationary' };
  }
  return { badge_type: 'b-neu', badge_label: 'Within Band' };
}

export function classifyCredit(bankCreditGrowth, cdRatio) {
  if (bankCreditGrowth > 13 && cdRatio < 78) {
    return { badge_type: 'b-exp', badge_label: 'Credit Boom' };
  }
  if (bankCreditGrowth < 8 || cdRatio > 82) {
    return { badge_type: 'b-risk', badge_label: 'Credit Stress' };
  }
  if (bankCreditGrowth >= 8 && bankCreditGrowth <= 13) {
    return { badge_type: 'b-slow', badge_label: 'Moderate Growth' };
  }
  return { badge_type: 'b-neu', badge_label: 'Stable Credit' };
}

export function classifyPolicy(repoRate, previousRepoRate) {
  const trend = repoRate - (previousRepoRate || repoRate);
  if (trend < -0.1) {
    return { badge_type: 'b-exp', badge_label: 'Easing Cycle' };
  }
  if (trend > 0.1) {
    return { badge_type: 'b-slow', badge_label: 'Tightening' };
  }
  if (trend > 0.5) {
    return { badge_type: 'b-risk', badge_label: 'Emergency Tightening' };
  }
  return { badge_type: 'b-neu', badge_label: 'Rate Pause' };
}

export function classifyCapex(iipCapgoods, capacityUtil) {
  if (iipCapgoods > 8 && capacityUtil > 75) {
    return { badge_type: 'b-exp', badge_label: 'Capex Upcycle' };
  }
  if (iipCapgoods < 2) {
    return { badge_type: 'b-risk', badge_label: 'Capex Stall' };
  }
  if (iipCapgoods >= 2 && iipCapgoods <= 8) {
    return { badge_type: 'b-slow', badge_label: 'Moderate Capex' };
  }
  return { badge_type: 'b-neu', badge_label: 'Steady Investment' };
}

export function classifyConsumption(gstYoy, pvSalesYoy) {
  if (gstYoy > 10 && pvSalesYoy > 10) {
    return { badge_type: 'b-exp', badge_label: 'Demand Surge' };
  }
  if (gstYoy < 4 || gstYoy < 0) {
    return { badge_type: 'b-risk', badge_label: 'Demand Weakness' };
  }
  if (gstYoy >= 4 && gstYoy <= 10) {
    return { badge_type: 'b-slow', badge_label: 'Tepid Demand' };
  }
  return { badge_type: 'b-neu', badge_label: 'Stable Consumption' };
}

/**
 * Run all 6 classifications and return regime objects.
 */
export function classifyAll(indicators) {
  const get = (slug) => indicators[slug]?.value ?? null;
  const getPrev = (slug) => indicators[slug]?.previous ?? null;

  return [
    {
      dimension: 'growth',
      ...classifyGrowth(get('india_gdp_yoy') || 0, get('pmi_composite') || 0),
      metric_summary: `GDP ${get('india_gdp_yoy') || '~'}%; PMI ${get('pmi_composite') || '~'}`,
      signal_text: '',
    },
    {
      dimension: 'inflation',
      ...classifyInflation(get('cpi_headline') || 0, get('fuel_inflation') || 0),
      metric_summary: `CPI ${get('cpi_headline') || '~'}%; Fuel ${get('fuel_inflation') || '~'}%`,
      signal_text: '',
    },
    {
      dimension: 'credit',
      ...classifyCredit(get('bank_credit_growth') || 0, get('cd_ratio') || 0),
      metric_summary: `Credit ${get('bank_credit_growth') || '~'}%; CD ${get('cd_ratio') || '~'}%`,
      signal_text: '',
    },
    {
      dimension: 'policy',
      ...classifyPolicy(get('rbi_repo_rate') || 0, getPrev('rbi_repo_rate')),
      metric_summary: `Repo ${get('rbi_repo_rate') || '~'}%`,
      signal_text: '',
    },
    {
      dimension: 'capex',
      ...classifyCapex(get('iip_capgoods') || 0, get('capacity_utilisation') || 0),
      metric_summary: `IIP CapG ${get('iip_capgoods') || '~'}%; CU ${get('capacity_utilisation') || '~'}%`,
      signal_text: '',
    },
    {
      dimension: 'consumption',
      ...classifyConsumption(get('gst_month') || 0, get('pv_sales') || 0),
      metric_summary: `GST ${get('gst_month') || '~'}; PV ${get('pv_sales') || '~'}%`,
      signal_text: '',
    },
  ];
}
