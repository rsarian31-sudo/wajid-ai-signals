
export default async function handler(req, res) {
  try {
    const apiKey = process.env.TWELVE_DATA_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ success:false, error:"TWELVE_DATA_API_KEY is not configured" });
    }

    const action = String(req.query.action || "market");
    const symbol = String(req.query.symbol || "XAU/USD").trim();
    const interval = String(req.query.interval || "15min");
    const outputsize = Math.min(Math.max(Number(req.query.outputsize || 250), 80), 500);

    if (action === "search") {
      const q = String(req.query.q || "").trim();
      if (!q) return res.status(400).json({ success:false, error:"Search query is required" });

      const url = new URL("https://api.twelvedata.com/symbol_search");
      url.searchParams.set("symbol", q);
      url.searchParams.set("apikey", apiKey);

      const r = await fetch(url);
      const data = await r.json();
      if (!r.ok || data.status === "error") {
        return res.status(400).json({ success:false, error:data.message || "Search failed" });
      }

      return res.status(200).json({
        success:true,
        action:"search",
        results:Array.isArray(data.data) ? data.data : []
      });
    }

    const url = new URL("https://api.twelvedata.com/time_series");
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("interval", interval);
    url.searchParams.set("outputsize", String(outputsize));
    url.searchParams.set("apikey", apiKey);
    url.searchParams.set("format", "JSON");

    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok || data.status === "error") {
      return res.status(400).json({
        success:false,
        error:data.message || "Twelve Data request failed"
      });
    }

    if (!Array.isArray(data.values)) {
      return res.status(400).json({ success:false, error:"No candle data received" });
    }

    const candles = data.values.map(c => ({
      time: c.datetime,
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
      volume: Number(c.volume || 0)
    })).filter(c =>
      [c.open,c.high,c.low,c.close].every(Number.isFinite)
    ).reverse();

    if (candles.length < 60) {
      return res.status(200).json({
        success:true, symbol, interval, count:candles.length,
        candles, engine:{ status:"WAIT", reason:"Not enough candles" }
      });
    }

    // The newest bar is treated as the currently forming / next entry bar.
    // All signal calculations use only completed candles.
    const closed = candles.slice(0, -1);
    const nextCandle = candles[candles.length - 1];

    const forecast = calculateSwingForecast(closed, {
      swingLen: Number(req.query.swingLen || 16),
      samples: Number(req.query.samples || 20),
      method: String(req.query.method || "Weighted"),
      atrPeriod: 200
    });

    const lastClosed = closed[closed.length - 1];
    const signal = forecast.signalTriggered && nextCandle
      ? buildSignal(forecast, lastClosed, nextCandle.open)
      : null;

    return res.status(200).json({
      success:true,
      symbol,
      interval,
      count:candles.length,
      candles,
      closedCandle:lastClosed,
      nextCandle,
      engine:{
        status: signal ? signal.direction : "WAIT",
        signal,
        forecast
      }
    });

  } catch (error) {
    return res.status(500).json({
      success:false,
      error:error.message || "Server error"
    });
  }
}

function calculateSwingForecast(candles, options) {
  const { swingLen, samples, method, atrPeriod } = options;

  const high = candles.map(c => c.high);
  const low = candles.map(c => c.low);

  let dir = false;
  let prevDir = false;
  let hi = { price:null, idx:null };
  let lo = { price:null, idx:null };

  const pcts = [];
  const durs = [];
  const swings = [];
  let latestDirectionChange = false;

  for (let i = swingLen; i < candles.length; i++) {
    prevDir = dir;

    const hStart = i - swingLen + 1;
    const lStart = i - swingLen + 1;

    const highest = Math.max(...high.slice(hStart, i + 1));
    const lowest = Math.min(...low.slice(lStart, i + 1));

    if (high[i] === highest) dir = true;
    if (low[i] === lowest) dir = false;

    if (i > 0) {
      const prevHighest = Math.max(...high.slice(i - swingLen, i));
      const prevLowest = Math.min(...low.slice(i - swingLen, i));

      if (high[i - 1] === prevHighest && high[i] < highest) {
        hi = { price:high[i - 1], idx:i - 1 };
      }

      if (low[i - 1] === prevLowest && low[i] > lowest) {
        lo = { price:low[i - 1], idx:i - 1 };
      }
    }

    if (dir !== prevDir && hi.price !== null && lo.price !== null) {
      const pct = !dir
        ? ((hi.price - lo.price) / lo.price) * 100
        : ((lo.price - hi.price) / hi.price) * 100;

      const bars = Math.abs(hi.idx - lo.idx);

      if (Number.isFinite(pct) && pct !== 0 && Number.isFinite(bars)) {
        pcts.push(Math.abs(pct));
        durs.push(bars);
        swings.push({
          percentage:Math.abs(pct),
          duration:bars,
          direction:dir ? "BULLISH" : "BEARISH",
          high:hi.price,
          low:lo.price,
          highIndex:hi.idx,
          lowIndex:lo.idx,
          confirmationIndex:i
        });
      }
    }
  }

  latestDirectionChange = swings.some(s => s.confirmationIndex === candles.length - 1);

  const recent = swings.slice(-Math.max(2, Math.min(samples, 20)));
  if (recent.length < 2) {
    return {
      valid:false,
      signalTriggered:false,
      reason:"Not enough confirmed swing history",
      direction:dir ? "BULLISH" : "BEARISH",
      swingCount:recent.length
    };
  }

  let fPct, fBars;

  if (method === "Median") {
    fPct = median(pcts.slice(-recent.length));
    fBars = median(durs.slice(-recent.length));
  } else if (method === "Average") {
    fPct = avg(pcts.slice(-recent.length));
    fBars = avg(durs.slice(-recent.length));
  } else {
    let wp=0, wb=0, tw=0;
    const rp = pcts.slice(-recent.length);
    const rd = durs.slice(-recent.length);
    for (let i=0;i<rp.length;i++) {
      const w=i+1;
      wp += rp[i]*w;
      wb += rd[i]*w;
      tw += w;
    }
    fPct=wp/tw;
    fBars=wb/tw;
  }

  const variance = pcts.slice(-recent.length)
    .reduce((sum,v)=>sum + Math.pow(v-fPct,2),0) / recent.length;
  const stdDev = Math.sqrt(variance);

  const isBear = !dir;
  const origin = isBear ? hi.price : lo.price;
  const originIdx = isBear ? hi.idx : lo.idx;
  const target = isBear
    ? origin * (1 - fPct/100)
    : origin * (1 + fPct/100);

  const uncertainty = fPct > 0 ? (stdDev/fPct)*100 : 100;
  const confidence = Math.round(Math.max(0, Math.min(100,
    (100 - uncertainty) * 0.8 + (recent.length / Math.max(samples,1)) * 100 * 0.2
  )));

  const atr = calculateATR(candles, Math.min(atrPeriod, candles.length));
  const targetDistance = Math.abs(target - origin);
  const atrMultiple = atr > 0 ? targetDistance / atr : 0;

  return {
    valid:true,
    signalTriggered:latestDirectionChange,
    direction:isBear ? "BEARISH" : "BULLISH",
    forecastPercent:round(fPct),
    forecastBars:round(fBars),
    origin:round(origin),
    originIndex:originIdx,
    target:round(target),
    stdDev:round(stdDev),
    uncertaintyPercent:round(uncertainty),
    confidence,
    atr:round(atr),
    atrMultiple:round(atrMultiple),
    swingCount:recent.length,
    latestSwing:recent[recent.length-1],
    swings:recent
  };
}

function buildSignal(forecast, signalCandle, entry) {
  const risk = Math.max(forecast.atr * 0.8, Math.abs(entry - forecast.origin) * 0.15);

  const bullish = forecast.direction === "BULLISH";
  const stopLoss = bullish ? entry - risk : entry + risk;

  return {
    direction:bullish ? "BUY" : "SELL",
    confidence:forecast.confidence,
    entry,
    stopLoss:round(stopLoss),
    tp1:round(bullish ? entry + risk*1.5 : entry - risk*1.5),
    tp2:round(bullish ? entry + risk*2.5 : entry - risk*2.5),
    forecastTarget:forecast.target,
    forecastPercent:forecast.forecastPercent,
    signalCandleTime:signalCandle.time,
    entryCandleTime:null,
    entryRule:"NEXT_CANDLE_OPEN"
  };
}

function calculateATR(candles, period) {
  const tr=[];
  for (let i=0;i<candles.length;i++) {
    if (i===0) tr.push(candles[i].high-candles[i].low);
    else {
      const c=candles[i], p=candles[i-1];
      tr.push(Math.max(
        c.high-c.low,
        Math.abs(c.high-p.close),
        Math.abs(c.low-p.close)
      ));
    }
  }
  const slice=tr.slice(-period);
  return slice.reduce((a,b)=>a+b,0)/slice.length;
}

function avg(a){ return a.reduce((x,y)=>x+y,0)/a.length; }
function median(a){
  const s=[...a].sort((x,y)=>x-y);
  const m=Math.floor(s.length/2);
  return s.length%2 ? s[m] : (s[m-1]+s[m])/2;
}
function round(v){ return Number.isFinite(v) ? Number(v.toFixed(5)) : null; }
