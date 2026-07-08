# Trip Data CLI

The trip CLI lets agents and local scripts read and write Supabase-backed world-tour trip data through app-owned commands.

## Safety Workflow

1. Read current state with `npm run trip -- list` and `npm run trip -- get --trip-id <id> --include-activities --include-links`.
2. Prefer narrow commands such as `insert-stop`, `update-stop`, `create-activity`, and link add/delete commands.
3. Use `--dry-run` for broad or destructive writes.
4. Use `--yes` only after the user has approved the change.
5. The open app refreshes automatically through Supabase realtime after CLI writes.

## Command List

### Trips

```bash
npm run trip -- list
npm run trip -- get --trip-id <id> --include-activities --include-links
npm run trip -- create --input ./trip.json
npm run trip -- delete --trip-id <id> --dry-run
npm run trip -- delete --trip-id <id> --yes
npm run trip -- rename --trip-id <id> --name "North Coast 500 Trip"
```

### Stops

```bash
npm run trip -- replace-stops --trip-id <id> --input ./stops.json --dry-run
npm run trip -- insert-stop --trip-id <id> --after-stop-id <id> --before-stop-id <id> --input ./stop.json
npm run trip -- update-stop --trip-id <id> --stop-id <id> --input ./patch.json
npm run trip -- delete-stop --trip-id <id> --stop-id <id> --dry-run
npm run trip -- reorder-stops --trip-id <id> --input ./stop-order.json --strict
```

### Stop Links

```bash
npm run trip -- add-stop-link --trip-id <id> --stop-id <id> --url https://example.com
npm run trip -- delete-stop-link --trip-id <id> --stop-id <id> --link-id <id>
```

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

Commands print JSON to stdout by default. Pass `--pretty` for formatted output.

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

### LinkDraft

```json
{
  "url": "https://example.com/lisbon-guide"
}
```

Agents provide only the URL. The service derives the rest.

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

Write stops and activities. Let the service derive routes, links, and default fields.

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

- `--dry-run` previews destructive or broad changes without saving.
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

The wrapper should prefer narrow commands such as `insert-stop`, `update-stop`, `reorder-stops`, `create-activity`, `update-activity`, and link add/delete commands unless the user explicitly asks for a broad replacement.

## Environment

The CLI reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, then creates or reuses an anonymous Supabase session with the publishable key.

Optional environment values used by the command layer:

- `VITE_MAPTILER_API_KEY`
- `VITE_OPENROUTESERVICE_API_KEY`

Image import or upload is not part of the v1 CLI command surface. Any image work remains a user-confirmed app action.
