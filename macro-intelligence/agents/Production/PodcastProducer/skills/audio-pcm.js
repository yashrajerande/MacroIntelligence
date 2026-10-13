/**
 * Audio PCM Skill — pure functions for assembling raw PCM samples (what
 * Gemini's TTS API returns per chunk) into one playable WAV file.
 *
 * Gemini's multi-speaker TTS returns headerless 16-bit signed PCM, mono,
 * 24kHz by default (per the Gemini API speech-generation docs at the
 * time this was built — reconfirm the sample rate against the actual
 * response if a real run ever produces garbled/sped-up audio, since
 * that is the single symptom of this constant being wrong). Multiple
 * TTS calls (one per script chunk) each return their own PCM payload;
 * because every chunk uses the identical format, the raw samples can be
 * concatenated directly and wrapped in exactly ONE WAV header — no
 * re-encoding needed between chunks.
 *
 * Pure and side-effect-free — no network, no filesystem.
 */

export const PCM_SAMPLE_RATE = 24000;
export const PCM_CHANNELS = 1;
export const PCM_BIT_DEPTH = 16;

/**
 * Concatenate raw PCM buffers from multiple TTS calls into one buffer.
 * Order matters — pass them in script order.
 * @param {Buffer[]} pcmBuffers
 * @returns {Buffer}
 */
export function concatenatePcm(pcmBuffers) {
  const valid = (pcmBuffers || []).filter(b => b && b.length);
  if (!valid.length) throw new Error('[AudioPCM] No PCM audio to concatenate');
  return Buffer.concat(valid);
}

/**
 * Wrap raw PCM samples in a standard 44-byte WAV (RIFF) header, making
 * them a playable audio file. Pure byte-math — no audio library needed
 * for this one format.
 *
 * @param {Buffer} pcmData — raw interleaved PCM samples
 * @param {object} [opts]
 * @param {number} [opts.sampleRate]
 * @param {number} [opts.channels]
 * @param {number} [opts.bitDepth]
 * @returns {Buffer} a complete .wav file
 */
export function pcmToWav(pcmData, opts = {}) {
  const sampleRate = opts.sampleRate || PCM_SAMPLE_RATE;
  const channels = opts.channels || PCM_CHANNELS;
  const bitDepth = opts.bitDepth || PCM_BIT_DEPTH;

  if (!pcmData || !pcmData.length) throw new Error('[AudioPCM] Cannot build a WAV from empty PCM data');

  const blockAlign = channels * (bitDepth / 8);
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcmData.length;

  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);            // fmt chunk size (PCM)
  header.writeUInt16LE(1, 20);             // audio format: 1 = PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitDepth, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmData]);
}

/**
 * Rough spoken-duration estimate from PCM byte length, for logging only
 * (not used for any TTS call sizing decision — chunking is word-based).
 * @returns {number} seconds
 */
export function estimateDurationSeconds(pcmData, opts = {}) {
  const sampleRate = opts.sampleRate || PCM_SAMPLE_RATE;
  const channels = opts.channels || PCM_CHANNELS;
  const bitDepth = opts.bitDepth || PCM_BIT_DEPTH;
  const bytesPerSecond = sampleRate * channels * (bitDepth / 8);
  return bytesPerSecond > 0 ? Math.round((pcmData.length / bytesPerSecond) * 10) / 10 : 0;
}
