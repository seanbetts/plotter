# Task 2 Report: Place And Link Enrichment

## Status

Complete.

## Implementation summary

- Added `createPlaceResolver` in `src/tripCommands/placeResolver.ts`.
- Added `createLinkEnricher` in `src/tripCommands/linkEnrichment.ts`.
- Added focused tests for both modules in:
  - `src/tripCommands/placeResolver.test.ts`
  - `src/tripCommands/linkEnrichment.test.ts`

`createPlaceResolver` now:
- Resolves query-only place input through `searchMapTilerPlaces` when a MapTiler API key is available.
- Uses coordinate input as the canonical anchor and enriches it through `resolveMapTilerCoordinates` when possible.
- Falls back to legacy/manual location data when coordinates exist but enrichment is unavailable.
- Throws a clear error for query-only input without a MapTiler API key.
- Supports both `stop` and `activity` profiles per the Task 2 brief.

`createLinkEnricher` now:
- Normalizes raw URLs before enrichment.
- Uses preview metadata when a preview client succeeds.
- Falls back to `createFallbackResearchLink` when no preview client is provided or preview fetching fails.

## TDD RED/GREEN evidence

### RED

Command:

```bash
npm test -- src/tripCommands/placeResolver.test.ts src/tripCommands/linkEnrichment.test.ts
```

Observed result:
- FAILED as expected.
- Failure reason was missing implementation files:
  - `Failed to resolve import "./placeResolver"`
  - `Failed to resolve import "./linkEnrichment"`

This matched the task brief's expected red state.

### GREEN

Command:

```bash
npm test -- src/tripCommands/placeResolver.test.ts src/tripCommands/linkEnrichment.test.ts
```

Observed result:
- PASS
- `Test Files  2 passed (2)`
- `Tests  6 passed (6)`

### Full suite

Command:

```bash
npm test
```

Observed result:
- PASS
- `Test Files  45 passed (45)`
- `Tests  546 passed (546)`

Observed warning output during the full suite:
- Node emitted repeated `ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.`
- These warnings pre-existed this task's code path and did not fail the suite, but they mean the output was not completely pristine.

## Tests and results

- Focused Task 2 tests: passed.
- Full Vitest suite: passed.

## Files changed

- `src/tripCommands/placeResolver.ts`
- `src/tripCommands/placeResolver.test.ts`
- `src/tripCommands/linkEnrichment.ts`
- `src/tripCommands/linkEnrichment.test.ts`

## Self-review findings

- The implementation stays scoped to the Task 2 brief and existing Task 1 interfaces.
- The new code reuses existing domain helpers (`createLegacyLocation`, research-link normalization/fallback helpers) instead of duplicating logic.
- The tests verify behavior at the public factory/function boundary and only mock the external geocoding dependency where isolation is necessary.
- The brief-provided tests only exercise `stop` profile behavior directly; the implemented `activity` path was included because it is part of the explicit Task 2 contract.

## Concerns

- Full-suite output includes existing Node `localStorage` experimental warnings, so the run is passing but not warning-free.
- The new tests are intentionally aligned to the implementation brief; they do not add extra direct coverage for the `activity` branch beyond implementation-by-contract.
