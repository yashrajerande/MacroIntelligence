/**
 * Banned-name scanner — enforces the "names stay behind the curtain" rule.
 *
 * Personas across departments use named voices as analytical anchors
 * (Mishra, Munger, FT/Economist for Editorial; BCG/McKinsey/Bain for
 * ConglomeratesTracker). Those names are private guidance for the LLM
 * and MUST NOT leak into the reader-facing output. This module is the
 * deterministic enforcement layer.
 *
 * Usage:
 *   import { scanBannedNames } from '../../src/utils/banned-names.js';
 *   const hits = scanBannedNames(text);
 *   if (hits.length) // reject
 */

// Word-boundary patterns. We match case-insensitive but require a word
// boundary so ordinary tokens (e.g. "front" containing "ft") don't trigger.
const PATTERNS = [
  // Editorial voices
  { name: 'Mishra',          re: /\bmishra\b/i },
  { name: 'Neelkanth',       re: /\bneelkanth\b/i },
  { name: 'Munger',          re: /\bmunger\b/i },
  { name: 'Charlie Munger',  re: /\bcharlie\s+munger\b/i },
  { name: 'Buffett',         re: /\bbuffett\b/i },
  { name: 'Lex column',      re: /\blex\s+column\b/i },
  // Publication voices (only when used as analytical voice — quoting from
  // Reuters/Bloomberg as a SOURCE in research output is fine, so we match
  // only the editorial-voice publications most likely to leak from persona).
  { name: 'Financial Times', re: /\bfinancial\s+times\b/i },
  { name: 'FT (voice)',      re: /\bin\s+the\s+ft['’]?s?\s+voice\b/i },
  { name: 'Economist (voice)', re: /\b(?:the\s+)?economist['’]?s?\s+(?:voice|editor|register|style)\b/i },

  // ConglomeratesTracker firm anchors
  { name: 'BCG',             re: /\bbcg\b/i },
  { name: 'McKinsey',        re: /\bmckinsey\b/i },
  { name: 'Bain (firm)',     re: /\bbain\s*(?:&|and)\s*co(?:mpany)?\b/i },
];

export function scanBannedNames(text) {
  if (typeof text !== 'string') text = JSON.stringify(text ?? '');
  const hits = [];
  for (const p of PATTERNS) {
    if (p.re.test(text)) hits.push(p.name);
  }
  return hits;
}

export const BANNED_NAME_PATTERNS = PATTERNS;

// ── Scrubber ───────────────────────────────────────────────────────────
// The scanner is the tripwire; this is the fix. The persona tells the
// model "use the voices to think, never to attribute", but roughly one
// edition in a hundred still writes "as Mishra notes…" — and until now
// that single surname failed the whole run after every agent had spent
// its budget. Deterministic rewriting keeps the sentence and drops the
// attribution, so the edition ships and the leak shows up as an L7
// warning in the ops log instead of an outage.

const PERSON = String.raw`(?:neelkanth\s+)?mishra|(?:charlie\s+)?munger|(?:warren\s+)?buffett`;
const FIRM = String.raw`bcg|mckinsey|bain\s*(?:&|and)\s*co(?:mpany)?`;
const ANY = `(?:${PERSON}|${FIRM})`;

const SCRUB_RULES = [
  // "as Mishra notes, " / "as Munger would put it: " / "per McKinsey, "
  { re: new RegExp(String.raw`\b(?:as|per|like|à\s+la|channel(?:l)?ing|echoing|according\s+to|in\s+the\s+words\s+of)\s+(?:the\s+)?${ANY}(?:\s+(?:notes?|argues?|observes?|says?|puts?\s+it|would\s+(?:say|note|argue|put\s+it|frame\s+it)|has\s+(?:noted|argued|observed)|points?\s+out|frames?\s+it|warns?|reminds\s+us))?[,:]?\s*`, 'gi'), to: '' },
  // Sentence-initial "Mishra notes that " / "Munger would argue "
  { re: new RegExp(String.raw`(^|[.!?]\s+)${ANY}\s+(?:notes?|argues?|observes?|says?|would\s+(?:say|note|argue))\s+(?:that\s+)?`, 'gi'), to: '$1' },
  // Possessive: "Mishra's proxy test" → "the proxy test"; "Munger's inversion" → "the inversion"
  { re: new RegExp(String.raw`\b(?:the\s+)?${ANY}['’]s\s+`, 'gi'), to: 'the ' },
  // Adjectival: "the Munger inversion" → "the inversion"; "a Mishra-style read" → "a read"
  { re: new RegExp(String.raw`\b${ANY}(?:-style|-type|-like|-esque)?\s+`, 'gi'), to: '' },
  // Publication voices used as attribution
  { re: /\bin\s+the\s+ft['’]?s?\s+voice[,:]?\s*/gi, to: '' },
  { re: /\b(?:the\s+)?economist['’]?s?\s+(?:voice|editor|register|style)\b[,:]?\s*/gi, to: '' },
  { re: /\bfinancial\s+times\b/gi, to: 'the financial press' },
  { re: /\blex\s+column\b/gi, to: 'the financial press' },
  // Whatever is left standing alone
  { re: new RegExp(String.raw`\b${ANY}\b`, 'gi'), to: '' },
];

/**
 * Remove persona-anchor attributions from reader-facing text while
 * keeping the sentence intact. Idempotent; returns non-strings unchanged.
 */
export function scrubBannedNames(text) {
  if (typeof text !== 'string' || !text) return text;
  if (!scanBannedNames(text).length) return text;
  let out = text;
  for (const rule of SCRUB_RULES) out = out.replace(rule.re, rule.to);
  return out
    .replace(/[ \t]{2,}/g, ' ')          // collapse doubled spaces
    .replace(/\s+([,.;:!?])/g, '$1')     // no space before punctuation
    .replace(/([.!?])\s*([.!?])/g, '$1') // no doubled sentence enders
    .replace(/\(\s*\)/g, '')             // empty parentheses
    .replace(/>\s+</g, '><')             // tidy tag joins we may have widened
    .replace(/(^|[.!?]\s+)([a-z])/g, (m, pre, ch) => pre + ch.toUpperCase()) // re-capitalise sentence starts
    .trim();
}

/**
 * Scrub every reader-facing surface the Validator's L7 layer scans, in
 * place. Returns the number of fields that were rewritten.
 *
 * @param {object} surfaces
 * @param {object} [surfaces.execSummary]  — { verdict_line, regime_narratives, data: [{para_html}] }
 * @param {object} [surfaces.regime]       — { data: [{signal_text, metric_summary, badge_label}] }
 * @param {object} [surfaces.signals]      — { data: [{title, data_text, implication, pct_note}] }
 * @param {object} [surfaces.leverage]     — { data: { narrative } }
 */
export function scrubReaderSurfaces({ execSummary, regime, signals, leverage } = {}) {
  let n = 0;
  const fix = (obj, key) => {
    if (!obj || typeof obj[key] !== 'string') return;
    const next = scrubBannedNames(obj[key]);
    if (next !== obj[key]) { obj[key] = next; n++; }
  };
  if (execSummary) {
    fix(execSummary, 'verdict_line');
    for (const k of Object.keys(execSummary.regime_narratives || {})) fix(execSummary.regime_narratives, k);
    for (const p of execSummary.data || []) fix(p, 'para_html');
  }
  for (const r of regime?.data || []) { fix(r, 'signal_text'); fix(r, 'metric_summary'); fix(r, 'badge_label'); }
  for (const s of signals?.data || []) { fix(s, 'title'); fix(s, 'data_text'); fix(s, 'implication'); fix(s, 'pct_note'); }
  if (leverage?.data) fix(leverage.data, 'narrative');
  return n;
}
