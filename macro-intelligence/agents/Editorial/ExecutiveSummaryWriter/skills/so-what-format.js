/**
 * So-What Format Skill — deterministic builder for executive-summary
 * sections.
 *
 * The model returns structured fields (title, facts[], tension,
 * bottom_line); this module turns them into the one HTML shape the
 * dashboard, the Highlights PDF and Supabase all consume. Building the
 * markup here rather than asking the model for HTML means the structure
 * can never drift, a missing field degrades to a labelled gap instead of
 * a broken layout, and the pre-flight suite can pin the exact output.
 *
 * No SDK imports on purpose: test.js loads this without an API key.
 *
 * Output shape (tags only, no attributes — the PDF sanitiser strips
 * attributes and the dashboard styles by tag):
 *
 *   <h4>Title — Named Tension</h4>
 *   <p><b>The facts:</b></p>
 *   <ul><li>…</li><li>…</li></ul>
 *   <p><b>The tension:</b> …</p>
 *   <p><b>Bottom line:</b> …</p>
 */

export const SO_WHAT_LABELS = {
  facts: 'The facts:',
  tension: 'The tension:',
  bottom: 'Bottom line:',
};

export const SO_WHAT_LIMITS = {
  titleWordsMax: 12,
  factsMin: 3,
  factsMax: 5,
  tensionWordsMax: 45,
  bottomWordsMax: 30,
  sectionWordsMax: 130,
};

/**
 * Keep only inline emphasis the reader-facing surfaces support. The model
 * is told to use <strong> for figures; anything else it emits (a stray
 * <p>, an <a>, a script) is dropped, and attributes are stripped from
 * what remains.
 */
export function inlineOnly(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(?!\/?(?:strong|em|b|i)\b)[^>]*>/gi, '')
    .replace(/<(\/?)(strong|em|b|i)\b[^>]*>/gi, '<$1$2>')
    .replace(/\s+/g, ' ')
    .trim();
}

function words(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Build the section HTML from structured fields.
 *
 * @param {object} section
 * @param {string} section.title
 * @param {string[]} section.facts
 * @param {string} section.tension
 * @param {string} section.bottom_line
 * @param {string} [fallbackTitle] — used when the model omits the title
 * @returns {string} HTML
 */
export function formatSoWhat(section = {}, fallbackTitle = '') {
  const title = inlineOnly(section.title) || inlineOnly(fallbackTitle);
  const facts = (Array.isArray(section.facts) ? section.facts : [])
    .map(inlineOnly)
    .filter(Boolean)
    .slice(0, SO_WHAT_LIMITS.factsMax);
  const tension = inlineOnly(section.tension);
  const bottom = inlineOnly(section.bottom_line);

  const parts = [];
  if (title) parts.push(`<h4>${title}</h4>`);
  if (facts.length) {
    parts.push(`<p><b>${SO_WHAT_LABELS.facts}</b></p>`);
    parts.push(`<ul>${facts.map(f => `<li>${f}</li>`).join('')}</ul>`);
  }
  if (tension) parts.push(`<p><b>${SO_WHAT_LABELS.tension}</b> ${tension}</p>`);
  if (bottom) parts.push(`<p><b>${SO_WHAT_LABELS.bottom}</b> ${bottom}</p>`);
  return parts.join('');
}

/**
 * True when a paragraph object carries the structured fields (as opposed
 * to legacy free-prose `para_html`). Used to keep the old path working if
 * the model ever answers in the old shape.
 */
export function hasSoWhatFields(p) {
  return !!p && (Array.isArray(p.facts) || typeof p.tension === 'string' || typeof p.bottom_line === 'string');
}

/**
 * Lint a section against the hard rules. Returns a list of human-readable
 * problems (empty when clean). Warn-only by design: the run publishes,
 * the ops log shows where the writer drifted.
 */
export function lintSoWhat(section = {}, label = '') {
  const problems = [];
  const tag = label ? `[${label}] ` : '';
  const title = inlineOnly(section.title);
  const facts = (Array.isArray(section.facts) ? section.facts : []).map(inlineOnly).filter(Boolean);
  const tension = inlineOnly(section.tension);
  const bottom = inlineOnly(section.bottom_line);

  if (!title) problems.push(`${tag}missing title`);
  else if (words(title) > SO_WHAT_LIMITS.titleWordsMax) problems.push(`${tag}title is ${words(title)} words (max ${SO_WHAT_LIMITS.titleWordsMax})`);
  if (label && title && title.toLowerCase() === label.toLowerCase()) problems.push(`${tag}title is just the section label — name the tension`);

  if (facts.length < SO_WHAT_LIMITS.factsMin) problems.push(`${tag}only ${facts.length} fact(s) (min ${SO_WHAT_LIMITS.factsMin})`);
  if (facts.length > SO_WHAT_LIMITS.factsMax) problems.push(`${tag}${facts.length} facts (max ${SO_WHAT_LIMITS.factsMax})`);
  facts.forEach((f, i) => {
    if (!/\d/.test(f)) problems.push(`${tag}fact ${i + 1} has no number`);
    if (/^the\b/i.test(f.replace(/<[^>]+>/g, '').trim())) problems.push(`${tag}fact ${i + 1} starts with "The"`);
  });

  if (!tension) problems.push(`${tag}missing tension`);
  else if (words(tension) > SO_WHAT_LIMITS.tensionWordsMax) problems.push(`${tag}tension is ${words(tension)} words (max ${SO_WHAT_LIMITS.tensionWordsMax})`);

  if (!bottom) problems.push(`${tag}missing bottom line`);
  else if (words(bottom) > SO_WHAT_LIMITS.bottomWordsMax) problems.push(`${tag}bottom line is ${words(bottom)} words (max ${SO_WHAT_LIMITS.bottomWordsMax})`);

  const total = words(title) + facts.reduce((n, f) => n + words(f), 0) + words(tension) + words(bottom);
  if (total > SO_WHAT_LIMITS.sectionWordsMax) problems.push(`${tag}section is ${total} words (max ${SO_WHAT_LIMITS.sectionWordsMax})`);

  return problems;
}
