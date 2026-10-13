/**
 * PodcastProducer — Generates the daily "Macro Morning" two-host podcast.
 *
 * Pipeline: verdict_line + regime + fresh candidates → Haiku dialogue script
 * → Gemini multi-speaker TTS (Asha/Vikram) → WAV → MP3 (ffmpeg, graceful
 * WAV fallback if unavailable)
 *
 * Requires: ANTHROPIC_API_KEY + GEMINI_API_KEY. Skips cleanly (same as
 * VoiceBroadcaster) if GEMINI_API_KEY is absent — this is a bonus format,
 * never a pipeline blocker.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import { parseScriptTurns, totalWordCount, turnsToTranscript } from './skills/podcast-script.js';
import { synthesizeDialogue } from './skills/gemini-tts.js';
import { encodeToMp3 } from './skills/mp3-encode.js';
import {
  loadHookHistory,
  scoreHookCandidates,
  getBannedThemes,
} from '../../../src/utils/hook-writer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');
const persona = readFileSync(join(__dirname, 'Persona.md'), 'utf-8');
const client = new Anthropic();

// Prebuilt Gemini voice names — tune after a real run confirms how they
// actually sound; these are a reasonable first pick (distinct timbre/pace).
const VOICES = { Asha: 'Kore', Vikram: 'Puck' };

export class PodcastProducer {
  /**
   * Generate the daily two-host podcast.
   *
   * @param {object} params
   * @param {string} params.verdictLine
   * @param {object} params.macroDataObj
   * @param {string} params.dateStr
   * @param {string} params.isoDate
   * @returns {{ scriptText, audioPath, latestAudioPath, meta }}
   */
  async produce({ verdictLine, macroDataObj, dateStr, isoDate }) {
    const start = Date.now();

    if (!process.env.GEMINI_API_KEY) {
      console.log('[PodcastProducer] No GEMINI_API_KEY — skipping podcast generation.');
      return {
        scriptText: '',
        audioPath: null,
        latestAudioPath: null,
        meta: { agent: 'PodcastProducer', model: 'skipped', latency_ms: 0, tokens: { input: 0, output: 0 }, cost_usd: 0 },
      };
    }

    // ── Step 1: Build day context (same inputs VoiceBroadcaster uses) ──
    const indicators = macroDataObj.indicators || [];
    const signals = macroDataObj.signals || [];

    const topSignals = signals.slice(0, 5).map(s =>
      `Sig${s.signal_num} [${s.status}]: ${s.title} — ${s.data_text}`
    ).join('\n');

    const hookHistory = loadHookHistory();
    const bannedThemes = getBannedThemes(hookHistory, 7, 2);
    const freshCandidates = scoreHookCandidates(indicators, hookHistory)
      .slice(0, 10)
      .map(c => `${c.name}: ${c.value} (10y pct: ${c.pct_10y}%, ${c.direction}, polarity: ${c.polarity}, freshness: ${c.freshness}, themes: ${c.themes.join('/')})`)
      .join('\n');

    const regimeSummary = (macroDataObj.regime || [])
      .map(r => `${r.dimension}: ${r.badge_label} — ${r.metric_summary}`)
      .join('\n');

    const bannedBlock = bannedThemes.length ? bannedThemes.join(', ') : '(none)';

    // ── Step 2: Generate the two-host script via Haiku ──────────────────
    const prompt = `Write today's Macro Morning podcast — a two-host conversation between Asha and Vikram.

DATE: ${dateStr}

VERDICT (already written by the ExecSummaryWriter — this is the day's overall read, not something to repeat verbatim):
${verdictLine}

REGIME:
${regimeSummary}

TOP SIGNALS:
${topSignals}

FRESH CANDIDATES (ranked by freshness × magnitude × novelty — draw your numbers from HERE, these moved in the last 24-72 hours):
${freshCandidates}

BANNED THEMES (overused in recent days — do not build today's throughline around these):
${bannedBlock}

Follow your Persona exactly: dialogue craft rules, content rules, 900-1,300 word target, three-movement structure, and the JSON-array-only output format.`;

    const stream = client.messages.stream({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 3000,
      temperature: 0.6,
      system: [{ type: 'text', text: persona, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: prompt }],
    });
    const response = await stream.finalMessage();

    const tokens = {
      input: response.usage?.input_tokens || 0,
      output: response.usage?.output_tokens || 0,
    };

    const rawText = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('')
      .trim();

    const turns = parseScriptTurns(rawText);
    const wordCount = totalWordCount(turns);
    const scriptText = turnsToTranscript(turns);
    console.log(`[PodcastProducer] Script: ${turns.length} turns, ${wordCount} words`);

    // ── Step 3: Synthesize audio via Gemini multi-speaker TTS ───────────
    const { wavBuffer, costEstimateUsd: ttsCost } = await synthesizeDialogue(turns, VOICES);

    // ── Step 4: Encode to MP3 (graceful WAV fallback if ffmpeg absent) ──
    const mp3Buffer = encodeToMp3(wavBuffer);
    const audioBuffer = mp3Buffer || wavBuffer;
    const ext = mp3Buffer ? 'mp3' : 'wav';

    // ── Step 5: Save ─────────────────────────────────────────────────────
    const outputDir = join(ROOT, 'output');
    mkdirSync(outputDir, { recursive: true });

    const audioFilename = `daily-podcast-${isoDate}.${ext}`;
    const audioPath = join(outputDir, audioFilename);
    const latestAudioPath = join(outputDir, `daily-podcast.${ext}`);

    writeFileSync(audioPath, audioBuffer);
    writeFileSync(latestAudioPath, audioBuffer); // stable URL for embedding
    console.log(`[PodcastProducer] Audio saved: ${audioPath} (${audioBuffer.length} bytes, ${ext})`);

    writeFileSync(join(outputDir, 'daily-podcast-script.txt'), scriptText, 'utf-8');

    const latency = Date.now() - start;
    const haikuCost = (tokens.input / 1000) * 0.0008 + (tokens.output / 1000) * 0.001;
    const totalCost = Math.round((haikuCost + ttsCost) * 10000) / 10000;

    console.log(`[PodcastProducer] Done in ${latency}ms. Cost: $${totalCost} (Haiku: $${haikuCost.toFixed(4)}, TTS: $${ttsCost.toFixed(4)})`);

    return {
      scriptText,
      audioPath,
      latestAudioPath,
      meta: {
        agent: 'PodcastProducer',
        model: 'claude-haiku-4-5-20251001+gemini-multi-speaker-tts',
        latency_ms: latency,
        tokens,
        cost_usd: totalCost,
        word_count: wordCount,
        turn_count: turns.length,
        audio_bytes: audioBuffer.length,
        audio_format: ext,
      },
    };
  }
}
