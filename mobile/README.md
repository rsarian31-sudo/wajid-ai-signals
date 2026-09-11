# Wajid AI Signals — Mobile

React Native + Expo + TypeScript client for the canonical Wajid AI Signals backend.

## Scope

The mobile app is presentation-only. It consumes `/api/market`, `/api/liquidity`, `/api/forecast`, `/api/history`, and `/api/performance`. It does not calculate strategies, generate signal IDs, calculate results, call Twelve Data, or call Upstash.

## Run

```bash
npm install
npm run start
```

Production API base URL defaults to `https://wajid-ai-signals.vercel.app` and can be overridden with `EXPO_PUBLIC_API_BASE_URL`.

## Refresh policy

Live strategy, history, and performance queries use a conservative 30-second interval while their screen is focused, plus focus refresh and pull-to-refresh. Requests time out after 12 seconds.
