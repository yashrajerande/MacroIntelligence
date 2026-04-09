/**
 * TelegramPublisher — Sends daily summary image + audio to Telegram.
 *
 * Requires: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID environment variables.
 * Non-blocking: skips gracefully if credentials missing.
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { generateCardHTML } from './skills/summary-card.js';
import { htmlToImage } from './skills/screenshot.js';
import { sendPhoto, sendAudio } from './skills/telegram-api.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');

export class TelegramPublisher {
  /**
   * Generate summary image and send both image + audio to Telegram.
   *
   * @param {object} params
   * @param {string} params.verdictLine
   * @param {object} params.macroDataObj
   * @param {string} params.dateStr
   * @param {string} params.isoDate
   * @param {string} params.dashboardUrl
   * @param {string} [params.audioPath] — Path to MP3 file
   */
  async publish({ verdictLine, macroDataObj, dateStr, isoDate, dashboardUrl, audioPath }) {
    const start = Date.now();
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!token || !chatId) {
      console.log('[TelegramPublisher] No TELEGRAM_BOT_TOKEN/CHAT_ID — skipping.');
      return {
        meta: { agent: 'TelegramPublisher', model: 'none', latency_ms: 0, tokens: { input: 0, output: 0 } },
      };
    }

    // ── Step 1: Generate summary card image ──────────────────────────
    console.log('[TelegramPublisher] Generating summary card...');
    const cardHTML = generateCardHTML({
      verdictLine,
      macroDataObj,
      dateStr,
      dashboardUrl: dashboardUrl || 'https://yashrajerande.github.io/MacroIntelligence/',
    });

    const imagePath = join(ROOT, 'output', `daily-card-${isoDate}.png`);
    const latestImagePath = join(ROOT, 'output', 'daily-card.png');

    let imageBuffer;
    try {
      imageBuffer = await htmlToImage(cardHTML, imagePath);
      // Also save as latest
      const { writeFileSync: wfs } = await import('fs');
      wfs(latestImagePath, imageBuffer);
    } catch (err) {
      console.warn(`[TelegramPublisher] Screenshot failed: ${err.message}`);
      // Try sending text-only message instead
      const { sendMessage } = await import('./skills/telegram-api.js');
      await sendMessage(token, chatId,
        `📊 <b>MacroIntelligence — ${dateStr}</b>\n\n${verdictLine}\n\n<a href="${dashboardUrl || 'https://yashrajerande.github.io/MacroIntelligence/'}">Open Full Dashboard →</a>`
      );
      console.log('[TelegramPublisher] Sent text fallback (no image).');
      return {
        meta: { agent: 'TelegramPublisher', model: 'none', latency_ms: Date.now() - start, tokens: { input: 0, output: 0 } },
      };
    }

    // ── Step 2: Send image to Telegram ───────────────────────────────
    console.log('[TelegramPublisher] Sending image to Telegram...');
    const caption = `📊 <b>MacroIntelligence — ${dateStr}</b>\n\n${verdictLine}\n\n<a href="${dashboardUrl || 'https://yashrajerande.github.io/MacroIntelligence/'}">📱 Open Full Dashboard</a>`;

    await sendPhoto(token, chatId, imageBuffer, caption);

    // ── Step 3: Send audio to Telegram ───────────────────────────────
    const mp3Path = audioPath || join(ROOT, 'output', 'daily-broadcast.mp3');
    if (existsSync(mp3Path)) {
      console.log('[TelegramPublisher] Sending audio to Telegram...');
      const audioBuffer = readFileSync(mp3Path);
      await sendAudio(token, chatId, audioBuffer, `60-Second Macro — ${dateStr}`,
        '🎧 Your daily macro briefing in 60 seconds. Forward to friends!'
      );
    } else {
      console.log('[TelegramPublisher] No MP3 found — skipping audio send.');
    }

    const latency = Date.now() - start;
    console.log(`[TelegramPublisher] Done in ${latency}ms.`);

    return {
      imagePath,
      meta: {
        agent: 'TelegramPublisher',
        model: 'none',
        latency_ms: latency,
        tokens: { input: 0, output: 0 },
      },
    };
  }
}
