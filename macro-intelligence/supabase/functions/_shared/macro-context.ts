// Shared context-assembly for every chat-style edge function in this
// org (rabbit-hole-chat, voice-assistant-chat). This is a genuine shared
// UTILITY, not a shared AGENT — the Charter's "no skill belongs to two
// agents" is about agent responsibilities, not about re-typing the same
// Supabase query twice. The same convention already governs the Node
// side of this repo (src/utils/indicator-schema.js, polarity.js,
// banned-names.js are imported by many agents).
//
// getSignalContext / getRegimeContext were moved here unchanged from
// rabbit-hole-chat/index.ts (same queries, same shape) so the Voice
// Assistant's "go deeper" tools reach the exact same depth a reader gets
// by tapping a card on screen — literally the same function, not a
// parallel reimplementation that could drift.

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

// Private analytical anchors shared by every chat persona in this org.
// Appended to each function's own PERSONA text, not a replacement for it.
export const BANNED_NAMES_RULE = `
NEVER name Mishra, Munger, the Economist, or the FT in your replies —
these voices are private analytical anchors, not citations. Present
every conclusion as your own, unattributed. (The dashboard's validator
hard-errors on these names; every chat surface in this org holds the
same line.)`;

export const SIGNAL_THEME_TO_SLUGS: Record<string, string[]> = {
  "CREDIT CYCLE": ["cd_ratio", "bank_credit_growth", "deposit_growth", "nbfc_credit_growth", "corp_bond_issuance"],
  "CAPEX TRIGGER": ["iip_capgoods", "capacity_utilisation", "core_sector_yoy", "iip_yoy"],
  "SIP / RETAIL FLOWS": ["sip_inflows", "sip_yoy_growth", "fii_equity_net", "dii_equity_net", "mf_aum", "equity_mf_net"],
  "OIL / COMMODITY RISK": ["brent_usd", "nat_gas", "inr_usd", "copper", "iron_ore"],
  "GLOBAL LIQUIDITY": ["fed_funds_rate", "us_10y_treasury", "dxy", "ecb_deposit_rate", "sp500"],
  "INR / FX RESERVES": ["inr_usd", "rbi_fx_reserves", "fii_equity_net", "dxy", "brent_usd"],
  "UNDER THE RADAR": ["nifty50", "india_vix", "gst_month", "pmi_mfg", "cpi_headline"],
};

export const REGIME_DIM_TO_SLUGS: Record<string, string[]> = {
  growth: ["india_gdp_yoy", "pmi_mfg", "pmi_services", "iip_yoy", "core_sector_yoy", "capacity_utilisation"],
  inflation: ["cpi_headline", "cpi_core", "cfpi_food", "wpi", "fuel_inflation", "rbi_repo_rate"],
  credit: ["bank_credit_growth", "deposit_growth", "cd_ratio", "nbfc_credit_growth", "corp_bond_issuance"],
  policy: ["rbi_repo_rate", "rbi_inflation_forecast", "gsec_10y", "fed_funds_rate", "us_10y_treasury"],
  capex: ["iip_capgoods", "capacity_utilisation", "core_sector_yoy", "pmi_mfg"],
  consumption: ["gst_month", "gst_ytd", "pv_sales", "airline_pax", "ecom_gmv_growth"],
};

export function getDateDaysAgo(isoDate: string, days: number): string {
  const d = new Date(isoDate);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

async function latestIndicatorContext(
  supabase: SupabaseClient, slugs: string[], runDate: string,
): Promise<string> {
  if (!slugs.length) return "No related indicators available.";
  const { data: history } = await supabase
    .from("macro_indicators")
    .select("indicator_slug, latest_numeric, direction, pct_10y, run_date")
    .in("indicator_slug", slugs)
    .gte("run_date", getDateDaysAgo(runDate, 30))
    .order("run_date", { ascending: false });

  const latestBySlug: Record<string, any> = {};
  for (const row of (history || [])) {
    if (!latestBySlug[row.indicator_slug]) latestBySlug[row.indicator_slug] = row;
  }
  const lines = Object.entries(latestBySlug)
    .map(([slug, row]: [string, any]) => `${slug}: ${row.latest_numeric} (${row.direction}, 10y pct: ${row.pct_10y}%)`)
    .join("\n");
  return lines || "No related indicators available.";
}

export async function getSignalContext(
  supabase: SupabaseClient, signalNum: number, runDate: string,
): Promise<string> {
  const { data: signal } = await supabase
    .from("signal_cards")
    .select("*")
    .eq("run_date", runDate)
    .eq("signal_num", signalNum)
    .single();

  if (!signal) return "Signal data not found for this date.";

  const relatedSlugs = SIGNAL_THEME_TO_SLUGS[signal.signal_theme] || [];
  const indicatorContext = await latestIndicatorContext(supabase, relatedSlugs, runDate);

  return `SIGNAL #${signal.signal_num}: ${signal.signal_theme}
Status: ${signal.status}
Title: ${signal.title}

DATA:
${signal.data_text}

IMPLICATION:
${signal.implication}

Percentile (10y): ${signal.pct_10y}%
Context: ${signal.pct_note || "—"}

RELATED INDICATORS (latest values):
${indicatorContext}`;
}

export async function getRegimeContext(
  supabase: SupabaseClient, dimension: string, runDate: string,
): Promise<string> {
  const { data: regime } = await supabase
    .from("regime_classification")
    .select("*")
    .eq("run_date", runDate)
    .eq("dimension", dimension)
    .single();

  if (!regime) return "Regime data not found for this date.";

  const relatedSlugs = REGIME_DIM_TO_SLUGS[dimension] || [];
  const indicatorContext = await latestIndicatorContext(supabase, relatedSlugs, runDate);

  return `REGIME: ${dimension.toUpperCase()}
Classification: ${regime.badge_label || "unclassified"}
Metrics: ${regime.metric_summary}

ANALYSIS:
${regime.signal_text}

CONTRIBUTING INDICATORS (latest values):
${indicatorContext}`;
}

/** Strip HTML tags down to plain text for an LLM prompt (not for speech — see the Node-side speech-format skill for that). */
function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return String(html).replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim();
}

/**
 * The whole published day, assembled fresh for the Voice Assistant: all
 * six regimes, all seven signals, the five-section executive summary,
 * the segmented real-estate view, and the headline indicators. This is
 * deliberately NOT scoped to one card — see Persona.md for why a voice
 * conversation in a car cannot start from a pre-tapped entry_id the way
 * the Rabbit Hole Analyst does.
 */
export async function getFullDayContext(supabase: SupabaseClient, runDate: string): Promise<string> {
  const [{ data: run }, { data: regimes }, { data: signals }, { data: execSummary }, { data: segments }, { data: indicators }] =
    await Promise.all([
      supabase.from("dashboard_runs").select("*").eq("run_date", runDate).maybeSingle(),
      supabase.from("regime_classification").select("dimension, badge_label, metric_summary, signal_text").eq("run_date", runDate),
      supabase.from("signal_cards").select("signal_num, signal_theme, status, title, data_text, implication, pct_10y").eq("run_date", runDate).order("signal_num"),
      supabase.from("executive_summary").select("para_num, para_label, para_html").eq("run_date", runDate).order("para_num"),
      supabase.from("real_estate_segments").select("*").eq("run_date", runDate).maybeSingle(),
      supabase.from("macro_indicators").select("indicator_slug, indicator_name, latest_value, direction, pct_10y").eq("run_date", runDate),
    ]);

  if (!run) {
    return `No published edition found for ${runDate}. Tell the user this date has no data rather than guessing.`;
  }

  const regimeBlock = (regimes || [])
    .map((r: any) => `${r.dimension.toUpperCase()}: ${r.badge_label} — ${r.metric_summary}. ${r.signal_text}`)
    .join("\n\n");

  const signalBlock = (signals || [])
    .map((s: any) => `Sig${s.signal_num} [${s.status}] ${s.title} (${s.pct_10y}th pct) — ${s.data_text} So what: ${s.implication}`)
    .join("\n\n");

  const execBlock = (execSummary || [])
    .map((p: any) => `${p.para_label}: ${stripHtml(p.para_html)}`)
    .join("\n\n");

  const segBlock = segments
    ? `NRI buying: ${segments.nri_direction} (${segments.nri_share_pct ?? "—"}% of purchases, ${segments.nri_share_delta_pp ?? "—"} pp change). ${segments.narrative || ""}`
    : "No segmented real-estate data for this date.";

  // Keep the indicator dump bounded — the full table is ~115 rows and
  // most never come up in conversation. Indicators with an extreme
  // percentile are the ones a question is actually likely to probe.
  const notable = (indicators || [])
    .filter((i: any) => typeof i.pct_10y === "number" && (i.pct_10y <= 15 || i.pct_10y >= 85))
    .map((i: any) => `${i.indicator_name}: ${i.latest_value} (${i.pct_10y}th percentile, ${i.direction})`)
    .join("\n");

  return `DATE: ${runDate}
TODAY'S HEADLINE: ${run.snap_verdict || "—"}

REGIME CLASSIFICATION (all six dimensions):
${regimeBlock || "Not available."}

SIGNALS (ranked by the day's analysis):
${signalBlock || "Not available."}

EXECUTIVE SUMMARY (five sections):
${execBlock || "Not available."}

REAL ESTATE — SEGMENTED VIEW:
${segBlock}

NOTABLE INDICATORS (10-year extreme, ≤15th or ≥85th percentile):
${notable || "None flagged as extreme today."}`;
}
