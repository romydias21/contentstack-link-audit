const path = require('path');
const express = require('express');
const crypto = require('crypto');
const { runAudit } = require('./lib/crawler');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const DEFAULT_START_URL = process.env.DEFAULT_START_URL || 'https://www.contentstack.com';
const MAX_RUNS = Number(process.env.MAX_RUNS) || 20;
const SCHEDULE_ENABLED = process.env.SCHEDULE_ENABLED !== 'false';
const SCHEDULE_HOUR = Number(process.env.SCHEDULE_HOUR) || 11;
const SCHEDULE_MINUTE = Number(process.env.SCHEDULE_MINUTE) || 0;

const DEFAULT_MAX_PAGES = Number(process.env.MAX_PAGES) || 20000;
const SCHEDULE_MAX_PAGES = Number(process.env.SCHEDULE_MAX_PAGES) || DEFAULT_MAX_PAGES;
const FULL_SWEEP_MAX_PAGES = Number(process.env.FULL_SWEEP_MAX_PAGES) || SCHEDULE_MAX_PAGES;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || DEFAULT_START_URL)
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const runs = new Map();
let activeRunId = null;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function isAllowedStartUrl(startUrl) {
  try {
    const origin = new URL(startUrl).origin;
    if (ALLOWED_ORIGINS.includes('*')) return true;
    return ALLOWED_ORIGINS.includes(origin);
  } catch (err) {
    return false;
  }
}

function createRun(startUrl, mode) {
  const runId = crypto.randomUUID();
  const run = {
    id: runId,
    startUrl,
    mode,
    status: 'running',
    createdAt: new Date().toISOString(),
    finishedAt: null,
    progress: {
      pagesCrawled: 0,
      pagesQueued: 0,
      linksChecked: 0,
      linksQueued: 0
    },
    summary: null,
    results: null,
    error: null
  };

  runs.set(runId, run);
  if (runs.size > MAX_RUNS) {
    const oldest = Array.from(runs.keys()).slice(0, runs.size - MAX_RUNS);
    oldest.forEach((key) => runs.delete(key));
  }
  return run;
}

function startRun({ startUrl, mode, configOverrides }) {
  if (activeRunId && runs.get(activeRunId)?.status === 'running') {
    return { error: 'A crawl is already running. Please wait for it to finish.' };
  }

  const run = createRun(startUrl, mode);
  activeRunId = run.id;

  setImmediate(async () => {
    try {
      const results = await runAudit({
        startUrl,
        configOverrides,
        onProgress: (progress) => {
          run.progress = progress;
        }
      });

      run.status = 'done';
      run.finishedAt = new Date().toISOString();
      run.results = results;
      run.summary = results.summary;
    } catch (err) {
      run.status = 'error';
      run.finishedAt = new Date().toISOString();
      run.error = err?.message || 'Unknown error';
    } finally {
      if (activeRunId === run.id) {
        activeRunId = null;
      }
    }
  });

  return { run };
}

function getNextRunDelayMs() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(SCHEDULE_HOUR, SCHEDULE_MINUTE, 0, 0);
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime() - now.getTime();
}

function scheduleDailyRun() {
  if (!SCHEDULE_ENABLED) return;
  const delay = getNextRunDelayMs();
  setTimeout(() => {
    const outcome = startRun({
      startUrl: DEFAULT_START_URL,
      mode: 'scheduled',
      configOverrides: { maxPages: SCHEDULE_MAX_PAGES }
    });

    if (outcome.error) {
      console.log(`[scheduler] Skipped run: ${outcome.error}`);
    } else {
      console.log(`[scheduler] Started daily crawl for ${DEFAULT_START_URL}`);
    }

    scheduleDailyRun();
  }, delay);
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.post('/api/run', async (req, res) => {
  const startUrl = (req.body?.startUrl || DEFAULT_START_URL).trim();
  if (!startUrl) {
    return res.status(400).json({ error: 'startUrl is required' });
  }
  if (!isAllowedStartUrl(startUrl)) {
    return res.status(400).json({
      error: 'startUrl is not allowed. Configure ALLOWED_ORIGINS to permit this domain.'
    });
  }

  const outcome = startRun({
    startUrl,
    mode: 'manual',
    configOverrides: { maxPages: FULL_SWEEP_MAX_PAGES }
  });

  if (outcome.error) {
    return res.status(409).json({ error: outcome.error });
  }

  return res.json({ runId: outcome.run.id });
});

app.get('/api/run/:id', (req, res) => {
  const run = runs.get(req.params.id);
  if (!run) return res.status(404).json({ error: 'Run not found' });

  res.json({
    id: run.id,
    startUrl: run.startUrl,
    mode: run.mode,
    status: run.status,
    createdAt: run.createdAt,
    finishedAt: run.finishedAt,
    progress: run.progress,
    summary: run.summary,
    error: run.error
  });
});

app.get('/api/run/:id/results', (req, res) => {
  const run = runs.get(req.params.id);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  if (run.status !== 'done') {
    return res.status(409).json({ error: 'Run not complete yet' });
  }

  res.json(run.results);
});

app.listen(PORT, () => {
  console.log(`Link audit app running on http://localhost:${PORT}`);
  scheduleDailyRun();
});
