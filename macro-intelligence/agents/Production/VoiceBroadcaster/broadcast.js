/**
 * VoiceBroadcaster — Generates a 60-second macro audio briefing.
 *
 * Pipeline: verdict_line + fresh candidates → Haiku script → OpenAI TTS → MP3
 *
 * The "Two Numbers That Matter" (Act 2) are now selected by the Hook Writer
 * Skill — the same freshness × magnitude × novelty scorer that feeds the
 * verdict line. Quarterly metrics that haven't changed today and themes
 * overused in the last week are hard-filtered out.
 *
 * Requires: ANTHROPIC_API_KEY + OPENAI_API_KEY
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import { generateSpeech } from './skills/tts-api.js';
import {
  loadHookHistory,
  scoreHookCandidates,
  getBannedThemes,
  getRecentThemes,
} from '../../../src/utils/hook-writer.js';

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

    // ── Step 1: Pick the most interesting FRESH indicators ───────────
    const indicators = macroDataObj.indicators || [];
    const signals = macroDataObj.signals || [];

    // Build context for script generation
    const topSignals = signals.slice(0, 3).map(s =>
      `Sig${s.signal_num} [${s.status}]: ${s.title} — ${s.data_text}`
    ).join('\n');

    // Use the Hook Writer Skill to pick FRESH candidates — same scorer
    // the ExecSummaryWriter uses. This ensures: (a) banned themes are
    // hard-filtered, (b) quarterly stale metrics are excluded, (c) daily
    // moves rank highest. No more CD-ratio-every-morning.
    const hookHistory = loadHookHistory();
    const bannedThemes = getBannedThemes(hookHistory, 7, 2);
    const freshCandidates = scoreHookCandidates(indicators, hookHistory)
      .slice(0, 10)
      .map(c => `${c.name}: ${c.value} (10y pct: ${c.pct_10y}%, ${c.direction}, polarity: ${c.polarity}, freshness: ${c.freshness}, themes: ${c.themes.join('/')})`)
      .join('\n');

    const regimeSummary = (macroDataObj.regime || [])
      .map(r => `${r.dimension}: ${r.badge_label} — ${r.metric_summary}`)
      .join('\n');

    // ── Step 2: Generate the script via Haiku ────────────────────────
    const bannedBlock = bannedThemes.length
      ? bannedThemes.join(', ')
      : '(none)';

    const prompt = `Write a 60-second audio script for today's macro briefing.

DATE: ${dateStr}

VERDICT (already written by the ExecSummaryWriter — rephrase for ears, don't repeat verbatim):
${verdictLine}

REGIME:
${regimeSummary}

TOP SIGNALS:
${topSignals}

FRESH CANDIDATES FOR "TWO NUMBERS" (ranked by freshness × magnitude × novelty — pick from HERE):
${freshCandidates}

BANNED THEMES (overused in recent days — do NOT build your "two numbers" around these):
${bannedBlock}

RULES:
1. EXACTLY 140-155 words. Count them. This will be read aloud at natural pace.
2. Structure: Hook (balanced overview) → Two numbers (one strength, one to watch) → Positive close.
3. Open with: "Good morning from MacroIntelligence."
4. Close with: "This has been your sixty-second macro. Have a great day."
5. Pick your 2 numbers from the FRESH CANDIDATES list above. These are metrics that actually moved in the last 24-72 hours. DO NOT use stale quarterly metrics (GDP, CD ratio, HPI, capacity utilisation) unless they appear in the candidates list — they did not change today.
6. For each number, explain in ONE sentence with perspective. Provide comparison.
7. Conversational, warm, calm. This is breakfast briefing, not emergency broadcast.
8. CRITICAL TONE RULE: Be optimistic and balanced. NEVER alarmist. No "collapsing", "crashing", "spiraling", "crisis", "brink", "alarm bells". If a number is concerning, state the fact and the counterbalance.
9. Always find something positive to highlight. India is a growing economy — lead with that confidence.
10. End on a note of perspective or optimism. NEVER end on fear.
11. No jargon without instant explanation.
12. Your two numbers MUST cover DIFFERENT themes from each other. Don't pick two market indices or two inflation prints — diversify.

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
