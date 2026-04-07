/**
 * MacroDataAnalyst — Uses Claude Haiku + web_search to fetch macro indicators.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { searchAndExtract } from './skills/web-search.js';
import { extractIndicator } from './skills/data-extractor.js';
import { scorePct10y } from '../../Analysis/SignalDetector/skills/signal-scoring.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const persona = readFileSync(join(__dirname, 'Persona.md'), 'utf-8');

const SEARCH_QUERIES = [
  {
    query: 'India CPI inflation latest month 2026 MOSPI',
    slugs: ['cpi_headline', 'cpi_core', 'cfpi_food'],
    extract: 'Return JSON: { cpi_headline: {value,previous,source,vintage}, cpi_core: {value,previous,source,vintage}, cfpi_food: {value,previous,source,vintage} }. Values as % YoY.',
  },
  {
    query: 'India GDP growth rate latest quarter FY26 FY27 MOSPI advance estimate',
    slugs: ['india_gdp_yoy', 'india_gdp_fy_estimate', 'rbi_gdp_forecast'],
    extract: 'Return JSON: { india_gdp_yoy: {value,previous,source,vintage}, india_gdp_fy_estimate: {value,previous,source,vintage}, rbi_gdp_forecast: {value,previous,source,vintage} }. Values as % YoY.',
  },
  {
    query: 'India PMI manufacturing services composite HSBC S&P Global latest 2026',
    slugs: ['pmi_mfg', 'pmi_services', 'pmi_composite'],
    extract: 'Return JSON: { pmi_mfg: {value,previous,source,vintage}, pmi_services: {value,previous,source,vintage}, pmi_composite: {value,previous,source,vintage} }. Values as index numbers.',
  },
  {
    query: 'India GST collections revenue latest month 2026 gross',
    slugs: ['gst_month', 'gst_ytd'],
    extract: 'Return JSON: { gst_month: {value,previous,source,vintage}, gst_ytd: {value,previous,source,vintage} }. Values in INR crore.',
  },
  {
    query: 'India IIP industrial production capital goods core sector latest 2026',
    slugs: ['iip_yoy', 'iip_capgoods', 'capacity_utilisation', 'core_sector_yoy'],
    extract: 'Return JSON: { iip_yoy: {value,previous,source,vintage}, iip_capgoods: {value,previous,source,vintage}, capacity_utilisation: {value,previous,source,vintage}, core_sector_yoy: {value,previous,source,vintage} }. Values as %.',
  },
  {
    query: 'India WPI wholesale price index fuel inflation RBI repo rate 2026',
    slugs: ['wpi', 'fuel_inflation', 'rbi_repo_rate', 'rbi_inflation_forecast'],
    extract: 'Return JSON: { wpi: {value,previous,source,vintage}, fuel_inflation: {value,previous,source,vintage}, rbi_repo_rate: {value,previous,source,vintage}, rbi_inflation_forecast: {value,previous,source,vintage} }. Values as %.',
  },
  {
    query: 'India passenger vehicle 2 wheeler commercial vehicle sales airline passengers ecommerce latest 2026',
    slugs: ['pv_sales', '2w_sales', 'cv_sales', 'airline_pax', 'ecom_gmv_growth'],
    extract: 'Return JSON: { pv_sales: {value,previous,source,vintage}, "2w_sales": {value,previous,source,vintage}, cv_sales: {value,previous,source,vintage}, airline_pax: {value,previous,source,vintage}, ecom_gmv_growth: {value,previous,source,vintage} }. Sales as YoY %, airline_pax in millions, ecom as %.',
  },
  {
    query: 'India bank credit growth deposit growth CD ratio NBFC credit corporate bond issuance RBI latest 2026',
    slugs: ['bank_credit_growth', 'deposit_growth', 'cd_ratio', 'nbfc_credit_growth', 'corp_bond_issuance'],
    extract: 'Return JSON: { bank_credit_growth: {value,previous,source,vintage}, deposit_growth: {value,previous,source,vintage}, cd_ratio: {value,previous,source,vintage}, nbfc_credit_growth: {value,previous,source,vintage}, corp_bond_issuance: {value,previous,source,vintage} }. Growth as %, cd_ratio as %, issuance in INR crore.',
  },
  {
    query: 'FII DII flows India equity SIP inflows AMFI mutual fund AUM latest 2026',
    slugs: ['fii_equity_net', 'dii_equity_net', 'sip_inflows', 'sip_yoy_growth', 'mf_aum', 'mf_avg_aum', 'equity_mf_net', 'nfo_collections', 'sip_accounts', 'sip_aum'],
    extract: 'Return JSON: { fii_equity_net: {value,previous,source,vintage}, dii_equity_net: {value,previous,source,vintage}, sip_inflows: {value,previous,source,vintage}, sip_yoy_growth: {value,previous,source,vintage}, mf_aum: {value,previous,source,vintage}, mf_avg_aum: {value,previous,source,vintage}, equity_mf_net: {value,previous,source,vintage}, nfo_collections: {value,previous,source,vintage}, sip_accounts: {value,previous,source,vintage}, sip_aum: {value,previous,source,vintage} }. Flows in INR crore, AUM in INR lakh crore, accounts in millions.',
  },
  {
    query: 'US GDP growth CPI core PCE Fed funds rate latest 2026',
    slugs: ['us_gdp_saar', 'us_cpi', 'us_core_cpi', 'us_core_pce', 'fed_funds_rate'],
    extract: 'Return JSON: { us_gdp_saar: {value,previous,source,vintage}, us_cpi: {value,previous,source,vintage}, us_core_cpi: {value,previous,source,vintage}, us_core_pce: {value,previous,source,vintage}, fed_funds_rate: {value,previous,source,vintage} }. GDP SAAR %, inflation YoY %, fed funds as %.',
  },
  {
    query: 'global PMI composite manufacturing services China Eurozone latest 2026',
    slugs: ['global_pmi_composite', 'us_pmi_composite', 'china_pmi_composite', 'china_gdp', 'china_cpi', 'ez_gdp', 'ez_cpi'],
    extract: 'Return JSON: { global_pmi_composite: {value,previous,source,vintage}, us_pmi_composite: {value,previous,source,vintage}, china_pmi_composite: {value,previous,source,vintage}, china_gdp: {value,previous,source,vintage}, china_cpi: {value,previous,source,vintage}, ez_gdp: {value,previous,source,vintage}, ez_cpi: {value,previous,source,vintage} }. PMI as index, GDP/CPI as %.',
  },
  {
    query: 'ECB deposit rate BOJ rate FAO food price index Fed balance sheet DXY latest 2026',
    slugs: ['ecb_deposit_rate', 'boj_rate', 'fao_food_index', 'fed_balance_sheet', 'dxy', 'us_10y_treasury'],
    extract: 'Return JSON: { ecb_deposit_rate: {value,previous,source,vintage}, boj_rate: {value,previous,source,vintage}, fao_food_index: {value,previous,source,vintage}, fed_balance_sheet: {value,previous,source,vintage}, dxy: {value,previous,source,vintage}, us_10y_treasury: {value,previous,source,vintage} }. Rates as %, balance sheet in USD bn, DXY as index, FAO as index.',
  },
];

export class MacroDataAnalyst {
  async fetch(isoDate) {
    const start = Date.now();
    const indicators = {};
    let totalTokens = { input: 0, output: 0 };

    for (const search of SEARCH_QUERIES) {
      console.log(`[MacroDataAnalyst] Searching: ${search.query.slice(0, 60)}...`);
      try {
        const result = await searchAndExtract(search.query, search.extract);
        if (result.tokens) {
          totalTokens.input += result.tokens.input;
          totalTokens.output += result.tokens.output;
        }

        if (result.data && !result.error) {
          for (const slug of search.slugs) {
            const raw = result.data[slug];
            const extracted = extractIndicator(raw, slug);
            const scored = scorePct10y(slug, extracted.value);
            indicators[slug] = { ...extracted, ...scored };
          }
        } else {
          for (const slug of search.slugs) {
            indicators[slug] = extractIndicator(null, slug);
          }
        }
      } catch (err) {
        console.error(`[MacroDataAnalyst] Search failed: ${err.message}`);
        for (const slug of search.slugs) {
          indicators[slug] = extractIndicator(null, slug);
        }
      }
    }

    const latency = Date.now() - start;
    console.log(`[MacroDataAnalyst] Done in ${latency}ms. ${Object.keys(indicators).length} indicators.`);

    return {
      data: {
        generated_at: new Date().toISOString(),
        run_date: isoDate,
        indicators,
      },
      meta: {
        agent: 'MacroDataAnalyst',
        model: 'claude-haiku-4-5-20251001',
        latency_ms: latency,
        tokens: totalTokens,
      },
    };
  }
}

if (process.argv[1] && process.argv[1].includes('MacroDataAnalyst')) {
  const { isoDate } = (await import('../../../src/utils/ist-date.js')).getISTDate();
  new MacroDataAnalyst().fetch(isoDate).then(r => {
    console.log(JSON.stringify(r.meta, null, 2));
  }).catch(err => { console.error(err); process.exit(1); });
}
