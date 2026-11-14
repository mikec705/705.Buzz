const fs = require('fs');
const Parser = require('rss-parser');
const cheerio = require('cheerio');

const parser = new Parser({
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; 705BuzzBot/1.0; +https://705.buzz)' }
});

const FALLBACK_IMAGES = {
  News: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=800&q=80',
  Events: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=800&q=80',
  Weather: 'https://images.unsplash.com/photo-1491002052546-bf38f186af56?auto=format&fit=crop&w=800&q=80',
  Community: 'https://images.unsplash.com/photo-1488459716781-31db52582fe9?auto=format&fit=crop&w=800&q=80'
};

function cleanText(str = '') {
  return str.replace(/<[^>]*>?/gm, '').replace(/\s+/g, ' ').trim();
}

// 1. Handler for RSS / Atom XML Feeds
async function scrapeRssSource(source, startOrder) {
  const feed = await parser.parseURL(source.url);
  return (feed.items || []).slice(0, 6).map((item, idx) => {
    const rawImg = item.enclosure?.url || item.thumbnail || '';
    return {
      id: `${source.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${idx}`,
      title: cleanText(item.title || 'Untitled Update'),
      category: source.category || 'News',
      source: source.name,
      location: source.location || 'Simcoe County',
      timestamp: item.pubDate
        ? new Date(item.pubDate).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
        : 'Latest',
      sortOrder: startOrder - idx,
      buzzScore: Math.floor(Math.random() * 18) + 80,
      summary: cleanText(item.contentSnippet || item.content || item.summary || '').slice(0, 240) + '...',
      image: rawImg || FALLBACK_IMAGES[source.category] || FALLBACK_IMAGES.News,
      url: item.link || source.url,
      tags: [source.location.split(',')[0], source.category, source.name]
    };
  });
}

// 2. Handler for Standard Websites (No RSS Needed - Scrapes OpenGraph Metadata)
async function scrapeHtmlSource(source, startOrder) {
  const res = await fetch(source.url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' }
  });
  const html = await res.text();
  const $ = cheerio.load(html);

  const selector = source.linkSelector || 'article a, h2 a, h3 a, .event a';
  const discoveredUrls = new Set();

  $(selector).each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    try {
      const fullUrl = new URL(href, source.url).href;
      if (fullUrl !== source.url && fullUrl.startsWith('http')) {
        discoveredUrls.add(fullUrl);
      }
    } catch (e) {}
  });

  // If the link is a single article/event page itself, scrape that URL directly
  const urlsToScrape = discoveredUrls.size > 0 ? Array.from(discoveredUrls).slice(0, 4) : [source.url];
  const results = [];

  for (let i = 0; i < urlsToScrape.length; i++) {
    const pageUrl = urlsToScrape[i];
    try {
      const pageRes = await fetch(pageUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' }
      });
      const pageHtml = await pageRes.text();
      const $page = cheerio.load(pageHtml);

      const title =
        $page('meta[property="og:title"]').attr('content') ||
        $page('meta[name="twitter:title"]').attr('content') ||
        $page('h1').first().text() ||
        $page('title').text();

      const desc =
        $page('meta[property="og:description"]').attr('content') ||
        $page('meta[name="description"]').attr('content') ||
        $page('article p, main p, p').first().text();

      let img =
        $page('meta[property="og:image"]').attr('content') ||
        $page('meta[name="twitter:image"]').attr('content') ||
        FALLBACK_IMAGES[source.category] ||
        FALLBACK_IMAGES.News;

      if (img && !img.startsWith('http')) {
        img = new URL(img, pageUrl).href;
      }

      if (cleanText(title).length > 5) {
        results.push({
          id: `${source.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-web-${i}`,
          title: cleanText(title),
          category: source.category || 'News',
          source: source.name,
          location: source.location || 'Barrie, ON',
          timestamp: 'Recent',
          sortOrder: startOrder - i,
          buzzScore: Math.floor(Math.random() * 15) + 82,
          summary: cleanText(desc || 'Click through to read full details on ' + source.name).slice(0, 240) + '...',
          image: img,
          url: pageUrl,
          tags: [source.location.split(',')[0], source.category, 'Web Scrape']
        });
      }
    } catch (err) {
      console.warn(`Skipped page ${pageUrl}: ${err.message}`);
    }
  }
  return results;
}

// Main Runner
(async () => {
  const sources = JSON.parse(fs.readFileSync('./sources.json', 'utf8'));
  const allStories = [];
  let orderCounter = 2000;

  for (const src of sources) {
    try {
      console.log(`Scraping [${src.type.toUpperCase()}]: ${src.name} (${src.url})`);
      const items =
        src.type === 'html'
          ? await scrapeHtmlSource(src, orderCounter)
          : await scrapeRssSource(src, orderCounter);
      allStories.push(...items);
      orderCounter -= 20;
    } catch (err) {
      console.error(`Error scraping ${src.name}:`, err.message);
    }
  }

  // Deduplicate by title
  const seen = new Set();
  const uniqueStories = allStories.filter(s => {
    const key = s.title.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (uniqueStories.length > 0) {
    fs.writeFileSync('./stories.json', JSON.stringify(uniqueStories, null, 2));
    console.log(`Saved ${uniqueStories.length} stories to stories.json`);
  }
})();