export interface ApiErrorPayload { success?: boolean; error?: { code?: string; message?: string } | string; }
export class ApiError extends Error { constructor(message: string, public readonly code = "API_ERROR", public readonly status?: number) { super(message); this.name = "ApiError"; } }
export function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
