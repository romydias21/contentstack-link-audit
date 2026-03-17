const form = document.getElementById('run-form');
const startUrlInput = document.getElementById('start-url');
const progressSection = document.getElementById('progress');
const pagesCrawledEl = document.getElementById('pages-crawled');
const linksCheckedEl = document.getElementById('links-checked');
const runStatusEl = document.getElementById('run-status');
const resultsSection = document.getElementById('results');
const brokenCountEl = document.getElementById('broken-count');
const redirectCountEl = document.getElementById('redirect-count');
const brokenListEl = document.getElementById('broken-list');
const redirectListEl = document.getElementById('redirect-list');
const runBtn = document.getElementById('run-btn');
const statusBar = document.getElementById('status-bar');
const docsIdentifiedEl = document.getElementById('docs-identified');
const docsScannedEl = document.getElementById('docs-scanned');
const statusFillEl = document.getElementById('status-fill');
const lastRunEl = document.getElementById('last-run');
const errorBanner = document.getElementById('error-banner');

let pollTimer = null;
let apiBase = null;
let apiBases = null;
let latestFinishedAtMs = null;
let pendingRunSince = null;

function resolveApiBase() {
  const origin = window.location.origin;
  let basePath = window.location.pathname || '/';
  if (!basePath.endsWith('/')) {
    if (basePath.includes('.')) {
      basePath = basePath.replace(/[^/]+$/, '');
    } else {
      basePath = `${basePath}/`;
    }
  }
  return `${origin}${basePath}api/`;
}

function apiUrl(path) {
  if (!apiBase) apiBase = resolveApiBase();
  const clean = path.replace(/^\/+/, '');
  return `${apiBase}${clean}`;
}

function resolveApiBases() {
  const primary = apiUrl('');
  const root = `${window.location.origin}/api/`;
  if (primary === root) return [primary];
  return [primary, root];
}

async function apiFetch(path, options = {}) {
  if (!apiBases) apiBases = resolveApiBases();
  const clean = path.replace(/^\/+/, '');
  let lastResponse = null;

  const mergedOptions = { ...options };
  if (!mergedOptions.method || mergedOptions.method.toUpperCase() === 'GET') {
    mergedOptions.cache = 'no-store';
  }

  for (const base of apiBases) {
    try {
      const response = await fetch(`${base}${clean}`, mergedOptions);
      lastResponse = response;
      if (response.status !== 404 || apiBases.length === 1) {
        return response;
      }
    } catch (err) {
      lastResponse = null;
      continue;
    }
  }

  if (!lastResponse) {
    return new Response(null, { status: 503, statusText: 'Service Unavailable' });
  }

  return lastResponse;
}

function formatDateTime(value) {
  if (!value) return '--';
  try {
    return new Date(value).toLocaleString();
  } catch (err) {
    return value;
  }
}

function parseTime(value) {
  if (!value) return null;
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? null : ts;
}

function updateStatusBar(scanned, identified) {
  const safeScanned = Number(scanned) || 0;
  const safeIdentified = Number(identified) || 0;
  docsIdentifiedEl.textContent = safeIdentified.toString();
  docsScannedEl.textContent = safeScanned.toString();

  const percent = safeIdentified > 0 ? Math.min(100, (safeScanned / safeIdentified) * 100) : 0;
  statusFillEl.style.width = `${percent}%`;
}

function showError(message) {
  if (!errorBanner) return;
  errorBanner.textContent = message;
  errorBanner.hidden = false;
}

function clearError() {
  if (!errorBanner) return;
  errorBanner.hidden = true;
  errorBanner.textContent = '';
}

function setProgressVisible() {
  progressSection.hidden = false;
  statusBar.hidden = false;
}

function setStatus(text) {
  runStatusEl.textContent = text;
}

function resetProgressValues() {
  pagesCrawledEl.textContent = '0';
  linksCheckedEl.textContent = '0';
  updateStatusBar(0, 0);
}

function createResultItem(item, type) {
  const container = document.createElement('div');
  container.className = 'result-item';

  const title = document.createElement('h3');
  title.textContent = item.url;

  const meta = document.createElement('div');
  meta.className = 'meta';

  const statusText = `Status: ${item.finalStatus || 'ERR'}`;
  const finalText = item.finalUrl ? `Final: ${item.finalUrl}` : '';

  meta.textContent = [statusText, finalText].filter(Boolean).join(' | ');

  if (type === 'redirect' && item.chain && item.chain.length > 1) {
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = 'multi-hop';
    title.appendChild(badge);
  }

  container.appendChild(title);
  container.appendChild(meta);

  if (item.chain && item.chain.length > 0) {
    const chainEl = document.createElement('div');
    chainEl.className = 'redirect-chain';
    chainEl.textContent = item.chain
      .map((step) => `${step.url} -> ${step.location} (${step.status})`)
      .join(' | ');
    container.appendChild(chainEl);
  }

  if (item.referrers && item.referrers.length > 0) {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = `Referrers (${item.referrers.length})`;
    details.appendChild(summary);

    const list = document.createElement('div');
    list.className = 'meta';
    list.textContent = item.referrers.slice(0, 10).join(' | ');

    if (item.referrers.length > 10) {
      const more = document.createElement('div');
      more.className = 'meta';
      more.textContent = `+ ${item.referrers.length - 10} more`;
      details.appendChild(list);
      details.appendChild(more);
    } else {
      details.appendChild(list);
    }

    container.appendChild(details);
  }

  return container;
}

function renderResults(results) {
  brokenListEl.innerHTML = '';
  redirectListEl.innerHTML = '';

  const notFound = results?.notFound || [];
  const redirect308 = results?.redirect308 || [];

  brokenCountEl.textContent = notFound.length;
  redirectCountEl.textContent = redirect308.length;

  notFound.forEach((item) => {
    brokenListEl.appendChild(createResultItem(item, 'broken'));
  });

  redirect308.forEach((item) => {
    redirectListEl.appendChild(createResultItem(item, 'redirect'));
  });

  resultsSection.hidden = false;
}

async function loadLatest() {
  const response = await apiFetch('latest');
  if (!response.ok) {
    resultsSection.hidden = true;
    if (lastRunEl) {
      lastRunEl.textContent = 'Last run: --';
    }
    if (response.status !== 404) {
      showError(`Unable to load latest run (${response.status}).`);
    }
    latestFinishedAtMs = null;
    return;
  }

  const payload = await response.json();
  resultsSection.hidden = false;
  renderResults(payload.results || {});

  const finishedAt = payload.finishedAt || payload.summary?.completedAt;
  latestFinishedAtMs = parseTime(finishedAt);
  if (lastRunEl) {
    lastRunEl.textContent = `Last run: ${formatDateTime(finishedAt)}`;
  }

  const completedPages = payload.summary?.pagesCrawled ?? payload.summary?.pagesDiscovered ?? 0;
  updateStatusBar(completedPages, completedPages);
  pagesCrawledEl.textContent = completedPages.toString();
  linksCheckedEl.textContent = (payload.summary?.linksChecked || 0).toString();

  brokenCountEl.textContent = (payload.summary?.notFoundCount ?? payload.results?.notFound?.length ?? 0).toString();
  redirectCountEl.textContent = (payload.summary?.redirect308Count ?? payload.results?.redirect308?.length ?? 0).toString();

  setProgressVisible();
  setStatus('idle');
}

function isFreshProgress(data) {
  if (!pendingRunSince) return true;
  const ts = parseTime(data.updatedAt) || parseTime(data.finishedAt) || parseTime(data.startedAt);
  if (!ts) return false;
  return ts >= pendingRunSince - 1000;
}

function applyProgress(data) {
  const progress = data.progress || {};
  const pagesCrawled = progress.pagesCrawled || 0;
  const pagesDiscovered = progress.pagesDiscovered ?? pagesCrawled;

  pagesCrawledEl.textContent = pagesCrawled.toString();
  linksCheckedEl.textContent = (progress.linksChecked || 0).toString();
  updateStatusBar(pagesCrawled, pagesDiscovered);
  setStatus(data.status || 'running');

  if (typeof progress.notFoundCount === 'number') {
    brokenCountEl.textContent = progress.notFoundCount.toString();
  }
  if (typeof progress.redirect308Count === 'number') {
    redirectCountEl.textContent = progress.redirect308Count.toString();
  }
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(pollProgress, 3000);
}

async function pollProgress() {
  const response = await apiFetch('progress');
  if (!response.ok) {
    if (response.status === 404 && pendingRunSince) {
      setStatus('queued');
      return;
    }
    if (response.status !== 404) {
      showError(`Progress check failed (${response.status}).`);
    }
    stopPolling();
    runBtn.disabled = false;
    return;
  }

  const data = await response.json();
  setProgressVisible();

  if (pendingRunSince && !isFreshProgress(data)) {
    setStatus('queued');
    return;
  }

  clearError();
  applyProgress(data);
  if (data.status === 'running' || data.status === 'queued') {
    runBtn.disabled = true;
  }

  if (data.status === 'done') {
    pendingRunSince = null;
    runBtn.disabled = false;
    stopPolling();

    const finishedAt = parseTime(data.finishedAt);
    if (!latestFinishedAtMs || (finishedAt && finishedAt > latestFinishedAtMs)) {
      await loadLatest();
    }
    setStatus('idle');
  }

  if (data.status === 'error') {
    pendingRunSince = null;
    runBtn.disabled = false;
    stopPolling();
    showError(data.error || 'Run failed. Please try again later.');
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearError();
  runBtn.disabled = true;

  const startUrl = startUrlInput.value.trim();
  setProgressVisible();
  setStatus('queued');
  resetProgressValues();
  pendingRunSince = Date.now();

  const response = await apiFetch('run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ startUrl })
  });

  if (!response.ok) {
    runBtn.disabled = false;
    pendingRunSince = null;
    let errorMessage = 'Unable to start run.';
    try {
      const error = await response.json();
      errorMessage = error.error || errorMessage;
    } catch (err) {
      // ignore parsing issues
    }
    setStatus('error');
    showError(errorMessage);
    return;
  }

  startPolling();
  pollProgress();
});

async function bootstrap() {
  await loadLatest();

  const progressResponse = await apiFetch('progress');
  if (progressResponse.ok) {
    const progressData = await progressResponse.json();
    if (progressData.status === 'running' || progressData.status === 'queued') {
      applyProgress(progressData);
      runBtn.disabled = true;
      startPolling();
    }
  }
}

bootstrap();
