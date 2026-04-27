/**
 * RSS Feeds Skill — Fetches news from free RSS feeds (no web_search needed).
 * Parses XML with simple regex, no external XML parser required.
 *
 * Feed health is tracked: every fetch attempt logs success/failure/latency
 * per URL. The health report is available via getFeedHealth() for the
 * Operations Cockpit.
 */

const RSS_FEEDS = {
  geo: {
    urls: [
      'https://feeds.bbci.co.uk/news/world/rss.xml',
      'https://www.bloomberg.com/feed/podcast/etf-report.xml',
      'https://rss.nytimes.com/services/xml/rss/nyt/World.xml',
      'https://www.economist.com/the-world-this-week/rss.xml',
    ],
    source_name: 'World News',
  },
  ai: {
    urls: [
      'https://www.theverge.com/rss/index.xml',
      'https://www.technologyreview.com/feed/',
      'https://techcrunch.com/feed/',
      'https://feeds.arstechnica.com/arstechnica/technology-lab',
    ],
    source_name: 'Tech / AI',
  },
  india: {
    urls: [
      'https://www.thehindu.com/news/national/feeder/default.rss',
      'https://www.thehindubusinessline.com/economy/feeder/default.rss',
      'https://economictimes.indiatimes.com/rssfeedstopstories.cms',
      'https://www.livemint.com/rss/news',
    ],
    source_name: 'India News',
  },
  fintech: {
    urls: [
      'https://feeds.bbci.co.uk/news/business/rss.xml',
      'https://www.ft.com/?format=rss',
      'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml',
      'https://www.economist.com/finance-and-economics/rss.xml',
    ],
    source_name: 'Business / Finance',
  },
  ifs: {
    urls: [
      'https://www.thehindubusinessline.com/markets/feeder/default.rss',
      'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms',
      'https://www.moneycontrol.com/rss/latestnews.xml',
      'https://www.livemint.com/rss/markets',
    ],
    source_name: 'India Markets',
  },
};

// ── Feed Health Tracker ─────────────────────────────────────────────
// Records every fetch attempt with success/failure, latency, and item count.
// Persisted per-run; surfaced via getFeedHealth() for the Operations Cockpit.
const _feedHealthLog = [];

function logFeedAttempt(category, url, { ok, items, latencyMs, error }) {
  _feedHealthLog.push({
    category,
    url,
    ok,
    items: items || 0,
    latency_ms: latencyMs,
    error: error || null,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Returns the full feed health log for the current run.
 * Shape: [{ category, url, ok, items, latency_ms, error, timestamp }]
 */
export function getFeedHealth() {
  return _feedHealthLog;
}

/**
 * Returns a compact summary: per-category status + total stats.
 */
export function getFeedHealthSummary() {
  const categories = Object.keys(RSS_FEEDS);
  const summary = {};
  let totalAttempts = 0;
  let totalSuccess = 0;
  let totalFailed = 0;
  let totalLatency = 0;

  for (const cat of categories) {
    const entries = _feedHealthLog.filter(e => e.category === cat);
    const succeeded = entries.find(e => e.ok);
    const failures = entries.filter(e => !e.ok);
    totalAttempts += entries.length;
    totalSuccess += succeeded ? 1 : 0;
    totalFailed += failures.length;
    totalLatency += entries.reduce((sum, e) => sum + (e.latency_ms || 0), 0);

    summary[cat] = {
      status: succeeded ? 'ok' : 'failed',
      source_url: succeeded ? succeeded.url : null,
      items: succeeded ? succeeded.items : 0,
      latency_ms: succeeded ? succeeded.latency_ms : 0,
      attempts: entries.length,
      failures: failures.map(f => ({ url: f.url, error: f.error })),
    };
  }

  return {
    categories: summary,
    totals: {
      categories_ok: Object.values(summary).filter(s => s.status === 'ok').length,
      categories_failed: Object.values(summary).filter(s => s.status === 'failed').length,
      total_attempts: totalAttempts,
      total_successes: totalSuccess,
      total_failures: totalFailed,
      avg_latency_ms: totalAttempts ? Math.round(totalLatency / totalAttempts) : 0,
    },
  };
}

/**
 * Fetch a single RSS feed URL and parse its XML into items.
 * Returns array of { title, url, pubDate }.
 */
export async function fetchRSSFeed(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'MacroIntelligence/2.0 RSS Reader',
      Accept: 'application/rss+xml, application/xml, text/xml, application/atom+xml',
    },
    signal: AbortSignal.timeout(12_000),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const xml = await res.text();

  // Extract <item>...</item> or <entry>...</entry> blocks (RSS + Atom)
  const itemRegex = /<(?:item|entry)[\s>]([\s\S]*?)<\/(?:item|entry)>/gi;
  const items = [];
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];

    // Extract title — handle both plain text and CDATA
    const titleMatch = block.match(/<title[^>]*>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '';

    // Extract link — plain text, CDATA, or Atom href attribute
    let linkUrl = '';
    const linkMatch = block.match(/<link[^>]*href\s*=\s*["']([^"']+)["']/i);
    if (linkMatch) {
      linkUrl = linkMatch[1].trim();
    } else {
      const linkTextMatch = block.match(/<link[^>]*>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/link>/i);
      if (linkTextMatch) linkUrl = linkTextMatch[1].trim();
    }

    // Extract pubDate or updated (Atom)
    const dateMatch = block.match(/<(?:pubDate|updated|published)[^>]*>\s*([\s\S]*?)\s*<\/(?:pubDate|updated|published)>/i);
    const pubDate = dateMatch ? dateMatch[1].trim() : '';

    if (title) {
      items.push({ title, url: linkUrl, pubDate });
    }
  }

  return items;
}

/**
 * Try multiple RSS URLs for a category, return first that works.
 * Logs health for every attempt.
 */
async function fetchWithFallback(category, urls) {
  for (const url of urls) {
    const start = Date.now();
    try {
      const items = await fetchRSSFeed(url);
      const latencyMs = Date.now() - start;
      if (items.length > 0) {
        logFeedAttempt(category, url, { ok: true, items: items.length, latencyMs });
        return items;
      }
      logFeedAttempt(category, url, { ok: false, items: 0, latencyMs, error: 'empty feed' });
    } catch (err) {
      const latencyMs = Date.now() - start;
      logFeedAttempt(category, url, { ok: false, latencyMs, error: err.message });
    }
  }
  return [];
}

export async function fetchAllFeeds() {
  const categories = Object.keys(RSS_FEEDS);
  const results = await Promise.allSettled(
    categories.map(cat => fetchWithFallback(cat, RSS_FEEDS[cat].urls))
  );

  const feeds = {};
  for (let i = 0; i < categories.length; i++) {
    const cat = categories[i];
    feeds[cat] = results[i].status === 'fulfilled' ? results[i].value : [];
  }

  // Log summary
  const health = getFeedHealthSummary();
  console.log(`[NewsCurator] Feed health: ${health.totals.categories_ok}/5 categories OK, ` +
    `${health.totals.total_failures} failed attempts, avg latency ${health.totals.avg_latency_ms}ms`);
  for (const [cat, s] of Object.entries(health.categories)) {
    if (s.status === 'failed') {
      console.warn(`[NewsCurator] ⚠ ${cat}: ALL feeds failed — ${s.failures.map(f => f.url.split('/')[2] + ':' + f.error).join(', ')}`);
    }
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

    if (!items || items.length === 0) {
      return {
        category: cat,
        headline: 'Awaited',
        url: 'https://news.google.com',
        source_name: RSS_FEEDS[cat].source_name,
        buzz_tag: 'watch',
      };
    }

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
