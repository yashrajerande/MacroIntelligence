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
