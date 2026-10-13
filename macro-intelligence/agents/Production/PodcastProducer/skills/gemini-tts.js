/**
 * Gemini Multi-Speaker TTS Skill — turns a two-host script into one WAV
 * file via Google's Gemini API speech generation.
 *
 * Requires GEMINI_API_KEY (from Google AI Studio — ai.google.dev — a
 * separate account/billing from Anthropic and OpenAI; not provisionable
 * by the pipeline itself, see README).
 *
 * Model and endpoint were current as of this skill's construction (Oct
 * 2026) but were NOT verified against a live call from this build
 * environment — this session's network policy could not reach
 * generativelanguage.googleapis.com. MODEL is a single exported
 * constant for exactly this reason: if Google renames or deprecates the
 * multi-speaker-capable model, this is the one line to change. The
 * "-flash-lite" TTS variant does NOT support multi-speaker mode — never
 * point this at it.
 */

import { chunkTurns, turnsToTranscript, DEFAULT_CHUNK_WORD_BUDGET } from './podcast-script.js';
import { concatenatePcm, pcmToWav } from './audio-pcm.js';

export const MODEL = 'gemini-2.5-flash-tts';
const ENDPOINT = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

// Gemini TTS pricing was not independently confirmed for this build (no
// live call was possible — see module comment). This is a placeholder
// estimate ($/1K chars, in the same order of magnitude as other
// character-priced TTS APIs this org already uses) so a cost number
// still appears in the run log and cost-ledger — NOT a verified figure.
// Check the real AI Studio / Cloud billing page after the first live
// run and correct this constant (same discipline as Notion Best
// Practices #4: measure real cost, don't trust the estimate).
const UNVERIFIED_COST_PER_1K_CHARS_USD = 0.015;

/**
 * Synthesize a two-host dialogue into one WAV buffer. Chunks the script
 * so no single TTS call carries an unbounded amount of text (see
 * podcast-script.js for why), calls Gemini once per chunk, and
 * concatenates the raw PCM before wrapping it in one WAV header.
 *
 * @param {{speaker:string,text:string}[]} turns
 * @param {object} voices — { Asha: 'Kore', Vikram: 'Puck' } prebuilt voice names
 * @param {object} [options]
 * @param {number} [options.chunkWordBudget]
 * @returns {Promise<{ wavBuffer: Buffer, charCount: number, costEstimateUsd: number, chunkCount: number }>}
 */
export async function synthesizeDialogue(turns, voices, options = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('[GeminiTTS] Missing GEMINI_API_KEY environment variable');

  const speakerVoiceConfigs = Object.entries(voices).map(([speaker, voiceName]) => ({
    speaker,
    voiceConfig: { prebuiltVoiceConfig: { voiceName } },
  }));

  const chunks = chunkTurns(turns, options.chunkWordBudget || DEFAULT_CHUNK_WORD_BUDGET);
  if (!chunks.length) throw new Error('[GeminiTTS] No script turns to synthesize');

  const pcmBuffers = [];
  let charCount = 0;

  for (let i = 0; i < chunks.length; i++) {
    const transcript = turnsToTranscript(chunks[i]);
    charCount += transcript.length;
    console.log(`[GeminiTTS] Synthesizing chunk ${i + 1}/${chunks.length} (${transcript.length} chars)...`);

    const body = {
      contents: [{ parts: [{ text: `TTS the following podcast conversation between ${Object.keys(voices).join(' and ')}, natural conversational pacing:\n${transcript}` }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { multiSpeakerVoiceConfig: { speakerVoiceConfigs } },
      },
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    let res;
    try {
      res = await fetch(`${ENDPOINT(MODEL)}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => 'unknown');
      throw new Error(`[GeminiTTS] HTTP ${res.status} on chunk ${i + 1}/${chunks.length}: ${errText.slice(0, 500)}`);
    }

    const data = await res.json();
    const inline = data?.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData;
    if (!inline?.data) {
      throw new Error(`[GeminiTTS] Chunk ${i + 1}/${chunks.length}: no audio in response (shape may have changed — check candidates[0].content.parts[].inlineData.data)`);
    }
    pcmBuffers.push(Buffer.from(inline.data, 'base64'));
  }

  const pcm = concatenatePcm(pcmBuffers);
  const wavBuffer = pcmToWav(pcm);
  const costEstimateUsd = Math.round((charCount / 1000) * UNVERIFIED_COST_PER_1K_CHARS_USD * 10000) / 10000;

  return { wavBuffer, charCount, costEstimateUsd, chunkCount: chunks.length };
}
