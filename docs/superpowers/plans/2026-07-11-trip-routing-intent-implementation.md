# Trip Routing Intent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add trip-level vehicle presets and app-calculated waypoint and ferry intent to every UI and CLI route workflow without exposing routine routing complexity to users.

**Architecture:** Extend the shared trip and route domain first, then make local and Supabase storage persist the same contract. OpenRouteService remains the sole automatic geometry provider; UI and CLI mutations both call the same orchestration and reconciliation functions. The research skill authors exceptional intent, the trip-data skill writes it, and the app owns defaults, calculation, diagnostics, persistence, and realtime display.

**Tech Stack:** TypeScript, React, Vitest, Testing Library, Dexie, Supabase/PostgreSQL, OpenRouteService, MapLibre GL, Playwright, Markdown skill guides.

## Global Constraints

- Stops are ordered overnight stays; waypoints never become stops or activities.
- One trip-level preset applies to every leg: `standard`, `large-camper`, or `expedition-truck`.
- OpenRouteService calculates every automatic geometry, metric, and ferry section.
- Ordinary legs default to `drive + automatic + allow` with no waypoints.
- Ordinary ferries remain automatic; `vehicle-shipping + manual` is only for genuine discontinuities.
- Agents never write geometry, metrics, provider fields, sections, warnings, statuses, or route keys.
- Valid trip content persists when an affected route fails or requires review.
- UI and CLI stop mutations use the same reconciliation and calculation code.
- Realtime trip metadata and route-state refresh is required in v1.
- Do not add per-leg vehicles, custom dimensions, a waypoint editor, a ferry settings UI, public transport, or a multimodal graph.
- Keep normal and `VITE_TRIP_STORAGE=e2e-local` storage isolated.

---

### Task 1: Add Vehicle Presets And Route Intent Types

**Files:**
- Create: `src/domain/vehiclePresets.ts`
- Create: `src/domain/vehiclePresets.test.ts`
- Modify: `src/domain/types.ts`
- Modify: `src/domain/routeLegs.ts`
- Modify: `src/domain/routeLegs.test.ts`

**Interfaces:**
- Produces: `VehiclePreset`, `TripRoutingVehicle`, `RouteMovement`, `RouteCalculationMode`, `FerryPolicy`, `RouteWaypoint`, `RouteSection`, `RouteWarning`, and `RouteIntentSnapshot`.
- Produces: `resolveVehiclePreset(preset: VehiclePreset): TripRoutingVehicle` and `standardRoutingVehicle`.
- Produces: `createRouteKey` including vehicle snapshot, ordered waypoint coordinates, ferry policy, endpoints, and optional variant.
- Preserves: legacy `RouteLeg.type` only as a transitional field until Task 10.

- [ ] **Step 1: Write failing preset and route-key tests**

```ts
it('resolves the approved expedition truck snapshot', () => {
  expect(resolveVehiclePreset('expedition-truck')).toEqual({
    preset: 'expedition-truck',
    profile: 'driving-hgv',
    vehicleType: 'hgv',
    restrictions: { length: 9, width: 2.55, height: 3.8, weight: 15, axleLoad: 7.5 },
  });
});

it('keys vehicle, waypoint and ferry intent', () => {
  expect(createRouteKey(base)).not.toBe(createRouteKey({
    ...base,
    routingVehicle: resolveVehiclePreset('expedition-truck'),
  }));
  expect(createRouteKey(base)).not.toBe(createRouteKey({
    ...base,
    waypoints: [{ lat: 57.5948, lng: 9.9796 }],
  }));
  expect(createRouteKey(base)).not.toBe(createRouteKey({ ...base, ferryPolicy: 'avoid' }));
});
```

- [ ] **Step 2: Verify the tests fail**

Run: `npm test -- src/domain/vehiclePresets.test.ts src/domain/routeLegs.test.ts`

Expected: FAIL because the resolver and expanded key do not exist.

- [ ] **Step 3: Implement the preset map and route defaults**

```ts
const presets: Record<VehiclePreset, TripRoutingVehicle> = {
  standard: { preset: 'standard', profile: 'driving-car', restrictions: {} },
  'large-camper': {
    preset: 'large-camper', profile: 'driving-hgv', vehicleType: 'hgv',
    restrictions: { length: 7.5, width: 2.5, height: 3.2, weight: 5, axleLoad: 3 },
  },
  'expedition-truck': {
    preset: 'expedition-truck', profile: 'driving-hgv', vehicleType: 'hgv',
    restrictions: { length: 9, width: 2.55, height: 3.8, weight: 15, axleLoad: 7.5 },
  },
};

export function resolveVehiclePreset(preset: VehiclePreset): TripRoutingVehicle {
  return structuredClone(presets[preset]);
}
```

Make `createRouteLeg` default to `drive + automatic + allow`, with empty waypoints, sections, and warnings. Make manual construction use `vehicle-shipping + manual`.

- [ ] **Step 4: Verify and commit**

Run: `npm test -- src/domain/vehiclePresets.test.ts src/domain/routeLegs.test.ts && npm run build`

Expected: PASS.

```bash
git add src/domain/types.ts src/domain/vehiclePresets.ts src/domain/vehiclePresets.test.ts src/domain/routeLegs.ts src/domain/routeLegs.test.ts
git commit -m "feat: add trip routing intent model"
```

---

### Task 2: Persist Vehicle Snapshots And Route Intent

**Files:**
- Create: `supabase/migrations/20260711120000_add_trip_routing_intent.sql`
- Modify: `src/storage/tripDb.ts`
- Modify: `src/storage/tripDirectoryRepository.ts`
- Modify: `src/storage/tripRepository.ts`
- Modify: `src/storage/tripRepository.test.ts`
- Modify: `src/storage/supabaseTripRepository.ts`
- Modify: `src/storage/supabaseTripRepository.test.ts`
- Modify: `src/hooks/useTripWorkspace.test.tsx`

**Interfaces:**
- Consumes: Task 1 types and preset resolver.
- Produces: `TripSummary.routingVehicle`, `createTrip({ name, routingVehicle? })`, and `updateTrip(tripId, { name?, description?, routingVehicle? })`.
- Persists: movement, calculation, ferry policy, waypoints, sections, warnings, and `review-required`.

- [ ] **Step 1: Write failing repository tests**

```ts
it('defaults a new local trip to standard', async () => {
  const trip = await directory.createTrip({ name: 'Manual trip' });
  expect(trip.routingVehicle).toEqual(resolveVehiclePreset('standard'));
});

it('round-trips route intent through Supabase mapping', () => {
  const row = routeLegToSupabaseRow(routeLeg, 'trip-1');
  expect(row).toMatchObject({
    movement: 'drive', calculation_mode: 'automatic', ferry_policy: 'require',
    waypoints: routeLeg.waypoints, sections: routeLeg.sections, warnings: routeLeg.warnings,
  });
  expect(routeLegFromSupabaseRow(row)).toEqual(routeLeg);
});
```

- [ ] **Step 2: Verify storage tests fail**

Run: `npm test -- src/storage/tripRepository.test.ts src/storage/supabaseTripRepository.test.ts src/hooks/useTripWorkspace.test.tsx`

Expected: FAIL because repositories omit the new fields.

- [ ] **Step 3: Add the additive Supabase migration**

```sql
alter table public.trips
  add column vehicle_preset text not null default 'standard'
    check (vehicle_preset in ('standard', 'large-camper', 'expedition-truck')),
  add column vehicle_profile text not null default 'driving-car'
    check (vehicle_profile in ('driving-car', 'driving-hgv')),
  add column vehicle_type text null check (vehicle_type is null or vehicle_type = 'hgv'),
  add column vehicle_restrictions jsonb not null default '{}'::jsonb;

alter table public.route_legs
  add column movement text not null default 'drive'
    check (movement in ('drive', 'vehicle-shipping')),
  add column calculation_mode text not null default 'automatic'
    check (calculation_mode in ('automatic', 'manual')),
  add column ferry_policy text not null default 'allow'
    check (ferry_policy in ('allow', 'avoid', 'require')),
  add column waypoints jsonb not null default '[]'::jsonb,
  add column sections jsonb not null default '[]'::jsonb,
  add column warnings jsonb not null default '[]'::jsonb;

update public.route_legs
set movement = case when type = 'shipping-manual' then 'vehicle-shipping' else 'drive' end,
    calculation_mode = case when type = 'shipping-manual' then 'manual' else 'automatic' end;

alter table public.route_legs drop constraint route_legs_status_check;
alter table public.route_legs add constraint route_legs_status_check
  check (status in ('pending', 'calculating', 'ready', 'failed', 'manual', 'review-required'));
```

- [ ] **Step 4: Add Dexie v6 and repository mappings**

```ts
db.version(6).stores({
  trips: 'id, name, updatedAt, createdAt',
  destinations: 'id, tripId, [tripId+order], name, countryRegion, status, priority, updatedAt',
  routeLegs: 'id, tripId, [tripId+updatedAt], originDestinationId, targetDestinationId, movement, calculation, status, routeKey, updatedAt',
  activities: 'id, tripId, [tripId+destinationId], [tripId+destinationId+order], title, status, priority, updatedAt',
  activityMedia: 'id, tripId, [tripId+activityId], [tripId+destinationId], sortOrder, uploadedAt',
}).upgrade(async (transaction) => {
  await transaction.table('trips').toCollection().modify((trip) => {
    trip.routingVehicle ??= resolveVehiclePreset('standard');
  });
});
```

Map all new Supabase columns in both directions and normalize missing local route fields. Keep legacy type reads during transition.

- [ ] **Step 5: Verify and commit**

Run: `npm test -- src/storage/tripRepository.test.ts src/storage/supabaseTripRepository.test.ts src/hooks/useTripWorkspace.test.tsx && npm run build`

Expected: PASS.

```bash
git add supabase/migrations/20260711120000_add_trip_routing_intent.sql src/storage/tripDb.ts src/storage/tripDirectoryRepository.ts src/storage/tripRepository.ts src/storage/tripRepository.test.ts src/storage/supabaseTripRepository.ts src/storage/supabaseTripRepository.test.ts src/hooks/useTripWorkspace.test.tsx
git commit -m "feat: persist trip routing intent"
```

---

### Task 3: Extend OpenRouteService And Parse Ferry Sections

**Files:**
- Modify: `src/adapters/openRouteService.ts`
- Modify: `src/adapters/openRouteService.test.ts`
- Modify: `src/domain/routeOptions.ts`
- Modify: `src/domain/routeOptions.test.ts`

**Interfaces:**
- Consumes: vehicle, waypoint, ferry policy, and section types.
- Produces: provider inputs with `routingVehicle`, `waypoints`, and `ferryPolicy`.
- Produces: calculations and options containing normalized `sections`.

- [ ] **Step 1: Write failing request and parsing tests**

```ts
it('sends HGV restrictions, ordered coordinates and waycategory', async () => {
  await calculateOpenRouteServiceRoute({
    apiKey: 'key', origin, target,
    routingVehicle: resolveVehiclePreset('expedition-truck'),
    ferryPolicy: 'require', waypoints: [{ coordinates: hirtshals }],
  });
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/driving-hgv/geojson'),
    expect.objectContaining({ body: expect.stringContaining('"extra_info":["waycategory"]') }));
});

it('maps waycategory 8 to a ferry section', async () => {
  expect((await calculateOpenRouteServiceRoute(input)).sections).toContainEqual({
    kind: 'ferry', startGeometryIndex: 4, endGeometryIndex: 9, distanceKm: 135.1,
  });
});
```

- [ ] **Step 2: Verify adapter tests fail**

Run: `npm test -- src/adapters/openRouteService.test.ts src/domain/routeOptions.test.ts`

Expected: FAIL because only `driving-car` endpoints are supported.

- [ ] **Step 3: Implement request construction and extras parsing**

```ts
function buildRoutingOptions(vehicle: TripRoutingVehicle, ferryPolicy: FerryPolicy) {
  const options: Record<string, unknown> = {};
  if (ferryPolicy === 'avoid') options.avoid_features = ['ferries'];
  if (vehicle.profile === 'driving-hgv') {
    options.vehicle_type = vehicle.vehicleType;
    options.profile_params = { restrictions: toOrsRestrictions(vehicle.restrictions) };
  }
  return Object.keys(options).length ? options : undefined;
}
```

Build coordinates as origin, ordered waypoints, target. Map `axleLoad` to ORS `axleload`. Parse `extras.waycategory.values`; value `8` is ferry. Fill remaining geometry ranges with road sections.

- [ ] **Step 4: Make alternatives inherit intent**

Pass the same vehicle, waypoints, and policy into provider and supplemental option requests. Do not offer `Avoid ferries` when policy is `require`. Include sections in `RouteOption` and preserve them when applying an option.

- [ ] **Step 5: Verify and commit**

Run: `npm test -- src/adapters/openRouteService.test.ts src/domain/routeOptions.test.ts && npm run build`

Expected: PASS.

```bash
git add src/adapters/openRouteService.ts src/adapters/openRouteService.test.ts src/domain/routeOptions.ts src/domain/routeOptions.test.ts
git commit -m "feat: route with vehicles waypoints and ferries"
```

---

### Task 4: Apply Intent And Diagnostics In Shared Orchestration

**Files:**
- Modify: `src/tripCommands/types.ts`
- Modify: `src/tripCommands/routeOrchestration.ts`
- Modify: `src/tripCommands/routeOrchestration.test.ts`
- Modify: `src/tripCommands/tripAudit.ts`
- Modify: `src/tripCommands/tripAudit.test.ts`

**Interfaces:**
- Produces: `calculateAutomaticRouteLegs` with trip vehicle and explicit intent.
- Produces: `recalculateAutomaticRouteLegsForVehicle` for UI and CLI.
- Produces: ferry contradiction failures and suspicious-detour review status.

- [ ] **Step 1: Write failing ferry and detour tests**

```ts
it('fails require when no ferry section returns', async () => {
  const [result] = await calculateAutomaticRouteLegs({
    destinations, routeLegs: [{ ...leg, ferryPolicy: 'require' }],
    routingVehicle: resolveVehiclePreset('standard'),
    calculateRoute: async () => roadOnlyCalculation,
  });
  expect(result).toMatchObject({ status: 'failed', geometry: undefined });
});

it('marks the Bremen to Hirtshals defect for review', async () => {
  const [result] = await calculateAutomaticRouteLegs({
    destinations: [bremen, hirtshals], routeLegs: [leg],
    routingVehicle: resolveVehiclePreset('standard'),
    calculateRoute: async () => ({ ...calculation, distanceKm: 1372.6 }),
  });
  expect(result.status).toBe('review-required');
  expect(result.warnings[0]?.code).toBe('SUSPICIOUS_DETOUR');
});
```

- [ ] **Step 2: Verify focused tests fail**

Run: `npm test -- src/tripCommands/routeOrchestration.test.ts src/tripCommands/tripAudit.test.ts`

Expected: FAIL because routing is hard-coded and detours require a four-times ratio.

- [ ] **Step 3: Implement calculation and validation**

Pass ordered waypoints, ferry policy, and trip vehicle to the provider. Clear stale calculated fields before retries. A ferry contradiction sets `failed` and removes geometry and metrics. The detour rule is `route > direct * 2 && route - direct >= 500`; it sets `review-required`, retains warning-styled candidate geometry, and excludes metrics from totals.

```ts
function ferryIntentError(policy: FerryPolicy, sections: RouteSection[]) {
  const hasFerry = sections.some((section) => section.kind === 'ferry');
  if (policy === 'require' && !hasFerry) return 'FERRY_REQUIRED_NOT_FOUND';
  if (policy === 'avoid' && hasFerry) return 'FERRY_AVOIDED_BUT_FOUND';
  return null;
}
```

- [ ] **Step 4: Update preservation, vehicle recalculation, and audit**

Replace car-only preservation with `hasPreservableAutomaticRouteData`. A vehicle change makes every automatic drive pending with a new key and preserves manual shipping. Add audit codes for ferry contradictions and suspicious detours with endpoint context.

- [ ] **Step 5: Verify and commit**

Run: `npm test -- src/tripCommands/routeOrchestration.test.ts src/tripCommands/tripAudit.test.ts && npm run build`

Expected: PASS.

```bash
git add src/tripCommands/types.ts src/tripCommands/routeOrchestration.ts src/tripCommands/routeOrchestration.test.ts src/tripCommands/tripAudit.ts src/tripCommands/tripAudit.test.ts
git commit -m "feat: validate calculated route intent"
```

---

### Task 5: Preserve Intent During Stop Reconciliation

**Files:**
- Modify: `src/domain/routePlanner.ts`
- Modify: `src/domain/routePlanner.test.ts`
- Modify: `src/hooks/useTripData.ts`
- Modify: `src/hooks/useTripData.test.tsx`
- Modify: `src/tripCommands/tripDataService.ts`
- Modify: `src/tripCommands/tripDataService.test.ts`

**Interfaces:**
- Produces: pure `planRouteLegReconciliation({ destinations, currentRouteLegs, routingVehicle })` preflight.
- Produces: one constrained-split implementation shared by UI and CLI.

- [ ] **Step 1: Write failing reconciliation tests**

```ts
it('creates two automatic trip-vehicle legs after an ordinary insertion', () => {
  const result = planRouteLegReconciliation({
    destinations: [bremen, hirtshals, kristiansand],
    currentRouteLegs: [bremenToKristiansand],
    routingVehicle: resolveVehiclePreset('expedition-truck'),
  });
  expect(result.routeLegs).toHaveLength(2);
  expect(result.routeLegs.every((leg) => leg.calculation === 'automatic')).toBe(true);
});

it('rejects splitting manual vehicle shipping before saving', async () => {
  await expect(actions.addDestination(input)).rejects.toThrow('Resolve vehicle shipping before inserting a stop');
  expect(repository.saveDestination).not.toHaveBeenCalled();
});

it('partitions waypoints and keeps require with the ferry section', () => {
  const result = planRouteLegReconciliation({
    destinations: [origin, insertedStop, target],
    currentRouteLegs: [constrainedReadyLeg],
    routingVehicle: resolveVehiclePreset('standard'),
  });
  expect(result.routeLegs[0].waypoints.map((item) => item.name)).toEqual(['Before stop']);
  expect(result.routeLegs[1]).toMatchObject({
    ferryPolicy: 'require',
    waypoints: [expect.objectContaining({ name: 'Ferry terminal' })],
  });
});
```

- [ ] **Step 2: Verify planner, hook, and service tests fail**

Run: `npm test -- src/domain/routePlanner.test.ts src/hooks/useTripData.test.tsx src/tripCommands/tripDataService.test.ts`

Expected: FAIL because current reconciliation creates car legs after persistence.

- [ ] **Step 3: Implement pure preflight and partitioning**

```ts
function nearestGeometryIndex(geometry: LineString, coordinates: Coordinates) {
  return geometry.coordinates.reduce((best, [lng, lat], index) => {
    const distance = coordinateDistanceKm(coordinates, { lat, lng });
    return distance < best.distance ? { index, distance } : best;
  }, { index: 0, distance: Number.POSITIVE_INFINITY }).index;
}
```

Project the inserted stop and waypoints onto ready geometry, preserve waypoint order, copy `avoid` to both sides, and place `require` with the ferry section midpoint. If automatic reassignment is ambiguous, create default replacement legs marked `review-required`; attach one `ROUTE_INTENT_REASSIGNMENT_REQUIRED` warning whose `context` contains `sourceRouteLegId` and the complete original `unresolvedIntent`. Automatic calculation must merge that warning into the result and keep the leg `review-required` after valid geometry returns. Reject manual-shipping splits before persistence.

- [ ] **Step 4: Move UI and CLI persistence after preflight**

Build next destinations and route reconciliation before `saveDestination`, `replaceTripData`, or delete operations. After preflight succeeds, persist stop changes and planned legs, then invoke shared automatic calculation.

- [ ] **Step 5: Verify and commit**

Run: `npm test -- src/domain/routePlanner.test.ts src/hooks/useTripData.test.tsx src/tripCommands/tripDataService.test.ts && npm run build`

Expected: PASS.

```bash
git add src/domain/routePlanner.ts src/domain/routePlanner.test.ts src/hooks/useTripData.ts src/hooks/useTripData.test.tsx src/tripCommands/tripDataService.ts src/tripCommands/tripDataService.test.ts
git commit -m "feat: preserve route intent across stop changes"
```

---

### Task 6: Add Manifest V2 And Explicit CLI Commands

**Files:**
- Modify: `src/tripCommands/types.ts`
- Modify: `src/tripCommands/validation.ts`
- Modify: `src/tripCommands/validation.test.ts`
- Modify: `src/tripCommands/tripManifest.ts`
- Modify: `src/tripCommands/tripManifest.test.ts`
- Modify: `src/tripCommands/tripDataService.ts`
- Modify: `src/tripCommands/tripDataService.test.ts`
- Modify: `src/cli/trip.ts`
- Modify: `src/cli/tripCli.test.ts`
- Modify: `docs/trip-cli.md`

**Interfaces:**
- Produces: discriminated `TripManifestDraftV1 | TripManifestDraftV2`.
- Produces: `setVehicle({ tripId, preset }, options?)` and `updateRouteLeg({ tripId, routeLegId, patch }, options?)`.
- Produces: CLI commands `set-vehicle` and `update-route-leg`.

- [ ] **Step 1: Write failing manifest-v2 tests**

```ts
it('requires a vehicle preset in version 2', () => {
  expect(() => validateTripManifest({ manifestVersion: 2, name: 'Trip', stops: [], routeLegs: [] }))
    .toThrowError(expect.objectContaining({ code: 'VEHICLE_PRESET_REQUIRED', path: 'vehiclePreset' }));
});

it('accepts one exceptional automatic directive', () => {
  const manifest = validateTripManifest({
    manifestVersion: 2, name: 'Nordkapp', vehiclePreset: 'expedition-truck',
    stops: [bremenDraft, kristiansandDraft],
    routeLegs: [{
      fromStopKey: 'bremen', toStopKey: 'kristiansand', ferryPolicy: 'require',
      waypoints: [{ name: 'Hirtshals ferry terminal', place: { query: 'Hirtshals ferry terminal, Denmark' }, links: [] }],
    }],
  });
  expect(manifest.vehiclePreset).toBe('expedition-truck');
});
```

- [ ] **Step 2: Verify validation and manifest tests fail**

Run: `npm test -- src/tripCommands/validation.test.ts src/tripCommands/tripManifest.test.ts`

Expected: FAIL because only version 1 manual-shipping directives exist.

- [ ] **Step 3: Implement versioned validation and materialization**

```ts
type RouteLegDirectiveDraftV2 = {
  fromStopKey: string;
  toStopKey: string;
  movement?: RouteMovement;
  calculation?: RouteCalculationMode;
  ferryPolicy?: FerryPolicy;
  waypoints?: RouteWaypointDraft[];
  notes?: string;
};

type RouteWaypointDraft = {
  name: string;
  place: PlaceInput;
  notes?: string;
  links: string[];
};
```

Version 1 remains readable and resolves Standard vehicle. Version 2 requires a preset, validates adjacent stop keys and supported movement/calculation pairs, resolves waypoint places, enriches waypoint links, creates every default adjacent leg, overlays exceptional directives, and calculates with the resolved trip snapshot.

- [ ] **Step 4: Preserve valid trips with route failures**

Keep structural and activity-distance errors blocking. Do not return `TRIP_AUDIT_FAILED` solely for failed or review-required routes. Persist the valid snapshot, return route status counts, and let `audit` report exact leg diagnostics.

```ts
const blockingIssues = audit.issues.filter((issue) => issue.code === 'ACTIVITY_DISTANCE_OUTLIER');
if (blockingIssues.length > 0) {
  return commandError('TRIP_AUDIT_FAILED', 'Trip manifest has semantic audit errors.', 'manifest', {
    audit: reportFromIssues(blockingIssues),
  });
}
```

- [ ] **Step 5: Add service and CLI command tests**

```ts
expect(service.setVehicle).toHaveBeenCalledWith(
  { tripId: 'trip-1', preset: 'large-camper' }, { dryRun: false, yes: false },
);
expect(service.updateRouteLeg).toHaveBeenCalledWith(
  { tripId: 'trip-1', routeLegId: 'leg-1', patch: routeIntentPatch },
  { dryRun: true, yes: false },
);
```

`setVehicle` changes only the complete trip vehicle snapshot and recalculates automatic legs. `updateRouteLeg` accepts only movement, calculation, ferry policy, ordered waypoint drafts, and notes. Reject all calculated fields.

- [ ] **Step 6: Update parsing, summaries, and CLI documentation**

Add these exact forms:

```bash
npm run trip -- set-vehicle --trip-id trip-1 --preset expedition-truck
npm run trip -- update-route-leg --trip-id trip-1 --route-leg-id leg-1 --input /tmp/route-intent.json
```

Summary output adds `reviewRequiredRouteLegs` and the trip vehicle preset without route geometry.

- [ ] **Step 7: Verify and commit**

Run: `npm test -- src/tripCommands/validation.test.ts src/tripCommands/tripManifest.test.ts src/tripCommands/tripDataService.test.ts src/cli/tripCli.test.ts && npm run build`

Expected: PASS.

```bash
git add src/tripCommands/types.ts src/tripCommands/validation.ts src/tripCommands/validation.test.ts src/tripCommands/tripManifest.ts src/tripCommands/tripManifest.test.ts src/tripCommands/tripDataService.ts src/tripCommands/tripDataService.test.ts src/cli/trip.ts src/cli/tripCli.test.ts docs/trip-cli.md
git commit -m "feat: add routing intent CLI contract"
```

---

### Task 7: Extend The Existing Trip Editor With Vehicle Buttons

**Files:**
- Modify: `src/components/TripSelector.tsx`
- Modify: `src/components/TripSelector.test.tsx`
- Modify: `src/hooks/useTripWorkspace.ts`
- Modify: `src/hooks/useTripWorkspace.test.tsx`
- Modify: `src/hooks/useTripData.ts`
- Modify: `src/hooks/useTripData.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Produces: `onUpdateTrip(tripId, { name, vehiclePreset })` replacing rename-only UI wiring.
- Consumes: `recalculateAutomaticRouteLegsForVehicle` from Task 4.
- Preserves: the existing compact editor and realtime subscriptions.

- [ ] **Step 1: Write failing trip-editor tests**

```tsx
it('edits name and vehicle in the existing pencil dialog', async () => {
  renderSelector();
  await user.click(screen.getByRole('button', { name: 'Edit Nordkapp' }));
  await user.click(screen.getByRole('button', { name: 'Expedition truck' }));
  await user.click(screen.getByRole('button', { name: 'Save trip' }));
  expect(onUpdateTrip).toHaveBeenCalledWith('trip-1', {
    name: 'Nordkapp', vehiclePreset: 'expedition-truck',
  });
});
```

Assert all three buttons have accessible labels, tooltips, stable dimensions, and selected state.

- [ ] **Step 2: Verify component and hook tests fail**

Run: `npm test -- src/components/TripSelector.test.tsx src/hooks/useTripWorkspace.test.tsx src/hooks/useTripData.test.tsx src/App.test.tsx`

Expected: FAIL because the editor only renames.

- [ ] **Step 3: Implement the three-button editor**

Rename internal rename mode to edit mode. Seed name and preset from the selected trip. Use Lucide `Car`, `Caravan`, and `Truck`.

```tsx
<div role="group" aria-label="Vehicle for this trip" className="trip-selector__vehicle-options">
  {vehicleOptions.map(({ preset, label, Icon }) => (
    <button key={preset} type="button" aria-label={label}
      aria-pressed={vehiclePreset === preset} title={label}
      onClick={() => setVehiclePreset(preset)}>
      <Icon size={17} aria-hidden="true" />
    </button>
  ))}
</div>
```

- [ ] **Step 4: Wire one metadata update and one recalculation**

`useTripWorkspace.updateTrip` returns `TripSummary | false`. In `TripWorkspace`, compare old and saved presets; when the active trip changed, call `useTripData.recalculateForVehicle(updated.routingVehicle)` exactly once. Do not add a vehicle-change effect, because an external CLI update already recalculates before realtime refresh.

Pass `activeTrip.routingVehicle` to every ordinary reconciliation in `useTripData`.

- [ ] **Step 5: Add realtime regression coverage**

Assert that trip-table realtime refresh updates the selected vehicle without a second calculation, while route-leg realtime still invokes `reload()`.

- [ ] **Step 6: Verify and commit**

Run: `npm test -- src/components/TripSelector.test.tsx src/hooks/useTripWorkspace.test.tsx src/hooks/useTripData.test.tsx src/App.test.tsx src/storage/tripRealtime.test.ts && npm run build`

Expected: PASS.

```bash
git add src/components/TripSelector.tsx src/components/TripSelector.test.tsx src/hooks/useTripWorkspace.ts src/hooks/useTripWorkspace.test.tsx src/hooks/useTripData.ts src/hooks/useTripData.test.tsx src/App.tsx src/App.test.tsx src/styles.css
git commit -m "feat: choose routing vehicle per trip"
```

---

### Task 8: Present Exceptional Intent Without A Settings UI

**Files:**
- Modify: `src/components/ItineraryPanel.tsx`
- Modify: `src/components/ItineraryPanel.test.tsx`
- Modify: `src/components/RouteLegEditor.tsx`
- Modify: `src/components/RouteLegEditor.test.tsx`
- Modify: `src/components/MapCanvas.tsx`
- Modify: `src/components/MapCanvas.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: route sections, warnings, waypoints, movement, and calculation.
- Produces: distinct road/ferry map features and compact itinerary indicators.
- Preserves: route alternatives and the manual vehicle-shipping escape hatch.

- [ ] **Step 1: Write failing itinerary tests**

```tsx
it('shows exceptional indicators only when present', () => {
  renderPanel({ routeLegs: [{
    ...routeLeg, waypoints: [waypoint], status: 'review-required',
    sections: [{ kind: 'ferry', startGeometryIndex: 2, endGeometryIndex: 8, distanceKm: 135 }],
    warnings: [detourWarning],
  }] });
  expect(screen.getByLabelText('Route includes a ferry')).toBeInTheDocument();
  expect(screen.getByLabelText('1 route waypoint')).toBeInTheDocument();
  expect(screen.getByLabelText(/Route requires review/)).toBeInTheDocument();
});
```

Assert ordinary rows show none of them and review-required metrics are excluded from totals.

- [ ] **Step 2: Write failing map-section tests**

```ts
expect(buildRouteFeatures([ferryRouteLeg]).features.map((feature) => feature.properties.kind))
  .toEqual(['road', 'ferry', 'road']);
```

Assert exact geometry slices and retain dashed manual shipping.

- [ ] **Step 3: Verify component tests fail**

Run: `npm test -- src/components/ItineraryPanel.test.tsx src/components/RouteLegEditor.test.tsx src/components/MapCanvas.test.tsx src/App.test.tsx`

Expected: FAIL because sections and warnings are not rendered.

- [ ] **Step 4: Implement compact presentation**

Use Lucide `Ship`, `MapPin`, and `TriangleAlert` icons with tooltips and accessible labels. Add no waypoint or ferry-policy controls. Replace generic shipping/manual copy with `Vehicle shipping`. The existing mode action writes only supported movement/calculation pairs.

- [ ] **Step 5: Split route geometry into map features**

Extract a pure feature builder from `MapCanvas`. Slice geometry by stored section indices. Render road and ferry separately, review-required geometry with warning styling, and manual shipping with existing dashed styling.

- [ ] **Step 6: Preserve intent through alternatives**

Pass active vehicle, waypoints, and ferry policy into option calculation. Applying an option updates calculated fields and sections only; it preserves movement, calculation, ferry policy, waypoints, and notes.

- [ ] **Step 7: Verify and commit**

Run: `npm test -- src/components/ItineraryPanel.test.tsx src/components/RouteLegEditor.test.tsx src/components/MapCanvas.test.tsx src/App.test.tsx && npm run build`

Expected: PASS.

```bash
git add src/components/ItineraryPanel.tsx src/components/ItineraryPanel.test.tsx src/components/RouteLegEditor.tsx src/components/RouteLegEditor.test.tsx src/components/MapCanvas.tsx src/components/MapCanvas.test.tsx src/App.tsx src/App.test.tsx src/styles.css
git commit -m "feat: present ferry and waypoint route intent"
```

---

### Task 9: Update Portable Guides And Installed Skills

**Files:**
- Modify: `docs/agent-guides/world-tour-route-research/README.md`
- Modify: `docs/agent-guides/world-tour-route-research/schema-reference.md`
- Modify: `docs/agent-guides/world-tour-route-research/examples/ambiguous-point-to-point-handoff-artifact-fixture.md`
- Modify: `docs/agent-guides/world-tour-trip-data/README.md`
- Modify: `docs/agent-guides/world-tour-trip-data/cli-reference.md`
- Modify: `~/.codex/skills/world-tour-route-research/SKILL.md`
- Modify: `~/.codex/skills/world-tour-route-research/references/schema-reference.md`
- Modify: `~/.codex/skills/world-tour-route-research/agents/openai.yaml`
- Modify: `~/.codex/skills/world-tour-trip-data/SKILL.md`
- Modify: `~/.codex/skills/world-tour-trip-data/references/cli-reference.md`
- Modify: `~/.codex/skills/world-tour-trip-data/agents/openai.yaml`

**Interfaces:**
- Consumes: Task 6 manifest and CLI contract.
- Produces: one consistent planning-to-write handoff across portable and installed copies.

- [ ] **Step 1: Verify the old contract lacks complete v2 coverage**

Run:

```bash
rg -n "manifestVersion.?2|vehiclePreset|ferryPolicy|waypoints|set-vehicle|update-route-leg" \
  docs/agent-guides/world-tour-route-research docs/agent-guides/world-tour-trip-data \
  ~/.codex/skills/world-tour-route-research ~/.codex/skills/world-tour-trip-data
```

Expected: no complete contract across all four locations.

- [ ] **Step 2: Update research ownership and fixture**

Document these exact rules:

```text
- Infer one of the three presets from ordinary language; default to standard.
- Do not ask for dimensions routinely.
- Keep ordinary adjacent automatic routes implicit.
- Add waypoints only when a place materially shapes the route.
- Add avoid or require only when ferry intent is material.
- Use manual vehicle shipping only for a genuine discontinuity.
- Maintain a manifest-compatible approved handoff so writing never reconstructs prose.
```

Update the handoff fixture to version 2 without adding schema dumps to the user-facing fixture.

- [ ] **Step 3: Update trip-data ownership and CLI reference**

Document one create plus one audit, exact `set-vehicle` and `update-route-leg` forms, every writable route field, and every app-derived field. Explicitly prohibit replanning after provider failures.

- [ ] **Step 4: Synchronize installed references**

```bash
cp docs/agent-guides/world-tour-route-research/schema-reference.md ~/.codex/skills/world-tour-route-research/references/schema-reference.md
cp docs/agent-guides/world-tour-trip-data/cli-reference.md ~/.codex/skills/world-tour-trip-data/references/cli-reference.md
```

Edit both installed `SKILL.md` files to match ownership without embedding implementation details. Update each `agents/openai.yaml` default prompt only if it conflicts with the version-2 approval and write boundary; preserve the existing skill names and display names.

- [ ] **Step 5: Verify and commit repo documentation**

Run:

```bash
diff -u docs/agent-guides/world-tour-route-research/schema-reference.md ~/.codex/skills/world-tour-route-research/references/schema-reference.md
diff -u docs/agent-guides/world-tour-trip-data/cli-reference.md ~/.codex/skills/world-tour-trip-data/references/cli-reference.md
```

Expected: both commands produce no output.

```bash
git add docs/agent-guides/world-tour-route-research/README.md docs/agent-guides/world-tour-route-research/schema-reference.md docs/agent-guides/world-tour-route-research/examples/ambiguous-point-to-point-handoff-artifact-fixture.md docs/agent-guides/world-tour-trip-data/README.md docs/agent-guides/world-tour-trip-data/cli-reference.md
git commit -m "docs: teach skills trip routing intent"
```

Installed files are outside the repository and are verified but not committed.

---

### Task 10: Remove Legacy Route Type And Verify End To End

**Files:**
- Create: `supabase/migrations/20260711121000_drop_legacy_route_leg_type.sql`
- Modify: `src/domain/types.ts`
- Modify: `src/domain/routeLegs.ts`
- Modify: `src/domain/routePlanner.ts`
- Modify: `src/storage/tripRepository.ts`
- Modify: `src/storage/supabaseTripRepository.ts`
- Modify: `src/tripCommands/routeOrchestration.ts`
- Modify: `src/tripCommands/tripManifest.ts`
- Modify: `src/domain/routeOptions.ts`
- Modify: `src/components/ItineraryPanel.tsx`
- Modify: `src/components/RouteLegEditor.tsx`
- Modify: `src/components/MapCanvas.tsx`
- Modify: `tests/world-tour.spec.ts`

**Interfaces:**
- Removes: `RouteLegType`, `RouteLeg.type`, `driving-auto`, and `shipping-manual` from runtime code.
- Finalizes: movement and calculation as the only route semantic source of truth.

- [ ] **Step 1: Run the failing legacy-reference gate**

Run: `rg -n "RouteLegType|driving-auto|shipping-manual|routeLeg\.type" src`

Expected: active application and test matches remain.

- [ ] **Step 2: Remove legacy consumers**

```ts
const isAutomaticDrive = routeLeg.movement === 'drive' && routeLeg.calculation === 'automatic';
const isManualVehicleShipping = routeLeg.movement === 'vehicle-shipping' && routeLeg.calculation === 'manual';
```

Legacy normalization remains only inside the Dexie v6 upgrade and the already-applied Supabase backfill migration. Runtime records no longer include `type`.

- [ ] **Step 3: Drop the legacy Supabase column**

```sql
alter table public.route_legs drop column type;
```

- [ ] **Step 4: Add Nordkapp and manual-insertion e2e coverage**

In isolated e2e storage, create a three-stop Expedition truck trip with a required ferry, a waypoint, mocked ferry sections, and a suspicious route fixture. Assert:

```ts
await expect(page.getByLabel('Route includes a ferry')).toBeVisible();
await expect(page.getByLabel('1 route waypoint')).toBeVisible();
await expect(page.getByLabel(/Route requires review/)).toBeVisible();
```

Add an ordinary stop through the existing map interaction and verify both adjacent legs calculate without opening route settings.

- [ ] **Step 5: Run the legacy gate and e2e regression**

Run:

```bash
test -z "$(rg -l 'RouteLegType|driving-auto|shipping-manual|routeLeg\.type' src --glob '!storage/tripDb.ts')"
npm run test:e2e -- tests/world-tour.spec.ts
```

Expected: the gate exits 0 and Playwright passes on its disposable `127.0.0.1:5174` server.

- [ ] **Step 6: Run full verification**

Run:

```bash
npm run lint
npm test
npm run build
npm run test:e2e
git diff --check
git status --short
```

Expected: all commands pass; `git diff --check` prints nothing; status contains only intended Task 10 files.

- [ ] **Step 7: Perform rendered browser QA**

Run `npm run dev`, open the reported local URL, and inspect the trip editor and itinerary at desktop and narrow mobile widths. Verify the three vehicle buttons fit without shifting the dialog, ordinary route rows remain unchanged, exceptional indicators do not overlap metrics, ferry styling follows the stored geometry section, and adding a normal stop never opens route settings. Stop the server after inspection.

Expected: no overlap, clipping, layout shift, console errors, or blank route layers.

- [ ] **Step 8: Commit and verify a clean tree**

```bash
git add supabase/migrations/20260711121000_drop_legacy_route_leg_type.sql src/domain/types.ts src/domain/routeLegs.ts src/domain/routePlanner.ts src/storage/tripRepository.ts src/storage/supabaseTripRepository.ts src/tripCommands/routeOrchestration.ts src/tripCommands/tripManifest.ts src/domain/routeOptions.ts src/components/ItineraryPanel.tsx src/components/RouteLegEditor.tsx src/components/MapCanvas.tsx tests/world-tour.spec.ts
git commit -m "test: finalize trip routing intent"
git log -10 --oneline
git status --short
```

Expected: ten implementation commits are visible and the worktree is clean.
