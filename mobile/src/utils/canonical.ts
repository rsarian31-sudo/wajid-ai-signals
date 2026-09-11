import type { CanonicalSignal } from "@/types/canonical";
export function formatPrice(value: number) { return Number.isInteger(value) ? String(value) : value.toFixed(5).replace(/0+$/, "").replace(/\.$/, ""); }
export function formatTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString(); }
export function isOpenSignal(signal: CanonicalSignal) { return signal.status === "PENDING" || signal.status === "ACTIVE"; }
export function latestSignal(records: CanonicalSignal[]) { return records[0] ?? null; }
export function signalForStrategy(records: CanonicalSignal[], strategy: CanonicalSignal["strategy"]) { return records.find((record) => record.strategy === strategy && isOpenSignal(record)) ?? null; }
