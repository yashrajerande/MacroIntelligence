/**
 * Telegram API Skill — Sends messages, photos, and audio via Telegram Bot API.
 */

const BASE_URL = 'https://api.telegram.org/bot';
// None of these calls had a timeout — a hung connection (accepted, never
// responds) left `await fetch(...)` never settling, which the surrounding
// "non-blocking" try/catch in orchestrate.js can't catch (nothing ever
// rejects), so the job just sits until GitHub Actions' own timeout-minutes
// kills it as "cancelled" rather than "failure" — skipping the
// if:failure() alert/log-upload steps entirely. Media uploads get a
// longer window than the plain-text alert send.
const UPLOAD_TIMEOUT_MS = 30000;
const MESSAGE_TIMEOUT_MS = 15000;

/**
 * Send a photo to a Telegram chat.
 * @param {string} token — Bot token
 * @param {string} chatId — Chat ID
 * @param {Buffer} imageBuffer — PNG image data
 * @param {string} caption — Photo caption (supports HTML)
 * @returns {Promise<object>}
 */
export async function sendPhoto(token, chatId, imageBuffer, caption = '') {
  const url = `${BASE_URL}${token}/sendPhoto`;

  // Telegram requires multipart/form-data for file uploads
  const form = new FormData();
  form.append('chat_id', chatId);
  form.append('photo', new Blob([imageBuffer], { type: 'image/png' }), 'daily-macro.png');
  if (caption) {
    form.append('caption', caption);
    form.append('parse_mode', 'HTML');
  }

  const res = await fetch(url, { method: 'POST', body: form, signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS) });
  if (!res.ok) {
    const err = await res.text().catch(() => 'unknown');
    throw new Error(`[Telegram] sendPhoto failed: HTTP ${res.status} — ${err}`);
  }

  const data = await res.json();
  if (!data.ok) throw new Error(`[Telegram] sendPhoto error: ${data.description}`);
  console.log('[Telegram] Photo sent successfully');
  return data;
}

/**
 * Send an audio file to a Telegram chat.
 * @param {string} token — Bot token
 * @param {string} chatId — Chat ID
 * @param {Buffer} audioBuffer — MP3 audio data
 * @param {string} title — Audio title
 * @param {string} caption — Audio caption
 * @returns {Promise<object>}
 */
export async function sendAudio(token, chatId, audioBuffer, title = '60-Second Macro', caption = '') {
  const url = `${BASE_URL}${token}/sendAudio`;

  const form = new FormData();
  form.append('chat_id', chatId);
  form.append('audio', new Blob([audioBuffer], { type: 'audio/mpeg' }), 'sixty-second-macro.mp3');
  form.append('title', title);
  form.append('performer', 'MacroIntelligence');
  if (caption) {
    form.append('caption', caption);
    form.append('parse_mode', 'HTML');
  }

  const res = await fetch(url, { method: 'POST', body: form, signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS) });
  if (!res.ok) {
    const err = await res.text().catch(() => 'unknown');
    throw new Error(`[Telegram] sendAudio failed: HTTP ${res.status} — ${err}`);
  }

  const data = await res.json();
  if (!data.ok) throw new Error(`[Telegram] sendAudio error: ${data.description}`);
  console.log('[Telegram] Audio sent successfully');
  return data;
}

/**
 * Send a document (PDF) to a Telegram chat. Telegram renders PDFs in-app
 * on phones, so the Daily Highlights brief opens with one tap.
 * @param {string} token — Bot token
 * @param {string} chatId — Chat ID
 * @param {Buffer} fileBuffer — File bytes
 * @param {string} filename — Name shown in the chat (with extension)
 * @param {string} caption — Caption (supports HTML)
 * @param {string} mimeType — Defaults to application/pdf
 * @returns {Promise<object>}
 */
export async function sendDocument(token, chatId, fileBuffer, filename, caption = '', mimeType = 'application/pdf') {
  const url = `${BASE_URL}${token}/sendDocument`;

  const form = new FormData();
  form.append('chat_id', chatId);
  form.append('document', new Blob([fileBuffer], { type: mimeType }), filename);
  if (caption) {
    form.append('caption', caption);
    form.append('parse_mode', 'HTML');
  }

  const res = await fetch(url, { method: 'POST', body: form, signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS) });
  if (!res.ok) {
    const err = await res.text().catch(() => 'unknown');
    throw new Error(`[Telegram] sendDocument failed: HTTP ${res.status} — ${err}`);
  }

  const data = await res.json();
  if (!data.ok) throw new Error(`[Telegram] sendDocument error: ${data.description}`);
  console.log('[Telegram] Document sent successfully');
  return data;
}

/**
 * Send a text message to a Telegram chat.
 */
export async function sendMessage(token, chatId, text, parseMode = 'HTML') {
  const url = `${BASE_URL}${token}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: parseMode }),
    signal: AbortSignal.timeout(MESSAGE_TIMEOUT_MS),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => 'unknown');
    throw new Error(`[Telegram] sendMessage failed: HTTP ${res.status} — ${err}`);
  }
  return await res.json();
}
