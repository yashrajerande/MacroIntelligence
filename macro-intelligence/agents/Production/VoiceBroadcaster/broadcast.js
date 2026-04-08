/**
 * VoiceBroadcaster — Generates a 60-second macro audio briefing.
 *
 * Pipeline: verdict_line + key indicators → Haiku script → OpenAI TTS → MP3
 * Requires: ANTHROPIC_API_KEY + OPENAI_API_KEY
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import { generateSpeech } from './skills/tts-api.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');
const persona = readFileSync(join(__dirname, 'Persona.md'), 'utf-8');
const client = new Anthropic();

export class VoiceBroadcaster {
  /**
   * Generate the 60-second audio briefing.
   *
   * @param {object} params
   * @param {string} params.verdictLine — The CIO verdict from ExecSummaryWriter
   * @param {object} params.macroDataObj — The full __MACRO_DATA__ object
   * @param {string} params.dateStr — Display date like "08 APR 2026"
   * @param {string} params.isoDate — ISO date like "2026-04-08"
   * @returns {{ scriptText, audioPath, meta }}
   */
  async generate({ verdictLine, macroDataObj, dateStr, isoDate }) {
    const start = Date.now();

    // Skip if no OpenAI key
    if (!process.env.OPENAI_API_KEY) {
      console.log('[VoiceBroadcaster] No OPENAI_API_KEY — skipping audio generation.');
      return {
        scriptText: '',
        audioPath: null,
        meta: { agent: 'VoiceBroadcaster', model: 'skipped', latency_ms: 0, tokens: { input: 0, output: 0 }, cost_usd: 0 },
      };
    }

    // ── Step 1: Pick the 2 most interesting indicators ───────────────
    const indicators = macroDataObj.indicators || [];
    const signals = macroDataObj.signals || [];

    // Build context for script generation
    const topSignals = signals.slice(0, 3).map(s =>
      `Sig${s.signal_num} [${s.status}]: ${s.title} — ${s.data_text}`
    ).join('\n');

    // Find extreme percentile indicators (most notable)
    const extremes = indicators
      .filter(ind => ind.latest_numeric !== null && ind.pct_10y !== undefined)
      .sort((a, b) => Math.abs(b.pct_10y - 50) - Math.abs(a.pct_10y - 50))
      .slice(0, 10)
      .map(ind => `${ind.indicator_name}: ${ind.latest_value} (10y percentile: ${ind.pct_10y}%, ${ind.direction})`)
      .join('\n');

    const regimeSummary = (macroDataObj.regime || [])
      .map(r => `${r.dimension}: ${r.badge_label} — ${r.metric_summary}`)
      .join('\n');

    // ── Step 2: Generate the script via Haiku ────────────────────────
    const prompt = `Write a 60-second audio script for today's macro briefing.

DATE: ${dateStr}

VERDICT: ${verdictLine}

REGIME:
${regimeSummary}

TOP SIGNALS:
${topSignals}

MOST NOTABLE INDICATORS (by 10-year percentile extremity):
${extremes}

RULES:
1. EXACTLY 140-155 words. Count them. This will be read aloud at natural pace.
2. Structure: Hook (verdict rewritten for spoken delivery) → Two numbers with context → Memorable close.
3. Open with: "Good morning from MacroIntelligence."
4. Close with: "This has been your sixty-second macro. Have a sharp day."
5. Pick the 2 most surprising/consequential numbers from the indicators above.
6. For each number, explain in ONE sentence why a fund manager should care.
7. Use conversational language — this is spoken, not written. Short sentences. Pauses.
8. Include one Munger-style inversion: "Last time this happened, X followed within Y months."
9. Include one metaphor or memorable phrase the listener can repeat at lunch.
10. No jargon without instant explanation.

Return ONLY the script text. No JSON. No markers. Just the words to be spoken.`;

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      temperature: 0.5,
      system: [{ type: 'text', text: persona, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: prompt }],
    });

    const tokens = {
      input: response.usage?.input_tokens || 0,
      output: response.usage?.output_tokens || 0,
    };

    const scriptText = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('')
      .trim();

    const wordCount = scriptText.split(/\s+/).length;
    console.log(`[VoiceBroadcaster] Script: ${wordCount} words, ${scriptText.length} chars`);

    // ── Step 3: Generate audio via OpenAI TTS ────────────────────────
    const { buffer: audioBuffer, costEstimate: ttsCost } = await generateSpeech(scriptText);

    // ── Step 4: Save MP3 ─────────────────────────────────────────────
    const outputDir = join(ROOT, 'output');
    mkdirSync(outputDir, { recursive: true });

    const audioFilename = `daily-broadcast-${isoDate}.mp3`;
    const audioPath = join(outputDir, audioFilename);
    const latestAudioPath = join(outputDir, 'daily-broadcast.mp3');

    writeFileSync(audioPath, audioBuffer);
    writeFileSync(latestAudioPath, audioBuffer); // stable URL for embedding
    console.log(`[VoiceBroadcaster] Audio saved: ${audioPath} (${audioBuffer.length} bytes)`);

    // Also save the script for reference
    writeFileSync(join(outputDir, 'daily-broadcast-script.txt'), scriptText, 'utf-8');

    const latency = Date.now() - start;
    const haikuCost = (tokens.input / 1000) * 0.0008 + (tokens.output / 1000) * 0.001;
    const totalCost = Math.round((haikuCost + ttsCost) * 10000) / 10000;

    console.log(`[VoiceBroadcaster] Done in ${latency}ms. Cost: $${totalCost} (Haiku: $${haikuCost.toFixed(4)}, TTS: $${ttsCost.toFixed(4)})`);

    return {
      scriptText,
      audioPath,
      latestAudioPath,
      meta: {
        agent: 'VoiceBroadcaster',
        model: 'claude-haiku-4-5-20251001+openai-tts-1-hd',
        latency_ms: latency,
        tokens,
        cost_usd: totalCost,
        word_count: wordCount,
        audio_bytes: audioBuffer.length,
      },
    };
  }
}
