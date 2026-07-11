# Task 5 Report: Recover Routes and Return Anchor Updates as One Batch

## RED

- Added `src/tripCommands/routeRecovery.test.ts` before implementation.
- Added orchestration batch coverage in `src/tripCommands/routeOrchestration.test.ts`.
- Added ORS radius payload coverage in `src/adapters/openRouteService.test.ts`.
- Initial focused run failed as expected:
  - `routeRecovery` module did not exist.
  - `calculateAutomaticRouteLegs` still returned `RouteLeg[]`.
  - ORS adapter did not include `radiuses`.

Command:

```bash
npm test -- src/tripCommands/routeRecovery.test.ts src/tripCommands/routeOrchestration.test.ts src/adapters/openRouteService.test.ts
```

Expected RED result: failed.

## GREEN

- Added `src/tripCommands/routeRecovery.ts`.
- `calculateAutomaticRouteLegs` now returns:

```ts
{
  routeLegs: RouteLeg[];
  destinations: Destination[];
}
```

- Recovered endpoint anchors are applied to destinations with `withRoutingAnchor`.
- Recovery warnings are merged into route legs.
- `ROUTING_ANCHOR_ADJUSTED` and `VEHICLE_PROFILE_FALLBACK` are informational and keep ready metrics.
- Existing review-required behavior is retained for non-informational warnings.

Focused integration command:

```bash
npm test -- src/tripCommands/routeRecovery.test.ts src/tripCommands/routeOrchestration.test.ts src/tripCommands/tripManifest.test.ts src/tripCommands/tripDataService.test.ts src/hooks/useTripData.test.tsx src/adapters/openRouteService.test.ts
```

Result: 6 files / 160 tests passed.

## Policy Coverage

- No fallback for 401, 403, 500.
- Car ORS 2010 retries with `radiuses: [2000, 2000]`, derives endpoint anchors, and adds `ROUTING_ANCHOR_ADJUSTED`.
- Endpoint snaps beyond 2 km are rejected.
- HGV ORS 2009 falls back to `driving-car`, preserving waypoints and ferry policy, and adds `VEHICLE_PROFILE_FALLBACK`.
- HGV ORS 2010 tries HGV endpoint recovery first, then car fallback, then car endpoint recovery.
- Saved anchors are used only when their profile matches the requested profile.
- Saved anchors avoid rediscovery when the first request succeeds.
- Car errors do not fall back to HGV.
- Auth, quota, 5xx, and unrelated errors are propagated without fallback.

## Migrated Production Callers

- `tripManifest.calculatePreparedTripManifestRoutes`
  - Uses batch `destinations` and `routeLegs` for manifest materialization.
  - Manifest bulk creation persists the combined snapshot through `replaceTripData`.

- `tripDataService.planRouteLegs`
  - Returns calculated destinations plus route legs for simple create and dry-run paths.

- `tripDataService.saveStopsAndRouteLegs`
  - Persists calculated destinations and route legs in the existing snapshot write/rollback flow.
  - Covers replace, insert, update, delete, and reorder stop commands.

- `tripDataService.recalculateFailedRoutes`
  - Saves destination anchor updates and recalculated route legs from one calculation batch.

- `tripDataService.setVehicle`
  - Saves recovered destinations and recalculated route legs, with destination and route rollback on failure.

- `tripDataService.updateRouteLeg`
  - Saves recovered destination anchors and the recalculated route leg from one batch.

- `useTripData.reconcilePersistedRouteLegs`
  - Uses calculated destinations and route legs for add/update/delete/reorder destination flows.

- `useTripData.updateRouteLeg`
  - Recalculates automatic route edits through the batch path and saves anchor updates with the route leg.

- `useTripData.recalculateForVehicle`
  - Saves recovered destinations and recalculated route legs, with destination and route rollback on failure.

## Atomicity Evidence

- Manifest creation uses one `replaceTripData` snapshot containing recovered destinations and route legs.
- Stop mutations continue through the existing save/rollback snapshot path, now using calculated destinations.
- Failed-route recalculation saves changed destinations and changed route legs from the same returned calculation batch.
- Vehicle recalculation rolls back both destination and route snapshots if persistence fails.
- Hook route-edit and vehicle recalculation queue route mutations and persist destination anchor updates with the route-leg writes.
- Added tests prove recovered anchors flow through:
  - orchestration batch result,
  - manifest materialization,
  - command failed-route recalculation,
  - hook route-edit recalculation.

## Full Suite

Command:

```bash
npm test
```

Result: 62 files / 883 tests passed.

## Concerns

- `npm run build` was attempted. Task 5 type errors were fixed, but the build still stops on an unrelated existing fixture in `src/components/MapCanvas.test.tsx` that constructs a `Destination` without `routingAnchors`. I did not edit that file because it is outside the Task 5 ownership set.

## Review Fix Wave - 2026-07-11

### RED

- Read `.superpowers/sdd/task-5-review-findings.md` and converted each risky edge into focused tests before finishing production fixes.
- Initial review-fix focused run failed as expected:
  - 7 `routeRecovery` failures for coordinate-index endpoint policy, full radiuses arrays, waypoint-index propagation, opposite saved anchor preservation, and car-anchor reuse after HGV fallback.
  - 1 `routeOrchestration` failure proving `endpointAnchors` could leak onto a `RouteLeg`.
  - 2 `tripDataService` rollback failures proving recovered anchors/routes could persist independently.
  - 1 `useTripData` rollback failure proving hook route writes could leave recovered anchors behind.
- Added extra propagation guardrails for car endpoint recovery exhaustion, HGV endpoint recovery followed by quota failure, and unrelated ORS 404 errors.

### GREEN

- `src/tripCommands/routeRecovery.ts`
  - Recovery now honors `OpenRouteServiceError.coordinateIndex` across `[origin, ...waypoints, target]`.
  - Only coordinate index `0` or final target index is eligible for endpoint recovery.
  - Endpoint retry `radiuses` now matches the full coordinate array, uses `2000` only at the failed endpoint, and uses strict `350` elsewhere.
  - Opposite endpoint saved anchors are preserved during endpoint recovery.
  - Recovery input accepts full origin/target anchor maps so HGV-to-car fallback can reuse saved car anchors.
  - Recovery-only anchor maps are stripped before provider requests.
- `src/tripCommands/routeOrchestration.ts`
  - `endpointAnchors` is destructured away before route data is spread onto `RouteLeg`.
  - `calculateAutomaticRouteLegs` passes full anchor maps and returns destination anchor updates with route legs.
  - `reconcileAndSaveRouteLegs` now persists changed destination refs before route writes instead of dropping anchor updates.
- `src/tripCommands/tripDataService.ts`
  - Failed-route recalculation and route-edit recalculation now use rollback-safe sequential logical batches.
  - A route write failure restores prior destinations and routes; an anchor write failure does not persist the route.
  - Mutation paths save only destination objects whose references changed.
- `src/hooks/useTripData.ts`
  - Route edit and vehicle recalculation now use the same sequential rollback-safe route/destination batch shape.
  - Reconcile persistence saves only changed destination refs.
- `src/components/MapCanvas.test.tsx`
  - Feature-caused `Destination` fixture build failure fixed with `routingAnchors: {}`.

### Exact Policy Coverage

1. Requested profile with saved anchors:
   - Covered by saved-anchor tests that reuse only profile-matching anchors and avoid rediscovery.
2. Same profile with 2 km endpoint radius after ORS 2010:
   - Covered for origin and target failures with waypoints.
   - Covered for waypoint-index 2010 propagation without endpoint fallback.
   - Covered for opposite saved anchor preservation and full radiuses array alignment.
3. `driving-car` after HGV 2009 or exhausted HGV 2010:
   - Covered by HGV 2009 fallback test.
   - Covered by HGV 2010 test that tries HGV endpoint recovery before car fallback and car endpoint recovery.
   - Covered by existing car-anchor reuse after HGV fallback.
4. `driving-car` with 2 km radius after car 2010:
   - Covered by car endpoint recovery and car endpoint recovery exhaustion tests.
5. No fallback for car, 401, 403, persistent 429, 5xx, or unrelated errors:
   - Covered by auth/quota/server/unrelated propagation table.
   - Covered by persistent HGV endpoint-recovery quota failure.
   - Covered by car endpoint recovery failure and car 2009 no-HGV-fallback tests.

### Production Caller Audit

Rechecked all production `calculateAutomaticRouteLegs` callers:

- `src/tripCommands/tripManifest.ts`
  - `calculatePreparedTripManifestRoutes` consumes the returned destination/route batch and materializes it into one replacement snapshot.
- `src/tripCommands/routeOrchestration.ts`
  - `finalizeRouteLeg` still intentionally returns only the route leg for single-leg finalization.
  - `reconcileAndSaveRouteLegs` now saves changed destination anchor refs as well as route legs.
- `src/tripCommands/tripDataService.ts`
  - `planRouteLegs`, `saveStopsAndRouteLegs`, `recalculateFailedRoutes`, `setVehicle`, and `updateRouteLeg` all consume batch destination/route output.
  - Failed-route recalculation and route edits now persist through rollback-safe logical batches.
- `src/hooks/useTripData.ts`
  - `reconcilePersistedRouteLegs`, `updateRouteLeg`, and `recalculateForVehicle` all consume batch destination/route output.
  - Route edit and vehicle recalculation write destination anchor updates and routes through sequential rollback-safe batches.

### Atomicity Evidence

- `tripDataService.recalculateFailedRoutes`: route write failure after recovered anchor persistence restores prior destinations and routes.
- `tripDataService.updateRouteLeg`: anchor write failure rejects before route persistence, leaving previous route legs intact.
- `useTripData.updateRouteLeg`: route write failure after recovered anchor persistence restores prior destinations and route leg state.
- Existing snapshot rollback tests continue to cover stop mutation writes; tests were adjusted to respect the new changed-reference-only destination write contract.
- `endpointAnchors` cannot persist to `RouteLeg`; regression assertion checks the calculated route leg has no `endpointAnchors` property.

### Commands And Results

```bash
npm test -- src/tripCommands/routeRecovery.test.ts src/tripCommands/routeOrchestration.test.ts src/tripCommands/tripManifest.test.ts src/tripCommands/tripDataService.test.ts src/hooks/useTripData.test.tsx src/adapters/openRouteService.test.ts
```

Result: 6 files / 171 tests passed.

```bash
npm run build
```

Result: passed (`tsc -b` and `vite build`). Vite emitted only the existing large chunk warning.

```bash
npm test
```

Result: 62 files / 894 tests passed. Node emitted the existing localStorage experimental warnings.

### Files Changed In Fix Wave

- `.superpowers/sdd/task-5-report.md`
- `src/adapters/openRouteService.ts`
- `src/components/MapCanvas.test.tsx`
- `src/hooks/useTripData.ts`
- `src/hooks/useTripData.test.tsx`
- `src/tripCommands/routeOrchestration.ts`
- `src/tripCommands/routeOrchestration.test.ts`
- `src/tripCommands/routeRecovery.ts`
- `src/tripCommands/routeRecovery.test.ts`
- `src/tripCommands/tripDataService.ts`
- `src/tripCommands/tripDataService.test.ts`

### Self-Review

- The earlier build concern is superseded: `npm run build` now passes after the allowed `MapCanvas.test.tsx` fixture fix.
- Provider mechanics remain in `openRouteService`; recovery order and fallback policy live in `routeRecovery`.
- No UI or route-option provenance was added.
- Auth/quota errors are still propagated and are not converted into fallback routes.
- Unrelated modified reports from Tasks 1 and 4 remain unstaged and outside this fix commit.
- No remaining concerns.
