const path = require('path');
const fs = require('fs/promises');
const express = require('express');
const { fetch } = require('undici');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const RAW_BASE_URL = 'https://raw.githubusercontent.com/romydias21/contentstack-link-audit/main/public/';
const LATEST_FILE = path.join(__dirname, 'public', 'latest.json');

app.use(express.static(path.join(__dirname, 'public')));

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

async function fetchRemoteLatest() {
  const base = normalizeBaseUrl(RAW_BASE_URL);
  const cacheBust = `?t=${Date.now()}`;
  const url = `${base}latest.json${cacheBust}`;

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

async function loadLatest() {
  const remote = await fetchRemoteLatest();
  if (remote) return remote;
  return readJsonFile(LATEST_FILE);
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.get('/api/latest', async (req, res) => {
  const payload = await loadLatest();
  if (!payload) {
    return res.status(404).json({ error: 'No completed run yet' });
  }
  res.set('Cache-Control', 'no-store');
  return res.json(payload);
});

app.listen(PORT, () => {
  console.log(`Link audit app running on http://localhost:${PORT}`);
});
