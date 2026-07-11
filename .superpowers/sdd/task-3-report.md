# Task 3 Report: Validate Manifests Before Route Calculation

Status: DONE

## Implementation Summary

- Split manifest materialization into two explicit phases in `src/tripCommands/tripManifest.ts`:
  - `prepareTripManifest(...)` resolves stops, activities, links, waypoints, pending route legs, routing vehicle, and change summary without calling ORS.
  - `calculatePreparedTripManifestRoutes(...)` is now the only phase that calls route calculation.
- Kept `materializeTripManifest(...)` as a compatibility composition of the two phases.
- Updated manifest-backed `createTrip(...)` in `src/tripCommands/tripDataService.ts` to:
  - prepare the manifest first,
  - audit the prepared snapshot with `routeLegs: []`,
  - block on `ACTIVITY_DISTANCE_OUTLIER` before any routing call,
  - calculate routes only after that audit passes,
  - keep the final post-route audit for the command response.
- Strengthened tests so the semantic blocker proves zero route calls, while valid manifests still prove one route call per automatic adjacent leg.

## TDD RED/GREEN Evidence

### RED

Command:

```bash
npm test -- src/tripCommands/tripManifest.test.ts src/tripCommands/tripDataService.test.ts
```

Observed failures before the implementation:

```text
FAIL src/tripCommands/tripManifest.test.ts > prepares manifest data before route calculation and preserves automatic call counts after routing
TypeError: prepareTripManifest is not a function

FAIL src/tripCommands/tripDataService.test.ts > blocks a manifest with semantic errors before creating a trip
AssertionError: expected "vi.fn()" to not be called at all, but actually been called 23 times
```

This showed both missing explicit-phase exports and the quota leak: a semantically invalid manifest still spent 23 route calculations before the audit rejection.

### GREEN

Command:

```bash
npm test -- src/tripCommands/tripManifest.test.ts src/tripCommands/tripDataService.test.ts
```

Result after the implementation:

```text
Test Files  2 passed (2)
Tests  61 passed (61)
```

## Call-Count Evidence

- Valid bulk manifest:
  - 26 stops produce 25 adjacent legs.
  - 2 explicit manual shipping directives remove 2 automatic calculations.
  - Expected automatic route calls: `26 - 1 - 2 = 23`.
  - The service test now derives that count and verifies `calculateRoute` is called exactly 23 times.
- Semantic blocker case:
  - The same manifest with an outlier activity now returns `TRIP_AUDIT_FAILED`.
  - `calculateRoute` is asserted to be called 0 times.
  - `createTrip` is asserted to be called 0 times.
  - `replaceTripData` is asserted to be called 0 times.
- Phase split case:
  - `prepareTripManifest(...)` resolves all non-route data and leaves `calculateRoute` at 0 calls.
  - `calculatePreparedTripManifestRoutes(...)` then performs exactly the expected automatic route work.

## Files Changed

- `src/tripCommands/tripManifest.ts`
- `src/tripCommands/tripManifest.test.ts`
- `src/tripCommands/tripDataService.ts`
- `src/tripCommands/tripDataService.test.ts`
- `.superpowers/sdd/task-3-report.md`

## Full-Suite Evidence

Command:

```bash
npm test
```

Result:

```text
Test Files  61 passed (61)
Tests  865 passed (865)
```

Notes:

- Baseline HEAD was reported as 61 files / 864 tests.
- The suite now reports 865 tests because Task 3 adds one new regression test covering the explicit preparation phase.
- The run still emits the pre-existing Node experimental `localStorage` warnings; they are unrelated to this task.

## Self-Review

- Confirmed `materializeTripManifest(...)` remains as a compatibility composition and existing callers can still request the full operation in one call.
- Confirmed successful routing behavior is unchanged after validation passes:
  - routing still uses the same pending adjacent legs,
  - route calculation still runs through `calculateAutomaticRouteLegs(...)`,
  - `changed.routesRecalculated` still counts the automatic adjacent legs.
- Confirmed the pre-route audit intentionally uses `routeLegs: []`, so it only blocks on semantic issues that do not require route output.
- Confirmed the final command response still includes the completed post-route audit.
- Ran `git diff --check` on the Task 3 code files; it returned clean.

## Concerns

- Pre-route blocking currently filters only `ACTIVITY_DISTANCE_OUTLIER`, matching the brief and current audit semantics. If more pre-route semantic blockers are added later, this filter will need to expand deliberately.
- I preserved unrelated worktree changes and staged ownership only around the Task 3 files plus this report.

## Commit

Commit created with message `fix: validate trip data before routing`.
