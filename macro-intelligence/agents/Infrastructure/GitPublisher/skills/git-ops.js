/**
 * Git Operations Skill — Commit + push via child_process.
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Publish a file to GitHub via git add/commit/push.
 */
export async function gitPublish(filePath, indexPath, commitMessage, ghPat, repo) {
  const remoteUrl = `https://x-access-token:${ghPat}@github.com/${repo}.git`;

  const addIndex = indexPath ? `git add -f ${indexPath}` : null;
  // Derive output directory from the file path
  const outputDir = filePath.substring(0, filePath.lastIndexOf('/'));

  const commands = [
    'git config user.name "MacroIntelligence Corp"',
    'git config user.email "pipeline@macrointelligence.corp"',
    `git remote set-url origin ${remoteUrl}`,
    `git add -f ${filePath}`,
    ...(addIndex ? [addIndex] : []),
    `git add -f ${outputDir}/cost-ledger.json || echo "[Git] cost-ledger.json not found, skipping"`,
    `git add -f ${outputDir}/data-cache.json || echo "[Git] data-cache.json not found, skipping"`,
    `git add -f ${outputDir}/hook-history.json || echo "[Git] hook-history.json not found, skipping"`,
    `git add -f ${outputDir}/re-segments-history.json || echo "[Git] re-segments-history.json not found, skipping"`,
    `git add -f ${outputDir}/risk-history.json || echo "[Git] risk-history.json not found, skipping"`,
    `git add -f ${outputDir}/ops-cockpit.html || echo "[Git] ops-cockpit.html not found, skipping"`,
    `git add -f ${outputDir}/archive.html || echo "[Git] archive.html not found, skipping"`,
    `git add -f ${outputDir}/daily-broadcast.mp3 || echo "[Git] daily-broadcast.mp3 not found, skipping"`,
    `git commit -m "${commitMessage}"`,
    // No `|| true` here — a swallowed rebase failure (conflict, mid-rebase
    // state) used to fall straight through to the unconditional push
    // below. If the rebase stopped mid-way, HEAD could simply be a
    // commit already on origin/main, making that push a silent no-op:
    // this run's dashboard, cost-ledger update and cache update never
    // reach main, while the pipeline logs success and sends Telegram as
    // if they did. Letting this throw (same as every other command in
    // this list) means the orchestrator's existing withRetry() wrapper
    // around gitPublish() gets a real chance to re-fetch and retry
    // instead of publishing a no-op.
    'git pull --rebase origin main',
    'git push origin HEAD:refs/heads/main',
  ];

  const results = [];
  for (const cmd of commands) {
    try {
      // Mask the PAT in logs
      const safeCmd = cmd.replace(ghPat, '***');
      console.log(`[Git] ${safeCmd}`);
      const { stdout, stderr } = await execAsync(cmd);
      results.push({ cmd: safeCmd, stdout: stdout.trim(), stderr: stderr.trim() });
    } catch (err) {
      const safeCmd = cmd.replace(ghPat, '***');
      console.error(`[Git] FAILED: ${safeCmd} — ${err.message}`);
      throw new Error(`Git operation failed: ${safeCmd} — ${err.message}`);
    }
  }

  return results;
}
