import { getPerformance } from "./_lib/canonical-api.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } });
  }

  try {
    const summary = await getPerformance({
      strategy: req.query?.strategy,
      symbol: req.query?.symbol,
      timeframe: req.query?.timeframe,
      direction: req.query?.direction,
      result: req.query?.result,
      from: req.query?.from,
      to: req.query?.to,
    });

    return res.status(200).json({
      success: true,
      summary,
    });
  } catch (error) {
    return res.status(error.code === "CANONICAL_STORE_NOT_CONFIGURED" ? 503 : 500).json({
      success: false,
      error: {
        code: error.code || "SERVER_ERROR",
        message: error.message || "Server error",
      },
    });
  }
}
