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
assert(cardHTML.includes('Explore the Full Dashboard'), 'Card HTML must contain CTA');
assert(cardHTML.includes('https://example.com'), 'Card HTML must contain dashboard URL');
assert(cardHTML.includes('1080px'), 'Card HTML must be 1080px wide');
assert(cardHTML.includes('1350px'), 'Card HTML must be 1350px tall');
assert(cardHTML.includes('percentile'), 'Card HTML must show percentile badges');

// ═══════════════════════════════════════════════════════════════════
// RESULTS
// ═══════════════════════════════════════════════════════════════════
console.log(`\n═══════════════════════════════════════════════════════════`);
console.log(`  Test Results: ${pass} passed, ${fail} failed`);
console.log(`═══════════════════════════════════════════════════════════\n`);

process.exit(fail > 0 ? 1 : 0);
