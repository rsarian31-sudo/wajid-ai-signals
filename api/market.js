export default async function handler(req, res) {
  try {
    const apiKey = process.env.TWELVE_DATA_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error: "TWELVE_DATA_API_KEY is not configured"
      });
    }

    const symbol =
      req.query.symbol || "XAU/USD";

    const interval =
      req.query.interval || "15min";

    const requestedOutput =
      Number(req.query.outputsize || 200);

    const outputsize = Math.min(
      Math.max(
        Number.isFinite(requestedOutput)
          ? requestedOutput
          : 200,
        50
      ),
      500
    );

    const url =
      new URL(
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
      await fetch(
        url.toString(),
        {
          method: "GET",
          cache: "no-store"
        }
      );


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


    if (
      !Array.isArray(data.values)
    ) {
      return res.status(400).json({
        success: false,
        error:
          "No candle data received"
      });
    }


    /*
     * Twelve Data normally returns newest
     * candle first.
     *
     * Reverse it so the engine receives:
     *
     * oldest -> newest
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


    if (
      candles.length < 50
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Not enough candle data received"
      });
    }


    const engine =
      calculateSDMagnet(
        candles
      );


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

    console.error(
      "LONA Market API Error:",
      error
    );


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

   Based on supplied Strong SD Magnet Pine logic.

   Main concepts:

   - Confirmed swing pivots
   - ATR based zone thickness
   - Supply / Demand
   - Retests
   - Strength score
   - Freshness
   - Departure impulse
   - Volume
   - Rejection wick
   - Idle decay
   - Magnet source
   - Magnet target
   - BUY / SELL / WAIT
   ========================================================= */


function calculateSDMagnet(candles) {

  if (
    !Array.isArray(candles) ||
    candles.length < 50
  ) {

    return {

      status: "WAIT",

      direction: "WAIT",

      price: null,

      atr: null,

      supply: null,

      demand: null,

      supplyZones: [],

      demandZones: [],

      magnet: null,

      magnets: [],

      signal: null,

      score: 0,

      probability: 0,

      retests: 0,

      reason:
        "Not enough candles",

      rules: {

        strongZone: 7.0,

        magnetSource: 6.5,

        magnetTarget: 5.0,

        minimumRetests: 1,

        maxReachATR: 25

      }

    };
  }


  /*
   * Pine defaults
   */

  const swingLen = 12;

  const atrLen = 20;

  const zoneATR = 0.5;


  /*
   * Magnet rules
   */

  const magnetSourceThreshold =
    6.5;

  const magnetTargetThreshold =
    5.0;

  const strongThreshold =
    7.0;


  /*
   * Scoring rules
   */

  const touchNorm = 3.0;

  const impulseNorm = 3.0;

  const decayFloor = 0.6;

  const decayBars = 600;


  /*
   * Calculate ATR
   */

  const atr =
    calculateATR(
      candles,
      atrLen
    );


  const zones = [];


  /* =====================================================
     CONFIRMED PIVOT DETECTION
     ===================================================== */

  for (
    let i = swingLen;
    i <
      candles.length - swingLen;
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

      /*
       * Pivot High
       */

      if (
        candles[i - j].high >=
          pivot.high ||

        candles[i + j].high >
          pivot.high
      ) {

        isHigh = false;
      }


      /*
       * Pivot Low
       */

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


    if (
      !Number.isFinite(
        pivotATR
      ) ||
      pivotATR <= 0
    ) {
      continue;
    }


    /*
     * Ignore extremely small swings.
     */

    if (
      pivot.high -
        pivot.low <
      pivotATR * 0.3
    ) {
      continue;
    }


    /*
     * SUPPLY
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
     * DEMAND
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


  /* =====================================================
     MERGE OVERLAPPING SAME-TYPE ZONES
     ===================================================== */

  const filteredZones = [];


  for (
    const zone of zones
  ) {

    let merged = false;


    for (
      const existing of
      filteredZones
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

        /*
         * Keep the combined boundaries.
         */

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


        /*
         * Use the oldest birth.
         */

        existing.born =
          Math.min(
            existing.born,
            zone.born
          );


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


  /* =====================================================
     PROCESS ZONES
     ===================================================== */

  for (
    const zone of
    filteredZones
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
        c.high >= zone.bot &&
        c.low <= zone.top;


      /*
       * Count a retest only when price
       * enters the zone after being outside.
       */

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
       * CLOSE based invalidation
       */

      if (
        zone.kind === "Supply"
      ) {

        if (
          c.close >
          zone.top
        ) {

          zone.broken = true;

          break;
        }

      } else {

        if (
          c.close <
          zone.bot
        ) {

          zone.broken = true;

          break;
        }
      }
    }


    /* =================================================
       STRENGTH SCORE
       ================================================= */


    /*
     * Departure window.
     */

    const departureEnd =
      Math.min(
        zone.born + 12,
        candles.length - 1
      );


    const departure =
      candles[
        departureEnd
      ];


    if (!departure) {
      continue;
    }


    /*
     * -------------------------------------------------
     * 1. DEPARTURE IMPULSE
     * -------------------------------------------------
     */

    let impulse = 0;


    const departureSlice =
      candles.slice(
        zone.born,
        Math.min(
          zone.born + 13,
          candles.length
        )
      );


    if (
      departureSlice.length > 0
    ) {

      if (
        zone.kind === "Supply"
      ) {

        const lowestAfter =
          Math.min(
            ...departureSlice.map(
              c => c.low
            )
          );


        impulse =
          (
            zone.mid -
            lowestAfter
          ) /
          Math.max(
            (
              atr[zone.born] ||
              1
            ) *
              impulseNorm,
            0.00001
          );

      } else {

        const highestAfter =
          Math.max(
            ...departureSlice.map(
              c => c.high
            )
          );


        impulse =
          (
            highestAfter -
            zone.mid
          ) /
          Math.max(
            (
              atr[zone.born] ||
              1
            ) *
              impulseNorm,
            0.00001
          );
      }
    }


    impulse =
      Math.min(
        Math.max(
          impulse,
          0
        ),
        1
      );


    /*
     * -------------------------------------------------
     * 2. VOLUME
     * -------------------------------------------------
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


    const volumes =
      volWindow
        .map(
          c =>
            Number(c.volume || 0)
        )
        .filter(
          Number.isFinite
        );


    const avgVolume =
      volumes.length > 0
        ? volumes.reduce(
            (
              sum,
              value
            ) =>
              sum + value,
            0
          ) /
          volumes.length
        : 0;


    const pivotVolume =
      Number(
        departure.volume || 0
      );


    let volumeFactor = 0;


    if (
      avgVolume > 0 &&
      pivotVolume > 0
    ) {

      volumeFactor =
        pivotVolume /
        avgVolume;


      volumeFactor =
        Math.min(
          Math.max(
            volumeFactor,
            0
          ),
          1
        );
    }


    /*
     * If volume is unavailable,
     * don't let it completely destroy
     * the other score components.
     */

    if (
      avgVolume === 0
    ) {

      volumeFactor = 0.5;
    }


    /*
     * -------------------------------------------------
     * 3. REJECTION WICK
     * -------------------------------------------------
     */

    const range =
      Math.max(
        departure.high -
          departure.low,
        0.00001
      );


    let wickFactor = 0;


    if (
      zone.kind === "Supply"
    ) {

      const upperWick =
        departure.high -
        Math.max(
          departure.open,
          departure.close
        );


      wickFactor =
        upperWick /
        range;

    } else {

      const lowerWick =
        Math.min(
          departure.open,
          departure.close
        ) -
        departure.low;


      wickFactor =
        lowerWick /
        range;
    }


    wickFactor =
      Math.min(
        Math.max(
          wickFactor,
          0
        ),
        1
      );


    /*
     * -------------------------------------------------
     * 4. FRESHNESS
     * -------------------------------------------------
     */

    const freshFactor =
      Math.max(
        0,
        1 -
        zone.touches /
          touchNorm
      );


    /*
     * -------------------------------------------------
     * 5. IDLE DECAY
     * -------------------------------------------------
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
     * -------------------------------------------------
     * FINAL SCORE
     *
     * impulse  = 35%
     * volume   = 20%
     * wick     = 20%
     * freshness = 25%
     * -------------------------------------------------
     */

    const rawScore =
      impulse * 0.35 +
      volumeFactor * 0.20 +
      wickFactor * 0.20 +
      freshFactor * 0.25;


    zone.score =
      Math.min(
        Math.max(
          rawScore *
            10 *
            ageFactor,
          0
        ),
        10
      );
  }


  /* =====================================================
     ACTIVE ZONES
     ===================================================== */

  const activeZones =
    filteredZones.filter(
      z =>
        !z.broken &&
        Number.isFinite(z.score)
    );


  const supply =
    activeZones
      .filter(
        z =>
          z.kind === "Supply"
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
          z.kind === "Demand"
      )
      .sort(
        (a, b) =>
          b.score -
          a.score
      )
      .slice(0, 5);


  /* =====================================================
     MAGNET ENGINE
     ===================================================== */

  const magnets = [];


  const currentATR =
    atr[
      atr.length - 1
    ] || 0;


  for (
    const source of
    activeZones
  ) {

    /*
     * Magnet source requirements:
     *
     * Score >= 6.5
     * Retests >= 1
     */

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
      const candidate of
      activeZones
    ) {

      if (
        candidate ===
        source
      ) {
        continue;
      }


      /*
       * Target score >= 5.0
       */

      if (
        candidate.score <
        magnetTargetThreshold
      ) {
        continue;
      }


      /*
       * SUPPLY -> DEMAND
       *
       * Downward magnet
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
       *
       * Upward magnet
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


    /*
     * Pull score
     */

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


    /*
     * Logistic probability
     *
     * midpoint = 5.5
     * slope = 1.5
     */

    const pullProbability =
      100 /
      (
        1 +
        Math.exp(
          -(
            pullScore -
            5.5
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
          round(
            source.mid
          ),

        top:
          round(
            source.top
          ),

        bot:
          round(
            source.bot
          ),

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
          round(
            target.mid
          ),

        top:
          round(
            target.top
          ),

        bot:
          round(
            target.bot
          ),

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
          pullProbability
        ),


      fired: true,

      active: true
    });
  }


  /*
   * Strongest magnet first.
   */

  magnets.sort(
    (a, b) =>
      b.pullScore -
      a.pullScore
  );


  /* =====================================================
     CURRENT PRICE
     ===================================================== */

  const lastCandle =
    candles[
      candles.length - 1
    ];


  const price =
    lastCandle.close;


  /* =====================================================
     SIGNAL ENGINE
     ===================================================== */

  let signal = null;


  /*
   * BUY:
   *
   * Demand source
   * +
   * upward magnet
   * +
   * source score >= 7
   */

  const validBuy =
    magnets.find(
      m =>
        m.direction ===
          "UP" &&

        m.source.score >=
          strongThreshold
    );


  /*
   * SELL:
   *
   * Supply source
   * +
   * downward magnet
   * +
   * source score >= 7
   */

  const validSell =
    magnets.find(
      m =>
        m.direction ===
          "DOWN" &&

        m.source.score >=
          strongThreshold
    );


  /* =====================================================
     BUY
     ===================================================== */

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
      Math.max(
        currentATR * 0.8,
        0.00001
      );


    const stopLoss =
      entryLow -
      risk;


    const tp1 =
      price +
      Math.max(
        currentATR * 1.5,
        risk * 1.5
      );


    const tp2 =
      price +
      Math.max(
        currentATR * 2.5,
        risk * 2.5
      );


    const tp3 =
      validBuy.target.mid;


    signal = {

      direction:
        "BUY",


      confidence:
        validBuy.pullScore,


      score:
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


      entryZone: {

        low:
          round(
            entryLow
          ),

        high:
          round(
            entryHigh
          )

      },


      entryPrice:
        round(
          (
            entryLow +
            entryHigh
          ) / 2
        ),


      stopLoss:
        round(
          stopLoss
        ),


      sl:
        round(
          stopLoss
        ),


      tp1:
        round(
          tp1
        ),


      tp2:
        round(
          tp2
        ),


      tp3:
        round(
          tp3
        ),


      takeProfit1:
        round(
          tp1
        ),


      takeProfit2:
        round(
          tp2
        ),


      takeProfit3:
        round(
          tp3
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


  /* =====================================================
     SELL
     ===================================================== */

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
      Math.max(
        currentATR * 0.8,
        0.00001
      );


    const stopLoss =
      entryHigh +
      risk;


    const tp1 =
      price -
      Math.max(
        currentATR * 1.5,
        risk * 1.5
      );


    const tp2 =
      price -
      Math.max(
        currentATR * 2.5,
        risk * 2.5
      );


    const tp3 =
      validSell.target.mid;


    signal = {

      direction:
        "SELL",


      confidence:
        validSell.pullScore,


      score:
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


      entryZone: {

        low:
          round(
            entryLow
          ),

        high:
          round(
            entryHigh
          )

      },


      entryPrice:
        round(
          (
            entryLow +
            entryHigh
          ) / 2
        ),


      stopLoss:
        round(
          stopLoss
        ),


      sl:
        round(
          stopLoss
        ),


      tp1:
        round(
          tp1
        ),


      tp2:
        round(
          tp2
        ),


      tp3:
        round(
          tp3
        ),


      takeProfit1:
        round(
          tp1
        ),


      takeProfit2:
        round(
          tp2
        ),


      takeProfit3:
        round(
          tp3
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


  /* =====================================================
     CONFLICT PROTECTION
     ===================================================== */

  if (
    validBuy &&
    validSell
  ) {

    const difference =
      validBuy.pullScore -
      validSell.pullScore;


    /*
     * If both directions are nearly equal,
     * don't force a trade.
     */

    if (
      Math.abs(
        difference
      ) < 1.0
    ) {

      signal = null;

    } else if (
      difference > 0
    ) {

      /*
       * BUY wins.
       */

      const zone =
        validBuy.source;


      const entryLow =
        zone.bot;


      const entryHigh =
        zone.top;


      const risk =
        Math.max(
          currentATR * 0.8,
          0.00001
        );


      const stopLoss =
        entryLow -
        risk;


      const tp1 =
        price +
        Math.max(
          currentATR * 1.5,
          risk * 1.5
        );


      const tp2 =
        price +
        Math.max(
          currentATR * 2.5,
          risk * 2.5
        );


      signal = {

        direction:
          "BUY",

        confidence:
          validBuy.pullScore,

        score:
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

        entryZone: {
          low:
            round(
              entryLow
            ),
          high:
            round(
              entryHigh
            )
        },

        entryPrice:
          round(
            (
              entryLow +
              entryHigh
            ) / 2
          ),

        stopLoss:
          round(
            stopLoss
          ),

        sl:
          round(
            stopLoss
          ),

        tp1:
          round(
            tp1
          ),

        tp2:
          round(
            tp2
          ),

        tp3:
          round(
            validBuy.target.mid
          ),

        takeProfit1:
          round(
            tp1
          ),

        takeProfit2:
          round(
            tp2
          ),

        takeProfit3:
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

    } else {

      /*
       * SELL wins.
       */

      const zone =
        validSell.source;


      const entryLow =
        zone.bot;


      const entryHigh =
        zone.top;


      const risk =
        Math.max(
          currentATR * 0.8,
          0.00001
        );


      const stopLoss =
        entryHigh +
        risk;


      const tp1 =
        price -
        Math.max(
          currentATR * 1.5,
          risk * 1.5
        );


      const tp2 =
        price -
        Math.max(
          currentATR * 2.5,
          risk * 2.5
        );


      signal = {

        direction:
          "SELL",

        confidence:
          validSell.pullScore,

        score:
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

        entryZone: {
          low:
            round(
              entryLow
            ),
          high:
            round(
              entryHigh
            )
        },

        entryPrice:
          round(
            (
              entryLow +
              entryHigh
            ) / 2
          ),

        stopLoss:
          round(
            stopLoss
          ),

        sl:
          round(
            stopLoss
          ),

        tp1:
          round(
            tp1
          ),

        tp2:
          round(
            tp2
          ),

        tp3:
          round(
            validSell.target.mid
          ),

        takeProfit1:
          round(
            tp1
          ),

        takeProfit2:
          round(
            tp2
          ),

        takeProfit3:
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
  }


  /* =====================================================
     FRONTEND COMPATIBILITY
     ===================================================== */

  /*
   * IMPORTANT:
   *
   * Frontend expects:
   *
   * engine.supply
   * engine.demand
   * engine.magnet
   * engine.signal
   *
   * Therefore the strongest zone/magnet is exposed
   * directly, while complete arrays are also preserved.
   */


  const strongestSupply =
    supply.length > 0
      ? formatZone(
          supply[0]
        )
      : null;


  const strongestDemand =
    demand.length > 0
      ? formatZone(
          demand[0]
        )
      : null;


  const strongestMagnet =
    magnets.length > 0
      ? magnets[0]
      : null;


  return {

    status:
      signal
        ? signal.direction
        : "WAIT",


    direction:
      signal
        ? signal.direction
        : "WAIT",


    price:
      round(
        price
      ),


    atr:
      round(
        currentATR
      ),


    /*
     * Direct frontend objects
     */

    supply:
      strongestSupply,


    demand:
      strongestDemand,


    magnet:
      strongestMagnet,


    /*
     * Complete zone lists
     */

    supplyZones:
      supply.map(
        formatZone
      ),


    demandZones:
      demand.map(
        formatZone
      ),


    /*
     * Complete magnet list
     */

    magnets:
      magnets.slice(0, 5),


    /*
     * Main trade signal
     */

    signal,


    /*
     * Summary fields
     */

    score:
      signal
        ? signal.sourceScore
        : 0,


    probability:
      signal
        ? signal.probability
        : 0,


    retests:
      signal
        ? signal.sourceTouches
        : 0,


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
   ATR CALCULATION
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
        Math.max(
          candles[i].high -
            candles[i].low,
          0
        )
      );

      continue;
    }


    const current =
      candles[i];


    const previous =
      candles[i - 1];


    const trueRange =
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

      );


    tr.push(
      trueRange
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


    const average =
      slice.reduce(
        (
          sum,
          value
        ) =>
          sum + value,
        0
      ) /
      Math.max(
        slice.length,
        1
      );


    atr.push(
      average
    );
  }


  return atr;
}


/* =========================================================
   ZONE FORMATTER
   ========================================================= */

function formatZone(
  zone
) {

  return {

    type:
      zone.kind,


    top:
      round(
        zone.top
      ),


    bottom:
      round(
        zone.bot
      ),


    middle:
      round(
        zone.mid
      ),


    /*
     * Alternative names for frontend
     */

    high:
      round(
        zone.top
      ),


    low:
      round(
        zone.bot
      ),


    pivot:
      round(
        zone.mid
      ),


    score:
      round(
        zone.score
      ),


    strength:
      round(
        zone.score
      ),


    retests:
      zone.touches,


    touches:
      zone.touches,


    fresh:
      zone.touches === 0,


    status:
      zone.broken
        ? "INVALID"
        : zone.touches === 0
          ? "FRESH"
          : "TESTED"

  };
}


/* =========================================================
   SAFE ROUND
   ========================================================= */

function round(
  value
) {

  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(
      Number(value)
    )
  ) {

    return null;
  }


  return Number(
    Number(value).toFixed(5)
  );
}
