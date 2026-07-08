# Task 5 Report: Link And Activity Commands

## Implementation summary

- Implemented stop link commands in `src/tripCommands/tripDataService.ts`:
  - `addStopLink`
  - `deleteStopLink`
- Implemented activity commands in `src/tripCommands/tripDataService.ts`:
  - `listActivities`
  - `createActivity`
  - `updateActivity`
  - `deleteActivity`
  - `reorderActivities`
- Implemented activity link commands in `src/tripCommands/tripDataService.ts`:
  - `addActivityLink`
  - `deleteActivityLink`
- Wired the service to existing validation and helper layers:
  - `validateActivityDraft`
  - `validateActivityPatch`
  - `validateUrlInput`
  - `dependencies.enrichLink ?? createFallbackResearchLink`
  - `reorderResearchLinks`
- Added a shared `findActivity()` helper that scans repository destinations and activity lists, matching the task brief.
- Kept route stops and child activities separate:
  - overnight places remain stops
  - non-overnight places are managed as activities under a stop

## Test changes

- Replaced the Task 4 placeholder activity repository methods in the service test harness with in-memory implementations for:
  - `createActivity`
  - `updateActivity`
  - `deleteActivity`
  - `reorderActivities`
- Extended `src/tripCommands/tripDataService.test.ts` with coverage for:
  - adding stop links
  - deleting stop links and re-densifying sort order
  - creating/updating activities with app-visible fields
  - listing/reordering/deleting activities
  - adding/deleting activity links

## TDD evidence

### RED

Command:

```bash
npm test -- src/tripCommands/tripDataService.test.ts
```

Observed failure after adding the Task 5 tests:

- `adds stop links using the link enricher`
- `deletes stop links and re-densifies the remaining sort order`
- `creates and updates an activity with visible details`
- `lists, reorders, and deletes activities under one stop`
- `adds and deletes activity links with stable ordering`

Failure cause matched the brief: the service still returned unsupported results and the harness still had placeholder activity behavior.

### GREEN

Command:

```bash
npm test -- src/tripCommands/tripDataService.test.ts
```

Result:

- `1` file passed
- `15` tests passed
- exit code `0`

## Verification commands and results

### Focused service suite

```bash
npm test -- src/tripCommands/tripDataService.test.ts
```

Result: passed (`15/15`).

### Full suite

```bash
npm test
```

Result:

- `46` files passed
- `1` file failed
- `563` tests passed
- `1` test failed

Failing test:

- `src/App.test.tsx > App > reverse geocodes coordinates entered for a manual activity location`
- failure mode: timeout

### Follow-up isolation run

```bash
npm test -- src/App.test.tsx -t "reverse geocodes coordinates entered for a manual activity location"
```

Result:

- `1` file passed
- `1` matching test passed
- `39` tests skipped
- exit code `0`

## Files changed

- `src/tripCommands/tripDataService.ts`
- `src/tripCommands/tripDataService.test.ts`
- `.superpowers/sdd/task-5-report.md`

## Self-review findings

- The service implementation follows the brief closely and stays inside the two requested production/test files.
- Link commands share the same enrichment/fallback behavior for both stops and activities.
- Activity updates are intentionally limited to app-surfaced fields (`title`, `description`, `notes`, `tags`, `place` -> `location`).
- Not-found handling now includes activities as a structured command error path.

## Concerns

- The full `npm test` run did not complete cleanly because of a timeout in `src/App.test.tsx`.
- I re-ran that exact failing test in isolation and it passed quickly, which suggests an unrelated suite-level flake or timing issue rather than a regression from this Task 5 service work.

## Fix follow-up

- Addressed reviewer feedback on duplicate activity reorders by validating `activityIds` for duplicates before any repository write occurs.
- Updated the stop-link test harness to inject a fake `enrichLink` implementation and assert that the service actually used it.

## Verification update

```bash
npm test -- src/tripCommands/tripDataService.test.ts
```

Result: passed (`16/16`).

```bash
npm test
```

Result: passed (`47` files, `565` tests).

## Reviewer follow-up

- Added a regression test for malformed `activityIds` input (`activityIds: 'abc'`), asserting the service returns a structured validation error and does not call the repository reorder write.
- Hardened `ensureActivityIdList()` in `src/tripCommands/tripDataService.ts` so non-array input fails with `ACTIVITY_IDS_REQUIRED` instead of falling through to a generic command failure.

## Verification update

```bash
npm test -- src/tripCommands/tripDataService.test.ts
```

Result: passed (`17/17`).

```bash
npm test
```

Result: passed (`47` files, `566` tests).
