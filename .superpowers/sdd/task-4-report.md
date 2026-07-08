## Task 4 Report: TripDataService For Trips And Stops

### Status
- Complete

### Implementation Summary
- Added `src/tripCommands/tripDataService.ts` with the `createTripDataService` factory and the Task 4 trip/stop command surface:
  - `listTrips`
  - `getTrip`
  - `createTrip`
  - `deleteTrip`
  - `renameTrip`
  - `replaceStops`
  - `insertStop`
  - `updateStop`
  - `deleteStop`
  - `reorderStops`
- Kept activity and link methods present but intentionally returning structured `COMMAND_NOT_IMPLEMENTED` results for Task 5.
- Mapped stop notes to `Destination.research.notes` for both stop creation and stop updates.
- Preserved the ordered-adjacent-stop route-leg rule through the shared `reconcileAndSaveRouteLegs` helper.
- Added trip/stop service coverage in `src/tripCommands/tripDataService.test.ts` with an in-memory fake directory/repository that throws for unimplemented methods not used by the tests.

### Files Changed
- `src/tripCommands/tripDataService.ts`
- `src/tripCommands/tripDataService.test.ts`
- `.superpowers/sdd/task-4-report.md`

### TDD Evidence
#### RED
1. Added `src/tripCommands/tripDataService.test.ts` before any production implementation.
2. Ran:
   - `npm test -- src/tripCommands/tripDataService.test.ts`
3. Result:
   - Failed as expected because `src/tripCommands/tripDataService.ts` did not exist.
   - Key failure: `Failed to resolve import "./tripDataService" ... Does the file exist?`

#### GREEN
1. Implemented the initial service and reran:
   - `npm test -- src/tripCommands/tripDataService.test.ts`
2. Observed failing behavioral assertions around duplicate route calculations and one incorrect reorder expectation in the test.
3. Refined the implementation so apply paths calculate routes once, while dry-run paths still preview route changes.
4. Corrected the reorder expectation to reflect preserved adjacent legs.
5. Final focused result:
   - `Test Files 1 passed`
   - `Tests 10 passed`

### Tests And Results
- Focused service tests:
  - `npm test -- src/tripCommands/tripDataService.test.ts`
  - Result: passed (`1` file, `10` tests)
- Full suite:
  - `npm test`
  - Result: passed (`47` files, `559` tests)
- Build verification:
  - `npm run build`
  - Result: passed
  - Note: Vite reported an existing chunk-size warning for the production bundle, but the build completed successfully.

### Self-Review Findings
- The service now supports dry-run previews for all Task 4 write commands that were implemented.
- Destructive commands requiring confirmation:
  - `deleteTrip`
  - `replaceStops`
  - `deleteStop`
- Route recalculation accounting is based on actual route-leg changes rather than raw stop count changes, which avoided overstating recalculations on reorder.
- Apply paths no longer double-call the route calculator after the first implementation pass.

### Concerns
- `getTrip` currently accepts `includeLinks` but does not branch behavior on it yet; stop links remain present in returned destinations. This did not affect Task 4 because link command behavior is deferred to Task 5.
- The implementation normalizes destination links opportunistically in the service layer so returned stop data stays consistently sorted even before Task 5 fills in link mutation paths.

### Commit Scope
- Commit should include only:
  - `src/tripCommands/tripDataService.ts`
  - `src/tripCommands/tripDataService.test.ts`

### Review Fix Addendum
- Addressed reviewer feedback that `createTrip` could fall through to a generic `COMMAND_FAILED` when `stops` was malformed.
- Added explicit `stops` array validation in `createTrip`, matching the existing `replaceStops` guard and returning `INVALID_STOPS` with path `stops`.
- Added a focused regression test for `createTrip({ name: 'NC500', stops: {} as never })` that asserts:
  - `ok: false`
  - structured validation error output
  - no trip creation side effect

### Verification
- `npm test -- src/tripCommands/tripDataService.test.ts`
  - passed (`1` file, `11` tests)
- `npm test`
  - passed (`47` files, `560` tests)
