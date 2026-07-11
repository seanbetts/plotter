## Task 4 Report: Persist and Invalidate Profile-Specific Routing Anchors

### Status
- GREEN

### RED
- Added failing coverage before production edits in:
  - `src/domain/destinations.test.ts`
  - `src/storage/supabaseTripRepository.test.ts`
  - `src/storage/tripRepository.test.ts`
- Ran:
  - `npm test -- src/domain/destinations.test.ts src/storage/supabaseTripRepository.test.ts src/storage/tripRepository.test.ts`
- Observed expected failures:
  - `withRoutingAnchor is not a function`
  - Supabase destination rows did not expose `routing_anchors`
  - Dexie v8 upgrade test proved legacy destinations were not backfilled with `routingAnchors: {}`

### GREEN
- Added `RoutingAnchorProfile`, `RoutingAnchor`, and `RoutingAnchors` in `src/domain/types.ts`.
- Added `Destination.routingAnchors`, defaulted new destinations to `{}`, and implemented `withRoutingAnchor()` in `src/domain/destinations.ts`.
- Updated `updateDestination()` so exact `lat`/`lng` equality preserves anchors, while any coordinate change clears all anchors.
- Mapped `routing_anchors` in `src/storage/supabaseTripRepository.ts`, defaulting missing Supabase values to `{}` and keeping anchors out of `route_context`.
- Added Dexie v8 destination backfill in `src/storage/tripDb.ts`.
- Re-ran:
  - `npm test -- src/domain/destinations.test.ts src/storage/supabaseTripRepository.test.ts src/storage/tripRepository.test.ts`
- Result:
  - `Test Files 3 passed`
  - `Tests 84 passed`

### Migration And Round-Trip Evidence
- Supabase round-trip:
  - `destinationToSupabaseRow(destination, tripId).routing_anchors` matched `destination.routingAnchors`
  - `destinationFromSupabaseRow(row).routingAnchors` matched `row.routing_anchors`
  - `destinationFromSupabaseRow({ ...row, routing_anchors: undefined }).routingAnchors` returned `{}`
- Local migration:
  - Seeded a version 7 Dexie database with a destination row missing `routingAnchors`
  - Opened it through `createTripDb()` version 8
  - Verified both the stored row and `createTripRepository(...).listDestinations()` returned `routingAnchors: {}`

### Files
- `src/domain/types.ts`
- `src/domain/destinations.ts`
- `src/domain/destinations.test.ts`
- `src/storage/supabaseTripRepository.ts`
- `src/storage/supabaseTripRepository.test.ts`
- `src/storage/tripDb.ts`
- `src/storage/tripRepository.test.ts`

### Full Suite
- Ran:
  - `npm test`
- Result:
  - `Test Files 61 passed`
  - `Tests 867 passed`

### Concerns
- None.
