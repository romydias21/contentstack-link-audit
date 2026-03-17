const resultsSection = document.getElementById('results');
const brokenCountEl = document.getElementById('broken-count');
const redirectCountEl = document.getElementById('redirect-count');
const brokenListEl = document.getElementById('broken-list');
const redirectListEl = document.getElementById('redirect-list');
const lastRunEl = document.getElementById('last-run');
const errorBanner = document.getElementById('error-banner');

let apiBase = null;
let apiBases = null;

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

async function apiFetch(path) {
  if (!apiBases) apiBases = resolveApiBases();
  const clean = path.replace(/^\/+/, '');
  let lastResponse = null;

  for (const base of apiBases) {
    try {
      const response = await fetch(`${base}${clean}`, { cache: 'no-store' });
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
    return;
  }

  clearError();
  const payload = await response.json();
  renderResults(payload.results || {});

  const finishedAt = payload.finishedAt || payload.summary?.completedAt;
  if (lastRunEl) {
    lastRunEl.textContent = `Last run: ${formatDateTime(finishedAt)}`;
  }
}

loadLatest();
setInterval(loadLatest, 10 * 60 * 1000);
