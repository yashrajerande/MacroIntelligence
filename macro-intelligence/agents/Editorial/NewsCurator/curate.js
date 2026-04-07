/**
 * NewsCurator — Uses Claude Haiku + web_search for 5 news items.
 */

import { searchAllNews } from './skills/news-search.js';

export class NewsCurator {
  async curate(isoDate) {
    const start = Date.now();

    console.log('[NewsCurator] Searching for news across 5 categories...');
    const result = await searchAllNews();

    const latency = Date.now() - start;
    console.log(`[NewsCurator] Done in ${latency}ms. ${result.data.length} news items.`);

    return {
      data: result.data,
      meta: {
        agent: 'NewsCurator',
        model: 'claude-haiku-4-5-20251001',
        latency_ms: latency,
        tokens: result.tokens,
      },
    };
  }
}

if (process.argv[1] && process.argv[1].includes('NewsCurator')) {
  const { isoDate } = (await import('../../../src/utils/ist-date.js')).getISTDate();
  new NewsCurator().curate(isoDate).then(r => {
    console.log(JSON.stringify(r.data, null, 2));
  }).catch(err => { console.error(err); process.exit(1); });
}
