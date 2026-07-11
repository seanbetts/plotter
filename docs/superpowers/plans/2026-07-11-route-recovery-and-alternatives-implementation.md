# Route Recovery and Alternatives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make automatic routes recover from ORS rate limits, unsuitable endpoints, and HGV graph gaps while keeping recovered routes usable and inspectable through the existing alternatives UI.

**Architecture:** Keep ORS request mechanics in the adapter, introduce a shared request scheduler and structured provider errors, and return route legs plus app-derived destination anchors as one immutable calculation batch. Persist anchors on destinations and recovery warnings on route legs. Extend the existing leg-scoped alternatives model instead of creating a second recovery UI.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Testing Library, Dexie, Supabase/Postgres, OpenRouteService, Playwright.

## Global Constraints

- `standard` and `large-camper` use `driving-car`; only `expedition-truck` uses `driving-hgv`.
- Retain representative `large-camper` dimensions as descriptive metadata but never send them to ORS or claim they were validated.
- Endpoint recovery is limited to 2 km from the canonical stop coordinate.
- A successful recovery is `ready`, retains metrics, and carries structured warnings; `review-required` remains reserved for unresolved route intent.
- Never use ORS `delivery` as an automatic fallback.
- Route geometry, routing anchors, provider diagnostics, and fallback decisions remain app-owned and absent from skill-authored manifests.
- Preserve waypoints, ferry policy, manual vehicle-shipping legs, route fingerprints, and stale-result protections.
- All directions calls, including alternatives and fallbacks, use one scheduler with a 40-request/60-second sliding window.
- Preserve the current uncommitted changes in `src/components/ItineraryPanel.tsx`, `src/components/ItineraryPanel.test.tsx`, `src/styles.css`, and `src/styles.test.ts`; inspect and integrate with them instead of replacing them.
- E2E tests use `VITE_TRIP_STORAGE=e2e-local` and must not depend on Supabase or live ORS quota.

---

## File Structure

**Create:**

- `src/adapters/openRouteServiceScheduler.ts` - shared sliding-window scheduler and retry timing.
- `src/adapters/openRouteServiceScheduler.test.ts` - deterministic fake-clock scheduler coverage.
- `src/tripCommands/routeRecovery.ts` - provider-error classification and profile/endpoint recovery policy.
- `src/tripCommands/routeRecovery.test.ts` - Alta, HGV fallback, and no-fallback policy coverage.
- `supabase/migrations/20260711190000_add_destination_routing_anchors.sql` - destination anchor storage and large-camper snapshot migration.

**Modify:**

- `src/domain/types.ts`, `src/domain/destinations.ts`, `src/domain/vehiclePresets.ts` - anchor and warning types, invalidation, preset semantics.
- `src/adapters/openRouteService.ts` - structured errors, radiuses, endpoint metadata, scheduler use.
- `src/tripCommands/routeOrchestration.ts` - immutable route-plus-destination batch and informational warning handling.
- `src/tripCommands/tripManifest.ts`, `src/tripCommands/tripDataService.ts` - pre-route audit and batch persistence.
- `src/hooks/useTripData.ts` - app-side destination-anchor persistence for insert/reorder/recalculate flows.
- `src/storage/tripDb.ts`, `src/storage/supabaseTripRepository.ts` - local and Supabase anchor round trips and legacy normalization.
- `src/domain/routeOptions.ts`, `src/components/RouteAlternativesPanel.tsx`, `src/components/ItineraryPanel.tsx`, `src/App.tsx` - recovery option metadata, warnings, selection, and presentation.
- `src/tripCommands/tripAudit.ts`, CLI tests and agent guides - useful diagnostics and skill contracts.

---

### Task 1: Correct Vehicle Preset Semantics and Existing Snapshots

**Files:**
- Modify: `src/domain/vehiclePresets.test.ts`
- Modify: `src/domain/vehiclePresets.ts`
- Modify: `src/storage/tripRepository.test.ts`
- Modify: `src/storage/tripDb.ts`
- Create: `supabase/migrations/20260711190000_add_destination_routing_anchors.sql`

**Interfaces:**
- Produces: `resolveVehiclePreset('large-camper')` with `profile: 'driving-car'`, no `vehicleType`, and unchanged representative restrictions.
- Produces: Dexie version 7 normalization for old large-camper trip snapshots.
- Produces: Supabase migration that updates existing large-camper trip rows and adds the anchor column used by Task 4.

- [ ] **Step 1: Write failing preset and migration tests**

Add this assertion to `src/domain/vehiclePresets.test.ts`:

```ts
it('routes a car and caravan as ordinary motor traffic while retaining descriptive dimensions', () => {
  expect(resolveVehiclePreset('large-camper')).toEqual({
    preset: 'large-camper',
    profile: 'driving-car',
    restrictions: { length: 7.5, width: 2.5, height: 3.2, weight: 5, axleLoad: 3 },
  });
});
```

In `src/storage/tripRepository.test.ts`, create a version 6 database containing a trip with `preset: 'large-camper'`, `profile: 'driving-hgv'`, and `vehicleType: 'hgv'`; reopen it through `createTripDb` and assert the trip equals `resolveVehiclePreset('large-camper')` while restrictions remain unchanged.

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```bash
npm test -- src/domain/vehiclePresets.test.ts src/storage/tripRepository.test.ts
```

Expected: FAIL because `large-camper` still resolves to `driving-hgv` and no version 7 normalization exists.

- [ ] **Step 3: Update the preset and local migration**

Change the preset entry to:

```ts
'large-camper': {
  preset: 'large-camper',
  profile: 'driving-car',
  restrictions: { length: 7.5, width: 2.5, height: 3.2, weight: 5, axleLoad: 3 },
},
```

Add this exact schema constant and Dexie version 7 trip normalization:

```ts
const currentStores = {
  trips: 'id, name, updatedAt, createdAt',
  destinations: 'id, tripId, [tripId+order], name, countryRegion, status, priority, updatedAt',
  routeLegs: 'id, tripId, [tripId+updatedAt], originDestinationId, targetDestinationId, movement, calculation, status, routeKey, updatedAt',
  activities: 'id, tripId, [tripId+destinationId], [tripId+destinationId+order], title, status, priority, updatedAt',
  activityMedia: 'id, tripId, [tripId+activityId], [tripId+destinationId], sortOrder, uploadedAt',
};

db.version(7).stores(currentStores).upgrade(async (transaction) => {
  await transaction.table('trips').toCollection().modify((trip) => {
    if (trip.routingVehicle?.preset === 'large-camper') {
      trip.routingVehicle = resolveVehiclePreset('large-camper');
    }
  });
});
```

Use `currentStores` for versions 6 and 7 so their index declarations remain byte-for-byte equivalent.

- [ ] **Step 4: Add the Supabase migration**

Create `supabase/migrations/20260711190000_add_destination_routing_anchors.sql`:

```sql
alter table public.destinations
  add column routing_anchors jsonb not null default '{}'::jsonb;

update public.trips
set
  vehicle_profile = 'driving-car',
  vehicle_type = null
where vehicle_preset = 'large-camper';
```

Do not alter `vehicle_restrictions`.

- [ ] **Step 5: Run focused tests and commit**

Run:

```bash
npm test -- src/domain/vehiclePresets.test.ts src/storage/tripRepository.test.ts
```

Expected: PASS.

Commit only Task 1 files:

```bash
git add src/domain/vehiclePresets.ts src/domain/vehiclePresets.test.ts src/storage/tripDb.ts src/storage/tripRepository.test.ts supabase/migrations/20260711190000_add_destination_routing_anchors.sql
git commit -m "fix: route large campers as cars"
```

---

### Task 2: Preserve Provider Errors and Schedule Directions Requests

**Files:**
- Create: `src/adapters/openRouteServiceScheduler.ts`
- Create: `src/adapters/openRouteServiceScheduler.test.ts`
- Modify: `src/adapters/openRouteService.ts`
- Modify: `src/adapters/openRouteService.test.ts`

**Interfaces:**
- Produces: `OpenRouteServiceError` with `status`, `code`, `providerMessage`, `coordinateIndex`, `profile`, and optional `retryAfterMs`.
- Produces: `openRouteServiceDirectionsScheduler.schedule(operation)` used by every directions request.
- Consumes later: `isOpenRouteServiceError(error)` in route recovery and auth handling.

- [ ] **Step 1: Write failing structured-error tests**

Mock a 404 response in `src/adapters/openRouteService.test.ts`:

```ts
fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
  error: {
    code: 2010,
    message: 'Could not find routable point within a radius of 350.0 meters of specified coordinate 1: 23.2 70.0.',
  },
}), { status: 404, headers: { 'Content-Type': 'application/json' } }));

await expect(calculateOpenRouteServiceRoute({ apiKey: 'key', origin, target }))
  .rejects.toMatchObject({
    name: 'OpenRouteServiceError',
    status: 404,
    code: 2010,
    coordinateIndex: 1,
    profile: 'driving-car',
  });
```

Add a 429 case with `Retry-After: 2` and assert `retryAfterMs: 2000`. Add a malformed non-JSON response case and assert the generic provider message remains useful.

- [ ] **Step 2: Write failing fake-clock scheduler tests**

In `src/adapters/openRouteServiceScheduler.test.ts`, inject `now` and `sleep`:

```ts
const clock = createFakeClock();
const scheduler = createOpenRouteServiceScheduler({
  maxRequests: 2,
  windowMs: 1_000,
  now: clock.now,
  sleep: clock.sleep,
});

await scheduler.schedule(async () => 'first');
await scheduler.schedule(async () => 'second');
const third = scheduler.schedule(async () => 'third');

expect(clock.sleeps).toEqual([1_000]);
await clock.advance(1_000);
await expect(third).resolves.toBe('third');
```

Add a test in which the operation first throws `OpenRouteServiceError` with status 429 and `retryAfterMs: 2_000`, then succeeds. Assert one delayed retry and no retry for 404, 401, or 403.

- [ ] **Step 3: Run focused tests and verify failure**

```bash
npm test -- src/adapters/openRouteServiceScheduler.test.ts src/adapters/openRouteService.test.ts
```

Expected: FAIL because the scheduler and structured error exports do not exist.

- [ ] **Step 4: Implement structured errors**

Export this stable contract from `src/adapters/openRouteService.ts`:

```ts
export class OpenRouteServiceError extends Error {
  readonly name = 'OpenRouteServiceError';
  readonly status: number;
  readonly code?: number;
  readonly providerMessage: string;
  readonly coordinateIndex?: number;
  readonly profile: OpenRouteServiceProfile;
  readonly retryAfterMs?: number;

  constructor(details: {
    status: number;
    code?: number;
    providerMessage: string;
    coordinateIndex?: number;
    profile: OpenRouteServiceProfile;
    retryAfterMs?: number;
  }) {
    super(`OpenRouteService route calculation failed (HTTP ${details.status}): ${details.providerMessage}`);
    this.status = details.status;
    this.code = details.code;
    this.providerMessage = details.providerMessage;
    this.coordinateIndex = details.coordinateIndex;
    this.profile = details.profile;
    this.retryAfterMs = details.retryAfterMs;
  }
}

export function isOpenRouteServiceError(error: unknown): error is OpenRouteServiceError {
  return error instanceof OpenRouteServiceError;
}
```

Parse the response body before throwing, extract `coordinateIndex` from `specified coordinate N`, and parse `Retry-After` as seconds or an HTTP date. Preserve the body message even when the response is not JSON.

- [ ] **Step 5: Implement and wire the scheduler**

Export:

```ts
export function createOpenRouteServiceScheduler(options?: {
  maxRequests?: number;
  windowMs?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}) {
  return {
    schedule<T>(operation: () => Promise<T>): Promise<T>,
  };
}

export const openRouteServiceDirectionsScheduler = createOpenRouteServiceScheduler({
  maxRequests: 40,
  windowMs: 60_000,
});
```

Serialize admission to the sliding window, discard timestamps at or before `now - windowMs`, and retry a 429 once after `max(retryAfterMs, nextWindowDelay)`. Wrap every `postDirections` fetch with `openRouteServiceDirectionsScheduler.schedule` so normal routes, provider alternatives, avoid-feature supplements, and later fallbacks share the same budget.

- [ ] **Step 6: Run tests and commit**

```bash
npm test -- src/adapters/openRouteServiceScheduler.test.ts src/adapters/openRouteService.test.ts
```

Expected: PASS.

```bash
git add src/adapters/openRouteService.ts src/adapters/openRouteService.test.ts src/adapters/openRouteServiceScheduler.ts src/adapters/openRouteServiceScheduler.test.ts
git commit -m "feat: classify and schedule route requests"
```

---

### Task 3: Validate Manifests Before Route Calculation

**Files:**
- Modify: `src/tripCommands/tripManifest.ts`
- Modify: `src/tripCommands/tripManifest.test.ts`
- Modify: `src/tripCommands/tripDataService.ts`
- Modify: `src/tripCommands/tripDataService.test.ts`

**Interfaces:**
- Produces: `prepareTripManifest(manifest, dependencies): Promise<PreparedTripManifest>` with resolved destinations, activities, pending route legs, routing vehicle, and change summary.
- Produces: `calculatePreparedTripManifestRoutes(prepared, calculateRoute): Promise<MaterializedTripManifest>`.
- Retains: `materializeTripManifest` as a composition of the two functions for callers/tests that need the complete operation.

- [ ] **Step 1: Write the failing no-route-on-audit-error test**

Strengthen the existing semantic-error case in `src/tripCommands/tripDataService.test.ts`:

```ts
expect(result).toMatchObject({
  ok: false,
  error: { code: 'TRIP_AUDIT_FAILED' },
});
expect(harness.calculateRoute).not.toHaveBeenCalled();
expect(harness.createTrip).not.toHaveBeenCalled();
expect(harness.replaceTripData).not.toHaveBeenCalled();
```

Add a valid-manifest assertion that `calculateRoute` is still called once per automatic adjacent leg after the pre-route audit passes.

- [ ] **Step 2: Run focused tests and verify failure**

```bash
npm test -- src/tripCommands/tripManifest.test.ts src/tripCommands/tripDataService.test.ts
```

Expected: FAIL because materialization calculates routes before the service audits activities.

- [ ] **Step 3: Split preparation from route calculation**

Create these exact exports in `tripManifest.ts`:

```ts
export type PreparedTripManifest = Omit<MaterializedTripManifest, 'routeLegs'> & {
  pendingRouteLegs: RouteLeg[];
};

export async function prepareTripManifest(
  manifest: TripManifestDraft,
  dependencies: Omit<TripManifestMaterializationDependencies, 'calculateRoute'>,
): Promise<PreparedTripManifest>;

export async function calculatePreparedTripManifestRoutes(
  prepared: PreparedTripManifest,
  calculateRoute: RouteCalculator | undefined,
): Promise<MaterializedTripManifest>;
```

Move place/link/activity/waypoint resolution and pending-leg creation into `prepareTripManifest`. Keep ORS calls exclusively in `calculatePreparedTripManifestRoutes`.

- [ ] **Step 4: Audit before the second phase**

In `createTrip`, use:

```ts
const prepared = await prepareTripManifest(manifest, dependencies);
const preRouteAudit = auditTripSnapshot({
  destinations: prepared.destinations,
  activities: prepared.activities,
  routeLegs: [],
});
const blockingIssues = preRouteAudit.issues.filter(
  (issue) => issue.code === 'ACTIVITY_DISTANCE_OUTLIER',
);
if (blockingIssues.length > 0) {
  return commandError('TRIP_AUDIT_FAILED', 'Trip manifest has semantic audit errors.', 'manifest', {
    audit: reportFromIssues(blockingIssues),
  });
}
const materialized = await calculatePreparedTripManifestRoutes(prepared, dependencies.calculateRoute);
```

Audit the completed route snapshot after calculation for the command response.

- [ ] **Step 5: Run tests and commit**

```bash
npm test -- src/tripCommands/tripManifest.test.ts src/tripCommands/tripDataService.test.ts
```

Expected: PASS.

```bash
git add src/tripCommands/tripManifest.ts src/tripCommands/tripManifest.test.ts src/tripCommands/tripDataService.ts src/tripCommands/tripDataService.test.ts
git commit -m "fix: validate trip data before routing"
```

---

### Task 4: Persist and Invalidate Profile-Specific Routing Anchors

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/domain/destinations.ts`
- Modify: `src/domain/destinations.test.ts`
- Modify: `src/storage/supabaseTripRepository.ts`
- Modify: `src/storage/supabaseTripRepository.test.ts`
- Modify: `src/storage/tripDb.ts`
- Modify: `src/storage/tripRepository.test.ts`

**Interfaces:**
- Produces: `RoutingAnchor`, `RoutingAnchorProfile`, and `Destination.routingAnchors`.
- Produces: `withRoutingAnchor(destination, anchor): Destination`.
- Guarantees: canonical coordinate changes clear every anchor; other destination edits preserve them.
- Produces: Dexie version 8 defaults for destinations stored before anchors existed.

- [ ] **Step 1: Write failing domain tests**

Add to `src/domain/destinations.test.ts`:

```ts
it('preserves routing anchors for non-location edits and clears them for coordinate edits', () => {
  const anchor = {
    profile: 'driving-car' as const,
    coordinates: { lat: 70.023071, lng: 23.254598 },
    originalCoordinates: { lat: 70.0154962, lng: 23.2185097 },
    snapDistanceKm: 1.609,
    provider: 'openrouteservice' as const,
    resolvedAt: '2026-07-11T12:00:00.000Z',
  };
  const destination = withRoutingAnchor(
    createDestination({ name: 'Alta', coordinates: anchor.originalCoordinates }),
    anchor,
  );

  expect(updateDestination(destination, { name: 'Alta buffer' }).routingAnchors['driving-car'])
    .toEqual(anchor);
  expect(updateDestination(destination, { coordinates: { lat: 70.1, lng: 23.3 } }).routingAnchors)
    .toEqual({});
});
```

- [ ] **Step 2: Write failing Supabase round-trip tests**

Add `routing_anchors` to the destination fixture row and assert:

```ts
expect(destinationToSupabaseRow(destination, tripId).routing_anchors).toEqual(destination.routingAnchors);
expect(destinationFromSupabaseRow(row).routingAnchors).toEqual(row.routing_anchors);
expect(destinationFromSupabaseRow({ ...row, routing_anchors: undefined }).routingAnchors).toEqual({});
```

- [ ] **Step 3: Run focused tests and verify failure**

```bash
npm test -- src/domain/destinations.test.ts src/storage/supabaseTripRepository.test.ts src/storage/tripRepository.test.ts
```

Expected: FAIL because routing-anchor fields and helpers do not exist.

- [ ] **Step 4: Add the domain contract**

Add:

```ts
export type RoutingAnchorProfile = TripRoutingVehicle['profile'];
export type RoutingAnchor = {
  profile: RoutingAnchorProfile;
  coordinates: Coordinates;
  originalCoordinates: Coordinates;
  snapDistanceKm: number;
  provider: 'openrouteservice';
  resolvedAt: string;
};

export type RoutingAnchors = Partial<Record<RoutingAnchorProfile, RoutingAnchor>>;
```

Add `routingAnchors: RoutingAnchors` to `Destination`, default it to `{}`, and implement:

```ts
export function withRoutingAnchor(destination: Destination, anchor: RoutingAnchor): Destination {
  return updateDestination(destination, {
    routingAnchors: { ...destination.routingAnchors, [anchor.profile]: anchor },
  });
}
```

In `updateDestination`, compare canonical coordinates and force `routingAnchors: {}` when either latitude or longitude changes.

- [ ] **Step 5: Add repository mappings**

Extend `SupabaseDestinationRow` with `routing_anchors?: Destination['routingAnchors']`, map it in both directions, and default missing local/Supabase values to `{}`. Do not put anchors into `route_context`.

Add Dexie version 8 using the same `currentStores` indexes:

```ts
db.version(8).stores(currentStores).upgrade(async (transaction) => {
  await transaction.table('destinations').toCollection().modify((destination) => {
    destination.routingAnchors ??= {};
  });
});
```

- [ ] **Step 6: Run tests and commit**

```bash
npm test -- src/domain/destinations.test.ts src/storage/supabaseTripRepository.test.ts src/storage/tripRepository.test.ts
```

Expected: PASS.

```bash
git add src/domain/types.ts src/domain/destinations.ts src/domain/destinations.test.ts src/storage/tripDb.ts src/storage/supabaseTripRepository.ts src/storage/supabaseTripRepository.test.ts src/storage/tripRepository.test.ts
git commit -m "feat: persist destination routing anchors"
```

---

### Task 5: Recover Routes and Return Anchor Updates as One Batch

**Files:**
- Create: `src/tripCommands/routeRecovery.ts`
- Create: `src/tripCommands/routeRecovery.test.ts`
- Modify: `src/adapters/openRouteService.ts`
- Modify: `src/adapters/openRouteService.test.ts`
- Modify: `src/tripCommands/routeOrchestration.ts`
- Modify: `src/tripCommands/routeOrchestration.test.ts`
- Modify: `src/tripCommands/tripManifest.ts`
- Modify: `src/tripCommands/tripDataService.ts`
- Modify: `src/hooks/useTripData.ts`
- Modify: `src/hooks/useTripData.test.tsx`

**Interfaces:**
- Produces: `calculateRouteWithRecovery(input, calculate): Promise<RecoveredRoute>`.
- Produces: `AutomaticRouteCalculationBatch = { routeLegs: RouteLeg[]; destinations: Destination[] }`.
- Consumes: structured ORS errors, saved destination anchors, vehicle preset, waypoints, and ferry policy.
- Guarantees: recovery warnings are informational and preserve `ready` metrics.

- [ ] **Step 1: Write the route-recovery policy tests**

Cover these exact cases in `routeRecovery.test.ts`:

```ts
it.each([
  { status: 401, code: undefined },
  { status: 403, code: undefined },
  { status: 500, code: undefined },
])('does not change profile for $status failures', async ({ status, code }) => {
  const calculate = vi.fn().mockRejectedValue(
    orsError({ status, code, profile: 'driving-hgv' }),
  );
  await expect(calculateRouteWithRecovery(expeditionInput, calculate)).rejects.toMatchObject({ status });
  expect(calculate).toHaveBeenCalledTimes(1);
});
```

Add:

- ORS 2010 on car retries with `radiuses: [2000, 2000]`, returns an Alta anchor 1.609 km away, and adds `ROUTING_ANCHOR_ADJUSTED`.
- An endpoint beyond 2 km is rejected.
- ORS 2009 on HGV retries with `driving-car`, preserves waypoints/ferry policy, and adds `VEHICLE_PROFILE_FALLBACK`.
- HGV 2010 tries HGV endpoint recovery first, then car fallback with endpoint recovery.
- Existing car/HGV anchors replace only their matching endpoint coordinates and avoid rediscovery.
- No car-to-HGV fallback exists.

- [ ] **Step 2: Write failing orchestration batch tests**

In `routeOrchestration.test.ts`, return a calculated route with:

```ts
warnings: [{
  code: 'ROUTING_ANCHOR_ADJUSTED',
  message: 'Alta uses a routing point 1.6 km from the stop.',
}],
endpointAnchors: { target: altaAnchor },
```

Assert:

```ts
expect(result.routeLegs[0]).toMatchObject({
  status: 'ready',
  distanceKm: 361,
  travelTimeHours: 5.4,
  warnings: [expect.objectContaining({ code: 'ROUTING_ANCHOR_ADJUSTED' })],
});
expect(result.destinations[1].routingAnchors['driving-car']).toEqual(altaAnchor);
```

- [ ] **Step 3: Run focused tests and verify failure**

```bash
npm test -- src/tripCommands/routeRecovery.test.ts src/tripCommands/routeOrchestration.test.ts src/adapters/openRouteService.test.ts
```

Expected: FAIL because recovery and batch contracts do not exist.

- [ ] **Step 4: Add ORS radius support**

Extend the internal directions request with:

```ts
type OpenRouteServiceRouteRequest = {
  profile: OpenRouteServiceProfile;
  radiuses?: number[];
};
```

Only include `radiuses` when endpoint recovery requests it. Derive an anchor from the returned geometry endpoint, calculate its haversine distance from the canonical endpoint, and reject distances over 2 km.

- [ ] **Step 5: Implement the recovery policy**

Define:

```ts
export type RecoveredRoute = CalculatedRoute & {
  warnings: RouteWarning[];
  endpointAnchors: { origin?: RoutingAnchor; target?: RoutingAnchor };
};

export type ProviderRouteRequest = CalculateRouteInput & {
  radiuses?: [number, number];
};

export type CalculateProviderRoute = (
  request: ProviderRouteRequest,
) => Promise<CalculatedRoute>;

export async function calculateRouteWithRecovery(
  input: CalculateRouteInput & {
    originAnchor?: RoutingAnchor;
    targetAnchor?: RoutingAnchor;
  },
  calculate: CalculateProviderRoute,
): Promise<RecoveredRoute>;
```

Use this order only:

1. requested profile with saved anchors;
2. same profile with a 2 km endpoint radius after ORS 2010;
3. `driving-car` after HGV 2009 or exhausted HGV 2010;
4. `driving-car` with a 2 km endpoint radius after car ORS 2010.

Propagate auth, daily quota, 429 after scheduler exhaustion, and unrelated errors without fallback.

- [ ] **Step 6: Change orchestration to return one immutable batch**

Export:

```ts
export type AutomaticRouteCalculationBatch = {
  routeLegs: RouteLeg[];
  destinations: Destination[];
};

export async function calculateAutomaticRouteLegs(input: {
  destinations: Destination[];
  routeLegs: RouteLeg[];
  routingVehicle: TripRoutingVehicle;
  calculateRoute?: CalculateProviderRoute;
  retryFailed?: boolean;
}): Promise<AutomaticRouteCalculationBatch>;
```

Apply `endpointAnchors.origin` and `.target` with `withRoutingAnchor`. Merge calculated warnings into the leg. Replace the current `warnings.length > 0` review rule with:

```ts
const informationalCodes = new Set([
  'ROUTING_ANCHOR_ADJUSTED',
  'VEHICLE_PROFILE_FALLBACK',
]);
const reviewRequired = preserveUnresolvedReview || warnings.some(
  (warning) => !informationalCodes.has(warning.code),
);
```

Keep distance/time for informational warnings; retain the current metric removal for genuine `review-required` results.

- [ ] **Step 7: Update every production caller atomically**

In `tripManifest`, `tripDataService`, and `useTripData`, consume both fields:

```ts
const calculation = await calculateAutomaticRouteLegs({
  destinations,
  routeLegs,
  routingVehicle: trip.routingVehicle,
  calculateRoute: dependencies.calculateRoute,
  retryFailed: true,
});
const destinationsToSave = calculation.destinations.filter(
  (destination, index) => destination !== destinations[index],
);
const routeLegsToSave = calculation.routeLegs.filter(
  (routeLeg, index) => routeLeg !== routeLegs[index],
);
await Promise.all([
  ...destinationsToSave.map((destination) => repository.saveDestination(destination)),
  ...routeLegsToSave.map((routeLeg) => repository.saveRouteLeg(routeLeg)),
]);
```

For manifest bulk replacement, use `calculation.destinations` and `calculation.routeLegs` in the single `replaceTripData` call. Ensure manual insertion, reorder, vehicle change, route edit, and failed-route recalculation all use the batch result.

- [ ] **Step 8: Run focused integration tests and commit**

```bash
npm test -- src/tripCommands/routeRecovery.test.ts src/tripCommands/routeOrchestration.test.ts src/tripCommands/tripManifest.test.ts src/tripCommands/tripDataService.test.ts src/hooks/useTripData.test.tsx src/adapters/openRouteService.test.ts
```

Expected: PASS.

```bash
git add src/tripCommands/routeRecovery.ts src/tripCommands/routeRecovery.test.ts src/adapters/openRouteService.ts src/adapters/openRouteService.test.ts src/tripCommands/routeOrchestration.ts src/tripCommands/routeOrchestration.test.ts src/tripCommands/tripManifest.ts src/tripCommands/tripDataService.ts src/hooks/useTripData.ts src/hooks/useTripData.test.tsx
git commit -m "feat: recover automatic route failures"
```

---

### Task 6: Extend Route Alternatives With Recovery Provenance

**Files:**
- Modify: `src/domain/routeOptions.ts`
- Modify: `src/domain/routeOptions.test.ts`
- Modify: `src/adapters/openRouteService.ts`
- Modify: `src/adapters/openRouteService.test.ts`
- Modify: `src/components/RouteAlternativesPanel.tsx`
- Modify: `src/components/RouteAlternativesPanel.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

**Interfaces:**
- Produces: route option sources `adjusted-endpoint` and `profile-fallback`.
- Produces: `RouteOption.warnings` and `RouteOption.endpointAnchors`.
- Guarantees: selecting a recovery option persists both the route result and its destination anchors under the existing fingerprint guard.

- [ ] **Step 1: Write failing route-option tests**

Add this shape to `routeOptions.test.ts`:

```ts
const fallback = routeOptionFromCalculation({
  id: 'profile-fallback',
  label: 'Car-profile fallback',
  source: 'profile-fallback',
  origin,
  target,
  distanceKm: 187,
  travelTimeHours: 3.27,
  geometry,
  sections: [{
    kind: 'road',
    startGeometryIndex: 0,
    endGeometryIndex: geometry.coordinates.length - 1,
    distanceKm: 187,
  }],
  provider: 'openrouteservice',
  profile: 'driving-car',
  routingVehicle: expeditionTruck,
  waypoints: [],
  ferryPolicy: 'allow',
  providerOptions: { fallbackFromProfile: 'driving-hgv' },
  variant: 'profile-fallback',
  warnings: [{
    code: 'VEHICLE_PROFILE_FALLBACK',
    message: 'Truck dimensions were not validated for this route.',
  }],
  endpointAnchors: {},
});

expect(routeLegPatchFromRouteOption(fallback)).toMatchObject({
  status: 'ready',
  warnings: fallback.warnings,
  profile: 'driving-car',
  distanceKm: fallback.distanceKm,
});
```

Also assert deduplication retains recovery provenance when geometry matches a less informative normal option by ranking `recommended`, `adjusted-endpoint`, and `profile-fallback` according to the actual current route source rather than dropping warnings.

- [ ] **Step 2: Write failing panel and App tests**

In `RouteAlternativesPanel.test.tsx`, render both new sources and assert visible copy:

```ts
expect(screen.getByText('Adjusted endpoint')).toBeVisible();
expect(screen.getByText('Uses a nearby routable road point for Alta.')).toBeVisible();
expect(screen.getByText('Car-profile fallback')).toBeVisible();
expect(screen.getByText('Truck dimensions were not validated.')).toBeVisible();
```

In `App.test.tsx`, select a fallback option and assert `applyValidatedRouteLegResult` receives a ready route with metrics/warnings and the origin/target destination updates are saved only when the route fingerprint is still current.

- [ ] **Step 3: Run focused tests and verify failure**

```bash
npm test -- src/domain/routeOptions.test.ts src/components/RouteAlternativesPanel.test.tsx src/App.test.tsx
```

Expected: FAIL because recovery option metadata is not represented or rendered.

- [ ] **Step 4: Extend the route option contract**

Use:

```ts
export type RouteOptionSource =
  | 'recommended'
  | 'provider-alternative'
  | 'avoid-feature'
  | 'adjusted-endpoint'
  | 'profile-fallback';

export type RouteOption = {
  id: string;
  label: string;
  source: RouteOptionSource;
  distanceKm: number;
  travelTimeHours: number;
  geometry: LineString;
  sections: RouteSection[];
  provider: string;
  profile: string;
  routeKey: string;
  warnings: RouteWarning[];
  endpointAnchors: { origin?: RoutingAnchor; target?: RoutingAnchor };
};
```

Include warning codes, actual profile, anchor coordinates, and recovery variant in the route option key so a recovered choice cannot collide with a strict-profile result.

- [ ] **Step 5: Generate and display recovery options**

Make `calculateOpenRouteServiceRouteOptions` include the current recovered route as its first option when supplied. If the primary option request fails with recoverable 2009/2010, call the same recovery policy as Task 5 and return only real provider geometry.

Render a short qualification below recovery option metrics. Keep normal route labels and current loading/error/empty behavior unchanged.

- [ ] **Step 6: Persist selection with anchors**

Extend the existing selected-option application so one guarded operation persists:

- the validated route leg;
- any changed origin destination;
- any changed target destination.

If the fingerprint changes while saving, persist none of them and retain the existing `Route intent changed. Recalculate route options.` error.

- [ ] **Step 7: Run tests and commit**

```bash
npm test -- src/domain/routeOptions.test.ts src/adapters/openRouteService.test.ts src/components/RouteAlternativesPanel.test.tsx src/App.test.tsx src/hooks/useTripData.test.tsx
```

Expected: PASS.

```bash
git add src/domain/routeOptions.ts src/domain/routeOptions.test.ts src/adapters/openRouteService.ts src/adapters/openRouteService.test.ts src/components/RouteAlternativesPanel.tsx src/components/RouteAlternativesPanel.test.tsx src/App.tsx src/App.test.tsx src/hooks/useTripData.ts src/hooks/useTripData.test.tsx
git commit -m "feat: show route recovery alternatives"
```

---

### Task 7: Show Ready-Route Warnings and Improve CLI Diagnostics

**Files:**
- Modify: `src/components/ItineraryPanel.tsx`
- Modify: `src/components/ItineraryPanel.test.tsx`
- Modify: `src/styles.css`
- Modify: `src/styles.test.ts`
- Modify: `src/tripCommands/tripAudit.ts`
- Modify: `src/tripCommands/tripAudit.test.ts`
- Modify: `src/cli/tripCli.test.ts`

**Interfaces:**
- Consumes: informational recovery warnings on ready route legs.
- Produces: warning indicator/tooltip without removing route metrics.
- Produces: audit warnings `ROUTING_ANCHOR_ADJUSTED` and `VEHICLE_PROFILE_FALLBACK` with endpoint context.

- [ ] **Step 1: Re-read and preserve the active itinerary diff**

Before editing, run:

```bash
git diff -- src/components/ItineraryPanel.tsx src/components/ItineraryPanel.test.tsx src/styles.css src/styles.test.ts
```

Treat the current pencil/type/rail layout as the baseline. Do not reset, overwrite, or reformat unrelated hunks.

- [ ] **Step 2: Write failing itinerary tests**

Add a ready route fixture with distance, duration, and `VEHICLE_PROFILE_FALLBACK`. Assert:

```ts
expect(screen.getByText('124 mi')).toBeVisible();
expect(screen.getByText('3.2 hr')).toBeVisible();
expect(screen.getByRole('img', {
  name: 'Car-profile fallback: truck dimensions were not validated.',
})).toBeVisible();
expect(screen.queryByRole('button', { name: /Retry .* route calculation/ })).not.toBeInTheDocument();
```

Add an adjusted-endpoint case with its specific tooltip. Assert both routes contribute to the total travel time.

- [ ] **Step 3: Write failing audit tests**

For a ready recovered route, assert `auditTripSnapshot` returns warnings with the route leg ID plus origin and target contexts:

```ts
expect(report.issues).toContainEqual(expect.objectContaining({
  severity: 'warning',
  code: 'VEHICLE_PROFILE_FALLBACK',
  routeLegId: 'fallback-leg',
  origin: expect.objectContaining({ name: 'Lillehammer' }),
  target: expect.objectContaining({ name: 'Oslo' }),
}));
```

- [ ] **Step 4: Run focused tests and verify failure**

```bash
npm test -- src/components/ItineraryPanel.test.tsx src/styles.test.ts src/tripCommands/tripAudit.test.ts src/cli/tripCli.test.ts
```

Expected: FAIL because ready warnings are not shown or audited.

- [ ] **Step 5: Render and audit informational warnings**

Derive the route-row warning from `routeLeg.warnings` as well as status. Keep the current alert icon and icon-first row layout. Do not hide distance or duration for ready warnings.

Extend `TripAuditIssue['code']` with both recovery codes and emit one warning per recovery qualification. CLI `audit` and `--summary` already carry audit issues; assert no new command or agent decision is required.

- [ ] **Step 6: Run tests and commit only integrated UI/diagnostic changes**

```bash
npm test -- src/components/ItineraryPanel.test.tsx src/styles.test.ts src/tripCommands/tripAudit.test.ts src/cli/tripCli.test.ts
```

Expected: PASS.

Stage only the intended hunks after confirming they include, rather than erase, the pre-existing UI work:

```bash
git add src/components/ItineraryPanel.tsx src/components/ItineraryPanel.test.tsx src/styles.css src/styles.test.ts src/tripCommands/tripAudit.ts src/tripCommands/tripAudit.test.ts src/cli/tripCli.test.ts
git diff --cached --check
git commit -m "feat: surface recovered route warnings"
```

---

### Task 8: Align Skills, Documentation, Realtime Coverage, and End-to-End Behavior

**Files:**
- Modify: `docs/agent-guides/plotter-route-research/README.md`
- Modify: `docs/agent-guides/plotter-route-research/schema-reference.md`
- Modify: `docs/agent-guides/plotter-trip-data/README.md`
- Modify: `docs/agent-guides/plotter-trip-data/cli-reference.md`
- Modify: `~/.codex/skills/plotter-route-research/SKILL.md`
- Modify: `~/.codex/skills/plotter-route-research/references/schema-reference.md`
- Modify: `~/.codex/skills/plotter-trip-data/SKILL.md`
- Modify: `~/.codex/skills/plotter-trip-data/references/cli-reference.md`
- Modify: `src/storage/tripRealtime.test.ts`
- Modify: `tests/world-tour.spec.ts`

**Interfaces:**
- Documents: ordinary-language vehicle mapping and app-owned recovery.
- Verifies: realtime destination-anchor refresh and route warning refresh.
- Verifies: manual stop insertion produces a recovered ready route without skill involvement.

- [ ] **Step 1: Use the writing-skills verification workflow**

Read `~/.codex/plugins/cache/openai-curated-remote/superpowers/6.1.1/skills/writing-skills/SKILL.md` before editing skill files. Keep repository guides and installed copies semantically identical.

- [ ] **Step 2: Add failing realtime and E2E tests**

In `tripRealtime.test.ts`, publish a destination update containing `routingAnchors` and a route-leg update containing a recovery warning; assert one debounced refresh reaches the app subscriber.

In `tests/world-tour.spec.ts`, use mocked ORS responses under `VITE_TRIP_STORAGE=e2e-local`:

1. create two stops through the normal UI;
2. make the first route response an ORS 2010 endpoint error;
3. return a successful expanded-radius route;
4. assert the route row shows metrics and the adjusted-endpoint warning;
5. click the pencil button and assert `Adjusted endpoint` appears in the alternatives panel;
6. reload and assert the route and warning survive local persistence.

- [ ] **Step 3: Run targeted tests and verify failure**

```bash
npm test -- src/storage/tripRealtime.test.ts
npm run test:e2e -- tests/world-tour.spec.ts
```

Expected: FAIL until recovery fields and fixtures are wired through realtime and the browser flow.

- [ ] **Step 4: Update repository and installed skill contracts**

Add these exact rules to route research:

```md
- Infer `large-camper` for a car and caravan, campervan, or large motorhome; it uses ordinary car routing in the app.
- Reserve `expedition-truck` for a genuine heavy truck.
- Never add stops, waypoints, manual shipping, or geometry to work around an automatic route-provider failure.
```

Add these exact rules to trip data:

```md
- Copy the approved vehicle preset without changing it.
- Treat routing anchors, profile fallback, provider retries, geometry, and recovery warnings as app-owned data.
- A ready route may include `ROUTING_ANCHOR_ADJUSTED` or `VEHICLE_PROFILE_FALLBACK`; report the qualification but do not replan or rewrite the route.
```

Update CLI references to explain that `recalculate-failed-routes` retries transient errors internally and reports stable failures with structured diagnostics.

- [ ] **Step 5: Run complete verification**

Run in this order:

```bash
npm run lint
npm test
npm run build
npm run test:e2e
```

Expected: all commands exit 0. Confirm E2E uses the disposable server on `127.0.0.1:5174` and leaves no server session running.

- [ ] **Step 6: Perform the Nordkapp regression readback**

Use mocked unit fixtures, not the live API, to assert:

- Alta car routing recovers at 1.609 km and reuses one anchor on inbound/outbound legs;
- Lillehammer to Oslo uses `driving-car` for `large-camper` with no HGV fallback warning;
- an expedition-truck 2009 response produces a ready car fallback with the warning and metrics;
- a 41-stop-equivalent request batch does not exceed 40 starts inside any rolling 60-second test window.

- [ ] **Step 7: Commit documentation and verification changes**

```bash
git add docs/agent-guides/plotter-route-research docs/agent-guides/plotter-trip-data src/storage/tripRealtime.test.ts tests/world-tour.spec.ts
git diff --cached --check
git commit -m "test: cover route recovery workflow"
```

Installed skill files live outside the repository and are intentionally not staged. Verify their content separately with `diff -u` against the corresponding repository guide/reference sections.

---

## Final Review Checklist

- [ ] `git status --short` contains no accidental files and preserves unrelated user changes.
- [ ] Every ORS directions path uses the shared scheduler.
- [ ] Every production `calculateAutomaticRouteLegs` caller persists both route legs and destination anchors.
- [ ] No auth, quota, or generic provider error triggers profile fallback.
- [ ] No recovered ready route loses distance or duration.
- [ ] `review-required` behavior for unresolved intent remains unchanged.
- [ ] Route alternatives persist warnings, actual profile, route key, and anchors under one stale-result guard.
- [ ] Repository and installed skill copies agree on vehicle mapping and app ownership.
- [ ] Supabase migration preserves large-camper restrictions and manual vehicle-shipping legs.
- [ ] `npm run lint`, `npm test`, `npm run build`, and `npm run test:e2e` all pass.
