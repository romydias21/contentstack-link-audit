const { chromium } = require('playwright-chromium');
const { fetch } = require('undici');
const { XMLParser } = require('fast-xml-parser');
const cheerio = require('cheerio');
const zlib = require('zlib');
const { TaskQueue } = require('./task-queue');
const { isSkippableHref, normalizeUrl, sameOrigin, sleep } = require('./utils');

const DEFAULT_CONFIG = {
  maxPages: Number(process.env.MAX_PAGES) || 20000,
  crawlConcurrency: Number(process.env.CRAWL_CONCURRENCY) || 3,
  checkConcurrency: Number(process.env.CHECK_CONCURRENCY) || 10,
  timeoutMs: Number(process.env.REQUEST_TIMEOUT_MS) || 20000,
  maxRedirects: Number(process.env.MAX_REDIRECTS) || 5,
  retryLimit: Number(process.env.RETRY_LIMIT) || 2,
  userAgent: process.env.USER_AGENT || 'ContentstackLinkAuditBot/1.0',
  sitemapLimit: Number(process.env.SITEMAP_LIMIT) || 50
};

function ensureArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function parseSitemapXml(xml) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    allowBooleanAttributes: true
  });
  const data = parser.parse(xml);
  const urls = [];
  const sitemaps = [];

  if (data?.urlset?.url) {
    ensureArray(data.urlset.url).forEach((item) => {
      if (item?.loc) urls.push(item.loc.trim());
    });
  }

  if (data?.sitemapindex?.sitemap) {
    ensureArray(data.sitemapindex.sitemap).forEach((item) => {
      if (item?.loc) sitemaps.push(item.loc.trim());
    });
  }

  return { urls, sitemaps };
}

async function fetchText(url, timeoutMs, userAgent) {
  const res = await fetchWithTimeout(
    url,
    {
      method: 'GET',
      headers: {
        'User-Agent': userAgent,
        Accept: 'text/xml,application/xml,text/plain;q=0.9,*/*;q=0.8'
      }
    },
    timeoutMs
  );

  if (!res.ok) {
    res.body?.cancel();
    return null;
  }

  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const encoding = res.headers.get('content-encoding') || '';
  const isGzip = encoding.includes('gzip') || url.endsWith('.gz');
  return (isGzip ? zlib.gunzipSync(buffer) : buffer).toString('utf-8');
}

async function fetchSitemapUrls(origin, config) {
  const candidates = [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];
  const allUrls = new Set();

  for (const candidate of candidates) {
    let xml = null;
    try {
      xml = await fetchText(candidate, config.timeoutMs, config.userAgent);
    } catch (err) {
      xml = null;
    }
    if (!xml) continue;

    const parsed = parseSitemapXml(xml);
    parsed.urls.forEach((url) => allUrls.add(url));

    const sitemapUrls = parsed.sitemaps.slice(0, config.sitemapLimit);
    for (const sitemapUrl of sitemapUrls) {
      try {
        const sitemapXml = await fetchText(sitemapUrl, config.timeoutMs, config.userAgent);
        if (!sitemapXml) continue;
        const sitemapParsed = parseSitemapXml(sitemapXml);
        sitemapParsed.urls.forEach((url) => allUrls.add(url));
      } catch (err) {
        continue;
      }
    }

    if (allUrls.size > 0) break;
  }

  return allUrls.size ? Array.from(allUrls) : null;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function requestOnce(url, method, config) {
  const res = await fetchWithTimeout(
    url,
    {
      method,
      redirect: 'manual',
      headers: {
        'User-Agent': config.userAgent,
        Accept: '*/*'
      }
    },
    config.timeoutMs
  );
  res.body?.cancel();
  return res;
}

async function requestWithRetry(url, method, config) {
  let attempt = 0;
  while (attempt <= config.retryLimit) {
    try {
      return await requestOnce(url, method, config);
    } catch (err) {
      attempt += 1;
      if (attempt > config.retryLimit) throw err;
      await sleep(300 * attempt);
    }
  }
  return null;
}

async function checkUrl(url, config) {
  const chain = [];
  const seen = new Set();
  let current = url;
  let finalStatus = 0;
  let error = null;

  for (let i = 0; i < config.maxRedirects; i += 1) {
    if (seen.has(current)) {
      error = 'Redirect loop detected';
      break;
    }
    seen.add(current);

    let response = await requestWithRetry(current, 'HEAD', config);
    if ([400, 403, 405].includes(response?.status)) {
      response = await requestWithRetry(current, 'GET', config);
    }

    finalStatus = response?.status || 0;
    const location = response?.headers?.get('location');

    if (finalStatus >= 300 && finalStatus < 400 && location) {
      const nextUrl = normalizeUrl(location, current);
      if (!nextUrl) {
        chain.push({ url: current, status: finalStatus, location });
        break;
      }
      chain.push({ url: current, status: finalStatus, location: nextUrl });
      current = nextUrl;
      continue;
    }

    break;
  }

  return {
    url,
    finalUrl: current,
    finalStatus,
    chain,
    error
  };
}

function createProgressTracker(state) {
  return {
    update(partial) {
      Object.assign(state, partial);
    }
  };
}

async function runAudit({ startUrl, onProgress, configOverrides }) {
  const config = { ...DEFAULT_CONFIG, ...(configOverrides || {}) };
  const origin = new URL(startUrl).origin;
  const progress = {
    pagesCrawled: 0,
    pagesQueued: 0,
    linksChecked: 0,
    linksQueued: 0
  };
  const tracker = createProgressTracker(progress);
  const recordProgress = () => {
    if (typeof onProgress === 'function') {
      onProgress({ ...progress });
    }
  };

  const visitedPages = new Set();
  const pendingPages = new Set();
  const checkedUrls = new Map();
  const pendingChecks = new Set();
  const referrers = new Map();

  const crawlQueue = new TaskQueue(config.crawlConcurrency);
  const checkQueue = new TaskQueue(config.checkConcurrency);

  let browser;
  let context;
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ userAgent: config.userAgent });
  await context.route('**/*', (route) => {
    const type = route.request().resourceType();
    if (['image', 'media', 'font'].includes(type)) return route.abort();
    return route.continue();
  });

  function trackQueues() {
    tracker.update({
      pagesQueued: pendingPages.size + visitedPages.size,
      linksQueued: pendingChecks.size + checkedUrls.size
    });
    recordProgress();
  }

  function recordLink(url, fromPage) {
    if (!url) return;
    if (!referrers.has(url)) referrers.set(url, new Set());
    if (fromPage) referrers.get(url).add(fromPage);

    if (!checkedUrls.has(url) && !pendingChecks.has(url)) {
      pendingChecks.add(url);
      trackQueues();
      checkQueue
        .add(async () => {
          try {
            const result = await checkUrl(url, config);
            checkedUrls.set(url, result);
          } catch (err) {
            checkedUrls.set(url, {
              url,
              finalUrl: url,
              finalStatus: 0,
              chain: [],
              error: err?.message || 'Request failed'
            });
          } finally {
            pendingChecks.delete(url);
            tracker.update({ linksChecked: checkedUrls.size });
            trackQueues();
          }
        })
        .catch(() => {});
    }
  }

  function enqueuePage(url) {
    if (!url) return;
    if (!sameOrigin(url, origin)) return;
    if (visitedPages.size + pendingPages.size >= config.maxPages) return;
    if (visitedPages.has(url) || pendingPages.has(url)) return;

    pendingPages.add(url);
    trackQueues();
    crawlQueue
      .add(async () => {
        try {
          await crawlPage(url);
        } finally {
          pendingPages.delete(url);
          trackQueues();
        }
      })
      .catch(() => {});
  }

  async function crawlPage(pageUrl) {
    visitedPages.add(pageUrl);
    tracker.update({ pagesCrawled: visitedPages.size });
    recordProgress();

    let page;
    try {
      page = await context.newPage();
      await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: config.timeoutMs });
      const baseUrl = page.url();
      const hrefs = await page
        .$$eval('a[href]', (anchors) => anchors.map((anchor) => anchor.getAttribute('href')))
        .catch(() => []);

      hrefs.forEach((href) => {
        if (isSkippableHref(href)) return;
        const normalized = normalizeUrl(href, baseUrl);
        if (!normalized) return;
        recordLink(normalized, pageUrl);
        if (sameOrigin(normalized, origin)) {
          enqueuePage(normalized);
        }
      });
    } catch (err) {
      await fallbackCrawl(pageUrl);
    } finally {
      if (page) await page.close();
    }
  }

  async function fallbackCrawl(pageUrl) {
    try {
      const res = await fetchWithTimeout(
        pageUrl,
        {
          method: 'GET',
          headers: {
            'User-Agent': config.userAgent,
            Accept: 'text/html,application/xhtml+xml'
          }
        },
        config.timeoutMs
      );

      if (!res.ok) {
        res.body?.cancel();
        return;
      }

      const html = await res.text();
      const $ = cheerio.load(html);
      $('a[href]').each((_, element) => {
        const href = $(element).attr('href');
        if (isSkippableHref(href)) return;
        const normalized = normalizeUrl(href, pageUrl);
        if (!normalized) return;
        recordLink(normalized, pageUrl);
        if (sameOrigin(normalized, origin)) {
          enqueuePage(normalized);
        }
      });
    } catch (err) {
      return;
    }
  }

  try {
    const sitemapUrls = await fetchSitemapUrls(origin, config);
    const seeds = sitemapUrls && sitemapUrls.length ? sitemapUrls : [startUrl];

    seeds.forEach((seedUrl) => {
      const normalized = normalizeUrl(seedUrl, origin);
      if (!normalized) return;
      recordLink(normalized, '(sitemap)');
      enqueuePage(normalized);
    });

    trackQueues();
    await crawlQueue.onIdle();
    await checkQueue.onIdle();
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
    if (browser) {
      await browser.close().catch(() => {});
    }
  }

  const notFound = [];
  const redirect308 = [];

  for (const [url, result] of checkedUrls.entries()) {
    const refs = Array.from(referrers.get(url) || []);
    const item = {
      url,
      finalStatus: result.finalStatus,
      finalUrl: result.finalUrl,
      chain: result.chain,
      referrers: refs,
      error: result.error || null
    };

    if (result.finalStatus === 404) {
      notFound.push(item);
    }

    const firstRedirectStatus = result.chain[0]?.status;
    if (firstRedirectStatus === 308 || result.finalStatus === 308) {
      redirect308.push(item);
    }
  }

  const summary = {
    pagesCrawled: visitedPages.size,
    linksChecked: checkedUrls.size,
    notFoundCount: notFound.length,
    redirect308Count: redirect308.length,
    completedAt: new Date().toISOString()
  };

  return {
    summary,
    notFound,
    redirect308
  };
}

module.exports = { runAudit };
