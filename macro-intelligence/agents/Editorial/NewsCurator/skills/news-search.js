/**
 * News Search Skill — Uses Claude Haiku + web_search for category-specific news.
 */

import { searchAndExtract } from '../../../DataIntelligence/MacroDataAnalyst/skills/web-search.js';

const CATEGORY_QUERIES = {
  geo:     'top geopolitics news today war trade sanctions tariffs oil Reuters AP',
  ai:      'top artificial intelligence AI news today product launch funding Reuters',
  india:   'India economy news today RBI GDP markets policy reform',
  fintech: 'fintech news today digital payments crypto banking regulation global',
  ifs:     'India financial services news today NBFC banking insurance SEBI IPO',
};

const EXTRACTION_PROMPT = `From the search results, pick the single most important story. Return ONLY a JSON object (no markdown, no explanation) with these exact keys: "headline" (max 7 words, factual), "url" (a real URL from the search results, never "#" or made up), "source_name" (publication name like "Reuters", "Bloomberg", etc.), "buzz_tag" (one of: "hot", "viral", "watch"). Example: {"headline":"Fed holds rates amid trade war","url":"https://reuters.com/...","source_name":"Reuters","buzz_tag":"hot"}`;

export async function searchNewsByCategory(category) {
  const query = CATEGORY_QUERIES[category];
  if (!query) throw new Error(`Unknown news category: ${category}`);

  const result = await searchAndExtract(query, EXTRACTION_PROMPT);

  if (result.error || !result.data) {
    return {
      category,
      headline: 'Awaited',
      url: 'https://news.google.com',
      source_name: 'Awaited',
      buzz_tag: 'watch',
      tokens: result.tokens || { input: 0, output: 0 },
    };
  }

  return {
    category,
    headline: (result.data.headline || 'Awaited').slice(0, 60),
    url: result.data.url && result.data.url !== '#' ? result.data.url : 'https://news.google.com',
    source_name: result.data.source_name || 'Awaited',
    buzz_tag: ['hot', 'viral', 'watch'].includes(result.data.buzz_tag) ? result.data.buzz_tag : 'watch',
    tokens: result.tokens || { input: 0, output: 0 },
  };
}

export async function searchAllNews() {
  const categories = Object.keys(CATEGORY_QUERIES);
  const results = await Promise.allSettled(
    categories.map(cat => searchNewsByCategory(cat))
  );

  let totalTokens = { input: 0, output: 0 };
  const news = results.map((r, i) => {
    if (r.status === 'fulfilled') {
      totalTokens.input += r.value.tokens?.input || 0;
      totalTokens.output += r.value.tokens?.output || 0;
      const { tokens, ...item } = r.value;
      return item;
    }
    return {
      category: categories[i],
      headline: 'Awaited',
      url: 'https://news.google.com',
      source_name: 'Awaited',
      buzz_tag: 'watch',
    };
  });

  return { data: news, tokens: totalTokens };
}
