import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { persistCandidate, syncOpenSignals } = require("./_lib/canonical-strategy.js");

export default async function handler(req, res) {
  try {
    const apiKey = process.env.TWELVE_DATA_API_KEY;
    if (!apiKey) return res.status(500).json({ success:false, error:"TWELVE_DATA_API_KEY is not configured" });

    const action = req.query.action || "market";
    const symbol = String(req.query.symbol || "XAU/USD").trim();
    const interval = req.query.interval || "15min";

    if (action === "search") {
      const query = String(req.query.q || "").trim();
      if (!query) return res.status(400).json({ success:false, error:"Search query is required" });
      const url = new URL("https://api.twelvedata.com/symbol_search");
      url.searchParams.set("symbol", query);
      url.searchParams.set("apikey", apiKey);
      const response = await fetch(url.toString());
      const data = await response.json();
      if (!response.ok || data.status === "error") return res.status(400).json({ success:false, error:data.message || "Symbol search failed" });
      return res.status(200).json({ success:true, action:"search", results:Array.isArray(data.data) ? data.data : [] });
    }

    const outputsize = Math.min(Math.max(Number(req.query.outputsize || 200), 50), 500);
    const url = new URL("https://api.twelvedata.com/time_series");
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("interval", interval);
    url.searchParams.set("outputsize", String(outputsize));
    url.searchParams.set("apikey", apiKey);
    url.searchParams.set("format", "JSON");

    const response = await fetch(url.toString());
    const data = await response.json();
    if (!response.ok || data.status === "error") return res.status(400).json({ success:false, error:data.message || "Twelve Data request failed" });
    if (!Array.isArray(data.values)) return res.status(400).json({ success:false, error:"No candle data received" });

    const candles = data.values.map(c => ({
      time:c.datetime, open:Number(c.open), high:Number(c.high), low:Number(c.low), close:Number(c.close), volume:Number(c.volume || 0)
    })).filter(c => [c.open,c.high,c.low,c.close].every(Number.isFinite)).reverse();

    if (candles.length < 50) {
      return res.status(200).json({ success:true, symbol, interval, count:candles.length, candles,
        engine:{ status:"WAIT", reason:"Not enough candles", supply:[], demand:[], magnets:[], signal:null, signalTime:null, signalKey:null }
      });
    }

    const nextCandle = candles[candles.length - 1];
    const closedCandles = candles.slice(0, -1);
    const engine = calculateSDMagnet(closedCandles);
    let canonical = null;
    try {
      await syncOpenSignals({ strategy: "strong_sd_magnet", symbol, timeframe: interval, candles });
      if (engine.signal && nextCandle) {
        const candidate = {
          strategy: "strong_sd_magnet",
          symbol,
          timeframe: interval,
          direction: engine.signal.direction,
          signalTime: engine.signalTime,
          candleTime: engine.signalTime,
          stopLoss: engine.signal.stopLoss,
          takeProfit: [engine.signal.tp1, engine.signal.tp2, engine.signal.tp3],
          metadata: { source: "api/market", rules: engine.rules, signal: engine.signal, resultTargetIndex: 2 }
        };
        canonical = (await persistCandidate(candidate, closedCandles[closedCandles.length - 1], nextCandle)).signal;
      }
    } catch (canonicalError) {
      canonical = { error: canonicalError.code || canonicalError.message || "CANONICAL_SYNC_FAILED" };
    }
    return res.status(200).json({ success:true, symbol, interval, count:candles.length, candles, engine: { ...engine, canonicalSignal: canonical } });
  } catch (error) {
    return res.status(500).json({ success:false, error:error.message || "Server error" });
  }
}

function calculateSDMagnet(candles) {
  const swingLen = 12;
  const atrLen = 20;
  const zoneATR = 0.5;
  const magnetSourceThreshold = 6.5;
  const magnetTargetThreshold = 5.0;
  // Previous 7.0 gate was too restrictive because source zones already require 6.5.
  const strongThreshold = 6.5;
  const touchNorm = 3.0;
  const impulseNorm = 3.0;
  const decayFloor = 0.6;
  const decayBars = 600;
  const atr = calculateATR(candles, atrLen);
  const zones = [];

  for (let i=swingLen; i<candles.length-swingLen; i++) {
    const p=candles[i]; let isHigh=true, isLow=true;
    for (let j=1;j<=swingLen;j++) {
      if (candles[i-j].high>=p.high || candles[i+j].high>p.high) isHigh=false;
      if (candles[i-j].low<=p.low || candles[i+j].low<p.low) isLow=false;
    }
    const pa=atr[i]||0;
    if (!pa || p.high-p.low<pa*0.3) continue;
    const h=pa*zoneATR;
    if (isHigh) zones.push({kind:"Supply",mid:p.high,top:p.high+h/2,bot:p.high-h/2,born:i,touches:0,lastTouch:i,broken:false,score:0});
    if (isLow) zones.push({kind:"Demand",mid:p.low,top:p.low+h/2,bot:p.low-h/2,born:i,touches:0,lastTouch:i,broken:false,score:0});
  }

  const filtered=[];
  for (const z of zones) {
    let merged=false;
    for (const e of filtered) {
      if (e.kind===z.kind && !e.broken && z.top>=e.bot && z.bot<=e.top) {
        e.top=Math.max(e.top,z.top); e.bot=Math.min(e.bot,z.bot); e.mid=(e.top+e.bot)/2; merged=true; break;
      }
    }
    if (!merged) filtered.push(z);
  }

  for (const z of filtered) {
    let previous=false;
    for (let i=z.born+1;i<candles.length;i++) {
      const c=candles[i], inZone=c.high>=z.bot && c.low<=z.top;
      if (inZone && !previous) { z.touches++; z.lastTouch=i; }
      previous=inZone;
      if (z.kind==="Supply" ? c.close>z.top : c.close<z.bot) { z.broken=true; break; }
    }

    const slice=candles.slice(z.born,Math.min(z.born+12,candles.length));
    const dep=candles[Math.min(z.born+12,candles.length-1)];
    const impulse=z.kind==="Supply"
      ? Math.min(Math.max((z.mid-Math.min(...slice.map(c=>c.low)))/Math.max((atr[z.born]||1)*impulseNorm,0.00001),0),1)
      : Math.min(Math.max((Math.max(...slice.map(c=>c.high))-z.mid)/Math.max((atr[z.born]||1)*impulseNorm,0.00001),0),1);

    const volWindow=candles.slice(Math.max(0,z.born-20),z.born+1);
    const avgVol=volWindow.length?volWindow.reduce((s,c)=>s+c.volume,0)/volWindow.length:0;
    const volumeFactor=avgVol>0?Math.min((dep.volume||0)/avgVol,1):0;
    const range=Math.max(dep.high-dep.low,0.00001);
    const wickFactor=z.kind==="Supply"
      ? Math.min(Math.max((dep.high-Math.max(dep.open,dep.close))/range,0),1)
      : Math.min(Math.max((Math.min(dep.open,dep.close)-dep.low)/range,0),1);
    const fresh=Math.max(0,1-z.touches/touchNorm);
    const idle=Math.max(0,candles.length-1-z.lastTouch);
    const age=Math.max(1-(1-decayFloor)*Math.min(idle/decayBars,1),decayFloor);
    z.score=Math.min(Math.max((impulse*.35+volumeFactor*.20+wickFactor*.20+fresh*.25)*10*age,0),10);
  }

  const active=filtered.filter(z=>!z.broken);
  const supply=active.filter(z=>z.kind==="Supply").sort((a,b)=>b.score-a.score).slice(0,5);
  const demand=active.filter(z=>z.kind==="Demand").sort((a,b)=>b.score-a.score).slice(0,5);
  const currentATR=atr[atr.length-1]||0;
  const magnets=[];

  for (const source of active) {
    if (source.score<magnetSourceThreshold || source.touches<1) continue;
    let target=null, nearest=Infinity;
    for (const candidate of active) {
      if (candidate===source || candidate.score<magnetTargetThreshold) continue;
      if (source.kind==="Supply" && candidate.kind==="Demand" && candidate.mid<source.mid) {
        const d=source.mid-candidate.mid;
        if (d<=currentATR*25 && d<nearest) { nearest=d; target=candidate; }
      }
      if (source.kind==="Demand" && candidate.kind==="Supply" && candidate.mid>source.mid) {
        const d=candidate.mid-source.mid;
        if (d<=currentATR*25 && d<nearest) { nearest=d; target=candidate; }
      }
    }
    if (!target) continue;
    const pull=Math.min(10,Math.max(0,(source.score+target.score)/2));
    const probability=100/(1+Math.exp(-(pull-5.5)/1.5));
    magnets.push({
      direction:source.kind==="Supply"?"DOWN":"UP",
      source:{type:source.kind,mid:source.mid,top:source.top,bot:source.bot,score:round(source.score),touches:source.touches},
      target:{type:target.kind,mid:target.mid,top:target.top,bot:target.bot,score:round(target.score),touches:target.touches},
      pullScore:round(pull), probability:Math.round(probability)
    });
  }

  magnets.sort((a,b)=>b.pullScore-a.pullScore);
  const price=candles[candles.length-1].close;
  const signalTime=candles[candles.length-1].time;
  const buy=magnets.find(m=>m.direction==="UP" && m.source.score>=strongThreshold);
  const sell=magnets.find(m=>m.direction==="DOWN" && m.source.score>=strongThreshold);
  let signal=null;

  if (buy && !sell) signal=buildMagnetSignal(buy,"BUY",price,currentATR);
  else if (sell && !buy) signal=buildMagnetSignal(sell,"SELL",price,currentATR);
  else if (buy && sell) {
    const diff=buy.pullScore-sell.pullScore;
    if (Math.abs(diff)>=0.75) signal=buildMagnetSignal(diff>0?buy:sell,diff>0?"BUY":"SELL",price,currentATR);
  }

  return {
    status:signal?signal.direction:"WAIT",
    reason:signal?"Strong SD Magnet detected":"No strong SD Magnet alignment yet",
    price:round(price), atr:round(currentATR), signalTime,
    signalKey:signal?[symbolFromCandles(candles),intervalFromCandles(candles),signal.direction,signalTime,round(signal.entry.low),round(signal.entry.high)].join("|"):null,
    supply:supply.map(formatZone), demand:demand.map(formatZone), magnets:magnets.slice(0,5), signal,
    rules:{strongZone:strongThreshold,magnetSource:magnetSourceThreshold,magnetTarget:magnetTargetThreshold,minimumRetests:1,maxReachATR:25}
  };
}

function buildMagnetSignal(magnet,direction,price,atr) {
  const z=magnet.source;
  const low=z.bot, high=z.top;
  const risk=direction==="BUY"?atr*.8:atr*.8;
  return {
    direction, confidence:magnet.pullScore, probability:magnet.probability,
    entry:{low:round(low),high:round(high)},
    stopLoss:direction==="BUY"?round(low-risk):round(high+risk),
    tp1:direction==="BUY"?round(price+Math.max(atr*1.5,risk*1.5)):round(price-Math.max(atr*1.5,risk*1.5)),
    tp2:direction==="BUY"?round(price+Math.max(atr*2.5,risk*2.5)):round(price-Math.max(atr*2.5,risk*2.5)),
    tp3:round(magnet.target.mid), sourceScore:round(magnet.source.score), sourceTouches:magnet.source.touches, magnet
  };
}

function symbolFromCandles(c) { return "MARKET"; }
function intervalFromCandles(c) { return "CURRENT"; }

function calculateATR(candles,length) {
  const tr=[];
  for(let i=0;i<candles.length;i++) {
    if(i===0) tr.push(candles[i].high-candles[i].low);
    else { const c=candles[i],p=candles[i-1]; tr.push(Math.max(c.high-c.low,Math.abs(c.high-p.close),Math.abs(c.low-p.close))); }
  }
  return tr.map((_,i)=>{ const s=tr.slice(Math.max(0,i-length+1),i+1); return s.reduce((a,b)=>a+b,0)/s.length; });
}

function formatZone(z) {
  return {kind:z.kind,mid:round(z.mid),top:round(z.top),bot:round(z.bot),score:round(z.score),touches:z.touches,status:z.broken?"BROKEN":"ACTIVE"};
}
function round(v) { return Number(Number(v).toFixed(5)); }
