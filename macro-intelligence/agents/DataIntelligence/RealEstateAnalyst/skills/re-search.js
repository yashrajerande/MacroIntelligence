/**
 * Real Estate Search Skill — Uses Claude Haiku + web_search for RE data.
 */

import { searchAndExtract } from '../../MacroDataAnalyst/skills/web-search.js';

const RE_SEARCHES = [
  {
    query: 'India residential real estate sales launches latest quarter 2026 Anarock Knight Frank',
    extract: `Return JSON with keys: re_launches_units, re_sales_units, re_unsold_inventory.
Each key maps to { value (number), previous (number), source (string), vintage (string like "Q1 2026") }.
Units in thousands.`,
  },
  {
    query: 'India HPI house price index Mumbai Delhi Bengaluru Hyderabad NHB RBI 2026',
    extract: `Return JSON with keys: hpi_mumbai, hpi_delhi, hpi_bengaluru, hpi_hyderabad.
Each key maps to { value (index number), previous (number), source (string), vintage (string) }.`,
  },
  {
    query: 'India home loan interest rates SBI HDFC NHB average rate 2026 affordability index',
    extract: `Return JSON with keys: avg_home_loan_rate, affordability_index, home_loan_disbursements.
Each key maps to { value (number), previous (number), source (string), vintage (string) }.
avg_home_loan_rate in %, affordability_index as ratio, disbursements in INR crore.`,
  },
  {
    query: 'Embassy REIT Mindspace REIT Brookfield India REIT unit price NAV yield 2026',
    extract: `Return JSON with keys: embassy_reit, mindspace_reit, brookfield_reit.
Each key maps to { value (INR per unit), previous (number), source (string), vintage (string) }.`,
  },
  {
    query: 'India Grade-A office space absorption vacancy rent Bengaluru Mumbai 2026 Knight Frank JLL',
    extract: `Return JSON with keys: office_absorption, office_vacancy, rent_bengaluru, rent_mumbai, retail_mall_vacancy.
Each key maps to { value (number), previous (number), source (string), vintage (string) }.
Absorption in mn sq ft, vacancy in %, rent in INR/sq ft/month.`,
  },
];

export async function fetchRealEstateData() {
  const results = {};
  let totalTokens = { input: 0, output: 0 };

  for (const search of RE_SEARCHES) {
    const result = await searchAndExtract(search.query, search.extract);
    if (result.tokens) {
      totalTokens.input += result.tokens.input;
      totalTokens.output += result.tokens.output;
    }
    if (result.data && !result.error) {
      Object.assign(results, result.data);
    }
  }

  return { data: results, tokens: totalTokens };
}
