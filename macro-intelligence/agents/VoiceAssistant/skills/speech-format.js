/**
 * Speech Format Skill — pure functions for the Voice Assistant's two
 * speech-adjacent jobs:
 *
 *   1. toSpeechText(html)      — turn rendered HTML/markup into text a
 *      TTS engine reads naturally (no tags, no bare symbols).
 *   2. parseVoiceCommand(text) — recognise the handful of PLAYBACK
 *      commands ("slow down", "repeat that") that must be handled
 *      locally and instantly, never sent to the model as a question.
 *
 * This file is the source of truth. The dashboard template cannot
 * import it — the Charter requires the template to stay one
 * self-contained HTML file — so its inline JS hand-mirrors these exact
 * rules, and a pre-flight test (test.js) checks the template for the
 * same literal patterns so the two copies cannot silently drift apart.
 *
 * Both functions are pure and side-effect-free: no DOM, no network, no
 * SpeechSynthesis/SpeechRecognition globals, so they run identically in
 * Node (this file, pre-flight-tested) and in the browser (the mirrored
 * copy).
 */

// ── Speech text formatting ──────────────────────────────────────────

/**
 * Convert a rendered HTML fragment (an executive-summary so-what block,
 * a signal's data_text, a Rabbit-Hole-style answer) into plain text a
 * speech engine reads the way a person would say it aloud. Order
 * matters: structural replacements (tags, slashes) happen before the
 * symbol/abbreviation conversions that depend on the surrounding words.
 */
export function toSpeechText(html) {
  if (html === null || html === undefined) return '';
  return String(html)
    // Block-level boundaries become a pause (a period), not silence —
    // otherwise "...5% of GDPCredit is..." runs two facts into one.
    .replace(/<\/(p|li|h[1-6]|div)>/gi, '. ')
    .replace(/<br\s*\/?>/gi, '. ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, ' and ')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/—|–/g, ', ')
    // Defense in depth: the persona forbids markdown, but strip it
    // anyway in case the model emits it under pressure.
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*/g, '')
    // "₹ cr / month" → "₹ crore per month" BEFORE the bare-symbol passes
    // below, or the slash is left dangling once '/' has no neighbours.
    .replace(/\s*\/\s*(month|quarter|annum|year)\b/gi, ' per $1')
    .replace(/%/g, ' percent')
    .replace(/₹/g, 'rupees ')
    .replace(/\$/g, 'dollars ')
    .replace(/\bcr\b/gi, 'crore')
    .replace(/\bp\.a\./gi, 'per annum')
    .replace(/\byoy\b/gi, 'year on year')
    .replace(/\bqoq\b/gi, 'quarter on quarter')
    .replace(/\bsaar\b/gi, 'annualised')
    .replace(/\bbps\b/gi, 'basis points')
    .replace(/\bfytd\b/gi, 'financial year to date')
    .replace(/\bgdp\b/gi, 'G D P')
    .replace(/\bnri\b/gi, 'N R I')
    .replace(/\bgcc\b/gi, 'G C C')
    .replace(/\s{2,}/g, ' ')
    .replace(/\.(\s*\.)+/g, '.')
    .trim();
}

// ── Local playback commands ──────────────────────────────────────────
//
// These are deliberately matched only on SHORT utterances. A real
// question can easily contain the word "continue" ("should I continue
// holding Nifty") or "stop" ("why did FII flows stop rising") — treating
// those as playback commands would silently swallow a real question.
// A playback command in normal speech is a short, standalone phrase, so
// anything longer than MAX_COMMAND_WORDS is never classified as one.

export const MAX_COMMAND_WORDS = 6;

const COMMAND_PATTERNS = [
  { cmd: 'stop',   re: /\b(stop|cancel|never ?mind|that'?s enough)\b/i },
  { cmd: 'pause',  re: /\bpause\b/i },
  { cmd: 'resume', re: /\b(resume|keep going|go on|continue)\b/i },
  { cmd: 'repeat', re: /\b(repeat|say (that|it) again|what did you say)\b/i },
  { cmd: 'slower', re: /\b(slow(er)? down|slower|too fast)\b/i },
  { cmd: 'faster', re: /\b(speed(s)? up|faster|go faster|too slow|quicker)\b/i },
];

/**
 * Classify a transcript as a local playback command, or null when it
 * should be sent to the Voice Assistant as a real question.
 * @param {string} transcript
 * @returns {'stop'|'pause'|'resume'|'repeat'|'slower'|'faster'|null}
 */
export function parseVoiceCommand(transcript) {
  const t = String(transcript || '').trim().toLowerCase();
  if (!t) return null;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length > MAX_COMMAND_WORDS) return null;
  for (const { cmd, re } of COMMAND_PATTERNS) {
    if (re.test(t)) return cmd;
  }
  return null;
}

// ── Speech rate state machine ────────────────────────────────────────

export const RATE_DEFAULT = 1.0;
export const RATE_MIN = 0.5;
export const RATE_MAX = 2.0;
const RATE_STEP_DOWN = 0.85;
const RATE_STEP_UP = 1.15;

/**
 * Apply a 'slower' or 'faster' command to the current speech rate.
 * Any other command (or null) returns the rate unchanged — this is a
 * pure step function, not a command dispatcher.
 */
export function applyRateCommand(currentRate, cmd) {
  const rate = typeof currentRate === 'number' && currentRate > 0 ? currentRate : RATE_DEFAULT;
  if (cmd === 'slower') return Math.max(RATE_MIN, Math.round(rate * RATE_STEP_DOWN * 100) / 100);
  if (cmd === 'faster') return Math.min(RATE_MAX, Math.round(rate * RATE_STEP_UP * 100) / 100);
  return rate;
}
