/**
 * Persistent store adapter.
 *
 * Production target for the current Vercel/serverless deployment:
 * Upstash Redis via its REST API. No Node SDK is required.
 *
 * Required server env:
 *   UPSTASH_REDIS_REST_URL
 *   UPSTASH_REDIS_REST_TOKEN
 *
 * The adapter is deliberately isolated so a PostgreSQL/Supabase adapter can
 * replace it later without changing signal lifecycle or API contracts.
 */

const URL = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

function assertConfigured() {
  if (!URL || !TOKEN) {
    const error = new Error("CANONICAL_STORE_NOT_CONFIGURED");
    error.code = "CANONICAL_STORE_NOT_CONFIGURED";
    throw error;
  }
}

async function command(...parts) {
  assertConfigured();
  const response = await fetch(URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(parts),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.error) {
    throw new Error(payload?.error || `Redis request failed (${response.status})`);
  }
  return payload?.result;
}

const key = (identityKey) => `wajid:signal:${identityKey}`;
const indexKey = "wajid:signals:index";

async function getByIdentity(identityKey) {
  const raw = await command("GET", key(identityKey));
  return raw ? JSON.parse(raw) : null;
}

async function createIfAbsent(signal) {
  const existing = await getByIdentity(signal.identityKey);
  if (existing) return { created: false, signal: existing };

  // Redis SET NX gives the identity a server-side uniqueness guard.
  const result = await command(
    "SET",
    key(signal.identityKey),
    JSON.stringify(signal),
    "NX",
  );

  if (result !== "OK") {
    const winner = await getByIdentity(signal.identityKey);
    return { created: false, signal: winner };
  }

  await command(
    "ZADD",
    indexKey,
    Date.parse(signal.candleTime || signal.createdAt),
    signal.identityKey,
  );

  return { created: true, signal };
}

async function update(signal) {
  const existing = await getByIdentity(signal.identityKey);
  if (!existing) throw new Error("SIGNAL_NOT_FOUND");

  const { assertImmutableTransition } = require("./canonical-model");
  assertImmutableTransition(existing, signal);

  await command("SET", key(signal.identityKey), JSON.stringify(signal));
  return signal;
}

async function list({ limit = 100 } = {}) {
  const ids = await command("ZREVRANGE", indexKey, "0", String(Math.max(0, limit - 1)));
  if (!Array.isArray(ids) || ids.length === 0) return [];

  const records = [];
  for (const id of ids) {
    const item = await getByIdentity(id);
    if (item) records.push(item);
  }
  return records;
}

module.exports = {
  createIfAbsent,
  getByIdentity,
  update,
  list,
};
