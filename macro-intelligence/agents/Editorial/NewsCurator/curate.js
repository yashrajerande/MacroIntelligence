/**
 * NewsCurator — Uses RSS feeds + a single Claude Haiku call for summaries.
 */

import Anthropic from '@anthropic-ai/sdk';
import { fetchAllFeeds, pickTopNews, getFeedHealthSummary } from './skills/rss-feeds.js';

const client = new Anthropic();

export class NewsCurator {
  async curate(isoDate) {
    const start = Date.now();
    let tokens = { input: 0, output: 0 };

    console.log('[NewsCurator] Fetching RSS feeds across 5 categories...');
    const feeds = await fetchAllFeeds();
    const newsItems = pickTopNews(feeds);

    console.log(`[NewsCurator] Picked ${newsItems.length} top items. Calling Haiku for refinement...`);

    // Single Haiku call to refine all 5 headlines + buzz_tags at once
    try {
      const prompt = newsItems.map((item, i) =>
        `${i + 1}. [${item.category}] "${item.headline}" (source: ${item.source_name}, buzz: ${item.buzz_tag})`
      ).join('\n');

      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        system: [{
          type: 'text',
          text: 'You are a concise news editor. Given 5 news headlines with categories, refine each headline to be punchier (max 7 words) and confirm or adjust the buzz_tag (hot/watch). Return ONLY a JSON array of 5 objects with keys: "category", "headline", "buzz_tag". No explanation.',
          cache_control: { type: 'ephemeral' },
        }],
        messages: [{
          role: 'user',
          content: `Today is ${isoDate}. Refine these headlines:\n${prompt}`,
        }],
      });

      tokens.input = response.usage?.input_tokens || 0;
      tokens.output = response.usage?.output_tokens || 0;

      // Parse Haiku's response
      let fullText = '';
      for (const block of response.content) {
        if (block.type === 'text') fullText += block.text;
      }

      const jsonMatch = fullText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const refined = JSON.parse(jsonMatch[0]);
        if (Array.isArray(refined) && refined.length === newsItems.length) {
          for (let i = 0; i < newsItems.length; i++) {
            if (refined[i].headline) newsItems[i].headline = refined[i].headline.slice(0, 60);
            if (['hot', 'watch'].includes(refined[i].buzz_tag)) newsItems[i].buzz_tag = refined[i].buzz_tag;
          }
        }
      }

      console.log('[NewsCurator] Haiku refinement applied.');
    } catch (err) {
      console.warn('[NewsCurator] Haiku refinement failed, using raw RSS headlines:', err.message);
      // tokens stay at 0 — raw headlines used as-is
    }

    const latency = Date.now() - start;
    console.log(`[NewsCurator] Done in ${latency}ms. ${newsItems.length} news items.`);

    return {
      data: newsItems,
      feedHealth: getFeedHealthSummary(),
      meta: {
        agent: 'NewsCurator',
        model: 'claude-haiku-4-5-20251001',
        latency_ms: latency,
        tokens,
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
