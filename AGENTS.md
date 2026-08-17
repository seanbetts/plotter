# Agent Instructions

## Development Servers

- Use `npm run dev` for normal development. It runs Vite on the default app port and uses the app's normal environment.
- Use `npm run test:e2e` for Playwright coverage. Playwright owns one disposable Plotter service plus Vite on `127.0.0.1:5174` and stops both when the test run exits.
- Do not expect the Playwright web server to remain running after e2e tests. Start `npm run dev` separately when you need a persistent browser target.
- Use `npm run dev:e2e` only when you intentionally need to inspect the isolated service-backed app manually at `/plotter/`. It uses only `tests/.tmp/e2e-user-data` and removes that exact directory when it stops.
- Restart Vite after changing `.env` or any `VITE_*` value. Vite reads those values at process start.

## Storage And Test Data

- Keep normal app storage and e2e storage separate.
- E2e runs must use `VITE_TRIP_STORAGE=e2e-service` through the repository harness so they do not depend on Supabase auth, rate limits, provider secrets, browser IndexedDB, or personal trip state.

## Permanent Local Hosting

- `npm run dev` remains loopback development only.
- Permanent hosting builds the committed revision with `VITE_PUBLIC_BASE_PATH=/plotter/`.
- Caddy serves `dist`, so no persistent Node process is required.
- `SERPAPI_API_KEY` is not a browser build variable.
- Trip data reads and writes still use the existing `npm run trip -- <command>` CLI.

## Debugging And Verification

- For UI issues, verify the rendered app in a browser before drawing conclusions from code alone.
- For map interactions, wait for the app shell/search toolbar before exercising map gestures in Playwright.
- Keep changes and commits narrowly scoped. This repo often has unrelated active edits in the working tree.
