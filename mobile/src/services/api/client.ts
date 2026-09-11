import { config } from "@/config/env";
import { ApiError, isRecord } from "@/types/api";
const DEFAULT_TIMEOUT_MS = 12_000;
export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(`${config.apiBaseUrl}${path}`, { ...init, signal: init?.signal ?? controller.signal, headers: { Accept: "application/json", ...(init?.headers ?? {}) } });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) { const raw = isRecord(payload) ? payload.error : undefined; const message = typeof raw === "string" ? raw : isRecord(raw) && typeof raw.message === "string" ? raw.message : `Request failed with status ${response.status}`; const code = isRecord(raw) && typeof raw.code === "string" ? raw.code : "HTTP_ERROR"; throw new ApiError(message, code, response.status); }
    if (!payload) throw new ApiError("The server returned an empty response.", "INVALID_JSON", response.status);
    return payload as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new ApiError("The server took too long to respond. Please try again.", "TIMEOUT");
    throw new ApiError("Network connection failed. Check your connection and try again.", "NETWORK_ERROR");
  } finally { clearTimeout(timeout); }
}
