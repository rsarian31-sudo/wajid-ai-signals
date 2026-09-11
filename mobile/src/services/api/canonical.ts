import { apiRequest } from "./client";
import type { Direction, HistoryResponse, PerformanceResponse, StrategyEndpointResponse, StrategyId } from "@/types/canonical";
import { parseHistoryResponse, parsePerformanceResponse, parseStrategyEndpointResponse } from "./validation";
export interface HistoryFilters { strategy?: StrategyId; symbol?: string; timeframe?: string; result?: "WIN" | "LOSS" | "AMBIGUOUS"; direction?: Direction; from?: string; to?: string; }
function query(filters: HistoryFilters = {}) { const params = new URLSearchParams(); for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value); const suffix = params.toString(); return suffix ? `?${suffix}` : ""; }
export function fetchHistory(filters: HistoryFilters = {}) { return apiRequest<unknown>(`/api/history${query(filters)}`).then(parseHistoryResponse); }
export function fetchPerformance(filters: HistoryFilters = {}) { return apiRequest<unknown>(`/api/performance${query(filters)}`).then(parsePerformanceResponse); }
const strategyPaths: Record<StrategyId, string> = { strong_sd_magnet: "/api/market", swing_liquidity: "/api/liquidity", swing_forecast: "/api/forecast" };
export interface LiveStrategyResponse { strategy: StrategyId; response: import("@/types/canonical").StrategyEndpointResponse; signal: import("@/types/canonical").CanonicalSignal | null; }
export async function fetchStrategy(strategy: StrategyId): Promise<LiveStrategyResponse> { const response = parseStrategyEndpointResponse(await apiRequest<unknown>(strategyPaths[strategy])); return { strategy, response, signal: response.canonicalSignal }; }
export async function fetchActiveSignal(strategy: StrategyId) { const response = await fetchStrategy(strategy); if (response.signal && (response.signal.status === "PENDING" || response.signal.status === "ACTIVE")) return { success: true as const, signal: response.signal }; return { success: true as const, signal: null }; }
export { parseHistoryResponse, parsePerformanceResponse };
