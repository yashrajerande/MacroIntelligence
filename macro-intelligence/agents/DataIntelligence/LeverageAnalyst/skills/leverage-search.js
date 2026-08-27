/**
 * Leverage Search Skill — Uses Claude Haiku + web_search for private-debt data.
 *
 * Sources: BIS (Bank for International Settlements) credit-to-GDP series,
 * RBI Financial Stability Report / sectoral deployment of bank credit.
 */

import { searchAndExtract } from '../../MacroDataAnalyst/skills/web-search.js';

const LEVERAGE_SEARCHES = [
  {
    query: 'BIS credit to GDP household debt corporate debt India United States China Japan Eurozone UK latest quarter 2026',
    extract: `Return JSON with keys: india_hh_debt_gdp, india_corp_debt_gdp, us_hh_debt_gdp,
us_corp_debt_gdp, china_hh_debt_gdp, china_corp_debt_gdp, japan_hh_debt_gdp, japan_corp_debt_gdp,
ez_hh_debt_gdp, ez_corp_debt_gdp, uk_hh_debt_gdp, uk_corp_debt_gdp.
Each key maps to { value (percent of GDP, number), previous (number, prior quarter), source (string), vintage (string like "Q2 2026") }.
Use the BIS "total credit to private non-financial sector" series (household + corporate split) where available.`,
  },
  {
    query: 'RBI sectoral deployment of bank credit latest month 2026 industry services personal loans agriculture housing vehicle credit card NBFC',
    extract: `Return JSON with keys: india_credit_industry_yoy, india_credit_services_yoy,
india_credit_personal_yoy, india_credit_agri_yoy, india_credit_housing_yoy,
india_credit_vehicle_yoy, india_credit_creditcard_yoy, india_credit_nbfc_yoy.
Each key maps to { value (percent YoY growth, number), previous (number, prior month), source (string), vintage (string like "month 2026") }.
Source: RBI's monthly "Sectoral Deployment of Bank Credit" release.`,
  },
];

export async function fetchLeverageData() {
  const results = {};
  let totalTokens = { input: 0, output: 0 };

  for (const search of LEVERAGE_SEARCHES) {
    const result = await searchAndExtract(search.query, search.extract);
    if (result.tokens) {
      totalTokens.input += result.tokens.input;
      totalTokens.output += result.tokens.output;
    }
    if (result.data) {
      Object.assign(results, result.data);
    } else {
      console.warn(`[LeverageAnalyst] Search failed: ${search.query.slice(0, 60)}... — ${result.error || 'unknown'}`);
    }
  }

  return { data: results, tokens: totalTokens };
}
