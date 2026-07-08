# Task 6 Report: Node CLI Runtime

## Implementation summary

- Added a Node-only Supabase bootstrap in `src/cli/nodeSupabase.ts`:
  - loads `.env` through `dotenv/config`
  - creates a non-persistent Supabase client from `process.env`
  - ensures an anonymous session exists before running commands
- Added the full v1 CLI runtime in `src/cli/trip.ts`:
  - exported `parseTripCliArgs()` and `runTripCli()` for tests
  - wired the CLI to `createTripDataService()`
  - exposed the full command surface from the patched plan:
    - trip commands: `list`, `get`, `create`, `delete`, `rename`
    - stop commands: `replace-stops`, `insert-stop`, `update-stop`, `delete-stop`, `reorder-stops`
    - stop link commands: `add-stop-link`, `delete-stop-link`
    - activity commands: `list-activities`, `create-activity`, `update-activity`, `delete-activity`, `reorder-activities`
    - activity link commands: `add-activity-link`, `delete-activity-link`
  - defaulted output to compact JSON and supported `--pretty`
  - returned exit code `1` for structured service failures and thrown errors
  - supported `--dry-run` and `--yes` for commands whose service methods accept options
  - accepted reorder inputs as either raw string arrays or keyed objects (`{ stopIds: [...] }`, `{ activityIds: [...] }`)
- Added Node-safe env fallback in `src/storage/supabaseClient.ts` so shared repository code can be imported under `tsx` without crashing on browser-only `import.meta.env` access.
- Added the npm entrypoint in `package.json`:
  - `npm run trip -- <command>`
- Added/updated tests:
  - `src/cli/tripCli.test.ts` covers parser behavior, compact/pretty JSON output, full command dispatch, reorder input parsing, failed service exit codes, and thrown-error handling
  - `src/cli/nodeSupabase.test.ts` covers the no-session bootstrap regression found during smoke verification
- Made one incidental compile-only test typing fix in `src/tripCommands/tripDataService.test.ts` so the full `npm run build` verification can complete cleanly.

## TDD evidence

### RED 1: CLI runtime does not exist yet

Command:

```bash
npm test -- src/cli/tripCli.test.ts
```

Observed failure:

- Vitest failed to resolve `./trip` from `src/cli/tripCli.test.ts`
- Failure matched the expected starting state: the CLI runtime files had not been created yet

### GREEN 1: CLI runtime satisfies focused tests

Command:

```bash
npm test -- src/cli/tripCli.test.ts
```

Result:

- `1` file passed
- `7` tests passed
- exit code `0`

### RED 2: anonymous session bootstrap fails in Node smoke path

Smoke command that revealed the bug:

```bash
npm run trip -- list --pretty
```

Observed failure:

- `Error: Auth session missing!`
- root cause: `ensureNodeAnonymousSession()` treated an empty unauthenticated state from `getUser()` as fatal before attempting `signInAnonymously()`

Regression test added:

```bash
npm test -- src/cli/nodeSupabase.test.ts
```

Observed failure:

- `ensureNodeAnonymousSession` rejected with `Auth session missing!` instead of creating an anonymous session

### GREEN 2: anonymous session bootstrap repaired

Commands:

```bash
npm test -- src/cli/nodeSupabase.test.ts
npm test -- src/cli/tripCli.test.ts
```

Result:

- `src/cli/nodeSupabase.test.ts`: `1/1` passed
- `src/cli/tripCli.test.ts`: `7/7` passed

## Verification commands and results

### Focused CLI suite

```bash
npm test -- src/cli/tripCli.test.ts
```

Result: passed (`7/7`).

### Focused Node Supabase regression

```bash
npm test -- src/cli/nodeSupabase.test.ts
```

Result: passed (`1/1`).

### Safe smoke command

```bash
npm run trip -- list --pretty
```

Result:

- exit code `0`
- returned valid pretty JSON from the real CLI path
- loaded `2` trips from Supabase in this workspace environment

### Full suite

```bash
npm test
```

Result:

- `49` files passed
- `574` tests passed
- exit code `0`

### Build verification

```bash
npm run build
```

Result:

- TypeScript build passed
- Vite production build passed
- Vite emitted the existing large-chunk warning for the main app bundle, but the build completed successfully

### Final refresh after the last task-local cleanup

Commands:

```bash
npm test
npm run build
```

Result:

- `npm test`: passed again (`49` files, `574` tests)
- `npm run build`: passed again

## Files changed

- `package.json`
- `package-lock.json`
- `src/cli/nodeSupabase.ts`
- `src/cli/nodeSupabase.test.ts`
- `src/cli/trip.ts`
- `src/cli/tripCli.test.ts`
- `src/storage/supabaseClient.ts`
- `src/tripCommands/tripDataService.test.ts`
- `.superpowers/sdd/task-6-report.md`

## Self-review findings

- The CLI surface matches the patched Task 6 brief rather than the older narrower stop-only version.
- The runtime stays thin: parsing, JSON/file handling, exit codes, and service wiring live in the CLI; domain behavior remains in `createTripDataService()`.
- The Node path no longer depends on browser-only env helpers for Supabase configuration.
- The anonymous-session regression is now covered directly by a focused test, not only by manual smoke verification.
- The incidental `tripDataService.test.ts` change is type-only and does not alter runtime behavior.

## Concerns

- No functional concerns about the Task 6 CLI runtime at handoff.
- Verification emitted repeated Node `localStorage` experimental warnings during Vitest runs; those warnings did not affect pass/fail outcomes.
- I also ran `npm run lint` as an extra check. It still reports unrelated pre-existing lint failures in `src/App.tsx`, `src/storage/tripRepository.ts`, `src/tripCommands/tripDataService.ts`, and `tests/world-tour.spec.ts`. I fixed the one new CLI-test lint nit that came from this task, but I did not broaden scope into those older files.

## Review Fix Addendum

I tightened the CLI error path so every thrown failure now emits a structured JSON envelope with `ok: false` and `error.code: 'COMMAND_FAILED'`.

### Verification for this fix

```bash
npm test -- src/cli/tripCli.test.ts
npm test -- src/cli/nodeSupabase.test.ts
npm test
npm run build
```

Results:

- `npm test -- src/cli/tripCli.test.ts`: passed (`8/8`)
- `npm test -- src/cli/nodeSupabase.test.ts`: passed (`1/1`)
- `npm test`: passed (`49` files, `575` tests)
- `npm run build`: passed

### Notes

- `src/cli/trip.ts` now wraps both command execution and startup/bootstrap failures in the same JSON error schema.
- `src/cli/tripCli.test.ts` now covers both a thrown command failure and a startup failure from CLI bootstrap.
