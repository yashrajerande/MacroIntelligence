/**
 * News Search Skill — Uses Claude Haiku + web_search for category-specific news.
 */

import { searchAndExtract } from '../../../DataIntelligence/MacroDataAnalyst/skills/web-search.js';

const CATEGORY_QUERIES = {
  geo:     'geopolitics oil war Middle East trade tariffs latest today',
  ai:      'artificial intelligence AI breakthrough product launch latest today',
  india:   'India economy policy RBI markets budget reform latest today',
  fintech: 'global fintech banking digital payments Fed ECB latest today',
  ifs:     'India financial services banking NBFC insurance IPO latest today',
};

const EXTRACTION_PROMPT = `Return a JSON object with keys: headline (string, max 7 words, factual), url (real URL from search results, never "#"), source_name (publication name only), buzz_tag ("hot" if breaking, "viral" if widely shared, "watch" if emerging). Do NOT fabricate URLs.`;

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
