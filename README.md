# Contentstack Link Audit

A self-serve web app that crawls a site, checks every link, and reports:
- **404 broken links**
- **308 redirects**, with multi-hop chains highlighted

## Quick Start

```bash
cd link-audit-app
npm install
npx playwright install --with-deps
npm run dev
```

Open `http://localhost:3000` and run a crawl.

## Configuration

Set these environment variables as needed:

- `DEFAULT_START_URL` (default: `https://www.contentstack.com`)
- `ALLOWED_ORIGINS` (comma-separated origins, default: `https://www.contentstack.com`) Use `*` to allow any.
- `MAX_PAGES` (default: `20000`)
- `CRAWL_CONCURRENCY` (default: `3`)
- `CHECK_CONCURRENCY` (default: `10`)
- `REQUEST_TIMEOUT_MS` (default: `20000`)
- `MAX_REDIRECTS` (default: `5`)
- `RETRY_LIMIT` (default: `2`)
- `SITEMAP_LIMIT` (default: `50`)
- `USER_AGENT` (default: `ContentstackLinkAuditBot/1.0`)
- `SCHEDULE_ENABLED` (default: `true`)
- `SCHEDULE_HOUR` (default: `11`)
- `SCHEDULE_MINUTE` (default: `0`)
- `SCHEDULE_MAX_PAGES` (default: `MAX_PAGES`)
- `FULL_SWEEP_MAX_PAGES` (default: `SCHEDULE_MAX_PAGES`)

The daily schedule uses the server's local time zone. Set `TZ=Asia/Kolkata` (or your desired zone) in the host environment to align with 11:00 AM local time.

## Notes

- The crawler seeds from `sitemap.xml` when available, then discovers links recursively.
- External links are checked but **not** crawled.
- JavaScript rendering uses Playwright (Chromium).
- The most recent completed run is persisted to `data/last-run.json` and served to all visitors.
- Reports focus on 404 and 308 responses as requested.

## API

- `GET /api/latest` returns the latest completed run (used to render the page on load).

## Hosting

Any Node hosting works. For Contentstack Launch, start the service with:

```bash
npm install
npx playwright install --with-deps
npm start
```

If you want to restrict who can run crawls, keep `ALLOWED_ORIGINS` set to Contentstack domains only.
