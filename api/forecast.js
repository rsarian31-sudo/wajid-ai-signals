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
      Math.max(Number(req.query.outputsize || 300), 120),
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
    url.searchParams.set(
      "outputsize",
      String(outputsize)
    );
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

    // Twelve Data = newest -> oldest
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

    if (candles.length < 100) {
      return res.status(200).json({
        success: true,

        symbol,
        interval,

        count:
          candles.length,

        candles,

        engine: {
          status: "WAIT",
          reason:
            "Not enough candles"
        }
      });
    }

    // =====================================================
    // EXECUTION MODEL
    //
    // Latest candle = current / next entry candle
    // All forecast calculations use completed candles only.
    //
    // Entry remains:
    // NEXT CANDLE OPEN
    // =====================================================

    const closed =
      candles.slice(0, -1);

    const nextCandle =
      candles[candles.length - 1];

    const lastClosed =
      closed[closed.length - 1];

    // =====================================================
    // SWING FORECAST
    // =====================================================

    const forecast =
      calculateSwingForecast(
        closed,
        {
          swingLen:
            clampInt(
              req.query.swingLen,
              16,
              3,
              100
            ),

          samples:
            clampInt(
              req.query.samples,
              20,
              3,
              100
            ),

          method:
            normalizeMethod(
              req.query.method ||
              "Weighted"
            ),

          atrPeriod:
            200,

          forecastBars:
            clampInt(
              req.query.forecastBars,
              5,
              1,
              20
            ),

          minForecastPct:
            0.30,

          minValidConfidence:
            45,

          minStrongConfidence:
            60,

          minAtrMultiple:
            0.75
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
    atrPeriod,
    forecastBars,
    minForecastPct,
    minValidConfidence,
    minStrongConfidence,
    minAtrMultiple
  } = options;

  if (
    !Array.isArray(candles) ||
    candles.length <
      swingLen + 10
  ) {

    return {
      valid: false,

      signalTriggered:
        false,

      quality:
        "WAIT",

      reason:
        "Not enough completed candles",

      direction:
        "WAIT",

      swingCount:
        0
    };
  }

  // =====================================================
  // CONFIRMED PIVOTS
  // =====================================================

  const pivots =
    detectConfirmedPivots(
      candles,
      swingLen
    );

  if (
    pivots.length < 3
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
        pivots.length

          ? pivots[
              pivots.length - 1
            ].type === "LOW"

              ? "BULLISH"

              : "BEARISH"

          : "WAIT",

      swingCount:
        0,

      pivots
    };
  }

  // =====================================================
  // COMPLETED SWING LEGS
  // =====================================================

  const allSwings = [];

  for (
    let i = 1;
    i < pivots.length;
    i++
  ) {

    const from =
      pivots[i - 1];

    const to =
      pivots[i];

    if (
      from.type ===
      to.type
    ) {
      continue;
    }

    const move =
      Math.abs(
        to.price -
        from.price
      );

    const pct =
      (
        move /
        from.price
      ) * 100;

    const duration =
      Math.abs(
        to.index -
        from.index
      );

    if (
      !Number.isFinite(pct) ||
      pct <= 0 ||
      !Number.isFinite(duration) ||
      duration <= 0
    ) {
      continue;
    }

    allSwings.push({

      percentage:
        pct,

      duration:
        duration,

      direction:
        from.type === "LOW" &&
        to.type === "HIGH"

          ? "BULLISH"

          : "BEARISH",

      fromType:
        from.type,

      toType:
        to.type,

      fromPrice:
        from.price,

      toPrice:
        to.price,

      fromIndex:
        from.index,

      toIndex:
        to.index,

      confirmationIndex:
        to.confirmationIndex
    });
  }

  // =====================================================
  // RECENT SAMPLE
  // =====================================================

  const recent =
    allSwings.slice(
      -samples
    );

  const latestPivot =
    pivots[
      pivots.length - 1
    ];

  if (
    recent.length < 2 ||
    !latestPivot
  ) {

    return {

      valid: false,

      signalTriggered:
        false,

      quality:
        "WAIT",

      reason:
        "Not enough completed swing history",

      direction:
        latestPivot

          ? latestPivot.type ===
            "LOW"

              ? "BULLISH"

              : "BEARISH"

          : "WAIT",

      swingCount:
        recent.length,

      pivots
    };
  }

  // =====================================================
  // CURRENT FORECAST DIRECTION
  //
  // Latest confirmed LOW
  //     -> forecast BULLISH
  //
  // Latest confirmed HIGH
  //     -> forecast BEARISH
  // =====================================================

  const isBullish =
    latestPivot.type ===
    "LOW";

  const direction =
    isBullish
      ? "BULLISH"
      : "BEARISH";

  // =====================================================
  // IMPORTANT:
  // TRADINGVIEW-STYLE FORECAST ORIGIN
  //
  // The forecast starts from the latest
  // confirmed structural pivot.
  // =====================================================

  const origin =
    latestPivot.price;

  const originIndex =
    latestPivot.index;

  const percentages =
    recent.map(
      s =>
        s.percentage
    );

  const durations =
    recent.map(
      s =>
        s.duration
    );

  // =====================================================
  // STATISTICAL FORECAST
  // =====================================================

  const fPct =
    aggregate(
      percentages,
      method
    );

  const fBars =
    aggregate(
      durations,
      method
    );

  const stdDev =
    standardDeviation(
      percentages,
      method
    );

  // =====================================================
  // FORECAST TARGET
  // =====================================================

  const target =
    isBullish

      ? origin *
        (
          1 +
          fPct / 100
        )

      : origin *
        (
          1 -
          fPct / 100
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

  const sampleScore =
    Math.min(
      1,
      recent.length /
        samples
    );

  const consistencyScore =
    Math.max(
      0,
      Math.min(
        1,
        1 -
        uncertainty / 100
      )
    );

  let confidence =
    Math.round(
      (
        consistencyScore *
        0.75
      +

        sampleScore *
        0.25
      ) * 100
    );

  confidence =
    Math.max(
      0,
      Math.min(
        100,
        confidence
      )
    );

  // =====================================================
  // QUALITY FILTERS
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

    quality =
      confidence >=
      minStrongConfidence

        ? "STRONG"

        : "VALID";
  }

  // =====================================================
  // LATEST SWING
  // =====================================================

  const latestSwing =
    recent[
      recent.length - 1
    ];

  const newSwing =
    latestPivot.confirmationIndex ===
      candles.length - 1

      ||

    latestPivot.confirmationIndex ===
      candles.length - 2;

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
      "Forecast distance below ATR minimum";

  } else {

    reason =
      quality ===
      "STRONG"

        ? "Strong forecast setup"

        : "Valid forecast setup";
  }

  // =====================================================
  // RETURN
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

    direction,

    // ===================================================
    // FORECAST ORIGIN
    // ===================================================

    origin:
      round(origin),

    originIndex:
      originIndex,

    originTime:
      candles[
        originIndex
      ]?.time || null,

    pivotType:
      latestPivot.type,

    pivotConfirmationIndex:
      latestPivot.confirmationIndex,

    pivotConfirmationTime:
      candles[
        latestPivot.confirmationIndex
      ]?.time || null,

    // ===================================================
    // FORECAST
    // ===================================================

    forecastPercent:
      round(fPct),

    forecastBars:
      round(fBars),

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

    pivots:
      pivots.slice(
        -Math.max(
          samples + 2,
          12
        )
      ),

    latestSwing,

    swings:
      recent,

    // ===================================================
    // PARAMETERS
    // ===================================================

    parameters: {

      swingLength:
        swingLen,

      samples,

      method,

      atrPeriod,

      forecastBars
    },

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
// CONFIRMED PIVOT DETECTION
// =========================================================

function detectConfirmedPivots(
  candles,
  swingLen
) {

  const pivots = [];

  /*
   * A candidate pivot at i-1 becomes confirmed
   * when candle i moves away from that extreme.
   *
   * This uses completed candles only.
   */

  for (
    let i = swingLen;
    i < candles.length;
    i++
  ) {

    const candidateIndex =
      i - 1;

    const start =
      Math.max(
        0,
        i - swingLen
      );

    const end =
      i;

    let highest =
      -Infinity;

    let lowest =
      Infinity;

    for (
      let j = start;
      j < end;
      j++
    ) {

      highest =
        Math.max(
          highest,
          candles[j].high
        );

      lowest =
        Math.min(
          lowest,
          candles[j].low
        );
    }

    const candidate =
      candles[
        candidateIndex
      ];

    const current =
      candles[i];

    const isHigh =
      candidate.high >=
        highest &&

      current.high <
        candidate.high;

    const isLow =
      candidate.low <=
        lowest &&

      current.low >
        candidate.low;

    let type =
      null;

    // Rare candle that qualifies for both.
    if (
      isHigh &&
      isLow
    ) {

      const downMove =
        candidate.high -
        current.close;

      const upMove =
        current.close -
        candidate.low;

      type =
        downMove >= upMove
          ? "HIGH"
          : "LOW";

    } else if (
      isHigh
    ) {

      type =
        "HIGH";

    } else if (
      isLow
    ) {

      type =
        "LOW";
    }

    if (!type) {
      continue;
    }

    const price =
      type === "HIGH"
        ? candidate.high
        : candidate.low;

    const last =
      pivots[
        pivots.length - 1
      ];

    // ===================================================
    // FIRST PIVOT
    // ===================================================

    if (!last) {

      pivots.push({

        type,

        price,

        index:
          candidateIndex,

        confirmationIndex:
          i
      });

      continue;
    }

    // ===================================================
    // SAME TYPE
    //
    // Keep the more extreme pivot.
    // ===================================================

    if (
      last.type ===
      type
    ) {

      const moreExtreme =
        type === "HIGH"

          ? price >
            last.price

          : price <
            last.price;

      if (
        moreExtreme
      ) {

        pivots[
          pivots.length - 1
        ] = {

          type,

          price,

          index:
            candidateIndex,

          confirmationIndex:
            i
        };
      }

      continue;
    }

    // ===================================================
    // OPPOSITE PIVOT
    //
    // This completes the previous swing leg.
    // ===================================================

    pivots.push({

      type,

      price,

      index:
        candidateIndex,

      confirmationIndex:
        i
    });
  }

  return pivots;
}


// =========================================================
// STATISTICAL AGGREGATION
// =========================================================

function aggregate(
  values,
  method
) {

  if (
    !values.length
  ) {
    return 0;
  }

  if (
    method ===
    "Median"
  ) {

    return median(
      values
    );
  }

  if (
    method ===
    "Average"
  ) {

    return avg(
      values
    );
  }

  // =====================================================
  // WEIGHTED
  //
  // Oldest = 1
  // Newest = N
  // =====================================================

  let weightedSum =
    0;

  let totalWeight =
    0;

  for (
    let i = 0;
    i < values.length;
    i++
  ) {

    const weight =
      i + 1;

    weightedSum +=
      values[i] *
      weight;

    totalWeight +=
      weight;
  }

  return totalWeight
    ? weightedSum /
      totalWeight

    : 0;
}


// =========================================================
// STANDARD DEVIATION
// =========================================================

function standardDeviation(
  values,
  method
) {

  if (
    !values.length
  ) {
    return 0;
  }

  // Weighted standard deviation
  if (
    method ===
    "Weighted"
  ) {

    let weightedMean =
      0;

    let totalWeight =
      0;

    for (
      let i = 0;
      i < values.length;
      i++
    ) {

      const weight =
        i + 1;

      weightedMean +=
        values[i] *
        weight;

      totalWeight +=
        weight;
    }

    weightedMean =
      totalWeight
        ? weightedMean /
          totalWeight

        : 0;

    let variance =
      0;

    for (
      let i = 0;
      i < values.length;
      i++
    ) {

      const weight =
        i + 1;

      variance +=
        weight *
        Math.pow(
          values[i] -
            weightedMean,
          2
        );
    }

    return totalWeight
      ? Math.sqrt(
          variance /
          totalWeight
        )

      : 0;
  }

  // Average / Median mode
  const mean =
    avg(values);

  const variance =
    values.reduce(
      (
        sum,
        value
      ) => {

        return (
          sum +
          Math.pow(
            value - mean,
            2
          )
        );

      },
      0
    ) /
    values.length;

  return Math.sqrt(
    variance
  );
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

  const risk =
    Math.max(

      forecast.atr *
      0.8,

      Math.abs(
        entry -
        forecast.origin
      ) *
      0.15
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
  // TP1
  // =====================================================

  const tp1 =
    bullish

      ? entry +
        risk * 1.5

      : entry -
        risk * 1.5;

  // =====================================================
  // TP2
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

    // ===================================================
    // EXECUTION ENTRY
    //
    // Still NEXT CANDLE OPEN.
    // ===================================================

    entry:
      round(entry),

    // ===================================================
    // STRUCTURAL FORECAST ORIGIN
    //
    // This is the important new value.
    // Example: 4341.xx
    // ===================================================

    forecastOrigin:
      forecast.origin,

    forecastOriginTime:
      forecast.originTime,

    forecastPivotType:
      forecast.pivotType,

    forecastPivotConfirmationTime:
      forecast.pivotConfirmationTime,

    // ===================================================
    // RISK
    // ===================================================

    stopLoss:
      round(stopLoss),

    tp1:
      round(tp1),

    tp2:
      round(tp2),

    // ===================================================
    // FORECAST
    // ===================================================

    forecastTarget:
      forecast.target,

    forecastPercent:
      forecast.forecastPercent,

    forecastBars:
      forecast.forecastBars,

    uncertaintyPercent:
      forecast.uncertaintyPercent,

    atrMultiple:
      forecast.atrMultiple,

    // ===================================================
    // CANDLES
    // ===================================================

    signalCandleTime:
      signalCandle.time,

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

  if (
    !candles.length
  ) {
    return 0;
  }

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

      tr.push(

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
        )
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
    sorted[
      middle - 1
    ] +

    sorted[
      middle
    ]
  ) / 2;
}


// =========================================================
// METHOD
// =========================================================

function normalizeMethod(
  value
) {

  const v =
    String(
      value ||
      "Weighted"
    ).toLowerCase();

  if (
    v === "median"
  ) {
    return "Median";
  }

  if (
    v === "average" ||
    v === "avg"
  ) {
    return "Average";
  }

  return "Weighted";
}


// =========================================================
// INTEGER CLAMP
// =========================================================

function clampInt(
  value,
  fallback,
  min,
  max
) {

  const n =
    Number(value);

  if (
    !Number.isFinite(n)
  ) {
    return fallback;
  }

  return Math.min(
    max,
    Math.max(
      min,
      Math.round(n)
    )
  );
}


// =========================================================
// ROUND
// =========================================================

function round(
  value
) {

  return Number.isFinite(
    value
  )

    ? Number(
        value.toFixed(5)
      )

    : null;
      }
