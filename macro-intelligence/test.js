#!/usr/bin/env node
/**
 * MacroIntelligence Corp — Pre-flight Test Suite
 *
 * Runs before every pipeline execution. Zero LLM cost.
 * Catches schema inconsistencies, normalizer bugs, and render issues
 * before they burn API credits.
 *
 * Usage: node test.js
 * Exit code 0 = all pass, 1 = failures found
 */

import { INDICATOR_SCHEMA, SLUG_MAP, HISTORICAL_RANGES, INDICATOR_FRESHNESS, INVERSE_INDICATORS, VALID_SLUGS } from './src/utils/indicator-schema.js';
import { normalizeValue, normalizeAllIndicators } from './src/utils/unit-normalizer.js';
import { classifyAll } from './agents/Analysis/RegimeClassifier/skills/regime-logic.js';
import { row, fillId, fillTbody } from './agents/Production/DashboardRenderer/skills/template-filler.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let pass = 0;
let fail = 0;
let section = '';

function describe(name) {
  section = name;
  console.log(`\n── ${name} ──`);
}

function assert(condition, msg) {
  if (condition) {
    pass++;
  } else {
    fail++;
    console.error(`  ✗ FAIL: ${msg}`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// 1. SCHEMA INTEGRITY
// ═══════════════════════════════════════════════════════════════════
describe('Schema Integrity');

const schemaKeys = Object.keys(INDICATOR_SCHEMA);
assert(schemaKeys.length === 97, `Expected 97 indicators, got ${schemaKeys.length}`);

const REQUIRED_FIELDS = ['name', 'section', 'sub_section', 'unit', 'unit_desc', 'data_type', 'expected_range', 'p50', 'inverse', 'frequency'];
const VALID_DATA_TYPES = new Set(['percentage', 'index', 'currency', 'count', 'ratio', 'price']);
const VALID_FREQUENCIES = new Set(['daily', 'monthly', 'quarterly']);
const VALID_SECTIONS = new Set(['S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9']);

for (const [slug, def] of Object.entries(INDICATOR_SCHEMA)) {
  for (const field of REQUIRED_FIELDS) {
    assert(def[field] !== undefined && def[field] !== null, `${slug} missing required field: ${field}`);
  }
  assert(VALID_DATA_TYPES.has(def.data_type), `${slug} invalid data_type: ${def.data_type}`);
  assert(VALID_FREQUENCIES.has(def.frequency), `${slug} invalid frequency: ${def.frequency}`);
  assert(VALID_SECTIONS.has(def.section), `${slug} invalid section: ${def.section}`);
  assert(typeof def.inverse === 'boolean', `${slug} inverse must be boolean, got ${typeof def.inverse}`);
  assert(Array.isArray(def.expected_range) && def.expected_range.length === 2, `${slug} expected_range must be [min, max]`);
  assert(def.expected_range[0] < def.expected_range[1], `${slug} range min (${def.expected_range[0]}) must be < max (${def.expected_range[1]})`);
  assert(def.p50 >= def.expected_range[0] && def.p50 <= def.expected_range[1], `${slug} p50 (${def.p50}) must be within expected_range [${def.expected_range}]`);
}

// ═══════════════════════════════════════════════════════════════════
// 2. DERIVED EXPORTS CONSISTENCY
// ═══════════════════════════════════════════════════════════════════
describe('Derived Exports');

assert(Object.keys(SLUG_MAP).length === 97, `SLUG_MAP should have 97 entries, got ${Object.keys(SLUG_MAP).length}`);
assert(Object.keys(HISTORICAL_RANGES).length === 97, `HISTORICAL_RANGES should have 97 entries, got ${Object.keys(HISTORICAL_RANGES).length}`);
assert(Object.keys(INDICATOR_FRESHNESS).length === 97, `INDICATOR_FRESHNESS should have 97 entries, got ${Object.keys(INDICATOR_FRESHNESS).length}`);
assert(VALID_SLUGS.length === 97, `VALID_SLUGS should have 97 entries, got ${VALID_SLUGS.length}`);
assert(INVERSE_INDICATORS.size > 20, `INVERSE_INDICATORS should have 20+ entries, got ${INVERSE_INDICATORS.size}`);

// Every schema slug must appear in all derived exports
for (const slug of schemaKeys) {
  assert(SLUG_MAP[slug] !== undefined, `${slug} missing from SLUG_MAP`);
  assert(HISTORICAL_RANGES[slug] !== undefined, `${slug} missing from HISTORICAL_RANGES`);
  assert(INDICATOR_FRESHNESS[slug] !== undefined, `${slug} missing from INDICATOR_FRESHNESS`);
  assert(VALID_SLUGS.includes(slug), `${slug} missing from VALID_SLUGS`);
}

// SLUG_MAP fields
for (const [slug, meta] of Object.entries(SLUG_MAP)) {
  assert(meta.section, `SLUG_MAP[${slug}] missing section`);
  assert(meta.indicator_name, `SLUG_MAP[${slug}] missing indicator_name`);
  assert(meta.unit, `SLUG_MAP[${slug}] missing unit`);
}

// HISTORICAL_RANGES structure
for (const [slug, range] of Object.entries(HISTORICAL_RANGES)) {
  assert(typeof range.min === 'number', `HISTORICAL_RANGES[${slug}] missing min`);
  assert(typeof range.max === 'number', `HISTORICAL_RANGES[${slug}] missing max`);
  assert(typeof range.p50 === 'number', `HISTORICAL_RANGES[${slug}] missing p50`);
  assert(range.min < range.max, `HISTORICAL_RANGES[${slug}] min >= max`);
}

// ═══════════════════════════════════════════════════════════════════
// 3. UNIT NORMALIZER
// ═══════════════════════════════════════════════════════════════════
describe('Unit Normalizer');

// GST monthly: 20064 (hundreds of crore) → should be corrected to 200640
const gstResult = normalizeValue('gst_month', 20064);
assert(gstResult.corrected === true, `gst_month 20064 should be corrected`);
assert(gstResult.value === 200640, `gst_month 20064 should become 200640, got ${gstResult.value}`);

// GST YTD: 222709 → should be corrected
const gstYtdResult = normalizeValue('gst_ytd', 222709);
assert(gstYtdResult.corrected === true, `gst_ytd 222709 should be corrected`);
assert(gstYtdResult.value === 2227090, `gst_ytd 222709 should become 2227090, got ${gstYtdResult.value}`);

// INR/USD inverted: 0.0108 → ~92.59
const inrResult = normalizeValue('inr_usd', 0.0108);
assert(inrResult.corrected === true, `inr_usd 0.0108 should be corrected (inverted)`);
assert(inrResult.value > 90 && inrResult.value < 95, `inr_usd should be ~92.59, got ${inrResult.value}`);

// HPI wrong metric: 5.9 (YoY %) → should be discarded (null)
const hpiResult = normalizeValue('hpi_mumbai', 5.9);
assert(hpiResult.corrected === true, `hpi_mumbai 5.9 should be corrected`);
assert(hpiResult.value === null, `hpi_mumbai 5.9 should be discarded (null), got ${hpiResult.value}`);

// Gold INR/gram: 2 → should be corrected to 20
const goldResult = normalizeValue('gold_inr_gram', 2);
assert(goldResult.corrected === true, `gold_inr_gram 2 should be corrected`);

// Unsold inventory: 601 (in thousands) → should be corrected to 601000
const invResult = normalizeValue('re_unsold_inventory', 601);
assert(invResult.corrected === true, `re_unsold_inventory 601 should be corrected`);
assert(invResult.value === 601000, `re_unsold_inventory should become 601000, got ${invResult.value}`);

// Corp bond: 6051 → 605100
const corpResult = normalizeValue('corp_bond_issuance', 6051);
assert(corpResult.corrected === true, `corp_bond_issuance 6051 should be corrected`);

// Normal value should NOT be corrected
const niftyResult = normalizeValue('nifty50', 23000);
assert(niftyResult.corrected === false, `nifty50 23000 should not be corrected`);
assert(niftyResult.value === 23000, `nifty50 should remain 23000`);

// Null input should pass through
const nullResult = normalizeValue('cpi_headline', null);
assert(nullResult.corrected === false, `null value should not be corrected`);

// normalizeAllIndicators batch test
const mockIndicators = {
  gst_month: { value: 20064, value_str: '20064' },
  nifty50: { value: 23000, value_str: '23000' },
  inr_usd: { value: 0.0108, value_str: '0.0108' },
};
const batchResult = normalizeAllIndicators(mockIndicators);
assert(batchResult.corrected === 2, `Batch should correct 2 indicators, got ${batchResult.corrected}`);
assert(mockIndicators.gst_month.value === 200640, `Batch: gst_month should be 200640`);
assert(mockIndicators.nifty50.value === 23000, `Batch: nifty50 should remain 23000`);

// ═══════════════════════════════════════════════════════════════════
// 4. REGIME CLASSIFIER (PURE CODE)
// ═══════════════════════════════════════════════════════════════════
describe('Regime Classifier');

const mockIndicatorsRegime = {
  india_gdp_yoy: { value: 7.8 },
  pmi_composite: { value: 56.2 },
  cpi_headline: { value: 3.2 },
  fuel_inflation: { value: 2.1 },
  bank_credit_growth: { value: 14.3 },
  cd_ratio: { value: 83.04 },
  rbi_repo_rate: { value: 6.0, previous: 6.25 },
  iip_capgoods: { value: 12.3 },
  capacity_utilisation: { value: 76.2 },
  gst_month: { value: 200000 },
  pv_sales: { value: 15 },
};

const regimeResult = classifyAll(mockIndicatorsRegime);
assert(regimeResult.length === 6, `classifyAll should return 6 dimensions, got ${regimeResult.length}`);

const VALID_BADGE_TYPES = new Set(['b-exp', 'b-slow', 'b-risk', 'b-neu']);
for (const r of regimeResult) {
  assert(VALID_BADGE_TYPES.has(r.badge_type), `${r.dimension} invalid badge_type: ${r.badge_type}`);
  assert(r.metric_summary && r.metric_summary.length > 0, `${r.dimension} missing metric_summary`);
  assert(r.dimension, `Regime entry missing dimension`);
}

// CD ratio > 80 should trigger risk
const creditRegime = regimeResult.find(r => r.dimension === 'credit');
assert(creditRegime.badge_type === 'b-risk', `CD ratio 83.04 should be b-risk, got ${creditRegime.badge_type}`);

// Growth with GDP 7.8 + PMI 56.2 should be expansion
const growthRegime = regimeResult.find(r => r.dimension === 'growth');
assert(growthRegime.badge_type === 'b-exp', `GDP 7.8 + PMI 56.2 should be b-exp, got ${growthRegime.badge_type}`);

// Policy with rate cut (6.0 from 6.25) should be easing
const policyRegime = regimeResult.find(r => r.dimension === 'policy');
assert(policyRegime.badge_type === 'b-exp', `Rate cut 6.25→6.0 should be b-exp (easing), got ${policyRegime.badge_type}`);

// ═══════════════════════════════════════════════════════════════════
// 5. TEMPLATE FILLER
// ═══════════════════════════════════════════════════════════════════
describe('Template Filler');

// Normal indicator row
const normalRow = row('Nifty 50', '23000', '22800', 'up', '↑ +0.88%', 72, 'mid', 'nifty50');
assert(normalRow.includes('arr up'), `Normal up arrow should have class "arr up"`);
assert(normalRow.includes('pct-mid'), `Mid tier should have class "pct-mid"`);

// Inverse indicator row (cd_ratio — up is bad)
const inverseRow = row('CD Ratio', '83.04', '82.5', 'up', '↑ +0.65%', 92, 'hi', 'cd_ratio');
assert(inverseRow.includes('arr dn'), `Inverse up arrow should have class "arr dn" (red)`);
assert(inverseRow.includes('pct-lo'), `Inverse hi tier should have class "pct-lo" (red)`);

// Inverse indicator down is good
const inverseDownRow = row('CPI Headline', '4.2', '5.1', 'down', '↓ -17.6%', 30, 'lo', 'cpi_headline');
assert(inverseDownRow.includes('arr up'), `Inverse down arrow should have class "arr up" (green)`);
assert(inverseDownRow.includes('pct-hi'), `Inverse lo tier should have class "pct-hi" (green)`);

// fillId with dollar signs (the old $ backreference bug)
const testHtml = '<span id="test-val">placeholder</span>';
const filled = fillId(testHtml, 'test-val', 'Brent $109.32 | DXY 99.92');
assert(filled.includes('Brent $109.32'), `fillId should preserve dollar amounts`);
// The content between > and </ should be the new value, not contain duplicate id=
const filledContent = filled.match(/id="test-val"[^>]*>([\s\S]*?)<\//)?.[1] || '';
assert(!filledContent.includes('id='), `fillId content should not contain leaked id= attribute`);

// fillId with backreference-like patterns
const testHtml2 = '<span id="exec-01">old</span>';
const filled2 = fillId(testHtml2, 'exec-01', 'WTI $14.88/bbl at the 98th percentile');
assert(filled2.includes('$14.88'), `fillId should handle $14 without backreference`);
const filled2Content = filled2.match(/id="exec-01"[^>]*>([\s\S]*?)<\//)?.[1] || '';
assert(!filled2Content.includes('id='), `fillId exec content should not contain leaked id=`);

// ═══════════════════════════════════════════════════════════════════
// 6. TEMPLATE HTML INTEGRITY
// ═══════════════════════════════════════════════════════════════════
describe('Template HTML');

let template;
try {
  template = readFileSync(join(__dirname, 'template', 'macro-intelligence-light.html'), 'utf-8');
  assert(template.length > 50000, `Template should be > 50KB, got ${template.length}`);
} catch {
  assert(false, 'Template file not found at template/macro-intelligence-light.html');
  template = '';
}

if (template) {
  // Key element IDs must exist
  const requiredIds = [
    'snap-verdict', 'snap-india', 'snap-global', 'snap-risk',
    'header-date', 'footer-date', 's1-badge', 's1-summary',
    'sig1-title', 'sig2-title', 'sig3-title', 'sig4-title',
    'sig5-title', 'sig6-title', 'sig7-title',
    'exec-01', 'exec-02', 'exec-03', 'exec-04', 'exec-05',
    'sc-base-name', 'sc-bull-name', 'sc-bear-name',
    'cost-tag',
  ];
  for (const id of requiredIds) {
    assert(template.includes(`id="${id}"`), `Template missing element id="${id}"`);
  }

  // Regime card IDs
  for (const dim of ['growth', 'infl', 'credit', 'policy', 'capex', 'cons']) {
    assert(template.includes(`id="rc-${dim}-m"`), `Template missing regime card rc-${dim}-m`);
  }

  // Tbody IDs for data tables
  for (const tbody of ['s2-body', 's3-body', 's4-body', 's5-body', 's6-body', 's7-body', 's8-growth', 's8-inflation', 's8-liquidity', 's8-markets', 's10-residential', 's10-commercial']) {
    assert(template.includes(`id="${tbody}"`), `Template missing tbody id="${tbody}"`);
  }

  // No Supabase upload button element (JS function may still exist in script)
  assert(!template.includes('onclick="supabaseUpload()"'), `Template should not contain Supabase upload button element`);

  // __MACRO_DATA__ scaffold
  assert(template.includes('__MACRO_DATA__'), `Template should contain __MACRO_DATA__ scaffold`);
}

// ═══════════════════════════════════════════════════════════════════
// 7. INVERSE INDICATOR COVERAGE
// ═══════════════════════════════════════════════════════════════════
describe('Inverse Indicators');

// These must be inverse (higher = worse)
const MUST_BE_INVERSE = [
  'cd_ratio', 'india_vix', 'us_vix', 'cpi_headline', 'cpi_core',
  'rbi_repo_rate', 'fed_funds_rate', 'dxy', 'brent_usd',
  're_unsold_inventory', 'office_vacancy', 'affordability_index',
];
for (const slug of MUST_BE_INVERSE) {
  assert(INVERSE_INDICATORS.has(slug), `${slug} must be in INVERSE_INDICATORS`);
  assert(INDICATOR_SCHEMA[slug]?.inverse === true, `${slug} must have inverse=true in schema`);
}

// These must NOT be inverse (higher = better)
const MUST_NOT_BE_INVERSE = [
  'nifty50', 'sensex', 'india_gdp_yoy', 'pmi_mfg', 'sip_inflows',
  'bank_credit_growth', 'sp500', 'gold_usd',
];
for (const slug of MUST_NOT_BE_INVERSE) {
  assert(!INVERSE_INDICATORS.has(slug), `${slug} must NOT be in INVERSE_INDICATORS`);
  assert(INDICATOR_SCHEMA[slug]?.inverse === false, `${slug} must have inverse=false in schema`);
}

// ═══════════════════════════════════════════════════════════════════
// 8. FREQUENCY CONSISTENCY
// ═══════════════════════════════════════════════════════════════════
describe('Frequency Rules');

// Daily indicators
const MUST_BE_DAILY = ['nifty50', 'sensex', 'inr_usd', 'gold_usd', 'sp500', 'us_vix', 'dxy'];
for (const slug of MUST_BE_DAILY) {
  assert(INDICATOR_FRESHNESS[slug] === 'daily', `${slug} should be daily, got ${INDICATOR_FRESHNESS[slug]}`);
}

// Monthly indicators
const MUST_BE_MONTHLY = ['cpi_headline', 'pmi_mfg', 'gst_month', 'us_cpi', 'fii_equity_net'];
for (const slug of MUST_BE_MONTHLY) {
  assert(INDICATOR_FRESHNESS[slug] === 'monthly', `${slug} should be monthly, got ${INDICATOR_FRESHNESS[slug]}`);
}

// Quarterly indicators
const MUST_BE_QUARTERLY = ['india_gdp_yoy', 'capacity_utilisation', 'hpi_mumbai', 're_sales_units'];
for (const slug of MUST_BE_QUARTERLY) {
  assert(INDICATOR_FRESHNESS[slug] === 'quarterly', `${slug} should be quarterly, got ${INDICATOR_FRESHNESS[slug]}`);
}

// Count by frequency
const dailyCount = Object.values(INDICATOR_FRESHNESS).filter(f => f === 'daily').length;
const monthlyCount = Object.values(INDICATOR_FRESHNESS).filter(f => f === 'monthly').length;
const quarterlyCount = Object.values(INDICATOR_FRESHNESS).filter(f => f === 'quarterly').length;
assert(dailyCount + monthlyCount + quarterlyCount === 97, `Frequency counts should sum to 97, got ${dailyCount + monthlyCount + quarterlyCount}`);

// ═══════════════════════════════════════════════════════════════════
// 9. VOICE BROADCASTER
// ═══════════════════════════════════════════════════════════════════
describe('Voice Broadcaster');

// Persona file exists
import { existsSync } from 'fs';
const voicePersonaPath = join(__dirname, 'agents', 'Production', 'VoiceBroadcaster', 'Persona.md');
assert(existsSync(voicePersonaPath), 'VoiceBroadcaster Persona.md must exist');

const voicePersona = readFileSync(voicePersonaPath, 'utf-8');
assert(voicePersona.includes('60-second'), 'Voice persona must mention 60-second format');
assert(voicePersona.includes('Act 1') && voicePersona.includes('Act 2') && voicePersona.includes('Act 3'), 'Voice persona must define 3 acts');
assert(voicePersona.includes('Good morning from MacroIntelligence'), 'Voice persona must define opening line');
assert(voicePersona.includes('sixty-second macro'), 'Voice persona must define closing line');

// broadcast.js exists and exports VoiceBroadcaster
const broadcastPath = join(__dirname, 'agents', 'Production', 'VoiceBroadcaster', 'broadcast.js');
assert(existsSync(broadcastPath), 'broadcast.js must exist');

// TTS skill exists
const ttsPath = join(__dirname, 'agents', 'Production', 'VoiceBroadcaster', 'skills', 'tts-api.js');
assert(existsSync(ttsPath), 'tts-api.js must exist');

// Template has audio player
if (template) {
  assert(template.includes('id="audio-panel"'), 'Template must have audio panel');
  assert(template.includes('id="macro-audio"'), 'Template must have audio element');
  assert(template.includes('60-SECOND MACRO'), 'Template must have 60-SECOND MACRO button text');
  assert(template.includes('toggleAudio'), 'Template must have toggleAudio function');
  assert(template.includes('daily-broadcast.mp3'), 'Template must reference daily-broadcast.mp3');
}

// ═══════════════════════════════════════════════════════════════════
// 10. TELEGRAM PUBLISHER
// ═══════════════════════════════════════════════════════════════════
describe('Telegram Publisher');

const telegramPersonaPath = join(__dirname, 'agents', 'Infrastructure', 'TelegramPublisher', 'Persona.md');
assert(existsSync(telegramPersonaPath), 'TelegramPublisher Persona.md must exist');

const telegramPublishPath = join(__dirname, 'agents', 'Infrastructure', 'TelegramPublisher', 'publish.js');
assert(existsSync(telegramPublishPath), 'TelegramPublisher publish.js must exist');

const summaryCardPath = join(__dirname, 'agents', 'Infrastructure', 'TelegramPublisher', 'skills', 'summary-card.js');
assert(existsSync(summaryCardPath), 'summary-card.js must exist');

const screenshotPath = join(__dirname, 'agents', 'Infrastructure', 'TelegramPublisher', 'skills', 'screenshot.js');
assert(existsSync(screenshotPath), 'screenshot.js must exist');

const telegramApiPath = join(__dirname, 'agents', 'Infrastructure', 'TelegramPublisher', 'skills', 'telegram-api.js');
assert(existsSync(telegramApiPath), 'telegram-api.js must exist');

// Test summary card HTML generation
import { generateCardHTML } from './agents/Infrastructure/TelegramPublisher/skills/summary-card.js';
const mockCardData = {
  verdictLine: 'Test verdict line for card generation',
  macroDataObj: {
    indicators: [
      { indicator_slug: 'nifty50', indicator_name: 'Nifty 50', latest_value: '23000', latest_numeric: 23000, direction: 'up', pct_10y: 72 },
      { indicator_slug: 'cpi_headline', indicator_name: 'CPI', latest_value: '3.2%', latest_numeric: 3.2, direction: 'down', pct_10y: 25 },
      { indicator_slug: 'cd_ratio', indicator_name: 'CD Ratio', latest_value: '83%', latest_numeric: 83, direction: 'up', pct_10y: 92 },
      { indicator_slug: 'brent_usd', indicator_name: 'Brent', latest_value: '$99', latest_numeric: 99, direction: 'up', pct_10y: 85 },
    ],
    regime: [
      { dimension: 'growth', badge_label: 'Expansion', badge_type: 'b-exp' },
      { dimension: 'inflation', badge_label: 'Within Band', badge_type: 'b-neu' },
    ],
    signals: [],
  },
  dateStr: '09 APR 2026',
  dashboardUrl: 'https://example.com',
};
const cardHTML = generateCardHTML(mockCardData);
assert(cardHTML.includes('Test verdict line'), 'Card HTML must contain verdict line');
assert(cardHTML.includes('SURPRISING RISKS'), 'Card HTML must contain risks section');
assert(cardHTML.includes('SURPRISING STRENGTHS'), 'Card HTML must contain strengths section');
assert(cardHTML.includes('Explore Full Dashboard'), 'Card HTML must contain CTA');
assert(cardHTML.includes('https://example.com'), 'Card HTML must contain dashboard URL');
assert(cardHTML.includes('1080px'), 'Card HTML must be 1080px wide');
assert(cardHTML.includes('1350px'), 'Card HTML must be 1350px tall');
assert(cardHTML.includes('pctBadge') || cardHTML.includes('percentile') || cardHTML.includes('RISKS') || cardHTML.includes('STRENGTHS'), 'Card HTML must show risks/strengths sections');

// ═══════════════════════════════════════════════════════════════════
// 11. POLARITY SKILL — Single Source of Truth for positive/negative
// ═══════════════════════════════════════════════════════════════════
console.log('\n[11] Polarity Skill...');

import {
  getPolarity,
  isValidSignal,
  scoreIndicator,
  classifyIndicator,
  pickTopSignals,
  isInversePolarity,
  isPositiveSignal,
  isNegativeSignal,
} from './src/utils/polarity.js';

// --- getPolarity: known-positive indicators
for (const slug of ['india_gdp_yoy', 'gst_month', 'gst_ytd', 'bank_credit_growth',
                    'sip_inflows', 'nifty50', 'rbi_fx_reserves', 'sp500', 'nasdaq', 'dii_equity_net']) {
  assert(getPolarity(slug) === 'positive', `${slug} must have polarity 'positive' (got ${getPolarity(slug)})`);
}

// --- getPolarity: known-negative (inverse) indicators
for (const slug of ['cpi_headline', 'cpi_core', 'wpi', 'cd_ratio', 'inr_usd',
                    'india_vix', 'us_vix', 'brent_usd', 'dxy', 're_unsold_inventory',
                    'office_vacancy', 'affordability_index', 'fuel_inflation']) {
  assert(getPolarity(slug) === 'negative', `${slug} must have polarity 'negative' (got ${getPolarity(slug)})`);
}

// --- getPolarity: neutral overrides
for (const slug of ['gold_inr_gram', 'gold_usd', 'embassy_reit']) {
  assert(getPolarity(slug) === 'neutral', `${slug} must have polarity 'neutral' (got ${getPolarity(slug)})`);
}

// --- getPolarity: unknown slug → neutral
assert(getPolarity('nonexistent_slug') === 'neutral', 'Unknown slug must return neutral');
assert(getPolarity(null) === 'neutral', 'Null slug must return neutral');
assert(getPolarity(undefined) === 'neutral', 'Undefined slug must return neutral');

// --- isValidSignal: rejects garbage
assert(!isValidSignal(null), 'null indicator must be invalid');
assert(!isValidSignal({}), 'empty indicator must be invalid');
assert(!isValidSignal({ indicator_slug: 'gst_month' }), 'Missing value must be invalid');
assert(!isValidSignal({ indicator_slug: 'gst_month', latest_numeric: null, pct_10y: 50 }),
  'Null latest_numeric must be invalid');
assert(!isValidSignal({ indicator_slug: 'gst_month', latest_numeric: 'abc', pct_10y: 50 }),
  'NaN latest_numeric must be invalid');
assert(!isValidSignal({ indicator_slug: 'gst_month', latest_numeric: 160000 }),
  'Missing pct_10y must be invalid');

// --- isValidSignal: rejects values wildly below range (parsing bugs)
// RE Launches expected_range is [15000, 140000]; value 126 is 1000x too small
assert(!isValidSignal({ indicator_slug: 're_launches_units', latest_numeric: 126.27, pct_10y: 0, direction: 'flat' }),
  'RE Launches at 126 (1000x below min 15000) must be rejected as parsing error');
assert(!isValidSignal({ indicator_slug: 're_sales_units', latest_numeric: 101.68, pct_10y: 0, direction: 'flat' }),
  'RE Sales at 101 (1000x below min 15000) must be rejected as parsing error');
// Affordability Index expected_range is [2, 10]; value 0.61 is 3x below min
assert(!isValidSignal({ indicator_slug: 'affordability_index', latest_numeric: 0.61, pct_10y: 0, direction: 'flat' }),
  'Affordability at 0.61 (3x below min 2) must be rejected as parsing error');

// But legitimate below-range values should still pass (value close to min)
assert(isValidSignal({ indicator_slug: 'gst_month', latest_numeric: 70000, pct_10y: 0, direction: 'down' }),
  'GST at 70000 (close to min 80000) is a legit below-range value');
// And legitimate above-range values should pass too (modest overshoot)
assert(isValidSignal({ indicator_slug: 'nasdaq', latest_numeric: 23183, pct_10y: 100, direction: 'up' }),
  'Nasdaq at 23183 (just above max 22000) is a legit above-range value');

// --- isValidSignal: accepts good data
assert(isValidSignal({ indicator_slug: 'gst_month', latest_numeric: 200640, pct_10y: 75, direction: 'up' }),
  'Good data must be valid');

// --- scoreIndicator: positive polarity, high percentile → positive score
const gstHigh = { indicator_slug: 'gst_month', latest_numeric: 200640, pct_10y: 80, direction: 'up' };
assert(scoreIndicator(gstHigh) > 0,
  `GST high must score positive (got ${scoreIndicator(gstHigh)})`);
assert(scoreIndicator(gstHigh) === 60,
  `GST at pct=80 should score exactly +60 (got ${scoreIndicator(gstHigh)})`);

// --- scoreIndicator: negative polarity, high percentile → negative score
const inrWeak = { indicator_slug: 'inr_usd', latest_numeric: 93.46, pct_10y: 85, direction: 'up' };
assert(scoreIndicator(inrWeak) < 0,
  `Weak rupee must score negative (got ${scoreIndicator(inrWeak)})`);
assert(scoreIndicator(inrWeak) === -70,
  `INR/USD at pct=85 should score exactly -70 (got ${scoreIndicator(inrWeak)})`);

// --- scoreIndicator: negative polarity at LOW percentile → positive score (inflation tamed)
const cpiLow = { indicator_slug: 'cpi_headline', latest_numeric: 2.5, pct_10y: 15, direction: 'down' };
assert(scoreIndicator(cpiLow) > 0,
  `Low CPI must score positive (got ${scoreIndicator(cpiLow)})`);

// --- scoreIndicator: flat direction halves the score
const gstFlat = { indicator_slug: 'gst_month', latest_numeric: 200640, pct_10y: 80, direction: 'flat' };
assert(scoreIndicator(gstFlat) === 30, `Flat direction should halve score (got ${scoreIndicator(gstFlat)})`);

// --- scoreIndicator: neutral polarity is dampened
const goldHigh = { indicator_slug: 'gold_inr_gram', latest_numeric: 6500, pct_10y: 95, direction: 'up' };
const goldScore = scoreIndicator(goldHigh);
assert(Math.abs(goldScore) <= 30,
  `Neutral polarity max score should be ±30 (got ${goldScore})`);

// --- scoreIndicator: invalid signals always score 0
assert(scoreIndicator({}) === 0, 'Empty indicator must score 0');
assert(scoreIndicator({ indicator_slug: 'gst_month', latest_numeric: 160000, pct_10y: 0, direction: 'up' }) === 0,
  'Rejected garbage must score 0');

// --- classifyIndicator
assert(classifyIndicator(gstHigh) === 'mild-positive', `GST at +60 should be mild-positive`);
const gstStrong = { indicator_slug: 'gst_month', latest_numeric: 240000, pct_10y: 95, direction: 'up' };
assert(classifyIndicator(gstStrong) === 'strong-positive', `GST at pct=95 should be strong-positive`);
assert(classifyIndicator(inrWeak) === 'strong-negative', `INR at -70 should be strong-negative`);
assert(classifyIndicator({}) === 'unknown', 'Invalid must classify as unknown');

// --- The original bug case: GST must NEVER appear as a "surprising risk"
const bugIndicators = [
  { indicator_slug: 'gst_month', indicator_name: 'GST Collections (Month)',
    latest_value: '~2,00,640 ₹ cr', latest_numeric: 200640, pct_10y: 80, direction: 'up' },
  { indicator_slug: 'gst_ytd', indicator_name: 'GST Collections (YTD)',
    latest_value: '~22,27,096 ₹ cr', latest_numeric: 2227096, pct_10y: 85, direction: 'up' },
  { indicator_slug: 'inr_usd', indicator_name: 'INR/USD',
    latest_value: '93.46 ₹', latest_numeric: 93.46, pct_10y: 85, direction: 'up' },
  { indicator_slug: 're_unsold_inventory', indicator_name: 'Unsold Inventory',
    latest_value: '~600,000 units', latest_numeric: 600000, pct_10y: 75, direction: 'up' },
  { indicator_slug: 'nasdaq', indicator_name: 'Nasdaq',
    latest_value: '22,902.9 index', latest_numeric: 22902, pct_10y: 95, direction: 'up' },
  { indicator_slug: 'cpi_headline', indicator_name: 'CPI',
    latest_value: '5.1%', latest_numeric: 5.1, pct_10y: 55, direction: 'up' },
];

const risks = pickTopSignals(bugIndicators, 4, 'negative');
const strengths = pickTopSignals(bugIndicators, 4, 'positive');

const riskSlugs = risks.map(r => r.indicator_slug);
const strengthSlugs = strengths.map(s => s.indicator_slug);

// GST must NOT be a risk (the bug)
assert(!riskSlugs.includes('gst_month'), 'GST month must NOT be classified as a risk');
assert(!riskSlugs.includes('gst_ytd'), 'GST YTD must NOT be classified as a risk');

// GST SHOULD be a strength
assert(strengthSlugs.includes('gst_month') || strengthSlugs.includes('gst_ytd'),
  'GST should appear in strengths when at high percentile');

// INR/USD at high pct must BE a risk (rupee weakening)
assert(riskSlugs.includes('inr_usd'), 'INR/USD at high pct must be classified as a risk');

// INR/USD must NOT be a strength
assert(!strengthSlugs.includes('inr_usd'), 'INR/USD must NOT appear in strengths when weak');

// Unsold inventory rising must BE a risk
assert(riskSlugs.includes('re_unsold_inventory'),
  'Unsold inventory at high pct must be classified as a risk');

// Unsold inventory must NOT be a strength
assert(!strengthSlugs.includes('re_unsold_inventory'),
  'Unsold inventory must NOT appear in strengths');

// Nasdaq at high pct should be a strength
assert(strengthSlugs.includes('nasdaq'), 'Nasdaq at high pct should be a strength');

// --- pickTopSignals ordering: most extreme scores come first
const ranked = pickTopSignals(bugIndicators, 10, 'negative');
for (let i = 1; i < ranked.length; i++) {
  assert(scoreIndicator(ranked[i - 1]) <= scoreIndicator(ranked[i]),
    `Risks must be sorted most-negative-first at index ${i}`);
}

// --- isInversePolarity backward compat
assert(isInversePolarity('cpi_headline') === true, 'cpi_headline must be inverse polarity');
assert(isInversePolarity('gst_month') === false, 'gst_month must NOT be inverse polarity');
assert(isInversePolarity('gold_inr_gram') === false, 'gold (neutral) must not be inverse polarity');

// --- isPositiveSignal / isNegativeSignal
assert(isPositiveSignal(gstHigh) === true, 'Strong GST must be positive signal');
assert(isNegativeSignal(inrWeak) === true, 'Weak INR must be negative signal');
assert(isPositiveSignal({}) === false, 'Invalid must not be positive');
assert(isNegativeSignal({}) === false, 'Invalid must not be negative');

// ═══════════════════════════════════════════════════════════════════
// 12. HOOK WRITER SKILL — freshness + anti-repetition for verdict lines
// ═══════════════════════════════════════════════════════════════════
console.log('\n[12] Hook Writer Skill...');

import {
  extractThemes,
  extractSlugMentions,
  getRecentThemes,
  getRecentSlugs,
  getBannedThemes,
  scoreHookCandidates,
  buildHookContext,
} from './src/utils/hook-writer.js';

// --- extractThemes: known phrases
const cdRatioHook = "India's 7.8% GDP is funded by a credit-deposit gap that hasn't been this wide since pre-IL&FS.";
const cdThemes = extractThemes(cdRatioHook);
assert(cdThemes.includes('credit_deposit'), `CD ratio hook must extract credit_deposit theme (got ${cdThemes.join(',')})`);

const cpiHook = "Core CPI at 3.6% is the number RBI actually watches — the food spike is noise.";
const cpiThemes = extractThemes(cpiHook);
assert(cpiThemes.includes('inflation'), `CPI hook must extract inflation theme`);

const rupeeHook = "INR at 93.46 is the rupee's weakest print since the 2022 tightening cycle.";
const currencyThemes = extractThemes(rupeeHook);
assert(currencyThemes.includes('currency'), `Rupee hook must extract currency theme`);

const brentHook = "Brent at $92 buys the RBI a week; a $5 print tomorrow buys it a problem.";
const oilThemes = extractThemes(brentHook);
assert(oilThemes.includes('oil'), `Brent hook must extract oil theme`);

const niftyHook = "Nifty at 23,500 with India VIX at 11 is the calm before a Fed-driven repricing.";
const marketThemes = extractThemes(niftyHook);
assert(marketThemes.includes('markets'), `Nifty hook must extract markets theme`);

// --- extractThemes: empty input
assert(extractThemes('').length === 0, 'Empty string must return no themes');
assert(extractThemes(null).length === 0, 'Null must return no themes');

// --- Recency queries on a mock history
const mockHistory = {
  entries: [
    { date: '2026-04-03', verdict_line: cdRatioHook, themes: ['credit_deposit'], slugs: ['cd_ratio'] },
    { date: '2026-04-04', verdict_line: "CD ratio at 83% is still the story.", themes: ['credit_deposit'], slugs: ['cd_ratio'] },
    { date: '2026-04-05', verdict_line: cpiHook, themes: ['inflation'], slugs: ['cpi_core'] },
    { date: '2026-04-06', verdict_line: "Deposit gap widens again.", themes: ['credit_deposit'], slugs: [] },
    { date: '2026-04-07', verdict_line: rupeeHook, themes: ['currency'], slugs: ['inr_usd'] },
    { date: '2026-04-08', verdict_line: brentHook, themes: ['oil'], slugs: ['brent_usd'] },
  ],
};

const recentThemes = getRecentThemes(mockHistory, 7);
assert(recentThemes.includes('credit_deposit'), 'Recent themes must include credit_deposit');
assert(recentThemes.includes('inflation'), 'Recent themes must include inflation');
assert(recentThemes.includes('currency'), 'Recent themes must include currency');

const bannedThemes = getBannedThemes(mockHistory, 7, 2);
assert(bannedThemes.includes('credit_deposit'), 'credit_deposit must be BANNED (used 3x)');
assert(!bannedThemes.includes('oil'), 'oil must NOT be banned (used 1x)');
assert(!bannedThemes.includes('currency'), 'currency must NOT be banned (used 1x)');

// --- scoreHookCandidates: fresh daily metric beats stale quarterly metric
const mixedIndicators = [
  // Stale quarterly metric at an extreme — BANNED theme
  { indicator_slug: 'cd_ratio', indicator_name: 'CD Ratio', latest_numeric: 83, pct_10y: 90, direction: 'up' },
  // Fresh daily market move
  { indicator_slug: 'nifty50', indicator_name: 'Nifty 50', latest_numeric: 23500, pct_10y: 75, direction: 'up' },
  // Fresh daily FX
  { indicator_slug: 'inr_usd', indicator_name: 'INR/USD', latest_numeric: 93.46, pct_10y: 85, direction: 'up' },
  // Fresh daily oil (but theme is not banned)
  { indicator_slug: 'brent_usd', indicator_name: 'Brent', latest_numeric: 92, pct_10y: 70, direction: 'up' },
  // Monthly PMI
  { indicator_slug: 'pmi_mfg', indicator_name: 'PMI Manufacturing', latest_numeric: 58, pct_10y: 80, direction: 'up' },
  // Quarterly HPI (stale)
  { indicator_slug: 'hpi_mumbai', indicator_name: 'HPI Mumbai', latest_numeric: 180, pct_10y: 85, direction: 'up' },
];

const candidates = scoreHookCandidates(mixedIndicators, mockHistory);

// Banned themes AND quarterly frequency are HARD-filtered
const cdRank = candidates.findIndex(c => c.slug === 'cd_ratio');
const niftyRank = candidates.findIndex(c => c.slug === 'nifty50');
const hpiRank = candidates.findIndex(c => c.slug === 'hpi_mumbai');
assert(cdRank === -1, `Banned cd_ratio must be hard-filtered out (cd=${cdRank})`);
assert(hpiRank === -1, `Quarterly hpi_mumbai must be hard-filtered out (hpi=${hpiRank})`);
assert(niftyRank !== -1, `Fresh daily nifty50 must be a candidate (nifty=${niftyRank})`);

// --- buildHookContext: returns a well-formed context block
const ctx = buildHookContext(mixedIndicators, mockHistory, { topN: 5 });
assert(typeof ctx.text === 'string' && ctx.text.length > 200, 'Context text must be substantial');
assert(ctx.text.includes('BANNED THEMES'), 'Context must include banned themes header');
assert(ctx.text.includes('TOP HOOK CANDIDATES'), 'Context must include candidates header');
assert(ctx.text.includes('credit_deposit'), 'Context must list credit_deposit as banned');
assert(Array.isArray(ctx.candidates) && ctx.candidates.length <= 5, 'topN must cap candidates');
assert(ctx.banned_themes.includes('credit_deposit'), 'ctx.banned_themes must include credit_deposit');

// --- The regression test: the EXACT user complaint
// User said: "the concept of the credit deposit ratio of Indian banks keeps
// coming. Now, frankly, that is not going to change for three months."
// Assert: with 3 recent CD-ratio hooks in history, the scorer MUST NOT
// return cd_ratio as a top candidate, and the context MUST ban credit_deposit.
const realWorldHistory = {
  entries: [
    { date: '2026-04-05', verdict_line: "CD ratio at 83% — widest since pre-IL&FS.", themes: ['credit_deposit'], slugs: ['cd_ratio'] },
    { date: '2026-04-06', verdict_line: "Credit-deposit gap widens to 350 bps.", themes: ['credit_deposit'], slugs: ['cd_ratio'] },
    { date: '2026-04-07', verdict_line: "India's credit engine running on deposit fumes.", themes: ['credit_deposit'], slugs: ['cd_ratio'] },
    { date: '2026-04-08', verdict_line: "Deposit shortfall is the tension of the cycle.", themes: ['credit_deposit'], slugs: [] },
  ],
};
const todayIndicators = [
  { indicator_slug: 'cd_ratio', indicator_name: 'CD Ratio', latest_numeric: 83, pct_10y: 92, direction: 'up' },
  { indicator_slug: 'nifty50', indicator_name: 'Nifty 50', latest_numeric: 23500, pct_10y: 75, direction: 'up' },
  { indicator_slug: 'inr_usd', indicator_name: 'INR/USD', latest_numeric: 93.46, pct_10y: 85, direction: 'up' },
  { indicator_slug: 'brent_usd', indicator_name: 'Brent', latest_numeric: 92, pct_10y: 70, direction: 'up' },
];

const todayCandidates = scoreHookCandidates(todayIndicators, realWorldHistory);
const topCandidate = todayCandidates[0];
assert(topCandidate && topCandidate.slug !== 'cd_ratio',
  `Top candidate must NOT be cd_ratio after 4 days of credit_deposit theme (got ${topCandidate?.slug})`);

const todayCtx = buildHookContext(todayIndicators, realWorldHistory);
assert(todayCtx.banned_themes.includes('credit_deposit'),
  'credit_deposit MUST be banned after 4 uses in 7 days');
assert(todayCtx.text.includes('credit_deposit'),
  'Banned theme must appear in the banned block');

// After the hard-filter fix: banned themes AND quarterly metrics are
// excluded from candidates entirely. cd_ratio is both (banned theme AND
// quarterly frequency), so it must not appear at all.
const cdInCandidates = todayCandidates.find(c => c.slug === 'cd_ratio');
assert(cdInCandidates === undefined,
  `Banned/quarterly cd_ratio must be HARD-FILTERED out of candidates (got ${JSON.stringify(cdInCandidates)})`);

// ═══════════════════════════════════════════════════════════════════
// RESULTS
// ═══════════════════════════════════════════════════════════════════
console.log(`\n═══════════════════════════════════════════════════════════`);
console.log(`  Test Results: ${pass} passed, ${fail} failed`);
console.log(`═══════════════════════════════════════════════════════════\n`);

process.exit(fail > 0 ? 1 : 0);
