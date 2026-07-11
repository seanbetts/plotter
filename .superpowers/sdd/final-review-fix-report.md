# Trip Routing Intent Final Review Fix Report

## Status

Implementation and verification complete for the five consolidated final-review findings.

## Architecture

- Route calculation entry points now require and retain the complete `TripRoutingVehicle`; no supported manual-to-automatic or failed-route recovery path falls back to the Standard wrapper.
- Route keys use one explicit, field-by-field canonical JSON contract for endpoints, ordered waypoint coordinates, the complete vehicle snapshot, ferry policy, provider-affecting options, and variant. Alternative keys call the same builder.
- Ordinary reconciliation receives the current vehicle snapshot and preserves a ready automatic leg only when its complete data, canonical key, intent, endpoints, and geometry remain compatible.
- UI route mutations share a global mutation key. Reconciliation acquires it before rereading persisted destinations and route legs, replanning, calculating, and persisting. Direct intent edits reread the persisted leg after acquiring the same lock.
- CLI stop snapshot persistence is serialized per trip. It rereads complete destination and route snapshots inside the queue immediately before planning and calculating. CLI route-intent edits use the same per-trip queue.
- UI and CLI stop persistence write complete destination/route snapshots and compensate sequentially on failure: remove newly introduced records, restore every prior destination, remove newly introduced routes, then restore every prior route. Every rollback is attempted and primary plus rollback failures are combined.

## TDD Evidence

### RED: vehicle propagation, preservation, manifest, and keys

Command:

```text
npm test -- src/domain/routeLegs.test.ts src/domain/vehiclePresets.test.ts src/domain/routeOptions.test.ts src/domain/routePlanner.test.ts src/tripCommands/routeOrchestration.test.ts src/tripCommands/tripManifest.test.ts src/tripCommands/tripDataService.test.ts
```

Result: exit 1; 7 files failed, 8 tests failed, 100 passed. Expected failures proved:

- object insertion order changed normal and alternative route keys;
- provider options did not affect either key;
- `standardRoutingVehicle` and nested restrictions were mutable;
- a ready Expedition-truck leg became pending Standard/driving-car during unrelated reconciliation;
- `finalizeRouteLeg` sent Standard/driving-car instead of Expedition-truck HGV intent;
- failed-route recovery did not use the trip HGV snapshot;
- Manifest V2 manual vehicle shipping lacked straight-line geometry.

### GREEN: vehicle propagation, preservation, manifest, and keys

The focused consolidated command after implementation passed as part of:

```text
npm test -- src/hooks/useTripData.test.tsx src/tripCommands/tripDataService.test.ts src/domain/routePlanner.test.ts src/domain/routeLegs.test.ts src/domain/routeOptions.test.ts src/tripCommands/routeOrchestration.test.ts src/tripCommands/tripManifest.test.ts src/domain/vehiclePresets.test.ts
```

Result: exit 0; 8 files and 156 tests passed.

### RED: reconciliation concurrency and UI compensation

Command:

```text
npm test -- src/hooks/useTripData.test.tsx -t "serializes a constrained|restores destination and route snapshots"
```

Result: exit 1; 2 tests failed. The blocked-provider race ended with `ferryPolicy: allow` and empty notes instead of the later `avoid` constrained intent. The route-storage failure surfaced only `route write failed` and did not provide snapshot restoration semantics.

### GREEN: reconciliation concurrency and compensation

Commands:

```text
npm test -- src/hooks/useTripData.test.tsx -t "serializes a constrained|restores destination and route snapshots"
npm test -- src/tripCommands/tripDataService.test.ts -t "restores the complete stop|surfaces primary and rollback consistency"
```

Results: both exit 0; 2 UI tests and 2 CLI tests passed. Coverage proves the later constrained intent wins, route failure after destination persistence restores both snapshots and UI state, and primary plus rollback diagnostics are retained. Existing vehicle-route rollback tests additionally cover partial route saves and rollback failures.

## Files

- `src/adapters/openRouteService.ts`
- `src/domain/routeLegs.ts` and tests
- `src/domain/routeOptions.ts` and tests
- `src/domain/routePlanner.ts` and tests
- `src/domain/vehiclePresets.ts` and tests
- `src/hooks/useTripData.ts` and tests
- `src/tripCommands/routeOrchestration.ts` and tests
- `src/tripCommands/tripDataService.ts` and tests
- `src/tripCommands/tripManifest.ts` and tests
- `.superpowers/sdd/final-review-fix-report.md`

## Final Verification

- Legacy runtime gate: exit 0.
- `npm run lint`: exit 0; no findings.
- `npm test`: exit 0; 57 files and 815 tests passed. Node printed the existing experimental `localStorage` warning.
- `npm run build`: exit 0; TypeScript and Vite build passed. Vite printed the existing large-chunk advisory.
- `npm run test:e2e`: exit 0; Playwright ran the full Chromium suite on its disposable e2e server.
- `git diff --check`: exit 0.
- Both installed/repo skill reference `diff -u` checks: exit 0.

## Self-Review

- Manual vehicle-shipping split validation remains before any destination or route persistence.
- Reconciliation never calculates from a caller-supplied stale route plan; it plans from a fresh persisted snapshot inside the global lock.
- A route edit that starts after a reconciliation queues behind it and wins afterward; one that completes first is visible to reconciliation's fresh read.
- HGV preservation compares the canonical key reconstructed with the current vehicle, ordered waypoints, ferry policy, and any stored variant/provider options.
- Alternative provider requests include the exact alternative/avoid parameters in their keys.
- Manifest V1 validation remains strict and no legacy runtime type was reintroduced.
- Rollback is sequential so destination cascade behavior cannot delete a route after it has been restored; failures do not stop later restoration attempts.
- UI destination and route state changes only after snapshot persistence succeeds, except the existing reorder preview, which explicitly returns both states to the prior snapshot on rejection.

## Concerns

- Rollback is compensating rather than a cross-backend transaction; combined consistency diagnostics identify any record whose restoration failed and may require repair.
- The repository's existing Node experimental `localStorage` warning and Vite large-chunk advisory remain unchanged.
