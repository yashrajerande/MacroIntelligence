/**
 * TTS API Skill — Converts text to speech via OpenAI's TTS API.
 * Uses raw fetch (no SDK dependency).
 *
 * Requires OPENAI_API_KEY environment variable.
 */

const TTS_ENDPOINT = 'https://api.openai.com/v1/audio/speech';

/**
 * Generate speech audio from text.
 *
 * @param {string} text — The script to speak
 * @param {object} options
 * @param {string} options.voice — OpenAI voice: 'alloy'|'echo'|'fable'|'onyx'|'nova'|'shimmer'
 * @param {string} options.model — 'tts-1' (fast) or 'tts-1-hd' (high quality)
 * @param {number} options.speed — 0.25 to 4.0 (default 1.0)
 * @returns {Promise<Buffer>} — MP3 audio buffer
 */
export async function generateSpeech(text, options = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('[TTS] Missing OPENAI_API_KEY environment variable');
  }

  const {
    voice = 'onyx',       // warm baritone
    model = 'tts-1-hd',   // high quality
    speed = 0.95,          // slightly slower for gravitas
  } = options;

  console.log(`[TTS] Generating speech: ${text.length} chars, voice=${voice}, model=${model}, speed=${speed}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

  try {
    const res = await fetch(TTS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: text,
        voice,
        response_format: 'mp3',
        speed,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const errText = await res.text().catch(() => 'unknown');
      throw new Error(`[TTS] HTTP ${res.status}: ${errText}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    console.log(`[TTS] Generated ${buffer.length} bytes of MP3 audio`);

    // Estimate cost: tts-1-hd is $30 per 1M chars
    const costEstimate = (text.length / 1_000_000) * 30;
    return { buffer, costEstimate };
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      throw new Error('[TTS] Request timed out after 30s');
    }
    throw err;
  }
}
