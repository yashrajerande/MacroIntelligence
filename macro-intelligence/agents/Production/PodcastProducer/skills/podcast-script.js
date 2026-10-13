/**
 * Podcast Script Skill — pure functions for turning the writer-LLM's
 * JSON turns into what the TTS engine needs, and for chunking a long
 * script into TTS-call-sized pieces without ever splitting one turn's
 * text across two calls (that would cut a sentence mid-word at the
 * chunk boundary).
 *
 * Pure and side-effect-free — no network, no filesystem — so this file
 * is fully pre-flight-tested without an API key.
 */

export const VALID_SPEAKERS = ['Asha', 'Vikram'];

/**
 * Parse and validate the writer LLM's JSON-array response into a clean
 * turns array. Tolerant of the model wrapping the array in prose or a
 * markdown fence (every other writer in this org does the same
 * <<<JSON>>> / fenced-block tolerance); rejects anything that isn't a
 * well-formed {speaker, text} array rather than silently degrading.
 *
 * @param {string} raw — the model's raw text response
 * @returns {{speaker: string, text: string}[]}
 * @throws {Error} if no valid turns array can be recovered
 */
export function parseScriptTurns(raw) {
  if (!raw || typeof raw !== 'string') throw new Error('[PodcastScript] Empty response from script writer');

  // Try a fenced ```json block first, then the first [...] array literal.
  const fenced = raw.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
  const bare = raw.match(/\[[\s\S]*\]/);
  const candidate = fenced ? fenced[1] : (bare ? bare[0] : raw.trim());

  let parsed;
  try {
    parsed = JSON.parse(candidate);
  } catch (err) {
    throw new Error(`[PodcastScript] Could not parse turns JSON: ${err.message}`);
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('[PodcastScript] Script writer did not return a non-empty array of turns');
  }

  const turns = parsed.map((t, i) => {
    const speaker = String(t?.speaker || '').trim();
    const text = String(t?.text || '').trim();
    if (!VALID_SPEAKERS.includes(speaker)) {
      throw new Error(`[PodcastScript] Turn ${i} has an invalid speaker "${speaker}" — must be one of ${VALID_SPEAKERS.join(', ')}`);
    }
    if (!text) {
      throw new Error(`[PodcastScript] Turn ${i} (${speaker}) has empty text`);
    }
    return { speaker, text };
  });

  return turns;
}

/** Total spoken word count across all turns — used for length checks and cost estimation. */
export function totalWordCount(turns) {
  return turns.reduce((sum, t) => sum + t.text.split(/\s+/).filter(Boolean).length, 0);
}

/**
 * Render turns as the "Speaker: text" transcript block the Gemini TTS
 * prompt needs (speaker names in the text must match the configured
 * speakerVoiceConfigs names exactly). Also doubles as the human-readable
 * script file saved alongside the audio.
 */
export function turnsToTranscript(turns) {
  return turns.map(t => `${t.speaker}: ${t.text}`).join('\n');
}

// A conservative per-call budget. Multi-speaker TTS call limits are not
// publicly documented with precision at the time this was built — see
// skills/gemini-tts.js — so this stays well under any plausible ceiling
// rather than finding the limit in production. Tune down first if a
// real run ever errors on chunk size; this is the single easiest knob.
export const DEFAULT_CHUNK_WORD_BUDGET = 600;

/**
 * Split turns into chunks, each under maxWords, WITHOUT ever splitting a
 * single turn's text across two chunks. A lone turn longer than the
 * budget becomes its own one-turn chunk rather than being truncated —
 * length is bounded upstream by the persona's word target, so this is a
 * safety margin, not the primary control.
 *
 * @param {{speaker:string,text:string}[]} turns
 * @param {number} [maxWords]
 * @returns {{speaker:string,text:string}[][]} array of chunks (each a turns array)
 */
export function chunkTurns(turns, maxWords = DEFAULT_CHUNK_WORD_BUDGET) {
  if (!turns.length) return [];
  const chunks = [];
  let current = [];
  let currentWords = 0;

  for (const turn of turns) {
    const words = turn.text.split(/\s+/).filter(Boolean).length;
    if (current.length && currentWords + words > maxWords) {
      chunks.push(current);
      current = [];
      currentWords = 0;
    }
    current.push(turn);
    currentWords += words;
  }
  if (current.length) chunks.push(current);
  return chunks;
}
