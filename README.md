# Contentstack Link Audit

A simple dashboard that displays the latest daily crawl results from `contentstack.com`:
- **404 broken links**
- **308 redirects**, with multi-hop chains highlighted

Crawls run **daily via GitHub Actions** (11:00 IST). The UI always shows the last completed run so the page is never partially updated.

## How It Works

1. GitHub Actions runs `scripts/run-crawl.js` on a daily schedule (11:00 IST).
2. The workflow writes `public/latest.json` (and `public/progress.json`) then commits those files.
3. The web app reads the latest JSON and renders the results.

## Quick Start (Local)

```bash
cd link-audit-app
npm install
npm run dev
```

Optional: run a local crawl and write JSON files locally:

```bash
RENDER_JS=false npm run crawl
```

Open `http://localhost:3000`.

## GitHub Actions Schedule

The workflow runs daily at **11:00 IST** (05:30 UTC). To change the schedule, edit:

```
.github/workflows/crawl.yml
```

## Hosting (Launch)

No env vars or tokens are required. The server reads the latest JSON directly from GitHub.

If you fork this repo, update the hardcoded GitHub raw URL in:

```
server.js
```

## Notes

- The crawler seeds from `sitemap.xml` when available, then discovers links recursively.
- External links are checked but **not** crawled.
- JavaScript rendering uses Playwright (Chromium). For Actions, the workflow skips browser downloads unless you enable `RENDER_JS`.
- Reports focus on 404 and 308 responses as requested.
