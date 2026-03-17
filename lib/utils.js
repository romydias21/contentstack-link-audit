const { URL } = require('url');

const SKIP_PROTOCOLS = [
  'mailto:',
  'tel:',
  'javascript:',
  'data:',
  'sms:',
  'whatsapp:'
];

function isSkippableHref(href) {
  if (!href) return true;
  const trimmed = href.trim();
  if (trimmed === '' || trimmed.startsWith('#')) return true;
  const lower = trimmed.toLowerCase();
  return SKIP_PROTOCOLS.some((protocol) => lower.startsWith(protocol));
}

function normalizeUrl(rawUrl, base) {
  try {
    const url = new URL(rawUrl, base);
    if (!['http:', 'https:'].includes(url.protocol)) return null;

    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    if ((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443')) {
      url.port = '';
    }
    if (url.pathname !== '/' && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.slice(0, -1);
    }
    return url.toString();
  } catch (err) {
    return null;
  }
}

function sameOrigin(url, origin) {
  try {
    return new URL(url).origin === origin;
  } catch (err) {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  isSkippableHref,
  normalizeUrl,
  sameOrigin,
  sleep
};
