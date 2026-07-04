# Agent Instructions

## Development Servers

- Use `npm run dev` for normal development. It runs Vite on the default app port and uses the app's normal environment.
- Use `npm run test:e2e` for Playwright coverage. Playwright owns a disposable Vite server on `127.0.0.1:5174` and stops it when the test run exits.
- Do not expect the Playwright web server to remain running after e2e tests. Start `npm run dev` separately when you need a persistent browser target.
- Use `npm run dev:e2e` only when you intentionally need to inspect the isolated e2e app manually. It uses `VITE_TRIP_STORAGE=e2e-local`.
- Restart Vite after changing `.env` or any `VITE_*` value. Vite reads those values at process start.

## Storage And Test Data

- Keep normal app storage and e2e storage separate.
- E2e runs must use `VITE_TRIP_STORAGE=e2e-local` so they do not depend on Supabase auth, rate limits, or the personal trip state.

## Debugging And Verification

- For UI issues, verify the rendered app in a browser before drawing conclusions from code alone.
- For map interactions, wait for the app shell/search toolbar before exercising map gestures in Playwright.
- Keep changes and commits narrowly scoped. This repo often has unrelated active edits in the working tree.
