# Trip Data CLI And Command API Design

## Purpose

Allow an AI coding agent to read and write world-tour trip data through a stable, documented command interface. The first wrapper is a local CLI, and the same command layer should later support an in-app chat UI.

The command layer lets agents create, delete, rename, inspect, and amend trips. In v1, ordered stops are the main writable trip content. Routes remain derived app data: the service reconciles adjacent route legs after stop changes and calculates route geometry when an OpenRouteService key is available.

## Design Principles

- CLI first, chat-compatible later.
- Agents manipulate trip commands, not database tables.
- Stops are the primary writable route data.
- Route legs are derived from ordered adjacent stops.
- Command inputs and outputs are structured JSON with stable schemas.
- Every write command supports dry-run validation.
- The open app updates automatically after CLI writes.
- Supabase-backed trip data is the v1 target. Local/e2e storage remains available for tests.

## Architecture

```text
CLI / future chat UI / skill wrapper
  -> TripCommand API
  -> TripDataService
  -> TripDirectoryRepository + TripRepository
  -> Supabase
  -> app realtime subscription
  -> useTripWorkspace refresh + useTripData.reload()
```

`TripDataService` owns the trip command behavior. It uses the existing repository abstractions for persistence and reuses the existing route reconciliation rules. In v1, extract the non-React stop ordering, stop enrichment, and route reconciliation/calculation code needed by the CLI. The existing React hook can keep its browser-facing action API, but it must call the shared route orchestration utilities rather than maintaining a separate copy of those rules.

## Command Surface

### `listTrips`

Reads trip summaries.

Manipulates no data.

Returns:

```json
{
  "ok": true,
  "trips": [
    {
      "id": "trip-id",
      "name": "World tour",
      "createdAt": "2026-07-07T10:00:00.000Z",
      "updatedAt": "2026-07-07T10:00:00.000Z",
      "stopCount": 12
    }
  ]
}
```

### `getTrip`

Reads one trip, its ordered stops, route legs, and optionally activities.

Input:

```json
{
  "tripId": "trip-id",
  "includeActivities": true
}
```

Manipulates no data.

Returns:

```json
{
  "ok": true,
  "trip": {
    "id": "trip-id",
    "name": "World tour",
    "stops": [],
    "routeLegs": [],
    "activitiesByStopId": {}
  }
}
```

### `createTrip`

Creates a trip and optionally seeds its ordered stops.

Input:

```json
{
  "name": "Iberia loop",
  "stops": []
}
```

Manipulates:

- `trips`: inserts one trip with name.
- `destinations`: inserts provided stops with dense `order` values.
- `route_legs`: creates adjacent route legs for the inserted stop order.

Does not manipulate:

- activities
- media assets
- route alternatives cache

Returns the created trip, created stops, route recalculation summary, and a human-readable summary.

### `deleteTrip`

Deletes a trip.

Input:

```json
{
  "tripId": "trip-id"
}
```

Manipulates:

- `trips`: deletes the trip.
- `destinations`, `route_legs`, `activities`, `media_assets`: deleted by existing repository/database cascade behavior.
- storage objects: removed by the existing trip directory repository deletion path.

The command should require explicit confirmation unless `--yes` is passed.

### `renameTrip`

Updates trip metadata only.

Input:

```json
{
  "tripId": "trip-id",
  "name": "Updated name"
}
```

Manipulates:

- `trips.name`
- `trips.updated_at`

Does not manipulate stops, routes, activities, or media.

### `replaceStops`

Replaces the route-level stop list for a trip.

Input:

```json
{
  "tripId": "trip-id",
  "stops": []
}
```

Manipulates:

- `destinations`: inserts, updates, reorders, or deletes route stops to match the requested ordered list.
- `route_legs`: deletes non-adjacent route legs, preserves still-valid adjacent route legs, creates missing adjacent route legs, recalculates changed driving legs.
- `activities`: v1 preserves activities only when a stop is matched to an existing stop id. Deleting a stop deletes its child activities.
- `media_assets`: preserved only when the owning stop is preserved. Deleting a stop deletes its owned media.

This is the highest-risk stop command and should default to dry-run output before applying.

### `insertStop`

Adds one stop at a specific route position.

Input:

```json
{
  "tripId": "trip-id",
  "afterStopId": "porto-id",
  "beforeStopId": null,
  "stop": {
    "name": "Lisbon",
    "searchQuery": "Lisbon, Portugal",
    "coordinates": { "lat": 38.7223, "lng": -9.1393 },
    "expectedStayDays": 4,
    "tags": ["food", "culture"]
  }
}
```

Manipulates:

- `destinations`: inserts one new stop and renumbers affected stop orders.
- `route_legs`: removes any route leg that is no longer adjacent, creates the new adjacent legs, calculates new driving geometry.

Does not manipulate activities or media.

### `updateStop`

Updates route-level stop fields for one stop.

Input:

```json
{
  "tripId": "trip-id",
  "stopId": "lisbon-id",
  "patch": {
    "name": "Lisbon",
    "coordinates": { "lat": 38.7223, "lng": -9.1393 },
    "expectedStayDays": 5,
    "tags": ["food", "culture", "tiles"]
  }
}
```

Manipulates:

- `destinations`: updates only fields present in the patch.
- `route_legs`: recalculates adjacent driving route legs if coordinates changed.

Does not manipulate activities or media.

### `deleteStop`

Deletes one route stop.

Input:

```json
{
  "tripId": "trip-id",
  "stopId": "lisbon-id"
}
```

Manipulates:

- `destinations`: deletes the stop and renumbers remaining stop orders.
- `route_legs`: deletes legs attached to the stop, creates a new adjacent leg across the gap when applicable, calculates driving geometry.
- `activities`: deletes child activities through existing repository/database behavior.
- `media_assets`: deletes owned stop/activity media through existing repository/database behavior.

### `reorderStops`

Sets the ordered stop sequence without changing stop content.

Input:

```json
{
  "tripId": "trip-id",
  "stopIds": ["bilbao-id", "porto-id", "lisbon-id"]
}
```

Manipulates:

- `destinations.stop_order`: renumbers the requested sequence and keeps omitted stops at the end unless the command is run in strict mode.
- `route_legs`: reconciles adjacent legs for the new order and calculates changed driving geometry.

Does not manipulate activities or media.

## Agent-Facing Data Structures

### `TripDraft`

```json
{
  "name": "Iberia loop",
  "stops": []
}
```

Fields:

- `name`: required for `createTrip`.
- `stops`: optional ordered array of `StopDraft`.

### `StopDraft`

```json
{
  "id": "optional-existing-stop-id",
  "name": "Lisbon",
  "searchQuery": "Lisbon, Portugal",
  "coordinates": { "lat": 38.7223, "lng": -9.1393 },
  "expectedStayDays": 4,
  "tags": ["food", "culture"]
}
```

Required:

- `name`

Location input:

- `coordinates` is preferred when the agent already knows a precise stop anchor.
- `searchQuery` is context used to resolve or enrich the stop through MapTiler.
- At least one of `coordinates` or `searchQuery` is required.

Writable optional fields:

- `expectedStayDays`
- `tags`

The service fills all omitted `Destination` fields with app defaults. In v1, the draft intentionally excludes fields that are not currently surfaced in the app, including stop status, priority, route notes, timing dates, rationale text, media, and internal location details.

The agent-facing draft does not accept internal location details such as country, region, country code, source provider, or source feature id. The service derives those fields from MapTiler when an API key and resolvable query/coordinates are available. If coordinates are present and enrichment is unavailable, it creates a legacy location from the stop name and coordinates. If only `searchQuery` is present and the service cannot resolve coordinates, validation fails. `countryRegion` is derived from the resolved location or left blank.

### `StopPatch`

Same writable shape as `StopDraft`, but all fields are optional and at least one field must be present. `id` is not allowed inside `patch`; the command identifies the target with `stopId`.

When a patch changes `coordinates` or `searchQuery`, the service re-runs stop enrichment and recalculates adjacent route legs.

## Validation

Validation should happen before any write:

- trip names must be non-empty
- stop names must be non-empty
- each new stop must include coordinates or a search query
- coordinates, when present, must be finite numbers in valid latitude/longitude ranges
- stop ids must belong to the target trip
- insert positions must be unambiguous
- `replaceStops` must reject duplicate stop ids
- enum values must match the app domain
- destructive commands must produce dry-run summaries before apply unless `--yes` or an explicit apply flag is passed

Validation failures return structured errors:

```json
{
  "ok": false,
  "error": {
    "code": "STOP_LOCATION_REQUIRED",
    "message": "Stop 'Lisbon' needs coordinates or a search query before it can be added.",
    "path": "stops[2]"
  }
}
```

## Route Behavior

The service should extract non-React route orchestration from `useTripData`:

- normalize stop drafts into full `Destination` records
- resolve or enrich stop location data through MapTiler when possible
- fill app-owned default fields instead of requiring agents to write internal destination structure
- create/update ordered destinations
- reconcile adjacent route legs
- preserve still-valid route legs
- remove non-adjacent route legs
- calculate changed `driving-auto` legs when an OpenRouteService API key is present
- mark route calculation failures as failed route legs without rolling back valid stop changes

Manual shipping legs remain supported by the existing route-leg model, but v1 commands do not expose broad route-leg editing. A later command can add route-type overrides for a specific adjacent pair.

## Realtime App Refresh

The app should refresh automatically when CLI writes change Supabase data.

Workspace subscription:

- subscribes to `trips`
- refreshes the trip selector after create, rename, or delete
- if the active trip is deleted, selects another trip when available or shows an empty state

Active trip subscription:

- subscribes to `destinations`, `route_legs`, `activities`, and `media_assets` filtered by active `trip_id`
- debounces bursts of changes from one CLI command
- calls `useTripData.reload()` for route/stop/activity changes
- refreshes selected media rollups when relevant media changes affect the selected stop

V1 should rely on Supabase realtime for the shared CLI/browser source of truth. Local IndexedDB cross-process realtime is out of scope.

## CLI Shape

Add a Node CLI entry point under `src/cli/` and npm scripts for common commands:

```bash
npm run trip -- list
npm run trip -- get --trip-id <id>
npm run trip -- create --input ./trip.json
npm run trip -- delete --trip-id <id> --yes
npm run trip -- rename --trip-id <id> --name "New name"
npm run trip -- replace-stops --trip-id <id> --input ./stops.json --dry-run
npm run trip -- insert-stop --trip-id <id> --after-stop-id <id> --input ./stop.json
npm run trip -- update-stop --trip-id <id> --stop-id <id> --input ./patch.json
npm run trip -- delete-stop --trip-id <id> --stop-id <id> --dry-run
npm run trip -- reorder-stops --trip-id <id> --input ./stop-order.json
```

The CLI should:

- read Supabase URL/key from existing environment names
- create or reuse an anonymous Supabase session with the publishable key, matching the app's current personal-project auth model
- avoid service-role access in v1
- print JSON by default
- offer `--pretty` for human-readable output
- return non-zero exit codes for validation or write failures

## Skill Wrapper Contract

A Codex skill can wrap the CLI by documenting:

- command list
- input JSON schemas
- output JSON schemas
- examples for each command
- safe workflow: read, dry-run, apply, verify
- destructive workflow: require explicit user approval before delete or replace
- routing rule: manipulate stops, let the service derive routes

The skill should prefer narrow commands like `insertStop`, `updateStop`, and `reorderStops` over `replaceStops` unless the user clearly asks to regenerate the whole stop list.

## Future Chat UI

The command API should return summaries and changed-object lists suitable for chat confirmations:

```json
{
  "ok": true,
  "summary": "Inserted Lisbon after Porto.",
  "changed": {
    "tripsCreated": [],
    "tripsDeleted": [],
    "stopsAdded": ["Lisbon"],
    "stopsUpdated": [],
    "stopsDeleted": [],
    "routesRecalculated": 2
  }
}
```

A future chat UI can translate natural language into proposed commands, preview the structured command and dry-run result, ask for confirmation, then execute the same service command.

## Testing

Unit tests:

- command validation
- stop draft normalization
- route reconciliation service behavior
- dry-run summaries
- destructive command safeguards
- structured success/error output

Repository/service tests:

- create trip with stops
- replace stops preserving matched stop ids
- insert/delete/reorder recalculating route legs
- delete trip cascade expectations

App tests:

- trip selector refreshes after trip changes
- active trip reloads after destination/route changes
- active trip deletion selects a fallback trip or empty state
- realtime bursts debounce to one reload

E2e tests:

- run a CLI command against test Supabase or a mocked service boundary, then verify the open app updates without manual refresh.

## Out Of Scope For V1

- AI-generated activities and media writes.
- Direct route geometry authoring by agents.
- MCP server wrapper.
- Local IndexedDB cross-process realtime.
- Multi-user collaboration semantics beyond current Supabase policies.
