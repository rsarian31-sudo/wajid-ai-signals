const store = require("./canonical-store");
const {
  STRATEGIES,
  STATUSES,
  RESULTS,
  lockSignal,
  recordEntry,
  evaluateCandle,
  summarize,
} = require("./canonical-model");

const ALLOWED_STRATEGIES = new Set(Object.values(STRATEGIES));

function json(res, status, body) {
  return res.status(status).json(body);
}

function errorResponse(res, error) {
  const map = {
    CANONICAL_STORE_NOT_CONFIGURED: [503, "Canonical persistent storage is not configured."],
    SIGNAL_NOT_FOUND: [404, "Signal not found."],
    SIGNAL_MUST_USE_COMPLETED_CANDLE: [409, "Signal must be based on the completed candle."],
    NEXT_CANDLE_OPEN_REQUIRED: [409, "Next candle OPEN is required for entry."],
    ENTRY_CANDLE_MISMATCH: [409, "Entry candle does not match the locked signal."],
    ENTRY_OPEN_MISMATCH: [409, "Entry price must equal the next candle OPEN."],
    LOCKED_SIGNAL_IMMUTABLE: [409, "Locked signal fields are immutable."],
    FINALIZED_SIGNAL_IMMUTABLE: [409, "Finalized signal is immutable."],
  };
  const [status, message] = map[error.code] || map[error.message] || [500, error.message || "Server error"];
  return json(res, status, { success: false, error: { code: error.code || error.message || "SERVER_ERROR", message } });
}

async function createLockedSignal(candidate, completedCandle, nextCandle) {
  if (!ALLOWED_STRATEGIES.has(candidate.strategy)) throw new Error("INVALID_STRATEGY");
  const locked = lockSignal(candidate, completedCandle, nextCandle);
  return store.createIfAbsent(locked);
}

async function registerEntry(identityKey, candle) {
  const signal = await store.getByIdentity(identityKey);
  if (!signal) throw new Error("SIGNAL_NOT_FOUND");
  const active = recordEntry(signal, candle);
  return store.update(active);
}

async function monitor(identityKey, candle) {
  const signal = await store.getByIdentity(identityKey);
  if (!signal) throw new Error("SIGNAL_NOT_FOUND");
  const next = evaluateCandle(signal, candle);
  if (next === signal) return signal;
  return store.update(next);
}

async function getHistory(filters = {}) {
  const records = await store.list({ limit: 500 });
  return records.filter(record => {
    if (filters.strategy && record.strategy !== filters.strategy) return false;
    if (filters.symbol && record.symbol !== filters.symbol) return false;
    if (filters.timeframe && record.timeframe !== filters.timeframe) return false;
    if (filters.direction && record.direction !== filters.direction) return false;
    if (filters.result && record.result !== filters.result) return false;
    if (filters.from && Date.parse(record.candleTime) < Date.parse(filters.from)) return false;
    if (filters.to && Date.parse(record.candleTime) > Date.parse(filters.to)) return false;
    return true;
  });
}

async function getPerformance(filters = {}) {
  const records = await getHistory(filters);
  const strategies = Object.values(STRATEGIES);
  const directions = ["BUY", "SELL"];
  const strategyPerformance = Object.fromEntries(
    strategies.map(strategy => [
      strategy,
      summarize(records.filter(record => record.strategy === strategy)),
    ])
  );
  const directionPerformance = Object.fromEntries(
    directions.map(direction => [
      direction,
      summarize(records.filter(record => record.direction === direction)),
    ])
  );
  return {
    ...summarize(records),
    strategyPerformance,
    directionPerformance,
  };
}

module.exports = {
  createLockedSignal,
  registerEntry,
  monitor,
  getHistory,
  getPerformance,
  STATUSES,
  RESULTS,
};
