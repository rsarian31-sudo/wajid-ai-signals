// api/liquidity.js
// Owajid & Bokul Trading Assistant
// Strategy 02 — Swing Liquidity
//
// Based on the user's supplied:
// "Swing Points and Liquidity - By Leviathan"
//
// IMPORTANT:
// This endpoint is independent from the Strong SD Magnet engine.
// Do NOT modify api/market.js for this strategy.

const API_KEY = process.env.TWELVE_DATA_API_KEY;

const ALLOWED_INTERVALS = new Set([
  "5min",
  "15min"
]);

const DEFAULT_SYMBOL = "XAU/USD";

const CONFIG = {
  swingLeft: 15,
  swingRight: 10,

  atrLength: 14,

  sweepLookback: 8,

  confirmationBars: 6,

  outputSize: 300,

  slAtrBuffer: 0.35,

  tp1R: 1,
  tp2R: 2,
  tp3R: 3
};


/* =========================================================
   VERCEL HANDLER
========================================================= */

export default async function handler(req, res) {

  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate"
  );

  res.setHeader(
    "Pragma",
    "no-cache"
  );

  res.setHeader(
    "Expires",
    "0"
  );

  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).json({
      success: true
    });
  }

  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  if (!API_KEY) {
    return res.status(500).json({
      success: false,
      error: "TWELVE_DATA_API_KEY is not configured"
    });
  }

  try {

    const rawSymbol =
      req.query?.symbol ||
      DEFAULT_SYMBOL;

    const symbol =
      normalizeSymbol(rawSymbol);

    const interval =
      normalizeInterval(
        req.query?.interval
      );

    const outputSize =
      normalizeOutputSize(
        req.query?.outputsize
      );

    const candles =
      await fetchTwelveData(
        symbol,
        interval,
        outputSize
      );

    if (!candles.length) {

      return res.status(502).json({
        success: false,
        error: "No market candles returned",
        symbol,
        interval
      });
    }

    const analysis =
      analyzeSwingLiquidity(
        candles
      );

    return res.status(200).json({

      success: true,

      strategy: {
        id: "swing-liquidity",
        name: "Swing Liquidity",
        source: "Swing Points and Liquidity",
        swingLeft: CONFIG.swingLeft,
        swingRight: CONFIG.swingRight
      },

      market: {
        symbol,
        interval,
        price:
          candles[candles.length - 1].close,
        lastCandleTime:
          candles[candles.length - 1].time
      },

      candles,

      swings: {
        highs:
          analysis.swings.highs,
        lows:
          analysis.swings.lows
      },

      liquidity: {
        levels:
          analysis.liquidityLevels,
        sweeps:
          analysis.sweeps
      },

      signal:
        analysis.signal,

      tradePlan:
        analysis.tradePlan,

      diagnostics:
        analysis.diagnostics

    });

  } catch (error) {

    console.error(
      "Swing Liquidity API error:",
      error
    );

    return res.status(500).json({

      success: false,

      error:
        error?.message ||
        "Swing Liquidity engine error"

    });
  }
}


/* =========================================================
   NORMALIZATION
========================================================= */

function normalizeSymbol(value) {

  let symbol =
    String(value || DEFAULT_SYMBOL)
      .trim();

  /*
    Twelve Data accepts symbols such as:
    XAU/USD
    GBP/USD
    BTC/USD
    AAPL

    Remove common TradingView prefixes
    when they are supplied by the frontend.
  */

  symbol =
    symbol
      .replace(/^OANDA:/i, "")
      .replace(/^BINANCE:/i, "")
      .replace(/^TVC:/i, "")
      .replace(/^FOREX:/i, "")
      .trim();

  return symbol;
}


function normalizeInterval(value) {

  const interval =
    String(value || "15min")
      .trim()
      .toLowerCase();

  if (!ALLOWED_INTERVALS.has(interval)) {
    return "15min";
  }

  return interval;
}


function normalizeOutputSize(value) {

  const number =
    Number(value || CONFIG.outputSize);

  if (!Number.isFinite(number)) {
    return CONFIG.outputSize;
  }

  return Math.min(
    500,
    Math.max(
      100,
      Math.floor(number)
    )
  );
}


/* =========================================================
   TWELVE DATA
========================================================= */

async function fetchTwelveData(
  symbol,
  interval,
  outputSize
) {

  const params =
    new URLSearchParams({

      symbol,

      interval,

      outputsize:
        String(outputSize),

      order:
        "ASC",

      timezone:
        "UTC",

      apikey:
        API_KEY
    });

  const url =
    "https://api.twelvedata.com/time_series?" +
    params.toString();

  const response =
    await fetch(url, {
      method: "GET",
      headers: {
        "Accept": "application/json"
      }
    });

  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error(
      "Invalid response from Twelve Data"
    );
  }

  if (!response.ok) {

    throw new Error(
      `Twelve Data HTTP ${response.status}`
    );
  }

  if (
    data?.status === "error" ||
    data?.code
  ) {

    throw new Error(
      data?.message ||
      "Twelve Data returned an error"
    );
  }

  if (
    !Array.isArray(data?.values)
  ) {

    throw new Error(
      data?.message ||
      "Twelve Data returned no values"
    );
  }

  const candles =
    data.values
      .map(row => {

        const timestamp =
          row.timestamp
            ? Number(row.timestamp)
            : Date.parse(
                String(row.datetime || "")
              ) / 1000;

        return {

          time:
            Math.floor(timestamp),

          open:
            Number(row.open),

          high:
            Number(row.high),

          low:
            Number(row.low),

          close:
            Number(row.close),

          volume:
            Number(row.volume || 0)
        };

      })
      .filter(c =>
        Number.isFinite(c.time) &&
        Number.isFinite(c.open) &&
        Number.isFinite(c.high) &&
        Number.isFinite(c.low) &&
        Number.isFinite(c.close)
      );

  candles.sort(
    (a, b) => a.time - b.time
  );

  /*
    Remove duplicate timestamps.
  */

  const unique = [];

  const seen =
    new Set();

  for (const candle of candles) {

    if (seen.has(candle.time)) {
      continue;
    }

    seen.add(candle.time);

    unique.push(candle);
  }

  return unique;
}


/* =========================================================
   ATR
========================================================= */

function calculateATR(
  candles,
  length = CONFIG.atrLength
) {

  if (!candles.length) {
    return 0;
  }

  const tr = [];

  for (
    let i = 0;
    i < candles.length;
    i++
  ) {

    const current =
      candles[i];

    const previous =
      i > 0
        ? candles[i - 1]
        : null;

    if (!previous) {

      tr.push(
        current.high -
        current.low
      );

      continue;
    }

    tr.push(
      Math.max(

        current.high -
        current.low,

        Math.abs(
          current.high -
          previous.close
        ),

        Math.abs(
          current.low -
          previous.close
        )
      )
    );
  }

  const start =
    Math.max(
      0,
      tr.length - length
    );

  let total = 0;
  let count = 0;

  for (
    let i = start;
    i < tr.length;
    i++
  ) {

    total += tr[i];
    count++;
  }

  return count
    ? total / count
    : 0;
}


/* =========================================================
   VOLUME
========================================================= */

function averageVolume(
  candles,
  index,
  length = 20
) {

  const start =
    Math.max(
      0,
      index - length
    );

  let total = 0;
  let count = 0;

  for (
    let i = start;
    i < index;
    i++
  ) {

    const value =
      Number(
        candles[i].volume || 0
      );

    if (value > 0) {

      total += value;
      count++;
    }
  }

  return count
    ? total / count
    : 0;
}


function volumeConfirmation(
  candles,
  index
) {

  const current =
    Number(
      candles[index]?.volume || 0
    );

  const average =
    averageVolume(
      candles,
      index
    );

  if (
    current <= 0 ||
    average <= 0
  ) {

    return {
      available: false,
      strong: false,
      current,
      average
    };
  }

  return {

    available: true,

    strong:
      current >= average,

    current,

    average
  };
}


/* =========================================================
   SWING POINTS
========================================================= */

function findSwingPoints(
  candles
) {

  const highs = [];
  const lows = [];

  const L =
    CONFIG.swingLeft;

  const R =
    CONFIG.swingRight;

  /*
    Equivalent concept:

    ta.pivothigh(
      high,
      swingSizeL,
      swingSizeR
    )

    ta.pivotlow(
      low,
      swingSizeL,
      swingSizeR
    )
  */

  for (
    let i = L;
    i < candles.length - R;
    i++
  ) {

    const current =
      candles[i];

    let isHigh = true;
    let isLow = true;

    /*
      Left side.
    */

    for (
      let j = 1;
      j <= L;
      j++
    ) {

      if (
        candles[i - j].high >=
        current.high
      ) {

        isHigh = false;
      }

      if (
        candles[i - j].low <=
        current.low
      ) {

        isLow = false;
      }
    }

    /*
      Right side.
    */

    for (
      let j = 1;
      j <= R;
      j++
    ) {

      if (
        candles[i + j].high >
        current.high
      ) {

        isHigh = false;
      }

      if (
        candles[i + j].low <
        current.low
      ) {

        isLow = false;
      }
    }

    if (isHigh) {

      highs.push({

        index: i,

        time:
          current.time,

        price:
          current.high,

        type:
          "SWING_HIGH",

        confirmedIndex:
          i + R,

        filled: false,

        fillIndex: null,

        fillTime: null,

        touches: 0
      });
    }

    if (isLow) {

      lows.push({

        index: i,

        time:
          current.time,

        price:
          current.low,

        type:
          "SWING_LOW",

        confirmedIndex:
          i + R,

        filled: false,

        fillIndex: null,

        fillTime: null,

        touches: 0
      });
    }
  }

  return {
    highs,
    lows
  };
}


/* =========================================================
   LIQUIDITY LEVELS
========================================================= */

function buildLiquidityLevels(
  candles,
  swings
) {

  const levels = [

    ...swings.highs,

    ...swings.lows

  ].sort(
    (a, b) =>
      a.index - b.index
  );

  for (const level of levels) {

    /*
      Only candles after the pivot
      confirmation can interact with it.
    */

    const start =
      level.confirmedIndex;

    for (
      let i = start;
      i < candles.length;
      i++
    ) {

      const candle =
        candles[i];

      if (
        candle.high >=
          level.price &&
        candle.low <=
          level.price
      ) {

        level.touches++;

        if (!level.filled) {

          level.filled = true;

          level.fillIndex = i;

          level.fillTime =
            candle.time;
        }
      }
    }
  }

  return levels;
}


/* =========================================================
   SWEEP DETECTION
========================================================= */

function detectLiquiditySweeps(
  candles,
  swings
) {

  const sweeps = [];

  const latestStart =
    Math.max(
      0,
      candles.length -
        CONFIG.sweepLookback
    );

  /*
    Swing High taken:
      high > swing high
      close < swing high

    This is a bearish liquidity sweep.
  */

  for (
    const level of swings.highs
  ) {

    const start =
      Math.max(
        level.confirmedIndex,
        latestStart
      );

    for (
      let i = start;
      i < candles.length;
      i++
    ) {

      const candle =
        candles[i];

      if (
        candle.high >
          level.price &&
        candle.close <
          level.price
      ) {

        sweeps.push({

          type:
            "BEARISH",

          side:
            "HIGH",

          index:
            i,

          time:
            candle.time,

          price:
            candle.close,

          level: {
            type:
              level.type,

            price:
              level.price,

            index:
              level.index,

            time:
              level.time
          }
        });

        break;
      }
    }
  }

  /*
    Swing Low taken:
      low < swing low
      close > swing low

    This is a bullish liquidity sweep.
  */

  for (
    const level of swings.lows
  ) {

    const start =
      Math.max(
        level.confirmedIndex,
        latestStart
      );

    for (
      let i = start;
      i < candles.length;
      i++
    ) {

      const candle =
        candles[i];

      if (
        candle.low <
          level.price &&
        candle.close >
          level.price
      ) {

        sweeps.push({

          type:
            "BULLISH",

          side:
            "LOW",

          index:
            i,

          time:
            candle.time,

          price:
            candle.close,

          level: {
            type:
              level.type,

            price:
              level.price,

            index:
              level.index,

            time:
              level.time
          }
        });

        break;
      }
    }
  }

  sweeps.sort(
    (a, b) =>
      a.index - b.index
  );

  return sweeps;
}


/* =========================================================
   CONFIRMATION
========================================================= */

function confirmSweep(
  candles,
  sweep
) {

  if (!sweep) {

    return {
      confirmed: false
    };
  }

  const start =
    sweep.index + 1;

  const end =
    Math.min(

      candles.length - 1,

      sweep.index +
        CONFIG.confirmationBars
    );

  for (
    let i = start;
    i <= end;
    i++
  ) {

    const current =
      candles[i];

    const previous =
      candles[i - 1];

    /*
      Bullish confirmation:
      - bullish candle
      - close above previous high
    */

    if (
      sweep.type ===
        "BULLISH"
    ) {

      if (
        current.close >
          current.open &&
        current.close >
          previous.high
      ) {

        return {

          confirmed: true,

          direction:
            "BUY",

          index:
            i,

          time:
            current.time,

          price:
            current.close
        };
      }
    }

    /*
      Bearish confirmation:
      - bearish candle
      - close below previous low
    */

    if (
      sweep.type ===
        "BEARISH"
    ) {

      if (
        current.close <
          current.open &&
        current.close <
          previous.low
      ) {

        return {

          confirmed: true,

          direction:
            "SELL",

          index:
            i,

          time:
            current.time,

          price:
            current.close
        };
      }
    }
  }

  return {
    confirmed: false
  };
}


/* =========================================================
   SIGNAL STRENGTH
========================================================= */

function calculateSignalScore(
  candles,
  sweep,
  confirmation
) {

  if (
    !sweep ||
    !confirmation?.confirmed
  ) {

    return {
      score: 0,
      probability: 0
    };
  }

  let score = 0;

  /*
    1. Liquidity sweep
  */

  score += 40;

  /*
    2. Confirmation candle
  */

  score += 30;

  /*
    3. Volume
  */

  const volume =
    volumeConfirmation(
      candles,
      confirmation.index
    );

  if (
    volume.available &&
    volume.strong
  ) {

    score += 15;
  }

  /*
    4. Fresh level
  */

  if (
    sweep.level &&
    sweep.level.index >
      candles.length - 100
  ) {

    score += 10;
  }

  /*
    5. Clean rejection
  */

  const candle =
    candles[
      confirmation.index
    ];

  const range =
    candle.high -
    candle.low;

  if (range > 0) {

    const body =
      Math.abs(
        candle.close -
        candle.open
      );

    if (
      body / range >= 0.55
    ) {

      score += 5;
    }
  }

  score =
    Math.min(
      100,
      score
    );

  /*
    Probability is deliberately conservative.
    It is a confidence score, NOT a guaranteed
    statistical win probability.
  */

  let probability =
    Math.round(
      45 +
      score * 0.45
    );

  probability =
    Math.min(
      90,
      Math.max(
        0,
        probability
      )
    );

  return {
    score,
    probability
  };
}


/* =========================================================
   TRADE PLAN
========================================================= */

function buildTradePlan(
  candles,
  signal,
  atr
) {

  if (
    !signal ||
    signal.direction ===
      "WAIT"
  ) {

    return null;
  }

  const entry =
    signal.price;

  const sweepPrice =
    signal.sweep?.level?.price;

  let sl;
  let risk;

  if (
    signal.direction ===
      "BUY"
  ) {

    const structuralSL =
      Number.isFinite(
        Number(sweepPrice)
      )
        ? Number(sweepPrice)
        : entry - atr;

    sl =
      Math.min(
        structuralSL,
        entry -
          atr *
          CONFIG.slAtrBuffer
      );

    risk =
      Math.max(
        entry - sl,
        atr * 0.25
      );

  } else {

    const structuralSL =
      Number.isFinite(
        Number(sweepPrice)
      )
        ? Number(sweepPrice)
        : entry + atr;

    sl =
      Math.max(
        structuralSL,
        entry +
          atr *
          CONFIG.slAtrBuffer
      );

    risk =
      Math.max(
        sl - entry,
        atr * 0.25
      );
  }

  let tp1;
  let tp2;
  let tp3;

  if (
    signal.direction ===
      "BUY"
  ) {

    tp1 =
      entry +
      risk *
      CONFIG.tp1R;

    tp2 =
      entry +
      risk *
      CONFIG.tp2R;

    tp3 =
      entry +
      risk *
      CONFIG.tp3R;

  } else {

    tp1 =
      entry -
      risk *
      CONFIG.tp1R;

    tp2 =
      entry -
      risk *
      CONFIG.tp2R;

    tp3 =
      entry -
      risk *
      CONFIG.tp3R;
  }

  return {

    entry,

    stopLoss:
      sl,

    tp1,

    tp2,

    tp3,

    risk,

    rr: {
      tp1: 1,
      tp2: 2,
      tp3: 3
    }
  };
}


/* =========================================================
   MAIN ANALYSIS
========================================================= */

function analyzeSwingLiquidity(
  candles
) {

  const atr =
    calculateATR(
      candles
    );

  const swings =
    findSwingPoints(
      candles
    );

  const liquidityLevels =
    buildLiquidityLevels(
      candles,
      swings
    );

  const sweeps =
    detectLiquiditySweeps(
      candles,
      swings
    );

  const latestSweep =
    sweeps.length
      ? sweeps[sweeps.length - 1]
      : null;

  const confirmation =
    confirmSweep(
      candles,
      latestSweep
    );

  /*
    Only a fresh confirmation near the
    latest candle can become CURRENT signal.
  */

  let signal = {

    value: "WAIT",

    direction: "WAIT",

    probability: 0,

    score: 0,

    time: null,

    price: null,

    sweep: null,

    confirmation: null
  };

  let tradePlan = null;

  if (
    latestSweep &&
    confirmation.confirmed
  ) {

    /*
      Reject very old confirmations.
    */

    const age =
      candles.length -
      1 -
      confirmation.index;

    if (age <= 3) {

      const strength =
        calculateSignalScore(
          candles,
          latestSweep,
          confirmation
        );

      signal = {

        value:
          confirmation.direction,

        direction:
          confirmation.direction,

        probability:
          strength.probability,

        score:
          strength.score,

        time:
          confirmation.time,

        price:
          confirmation.price,

        sweep:
          latestSweep,

        confirmation
      };

      tradePlan =
        buildTradePlan(
          candles,
          {
            ...signal,

            direction:
              confirmation.direction,

            price:
              confirmation.price,

            sweep:
              latestSweep
          },
          atr
        );
    }
  }

  const latestHigh =
    swings.highs.length
      ? swings.highs[
          swings.highs.length - 1
        ]
      : null;

  const latestLow =
    swings.lows.length
      ? swings.lows[
          swings.lows.length - 1
        ]
      : null;

  const lastCandle =
    candles[candles.length - 1];

  const volume =
    volumeConfirmation(
      candles,
      candles.length - 1
    );

  return {

    swings,

    liquidityLevels,

    sweeps,

    signal,

    tradePlan,

    diagnostics: {

      atr,

      latestPrice:
        lastCandle?.close || null,

      latestSwingHigh:
        latestHigh?.price || null,

      latestSwingLow:
        latestLow?.price || null,

      latestSweep:
        latestSweep?.type ||
        "NONE",

      confirmation:
        confirmation.confirmed
          ? confirmation.direction
          : "NONE",

      volumeAvailable:
        volume.available,

      volumeConfirmed:
        volume.strong
    }
  };
}
