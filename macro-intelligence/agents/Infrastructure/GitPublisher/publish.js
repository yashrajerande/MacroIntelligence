/**
 * GitPublisher — Commits and pushes the validated HTML file to GitHub.
 */

import { gitPublish } from './skills/git-ops.js';

export class GitPublisher {
  async publish(outputPath, dateStr, indexPath) {
    if (process.env.SKIP_GIT_PUSH === 'true') {
      console.log('[GitPublisher] SKIP_GIT_PUSH=true — skipping commit and push.');
      return;
    }

    const ghPat = process.env.GH_PAT;
    if (!ghPat) {
      throw new Error('[GitPublisher] Missing GH_PAT environment variable');
    }

    // Derive repo from GITHUB_REPOSITORY env var (set by GitHub Actions)
    const repo = process.env.GITHUB_REPOSITORY || 'yashrajerande/macrointelligence';
    const commitMessage = `Dashboard: ${dateStr} IST [skip ci]`;

    console.log(`[GitPublisher] Committing: ${commitMessage}`);
    const results = await gitPublish(outputPath, indexPath, commitMessage, ghPat, repo);

    console.log('[GitPublisher] Push complete.');
    return results;
  }
}

if (process.argv[1] && process.argv[1].includes('GitPublisher')) {
  console.log('[GitPublisher] Standalone mode — requires outputPath and dateStr.');
}
