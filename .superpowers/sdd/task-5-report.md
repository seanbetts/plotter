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
