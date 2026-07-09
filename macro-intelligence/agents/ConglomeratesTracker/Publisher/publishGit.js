/**
 * GitPublisher for ConglomeratesTracker — commits the rendered report, the
 * updated MacroIntelligence root tab shell, and the department state files
 * (prior-cycle scorecard + research cache), then pushes.
 *
 * state.json MUST be committed: the next month's StrategyAdvisor reads it
 * as the prior scorecard to compute real deltas. Without it every cycle
 * starts from zero and the "delta vs previous cycle" column is fiction.
 *
 * Rebase-before-push per Best Practice #14: the daily pipeline commits to
 * main every morning, so our checkout may be behind by the time we push.
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

export function publishGit({ archivePath, latestPath, rootIndexPath, statePaths = [], cycleLabel, dryRun }) {
  if (dryRun) {
    console.log('[Publisher/Git] SKIP_GIT_PUSH set — skipping commit/push.');
    return { committed: false, skipped: true };
  }

  const paths = [archivePath, latestPath, rootIndexPath, ...statePaths]
    .filter(p => p && existsSync(p));
  if (!paths.length) throw new Error('[Publisher/Git] no files to commit');

  try {
    sh(`git add ${paths.map(p => `"${p}"`).join(' ')}`);
    const status = sh('git status --porcelain');
    if (!status) {
      console.log('[Publisher/Git] No changes to commit.');
      return { committed: false, reason: 'no-changes' };
    }
    sh(`git commit -m "ConglomeratesTracker: ${cycleLabel} cycle [skip ci]"`);

    // Rebase onto latest remote before push — the daily pipeline may have
    // advanced main since this run checked out.
    try {
      sh('git pull --rebase origin HEAD');
    } catch (err) {
      console.warn(`[Publisher/Git] Rebase failed (${err.message}) — attempting push anyway.`);
    }

    sh('git push origin HEAD');
    const sha = sh('git rev-parse --short HEAD');
    console.log(`[Publisher/Git] Pushed ${sha} for cycle ${cycleLabel}.`);
    return { committed: true, sha };
  } catch (err) {
    console.error(`[Publisher/Git] Push failed: ${err.message}`);
    throw err;
  }
}
