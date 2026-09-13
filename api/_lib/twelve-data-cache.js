// Shared Twelve Data cache + in-flight request deduplication.
// Keeps the existing strategy math unchanged while preventing duplicate
// upstream requests during the normal polling window.

const CACHE_TTL_MS = 30_000;
const cache = new Map();
const inFlight = new Map();

export async function getTwelveData({ symbol, interval, outputsize, apiKey }) {
  const key = `${symbol}|${interval}|${outputsize}`;
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.data;

  const running = inFlight.get(key);
  if (running) return running;

  const promise = fetchTwelveData({ symbol, interval, outputsize, apiKey })
    .then(data => {
      cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
      return data;
    })
    .finally(() => inFlight.delete(key));

  inFlight.set(key, promise);
  return promise;
}

async function fetchTwelveData({ symbol, interval, outputsize, apiKey }) {
  const params = new URLSearchParams({
    symbol,
    interval,
    outputsize: String(outputsize),
    order: "ASC",
    timezone: "UTC",
    apikey: apiKey
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  let response;
  try {
    response = await fetch("https://api.twelvedata.com/time_series?" + params.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Twelve Data request timed out");
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("Invalid response from Twelve Data");
  }

  if (!response.ok) throw new Error(`Twelve Data HTTP ${response.status}`);
  if (data?.status === "error" || data?.code) {
    throw new Error(data?.message || "Twelve Data returned an error");
  }
  if (!Array.isArray(data?.values)) {
    throw new Error(data?.message || "Twelve Data returned no values");
  }

  return data.values;
}
