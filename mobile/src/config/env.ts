const DEFAULT_API_BASE_URL = "https://wajid-ai-signals.vercel.app";
export const config = { apiBaseUrl: (process.env.EXPO_PUBLIC_API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/+$/, ""), appEnvironment: process.env.EXPO_PUBLIC_APP_ENV || "development" } as const;
