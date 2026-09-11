export type Direction = "BUY" | "SELL";
export type StrategyId = "strong_sd_magnet" | "swing_liquidity" | "swing_forecast";
export type SignalStatus = "PENDING" | "ACTIVE" | "WIN" | "LOSS" | "AMBIGUOUS";
export type SignalResult = "WIN" | "LOSS" | "AMBIGUOUS" | null;
export interface CanonicalSignal { id: string; identityKey?: string; strategy: StrategyId; symbol: string; timeframe: string; direction: Direction; status: SignalStatus; signalTime: string; candleTime: string; entryCandleTime: string | null; entryPrice: number; takeProfit: number[]; stopLoss: number; result: SignalResult; resultPrice: number | null; resultTime: string | null; createdAt: string; updatedAt: string; lockedAt: string | null; lastEvaluatedCandleTime?: string | null; metadata?: Record<string, unknown>; }
export interface CanonicalSummary { totalSignals: number; wins: number; losses: number; open: number; pending: number; active: number; ambiguous: number; winRate: number; }
export type PerformanceBreakdown = CanonicalSummary;
export interface HistoryResponse { success: true; summary: CanonicalSummary; records: CanonicalSignal[]; }
export interface PerformanceResponse { success: true; summary: CanonicalSummary; strategyPerformance: Record<StrategyId, PerformanceBreakdown>; directionPerformance: Record<Direction, PerformanceBreakdown>; }
export interface StrategyEndpointResponse { success: true; symbol: string; interval: string; canonicalSignal?: unknown; engine?: Record<string, unknown>; strategy?: Record<string, unknown>; market?: Record<string, unknown>; tradePlan?: Record<string, unknown> | null; signal?: Record<string, unknown> | null; nextCandle?: Record<string, unknown>; closedCandle?: Record<string, unknown>; }
