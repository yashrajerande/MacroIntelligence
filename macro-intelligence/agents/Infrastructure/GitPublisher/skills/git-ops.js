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
    `git commit -m "${commitMessage}"`,
    'git push origin HEAD',
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
