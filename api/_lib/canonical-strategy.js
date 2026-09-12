require('./twelve-data-cache.cjs').installTwelveDataFetchCache();

const {
  createLockedSignal,
  registerEntry,
  monitor,
  getHistory,
} = require('./canonical-api');

function toCanonicalTakeProfit(values) {
  return (Array.isArray(values) ? values : [values])
    .map(Number)
    .filter(Number.isFinite);
}

function buildCandidate({
  strategy,
  symbol,
  timeframe,
  direction,
  signalTime,
  candleTime,
  stopLoss,
  takeProfit,
  metadata,
}) {
  if (!direction || direction === 'WAIT') return null;
  const tp = toCanonicalTakeProfit(takeProfit);
  const sl = Number(stopLoss);
  if (!Number.isFinite(sl) || !tp.length) return null;

  return {
    strategy,
    symbol,
    timeframe,
    direction,
    signalTime: signalTime || candleTime,
    candleTime,
    stopLoss: sl,
    takeProfit: tp,
    metadata: metadata || {},
  };
}

async function persistCandidate(candidate, completedCandle, nextCandle) {
  if (!candidate) return { created: false, signal: null };
  const locked = await createLockedSignal(candidate, completedCandle, nextCandle);
  // The next candle OPEN is already immutable and known. Record it once.
  const signal = locked.signal;
  if (signal.status === 'PENDING') {
    return { ...locked, signal: await registerEntry(signal.identityKey, nextCandle) };
  }
  return locked;
}

async function syncOpenSignals({ strategy, symbol, timeframe, candles }) {
  const closed = Array.isArray(candles) ? candles.slice(0, -1) : [];
  if (!closed.length) return [];

  const records = await getHistory({ strategy, symbol, timeframe });
  const open = records.filter(r => r.status === 'PENDING' || r.status === 'ACTIVE');
  const updated = [];

  for (const signal of open) {
    let current = signal;
    const entry = closed.find(c => String(c.time) === String(signal.entryCandleTime));
    if (current.status === 'PENDING' && entry) {
      current = await registerEntry(current.identityKey, entry);
    }
    if (current.status !== 'ACTIVE') {
      updated.push(current);
      continue;
    }

    const entryMs = Date.parse(String(current.entryCandleTime));
    const candidates = closed
      .filter(c => {
        const ms = Date.parse(String(c.time));
        return !Number.isFinite(entryMs) || !Number.isFinite(ms) || ms > entryMs;
      })
      .sort((a, b) => Date.parse(String(a.time)) - Date.parse(String(b.time)));

    for (const candle of candidates) {
      const next = await monitor(current.identityKey, candle);
      current = next;
      if (current.status === 'WIN' || current.status === 'LOSS' || current.status === 'AMBIGUOUS') break;
    }
    updated.push(current);
  }
  return updated;
}

module.exports = {
  buildCandidate,
  persistCandidate,
  syncOpenSignals,
};
