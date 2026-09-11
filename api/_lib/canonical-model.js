const STRATEGIES = Object.freeze({
  STRONG_SD_MAGNET: "strong_sd_magnet",
  SWING_LIQUIDITY: "swing_liquidity",
  SWING_FORECAST: "swing_forecast",
});

const STATUSES = Object.freeze({
  PENDING: "PENDING",
  ACTIVE: "ACTIVE",
  WIN: "WIN",
  LOSS: "LOSS",
  AMBIGUOUS: "AMBIGUOUS",
});

const RESULTS = Object.freeze({
  WIN: "WIN",
  LOSS: "LOSS",
  AMBIGUOUS: "AMBIGUOUS",
});

function assertCompletedCandle(signalCandleTime, completedCandleTime) {
  if (!signalCandleTime || !completedCandleTime) {
    throw new Error("COMPLETED_CANDLE_REQUIRED");
  }
  if (String(signalCandleTime) !== String(completedCandleTime)) {
    throw new Error("SIGNAL_MUST_USE_COMPLETED_CANDLE");
  }
  return true;
}

function assertNextCandle(signalCandleTime, entryCandleTime) {
  if (!signalCandleTime || !entryCandleTime) {
    throw new Error("NEXT_CANDLE_REQUIRED");
  }
  const signalMs = Date.parse(String(signalCandleTime));
  const entryMs = Date.parse(String(entryCandleTime));
  if (Number.isFinite(signalMs) && Number.isFinite(entryMs)) {
    if (entryMs <= signalMs) throw new Error("ENTRY_CANDLE_MUST_BE_NEXT_CANDLE");
  } else if (String(signalCandleTime) === String(entryCandleTime)) {
    throw new Error("ENTRY_CANDLE_MUST_BE_NEXT_CANDLE");
  }
  return true;
}

function deterministicSignalKey({ strategy, symbol, timeframe, candleTime }) {
  if (!strategy || !symbol || !timeframe || !candleTime) {
    throw new Error("SIGNAL_IDENTITY_REQUIRED");
  }
  return [strategy, symbol, timeframe, candleTime].map(String).join("|");
}

function normalizeSignal(candidate) {
  if (!candidate) return null;
  const direction = String(candidate.direction || "").toUpperCase();
  if (direction !== "BUY" && direction !== "SELL") {
    throw new Error("INVALID_DIRECTION");
  }
  if (!candidate.strategy || !candidate.symbol || !candidate.timeframe) {
    throw new Error("SIGNAL_FIELDS_REQUIRED");
  }

  const identityKey = deterministicSignalKey(candidate);
  return {
    id: candidate.id || identityKey,
    identityKey,
    strategy: candidate.strategy,
    symbol: candidate.symbol,
    timeframe: candidate.timeframe,
    direction,
    status: candidate.status || STATUSES.PENDING,
    signalTime: candidate.signalTime,
    candleTime: candidate.candleTime,
    entryCandleTime: candidate.entryCandleTime,
    entryPrice: Number(candidate.entryPrice),
    takeProfit: Array.isArray(candidate.takeProfit)
      ? candidate.takeProfit.map(Number)
      : [Number(candidate.takeProfit)].filter(Number.isFinite),
    stopLoss: Number(candidate.stopLoss),
    result: candidate.result ?? null,
    resultPrice: candidate.resultPrice ?? null,
    resultTime: candidate.resultTime ?? null,
    createdAt: candidate.createdAt || new Date().toISOString(),
    updatedAt: candidate.updatedAt || new Date().toISOString(),
    lockedAt: candidate.lockedAt || null,
    metadata: candidate.metadata || {},
    lastEvaluatedCandleTime: candidate.lastEvaluatedCandleTime || null,
  };
}

function lockSignal(candidate, completedCandle, nextCandle) {
  assertCompletedCandle(candidate.candleTime, completedCandle?.time);
  if (!nextCandle || !Number.isFinite(Number(nextCandle.open))) {
    throw new Error("NEXT_CANDLE_OPEN_REQUIRED");
  }
  assertNextCandle(candidate.candleTime, nextCandle.time);

  const now = new Date().toISOString();
  const signal = normalizeSignal({
    ...candidate,
    entryCandleTime: nextCandle.time,
    entryPrice: Number(nextCandle.open),
    status: STATUSES.PENDING,
    result: null,
    resultPrice: null,
    resultTime: null,
    lockedAt: now,
    updatedAt: now,
  });

  return Object.freeze(signal);
}

function recordEntry(signal, candle) {
  if (!signal.lockedAt) throw new Error("SIGNAL_NOT_LOCKED");
  if (String(candle.time) !== String(signal.entryCandleTime)) {
    throw new Error("ENTRY_CANDLE_MISMATCH");
  }
  if (Number(candle.open) !== Number(signal.entryPrice)) {
    throw new Error("ENTRY_OPEN_MISMATCH");
  }

  return {
    ...signal,
    status: STATUSES.ACTIVE,
    lastEvaluatedCandleTime: candle.time,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Conservative OHLC policy:
 * - If both SL and TP are touched in the same candle, ordering is unknowable.
 * - Mark AMBIGUOUS rather than inventing an intrabar sequence.
 * - If only one terminal level is touched, finalize it.
 */
function evaluateCandle(signal, candle) {
  if (signal.status !== STATUSES.ACTIVE) return signal;
  if (!candle?.time) throw new Error("INVALID_RESULT_CANDLE");
  const candleMs = Date.parse(String(candle.time));
  const lastMs = signal.lastEvaluatedCandleTime ? Date.parse(String(signal.lastEvaluatedCandleTime)) : NaN;
  if (Number.isFinite(candleMs) && Number.isFinite(lastMs) && candleMs <= lastMs) return signal;
  if (String(candle.time) === String(signal.entryCandleTime)) return { ...signal, lastEvaluatedCandleTime: candle.time, updatedAt: new Date().toISOString() };

  const high = Number(candle.high);
  const low = Number(candle.low);
  const sl = Number(signal.stopLoss);
  const targetIndex = Number.isInteger(Number(signal.metadata?.resultTargetIndex))
    ? Number(signal.metadata.resultTargetIndex)
    : 0;
  const tp = Number(signal.takeProfit?.[targetIndex]);

  if (![high, low, sl, tp].every(Number.isFinite)) {
    throw new Error("INVALID_RESULT_CANDLE");
  }

  const slTouched = signal.direction === "BUY" ? low <= sl : high >= sl;
  const tpTouched = signal.direction === "BUY" ? high >= tp : low <= tp;

  if (slTouched && tpTouched) {
    return {
      ...signal,
      status: STATUSES.AMBIGUOUS,
      result: RESULTS.AMBIGUOUS,
      resultPrice: null,
      resultTime: candle.time,
      updatedAt: new Date().toISOString(),
    };
  }

  if (tpTouched) {
    return {
      ...signal,
      status: STATUSES.WIN,
      result: RESULTS.WIN,
      resultPrice: tp,
      resultTime: candle.time,
      updatedAt: new Date().toISOString(),
    };
  }

  if (slTouched) {
    return {
      ...signal,
      status: STATUSES.LOSS,
      result: RESULTS.LOSS,
      resultPrice: sl,
      resultTime: candle.time,
      updatedAt: new Date().toISOString(),
    };
  }

  return signal;
}

function assertImmutableTransition(previous, next) {
  if (previous.lockedAt) {
    const immutable = [
      "strategy","symbol","timeframe","direction","candleTime",
      "entryCandleTime","entryPrice","stopLoss","takeProfit","lockedAt","id"
    ];
    for (const key of immutable) {
      if (JSON.stringify(previous[key]) !== JSON.stringify(next[key])) {
        throw new Error(`LOCKED_SIGNAL_IMMUTABLE:${key}`);
      }
    }
  }
  if (
    previous.status === STATUSES.WIN ||
    previous.status === STATUSES.LOSS ||
    previous.status === STATUSES.AMBIGUOUS
  ) {
    if (JSON.stringify(previous) !== JSON.stringify(next)) {
      throw new Error("FINALIZED_SIGNAL_IMMUTABLE");
    }
  }
  return true;
}

function calculateWinRate(records) {
  const wins = records.filter(r => r.result === RESULTS.WIN).length;
  const losses = records.filter(r => r.result === RESULTS.LOSS).length;
  const denominator = wins + losses;
  return denominator ? Number(((wins / denominator) * 100).toFixed(2)) : 0;
}

function summarize(records) {
  const wins = records.filter(r => r.result === RESULTS.WIN).length;
  const losses = records.filter(r => r.result === RESULTS.LOSS).length;
  const active = records.filter(r => r.status === STATUSES.ACTIVE).length;
  const pending = records.filter(r => r.status === STATUSES.PENDING).length;
  const ambiguous = records.filter(r => r.result === RESULTS.AMBIGUOUS).length;
  return {
    totalSignals: records.length,
    wins,
    losses,
    open: pending + active,
    pending,
    active,
    ambiguous,
    winRate: calculateWinRate(records),
  };
}

module.exports = {
  STRATEGIES,
  STATUSES,
  RESULTS,
  assertCompletedCandle,
  assertNextCandle,
  deterministicSignalKey,
  normalizeSignal,
  lockSignal,
  recordEntry,
  evaluateCandle,
  assertImmutableTransition,
  calculateWinRate,
  summarize,
};
