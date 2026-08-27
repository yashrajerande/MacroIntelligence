/**
 * LeverageAnalyzer — Pure code. No LLM.
 *
 * Turns raw private-debt LEVELS (from LeverageAnalyst) into the Minsky
 * instinct-building read: for each country/sector, computes the credit
 * impulse from accumulated history and classifies the Level x Impulse
 * quadrant. See src/utils/credit-impulse.js for the framework note.
 *
 * Country debt/GDP levels and sectoral credit growth only just started
 * accumulating in Supabase — the impulse (2nd derivative) needs ~2 years
 * of quarterly prints to mature. Until then this reports 'building' and
 * the level tier alone, which is honest and still useful.
 */

import { INDICATOR_SCHEMA } from '../../../src/utils/indicator-schema.js';
import { computeImpulse, classifyQuadrant, QUADRANT_LABELS } from '../../../src/utils/credit-impulse.js';

const COUNTRIES = [
  { name: 'India',    hh: 'india_hh_debt_gdp', corp: 'india_corp_debt_gdp' },
  { name: 'US',       hh: 'us_hh_debt_gdp',    corp: 'us_corp_debt_gdp' },
  { name: 'China',    hh: 'china_hh_debt_gdp', corp: 'china_corp_debt_gdp' },
  { name: 'Japan',    hh: 'japan_hh_debt_gdp', corp: 'japan_corp_debt_gdp' },
  { name: 'Eurozone', hh: 'ez_hh_debt_gdp',    corp: 'ez_corp_debt_gdp' },
  { name: 'UK',       hh: 'uk_hh_debt_gdp',    corp: 'uk_corp_debt_gdp' },
];

const SECTORS = [
  'india_credit_industry_yoy', 'india_credit_services_yoy', 'india_credit_personal_yoy',
  'india_credit_agri_yoy', 'india_credit_housing_yoy', 'india_credit_vehicle_yoy',
  'india_credit_creditcard_yoy', 'india_credit_nbfc_yoy',
];
const RETAIL_LENDING_SECTORS = new Set(['india_credit_personal_yoy', 'india_credit_creditcard_yoy']);

function leg(slug, allIndicators, dynamicRanges) {
  const ind = allIndicators[slug];
  const schema = INDICATOR_SCHEMA[slug];
  const series = dynamicRanges?.[slug]?.series;
  const imp = computeImpulse(schema.frequency, series);
  const levelPct = ind?.pct_10y ?? null;
  const quadrant = levelPct !== null ? classifyQuadrant(levelPct, imp.impulse) : null;
  return {
    slug,
    name: schema.name,
    level: ind?.value ?? null,
    levelPct,
    ...imp,
    quadrant,
    quadrantLabel: quadrant ? QUADRANT_LABELS[quadrant] : null,
  };
}

export class LeverageAnalyzer {
  analyze(allIndicators, dynamicRanges) {
    const start = Date.now();

    const countries = COUNTRIES.map(c => ({
      country: c.name,
      household: leg(c.hh, allIndicators, dynamicRanges),
      corporate: leg(c.corp, allIndicators, dynamicRanges),
    }));

    const sectors = SECTORS.map(slug => {
      const base = leg(slug, allIndicators, dynamicRanges);
      // Retail-lending Ponzi-drift flag: fast AND accelerating unsecured credit
      // is exactly what RBI's own Financial Stability Reports have flagged.
      const flag = RETAIL_LENDING_SECTORS.has(slug) && base.levelPct >= 70 && (base.impulse ?? 0) > 0.3
        ? 'watch' : null;
      return { ...base, flag };
    });

    // Deterministic narrative — no LLM, so this is free and always available.
    const dangerCountries = countries.flatMap(c => [c.household, c.corporate])
      .filter(l => l.quadrant === 'danger').map(l => l.name);
    const ponziSectors = sectors.filter(s => s.flag === 'watch').map(s => s.name);
    const maturingCount = countries.flatMap(c => [c.household, c.corporate])
      .filter(l => l.maturity === 'building').length;

    let narrative;
    if (dangerCountries.length > 0) {
      narrative = `${dangerCountries.join(', ')} showing the classic pre-shock signature: high private debt with a decelerating credit impulse. `;
    } else {
      narrative = 'No country currently shows the high-debt + decelerating-impulse combination Minsky flags as pre-shock. ';
    }
    if (ponziSectors.length > 0) {
      narrative += `India's ${ponziSectors.join(' and ')} lending is both elevated and still accelerating — the segment RBI's own Financial Stability Reports have repeatedly flagged. `;
    }
    if (maturingCount > 0) {
      narrative += `${maturingCount} of ${countries.length * 2} country debt series still building enough quarterly history for a reliable impulse read (~2 years needed).`;
    }

    const latency = Date.now() - start;
    console.log(`[LeverageAnalyzer] Done in ${latency}ms. ${countries.length} countries, ${sectors.length} sectors.`);

    return {
      data: { countries, sectors, narrative },
      meta: { agent: 'LeverageAnalyzer', model: 'none', latency_ms: latency, tokens: { input: 0, output: 0 } },
    };
  }
}
