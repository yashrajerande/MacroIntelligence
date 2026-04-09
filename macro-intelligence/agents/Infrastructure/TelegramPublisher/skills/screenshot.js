/**
 * Screenshot Skill — Converts HTML to PNG using Puppeteer.
 * Uses system Chrome on GitHub Actions (no bundled Chromium).
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Find Chrome executable on the system.
 */
function findChrome() {
  const paths = [
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  for (const p of paths) {
    try {
      const { execSync } = await import('child_process');
      execSync(`test -f "${p}"`);
      return p;
    } catch { /* not found */ }
  }
  return null;
}

/**
 * Take a screenshot of HTML content and save as PNG.
 *
 * @param {string} html — Full HTML document string
 * @param {string} outputPath — Where to save the PNG
 * @param {object} options
 * @param {number} options.width — Viewport width (default 1080)
 * @param {number} options.height — Viewport height (default 1350)
 * @returns {Promise<Buffer>}
 */
export async function htmlToImage(html, outputPath, options = {}) {
  const { width = 1080, height = 1350 } = options;

  let puppeteer;
  try {
    puppeteer = await import('puppeteer-core');
  } catch {
    throw new Error('[Screenshot] puppeteer-core not installed. Run: npm install puppeteer-core');
  }

  const executablePath = findChrome();
  if (!executablePath) {
    throw new Error('[Screenshot] No Chrome/Chromium found on system');
  }

  const browser = await puppeteer.default.launch({
    executablePath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 2 }); // 2x for retina
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 15000 });

    // Wait for fonts to load
    await page.evaluate(() => document.fonts.ready);

    const buffer = await page.screenshot({
      type: 'png',
      clip: { x: 0, y: 0, width, height },
    });

    // Ensure output directory exists
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, buffer);

    console.log(`[Screenshot] Saved ${outputPath} (${buffer.length} bytes, ${width}x${height}@2x)`);
    return buffer;
  } finally {
    await browser.close();
  }
}
