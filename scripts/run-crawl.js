const path = require('path');
const fs = require('fs/promises');
const { execSync } = require('child_process');
const { runAudit } = require('../lib/crawler');

const rootDir = path.resolve(__dirname, '..');
process.chdir(rootDir);

const DEFAULT_START_URL = 'https://www.contentstack.com';
const startUrl = (process.env.START_URL || DEFAULT_START_URL).trim();
const outputLatest = process.env.OUTPUT_LATEST || path.join(rootDir, 'public', 'latest.json');
const outputProgress = process.env.OUTPUT_PROGRESS || path.join(rootDir, 'public', 'progress.json');
const commitProgress = (process.env.COMMIT_PROGRESS || '').toLowerCase() === 'true';
const progressIntervalSec = Number(process.env.PROGRESS_INTERVAL_SEC) || 120;
const progressMinDelta = Number(process.env.PROGRESS_MIN_DELTA) || 25;

const startedAt = new Date().toISOString();
let lastCommitAt = 0;
let lastWriteAt = 0;
let lastSnapshot = {
  pagesCrawled: 0,
  linksChecked: 0,
  notFoundCount: 0,
  redirect308Count: 0
};
let latestProgress = {
  pagesCrawled: 0,
  pagesDiscovered: 0,
  linksChecked: 0,
  notFoundCount: 0,
  redirect308Count: 0
};

function nowIso() {
  return new Date().toISOString();
}

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf-8');
}

function getGitStatus() {
  try {
    return execSync('git status --porcelain', { encoding: 'utf-8' }).trim();
  } catch (err) {
    return '';
  }
}

function commitIfNeeded(message) {
  const status = getGitStatus();
  if (!status) return false;
  execSync('git add public/latest.json public/progress.json', { stdio: 'inherit' });
  execSync(`git commit -m "${message}"`, { stdio: 'inherit' });
  execSync('git push', { stdio: 'inherit' });
  return true;
}

function shouldCommit(progress) {
  const now = Date.now();
  const elapsed = (now - lastCommitAt) / 1000;
  const deltaPages = Math.abs((progress.pagesCrawled || 0) - (lastSnapshot.pagesCrawled || 0));
  const deltaLinks = Math.abs((progress.linksChecked || 0) - (lastSnapshot.linksChecked || 0));
  const deltaNotFound = Math.abs((progress.notFoundCount || 0) - (lastSnapshot.notFoundCount || 0));
  const deltaRedirects = Math.abs((progress.redirect308Count || 0) - (lastSnapshot.redirect308Count || 0));

  return (
    elapsed >= progressIntervalSec ||
    deltaPages >= progressMinDelta ||
    deltaLinks >= progressMinDelta ||
    deltaNotFound >= progressMinDelta ||
    deltaRedirects >= progressMinDelta
  );
}

async function persistProgress({ status, progress, finishedAt, error }, { forceCommit = false } = {}) {
  const now = Date.now();
  if (!forceCommit && now - lastWriteAt < 1000) return;
  lastWriteAt = now;

  latestProgress = progress || latestProgress;

  const payload = {
    status,
    startUrl,
    startedAt,
    updatedAt: nowIso(),
    finishedAt: finishedAt || null,
    progress: latestProgress,
    error: error || null
  };

  await writeJson(outputProgress, payload);

  if (!commitProgress) return;
  if (!forceCommit && !shouldCommit(latestProgress)) return;

  const committed = commitIfNeeded('chore: update crawl progress');
  if (committed) {
    lastCommitAt = Date.now();
    lastSnapshot = { ...latestProgress };
  }
}

async function run() {
  await persistProgress({
    status: 'running',
    progress: latestProgress,
    finishedAt: null,
    error: null
  }, { forceCommit: true });

  try {
    const results = await runAudit({
      startUrl,
      onProgress: (progress) => {
        persistProgress({
          status: 'running',
          progress,
          finishedAt: null,
          error: null
        }).catch(() => {});
      }
    });

    const finishedAt = nowIso();
    const latestPayload = {
      startUrl,
      finishedAt,
      summary: results.summary,
      results
    };

    await writeJson(outputLatest, latestPayload);
    await persistProgress({
      status: 'done',
      progress: {
        pagesCrawled: results.summary.pagesCrawled,
        pagesDiscovered: results.summary.pagesCrawled,
        linksChecked: results.summary.linksChecked,
        notFoundCount: results.summary.notFoundCount,
        redirect308Count: results.summary.redirect308Count
      },
      finishedAt,
      error: null
    }, { forceCommit: true });

    if (commitProgress) {
      commitIfNeeded('chore: update crawl results');
    }
  } catch (err) {
    await persistProgress({
      status: 'error',
      progress: latestProgress,
      finishedAt: nowIso(),
      error: err?.message || 'Crawl failed'
    }, { forceCommit: true });
    throw err;
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
