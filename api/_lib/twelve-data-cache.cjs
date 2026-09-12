const CACHE_TTL_MS = 15_000;
const MAX_OUTPUT_SIZE = 500;
const cache = new Map();
const inFlight = new Map();

function cacheKey(url) {
  const parsed = new URL(url);
  return [
    parsed.searchParams.get('symbol') || '',
    parsed.searchParams.get('interval') || '',
    parsed.searchParams.get('order') || 'DESC',
    parsed.searchParams.get('timezone') || 'default',
  ].join('|');
}

function intervalMs(interval) {
  const match = String(interval || '').match(/^(\d+)(min|h|day)$/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (match[2].toLowerCase() === 'min') return value * 60_000;
  if (match[2].toLowerCase() === 'h') return value * 3_600_000;
  return value * 86_400_000;
}

function rowTimestamp(row) {
  if (!row) return null;
  if (row.timestamp != null) {
    const value = Number(row.timestamp);
    return Number.isFinite(value) ? value * 1000 : null;
  }
  const value = Date.parse(String(row.datetime || ''));
  return Number.isFinite(value) ? value : null;
}

function latestTimestamp(values) {
  let latest = null;
  for (const row of Array.isArray(values) ? values : []) {
    const timestamp = rowTimestamp(row);
    if (timestamp != null && (latest == null || timestamp > latest)) latest = timestamp;
  }
  return latest;
}

function isFresh(entry, interval, now) {
  if (now - entry.cachedAt >= CACHE_TTL_MS) return false;
  const step = intervalMs(interval);
  if (!step) return true;
  const latest = latestTimestamp(entry.values);
  if (latest == null) return true;
  return Math.floor(now / step) === Math.floor(latest / step);
}

function buildResponse(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function outputSize(url) {
  const requested = Number(new URL(url).searchParams.get('outputsize') || MAX_OUTPUT_SIZE);
  return Math.min(Math.max(Number.isFinite(requested) ? Math.floor(requested) : MAX_OUTPUT_SIZE, 1), MAX_OUTPUT_SIZE);
}

async function fetchAndCache(originalFetch, url, init, key) {
  const upstreamUrl = new URL(url);
  upstreamUrl.searchParams.set('outputsize', String(MAX_OUTPUT_SIZE));
  const response = await originalFetch(upstreamUrl.toString(), init);
  const data = await response.clone().json().catch(() => null);
  if (!response.ok || data?.status === 'error' || !Array.isArray(data?.values)) return response;
  cache.set(key, { values: data.values, cachedAt: Date.now() });
  return response;
}

function cachedResponse(entry, url) {
  const values = entry.values.slice(0, outputSize(url));
  return buildResponse({ values });
}

function createCachedFetch(originalFetch) {
  return async function cachedFetch(input, init) {
    const url = typeof input === 'string' ? input : input?.url;
    if (!url) return originalFetch(input, init);
    let parsed;
    try { parsed = new URL(url); } catch { return originalFetch(input, init); }
    if (parsed.hostname !== 'api.twelvedata.com' || parsed.pathname !== '/time_series') {
      return originalFetch(input, init);
    }

    const key = cacheKey(url);
    const interval = parsed.searchParams.get('interval');
    const now = Date.now();
    const entry = cache.get(key);
    if (entry && isFresh(entry, interval, now)) return cachedResponse(entry, url);

    let pending = inFlight.get(key);
    if (!pending) {
      pending = fetchAndCache(originalFetch, url, init, key);
      inFlight.set(key, pending);
      pending.finally(() => inFlight.delete(key)).catch(() => {});
    }
    const response = await pending;
    const refreshed = cache.get(key);
    return refreshed && isFresh(refreshed, interval, Date.now())
      ? cachedResponse(refreshed, url)
      : response;
  };
}

function installTwelveDataFetchCache() {
  if (globalThis.__wajidTwelveDataFetchCacheInstalled) return;
  const originalFetch = globalThis.fetch;
  if (typeof originalFetch !== 'function') return;
  globalThis.fetch = createCachedFetch(originalFetch);
  globalThis.__wajidTwelveDataFetchCacheInstalled = true;
}

function clearTwelveDataCache() {
  cache.clear();
  inFlight.clear();
}

function stats() {
  return { entries: cache.size, inFlight: inFlight.size };
}

module.exports = {
  createCachedFetch,
  installTwelveDataFetchCache,
  clearTwelveDataCache,
  stats,
  CACHE_TTL_MS,
  MAX_OUTPUT_SIZE,
};
