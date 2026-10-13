/**
 * MP3 Encode Skill — shells out to ffmpeg to compress the WAV Gemini TTS
 * produces (~2.7MB/min uncompressed at 24kHz/16-bit mono) down to a
 * podcast-sized MP3. ffmpeg is standard on GitHub Actions' ubuntu-latest
 * runner but was NOT present in this build sandbox, so this is designed
 * to degrade gracefully rather than fail the whole feature: if ffmpeg
 * can't be found, encodeToMp3 returns null and the caller ships the WAV
 * instead (same "self-heal, don't hard-fail" discipline as every other
 * agent in this org).
 */

import { existsSync, writeFileSync, readFileSync, unlinkSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';

/**
 * Find the ffmpeg binary on the system. FFMPEG_PATH wins when set; the
 * GitHub runner has it on PATH as `ffmpeg`, so that's the fallback probe.
 * Mirrors screenshot.js's findChrome() pattern.
 * @returns {string|null}
 */
export function findFfmpeg() {
  const candidates = [
    process.env.FFMPEG_PATH,
    '/usr/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
  ].filter(Boolean);
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return 'ffmpeg';
  } catch {
    return null;
  }
}

/**
 * Encode a WAV buffer to MP3 via ffmpeg. Returns null (not a throw) if
 * ffmpeg isn't available — the caller is expected to fall back to
 * shipping the WAV directly rather than failing the run.
 *
 * @param {Buffer} wavBuffer
 * @param {object} [opts]
 * @param {string} [opts.bitrate] — e.g. '96k', a reasonable spoken-word MP3 rate
 * @returns {Buffer|null}
 */
export function encodeToMp3(wavBuffer, opts = {}) {
  const bitrate = opts.bitrate || '96k';
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) {
    console.warn('[Mp3Encode] ffmpeg not found — falling back to WAV output');
    return null;
  }

  const dir = mkdtempSync(join(tmpdir(), 'podcast-mp3-'));
  const inPath = join(dir, 'in.wav');
  const outPath = join(dir, 'out.mp3');

  try {
    writeFileSync(inPath, wavBuffer);
    execFileSync(ffmpeg, ['-y', '-i', inPath, '-codec:a', 'libmp3lame', '-b:a', bitrate, outPath], { stdio: 'ignore' });
    return readFileSync(outPath);
  } catch (err) {
    console.warn(`[Mp3Encode] ffmpeg encode failed, falling back to WAV output: ${err.message}`);
    return null;
  } finally {
    try { unlinkSync(inPath); } catch {}
    try { unlinkSync(outPath); } catch {}
  }
}
