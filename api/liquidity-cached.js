// Cached public wrapper for the canonical Swing Liquidity engine.
// Strategy mathematics remain in ./liquidity.js.
// Vercel CDN caches identical symbol/interval/outputsize responses briefly
// so repeated frontend/history/Telegram requests do not hit Twelve Data.

import liquidityHandler from "./liquidity.js";

export default async function handler(req, res) {
  const originalSetHeader = res.setHeader.bind(res);

  res.setHeader = (name, value) => {
    if (String(name).toLowerCase() === "cache-control") return originalSetHeader(name, "public, max-age=0, s-maxage=30, stale-while-revalidate=15");
    return originalSetHeader(name, value);
  };

  await liquidityHandler(req, res);

  // Keep the Vercel CDN policy explicit after the canonical handler has run.
  originalSetHeader("Cache-Control", "public, max-age=0, s-maxage=30, stale-while-revalidate=15");
  originalSetHeader("Vercel-CDN-Cache-Control", "public, s-maxage=30, stale-while-revalidate=15");
}
