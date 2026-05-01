/**
 * GitPublisher for ConglomeratesTracker — commits the rendered report and
 * the updated MacroIntelligence root tab shell, then pushes.
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

export function publishGit({ archivePath, latestPath, rootIndexPath, cycleLabel, dryRun }) {
  if (dryRun) {
    console.log('[Publisher/Git] SKIP_GIT_PUSH set — skipping commit/push.');
    return { committed: false, skipped: true };
  }

  const paths = [archivePath, latestPath, rootIndexPath].filter(p => p && existsSync(p));
  if (!paths.length) throw new Error('[Publisher/Git] no files to commit');

  try {
    sh(`git add ${paths.map(p => `"${p}"`).join(' ')}`);
    const status = sh('git status --porcelain');
    if (!status) {
      console.log('[Publisher/Git] No changes to commit.');
      return { committed: false, reason: 'no-changes' };
    }
    sh(`git commit -m "ConglomeratesTracker: ${cycleLabel} cycle [skip ci]"`);
    sh('git push origin HEAD');
    const sha = sh('git rev-parse --short HEAD');
    console.log(`[Publisher/Git] Pushed ${sha} for cycle ${cycleLabel}.`);
    return { committed: true, sha };
  } catch (err) {
    console.error(`[Publisher/Git] Push failed: ${err.message}`);
    throw err;
  }
}
