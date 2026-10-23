/**
 * Lending Rules Skill — deterministic stance logic for the Lender's Lens (S12).
 *
 * The question a lender asks is not "is India growing" but "where is the
 * credit cycle, can the system fund more lending, and which books are
 * safe to grow". This skill answers all three from indicators the
 * pipeline already carries (S5 credit, S11 sectoral growth) plus the
 * asset-quality prints LeverageAnalyst now fetches. Pure code. No LLM.
 *
 * Stance vocabulary (three words, deliberately blunt):
 *   Lend       — growth healthy, quality clean, not crowded
 *   Selective  — either crowded (growth at decade highs) or weak demand;
 *                underwrite name by name, expect spread compression
 *   Caution    — late-cycle signature: unsecured + decade-high growth, or
 *                delinquency already rising, or a Minsky ponzi-drift flag
 */

// ── The sector book ───────────────────────────────────────────────────
// Order matters: this is the order rows render on the dashboard.
export const SECTOR_BOOK = [
  { slug: 'india_credit_industry_yoy',  name: 'Industry (large & medium)',   kind: 'wholesale', unsecured: false },
  { slug: 'india_credit_msme_yoy',      name: 'MSME (micro & small)',        kind: 'wholesale', unsecured: false },
  { slug: 'india_credit_medium_yoy',    name: 'Medium industry',             kind: 'wholesale', unsecured: false },
  { slug: 'india_credit_infra_yoy',     name: 'Infrastructure',              kind: 'wholesale', unsecured: false },
  { slug: 'india_credit_cre_yoy',       name: 'Commercial real estate',      kind: 'wholesale', unsecured: false, cyclical: true },
  { slug: 'india_credit_services_yoy',  name: 'Services',                    kind: 'wholesale', unsecured: false },
  { slug: 'india_credit_nbfc_yoy',      name: 'NBFC on-lending',             kind: 'wholesale', unsecured: false },
  { slug: 'india_credit_housing_yoy',   name: 'Housing',                     kind: 'retail',    unsecured: false },
  { slug: 'india_credit_vehicle_yoy',   name: 'Vehicle',                     kind: 'retail',    unsecured: false },
  { slug: 'india_credit_agri_yoy',      name: 'Agriculture',                 kind: 'retail',    unsecured: false },
  { slug: 'india_credit_personal_yoy',  name: 'Personal loans (unsecured)',  kind: 'retail',    unsecured: true  },
  { slug: 'india_credit_creditcard_yoy',name: 'Credit cards',                kind: 'retail',    unsecured: true  },
];

// ── Thresholds ────────────────────────────────────────────────────────
// Percentile cut-offs are on the 10-year distribution the pipeline
// already scores (pct_10y). Quality cut-offs are RBI FSR conventions:
// unsecured retail GNPA above ~2.5% and small-ticket 90+ DPD above ~6%
// are the levels at which the FSR language shifts from "watch" to "stress".
export const T = {
  CROWDED_PCT:        85,   // growth at/above this percentile = crowded book
  CROWDED_PCT_CYCLICAL: 70, // CRE turns before everything else; lower bar
  WEAK_PCT:           20,   // growth at/below this percentile = weak demand
  WEAK_ABS:            5,   // or absolute YoY growth below this
  UNSEC_GNPA_STRESS: 2.5,   // % — unsecured retail GNPA
  SMALLTICKET_STRESS:  6,   // % — small-ticket PL 90+ DPD
  SYS_GNPA_STRESS:     5,   // % — system GNPA
  SYS_GNPA_CLEAN:    2.5,   // % — system GNPA
  CD_TIGHT:           82,   // % — system CD ratio
  CD_STRETCHED:       78,
  GAP_TIGHT:           3,   // pp — credit growth minus deposit growth
  GAP_STRETCHED:       2,
  TARIFF_PARITY:      12.5, // % — at/below this India is at parity with ASEAN peers
};

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Funding gauge: can the banking system fund more credit without bidding
 * up deposits? Reads S5 slugs the MacroDataAnalyst already fetches.
 */
export function fundingGauge(ind) {
  const credit  = num(ind.bank_credit_growth?.value);
  const deposit = num(ind.deposit_growth?.value);
  const cd      = num(ind.cd_ratio?.value);
  const repoDir = ind.rbi_repo_rate?.direction || 'flat';
  const gap = credit !== null && deposit !== null ? Math.round((credit - deposit) * 10) / 10 : null;

  let label, note;
  if (cd === null && gap === null) {
    label = 'No data'; note = 'CD ratio and credit/deposit growth not yet in cache.';
  } else if ((cd ?? 0) >= T.CD_TIGHT || ((cd ?? 0) >= T.CD_STRETCHED && (gap ?? 0) >= T.GAP_TIGHT)) {
    label = 'Tight';
    note = `CD ratio ${cd ?? '—'}%${gap !== null ? ` with credit outrunning deposits by ${gap} pp` : ''}. Banks will pay up for deposits; NIMs compress.`;
  } else if ((cd ?? 0) >= T.CD_STRETCHED || (gap ?? 0) >= T.GAP_STRETCHED) {
    label = 'Stretched';
    note = `CD ratio ${cd ?? '—'}%${gap !== null ? `, credit growth ${gap} pp above deposits` : ''}. Funding available but at rising cost.`;
  } else {
    label = 'Comfortable';
    note = `CD ratio ${cd ?? '—'}%${gap !== null ? `, credit/deposit gap ${gap} pp` : ''}. Room to grow the book.`;
  }
  if (repoDir === 'up' && label !== 'No data') note += ' Policy rate rising; floating-rate books reprice within a quarter.';
  return { label, cd, gap, credit, deposit, repo_direction: repoDir, note };
}

/**
 * Asset-quality gauge: is fast growth healthy or late-cycle? Reads the
 * three FSR prints LeverageAnalyst fetches.
 */
export function qualityGauge(ind) {
  const gnpa  = num(ind.india_bank_gnpa?.value);
  const unsec = num(ind.india_retail_unsecured_gnpa?.value);
  const small = num(ind.india_smallticket_delinquency?.value);

  let label, note;
  if (gnpa === null && unsec === null && small === null) {
    label = 'No data'; note = 'Asset-quality prints not yet in cache.';
  } else if ((gnpa ?? 0) >= T.SYS_GNPA_STRESS) {
    label = 'Deteriorating';
    note = `System GNPA ${gnpa}% — broad stress, not a pocket.`;
  } else if ((small ?? 0) >= T.SMALLTICKET_STRESS || (unsec ?? 0) >= T.UNSEC_GNPA_STRESS) {
    label = 'Unsecured stress';
    note = `System clean (GNPA ${gnpa ?? '—'}%) but small-ticket PL 90+ DPD ${small ?? '—'}% and unsecured retail GNPA ${unsec ?? '—'}%. Stress is in the unsecured pocket.`;
  } else if ((gnpa ?? 99) <= T.SYS_GNPA_CLEAN) {
    label = 'Clean';
    note = `System GNPA ${gnpa}%, unsecured retail GNPA ${unsec ?? '—'}%, small-ticket 90+ DPD ${small ?? '—'}%. Backward-looking, but clean.`;
  } else {
    label = 'Normal';
    note = `System GNPA ${gnpa ?? '—'}%, unsecured retail GNPA ${unsec ?? '—'}%, small-ticket 90+ DPD ${small ?? '—'}%.`;
  }
  return { label, gnpa, unsecured_gnpa: unsec, smallticket_dpd: small, note };
}

/**
 * Export-finance note: the US tariff rate sets the demand side of export
 * working capital. Parity with ASEAN peers is the threshold that matters,
 * not the absolute number.
 */
export function exportNote(ind) {
  const tariff = num(ind.us_tariff_india_pct?.value);
  if (tariff === null) return { tariff: null, label: 'No data', note: 'US tariff rate on Indian goods not in cache.' };
  if (tariff <= T.TARIFF_PARITY) {
    return { tariff, label: 'Parity or better', note: `US tariff on Indian goods ${tariff}% — at or below ASEAN peers. Export working capital in textiles, auto components, chemicals and engineering is demand-supported. Price the legal basis as unstable.` };
  }
  if (tariff <= 25) {
    return { tariff, label: 'Disadvantaged', note: `US tariff on Indian goods ${tariff}% — above peer rates. Haircut US-facing export receivables; favour EU, UK and UAE channels.` };
  }
  return { tariff, label: 'Penalised', note: `US tariff on Indian goods ${tariff}% — punitive. Treat US-facing export receivables as impaired collateral until the rate normalises.` };
}

/**
 * Per-sector stance. `sectorRead` is the LeverageAnalyzer leg for the slug
 * (impulse + ponzi-drift flag) when available; `quality` is qualityGauge().
 */
export function sectorStance(sector, ind, sectorRead, quality) {
  const value = num(ind[sector.slug]?.value);
  const pct   = typeof ind[sector.slug]?.pct_10y === 'number' && value !== null ? ind[sector.slug].pct_10y : null;
  const impulse = sectorRead?.impulse ?? null;
  const ponzi = sectorRead?.flag === 'watch';

  if (value === null) {
    return { ...sector, growth: null, pct: null, impulse, stance: 'No data', reason: 'Growth print not in cache.' };
  }

  // 1. Quality overrides growth: if the unsecured pocket is already
  //    delinquent, no growth number makes it a "Lend".
  if (sector.unsecured && (quality.label === 'Unsecured stress' || quality.label === 'Deteriorating')) {
    return { ...sector, growth: value, pct, impulse, stance: 'Caution',
      reason: `Delinquency already rising (small-ticket 90+ DPD ${quality.smallticket_dpd ?? '—'}%). Growth of ${value}% YoY is late-cycle, not opportunity.` };
  }
  // 2. Minsky ponzi-drift flag from LeverageAnalyzer.
  if (ponzi) {
    return { ...sector, growth: value, pct, impulse, stance: 'Caution',
      reason: `Elevated and still accelerating (impulse ${impulse > 0 ? '+' : ''}${impulse}). The RBI FSR pattern for a pocket that turns.` };
  }
  // 3. Crowded: growth at decade highs. The most cyclical book (CRE)
  //    gets a lower bar: it is the first to turn in every Indian cycle.
  const crowdedBar = sector.cyclical ? T.CROWDED_PCT_CYCLICAL : T.CROWDED_PCT;
  if (pct !== null && pct >= crowdedBar) {
    if (sector.unsecured) {
      return { ...sector, growth: value, pct, impulse, stance: 'Caution',
        reason: `${value}% YoY sits at the ${pct}th percentile of the decade. Unsecured books at decade-high growth do not stay clean.` };
    }
    return { ...sector, growth: value, pct, impulse, stance: 'Selective',
      reason: `${value}% YoY at the ${pct}th percentile — every bank is here. Underwrite on cash flow, expect spread compression.` };
  }
  // 4. Weak demand.
  if ((pct !== null && pct <= T.WEAK_PCT) || value < T.WEAK_ABS) {
    return { ...sector, growth: value, pct, impulse, stance: 'Selective',
      reason: `${value}% YoY${pct !== null ? ` (${pct}th percentile)` : ''} — demand is thin. Pick names; do not chase the segment.` };
  }
  // 5. The middle: healthy.
  return { ...sector, growth: value, pct, impulse, stance: 'Lend',
    reason: `${value}% YoY${pct !== null ? ` (${pct}th percentile)` : ''} — growing, not crowded${quality.label === 'Clean' ? ', system quality clean' : ''}.` };
}

/**
 * Cycle phase from the three gauges plus headline credit growth percentile.
 */
export function cyclePhase(ind, funding, quality) {
  const creditPct = typeof ind.bank_credit_growth?.pct_10y === 'number' && num(ind.bank_credit_growth?.value) !== null
    ? ind.bank_credit_growth.pct_10y : null;
  const hot = creditPct !== null && creditPct >= T.CROWDED_PCT;
  const cold = creditPct !== null && creditPct <= T.WEAK_PCT;

  if (quality.label === 'Deteriorating') return { label: 'Deleveraging', note: 'Credit quality is the constraint. Grow only secured, short-tenor books.' };
  if (hot && (funding.label === 'Tight' || funding.label === 'Stretched')) {
    return { label: 'Late expansion, funding-constrained', note: 'Credit growth at decade highs while deposits lag. Spreads compress and the next move is a slowdown in growth, not a crash in quality.' };
  }
  if (hot) return { label: 'Expansion', note: 'Credit growth at decade highs with funding still comfortable. Lend into secured wholesale; avoid crowding into unsecured retail.' };
  if (cold) return { label: 'Early cycle', note: 'Credit growth near decade lows. Demand recovers before quality deteriorates — this is where new entrants build book cheaply.' };
  return { label: 'Mid cycle', note: 'Credit growth in its normal range. Sector selection matters more than timing.' };
}
