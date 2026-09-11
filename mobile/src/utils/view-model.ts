import type { CanonicalSignal, CanonicalSummary } from "../types/canonical";
import { formatPrice } from "./canonical";
export function signalDisplay(signal: CanonicalSignal) { return { id: signal.id, direction: signal.direction, status: signal.status, entry: formatPrice(signal.entryPrice), tp: signal.takeProfit.map(formatPrice).join(" / "), sl: formatPrice(signal.stopLoss) }; }
export function historyDisplay(record: CanonicalSignal) { return { id: record.id, strategy: record.strategy, direction: record.direction, entry: formatPrice(record.entryPrice), result: record.result ?? record.status, resultPrice: record.resultPrice == null ? "—" : formatPrice(record.resultPrice) }; }
export function winRateDisplay(summary: CanonicalSummary) { return `${summary.winRate.toFixed(2)}%`; }
