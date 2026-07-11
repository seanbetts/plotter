# Trip Data CLI

The trip CLI lets agents and local scripts read and write Supabase-backed Plotter trip data through app-owned commands.

## Safety Workflow

1. Read current state with `npm run trip -- list` and `npm run trip -- get --trip-id <id> --include-activities --include-links`.
2. Prefer narrow commands such as `insert-stop`, `update-stop`, `create-activity`, and link add/delete commands.
3. Every write command supports `--dry-run`, including create, update, link, delete, and reorder paths.
4. Wrapper authors should dry-run agent-authored writes before applying them.
5. Use `--yes` only after the user has approved the change.
6. The open app refreshes automatically through Supabase realtime after CLI writes.
7. The Node CLI reuses a local anonymous Supabase session so repeated commands do not create a new anonymous user each time.
8. Use `--summary` for large dry-runs when full route geometry would make the JSON hard to review.

## Command List

### Trips

```bash
npm run trip -- list
npm run trip -- get --trip-id <id> --include-activities --include-links
npm run trip -- create --input ./trip.json
npm run trip -- delete --trip-id <id> --dry-run
npm run trip -- delete --trip-id <id> --yes
npm run trip -- rename --trip-id <id> --name "North Coast 500 Trip"
npm run trip -- set-vehicle --trip-id trip-1 --preset expedition-truck
```

Vehicle presets are `standard`, `large-camper`, and `expedition-truck`. Changing the preset replaces the complete trip vehicle snapshot and recalculates automatic route legs; manual vehicle-shipping legs are preserved.

### Routes

```bash
npm run trip -- audit --trip-id trip-1
npm run trip -- recalculate-failed-routes --trip-id trip-1
npm run trip -- update-route-leg --trip-id trip-1 --route-leg-id leg-1 --input /tmp/route-intent.json
```

`update-route-leg` accepts route intent only: `movement`, `calculation`, `ferryPolicy`, ordered `waypoints`, and `notes`. It rejects calculated or app-owned fields including type, status, geometry, distance, time, provider, profile, route key, calculation time, sections, warnings, and errors. The command never accepts authored geometry or asks the agent to replan stop order.

### Stops

```bash
npm run trip -- replace-stops --trip-id <id> --input ./stops.json --dry-run
npm run trip -- insert-stop --trip-id <id> --after-stop-id <id> --input ./stop.json
npm run trip -- insert-stop --trip-id <id> --before-stop-id <id> --input ./stop.json
npm run trip -- update-stop --trip-id <id> --stop-id <id> --input ./patch.json
npm run trip -- delete-stop --trip-id <id> --stop-id <id> --dry-run
npm run trip -- reorder-stops --trip-id <id> --input ./stop-order.json --strict
```

`--after-stop-id` and `--before-stop-id` are independent optional anchors. Pass both only when they describe the intended insertion gap.

### Stop Links

```bash
npm run trip -- add-stop-link --trip-id <id> --stop-id <id> --url https://example.com
npm run trip -- delete-stop-link --trip-id <id> --stop-id <id> --link-id <id>
```

Link commands are flag-based only. `add-stop-link` and `add-activity-link` take `--url`; delete commands take `--link-id`. They do not accept JSON input files.

Adding a link is idempotent. If the parent stop or activity already has the same normalized URL, or link preview enrichment canonicalizes the requested URL to an existing stored URL, the command returns success without adding a duplicate.

### Activities

```bash
npm run trip -- list-activities --trip-id <id> --stop-id <id>
npm run trip -- create-activity --trip-id <id> --stop-id <id> --input ./activity.json
npm run trip -- update-activity --trip-id <id> --activity-id <id> --input ./activity-patch.json
npm run trip -- delete-activity --trip-id <id> --activity-id <id> --dry-run
npm run trip -- reorder-activities --trip-id <id> --stop-id <id> --input ./activity-order.json
```

### Activity Links

```bash
npm run trip -- add-activity-link --trip-id <id> --activity-id <id> --url https://example.com
npm run trip -- delete-activity-link --trip-id <id> --activity-id <id> --link-id <id>
```

## Output Contract

Commands print JSON to stdout by default. Pass `--pretty` for formatted output. Pass `--summary` to return `ok`, `summary`, `changed`, the trip vehicle preset, and entity counts without full stop, activity, or route geometry payloads. Route counts distinguish ready, manual, failed, and review-required legs.

Successful responses use a shared envelope:

```json
{
  "ok": true,
  "summary": "Inserted Lisbon after Porto.",
  "changed": {
    "stopsAdded": ["Lisbon"],
    "routesRecalculated": 2
  }
}
```

Failures use:

```json
{
  "ok": false,
  "error": {
    "code": "STOP_LOCATION_REQUIRED",
    "message": "Stop 'Lisbon' needs place coordinates or a place query before it can be added.",
    "path": "stops[2]"
  }
}
```

## Agent-Writable Shapes

### TripDraft

```json
{
  "name": "Iberia loop",
  "stops": []
}
```

Agents may write `name` and an optional ordered array of stop drafts.

### Trip Manifest V1 And V2

Manifest V1 remains readable for existing files. Its exceptional route directives use `type: "shipping-manual"`, and the trip resolves the `standard` vehicle preset.

Manifest V2 requires `vehiclePreset`, creates an automatic driving leg for every adjacent stop pair, and overlays only the exceptional route directives supplied in `routeLegs`:

```json
{
  "manifestVersion": 2,
  "name": "Nordkapp",
  "vehiclePreset": "expedition-truck",
  "stops": [
    {
      "key": "bremen",
      "name": "Bremen",
      "place": { "query": "Bremen, Germany" },
      "expectedStayDays": 1
    },
    {
      "key": "kristiansand",
      "name": "Kristiansand",
      "place": { "query": "Kristiansand, Norway" },
      "expectedStayDays": 1
    }
  ],
  "routeLegs": [
    {
      "fromStopKey": "bremen",
      "toStopKey": "kristiansand",
      "ferryPolicy": "require",
      "waypoints": [
        {
          "name": "Hirtshals ferry terminal",
          "place": { "query": "Hirtshals ferry terminal, Denmark" },
          "links": []
        }
      ]
    }
  ]
}
```

Supported movement/calculation pairs are `drive` + `automatic` and `vehicle-shipping` + `manual`. Route directives must reference adjacent stop keys. Waypoint places and links are resolved and enriched by the same app services used for stops and research links.

Automatic route calculation failure does not roll back an otherwise valid manifest. Failed and review-required legs are persisted, shown in summary counts, and reported by `audit` with exact leg diagnostics. Structural validation failures and activity-distance outliers remain blocking.

### RouteIntentPatch

```json
{
  "movement": "drive",
  "calculation": "automatic",
  "ferryPolicy": "require",
  "waypoints": [
    {
      "name": "Hirtshals ferry terminal",
      "place": { "query": "Hirtshals ferry terminal, Denmark" },
      "notes": "Check in early.",
      "links": ["https://example.com/ferry"]
    }
  ],
  "notes": "Use the booked crossing."
}
```

### StopDraft

```json
{
  "id": "optional-existing-stop-id",
  "name": "Lisbon",
  "place": {
    "query": "Lisbon, Portugal",
    "coordinates": { "lat": 38.7223, "lng": -9.1393 }
  },
  "expectedStayDays": 4,
  "notes": "Booked campsite. Ref: WTB10B2CC9",
  "tags": ["food", "culture"]
}
```

Agents may write `name`, `place`, `expectedStayDays`, `notes`, and `tags`.
At least one of `place.coordinates` or `place.query` is required for a new stop.

### StopPatch

Same writable fields as `StopDraft`, but all optional and `id` is not allowed in the patch body.

### PlaceInput

```json
{
  "query": "Lisbon, Portugal",
  "coordinates": { "lat": 38.7223, "lng": -9.1393 }
}
```

Use `coordinates` when the anchor is known. Use `query` as enrichment context. Both may be present.

### ActivityDraft

```json
{
  "title": "Museu Nacional do Azulejo",
  "place": {
    "query": "Museu Nacional do Azulejo, Lisbon"
  }
}
```

Agents may write `title` and optional `place`.

### ActivityPatch

```json
{
  "title": "Museu Nacional do Azulejo",
  "description": "Tile museum in a former convent.",
  "notes": "Check opening days before going.",
  "tags": ["culture", "tiles"],
  "place": {
    "coordinates": { "lat": 38.7241, "lng": -9.1041 }
  }
}
```

Agents may write `title`, `description`, `notes`, `tags`, and `place`.

### Reorder Inputs

`reorder-stops` and `reorder-activities` accept either a raw string array or an object with `stopIds` / `activityIds`.

```json
["stop-2", "stop-1"]
```

```json
{
  "stopIds": ["stop-2", "stop-1"]
}
```

## What The Service Calculates

The CLI should not ask agents to author fields the app already derives. The service calculates:

- normalized destination and activity records
- route reconciliation after stop changes
- link metadata such as title, domain, preview image, and sort order
- default stop and activity fields that are not user-authored
- route geometry when OpenRouteService is available
- failure states for invalid places, ids, URLs, or duplicates

Write stops, activities, and route intent. Let the service derive routes, links, and default fields.

## Itinerary Interpretation

When turning prose, notes, or booking material into trip commands:

- Overnight locations are route stops.
- Places visited between overnight locations are activities under the nearest relevant stop.
- Accommodation/provider URLs and map URLs for an overnight location are stop links.
- Activity/provider URLs and map URLs for a non-overnight place are activity links.
- Source dates, times, booking references, costs, and status text go into activity notes when attached to an activity.
- Stop-level booking or reference details can go into stop `notes`, but those notes are not currently surfaced in the app UI.
- Date and time fields are not structured in v1.
- Use source coordinates as `place.coordinates` and a human-readable name or address as `place.query` when available.

## Dry-Run And Apply

- `--dry-run` is supported on every write command, including create, update, link, delete, and reorder paths.
- Prefer dry-run first for any agent-authored write before applying it.
- Add `--summary` to dry-runs with many stops or route legs so the preview stays readable.
- `--yes` confirms the write path for destructive commands.
- `replace-stops`, `delete`, `delete-stop`, `delete-activity`, and bulk reorder commands should default to preview-first behavior in wrappers.
- A wrapper should present the structured command and the dry-run result before applying a user-approved write.

## Realtime Refresh

The open app listens to Supabase realtime and refreshes automatically after CLI writes.

- trip list updates refresh the selector
- active-trip changes refresh stops, routes, activities, and links
- media rollups refresh when relevant media changes occur
- bursts of related writes should collapse into one reload

Cross-process IndexedDB refresh is not part of v1.

## Skill Wrapper Guidance

A future Codex skill wrapper should document:

- the command list above
- the JSON input shapes above
- the success and error envelopes
- the safe read / dry-run / apply / verify workflow
- the rule to manipulate stops and let the service derive routes
- the explicit link commands for stop and activity research URLs
- that image automation is not part of v1
- that repeated CLI calls reuse the same local Supabase anonymous session, but large batches should still prefer one long-running process or small command groups
- that `--summary` is available for compact previews and link-add commands are idempotent

The wrapper should prefer narrow commands such as `insert-stop`, `update-stop`, `reorder-stops`, `create-activity`, `update-activity`, and link add/delete commands unless the user explicitly asks for a broad replacement.

## Environment

The CLI reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, then creates or reuses an anonymous Supabase session with the publishable key.

The Node CLI stores its reusable anonymous session in `~/.plotter/trip-cli-session-<supabase-host>.json` with file mode `0600`. On first use it safely copies a valid legacy `~/.world-tour/` session forward while retaining the old file. If the cached session cannot be restored, the CLI clears both locations and creates a fresh anonymous session.

Optional environment values used by the command layer:

- `VITE_MAPTILER_API_KEY`
- `VITE_OPENROUTESERVICE_API_KEY`

Image import or upload is not part of the v1 CLI command surface. Any image work remains a user-confirmed app action.
