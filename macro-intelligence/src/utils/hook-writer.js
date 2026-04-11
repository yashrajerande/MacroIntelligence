/**
 * HOOK WRITER SKILL — Single source of truth for writing the daily verdict line.
 *
 * Problem this solves:
 *   The ExecutiveSummaryWriter kept producing the same hook every day (usually
 *   anchored on the credit-deposit ratio, which is a quarterly metric that
 *   hadn't changed in months). Three root causes:
 *
 *     1. No memory     — writer had no idea what it said yesterday
 *     2. Structural bias — quarterly "juicy" stories beat daily fresh moves
 *     3. No freshness weighting — everything competed equally
 *
 * This skill fixes all three by (a) persisting recent verdicts with extracted
 * themes, (b) scoring candidate indicators by freshness × magnitude × novelty,
 * and (c) building a prompt context that BANS overused themes and FORCES
 * consideration of fresh candidates.
 *
 * Public API:
 *   loadHookHistory()                    → persisted history object
 *   recordHook(date, verdictLine, slugs) → append an entry
 *   extractThemes(text)                  → array of matched theme keys
 *   extractSlugMentions(text)            → array of indicator slugs referenced
 *   getRecentThemes(history, days)       → themes used in last N days
 *   getRecentSlugs(history, days)        → slugs referenced in last N days
 *   getBannedThemes(history, days, maxUses) → themes to BAN from today's hook
 *   scoreHookCandidates(indicators, history) → ranked array with scores
 *   buildHookContext(indicators, history) → prompt-ready context block
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { INDICATOR_SCHEMA } from './indicator-schema.js';
import { scoreIndicator, isValidSignal, getPolarity } from './polarity.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HISTORY_PATH = join(__dirname, '..', '..', 'output', 'hook-history.json');

/**
 * Theme keyword dictionary. Each theme has a list of regex patterns that,
 * when matched in a verdict line, tag it with that theme. Add cautiously —
 * themes are the atomic unit of repetition detection.
 */
const THEME_KEYWORDS = {
  credit_deposit: [
    /credit[\s-]*deposit/i,
    /\bcd\s*ratio\b/i,
    /deposit gap/i,
    /credit gap/i,
    /deposits?\s+\w+\s+outpac/i,
    /deposit\s+shortfall/i,
    /credit[\s-]+engine/i,
  ],
  inflation: [
    /\bcpi\b/i,
    /\binflation\b/i,
    /\bwpi\b/i,
    /food\s+(price|inflation)/i,
    /fuel\s+inflation/i,
    /core\s+cpi/i,
    /rbi.*inflation\s*forecast/i,
  ],
  currency: [
    /inr[\s/\\-]*usd/i,
    /\brupee\b/i,
    /\bdollar\s+index\b/i,
    /\bdxy\b/i,
    /fx\s+reserves/i,
    /currency\s+(weakness|strength|pressure)/i,
    /depreciat/i,
  ],
  oil: [
    /\bbrent\b/i,
    /\bcrude\b/i,
    /\bwti\b/i,
    /oil\s+(price|risk)/i,
    /import\s+bill/i,
    /energy\s+price/i,
  ],
  markets: [
    /\bnifty\b/i,
    /\bsensex\b/i,
    /equity\s+(market|flows?)/i,
    /bank\s+nifty/i,
    /\bvix\b/i,
    /\bnasdaq\b/i,
    /\bs&p\s*500\b/i,
  ],
  gdp_growth: [
    /\bgdp\b/i,
    /\bgva\b/i,
    /economic\s+(growth|activity)/i,
    /\biip\b/i,
    /\bpmi\b/i,
    /capacity\s+utili[sz]ation/i,
    /core\s+sector/i,
  ],
  consumption: [
    /\bgst\b/i,
    /consumer\s+spend/i,
    /vehicle\s+sales/i,
    /passenger\s+vehicle/i,
    /\be-?commerce\b/i,
    /discretionary/i,
    /airline\s+pax/i,
  ],
  flows: [
    /\bfii\b/i,
    /\bdii\b/i,
    /\bsip\s+inflow/i,
    /foreign\s+(inflow|outflow)/i,
    /mutual\s+fund\s+(flow|inflow)/i,
    /retail\s+flow/i,
  ],
  real_estate: [
    /real\s+estate/i,
    /\bhpi\b/i,
    /\bhousing\b/i,
    /unsold\s+inventory/i,
    /property\s+price/i,
    /launches/i,
    /absorption/i,
    /vacancy/i,
    /\breit\b/i,
  ],
  policy: [
    /repo\s+rate/i,
    /\brbi\b.*rate/i,
    /\bfed\b.*rate/i,
    /rate\s+(cut|hike|pause|cutting|hiking)/i,
    /policy\s+rate/i,
    /monetary\s+polic/i,
    /\becb\b/i,
    /\bboj\b/i,
  ],
  capex: [
    /\bcapex\b/i,
    /capital\s+goods/i,
    /investment\s+cycle/i,
    /cement\s+dispatch/i,
    /private\s+capex/i,
    /order\s+book/i,
  ],
  global_macro: [
    /\bchina\b/i,
    /\beurozone\b/i,
    /\beurope\b/i,
    /global\s+(macro|liquidity|pmi)/i,
    /taper/i,
    /yen\s+carry/i,
  ],
};

/**
 * Approximate slug → theme mapping, used when scoring candidates for
 * novelty penalty. Derived from the indicator's section + keywords.
 */
const SLUG_TO_THEMES = {
  // Credit
  cd_ratio: ['credit_deposit'],
  bank_credit_growth: ['credit_deposit'],
  deposit_growth: ['credit_deposit'],
  nbfc_credit_growth: ['credit_deposit'],
  corp_bond_issuance: ['credit_deposit'],

  // Inflation
  cpi_headline: ['inflation'],
  cpi_core: ['inflation'],
  cfpi_food: ['inflation'],
  wpi: ['inflation'],
  fuel_inflation: ['inflation'],
  rbi_inflation_forecast: ['inflation', 'policy'],

  // Currency
  inr_usd: ['currency'],
  rbi_fx_reserves: ['currency'],
  dxy: ['currency', 'global_macro'],

  // Oil
  brent_usd: ['oil'],
  wti_usd: ['oil'],
  brent_usd_global: ['oil'],
  nat_gas: ['oil'],

  // Markets
  nifty50: ['markets'],
  sensex: ['markets'],
  bank_nifty: ['markets'],
  india_vix: ['markets'],
  us_vix: ['markets', 'global_macro'],
  sp500: ['markets', 'global_macro'],
  nasdaq: ['markets', 'global_macro'],

  // GDP / growth
  india_gdp_yoy: ['gdp_growth'],
  india_gdp_fy_estimate: ['gdp_growth'],
  pmi_mfg: ['gdp_growth'],
  pmi_services: ['gdp_growth'],
  pmi_composite: ['gdp_growth'],
  iip_yoy: ['gdp_growth'],
  iip_capgoods: ['gdp_growth', 'capex'],
  capacity_utilisation: ['gdp_growth', 'capex'],
  core_sector_yoy: ['gdp_growth'],

  // Consumption
  gst_month: ['consumption'],
  gst_ytd: ['consumption'],
  pv_sales: ['consumption'],
  '2w_sales': ['consumption'],
  cv_sales: ['consumption'],
  airline_pax: ['consumption'],
  ecom_gmv_growth: ['consumption'],

  // Flows
  fii_equity_net: ['flows'],
  dii_equity_net: ['flows'],
  sip_inflows: ['flows'],
  sip_yoy_growth: ['flows'],
  mf_aum: ['flows'],
  equity_mf_net: ['flows'],

  // Policy
  rbi_repo_rate: ['policy'],
  fed_funds_rate: ['policy', 'global_macro'],
  ecb_deposit_rate: ['policy', 'global_macro'],
  boj_rate: ['policy', 'global_macro'],
  us_10y_treasury: ['policy', 'global_macro'],
  gsec_10y: ['policy'],

  // Real estate
  re_launches_units: ['real_estate'],
  re_sales_units: ['real_estate'],
  re_unsold_inventory: ['real_estate'],
  hpi_mumbai: ['real_estate'],
  hpi_delhi: ['real_estate'],
  hpi_bengaluru: ['real_estate'],
  hpi_hyderabad: ['real_estate'],
  affordability_index: ['real_estate'],
  office_vacancy: ['real_estate'],
  retail_mall_vacancy: ['real_estate'],

  // Global
  us_gdp_saar: ['global_macro'],
  china_gdp: ['global_macro'],
  ez_gdp: ['global_macro'],
  us_cpi: ['global_macro', 'inflation'],
  china_cpi: ['global_macro', 'inflation'],
};

// ──────────────────────────────────────────────────────────────
// History persistence
// ──────────────────────────────────────────────────────────────

/**
 * Load the hook history from disk. Returns an object with shape:
 *   { entries: [{ date, verdict_line, themes: [...], slugs: [...] }] }
 * Empty history is returned if the file does not yet exist.
 */
export function loadHookHistory() {
  if (!existsSync(HISTORY_PATH)) {
    return { entries: [] };
  }
  try {
    const raw = readFileSync(HISTORY_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed.entries || !Array.isArray(parsed.entries)) return { entries: [] };
    return parsed;
  } catch {
    return { entries: [] };
  }
}

/**
 * Append a new hook entry to history. Keeps only the last 30 entries to
 * prevent unbounded growth. Commits the file via GitPublisher as part of
 * the normal pipeline commit.
 */
export function recordHook(date, verdictLine, referencedSlugs = []) {
  const history = loadHookHistory();
  const themes = extractThemes(verdictLine);
  const slugs = Array.from(new Set([
    ...referencedSlugs,
    ...extractSlugMentions(verdictLine),
  ]));

  // Drop any existing entry for the same date (idempotent re-runs)
  history.entries = history.entries.filter(e => e.date !== date);
  history.entries.push({ date, verdict_line: verdictLine, themes, slugs });

  // Keep last 30 entries only
  history.entries = history.entries.slice(-30);

  const dir = dirname(HISTORY_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));
  return history;
}

// ──────────────────────────────────────────────────────────────
// Theme + slug extraction
// ──────────────────────────────────────────────────────────────

/**
 * Extract the set of themes mentioned in a verdict line. Returns an array
 * of theme keys (e.g. ['credit_deposit', 'policy']).
 */
export function extractThemes(text) {
  if (!text) return [];
  const matched = new Set();
  for (const [theme, patterns] of Object.entries(THEME_KEYWORDS)) {
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        matched.add(theme);
        break;
      }
    }
  }
  return Array.from(matched);
}

/**
 * Extract indicator slugs referenced in a verdict line by matching the
 * indicator display name (fuzzy / case-insensitive). Used for slug-level
 * novelty tracking alongside theme-level tracking.
 */
export function extractSlugMentions(text) {
  if (!text) return [];
  const lowered = text.toLowerCase();
  const mentioned = [];
  for (const [slug, schema] of Object.entries(INDICATOR_SCHEMA)) {
    const name = schema.name.toLowerCase();
    // Match by full name OR by the slug's themes keyword list
    if (lowered.includes(name)) {
      mentioned.push(slug);
      continue;
    }
  }
  return mentioned;
}

// ──────────────────────────────────────────────────────────────
// Recency queries
// ──────────────────────────────────────────────────────────────

/**
 * Get the entries within the last N days (inclusive).
 */
function recentEntries(history, days) {
  const n = Math.max(1, Math.min(history.entries.length, days));
  return history.entries.slice(-n);
}

/**
 * Themes mentioned in the last N days (deduplicated).
 */
export function getRecentThemes(history, days = 7) {
  const themes = new Set();
  for (const e of recentEntries(history, days)) {
    for (const t of (e.themes || [])) themes.add(t);
  }
  return Array.from(themes);
}

/**
 * Slugs referenced in the last N days (deduplicated).
 */
export function getRecentSlugs(history, days = 7) {
  const slugs = new Set();
  for (const e of recentEntries(history, days)) {
    for (const s of (e.slugs || [])) slugs.add(s);
  }
  return Array.from(slugs);
}

/**
 * Banned themes: themes that have appeared as the verdict theme in 2 or
 * more of the last `days` entries. These are HARD banned — the writer is
 * instructed to avoid them entirely.
 */
export function getBannedThemes(history, days = 7, maxUses = 2) {
  const counts = {};
  for (const e of recentEntries(history, days)) {
    for (const t of (e.themes || [])) {
      counts[t] = (counts[t] || 0) + 1;
    }
  }
  return Object.entries(counts)
    .filter(([, n]) => n >= maxUses)
    .map(([theme]) => theme);
}

// ──────────────────────────────────────────────────────────────
// Candidate scoring
// ──────────────────────────────────────────────────────────────

/**
 * Score each indicator on its "hook-worthiness" for today. Top candidates
 * are those that (a) moved recently, (b) have magnitude, (c) haven't been
 * the subject of a recent verdict line.
 *
 * Scoring weights:
 *   freshness × 0.40 — did this actually change today? (daily > monthly > quarterly)
 *   magnitude × 0.50 — |polarity score| from the polarity skill
 *   novelty   × 0.10 — bonus if not in recent verdicts, penalty if it is
 *
 * Flat / missing direction → 0.5× multiplier on the whole score.
 */
export function scoreHookCandidates(indicators, history) {
  const recentSlugs = getRecentSlugs(history, 7);
  const recentThemes = getRecentThemes(history, 7);
  const bannedThemes = getBannedThemes(history, 7, 2);

  const scored = [];

  for (const ind of indicators) {
    if (!isValidSignal(ind)) continue;

    const slug = ind.indicator_slug || ind.slug;
    const schema = INDICATOR_SCHEMA[slug];
    if (!schema) continue;

    // HARD FILTER: if this slug's theme is banned, exclude from candidates
    // entirely. Soft penalties were not strong enough — the writer kept
    // picking the same metric anyway. A banned theme means "not allowed as
    // hook anchor today", full stop.
    const slugThemes = SLUG_TO_THEMES[slug] || [];
    if (slugThemes.some(t => bannedThemes.includes(t))) continue;

    // HARD FILTER: quarterly indicators are excluded from candidates UNLESS
    // we have reason to believe they just updated. Today, we use a simple
    // heuristic — quarterly metrics are by default not fresh enough to be
    // the hook. (When vintage-date tracking is added, we can re-admit them
    // within a 10-day window of a new release.)
    if (schema.frequency === 'quarterly') continue;

    // Freshness by update frequency (daily > monthly)
    const freshness = schema.frequency === 'daily' ? 100 : 55;

    // Magnitude (how extreme is the reading)
    const magnitude = Math.abs(scoreIndicator(ind));

    // Novelty: +20 if unused recently, -60 if slug was used recently,
    // another -30 if any of the slug's themes is in recentThemes.
    // (Banned themes are hard-filtered above, so no penalty needed here.)
    let novelty = 20;
    if (recentSlugs.includes(slug)) novelty -= 60;
    if (slugThemes.some(t => recentThemes.includes(t))) novelty -= 30;

    // Composite
    let score = freshness * 0.40 + magnitude * 0.50 + novelty * 0.10;

    // Flat or missing direction halves the score (it's not a surprise)
    if (!ind.direction || ind.direction === 'flat') {
      score *= 0.5;
    }

    scored.push({
      slug,
      name: ind.indicator_name || schema.name,
      value: ind.latest_value ?? ind.value,
      pct_10y: ind.pct_10y,
      direction: ind.direction,
      polarity: getPolarity(slug),
      freshness,
      magnitude,
      novelty,
      themes: slugThemes,
      score: Math.round(score * 10) / 10,
    });
  }

  return scored.sort((a, b) => b.score - a.score);
}

// ──────────────────────────────────────────────────────────────
// Prompt context builder
// ──────────────────────────────────────────────────────────────

/**
 * Build the full prompt-ready context block that the ExecutiveSummaryWriter
 * injects into the Sonnet prompt before asking for today's verdict line.
 * Returns a formatted string + a manifest object for logging.
 */
export function buildHookContext(indicators, history, { topN = 12 } = {}) {
  const candidates = scoreHookCandidates(indicators, history).slice(0, topN);
  const recentEntries = history.entries.slice(-7);
  const bannedThemes = getBannedThemes(history, 7, 2);
  const recentThemes = getRecentThemes(history, 7);

  const recentBlock = recentEntries.length
    ? recentEntries.map(e => `  ${e.date}: "${e.verdict_line}"  [themes: ${(e.themes || []).join(', ') || '—'}]`).join('\n')
    : '  (no prior verdicts recorded)';

  const candidateBlock = candidates.length
    ? candidates.map((c, i) =>
        `  ${i + 1}. ${c.name} (${c.slug}): ${c.value} — ${c.direction || 'flat'}, 10y pct ${c.pct_10y}, ` +
        `polarity ${c.polarity}, score ${c.score} (fresh ${c.freshness} / mag ${c.magnitude} / nov ${c.novelty})`
      ).join('\n')
    : '  (no fresh candidates available)';

  const bannedBlock = bannedThemes.length
    ? bannedThemes.map(t => `  - ${t}`).join('\n')
    : '  (none)';

  const contextText = `── HOOK WRITER CONTEXT ──

RECENT VERDICT LINES (last 7 days — DO NOT REPEAT the themes below):
${recentBlock}

BANNED THEMES (used 2+ times in the last 7 days — absolutely avoid these):
${bannedBlock}

TOP HOOK CANDIDATES FOR TODAY (ranked by freshness × magnitude × novelty):
${candidateBlock}

RULES:
  1. Your verdict line MUST anchor on something that actually moved in the last 24–72 hours.
     Quarterly metrics (GDP, CD ratio, HPI, capacity utilisation) are BANNED unless they were
     released in the last 10 days — they did not change today.
  2. You MAY NOT repeat any theme from the "banned themes" list above.
  3. You SHOULD choose your anchor indicator from the "top hook candidates" list.
  4. If you pick a metric that is not in the candidates list, you must cite a fresh move
     (daily change, new release, surprise print) to justify it — no stale structural stories.
  5. The hook must be punchy, specific, and DIFFERENT in topic from yesterday's hook.
`;

  return {
    text: contextText,
    candidates,
    banned_themes: bannedThemes,
    recent_themes: recentThemes,
    recent_entries: recentEntries,
  };
}
