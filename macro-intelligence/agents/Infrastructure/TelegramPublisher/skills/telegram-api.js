/**
 * Telegram API Skill — Sends messages, photos, and audio via Telegram Bot API.
 */

const BASE_URL = 'https://api.telegram.org/bot';

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

  const res = await fetch(url, { method: 'POST', body: form });
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

  const res = await fetch(url, { method: 'POST', body: form });
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
 * Send a text message to a Telegram chat.
 */
export async function sendMessage(token, chatId, text, parseMode = 'HTML') {
  const url = `${BASE_URL}${token}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: parseMode }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => 'unknown');
    throw new Error(`[Telegram] sendMessage failed: HTTP ${res.status} — ${err}`);
  }
  return await res.json();
}
