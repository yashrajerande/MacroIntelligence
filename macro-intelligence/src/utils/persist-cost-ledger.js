#!/usr/bin/env node
/**
 * Persist a failed run's API spend to main — accounting only.
 *
 * Why: a run that fails after spending money used to write its cost only
 * to the runner's local output/cost-ledger.json, which is thrown away with
 * the ephemeral Actions runner. The next run checked out a ledger without
 * that spend and the $5/month cap under-bound.
 *
 * What it does (workflow step `if: failure() || cancelled()`):
 *   1. Replays the crash-safe usage journals (logs/cost-journal-*.jsonl,
 *      appended at every Anthropic response boundary — survives parse
 *      errors, exhausted retries and hard kills).
 *   2. Upserts one entry per run_id into the ledger (idempotent: a run
 *      already recorded, e.g. by the success path or a previous attempt of
 *      this step, is replaced, never added twice).
 *   3. Commits ONLY output/cost-ledger.json on top of the CURRENT
 *      origin/main, from a separate detached worktree — the failed run's
 *      half-written dashboard/cache files in the main checkout are never
 *      staged — and pushes. A rejected push (main moved) re-fetches and
 *      re-applies the upsert, up to 4 times with backoff.
 *
 * Concurrency: every workflow that writes the ledger shares the
 * `macrointelligence-publish` concurrency group, and this step runs inside
 * the same job, so no other ledger writer runs concurrently; the re-fetch
 * loop covers anything that slips past (e.g. a human push).
 *
 * SKIP_GIT_PUSH=true (manual "local output only" runs) is honoured: the
 * ledger is updated on disk only and nothing is pushed.
 */

import { execFileSync } from 'child_process';
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'fs';
import { join, dirname, relative } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { readJournal, runsFromJournal } from './usage-meter.js';
import { LEDGER_PATH, readLedger, writeLedger, upsertRunCost } from './cost-ledger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
export const JOURNAL_DIR = join(ROOT, 'logs');

export function journalPathFor(runId, dir = JOURNAL_DIR) {
  return join(dir, `cost-journal-${runId}.jsonl`);
}

export function collectJournalRuns(dir = JOURNAL_DIR) {
  if (!existsSync(dir)) return [];
  const lines = [];
  for (const f of readdirSync(dir)) {
    if (/^cost-journal-.*\.jsonl$/.test(f)) lines.push(...readJournal(join(dir, f)));
  }
  return runsFromJournal(lines).filter(r => r.summary.calls > 0);
}

/** Ledger `details` for a journal-replayed run. */
export function entryDetails(run, status) {
  const s = run.summary;
  return {
    status,
    pipeline: run.pipeline || null,
    cost_complete: s.cost_complete,
    unknown_usage_calls: s.unknown_usage_calls,
    partial_calls: s.partial_calls,
    calls: s.calls,
    usage: {
      input_tokens: s.input_tokens,
      output_tokens: s.output_tokens,
      cache_creation_5m_input_tokens: s.cache_creation_5m_input_tokens,
      cache_creation_1h_input_tokens: s.cache_creation_1h_input_tokens,
      cache_read_input_tokens: s.cache_read_input_tokens,
      web_search_requests: s.web_search_requests,
    },
    source: 'failure-journal',
  };
}

/**
 * Apply journal runs to a ledger object. A run the local ledger already
 * recorded keeps that entry's status (e.g. 'success' when the run
 * recorded cost and then failed while pushing).
 */
export function applyRuns(ledger, runs, localLedger = null) {
  let changed = false;
  for (const run of runs) {
    let status = 'failed';
    for (const m of Object.values(localLedger?.months || {})) {
      const hit = (m.runs || []).find(r => r.run_id === run.run_id);
      if (hit?.status) status = hit.status;
    }
    const date = run.iso_date || new Date().toISOString().slice(0, 10);
    changed = upsertRunCost(ledger, date, run.summary.cost_usd, run.run_id, entryDetails(run, status)) || changed;
  }
  return changed;
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Commit the upserted ledger to `remote`/`branch` from an isolated
 * worktree. Returns { pushed, sha?, reason? }.
 */
export async function pushLedger({
  runs,
  repoDir = ROOT,
  ledgerPath = LEDGER_PATH,
  remote = 'origin',
  branch = 'main',
  attempts = 4,
  backoffMs = [2000, 5000, 10000, 20000],
  message = null,
} = {}) {
  const top = git(repoDir, ['rev-parse', '--show-toplevel']);
  const rel = relative(top, ledgerPath);
  const localLedger = readLedger(ledgerPath);

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const wt = mkdtempSync(join(tmpdir(), 'ledger-wt-'));
    try {
      git(top, ['fetch', '--quiet', remote, branch]);
      git(top, ['worktree', 'add', '--quiet', '--detach', wt, 'FETCH_HEAD']);
      const wtLedgerPath = join(wt, rel);
      const remoteLedger = readLedger(wtLedgerPath);
      if (!applyRuns(remoteLedger, runs, localLedger)) {
        return { pushed: false, reason: 'already-recorded' };
      }
      writeLedger(remoteLedger, wtLedgerPath);
      git(wt, ['add', '--', rel]);
      const ids = runs.map(r => r.run_id.slice(0, 13)).join(', ');
      git(wt, ['commit', '--quiet', '-m', message || `Cost ledger: record spend of failed run(s) ${ids} [skip ci]`]);
      try {
        git(wt, ['push', '--quiet', remote, `HEAD:refs/heads/${branch}`]);
        return { pushed: true, sha: git(wt, ['rev-parse', '--short', 'HEAD']), attempt };
      } catch (err) {
        if (attempt === attempts) throw err;
        console.warn(`  ⚠ ledger push rejected (attempt ${attempt}/${attempts}) — re-fetching: ${err.message.split('\n')[0]}`);
      }
    } finally {
      try { git(top, ['worktree', 'remove', '--force', wt]); } catch { /* not created */ }
      rmSync(wt, { recursive: true, force: true });
    }
    await sleep(backoffMs[attempt - 1] ?? 20000);
  }
  return { pushed: false, reason: 'exhausted' };
}

export async function persistFailedRunCosts({
  journalDir = JOURNAL_DIR,
  ledgerPath = LEDGER_PATH,
  repoDir = ROOT,
  skipPush = process.env.SKIP_GIT_PUSH === 'true',
  ...pushOpts
} = {}) {
  const runs = collectJournalRuns(journalDir);
  if (runs.length === 0) {
    console.log('[persist-cost-ledger] No metered API calls in this job — nothing to persist.');
    return { runs: 0, pushed: false, reason: 'no-spend' };
  }
  for (const r of runs) {
    const s = r.summary;
    console.log(`[persist-cost-ledger] run ${r.run_id} (${r.pipeline || '?'}, ${r.iso_date}): ` +
      `$${s.cost_usd.toFixed(4)} over ${s.calls} call(s)` +
      (s.unknown_usage_calls ? `, ${s.unknown_usage_calls} with UNKNOWN usage (not priced)` : ''));
  }

  // Local copy first: the failure artifact then shows the same numbers.
  const localLedger = readLedger(ledgerPath);
  const localCopy = JSON.parse(JSON.stringify(localLedger));
  if (applyRuns(localLedger, runs, localCopy)) writeLedger(localLedger, ledgerPath);

  if (skipPush) {
    console.log('[persist-cost-ledger] SKIP_GIT_PUSH=true — ledger updated locally only, not pushed.');
    return { runs: runs.length, pushed: false, reason: 'skip-git-push' };
  }
  const res = await pushLedger({ runs, repoDir, ledgerPath, ...pushOpts });
  console.log(`[persist-cost-ledger] ${res.pushed ? `pushed ${res.sha}` : `not pushed (${res.reason})`}`);
  return { runs: runs.length, ...res };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  persistFailedRunCosts().then(() => process.exit(0)).catch(err => {
    console.error(`[persist-cost-ledger] FAILED to persist accounting: ${err.message}`);
    process.exit(1);
  });
}
