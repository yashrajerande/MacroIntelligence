/**
 * Resilience — the pieces that turn an outage into a warning.
 *
 * The 09–14 SEP streak was six silent failures in a row: the Anthropic
 * balance hit zero, every run died 25 seconds in, and nobody found out
 * until the founder noticed the dashboard was stale. Nothing here makes
 * the world stop breaking; it makes the pipeline (a) notice before it
 * spends, (b) fall back to what it already knows, (c) try again later on
 * its own, and (d) tell a human within a minute.
 *
 *   classifyModelError(err)      — billing / auth / rate_limit / overloaded / server / null
 *   retryDelaysFor(kind)         — backoff schedule per error class
 *   preflightModelCheck()        — 1-token call so a dead key/empty balance fails fast
 *   alreadyPublished(isoDate)    — makes the second (retry) cron a no-op after success
 *   sendFailureAlert(...)        — Telegram message with the fix, not just the error
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
export const PUBLISHED_INDEX_PATH = join(ROOT, 'output', 'index.html');

// ── Error classification ───────────────────────────────────────────────

/**
 * Sort a model/API failure into the bucket that decides what to do next.
 * Works on the Anthropic SDK's APIError (status + message) and on plain
 * Errors whose message embeds the raw JSON body (the web-search skill
 * rethrows those).
 *
 * @returns {'billing'|'auth'|'rate_limit'|'overloaded'|'server'|null}
 */
export function classifyModelError(err) {
  if (!err) return null;
  const msg = String(err.message || err).toLowerCase();
  const status = Number(err.status || err.statusCode || (msg.match(/\b(4\d\d|5\d\d)\b/) || [])[1] || 0);

  if (/credit balance|purchase credits|plans\s*&\s*billing|billing/.test(msg)) return 'billing';
  if (status === 401 || status === 403 || /invalid x-api-key|authentication_error|permission_error|api key/.test(msg)) return 'auth';
  if (status === 429 || /rate_limit|rate limit|too many requests/.test(msg)) return 'rate_limit';
  if (status === 529 || /overloaded/.test(msg)) return 'overloaded';
  if (status >= 500 || /internal server error|api_error|econnreset|etimedout|socket hang up|fetch failed/.test(msg)) return 'server';
  return null;
}

/** Errors that no amount of retrying fixes — stop spending and alert. */
export function isTerminalModelError(kind) {
  return kind === 'billing' || kind === 'auth';
}

/**
 * Backoff schedule (ms) per error class. Transient classes get three
 * spaced retries; everything else keeps the original single retry so a
 * genuine bug still fails fast instead of looping for minutes.
 */
export function retryDelaysFor(kind) {
  switch (kind) {
    case 'rate_limit':  return [15000, 45000, 90000];
    case 'overloaded':  return [10000, 30000, 60000];
    case 'server':      return [5000, 20000, 60000];
    case 'billing':
    case 'auth':        return [];
    default:            return [5000];
  }
}

// ── Pre-flight ─────────────────────────────────────────────────────────

/**
 * One-token call to the cheapest model. Costs a fraction of a cent and
 * turns "spent $0.15 across five agents then died" into "failed in one
 * second with the reason and the fix in Telegram".
 *
 * @returns {Promise<{ ok: boolean, kind: string|null, message: string }>}
 */
export async function preflightModelCheck({ client, model = 'claude-haiku-4-5-20251001' } = {}) {
  try {
    if (!client) {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      client = new Anthropic();
    }
    await client.messages.create({ model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] });
    return { ok: true, kind: null, message: 'ok' };
  } catch (err) {
    const kind = classifyModelError(err);
    // Transient trouble at pre-flight is not a reason to abort — the
    // agents retry with backoff. Only terminal classes fail the run here.
    if (isTerminalModelError(kind)) return { ok: false, kind, message: err.message };
    return { ok: true, kind, message: `pre-flight saw ${kind || 'unknown'} error, continuing: ${err.message}` };
  }
}

// ── Idempotence ────────────────────────────────────────────────────────

/**
 * True when the committed output/index.html already carries this run
 * date. The workflow now fires twice a night (03:00 and a 05:00 IST retry
 * window); the second firing must be a no-op when the first succeeded,
 * or every good day would publish twice and pay twice.
 */
export function alreadyPublished(isoDate, indexPath = PUBLISHED_INDEX_PATH) {
  try {
    if (!existsSync(indexPath)) return false;
    const html = readFileSync(indexPath, 'utf8');
    const m = html.match(/"run_date"\s*:\s*"(\d{4}-\d{2}-\d{2})"/);
    return !!m && m[1] === isoDate;
  } catch {
    return false;
  }
}

// ── Alerting ───────────────────────────────────────────────────────────

const FIX_FOR = {
  billing:    'Top up credits: console.anthropic.com → Plans & Billing (check auto-reload is on).',
  auth:       'The ANTHROPIC_API_KEY secret is invalid or revoked. Create a new key and update the GitHub secret.',
  rate_limit: 'Anthropic rate limit. The 05:00 IST retry will pick it up; no action needed unless it repeats.',
  overloaded: 'Anthropic is overloaded. The 05:00 IST retry will pick it up; no action needed unless it repeats.',
  server:     'Upstream server error. The 05:00 IST retry will pick it up; no action needed unless it repeats.',
  supabase:   'Supabase is unreachable (paused?). Dashboard still published from cache; restore the project at supabase.com.',
  git:        'Could not push to GitHub. Check the GH_PAT secret has not expired.',
  validation: 'Validator rejected the edition. Open the run log; the rule that fired is named in the first ✗ line.',
  budget:     'Monthly budget cap reached. Raise the cap in cost-ledger config or wait for the new month.',
  unknown:    'Open the run log for the stack trace.',
};

/**
 * Build the Telegram alert text. Pure so the pre-flight suite can pin it.
 */
export function formatFailureAlert({ dateStr, kind, reason, runUrl, phase }) {
  const k = kind && FIX_FOR[kind] ? kind : 'unknown';
  const lines = [
    `🚨 <b>MacroIntelligence run FAILED — ${dateStr}</b>`,
    phase ? `Phase: ${phase}` : null,
    `Cause: <code>${escapeTg(String(reason || 'unknown').slice(0, 300))}</code>`,
    '',
    `<b>What to do:</b> ${escapeTg(FIX_FOR[k])}`,
    runUrl ? `<a href="${runUrl}">Open run log</a>` : null,
  ].filter(l => l !== null);
  return lines.join('\n');
}

function escapeTg(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Send the alert. Never throws — a failing alert on the failure path
 * must not mask the original error.
 */
export async function sendFailureAlert({ dateStr, kind, reason, runUrl, phase }) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return false;
  try {
    const { sendMessage } = await import('../../agents/Infrastructure/TelegramPublisher/skills/telegram-api.js');
    await sendMessage(token, chatId, formatFailureAlert({ dateStr, kind, reason, runUrl, phase }));
    console.log('  📣 Failure alert sent to Telegram');
    return true;
  } catch (err) {
    console.warn(`  ⚠ Could not send failure alert: ${err.message}`);
    return false;
  }
}

/** GitHub Actions exposes these; empty locally. */
export function currentRunUrl() {
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;
  if (!GITHUB_REPOSITORY || !GITHUB_RUN_ID) return null;
  return `${GITHUB_SERVER_URL || 'https://github.com'}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`;
}
