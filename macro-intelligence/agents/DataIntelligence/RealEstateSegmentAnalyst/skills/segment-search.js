/**
 * Segment Search Skill — Haiku + web_search for the segmented residential
 * and commercial real-estate picture: ticket-size bands, city split,
 * buyer origin (domestic vs NRI), and commercial leasing by city/occupier.
 *
 * Three searches, each returning one structured block. Numbers that the
 * sources do not publish come back null and stay null — the Charter's
 * "Awaited, never fabricated" rule applies to shares as much as levels.
 */

import { searchAndExtract } from '../../MacroDataAnalyst/skills/web-search.js';

// Anarock's five budget bands are the industry convention for the
// top-7 cities. Knight Frank's three-band split maps onto them; the
// analyzer tolerates either as long as the band ids below are used.
export const PRICE_BANDS = [
  { id: 'affordable',   label: 'Affordable',   range: '< ₹40 lakh' },
  { id: 'mid',          label: 'Mid-segment',  range: '₹40–80 lakh' },
  { id: 'premium',      label: 'Premium',      range: '₹80 lakh – ₹1.5 cr' },
  { id: 'luxury',       label: 'Luxury',       range: '₹1.5 – 2.5 cr' },
  { id: 'ultra_luxury', label: 'Ultra-luxury', range: '> ₹2.5 cr' },
];

export const CITIES = ['MMR', 'NCR', 'Bengaluru', 'Pune', 'Hyderabad', 'Chennai', 'Kolkata'];
export const OFFICE_CITIES = ['Bengaluru', 'Hyderabad', 'MMR', 'NCR', 'Pune', 'Chennai'];

const SEGMENT_SEARCHES = [
  {
    key: 'residential',
    query: 'India residential real estate latest quarter 2026 sales launches by budget segment luxury premium affordable share top 7 cities MMR NCR Bengaluru Pune Hyderabad Chennai Kolkata Anarock Knight Frank PropEquity',
    extract: `Return JSON: {
  "vintage": "quarter the numbers refer to, e.g. Q2 2026 or Jul-Sep 2026",
  "source": "publisher(s), e.g. Anarock / Knight Frank",
  "bands": [
    { "band": "affordable",   "range": "< ₹40 lakh",          "launches_share_pct": number|null, "sales_share_pct": number|null, "sales_yoy_pct": number|null },
    { "band": "mid",          "range": "₹40-80 lakh",          "launches_share_pct": number|null, "sales_share_pct": number|null, "sales_yoy_pct": number|null },
    { "band": "premium",      "range": "₹80 lakh - ₹1.5 cr",   "launches_share_pct": number|null, "sales_share_pct": number|null, "sales_yoy_pct": number|null },
    { "band": "luxury",       "range": "₹1.5 - 2.5 cr",        "launches_share_pct": number|null, "sales_share_pct": number|null, "sales_yoy_pct": number|null },
    { "band": "ultra_luxury", "range": "> ₹2.5 cr",            "launches_share_pct": number|null, "sales_share_pct": number|null, "sales_yoy_pct": number|null }
  ],
  "cities": [
    { "city": "MMR", "sales_units": number|null, "sales_yoy_pct": number|null, "launches_units": number|null, "launches_yoy_pct": number|null, "price_yoy_pct": number|null, "unsold_months": number|null },
    ... one object each for MMR, NCR, Bengaluru, Pune, Hyderabad, Chennai, Kolkata
  ]
}
launches_share_pct = that band's share of NEW LAUNCHES (supply) in the latest single quarter across the top-7 cities; sales_share_pct = that band's share of SALES (demand) in the same quarter; shares in percent of units and should each sum to ~100. sales_yoy_pct = YoY change in units sold in that band. City sales_units / launches_units = units in the latest single QUARTER (not annual, not thousands — full unit counts); price_yoy_pct = average residential price change YoY for that city; unsold_months = months of inventory. If a figure is not published, use null — never estimate.`,
  },
  {
    key: 'buyers',
    query: 'NRI share of Indian residential property purchases 2026 NRI demand luxury premium Mumbai Bengaluru Hyderabad Anarock survey DLF Lodha Godrej NRI sales share percentage remittances NRE deposits',
    extract: `Return JSON: {
  "vintage": "period the NRI figures refer to",
  "source": "publisher(s)",
  "nri_share_pct": number|null,
  "nri_share_prev_pct": number|null,
  "nri_share_premium_luxury_pct": number|null,
  "domestic_share_pct": number|null,
  "nri_top_cities": ["city", ...],
  "nri_source_regions": ["UAE", "US", ...],
  "developer_nri_shares": [ { "developer": "DLF", "nri_sales_share_pct": number|null, "period": "..." }, ... ],
  "nri_trend_note": "one sentence stating whether NRI buying is rising or falling and why, with the number",
  "remittances_usd_bn": number|null,
  "remittances_yoy_pct": number|null,
  "nre_nro_deposit_growth_yoy_pct": number|null
}
nri_share_pct = NRIs' share of residential sales value or units in India's top cities for the latest period; nri_share_prev_pct = the same measure for the prior comparable period (a year earlier if available); nri_share_premium_luxury_pct = NRI share within the premium/luxury bands specifically. Report percentages as numbers (12.5 not "12.5%"). Use null when a number is not published — never estimate.`,
  },
  {
    key: 'commercial',
    query: 'India office leasing absorption by city latest quarter 2026 Bengaluru Hyderabad Mumbai NCR Pune Chennai GCC share of leasing IT services flex space vacancy rent CBRE JLL Colliers Knight Frank',
    extract: `Return JSON: {
  "vintage": "quarter the numbers refer to",
  "source": "publisher(s)",
  "cities": [
    { "city": "Bengaluru", "absorption_mn_sqft": number|null, "absorption_yoy_pct": number|null, "vacancy_pct": number|null, "rent_yoy_pct": number|null },
    ... one object each for Bengaluru, Hyderabad, MMR, NCR, Pune, Chennai
  ],
  "occupiers": { "gcc_share_pct": number|null, "it_services_share_pct": number|null, "bfsi_share_pct": number|null, "flex_share_pct": number|null, "domestic_share_pct": number|null, "global_share_pct": number|null }
}
absorption_mn_sqft = gross office leasing in the latest single QUARTER for that city in million sq ft (not annual, not H1); occupier shares = share of quarterly leasing by occupier type in percent. Use null when a number is not published — never estimate.`,
  },
];

/**
 * Run the three segment searches. Each block is independent: a parse
 * failure in one leaves the others intact and is recorded in `errors`.
 */
export async function fetchSegmentData() {
  const data = {};
  const errors = [];
  const tokens = { input: 0, output: 0 };

  for (const s of SEGMENT_SEARCHES) {
    const result = await searchAndExtract(s.query, s.extract);
    if (result.tokens) { tokens.input += result.tokens.input; tokens.output += result.tokens.output; }
    if (result.data && !result.error) {
      data[s.key] = result.data;
    } else {
      errors.push(`${s.key}: ${result.error || 'no data'}`);
      console.warn(`[RealEstateSegmentAnalyst] Search failed: ${s.key} — ${result.error || 'no data'}`);
    }
  }

  return { data, errors, tokens };
}
