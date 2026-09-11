export const STRATEGIES = [{ id: "strong_sd_magnet", name: "Strong SD Magnet", description: "Supply / demand magnet signal view." }, { id: "swing_liquidity", name: "Swing Liquidity", description: "Liquidity sweep and confirmation signal view." }, { id: "swing_forecast", name: "Swing Forecast", description: "Completed-candle forecast with next-open execution model." }] as const;
export type StrategyId = (typeof STRATEGIES)[number]["id"];
export function getStrategyById(id: string) { return STRATEGIES.find((strategy) => strategy.id === id); }
