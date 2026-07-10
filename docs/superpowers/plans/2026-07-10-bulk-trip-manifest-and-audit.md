# Bulk Trip Manifest And Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an explicitly approved new trip writable through one full-manifest CLI call plus one semantic audit/readback, without agent-authored per-activity orchestration or duplicate external work.

**Architecture:** Extend the existing `trip create` input with a versioned manifest containing ordered stops, nested activities, links, and manual route-leg directives. Materialize the complete domain snapshot in memory, resolve every external value once, audit it before persistence, and write it through the existing `TripRepository.replaceTripData` bulk primitive. Preserve the granular commands for amendments, add targeted failed-route recovery, and teach both skills the new command budget and ferry/location verification contract.

**Tech Stack:** TypeScript, Vitest, the existing trip command service and CLI, local/Supabase trip repositories, MapTiler place resolution, OpenRouteService routing, Markdown skill documentation.

## Global Constraints

- Use `npm run trip -- ...` for all agent-authored trip reads and writes; do not add direct Supabase scripting.
- Preserve all existing granular trip, stop, activity, and link commands for amendments.
- Keep the existing legacy `{ "name": ..., "stops": [...] }` create payload working.
- Use the versioned full manifest for agent-authored new trips; do not add a second import subsystem or MCP surface.
- Let the app resolve places, enrich links, calculate driving routes, assign IDs, normalize locations, and persist timestamps.
- Never accept authored route geometry, calculated distance, calculated duration, normalized location metadata, row IDs, or Supabase table shapes in the manifest.
- A `shipping-manual` directive identifies an approved ferry/shipping leg; the app creates its straight-line manual geometry.
- Every full-manifest stop must specify `expectedStayDays`; use `1` for departure or return anchors rather than silently accepting the domain default of `3`.
- A clearly authorized new-trip create runs once without a preceding expensive dry-run. Dry-run remains available when the user asks for a preview.
- Destructive changes to an existing trip remain preview-first.
- Full-manifest creation must not persist any trip when validation, place resolution, route calculation, or pre-write semantic audit has error-severity findings.
- A failed persistence after directory creation must delete the newly created trip as cleanup.
- Target command budget for an approved new trip: optional `list`, one `create`, one `audit` or detailed `get` readback.
- No database migration is required; the existing destination, activity, link, and route-leg models already hold the required persisted data.

---

### Task 1: Define And Validate The Full Manifest Contract

**Files:**
- Modify: `src/tripCommands/types.ts`
- Modify: `src/tripCommands/validation.ts`
- Modify: `src/tripCommands/validation.test.ts`

**Interfaces:**
- Produces `TripManifestDraft`, `StopManifestDraft`, `ActivityManifestDraft`, and `RouteLegDirectiveDraft`.
- Produces `validateTripManifest(input: unknown): TripManifestDraft`.
- Preserves `validateStopDraft`, `validateStopPatch`, `validateActivityDraft`, and `validateActivityPatch` for granular commands.

- [ ] **Step 1: Write failing validation tests for a complete manifest**

Add tests proving this shape is accepted and preserved:

```ts
const manifest = validateTripManifest({
  manifestVersion: 1,
  name: 'Nordkapp Summer Loop',
  stops: [
    {
      key: 'larvik',
      name: 'Larvik',
      place: { query: 'Larvik, Norway' },
      expectedStayDays: 1,
      notes: 'Ferry staging stop.',
      tags: ['practical-route', 'permit-or-booking'],
      links: ['https://www.colorline.com/denmark-norway'],
      activities: [],
    },
    {
      key: 'hirtshals',
      name: 'Hirtshals',
      place: { query: 'Hirtshals, Denmark' },
      expectedStayDays: 1,
      notes: 'Post-ferry buffer.',
      tags: ['practical-route', 'buffer-stop'],
      links: [],
      activities: [
        {
          title: 'Visit the harbour',
          place: { query: 'Hirtshals Havn, Denmark' },
          description: 'Short harbour walk.',
          notes: 'Keep flexible around the sailing.',
          tags: ['walk', 'coast'],
          links: ['https://example.com/harbour'],
        },
      ],
    },
  ],
  routeLegs: [
    {
      fromStopKey: 'larvik',
      toStopKey: 'hirtshals',
      type: 'shipping-manual',
      notes: 'Larvik-Hirtshals vehicle ferry.',
    },
  ],
});

expect(manifest.stops[1].activities[0].tags).toEqual(['walk', 'coast']);
expect(manifest.routeLegs[0].type).toBe('shipping-manual');
```

- [ ] **Step 2: Run the manifest validation test and verify RED**

Run:

```bash
npm test -- src/tripCommands/validation.test.ts
```

Expected: FAIL because `validateTripManifest` and the manifest types do not exist.

- [ ] **Step 3: Add failing validation cases for unsafe or ambiguous manifests**

Cover exact paths and error messages for:

```ts
expect(() => validateTripManifest({
  manifestVersion: 1,
  name: 'Broken',
  stops: [{ key: 'home', name: 'Home', place: { query: 'Home' } }],
})).toThrow('stops[0].expectedStayDays is required');

expect(() => validateTripManifest({
  manifestVersion: 1,
  name: 'Broken',
  stops: [
    { key: 'same', name: 'A', place: { query: 'A' }, expectedStayDays: 1 },
    { key: 'same', name: 'B', place: { query: 'B' }, expectedStayDays: 1 },
  ],
})).toThrow('stops[1].key must be unique');
```

Also reject:

- non-`1` `manifestVersion`
- blank or duplicate stop keys
- non-positive or non-integer `expectedStayDays`
- malformed stop/activity links
- unknown route-leg stop keys
- non-adjacent route-leg pairs
- duplicate directives for the same pair
- route-leg types other than `shipping-manual`
- app-derived fields such as `geometry`, `distanceKm`, `location`, or `id`

- [ ] **Step 4: Implement the manifest types and validator**

Add these normalized types to `types.ts`:

```ts
export type ActivityManifestDraft = {
  title: string;
  place?: PlaceInput;
  description?: string;
  notes?: string;
  tags: string[];
  links: string[];
};

export type StopManifestDraft = {
  key: string;
  name: string;
  place: PlaceInput;
  expectedStayDays: number;
  notes?: string;
  tags: string[];
  links: string[];
  activities: ActivityManifestDraft[];
};

export type RouteLegDirectiveDraft = {
  fromStopKey: string;
  toStopKey: string;
  type: 'shipping-manual';
  notes?: string;
};

export type TripManifestDraft = {
  manifestVersion: 1;
  name: string;
  stops: StopManifestDraft[];
  routeLegs: RouteLegDirectiveDraft[];
};
```

Implement `validateTripManifest` with existing structured validation helpers. Default omitted `tags`, `links`, `activities`, and `routeLegs` to empty arrays; do not default `expectedStayDays` in the full manifest.

- [ ] **Step 5: Run validation tests and verify GREEN**

Run:

```bash
npm test -- src/tripCommands/validation.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the contract**

```bash
git add src/tripCommands/types.ts src/tripCommands/validation.ts src/tripCommands/validation.test.ts
git commit -m "feat: define bulk trip manifest"
```

---

### Task 2: Materialize And Persist A Full Trip In One Service Call

**Files:**
- Create: `src/tripCommands/tripManifest.ts`
- Create: `src/tripCommands/tripManifest.test.ts`
- Modify: `src/tripCommands/tripDataService.ts`
- Modify: `src/tripCommands/tripDataService.test.ts`
- Modify: `src/tripCommands/types.ts`
- Modify: `src/domain/routeLegs.ts`
- Modify: `src/domain/routeLegs.test.ts`

**Interfaces:**
- Produces `materializeTripManifest(manifest, dependencies): Promise<MaterializedTripManifest>`.
- Produces a materialized snapshot with `destinations`, `activities`, `routeLegs`, and `changed`.
- Extends `TripDataService.createTrip` to accept either the legacy draft or `TripManifestDraft`.
- Uses `TripRepository.replaceTripData` exactly once for an applied full manifest.

- [ ] **Step 1: Write a failing materialization test**

Create a three-stop manifest with two activities, three links, and one manual ferry leg. Assert:

```ts
expect(resolvePlace).toHaveBeenCalledTimes(5);
expect(enrichLink).toHaveBeenCalledTimes(3);
expect(calculateRoute).toHaveBeenCalledTimes(1);
expect(materialized.destinations).toHaveLength(3);
expect(materialized.activities).toHaveLength(2);
expect(materialized.routeLegs).toMatchObject([
  { type: 'driving-auto', status: 'ready' },
  { type: 'shipping-manual', status: 'manual', notes: 'Vehicle ferry.' },
]);
```

The test must verify that activity descriptions, notes, tags, links, parent destination IDs, and stable activity order are present before persistence.

- [ ] **Step 2: Run the materialization test and verify RED**

Run:

```bash
npm test -- src/tripCommands/tripManifest.test.ts
```

Expected: FAIL because the materializer does not exist.

- [ ] **Step 3: Add a domain helper for complete manual legs**

Add `createManualRouteLeg` to `routeLegs.ts`:

```ts
createManualRouteLeg({ origin, target, originDestinationId, targetDestinationId, notes })
```

It must return `type: 'shipping-manual'`, `status: 'manual'`, straight-line geometry, no calculated distance/time/provider/profile/route key, and the supplied notes. Add a focused domain test.

- [ ] **Step 4: Implement manifest materialization**

In `tripManifest.ts`:

1. Resolve every stop exactly once with `Promise.all`.
2. Create destinations in canonical manifest order and apply explicit stay, notes, tags, and enriched stop links.
3. Resolve every activity exactly once.
4. Create and fully patch each activity in memory with description, notes, tags, enriched links, parent destination ID, and stable order.
5. Build manual route legs from directives before calculating remaining adjacent driving legs.
6. Calculate each non-manual adjacent leg once.
7. Preserve array order after concurrent place/link resolution.

Do not call repository methods from this helper.

- [ ] **Step 5: Add a failing full-manifest service test**

Create a generated manifest with 26 stops, 15 activities, 18 links, and two manual route directives. Assert the service apply path calls:

```ts
expect(resolvePlace).toHaveBeenCalledTimes(41);
expect(enrichLink).toHaveBeenCalledTimes(18);
expect(calculateRoute).toHaveBeenCalledTimes(23);
expect(repository.replaceTripData).toHaveBeenCalledTimes(1);
expect(repository.createActivity).not.toHaveBeenCalled();
expect(repository.updateActivity).not.toHaveBeenCalled();
```

Also assert the directory creates one trip and the result includes counts for 26 stops, 15 activities, 18 links, 23 ready driving legs, and two manual legs.

- [ ] **Step 6: Implement bulk create persistence and cleanup**

In `createTrip`:

- detect `manifestVersion: 1`
- validate and materialize completely before creating a directory entry
- return the materialized snapshot without persistence for `dryRun`
- on apply, create one trip, then call `repository.replaceTripData` once
- if bulk persistence throws, call `directory.deleteTrip(trip.id)` and return the original persistence error
- keep the current legacy create path unchanged

Do not require `--yes` for a new trip; creation is isolated and the user’s explicit request is the authorization boundary.

- [ ] **Step 7: Add and pass rollback and dry-run tests**

Prove:

- full-manifest dry-run never calls `directory.createTrip` or `replaceTripData`
- apply materializes each external value once
- persistence failure deletes the newly created directory entry
- legacy create inputs still behave exactly as before

Run:

```bash
npm test -- src/domain/routeLegs.test.ts src/tripCommands/tripManifest.test.ts src/tripCommands/tripDataService.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit bulk creation**

```bash
git add src/domain/routeLegs.ts src/domain/routeLegs.test.ts src/tripCommands/types.ts src/tripCommands/tripManifest.ts src/tripCommands/tripManifest.test.ts src/tripCommands/tripDataService.ts src/tripCommands/tripDataService.test.ts
git commit -m "feat: create complete trips from one manifest"
```

---

### Task 3: Add Deterministic Semantic Auditing

**Files:**
- Create: `src/tripCommands/tripAudit.ts`
- Create: `src/tripCommands/tripAudit.test.ts`
- Modify: `src/domain/routePlanner.ts`
- Modify: `src/domain/routePlanner.test.ts`
- Modify: `src/tripCommands/types.ts`
- Modify: `src/tripCommands/tripDataService.ts`
- Modify: `src/tripCommands/tripDataService.test.ts`

**Interfaces:**
- Produces `TripAuditIssue` with `severity`, `code`, `message`, and scoped entity/leg identifiers.
- Produces `auditTripSnapshot({ destinations, activities, routeLegs }): TripAuditReport`.
- Produces `TripDataService.auditTrip({ tripId })` for persisted readback.
- Full-manifest create runs the same audit before persistence.

- [ ] **Step 1: Export the existing coordinate distance calculation**

Rename/export the private route-planner helper as:

```ts
export function coordinateDistanceKm(left: Coordinates, right: Coordinates): number
```

Keep all existing route-planner behavior and add a direct unit test for a known short distance.

- [ ] **Step 2: Write failing audit tests for the observed regressions**

Cover these exact issue codes:

```ts
expect(report.issues).toContainEqual(expect.objectContaining({
  severity: 'error',
  code: 'ACTIVITY_DISTANCE_OUTLIER',
  activityId: 'drive-to-a',
}));

expect(report.issues).toContainEqual(expect.objectContaining({
  severity: 'error',
  code: 'FAILED_ROUTE_LEG',
  routeLegId: 'failed-leg',
}));

expect(report.issues).toContainEqual(expect.objectContaining({
  severity: 'error',
  code: 'AUTO_ROUTE_DETOUR',
  routeLegId: 'larvik-hirtshals-auto',
}));
```

Rules:

- error when an activity is more than `250 km` great-circle distance from its parent stop
- error for every `failed` driving route leg
- error when an automatic driving leg is over `250 km` and more than four times the great-circle distance
- warning when first and last stops resolve to the same coordinates and either retained the domain default three-day stay
- no detour warning for `shipping-manual` legs

- [ ] **Step 3: Run audit tests and verify RED**

Run:

```bash
npm test -- src/tripCommands/tripAudit.test.ts
```

Expected: FAIL because the audit module does not exist.

- [ ] **Step 4: Implement the pure audit module**

Keep the audit deterministic and free of network or repository calls. Return summary counts:

```ts
{
  errors: number;
  warnings: number;
  issues: TripAuditIssue[];
}
```

Messages must include human-readable stop/activity names and route endpoints so agents do not need to inspect raw IDs.

- [ ] **Step 5: Gate full-manifest persistence on audit errors**

Run the audit after materialization and before `directory.createTrip`. If errors exist, return:

```ts
{
  code: 'TRIP_AUDIT_FAILED',
  message: 'Trip manifest has semantic audit errors.',
  path: 'manifest',
}
```

Extend `CommandError` with `details?: { audit?: TripAuditReport }` and return the complete report at `error.details.audit`; do not reduce it to a generic string. Warnings do not block persistence and must be returned in the successful create response.

- [ ] **Step 6: Add persisted audit service tests**

`auditTrip` must read stops, route legs, and activities once and return the same report as pre-write auditing. Test a clean trip and a trip containing the two observed activity outliers.

Run:

```bash
npm test -- src/domain/routePlanner.test.ts src/tripCommands/tripAudit.test.ts src/tripCommands/tripDataService.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit semantic auditing**

```bash
git add src/domain/routePlanner.ts src/domain/routePlanner.test.ts src/tripCommands/types.ts src/tripCommands/tripAudit.ts src/tripCommands/tripAudit.test.ts src/tripCommands/tripDataService.ts src/tripCommands/tripDataService.test.ts
git commit -m "feat: audit trip data semantics"
```

---

### Task 4: Expose Route Failures And Recalculate Only Failed Legs

**Files:**
- Modify: `src/adapters/openRouteService.ts`
- Modify: `src/adapters/openRouteService.test.ts`
- Modify: `src/tripCommands/tripDataService.ts`
- Modify: `src/tripCommands/tripDataService.test.ts`
- Modify: `src/cli/trip.ts`
- Modify: `src/cli/tripCli.test.ts`

**Interfaces:**
- Route errors retain HTTP status in their message: `OpenRouteService route calculation failed (HTTP 429)`.
- Produces `TripDataService.recalculateFailedRoutes({ tripId })`.
- Produces `npm run trip -- recalculate-failed-routes --trip-id <id> [--summary] [--pretty]`.

- [ ] **Step 1: Write a failing adapter diagnostic test**

Mock a `429` response and assert:

```ts
await expect(calculateOpenRouteServiceRoute(input)).rejects.toThrow(
  'OpenRouteService route calculation failed (HTTP 429)',
);
```

Also preserve existing 401/403 alternative-route fallback behavior.

- [ ] **Step 2: Implement status-bearing route errors**

Update `OpenRouteServiceRouteCalculationError` so its message includes the HTTP status while retaining the numeric `status` property. Do not expose response bodies or credentials.

- [ ] **Step 3: Write a failing targeted recalculation service test**

Create three route legs: one ready, two failed. Assert the command:

- never calls the calculator for the ready leg
- calls it once for each failed leg
- saves only the recalculated failed legs
- returns before/after failed counts and endpoint names

- [ ] **Step 4: Implement `recalculateFailedRoutes`**

Read destinations and route legs, pass the existing set through route reconciliation/calculation, preserve ready/manual legs, save changed failed legs, and return the complete ordered route-leg list plus changed summary.

Do not use a no-op stop reorder as a recalculation mechanism.

- [ ] **Step 5: Add the CLI command and summary output**

Route `recalculate-failed-routes` in `trip.ts`. Summary output must include:

```json
{
  "routeLegs": 25,
  "readyRouteLegs": 23,
  "manualRouteLegs": 2,
  "failedRouteLegs": 0
}
```

Add parser/routing tests in `tripCli.test.ts`.

- [ ] **Step 6: Run focused route tests**

Run:

```bash
npm test -- src/adapters/openRouteService.test.ts src/tripCommands/tripDataService.test.ts src/cli/tripCli.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit route diagnostics**

```bash
git add src/adapters/openRouteService.ts src/adapters/openRouteService.test.ts src/tripCommands/tripDataService.ts src/tripCommands/tripDataService.test.ts src/cli/trip.ts src/cli/tripCli.test.ts
git commit -m "feat: diagnose and recalculate failed trip routes"
```

---

### Task 5: Wire The Bulk CLI And Replace The Slow Skill Workflow

**Files:**
- Modify: `src/cli/trip.ts`
- Modify: `src/cli/tripCli.test.ts`
- Modify: `docs/agent-guides/world-tour-trip-data/README.md`
- Modify: `docs/agent-guides/world-tour-trip-data/cli-reference.md`
- Modify: `docs/agent-guides/world-tour-route-research/schema-reference.md`
- Modify outside repo and synchronize: `~/.codex/skills/world-tour-trip-data/SKILL.md`
- Modify outside repo and synchronize: `~/.codex/skills/world-tour-trip-data/references/cli-reference.md`
- Modify outside repo and synchronize: `~/.codex/skills/world-tour-route-research/references/schema-reference.md`

**Interfaces:**
- `trip create --input manifest.json` accepts `manifestVersion: 1` and returns stop/activity/link/route/audit counts.
- `trip audit --trip-id <id>` returns the persisted semantic audit.
- Route-research handoff advertises manual ferry/shipping directives and source coordinates.
- Trip-data skill uses the three-command bulk workflow for approved new trips.

- [ ] **Step 1: Add failing CLI tests for full create and audit**

Prove `runTripCli` passes the entire manifest to `service.createTrip`, routes `audit` to `service.auditTrip`, and prints summary counts without route geometry:

```ts
expect(payload.counts).toEqual({
  stops: 26,
  activities: 15,
  links: 18,
  routeLegs: 25,
  readyRouteLegs: 23,
  manualRouteLegs: 2,
  failedRouteLegs: 0,
  auditErrors: 0,
  auditWarnings: 0,
});
```

- [ ] **Step 2: Implement CLI routing and summary serialization**

Keep full non-summary output available for debugging. `--summary` must omit geometry, normalized location payloads, and link previews while retaining counts, audit issues, and failed/manual leg endpoint names.

- [ ] **Step 3: Replace the trip-data skill workflow**

Document these explicit branches:

**Approved new trip:**

```bash
npm run trip -- list --pretty
npm run trip -- create --input /tmp/trip-manifest.json --summary --pretty
npm run trip -- audit --trip-id <trip-id> --pretty
```

- No dry-run when the user already clearly authorized creating a new isolated trip.
- No generated per-activity runner.
- No create-then-update activity loop.
- No dry-run for idempotent link additions inside the full manifest.
- Do not inspect service source or unrelated existing trips when the reference answers the command question.

**User requests preview:** run one full-manifest `create --dry-run --summary --pretty`, stop for review, and wait long enough to avoid provider limits before a later apply. State that preview repeats external resolution when eventually applied.

**Existing trip amendment:** keep the current granular, preview-first commands.

- [ ] **Step 4: Document semantic requirements in the CLI reference**

Add a complete manifest example showing:

- unique stop keys
- explicit stay days on every stop
- nested activities with description, notes, tags, links, and source coordinates where available
- stop links
- `shipping-manual` ferry directive
- no authored route geometry or calculated route fields

State that source coordinates should be used for short or ambiguous names such as single-letter place names and named viewpoints.

- [ ] **Step 5: Add route-leg directives to route-research handoff**

Extend the schema reference with:

```json
{
  "fromStopKey": "larvik",
  "toStopKey": "hirtshals",
  "type": "shipping-manual",
  "notes": "Approved vehicle ferry crossing.",
  "sources": ["ferry-operator"]
}
```

Require this for approved ferry/shipping legs so the trip-data agent does not infer route mode from prose notes.

- [ ] **Step 6: Synchronize and validate installed skills**

Copy the portable references to the installed skill directories, update the installed trip-data workflow, then run:

```bash
PYTHONPATH=/tmp/world-tour-skill-validator-pyyaml \
  ~/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 \
  ~/.codex/skills/.system/skill-creator/scripts/quick_validate.py \
  ~/.codex/skills/world-tour-trip-data

cmp -s \
  docs/agent-guides/world-tour-trip-data/cli-reference.md \
  ~/.codex/skills/world-tour-trip-data/references/cli-reference.md

cmp -s \
  docs/agent-guides/world-tour-route-research/schema-reference.md \
  ~/.codex/skills/world-tour-route-research/references/schema-reference.md
```

Expected: skill valid and both comparisons exit `0`.

- [ ] **Step 7: Run the full verification suite**

Run:

```bash
npm test
npm run lint
npm run build
git diff --check
```

Expected: all tests pass, lint/build exit `0`, and no whitespace errors.

- [ ] **Step 8: Forward-test the command budget without touching personal trips**

Add a Vitest integration case that drives a generated 26-stop/15-activity manifest through `runTripCli` backed by the in-memory trip-data service dependencies. Run it with:

```bash
npm test -- src/cli/tripCli.test.ts src/tripCommands/tripDataService.test.ts
```

Verify:

- one `create` invocation writes all entities
- one `audit` invocation returns zero errors
- manual ferry legs remain manual
- no activity is over `250 km` from its parent
- no per-activity CLI runner is generated
- no normal Supabase trip is read or changed

- [ ] **Step 9: Commit CLI and skill documentation**

```bash
git add src/cli/trip.ts src/cli/tripCli.test.ts docs/agent-guides/world-tour-trip-data/README.md docs/agent-guides/world-tour-trip-data/cli-reference.md docs/agent-guides/world-tour-route-research/schema-reference.md
git commit -m "docs: adopt bulk trip creation workflow"
```

---

## Completion Criteria

- An explicitly approved new 26-stop/15-activity trip is created through one CLI process.
- Stops, activities, notes, tags, links, and manual ferry legs are persisted by one bulk snapshot write.
- External place/link/route operations occur once per required entity or automatic leg.
- No immediately repeated dry-run/apply pair exhausts route-provider capacity.
- Semantic outliers and failed routes block new-trip persistence.
- Persisted trips can be audited independently.
- Failed routes can be recalculated directly without reordering stops.
- Existing granular amendment workflows and legacy create payloads remain compatible.
- The trip-data skill no longer instructs agents to synthesize per-activity orchestration.
- The documented normal command budget is optional list + create + audit/readback.
