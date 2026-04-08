/**
 * RSS Feeds Skill — Fetches news from free RSS feeds (no web_search needed).
 * Parses XML with simple regex, no external XML parser required.
 */

const RSS_FEEDS = {
  geo: {
    urls: [
      'https://rss.nytimes.com/services/xml/rss/nyt/World.xml',
      'https://feeds.bbci.co.uk/news/world/rss.xml',
      'https://feeds.reuters.com/reuters/worldNews',
    ],
    source_name: 'World News',
  },
  ai: {
    urls: [
      'https://techcrunch.com/feed/',
      'https://feeds.feedburner.com/TechCrunch',
      'https://www.theverge.com/rss/index.xml',
    ],
    source_name: 'Tech',
  },
  india: {
    urls: [
      'https://economictimes.indiatimes.com/rssfeedstopstories.cms',
      'https://timesofindia.indiatimes.com/rssfeedstopstories.cms',
      'https://www.livemint.com/rss/news',
    ],
    source_name: 'India News',
  },
  fintech: {
    urls: [
      'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml',
      'https://feeds.bbci.co.uk/news/business/rss.xml',
      'https://feeds.reuters.com/reuters/businessNews',
    ],
    source_name: 'Business',
  },
  ifs: {
    urls: [
      'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms',
      'https://www.moneycontrol.com/rss/latestnews.xml',
      'https://www.livemint.com/rss/markets',
    ],
    source_name: 'Markets',
  },
};

/**
 * Fetch a single RSS feed URL and parse its XML into items.
 * Returns array of { title, url, pubDate }.
 */
export async function fetchRSSFeed(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'MacroIntelligence/1.0 RSS Reader',
      Accept: 'application/rss+xml, application/xml, text/xml',
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`);
  }

  const xml = await res.text();

  // Extract <item>...</item> blocks
  const itemRegex = /<item[\s>]([\s\S]*?)<\/item>/gi;
  const items = [];
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];

    // Extract title — handle both plain text and CDATA
    const titleMatch = block.match(/<title[^>]*>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '';

    // Extract link — plain text or CDATA
    const linkMatch = block.match(/<link[^>]*>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/link>/i);
    const url = linkMatch ? linkMatch[1].trim() : '';

    // Extract pubDate
    const dateMatch = block.match(/<pubDate[^>]*>\s*([\s\S]*?)\s*<\/pubDate>/i);
    const pubDate = dateMatch ? dateMatch[1].trim() : '';

    if (title) {
      items.push({ title, url, pubDate });
    }
  }

  return items;
}

/**
 * Fetch all 5 RSS feeds in parallel.
 * Returns object keyed by category: { geo: [{title, url, pubDate}...], ai: [...], ... }
 */
/**
 * Try multiple RSS URLs for a category, return first that works.
 */
async function fetchWithFallback(urls) {
  for (const url of urls) {
    try {
      const items = await fetchRSSFeed(url);
      if (items.length > 0) return items;
    } catch {
      // Try next URL
    }
  }
  return [];
}

export async function fetchAllFeeds() {
  const categories = Object.keys(RSS_FEEDS);
  const results = await Promise.allSettled(
    categories.map(cat => fetchWithFallback(RSS_FEEDS[cat].urls))
  );

  const feeds = {};
  for (let i = 0; i < categories.length; i++) {
    const cat = categories[i];
    feeds[cat] = results[i].status === 'fulfilled' ? results[i].value : [];
  }

  return feeds;
}

/**
 * Truncate a title to roughly `n` words.
 */
function truncateWords(text, n = 7) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= n) return words.join(' ');
  return words.slice(0, n).join(' ') + '...';
}

/**
 * For each category, pick the most recent item.
 * Returns array of 5 news objects with category, headline, url, source_name, buzz_tag.
 */
export function pickTopNews(feeds) {
  const categories = Object.keys(RSS_FEEDS);
  const now = Date.now();
  const SIX_HOURS = 6 * 60 * 60 * 1000;

  return categories.map(cat => {
    const items = feeds[cat];

    // Fallback if feed is empty or missing
    if (!items || items.length === 0) {
      return {
        category: cat,
        headline: 'Awaited',
        url: 'https://news.google.com',
        source_name: RSS_FEEDS[cat].source_name,
        buzz_tag: 'watch',
      };
    }

    // Sort by pubDate descending (most recent first); unparseable dates go to the end
    const sorted = [...items].sort((a, b) => {
      const da = Date.parse(a.pubDate) || 0;
      const db = Date.parse(b.pubDate) || 0;
      return db - da;
    });

    const top = sorted[0];
    const parsedDate = Date.parse(top.pubDate) || 0;
    const isRecent = parsedDate > 0 && (now - parsedDate) < SIX_HOURS;

    return {
      category: cat,
      headline: truncateWords(top.title, 7),
      url: top.url || 'https://news.google.com',
      source_name: RSS_FEEDS[cat].source_name,
      buzz_tag: isRecent ? 'hot' : 'watch',
    };
  });
}
