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

let currentRunId = null;
let pollTimer = null;
let hasLatestResults = false;

function resetUI() {
  progressSection.hidden = false;
  statusBar.hidden = false;
  pagesCrawledEl.textContent = '0';
  linksCheckedEl.textContent = '0';
  runStatusEl.textContent = 'running';
  docsIdentifiedEl.textContent = '0';
  docsScannedEl.textContent = '0';
  statusFillEl.style.width = '0%';
  brokenCountEl.textContent = '0';
  redirectCountEl.textContent = '0';
}

function formatDateTime(value) {
  if (!value) return '--';
  try {
    return new Date(value).toLocaleString();
  } catch (err) {
    return value;
  }
}

function updateStatusBar(scanned, identified) {
  const safeScanned = Number(scanned) || 0;
  const safeIdentified = Number(identified) || 0;
  docsIdentifiedEl.textContent = safeIdentified.toString();
  docsScannedEl.textContent = safeScanned.toString();

  const percent = safeIdentified > 0 ? Math.min(100, (safeScanned / safeIdentified) * 100) : 0;
  statusFillEl.style.width = `${percent}%`;
}

async function loadLatest() {
  const response = await fetch('/api/latest');
  if (!response.ok) {
    hasLatestResults = false;
    resultsSection.hidden = true;
    if (lastRunEl) {
      lastRunEl.textContent = 'Last run: --';
    }
    return;
  }

  const payload = await response.json();
  hasLatestResults = true;
  resultsSection.hidden = false;
  renderResults(payload.results);

  const finishedAt = payload.finishedAt || payload.summary?.completedAt;
  if (lastRunEl) {
    lastRunEl.textContent = `Last run: ${formatDateTime(finishedAt)}`;
  }

  const completedPages = payload.summary?.pagesCrawled ?? payload.summary?.pagesDiscovered ?? 0;
  updateStatusBar(completedPages, completedPages);
  pagesCrawledEl.textContent = completedPages.toString();
  linksCheckedEl.textContent = (payload.summary?.linksChecked || 0).toString();
  runStatusEl.textContent = 'idle';

  brokenCountEl.textContent = (payload.summary?.notFoundCount ?? payload.results?.notFound?.length ?? 0).toString();
  redirectCountEl.textContent = (payload.summary?.redirect308Count ?? payload.results?.redirect308?.length ?? 0).toString();

  progressSection.hidden = false;
  statusBar.hidden = false;
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

  meta.textContent = [statusText, finalText].filter(Boolean).join(' • ');

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
      .map((step) => `${step.url} → ${step.location} (${step.status})`)
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

async function pollRun() {
  if (!currentRunId) return;

  const response = await fetch(`/api/run/${currentRunId}`);
  if (!response.ok) {
    runStatusEl.textContent = 'Error';
    runBtn.disabled = false;
    clearInterval(pollTimer);
    pollTimer = null;
    return;
  }

  const data = await response.json();
  pagesCrawledEl.textContent = data.progress.pagesCrawled;
  linksCheckedEl.textContent = data.progress.linksChecked;
  runStatusEl.textContent = data.status;

  const discovered = data.progress.pagesDiscovered || data.progress.pagesCrawled;
  updateStatusBar(data.progress.pagesCrawled, discovered);
  if (typeof data.progress.notFoundCount === 'number') {
    brokenCountEl.textContent = data.progress.notFoundCount;
  }
  if (typeof data.progress.redirect308Count === 'number') {
    redirectCountEl.textContent = data.progress.redirect308Count;
  }

  if (data.status === 'done') {
    clearInterval(pollTimer);
    pollTimer = null;
    runBtn.disabled = false;
    await loadLatest();
  }

  if (data.status === 'error') {
    clearInterval(pollTimer);
    pollTimer = null;
    runBtn.disabled = false;
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  resetUI();
  runBtn.disabled = true;

  const startUrl = startUrlInput.value.trim();
  const response = await fetch('/api/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ startUrl })
  });

  if (!response.ok) {
    runBtn.disabled = false;
    const error = await response.json();
    runStatusEl.textContent = error.error || 'Unable to start run';
    return;
  }

  const data = await response.json();
  currentRunId = data.runId;
  pollTimer = setInterval(pollRun, 2500);
  pollRun();
});

loadLatest();
