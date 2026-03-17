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

let currentRunId = null;
let pollTimer = null;

function resetUI() {
  progressSection.hidden = false;
  resultsSection.hidden = true;
  pagesCrawledEl.textContent = '0';
  linksCheckedEl.textContent = '0';
  runStatusEl.textContent = 'Starting';
  brokenCountEl.textContent = '0';
  redirectCountEl.textContent = '0';
  brokenListEl.innerHTML = '';
  redirectListEl.innerHTML = '';
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
  brokenCountEl.textContent = results.notFound.length;
  redirectCountEl.textContent = results.redirect308.length;

  results.notFound.forEach((item) => {
    brokenListEl.appendChild(createResultItem(item, 'broken'));
  });

  results.redirect308.forEach((item) => {
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

  if (data.status === 'done') {
    clearInterval(pollTimer);
    pollTimer = null;
    runBtn.disabled = false;
    const resultsResponse = await fetch(`/api/run/${currentRunId}/results`);
    if (resultsResponse.ok) {
      const results = await resultsResponse.json();
      renderResults(results);
    }
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
