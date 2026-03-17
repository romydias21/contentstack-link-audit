# Contentstack Link Audit

A web app that crawls a site, checks every link, and reports:
- **404 broken links**
- **308 redirects**, with multi-hop chains highlighted

Crawls run in GitHub Actions (daily + on demand). The UI always shows the last completed run, and live progress while a crawl is running.

## How It Works

1. GitHub Actions runs `scripts/run-crawl.js` on a daily schedule (11:00 IST) and on manual dispatch.
2. The workflow writes `public/latest.json` and `public/progress.json`, then commits those files.
3. The web app reads the JSON files (from GitHub raw, or locally in dev) and renders the results.

## Quick Start

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

## Configuration

### App (Launch / server)

- `DEFAULT_START_URL` (default: `https://www.contentstack.com`)
- `ALLOWED_ORIGINS` (comma-separated origins, default: `https://www.contentstack.com`) Use `*` to allow any.
- `DATA_BASE_URL` (recommended) Raw GitHub base URL that hosts `public/latest.json` and `public/progress.json`.
  Example:
  ```text
  https://raw.githubusercontent.com/<owner>/<repo>/main/public/
  ```
- `GITHUB_OWNER` / `GITHUB_REPO` / `GITHUB_WORKFLOW_ID` (default: `crawl.yml`) / `GITHUB_REF` (default: `main`)
- `GITHUB_DISPATCH_TOKEN` (PAT or fine-grained token with workflow dispatch permissions)

### Crawler settings

- `MAX_PAGES` (default: `50000`)
- `CRAWL_CONCURRENCY` (default: `3`)
- `CHECK_CONCURRENCY` (default: `10`)
- `REQUEST_TIMEOUT_MS` (default: `20000`)
- `MAX_REDIRECTS` (default: `5`)
- `RETRY_LIMIT` (default: `2`)
- `SITEMAP_LIMIT` (default: `50`)
- `USER_AGENT` (default: `ContentstackLinkAuditBot/1.0`)
- `RENDER_JS` (default: `false`) Set to `true` to enable Playwright rendering.

### Workflow settings

- `START_URL` (input to the workflow_dispatch, optional)
- `COMMIT_PROGRESS` (default: `true` in the workflow)
- `PROGRESS_INTERVAL_SEC` (default: `120`)
- `PROGRESS_MIN_DELTA` (default: `25`)

## GitHub Actions Schedule

The workflow runs daily at **11:00 IST** (05:30 UTC). To change the schedule, edit:

```
.github/workflows/crawl.yml
```

## Notes

- The crawler seeds from `sitemap.xml` when available, then discovers links recursively.
- External links are checked but **not** crawled.
- JavaScript rendering uses Playwright (Chromium). For Actions, the workflow skips browser downloads unless you enable `RENDER_JS`.
- Reports focus on 404 and 308 responses as requested.

## Hosting (Launch)

Use the Node server (`npm start`). Set `DATA_BASE_URL` to the raw GitHub URL so the hosted UI always reads the latest crawl data.
