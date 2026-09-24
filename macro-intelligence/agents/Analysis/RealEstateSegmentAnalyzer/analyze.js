/**
 * RealEstateSegmentAnalyzer — Pure code. No LLM.
 *
 * Turns the RealEstateSegmentAnalyst's fetched blocks and history into
 * the judgements the founder asked for:
 *
 *   - Ticket-size bands: supply/demand balance per band (launch share vs
 *     sales share) → undersupplied / balanced / oversupplied.
 *   - Cities: ranked by sales momentum, with price YoY and months of
 *     inventory, so "which city is running hot" is one glance.
 *   - Buyers: NRI share today, the prior print, the DIRECTION (rising /
 *     falling / flat) from the dated history, and the NRI share inside
 *     premium/luxury — the specific claim ("NRI demand for premium
 *     Mumbai is going up and will keep prices high") gets a number and a
 *     direction every day, not an anecdote.
 *   - Commercial: cities ranked by leasing, occupier split, GCC share.
 *
 * Everything is deterministic and unit-tested. The narrative and the
 * "so what" block are assembled from the numbers, so they can never say
 * something the data does not.
 */

import { PRICE_BANDS, CITIES, OFFICE_CITIES } from '../../DataIntelligence/RealEstateSegmentAnalyst/skills/segment-search.js';

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const pct1 = v => (v === null ? '—' : `${Math.round(v * 10) / 10}%`);
const pp1 = v => (v === null ? '—' : `${v > 0 ? '+' : ''}${Math.round(v * 10) / 10} pp`);
const fmtUnits = v => (v === null ? '—' : Math.round(v).toLocaleString('en-IN'));

// A band is "undersupplied" when demand share exceeds supply share by
// more than this many percentage points (and vice versa). 3 pp is inside
// the noise of a single quarter's mix; 5 pp is a trend the reports
// themselves comment on.
export const BALANCE_THRESHOLD_PP = 3;

export function classifyBalance(launchShare, salesShare) {
  const l = num(launchShare), s = num(salesShare);
  if (l === null || s === null) return { balance: 'unknown', gap_pp: null };
  const gap = s - l; // demand minus supply
  if (gap >= BALANCE_THRESHOLD_PP) return { balance: 'undersupplied', gap_pp: gap };
  if (gap <= -BALANCE_THRESHOLD_PP) return { balance: 'oversupplied', gap_pp: gap };
  return { balance: 'balanced', gap_pp: gap };
}

/**
 * NRI direction from the dated history. Prefers two distinct fetched
 * prints (today vs the most recent earlier print with a different
 * value); falls back to the source's own prior-period figure when the
 * history is too young to have two prints. 1 pp is the noise floor.
 */
// Two fetches minutes apart can differ by a couple of points purely on
// which article the search landed on. A history comparison only counts
// when the earlier print is at least this many days older; until then
// the source's own prior-period figure is the honest basis.
export const NRI_HISTORY_MIN_AGE_DAYS = 28;

export function classifyNriDirection(latestBuyers, history = [], { minAgeDays = NRI_HISTORY_MIN_AGE_DAYS } = {}) {
  const now = num(latestBuyers?.nri_share_pct);
  if (now === null) return { direction: 'unknown', delta_pp: null, basis: 'no NRI share published' };

  const entries = (history || []).filter(h => h?.fetched_at);
  const newestAt = entries.length ? new Date(entries[entries.length - 1].fetched_at) : null;
  const priorFromHistory = newestAt === null ? undefined : [...entries]
    .slice(0, -1)
    .reverse()
    .filter(h => (newestAt - new Date(h.fetched_at)) / 86400000 >= minAgeDays)
    .map(h => num(h?.buyers?.nri_share_pct))
    .find(v => v !== null && v !== now);
  const priorFromSource = num(latestBuyers?.nri_share_prev_pct);

  const prior = priorFromHistory ?? priorFromSource;
  const basis = priorFromHistory !== undefined && priorFromHistory !== null
    ? 'vs earlier fetched print'
    : (priorFromSource !== null ? 'vs prior period in source' : 'single print only');
  if (prior === null || prior === undefined) return { direction: 'unknown', delta_pp: null, basis };

  const delta = now - prior;
  if (delta >= 1) return { direction: 'rising', delta_pp: delta, basis };
  if (delta <= -1) return { direction: 'falling', delta_pp: delta, basis };
  return { direction: 'flat', delta_pp: delta, basis };
}

function analyzeBands(residential) {
  const byId = Object.fromEntries((residential?.bands || []).map(b => [String(b.band || '').toLowerCase(), b]));
  return PRICE_BANDS.map(def => {
    const b = byId[def.id] || {};
    const launches_share_pct = num(b.launches_share_pct);
    const sales_share_pct = num(b.sales_share_pct);
    const sales_yoy_pct = num(b.sales_yoy_pct);
    return { ...def, launches_share_pct, sales_share_pct, sales_yoy_pct, ...classifyBalance(launches_share_pct, sales_share_pct) };
  });
}

/**
 * Sources name the same market five ways — "MMR (Mumbai)", "Mumbai",
 * "Delhi-NCR", "Gurugram", "Bangalore". Collapse them onto the canonical
 * city ids so a row is never lost to a spelling. Exported for tests.
 */
export function normalizeCity(name) {
  const s = String(name || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z\s-]/g, ' ').trim();
  if (/mmr|mumbai|thane|navi/.test(s)) return 'MMR';
  if (/ncr|delhi|gurugram|gurgaon|noida/.test(s)) return 'NCR';
  if (/bengaluru|bangalore/.test(s)) return 'Bengaluru';
  if (/hyderabad/.test(s)) return 'Hyderabad';
  if (/pune/.test(s)) return 'Pune';
  if (/chennai/.test(s)) return 'Chennai';
  if (/kolkata|calcutta/.test(s)) return 'Kolkata';
  return null;
}

function indexByCity(rows) {
  const out = {};
  for (const r of rows || []) {
    const id = normalizeCity(r?.city);
    if (id && !out[id]) out[id] = r;
  }
  return out;
}

function analyzeCities(residential) {
  const byName = indexByCity(residential?.cities);
  const rows = CITIES.map(city => {
    const c = byName[city] || {};
    return {
      city,
      sales_units: num(c.sales_units),
      sales_yoy_pct: num(c.sales_yoy_pct),
      launches_units: num(c.launches_units),
      launches_yoy_pct: num(c.launches_yoy_pct),
      price_yoy_pct: num(c.price_yoy_pct),
      unsold_months: num(c.unsold_months),
    };
  });
  // Rank by sales momentum; cities without a YoY print sink to the bottom.
  rows.sort((a, b) => (b.sales_yoy_pct ?? -Infinity) - (a.sales_yoy_pct ?? -Infinity));
  rows.forEach((r, i) => { r.rank = r.sales_yoy_pct === null ? null : i + 1; });
  return rows;
}

function analyzeCommercial(commercial) {
  const byName = indexByCity(commercial?.cities);
  const cities = OFFICE_CITIES.map(city => {
    const c = byName[city] || {};
    return {
      city,
      absorption_mn_sqft: num(c.absorption_mn_sqft),
      absorption_yoy_pct: num(c.absorption_yoy_pct),
      vacancy_pct: num(c.vacancy_pct),
      rent_yoy_pct: num(c.rent_yoy_pct),
    };
  });
  cities.sort((a, b) => (b.absorption_mn_sqft ?? -Infinity) - (a.absorption_mn_sqft ?? -Infinity));
  cities.forEach((r, i) => { r.rank = r.absorption_mn_sqft === null ? null : i + 1; });
  const o = commercial?.occupiers || {};
  const occupiers = {
    gcc_share_pct: num(o.gcc_share_pct),
    it_services_share_pct: num(o.it_services_share_pct),
    bfsi_share_pct: num(o.bfsi_share_pct),
    flex_share_pct: num(o.flex_share_pct),
    domestic_share_pct: num(o.domestic_share_pct),
    global_share_pct: num(o.global_share_pct),
  };
  return { cities, occupiers };
}

function coverage(bands, cities, buyers, commercial) {
  let present = 0, total = 0;
  const tally = (v) => { total++; if (v !== null) present++; };
  bands.forEach(b => { tally(b.launches_share_pct); tally(b.sales_share_pct); });
  cities.forEach(c => { tally(c.sales_yoy_pct); tally(c.price_yoy_pct); });
  tally(num(buyers?.nri_share_pct)); tally(num(buyers?.nri_share_premium_luxury_pct));
  commercial.cities.forEach(c => tally(c.absorption_mn_sqft));
  tally(commercial.occupiers.gcc_share_pct);
  return { present, total, pct: total ? Math.round((present / total) * 100) : 0 };
}

/**
 * Deterministic narrative + so-what block. Every clause is gated on the
 * number that supports it; missing numbers produce an honest gap
 * sentence rather than a guess.
 */
function buildNarrative({ bands, cities, buyers, nri, commercial, vintage, cov }) {
  const facts = [];
  const gaps = [];

  // Bands: supply vs demand
  const under = bands.filter(b => b.balance === 'undersupplied');
  const over = bands.filter(b => b.balance === 'oversupplied');
  const withShares = bands.filter(b => b.sales_share_pct !== null);
  if (withShares.length) {
    const top = [...withShares].sort((a, b) => b.sales_share_pct - a.sales_share_pct)[0];
    facts.push(`${top.label} (${top.range}) took <strong>${pct1(top.sales_share_pct)}</strong> of sales vs <strong>${pct1(top.launches_share_pct)}</strong> of launches — ${top.balance === 'undersupplied' ? 'demand ahead of supply' : top.balance === 'oversupplied' ? 'supply ahead of demand' : 'supply and demand matched'}`);
    if (under.length) facts.push(`Undersupplied: ${under.map(b => `${b.label} (${pp1(b.gap_pp)})`).join(', ')}`);
    if (over.length) facts.push(`Oversupplied: ${over.map(b => `${b.label} (${pp1(b.gap_pp)})`).join(', ')}`);
  } else {
    gaps.push('band-wise launch and sales shares not published this print');
  }

  // Cities
  const ranked = cities.filter(c => c.rank !== null);
  if (ranked.length) {
    const hot = ranked[0], cold = ranked[ranked.length - 1];
    facts.push(`City momentum: ${hot.city} leads at <strong>${pct1(hot.sales_yoy_pct)}</strong> sales YoY${hot.price_yoy_pct !== null ? ` (prices ${pct1(hot.price_yoy_pct)} YoY)` : ''}; ${cold.city} trails at <strong>${pct1(cold.sales_yoy_pct)}</strong>`);
  } else {
    gaps.push('city-wise sales YoY not published this print');
  }

  // NRI
  const nriShare = num(buyers?.nri_share_pct);
  if (nriShare !== null) {
    const dir = nri.direction === 'rising' ? 'RISING' : nri.direction === 'falling' ? 'FALLING' : nri.direction === 'flat' ? 'flat' : 'direction unknown';
    const prem = num(buyers?.nri_share_premium_luxury_pct);
    const topCities = (buyers?.nri_top_cities || []).slice(0, 3).join(', ');
    facts.push(`NRI buying is <strong>${dir}</strong>: <strong>${pct1(nriShare)}</strong> of residential purchases${nri.delta_pp !== null ? ` (${pp1(nri.delta_pp)} ${nri.basis})` : ''}${prem !== null ? `; <strong>${pct1(prem)}</strong> within premium/luxury` : ''}${topCities ? `; concentrated in ${topCities}` : ''}`);
  } else {
    gaps.push('NRI share of purchases not published this print');
  }

  // Commercial
  const officeRanked = commercial.cities.filter(c => c.rank !== null);
  if (officeRanked.length) {
    const lead = officeRanked[0];
    const gcc = commercial.occupiers.gcc_share_pct;
    facts.push(`Office: ${lead.city} leads leasing at <strong>${lead.absorption_mn_sqft} mn sq ft / quarter</strong>${lead.absorption_yoy_pct !== null ? ` (${pct1(lead.absorption_yoy_pct)} YoY)` : ''}${gcc !== null ? `; GCCs take <strong>${pct1(gcc)}</strong> of leasing` : ''}`);
  } else {
    gaps.push('city-wise office leasing not published this print');
  }

  // Supply-only read: the launch split by band is published more often
  // than the sales split. When only supply is known, say where the
  // supply is going instead of pretending the balance is known.
  const launchKnown = bands.filter(b => b.launches_share_pct !== null);
  const topEndLaunchShare = launchKnown.length
    ? launchKnown.filter(b => b.id === 'luxury' || b.id === 'ultra_luxury').reduce((s, b) => s + b.launches_share_pct, 0)
    : null;
  if (!withShares.length && launchKnown.length) {
    facts.splice(0, 0, `Launch mix (supply): <strong>${pct1(topEndLaunchShare)}</strong> of new launches priced above ₹1.5 cr${(() => { const a = launchKnown.find(b => b.id === 'affordable'); return a ? `; affordable just <strong>${pct1(a.launches_share_pct)}</strong>` : ''; })()} — sales split by band not published this print`);
  }

  // Tension + bottom line
  let tension, bottom_line;
  const lux = bands.find(b => b.id === 'luxury'), ultra = bands.find(b => b.id === 'ultra_luxury'), aff = bands.find(b => b.id === 'affordable');
  const topEndUnder = [lux, ultra].some(b => b && b.balance === 'undersupplied');
  const balanceKnown = bands.some(b => b.balance !== 'unknown');
  const affOver = aff && aff.balance === 'oversupplied';
  if (nriShare !== null && nri.direction === 'rising' && !balanceKnown && topEndLaunchShare !== null) {
    tension = `NRI demand is rising and developers are launching ${pct1(topEndLaunchShare)} of new supply above ₹1.5 cr — both sides are crowding into the top end, and whether sales absorb that supply is the number this print does not publish.`;
    bottom_line = `Watch the sales-share split by band next quarter: if luxury sales share prints below its ${pct1(topEndLaunchShare)} launch share, unsold inventory builds at the top end first, NRI bid or not.`;
  } else if (nriShare !== null && nri.direction === 'rising' && topEndUnder) {
    tension = `NRI money is concentrating in the top-end bands that are already undersupplied — that combination holds prices up even as the affordable end ${affOver ? 'oversupplies' : 'softens'}.`;
    bottom_line = `Premium and luxury pricing is NRI-funded and supply-constrained; a stronger rupee or a remittance slowdown is the specific risk to the top end, not domestic affordability.`;
  } else if (nriShare !== null && nri.direction === 'falling') {
    tension = `NRI share is falling while the top-end bands ${topEndUnder ? 'remain undersupplied' : 'are adequately supplied'} — the price support the market has leaned on is thinning.`;
    bottom_line = `Watch luxury launch shares: if developers keep launching into the top end as NRI demand fades, unsold inventory in the ₹1.5 cr+ bands is the next print to turn.`;
  } else if (withShares.length) {
    tension = `Supply is following demand into ${under.length ? under.map(b => b.label).join('/') : 'the same bands'} with a lag; the balance shifts one quarter after the sales mix does.`;
    bottom_line = `Track the launch share of the undersupplied bands next quarter — supply catching up is what turns a price story into an inventory story.`;
  } else {
    tension = `This print is thin: ${gaps.join('; ')}.`;
    bottom_line = `Treat segment conclusions as provisional until the next quarterly report drops.`;
  }

  const topEndWord = !balanceKnown
    ? (topEndLaunchShare !== null ? 'Top-End Supply Building' : 'Band Balance Unpublished')
    : (topEndUnder ? 'Top End Undersupplied' : 'Top End Supplied');
  const title = nriShare !== null && nri.direction !== 'unknown'
    ? `NRI Bid ${nri.direction === 'rising' ? 'Rising' : nri.direction === 'falling' ? 'Fading' : 'Steady'} — ${topEndWord}`
    : `Segment Read — ${withShares.length ? 'Demand Mix vs Launch Mix' : launchKnown.length ? 'Launch Mix Only' : 'Awaiting Quarterly Prints'}`;

  const narrative = [
    ...facts.map(f => f.replace(/<\/?strong>/g, '').replace(/\.?\s*$/, '.')),
    gaps.length ? `Not published this print: ${gaps.join('; ')}.` : null,
    `Data vintage: ${vintage || 'unknown'}; coverage ${cov.present}/${cov.total} fields.`,
  ].filter(Boolean).join(' ');

  return { title, facts, tension, bottom_line, narrative, gaps };
}

export class RealEstateSegmentAnalyzer {
  /**
   * @param {object} segmentData — { latest, history } from RealEstateSegmentAnalyst
   */
  analyze(segmentData) {
    const start = Date.now();
    const latest = segmentData?.latest || {};
    const history = Array.isArray(segmentData?.history) ? segmentData.history : [];

    const bands = analyzeBands(latest.residential);
    const cities = analyzeCities(latest.residential);
    const buyers = latest.buyers || {};
    const nri = classifyNriDirection(buyers, history);
    const commercial = analyzeCommercial(latest.commercial);
    const cov = coverage(bands, cities, buyers, commercial);

    const vintage = latest.residential?.vintage || latest.buyers?.vintage || latest.commercial?.vintage || null;
    const sources = [latest.residential?.source, latest.buyers?.source, latest.commercial?.source].filter(Boolean).join(' · ');
    const soWhat = buildNarrative({ bands, cities, buyers, nri, commercial, vintage, cov });

    const data = {
      vintage,
      sources,
      fetched_at: latest.fetched_at || null,
      served_from_cache: !!segmentData?.served_from_cache,
      carried_fields: latest.carried_fields || 0,
      consolidated_from: Array.isArray(latest.consolidated_from) ? latest.consolidated_from : [],
      bands,
      cities,
      buyers: {
        nri_share_pct: num(buyers.nri_share_pct),
        nri_share_prev_pct: num(buyers.nri_share_prev_pct),
        nri_share_premium_luxury_pct: num(buyers.nri_share_premium_luxury_pct),
        domestic_share_pct: num(buyers.domestic_share_pct),
        nri_top_cities: Array.isArray(buyers.nri_top_cities) ? buyers.nri_top_cities.slice(0, 5) : [],
        nri_source_regions: Array.isArray(buyers.nri_source_regions) ? buyers.nri_source_regions.slice(0, 5) : [],
        developer_nri_shares: Array.isArray(buyers.developer_nri_shares) ? buyers.developer_nri_shares.slice(0, 6) : [],
        nri_trend_note: typeof buyers.nri_trend_note === 'string' ? buyers.nri_trend_note : '',
        remittances_usd_bn: num(buyers.remittances_usd_bn),
        remittances_yoy_pct: num(buyers.remittances_yoy_pct),
        nre_nro_deposit_growth_yoy_pct: num(buyers.nre_nro_deposit_growth_yoy_pct),
      },
      nri,
      commercial,
      coverage: cov,
      history_points: history.filter(h => num(h?.buyers?.nri_share_pct) !== null).map(h => ({ d: h.fetched_at?.slice(0, 10), v: num(h.buyers.nri_share_pct) })),
      narrative: soWhat.narrative,
      so_what: { title: soWhat.title, facts: soWhat.facts, tension: soWhat.tension, bottom_line: soWhat.bottom_line },
      gaps: soWhat.gaps,
    };

    const latency = Date.now() - start;
    console.log(`[RealEstateSegmentAnalyzer] Done in ${latency}ms. NRI ${nri.direction}${nri.delta_pp !== null ? ` (${pp1(nri.delta_pp)})` : ''}; coverage ${cov.present}/${cov.total}.`);
    return {
      data,
      meta: { agent: 'RealEstateSegmentAnalyzer', model: 'none', latency_ms: latency, tokens: { input: 0, output: 0 } },
    };
  }
}

export { pct1, pp1, fmtUnits };
