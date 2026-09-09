export default async function handler(req, res) {
  try {
    const apiKey = process.env.TWELVE_DATA_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error: "TWELVE_DATA_API_KEY is not configured"
      });
    }

    const action = String(req.query.action || "market");
    const symbol = String(req.query.symbol || "XAU/USD").trim();
    const interval = String(req.query.interval || "15min");

    const outputsize = Math.min(
      Math.max(Number(req.query.outputsize || 250), 80),
      500
    );

    // =====================================================
    // SYMBOL SEARCH
    // =====================================================

    if (action === "search") {
      const q = String(req.query.q || "").trim();

      if (!q) {
        return res.status(400).json({
          success: false,
          error: "Search query is required"
        });
      }

      const url = new URL(
        "https://api.twelvedata.com/symbol_search"
      );

      url.searchParams.set("symbol", q);
      url.searchParams.set("apikey", apiKey);

      const response = await fetch(url);
      const data = await response.json();

      if (!response.ok || data.status === "error") {
        return res.status(400).json({
          success: false,
          error: data.message || "Search failed"
        });
      }

      return res.status(200).json({
        success: true,
        action: "search",
        results: Array.isArray(data.data)
          ? data.data
          : []
      });
    }

    // =====================================================
    // MARKET DATA
    // =====================================================

    const url = new URL(
      "https://api.twelvedata.com/time_series"
    );

    url.searchParams.set("symbol", symbol);
    url.searchParams.set("interval", interval);
    url.searchParams.set("outputsize", String(outputsize));
    url.searchParams.set("apikey", apiKey);
    url.searchParams.set("format", "JSON");

    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok || data.status === "error") {
      return res.status(400).json({
        success: false,
        error:
          data.message ||
          "Twelve Data request failed"
      });
    }

    if (!Array.isArray(data.values)) {
      return res.status(400).json({
        success: false,
        error: "No candle data received"
      });
    }

    // Twelve Data returns newest -> oldest.
    // Convert to oldest -> newest.

    const candles = data.values
      .map(c => ({
        time: c.datetime,

        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),

        volume: Number(c.volume || 0)
      }))
      .filter(c =>
        [
          c.open,
          c.high,
          c.low,
          c.close
        ].every(Number.isFinite)
      )
      .reverse();

    // =====================================================
    // MINIMUM CANDLES
    // =====================================================

    if (candles.length < 60) {
      return res.status(200).json({
        success: true,
        symbol,
        interval,
        count: candles.length,
        candles,

        engine: {
          status: "WAIT",
          reason: "Not enough candles"
        }
      });
    }

    // =====================================================
    // EXECUTION MODEL
    //
    // Last candle = next/current entry candle
    // Previous candles = completed candles
    //
    // Forecast is calculated from COMPLETED candles.
    // Entry = OPEN of next candle.
    // =====================================================

    const closed =
      candles.slice(0, -1);

    const nextCandle =
      candles[candles.length - 1];

    const lastClosed =
      closed[closed.length - 1];

    // =====================================================
    // FORECAST
    // =====================================================

    const forecast =
      calculateSwingForecast(
        closed,
        {
          swingLen:
            Number(
              req.query.swingLen || 16
            ),

          samples:
            Number(
              req.query.samples || 20
            ),

          method:
            String(
              req.query.method ||
              "Weighted"
            ),

          atrPeriod: 200
        }
      );

    // =====================================================
    // BUILD SIGNAL
    // =====================================================

    const signal =
      forecast.signalTriggered &&
      nextCandle

        ? buildSignal(
            forecast,
            lastClosed,
            nextCandle.open,
            nextCandle.time
          )

        : null;

    // =====================================================
    // FINAL RESPONSE
    // =====================================================

    return res.status(200).json({
      success: true,

      symbol,
      interval,

      count:
        candles.length,

      candles,

      closedCandle:
        lastClosed,

      nextCandle,

      engine: {
        status:
          signal
            ? signal.direction
            : "WAIT",

        signal,

        forecast
      }
    });

  } catch (error) {

    return res.status(500).json({
      success: false,

      error:
        error.message ||
        "Server error"
    });
  }
}


// =========================================================
// SWING STRUCTURE FORECAST ENGINE
// =========================================================

function calculateSwingForecast(
  candles,
  options
) {

  const {
    swingLen,
    samples,
    method,
    atrPeriod
  } = options;

  const high =
    candles.map(
      c => c.high
    );

  const low =
    candles.map(
      c => c.low
    );

  let dir = false;
  let prevDir = false;

  let hi = {
    price: null,
    idx: null
  };

  let lo = {
    price: null,
    idx: null
  };

  const pcts = [];
  const durs = [];
  const swings = [];

  // =====================================================
  // SWING DETECTION
  // =====================================================

  for (
    let i = swingLen;
    i < candles.length;
    i++
  ) {

    prevDir = dir;

    const highest =
      Math.max(
        ...high.slice(
          i - swingLen + 1,
          i + 1
        )
      );

    const lowest =
      Math.min(
        ...low.slice(
          i - swingLen + 1,
          i + 1
        )
      );

    // New high
    if (
      high[i] === highest
    ) {
      dir = true;
    }

    // New low
    if (
      low[i] === lowest
    ) {
      dir = false;
    }

    // ===================================================
    // PREVIOUS SWING
    // ===================================================

    if (i > 0) {

      const prevHighest =
        Math.max(
          ...high.slice(
            i - swingLen,
            i
          )
        );

      const prevLowest =
        Math.min(
          ...low.slice(
            i - swingLen,
            i
          )
        );

      // Swing high
      if (
        high[i - 1] ===
          prevHighest &&
        high[i] < highest
      ) {

        hi = {
          price:
            high[i - 1],

          idx:
            i - 1
        };
      }

      // Swing low
      if (
        low[i - 1] ===
          prevLowest &&
        low[i] > lowest
      ) {

        lo = {
          price:
            low[i - 1],

          idx:
            i - 1
        };
      }
    }

    // ===================================================
    // CONFIRMED SWING
    // ===================================================

    if (
      dir !== prevDir &&
      hi.price !== null &&
      lo.price !== null
    ) {

      const pct =
        !dir

          ? (
              (
                hi.price -
                lo.price
              ) /
              lo.price
            ) * 100

          : (
              (
                lo.price -
                hi.price
              ) /
              hi.price
            ) * 100;

      const bars =
        Math.abs(
          hi.idx -
          lo.idx
        );

      if (
        Number.isFinite(pct) &&
        pct !== 0 &&
        Number.isFinite(bars)
      ) {

        pcts.push(
          Math.abs(pct)
        );

        durs.push(
          bars
        );

        swings.push({

          percentage:
            Math.abs(pct),

          duration:
            bars,

          direction:
            dir
              ? "BULLISH"
              : "BEARISH",

          high:
            hi.price,

          low:
            lo.price,

          highIndex:
            hi.idx,

          lowIndex:
            lo.idx,

          confirmationIndex:
            i
        });
      }
    }
  }

  // =====================================================
  // RECENT SWINGS
  // =====================================================

  const recent =
    swings.slice(
      -Math.max(
        2,
        Math.min(
          samples,
          20
        )
      )
    );

  // =====================================================
  // NOT ENOUGH HISTORY
  // =====================================================

  if (
    recent.length < 2
  ) {

    return {

      valid: false,

      signalTriggered:
        false,

      quality:
        "WAIT",

      reason:
        "Not enough confirmed swing history",

      direction:
        dir
          ? "BULLISH"
          : "BEARISH",

      swingCount:
        recent.length
    };
  }

  const rp =
    pcts.slice(
      -recent.length
    );

  const rd =
    durs.slice(
      -recent.length
    );

  // =====================================================
  // FORECAST METHOD
  // =====================================================

  let fPct;
  let fBars;

  // Median
  if (
    method === "Median"
  ) {

    fPct =
      median(rp);

    fBars =
      median(rd);

  }

  // Average
  else if (
    method === "Average"
  ) {

    fPct =
      avg(rp);

    fBars =
      avg(rd);

  }

  // Weighted
  else {

    let wp = 0;
    let wb = 0;
    let tw = 0;

    for (
      let i = 0;
      i < rp.length;
      i++
    ) {

      const w =
        i + 1;

      wp +=
        rp[i] * w;

      wb +=
        rd[i] * w;

      tw += w;
    }

    fPct =
      wp / tw;

    fBars =
      wb / tw;
  }

  // =====================================================
  // STANDARD DEVIATION
  // =====================================================

  const variance =
    rp.reduce(
      (
        sum,
        value
      ) => {

        return (
          sum +
          Math.pow(
            value - fPct,
            2
          )
        );

      },
      0
    ) / recent.length;

  const stdDev =
    Math.sqrt(
      variance
    );

  // =====================================================
  // CURRENT DIRECTION
  // =====================================================

  const isBear =
    !dir;

  // =====================================================
  // ORIGIN
  // =====================================================

  const origin =
    isBear
      ? hi.price
      : lo.price;

  const originIdx =
    isBear
      ? hi.idx
      : lo.idx;

  // =====================================================
  // TARGET
  // =====================================================

  const target =
    isBear

      ? origin *
        (
          1 -
          fPct / 100
        )

      : origin *
        (
          1 +
          fPct / 100
        );

  // =====================================================
  // UNCERTAINTY
  // =====================================================

  const uncertainty =
    fPct > 0

      ? (
          stdDev /
          fPct
        ) * 100

      : 100;

  // =====================================================
  // CONFIDENCE
  // =====================================================

  let confidence =
    (
      (
        100 -
        uncertainty
      ) * 0.8
    )

    +

    (
      recent.length /
      Math.max(
        samples,
        1
      )
    ) *
    100 *
    0.2;

  confidence =
    Math.round(
      Math.max(
        0,
        Math.min(
          100,
          confidence
        )
      )
    );

  // =====================================================
  // ATR
  // =====================================================

  const atr =
    calculateATR(
      candles,
      Math.min(
        atrPeriod,
        candles.length
      )
    );

  const targetDistance =
    Math.abs(
      target -
      origin
    );

  const atrMultiple =
    atr > 0
      ? targetDistance /
        atr
      : 0;

  // =====================================================
  // SIGNAL FILTERS
  // =====================================================

  const minForecastPct =
    0.30;

  const minValidConfidence =
    45;

  const minStrongConfidence =
    60;

  const minAtrMultiple =
    1.5;

  // =====================================================
  // QUALITY CHECK
  // =====================================================

  const forecastPass =
    fPct >=
    minForecastPct;

  const confidencePass =
    confidence >=
    minValidConfidence;

  const atrPass =
    atrMultiple >=
    minAtrMultiple;

  // =====================================================
  // VALID SIGNAL
  // =====================================================

  const qualityEligible =
    forecastPass &&
    confidencePass &&
    atrPass &&
    Number.isFinite(
      origin
    ) &&
    Number.isFinite(
      target
    );

  // =====================================================
  // QUALITY LEVEL
  // =====================================================

  let quality =
    "WAIT";

  if (
    qualityEligible
  ) {

    if (
      confidence >=
      minStrongConfidence
    ) {

      quality =
        "STRONG";

    } else {

      quality =
        "VALID";
    }
  }

  // =====================================================
  // LATEST SWING
  // =====================================================

  const latestSwing =
    recent[
      recent.length - 1
    ];

  const newSwing =
    latestSwing &&
    latestSwing.confirmationIndex ===
      candles.length - 1;

  // =====================================================
  // REASON
  // =====================================================

  let reason =
    "Waiting for setup";

  if (
    !forecastPass
  ) {

    reason =
      "Forecast move below minimum";

  } else if (
    !confidencePass
  ) {

    reason =
      "Confidence below minimum";

  } else if (
    !atrPass
  ) {

    reason =
      "ATR multiple below minimum";

  } else {

    reason =
      quality ===
      "STRONG"

        ? "Strong forecast setup"

        : "Valid forecast setup";
  }

  // =====================================================
  // RETURN FORECAST
  // =====================================================

  return {

    valid: true,

    signalTriggered:
      qualityEligible,

    quality,

    reason,

    triggerType:
      newSwing
        ? "NEW_SWING"
        : "FORECAST_QUALITY",

    direction:
      isBear
        ? "BEARISH"
        : "BULLISH",

    forecastPercent:
      round(fPct),

    forecastBars:
      round(fBars),

    origin:
      round(origin),

    originIndex:
      originIdx,

    target:
      round(target),

    stdDev:
      round(stdDev),

    uncertaintyPercent:
      round(uncertainty),

    confidence,

    atr:
      round(atr),

    atrMultiple:
      round(atrMultiple),

    swingCount:
      recent.length,

    latestSwing,

    swings:
      recent,

    filters: {

      forecastPass,

      confidencePass,

      atrPass
    },

    thresholds: {

      minForecastPercent:
        minForecastPct,

      minValidConfidence:
        minValidConfidence,

      minStrongConfidence:
        minStrongConfidence,

      minAtrMultiple:
        minAtrMultiple
    }
  };
}


// =========================================================
// BUILD SIGNAL
// =========================================================

function buildSignal(
  forecast,
  signalCandle,
  entry,
  entryCandleTime
) {

  // =====================================================
  // RISK
  // =====================================================

  const risk =
    Math.max(

      forecast.atr *
      0.8,

      Math.abs(
        entry -
        forecast.origin
      ) * 0.15
    );

  const bullish =
    forecast.direction ===
    "BULLISH";

  // =====================================================
  // STOP LOSS
  // =====================================================

  const stopLoss =
    bullish
      ? entry - risk
      : entry + risk;

  // =====================================================
  // TAKE PROFIT 1
  // =====================================================

  const tp1 =
    bullish

      ? entry +
        risk * 1.5

      : entry -
        risk * 1.5;

  // =====================================================
  // TAKE PROFIT 2
  // =====================================================

  const tp2 =
    bullish

      ? entry +
        risk * 2.5

      : entry -
        risk * 2.5;

  // =====================================================
  // SIGNAL
  // =====================================================

  return {

    direction:
      bullish
        ? "BUY"
        : "SELL",

    quality:
      forecast.quality,

    confidence:
      forecast.confidence,

    entry:
      round(entry),

    stopLoss:
      round(stopLoss),

    tp1:
      round(tp1),

    tp2:
      round(tp2),

    forecastTarget:
      forecast.target,

    forecastPercent:
      forecast.forecastPercent,

    uncertaintyPercent:
      forecast.uncertaintyPercent,

    atrMultiple:
      forecast.atrMultiple,

    // ===================================================
    // SIGNAL CANDLE
    // ===================================================

    signalCandleTime:
      signalCandle.time,

    // ===================================================
    // ENTRY CANDLE
    // ===================================================

    entryCandleTime:
      entryCandleTime,

    // ===================================================
    // EXECUTION RULE
    // ===================================================

    entryRule:
      "NEXT_CANDLE_OPEN",

    triggerType:
      forecast.triggerType
  };
}


// =========================================================
// ATR
// =========================================================

function calculateATR(
  candles,
  period
) {

  const tr = [];

  for (
    let i = 0;
    i < candles.length;
    i++
  ) {

    if (
      i === 0
    ) {

      tr.push(
        candles[i].high -
        candles[i].low
      );

    } else {

      const c =
        candles[i];

      const p =
        candles[i - 1];

      const trueRange =
        Math.max(

          c.high -
          c.low,

          Math.abs(
            c.high -
            p.close
          ),

          Math.abs(
            c.low -
            p.close
          )
        );

      tr.push(
        trueRange
      );
    }
  }

  const slice =
    tr.slice(
      -period
    );

  if (
    !slice.length
  ) {
    return 0;
  }

  return (
    slice.reduce(
      (a, b) =>
        a + b,
      0
    ) /
    slice.length
  );
}


// =========================================================
// AVERAGE
// =========================================================

function avg(arr) {

  if (
    !arr.length
  ) {
    return 0;
  }

  return (
    arr.reduce(
      (x, y) =>
        x + y,
      0
    ) /
    arr.length
  );
}


// =========================================================
// MEDIAN
// =========================================================

function median(arr) {

  if (
    !arr.length
  ) {
    return 0;
  }

  const sorted =
    [...arr].sort(
      (a, b) =>
        a - b
    );

  const middle =
    Math.floor(
      sorted.length / 2
    );

  if (
    sorted.length % 2
  ) {

    return sorted[
      middle
    ];
  }

  return (
    sorted[middle - 1] +
    sorted[middle]
  ) / 2;
}


// =========================================================
// ROUND
// =========================================================

function round(value) {

  return Number.isFinite(
    value
  )

    ? Number(
        value.toFixed(5)
      )

    : null;
}
