const path = require('path');
const fs = require('fs/promises');
const express = require('express');
const { fetch } = require('undici');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const DEFAULT_START_URL = process.env.DEFAULT_START_URL || 'https://www.contentstack.com';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || DEFAULT_START_URL)
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const DATA_BASE_URL = process.env.DATA_BASE_URL || '';
const LATEST_FILE = path.join(__dirname, 'public', 'latest.json');
const PROGRESS_FILE = path.join(__dirname, 'public', 'progress.json');

const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_WORKFLOW_ID = process.env.GITHUB_WORKFLOW_ID || 'crawl.yml';
const GITHUB_REF = process.env.GITHUB_REF || 'main';
const GITHUB_TOKEN = process.env.GITHUB_DISPATCH_TOKEN || process.env.GITHUB_TOKEN;

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

function normalizeBaseUrl(value) {
  if (!value) return '';
  return value.endsWith('/') ? value : `${value}/`;
}

async function readJsonFile(filePath) {
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    return null;
  }
}

async function fetchRemoteJson(fileName) {
  if (!DATA_BASE_URL) return null;
  const base = normalizeBaseUrl(DATA_BASE_URL);
  const cacheBust = `?t=${Date.now()}`;
  const url = `${base}${fileName}${cacheBust}`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'ContentstackLinkAudit/1.0',
        'Cache-Control': 'no-cache'
      }
    });

    if (!response.ok) return null;
    return await response.json();
  } catch (err) {
    return null;
  }
}

async function loadJson(fileName, fallbackPath) {
  const remote = await fetchRemoteJson(fileName);
  if (remote) return remote;
  return readJsonFile(fallbackPath);
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.get('/api/latest', async (req, res) => {
  const payload = await loadJson('latest.json', LATEST_FILE);
  if (!payload) {
    return res.status(404).json({ error: 'No completed run yet' });
  }
  res.set('Cache-Control', 'no-store');
  return res.json(payload);
});

app.get('/api/progress', async (req, res) => {
  const payload = await loadJson('progress.json', PROGRESS_FILE);
  if (!payload) {
    return res.status(404).json({ error: 'No progress data yet' });
  }
  res.set('Cache-Control', 'no-store');
  return res.json(payload);
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

  if (!GITHUB_OWNER || !GITHUB_REPO || !GITHUB_WORKFLOW_ID || !GITHUB_TOKEN) {
    return res.status(501).json({
      error: 'Manual runs are disabled. Configure GitHub dispatch settings to enable.'
    });
  }

  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${GITHUB_WORKFLOW_ID}/dispatches`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'ContentstackLinkAudit/1.0',
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: JSON.stringify({
        ref: GITHUB_REF,
        inputs: {
          start_url: startUrl
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({
        error: `GitHub dispatch failed (${response.status}). ${errorText}`
      });
    }

    return res.status(202).json({ status: 'queued' });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Failed to dispatch workflow.' });
  }
});

app.listen(PORT, () => {
  console.log(`Link audit app running on http://localhost:${PORT}`);
});
