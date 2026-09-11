# STEP 5 — Mobile → Live Canonical APIs

The Expo + TypeScript mobile app is a read-only consumer of the Wajid canonical backend.

## Backend contract

The client consumes `/api/market`, `/api/liquidity`, `/api/forecast`, `/api/history`, and `/api/performance`.

The three strategy endpoints expose `canonicalSignal` when the canonical backend has a signal. `/api/history` and `/api/performance` expose persisted canonical records and server-calculated metrics. The mobile client does not reinterpret strategy mathematics or manufacture signals.

## Data flow

Home / Signals → strategy endpoint → `canonicalSignal`

History → `/api/history`

Performance → `/api/performance`

All responses pass runtime validation before presentation.

## Refresh policy

- Live strategy endpoints: 30 seconds while the screen is focused.
- History/performance: 30 seconds while the screen is focused.
- Focus refresh and pull-to-refresh are enabled.
- React Query provides request deduplication and cleanup.
- HTTP timeout: 12 seconds.

## Safety

- No Twelve Data calls from mobile.
- No Upstash calls from mobile.
- No private server credentials in the app.
- No strategy calculations, result calculations, or client-generated canonical IDs.
- Missing `canonicalSignal` is rendered as WAIT.
