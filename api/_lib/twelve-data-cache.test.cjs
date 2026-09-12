const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createCachedFetch,
  clearTwelveDataCache,
  CACHE_TTL_MS,
  MAX_OUTPUT_SIZE,
} = require('./twelve-data-cache.cjs');

const values = [
  { datetime: '2026-09-12 01:14:00', open: '1', high: '2', low: '0', close: '1.5' },
  { datetime: '2026-09-12 01:13:00', open: '1', high: '2', low: '0', close: '1.4' },
  { datetime: '2026-09-12 01:12:00', open: '1', high: '2', low: '0', close: '1.3' },
];

const makeResponse = body => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

test.beforeEach(() => clearTwelveDataCache());

test('reuses same symbol/interval/order/timezone across different output sizes', async () => {
  let calls = 0;
  const original = async () => { calls++; return makeResponse({ values }); };
  const fetch = createCachedFetch(original);
  const originalNow = Date.now;
  Date.now = () => Date.parse('2026-09-12T01:14:30Z');
  try {
    const a = await (await fetch('https://api.twelvedata.com/time_series?symbol=XAU%2FUSD&interval=15min&outputsize=200&apikey=test')).json();
    const b = await (await fetch('https://api.twelvedata.com/time_series?symbol=XAU%2FUSD&interval=15min&outputsize=300&apikey=test')).json();
    assert.equal(calls, 1);
    assert.equal(a.values.length, 3);
    assert.equal(b.values.length, 3);
  } finally {
    Date.now = originalNow;
  }
});

test('deduplicates concurrent identical requests', async () => {
  let calls = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const original = async () => { calls++; await gate; return makeResponse({ values }); };
  const fetch = createCachedFetch(original);
  const p1 = fetch('https://api.twelvedata.com/time_series?symbol=XAU%2FUSD&interval=15min&outputsize=200&apikey=test');
  const p2 = fetch('https://api.twelvedata.com/time_series?symbol=XAU%2FUSD&interval=15min&outputsize=300&apikey=test');
  await Promise.resolve();
  assert.equal(calls, 1);
  release();
  await Promise.all([p1, p2]);
  assert.equal(calls, 1);
});

test('does not reuse cached data after interval boundary', async () => {
  let calls = 0;
  const original = async () => { calls++; return makeResponse({ values }); };
  const fetch = createCachedFetch(original);
  const originalNow = Date.now;
  Date.now = () => Date.parse('2026-09-12T01:14:30Z');
  try {
    await fetch('https://api.twelvedata.com/time_series?symbol=XAU%2FUSD&interval=1min&outputsize=200&apikey=test');
    Date.now = () => Date.parse('2026-09-12T01:15:01Z');
    await fetch('https://api.twelvedata.com/time_series?symbol=XAU%2FUSD&interval=1min&outputsize=200&apikey=test');
  } finally {
    Date.now = originalNow;
  }
  assert.equal(calls, 2);
});

test('does not cache non-time-series Twelve Data requests', async () => {
  let calls = 0;
  const original = async () => { calls++; return makeResponse({ data: [] }); };
  const fetch = createCachedFetch(original);
  await fetch('https://api.twelvedata.com/symbol_search?symbol=XAU&apikey=test');
  await fetch('https://api.twelvedata.com/symbol_search?symbol=XAU&apikey=test');
  assert.equal(calls, 2);
});

test('uses a short TTL and never exceeds the Twelve Data time-series maximum', () => {
  assert.equal(CACHE_TTL_MS, 15_000);
  assert.equal(MAX_OUTPUT_SIZE, 500);
});
