export default async function handler(req, res) {
  try {
    const apiKey = process.env.TWELVE_DATA_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error: "TWELVE_DATA_API_KEY is not configured"
      });
    }

    const url = new URL("https://api.twelvedata.com/time_series");

    url.searchParams.set("symbol", req.query.symbol || "XAU/USD");
    url.searchParams.set("interval", req.query.interval || "15min");
    url.searchParams.set("outputsize", req.query.outputsize || "200");
    url.searchParams.set("apikey", apiKey);
    url.searchParams.set("format", "JSON");

    const response = await fetch(url.toString());
    const data = await response.json();

    if (!response.ok || data.status === "error") {
      return res.status(502).json({
        success: false,
        error: data.message || "Market data provider error"
      });
    }

    const values = Array.isArray(data.values)
      ? data.values.reverse()
      : [];

    const candles = values.map(candle => ({
      time: candle.datetime,
      open: Number(candle.open),
      high: Number(candle.high),
      low: Number(candle.low),
      close: Number(candle.close),
      volume: Number(candle.volume || 0)
    }));

    return res.status(200).json({
      success: true,
      symbol: data.meta?.symbol || req.query.symbol || "XAU/USD",
      interval: data.meta?.interval || req.query.interval || "15min",
      count: candles.length,
      candles
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message || "Server error"
    });
  }
}
