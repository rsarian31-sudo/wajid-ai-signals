export default async function handler(req, res) {
  try {
    const apiKey = process.env.TWELVE_DATA_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error: "TWELVE_DATA_API_KEY is not configured"
      });
    }

    const action = req.query.action || "market";
    const symbol = String(req.query.symbol || "XAU/USD").trim();
    const interval = req.query.interval || "15min";

    /*
     * =====================================================
     * SYMBOL SEARCH
     * =====================================================
     */

    if (action === "search") {
      const query = String(req.query.q || "").trim();

      if (!query) {
        return res.status(400).json({
          success: false,
          error: "Search query is required"
        });
      }

      const url = new URL(
        "https://api.twelvedata.com/symbol_search"
      );

      url.searchParams.set("symbol", query);
      url.searchParams.set("apikey", apiKey);

      const response = await fetch(url.toString());
      const data = await response.json();

      if (!response.ok || data.status === "error") {
        return res.status(400).json({
          success: false,
          error:
            data.message ||
            "Symbol search failed"
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


    /*
     * =====================================================
     * MARKET DATA
     * =====================================================
     */

    const outputsize = Math.min(
      Math.max(
        Number(req.query.outputsize || 200),
        50
      ),
      500
    );

    const url = new URL(
      "https://api.twelvedata.com/time_series"
    );

    url.searchParams.set(
      "symbol",
      symbol
    );

    url.searchParams.set(
      "interval",
      interval
    );

    url.searchParams.set(
      "outputsize",
      String(outputsize)
    );

    url.searchParams.set(
      "apikey",
      apiKey
    );

    url.searchParams.set(
      "format",
      "JSON"
    );

    const response =
      await fetch(url.toString());

    const data =
      await response.json();

    if (
      !response.ok ||
      data.status === "error"
    ) {
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


    /*
     * =====================================================
     * NORMALIZE CANDLES
     * =====================================================
     */

    const candles =
      data.values
        .map(c => ({
          time: c.datetime,

          open: Number(c.open),

          high: Number(c.high),

          low: Number(c.low),

          close: Number(c.close),

          volume:
            Number(c.volume || 0)
        }))
        .filter(c =>
          Number.isFinite(c.open) &&
          Number.isFinite(c.high) &&
          Number.isFinite(c.low) &&
          Number.isFinite(c.close)
        )
        .reverse();


    /*
     * =====================================================
     * NOT ENOUGH DATA
     * =====================================================
     */

    if (candles.length < 50) {
      return res.status(200).json({
        success: true,
        symbol,
        interval,
        count: candles.length,
        candles,
        engine: {
          status: "WAIT",
          reason: "Not enough candles",
          supply: [],
          demand: [],
          magnets: [],
          signal: null,
          signalTime: null,
          signalKey: null
        }
      });
    }


    /*
     * =====================================================
     * STRONG SD MAGNET ENGINE
     * =====================================================
     */

    const engine =
      calculateSDMagnet(candles);


    return res.status(200).json({

      success: true,

      symbol,

      interval,

      count:
        candles.length,

      candles,

      engine

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


/* =========================================================
   STRONG SD MAGNET ENGINE
   ========================================================= */

function calculateSDMagnet(candles) {

  if (candles.length < 50) {

    return {

      status: "WAIT",

      reason:
        "Not enough candles",

      supply: [],

      demand: [],

      magnets: [],

      signal: null,

      signalTime: null,

      signalKey: null

    };

  }


  const swingLen = 12;

  const atrLen = 20;

  const zoneATR = 0.5;

  const magnetSourceThreshold = 6.5;

  const magnetTargetThreshold = 5.0;

  const strongThreshold = 7.0;

  const touchNorm = 3.0;

  const impulseNorm = 3.0;

  const decayFloor = 0.6;

  const decayBars = 600;


  const zones = [];

  const atr =
    calculateATR(
      candles,
      atrLen
    );


  /*
   * =====================================================
   * CONFIRMED PIVOTS
   * =====================================================
   */

  for (
    let i = swingLen;
    i < candles.length - swingLen;
    i++
  ) {

    const pivot =
      candles[i];

    let isHigh = true;

    let isLow = true;


    for (
      let j = 1;
      j <= swingLen;
      j++
    ) {

      if (
        candles[i - j].high >=
          pivot.high ||
        candles[i + j].high >
          pivot.high
      ) {

        isHigh = false;

      }


      if (
        candles[i - j].low <=
          pivot.low ||
        candles[i + j].low <
          pivot.low
      ) {

        isLow = false;

      }

    }


    const pivotATR =
      atr[i] || 0;


    if (!pivotATR) {
      continue;
    }


    if (
      pivot.high -
        pivot.low <
      pivotATR * 0.3
    ) {

      continue;

    }


    /*
     * ===================================================
     * SUPPLY
     * ===================================================
     */

    if (isHigh) {

      const height =
        pivotATR * zoneATR;

      zones.push({

        kind: "Supply",

        mid: pivot.high,

        top:
          pivot.high +
          height / 2,

        bot:
          pivot.high -
          height / 2,

        born: i,

        touches: 0,

        lastTouch: i,

        broken: false,

        score: 0

      });

    }


    /*
     * ===================================================
     * DEMAND
     * ===================================================
     */

    if (isLow) {

      const height =
        pivotATR * zoneATR;

      zones.push({

        kind: "Demand",

        mid: pivot.low,

        top:
          pivot.low +
          height / 2,

        bot:
          pivot.low -
          height / 2,

        born: i,

        touches: 0,

        lastTouch: i,

        broken: false,

        score: 0

      });

    }

  }


  /*
   * =====================================================
   * REMOVE EXCESSIVE OVERLAPPING ZONES
   * =====================================================
   */

  const filteredZones = [];


  for (const zone of zones) {

    let merged = false;


    for (
      const existing
      of filteredZones
    ) {

      if (
        existing.kind ===
          zone.kind &&
        !existing.broken &&
        zone.top >=
          existing.bot &&
        zone.bot <=
          existing.top
      ) {

        existing.top =
          Math.max(
            existing.top,
            zone.top
          );

        existing.bot =
          Math.min(
            existing.bot,
            zone.bot
          );

        existing.mid =
          (
            existing.top +
            existing.bot
          ) / 2;

        merged = true;

        break;

      }

    }


    if (!merged) {

      filteredZones.push(
        zone
      );

    }

  }


  /*
   * =====================================================
   * PROCESS ZONES
   * =====================================================
   */

  for (
    const zone
    of filteredZones
  ) {

    let previousInZone =
      false;


    for (
      let i =
        zone.born + 1;
      i < candles.length;
      i++
    ) {

      const c =
        candles[i];


      const inZone =
        c.high >=
          zone.bot &&
        c.low <=
          zone.top;


      if (
        inZone &&
        !previousInZone
      ) {

        zone.touches++;

        zone.lastTouch = i;

      }


      previousInZone =
        inZone;


      /*
       * SUPPLY INVALIDATION
       */

      if (
        zone.kind ===
        "Supply"
      ) {

        if (
          c.close >
          zone.top
        ) {

          zone.broken =
            true;

          break;

        }

      }


      /*
       * DEMAND INVALIDATION
       */

      else {

        if (
          c.close <
          zone.bot
        ) {

          zone.broken =
            true;

          break;

        }

      }

    }


    /*
     * ===================================================
     * DEPARTURE IMPULSE
     * ===================================================
     */

    const departureIndex =
      Math.min(
        zone.born + 12,
        candles.length - 1
      );


    const departure =
      candles[
        departureIndex
      ];


    let impulse = 0;


    if (
      zone.kind ===
      "Supply"
    ) {

      const slice =
        candles.slice(
          zone.born,
          Math.min(
            zone.born + 12,
            candles.length
          )
        );


      const lowestAfter =
        Math.min(
          ...slice.map(
            c => c.low
          )
        );


      impulse =
        Math.min(
          Math.max(
            (
              zone.mid -
              lowestAfter
            ) /
            Math.max(
              (
                atr[
                  zone.born
                ] || 1
              ) *
              impulseNorm,
              0.00001
            ),
            0
          ),
          1
        );

    }


    else {

      const slice =
        candles.slice(
          zone.born,
          Math.min(
            zone.born + 12,
            candles.length
          )
        );


      const highestAfter =
        Math.max(
          ...slice.map(
            c => c.high
          )
        );


      impulse =
        Math.min(
          Math.max(
            (
              highestAfter -
              zone.mid
            ) /
            Math.max(
              (
                atr[
                  zone.born
                ] || 1
              ) *
              impulseNorm,
              0.00001
            ),
            0
          ),
          1
        );

    }


    /*
     * ===================================================
     * VOLUME
     * ===================================================
     */

    const volStart =
      Math.max(
        0,
        zone.born - 20
      );


    const volWindow =
      candles.slice(
        volStart,
        zone.born + 1
      );


    const avgVolume =
      volWindow.length
        ? volWindow.reduce(
            (sum, c) =>
              sum + c.volume,
            0
          ) /
          volWindow.length
        : 0;


    const pivotVolume =
      departure.volume || 0;


    const volumeFactor =
      avgVolume > 0
        ? Math.min(
            pivotVolume /
              avgVolume,
            1
          )
        : 0;


    /*
     * ===================================================
     * REJECTION WICK
     * ===================================================
     */

    const range =
      Math.max(
        departure.high -
          departure.low,
        0.00001
      );


    let wickFactor = 0;


    if (
      zone.kind ===
      "Supply"
    ) {

      wickFactor =
        Math.min(
          Math.max(
            (
              departure.high -
              Math.max(
                departure.open,
                departure.close
              )
            ) /
            range,
            0
          ),
          1
        );

    }


    else {

      wickFactor =
        Math.min(
          Math.max(
            (
              Math.min(
                departure.open,
                departure.close
              ) -
              departure.low
            ) /
            range,
            0
          ),
          1
        );

    }


    /*
     * ===================================================
     * FRESHNESS
     * ===================================================
     */

    const freshFactor =
      Math.max(
        0,
        1 -
        zone.touches /
          touchNorm
      );


    /*
     * ===================================================
     * IDLE DECAY
     * ===================================================
     */

    const idle =
      Math.max(
        0,
        candles.length -
          1 -
          zone.lastTouch
      );


    const ageFactor =
      Math.max(
        1 -
        (
          1 -
          decayFloor
        ) *
        Math.min(
          idle /
            decayBars,
          1
        ),
        decayFloor
      );


    /*
     * ===================================================
     * FINAL SCORE
     * ===================================================
     */

    const raw =
      impulse * 0.35 +
      volumeFactor * 0.20 +
      wickFactor * 0.20 +
      freshFactor * 0.25;


    zone.score =
      Math.min(
        Math.max(
          raw *
            10 *
            ageFactor,
          0
        ),
        10
      );

  }


  /*
   * =====================================================
   * ACTIVE ZONES
   * =====================================================
   */

  const activeZones =
    filteredZones.filter(
      z => !z.broken
    );


  const supply =
    activeZones
      .filter(
        z =>
          z.kind ===
          "Supply"
      )
      .sort(
        (a, b) =>
          b.score -
          a.score
      )
      .slice(0, 5);


  const demand =
    activeZones
      .filter(
        z =>
          z.kind ===
          "Demand"
      )
      .sort(
        (a, b) =>
          b.score -
          a.score
      )
      .slice(0, 5);


  /*
   * =====================================================
   * MAGNET
   * =====================================================
   */

  const magnets = [];


  const currentATR =
    atr[
      atr.length - 1
    ] || 0;


  for (
    const source
    of activeZones
  ) {

    if (
      source.score <
        magnetSourceThreshold ||
      source.touches < 1
    ) {

      continue;

    }


    let target = null;

    let nearestDistance =
      Infinity;


    for (
      const candidate
      of activeZones
    ) {

      if (
        candidate ===
        source
      ) {

        continue;

      }


      if (
        candidate.score <
        magnetTargetThreshold
      ) {

        continue;

      }


      /*
       * SUPPLY -> DEMAND
       */

      if (
        source.kind ===
          "Supply" &&
        candidate.kind ===
          "Demand" &&
        candidate.mid <
          source.mid
      ) {

        const distance =
          source.mid -
          candidate.mid;


        if (
          distance <=
            currentATR * 25 &&
          distance <
            nearestDistance
        ) {

          nearestDistance =
            distance;

          target =
            candidate;

        }

      }


      /*
       * DEMAND -> SUPPLY
       */

      if (
        source.kind ===
          "Demand" &&
        candidate.kind ===
          "Supply" &&
        candidate.mid >
          source.mid
      ) {

        const distance =
          candidate.mid -
          source.mid;


        if (
          distance <=
            currentATR * 25 &&
          distance <
            nearestDistance
        ) {

          nearestDistance =
            distance;

          target =
            candidate;

        }

      }

    }


    if (!target) {
      continue;
    }


    const pullScore =
      Math.min(
        10,
        Math.max(
          0,
          (
            source.score +
            target.score
          ) / 2
        )
      );


    const probability =
      100 /
      (
        1 +
        Math.exp(
          -(
            pullScore - 5.5
          ) / 1.5
        )
      );


    magnets.push({

      direction:
        source.kind ===
        "Supply"
          ? "DOWN"
          : "UP",

      source: {

        type:
          source.kind,

        mid:
          source.mid,

        top:
          source.top,

        bot:
          source.bot,

        score:
          round(
            source.score
          ),

        touches:
          source.touches

      },

      target: {

        type:
          target.kind,

        mid:
          target.mid,

        top:
          target.top,

        bot:
          target.bot,

        score:
          round(
            target.score
          ),

        touches:
          target.touches

      },

      pullScore:
        round(
          pullScore
        ),

      probability:
        Math.round(
          probability
        )

    });

  }


  magnets.sort(
    (a, b) =>
      b.pullScore -
      a.pullScore
  );


  /*
   * =====================================================
   * CURRENT SIGNAL
   * =====================================================
   */

  const price =
    candles[
      candles.length - 1
    ].close;


  const signalTime =
    candles[
      candles.length - 1
    ].time;


  let signal = null;


  const validBuy =
    magnets.find(
      m =>
        m.direction ===
          "UP" &&
        m.source.score >=
          strongThreshold
    );


  const validSell =
    magnets.find(
      m =>
        m.direction ===
          "DOWN" &&
        m.source.score >=
          strongThreshold
    );


  /*
   * =====================================================
   * BUY
   * =====================================================
   */

  if (
    validBuy &&
    !validSell
  ) {

    const zone =
      validBuy.source;


    const entryLow =
      zone.bot;


    const entryHigh =
      zone.top;


    const risk =
      Math.abs(
        entryLow -
        (
          entryLow -
          currentATR * 0.8
        )
      );


    signal = {

      direction:
        "BUY",

      confidence:
        validBuy.pullScore,

      probability:
        validBuy.probability,

      entry: {

        low:
          round(
            entryLow
          ),

        high:
          round(
            entryHigh
          )

      },

      stopLoss:
        round(
          entryLow -
          currentATR * 0.8
        ),

      tp1:
        round(
          price +
          Math.max(
            currentATR * 1.5,
            risk * 1.5
          )
        ),

      tp2:
        round(
          price +
          Math.max(
            currentATR * 2.5,
            risk * 2.5
          )
        ),

      tp3:
        round(
          validBuy.target.mid
        ),

      sourceScore:
        round(
          validBuy.source.score
        ),

      sourceTouches:
        validBuy.source.touches,

      magnet:
        validBuy

    };

  }


  /*
   * =====================================================
   * SELL
   * =====================================================
   */

  else if (
    validSell &&
    !validBuy
  ) {

    const zone =
      validSell.source;


    const entryLow =
      zone.bot;


    const entryHigh =
      zone.top;


    const risk =
      Math.abs(
        (
          entryHigh +
          currentATR * 0.8
        ) -
        entryHigh
      );


    signal = {

      direction:
        "SELL",

      confidence:
        validSell.pullScore,

      probability:
        validSell.probability,

      entry: {

        low:
          round(
            entryLow
          ),

        high:
          round(
            entryHigh
          )

      },

      stopLoss:
        round(
          entryHigh +
          currentATR * 0.8
        ),

      tp1:
        round(
          price -
          Math.max(
            currentATR * 1.5,
            risk * 1.5
          )
        ),

      tp2:
        round(
          price -
          Math.max(
            currentATR * 2.5,
            risk * 2.5
          )
        ),

      tp3:
        round(
          validSell.target.mid
        ),

      sourceScore:
        round(
          validSell.source.score
        ),

      sourceTouches:
        validSell.source.touches,

      magnet:
        validSell

    };

  }


  /*
   * =====================================================
   * CONFLICTING DIRECTIONS
   * =====================================================
   */

  if (
    validBuy &&
    validSell
  ) {

    const difference =
      validBuy.pullScore -
      validSell.pullScore;


    if (
      Math.abs(
        difference
      ) < 1.0
    ) {

      signal = null;

    }

  }


  /*
   * =====================================================
   * UNIQUE SIGNAL KEY
   * =====================================================
   *
   * Used by frontend History system to prevent
   * duplicate records during auto-refresh.
   */

  const signalKey =
    signal
      ? [
          symbol,
          interval,
          signal.direction,
          signalTime,
          round(
            signal.entry.low
          ),
          round(
            signal.entry.high
          )
        ].join("|")
      : null;


  /*
   * =====================================================
   * FINAL ENGINE RESPONSE
   * =====================================================
   */

  return {

    status:
      signal
        ? signal.direction
        : "WAIT",

    price:
      round(price),

    atr:
      round(currentATR),

    /*
     * Signal timestamp
     */

    signalTime,

    /*
     * Unique identifier for History
     */

    signalKey,

    /*
     * Supply zones
     */

    supply:
      supply.map(
        formatZone
      ),

    /*
     * Demand zones
     */

    demand:
      demand.map(
        formatZone
      ),

    /*
     * Magnet structures
     */

    magnets:
      magnets.slice(0, 5),

    /*
     * Current signal
     */

    signal,

    /*
     * Engine rules
     */

    rules: {

      strongZone:
        7.0,

      magnetSource:
        6.5,

      magnetTarget:
        5.0,

      minimumRetests:
        1,

      maxReachATR:
        25

    }

  };

}


/* =========================================================
   ATR
   ========================================================= */

function calculateATR(
  candles,
  length
) {

  const tr = [];


  for (
    let i = 0;
    i < candles.length;
    i++
  ) {

    if (i === 0) {

      tr.push(
        candles[i].high -
        candles[i].low
      );

      continue;

    }


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


  const atr = [];


  for (
    let i = 0;
    i < tr.length;
    i++
  ) {

    const start =
      Math.max(
        0,
        i - length + 1
      );


    const slice =
      tr.slice(
        start,
        i + 1
      );


    const avg =
      slice.reduce(
        (
          sum,
          value
        ) =>
          sum + value,
        0
      ) /
      slice.length;


    atr.push(avg);

  }


  return atr;

}


/* =========================================================
   HELPERS
   ========================================================= */

function round(value) {

  if (
    !Number.isFinite(
      value
    )
  ) {

    return null;

  }


  return Number(
    value.toFixed(5)
  );

}


function formatZone(z) {

  return {

    type:
      z.kind,

    top:
      round(
        z.top
      ),

    bottom:
      round(
        z.bot
      ),

    middle:
      round(
        z.mid
      ),

    score:
      round(
        z.score
      ),

    retests:
      z.touches,

    fresh:
      z.touches === 0,

    status:
      z.broken
        ? "INVALID"
        : z.touches === 0
          ? "FRESH"
          : "TESTED"

  };

        }
