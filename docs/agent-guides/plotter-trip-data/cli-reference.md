# Trip CLI Reference

Use from the repository root.

## Commands

```bash
npm run trip -- list --pretty
npm run trip -- get --trip-id <id> --include-activities --include-links --summary --pretty
npm run trip -- create --input ./trip-manifest.json --summary --pretty
npm run trip -- create --input ./trip-manifest.json --dry-run --summary --pretty
npm run trip -- audit --trip-id <id> --pretty
npm run trip -- recalculate-failed-routes --trip-id <id> --summary --pretty
npm run trip -- rename --trip-id <id> --name "North Coast 500 Trip"
npm run trip -- set-vehicle --trip-id trip-1 --preset expedition-truck --dry-run
npm run trip -- set-vehicle --trip-id trip-1 --preset expedition-truck --yes
npm run trip -- update-route-leg --trip-id trip-1 --route-leg-id leg-1 --input /tmp/route-intent.json --dry-run
npm run trip -- update-route-leg --trip-id trip-1 --route-leg-id leg-1 --input /tmp/route-intent.json
npm run trip -- delete --trip-id <id> --dry-run
npm run trip -- delete --trip-id <id> --yes
```

```bash
npm run trip -- replace-stops --trip-id <id> --input ./stops.json --dry-run --summary --pretty
npm run trip -- replace-stops --trip-id <id> --input ./stops.json --yes --summary --pretty
npm run trip -- insert-stop --trip-id <id> --after-stop-id <id> --input ./stop.json --dry-run --pretty
npm run trip -- insert-stop --trip-id <id> --before-stop-id <id> --input ./stop.json --dry-run --pretty
npm run trip -- update-stop --trip-id <id> --stop-id <id> --input ./patch.json --dry-run --pretty
npm run trip -- delete-stop --trip-id <id> --stop-id <id> --dry-run
npm run trip -- delete-stop --trip-id <id> --stop-id <id> --yes
npm run trip -- reorder-stops --trip-id <id> --input ./stop-order.json --strict --dry-run --summary --pretty
```

```bash
npm run trip -- add-stop-link --trip-id <id> --stop-id <id> --url https://example.com --pretty
npm run trip -- delete-stop-link --trip-id <id> --stop-id <id> --link-id <id> --dry-run --pretty
```

```bash
npm run trip -- list-activities --trip-id <id> --stop-id <id> --pretty
npm run trip -- create-activity --trip-id <id> --stop-id <id> --input ./activity.json --dry-run --pretty
npm run trip -- update-activity --trip-id <id> --activity-id <id> --input ./activity-patch.json --dry-run --pretty
npm run trip -- delete-activity --trip-id <id> --activity-id <id> --dry-run
npm run trip -- reorder-activities --trip-id <id> --stop-id <id> --input ./activity-order.json --dry-run --pretty
```

```bash
npm run trip -- add-activity-link --trip-id <id> --activity-id <id> --url https://example.com --pretty
npm run trip -- delete-activity-link --trip-id <id> --activity-id <id> --link-id <id> --dry-run --pretty
```

## Writable JSON

Place input is shared by stops and activities:

```json
{
  "query": "Museu Nacional do Azulejo, Lisbon",
  "coordinates": { "lat": 38.7241, "lng": -9.1041 }
}
```

Use `query`, `coordinates`, or both. Do not provide an `address` field directly; the app resolves address/location metadata from the place input when possible.

Trip draft:

```json
{
  "name": "Iberia loop",
  "stops": []
}
```

Compatibility only — legacy manifest V1 input remains readable for existing files and resolves the `standard` preset. Do not use V1 or its legacy `type` directive in new work.

Use manifest V2 for every new agent-authored trip. The current V2 contract uses `movement` plus `calculation`, requires `vehiclePreset`, creates every ordinary adjacent automatic leg, and overlays only exceptional directives from `routeLegs`:

```json
{
  "manifestVersion": 2,
  "name": "Nordkapp summer loop",
  "vehiclePreset": "expedition-truck",
  "stops": [
    {
      "key": "larvik",
      "name": "Larvik",
      "place": {
        "query": "Larvik ferry terminal, Norway",
        "coordinates": { "lat": 59.0533, "lng": 10.0352 }
      },
      "expectedStayDays": 1,
      "notes": "Ferry staging stop.",
      "tags": ["practical-route", "permit-or-booking"],
      "links": ["https://www.colorline.com/denmark-norway"],
      "activities": []
    },
    {
      "key": "hirtshals",
      "name": "Hirtshals",
      "place": { "query": "Hirtshals, Denmark" },
      "expectedStayDays": 1,
      "notes": "Post-ferry buffer.",
      "tags": ["buffer-stop", "coast"],
      "links": [],
      "activities": [
        {
          "title": "Visit Hirtshals harbour",
          "place": {
            "query": "Hirtshals Havn, Denmark",
            "coordinates": { "lat": 57.5911, "lng": 9.9664 }
          },
          "description": "Short harbour walk after the crossing.",
          "notes": "Keep flexible around the sailing.",
          "tags": ["walk", "coast"],
          "links": ["https://example.com/harbour"]
        }
      ]
    }
  ],
  "routeLegs": [
    {
      "fromStopKey": "larvik",
      "toStopKey": "hirtshals",
      "ferryPolicy": "require",
      "waypoints": [
        {
          "name": "Hirtshals ferry terminal",
          "place": { "query": "Hirtshals ferry terminal, Denmark" },
          "links": []
        }
      ],
      "notes": "Use the approved Hirtshals crossing."
    }
  ]
}
```

The app calculates every omitted ordinary adjacent route automatically. The directive above exists only because the approved plan materially requires the Hirtshals ferry and terminal waypoint.

Requirements:

- `manifestVersion` is `2` and `vehiclePreset` is `standard`, `large-camper`, or `expedition-truck`.
- Stop `key` values are unique and route directives connect adjacent keys in canonical order.
- Every stop has an explicit positive integer `expectedStayDays`; use `1` for departure and return anchors.
- Omitted `tags`, `links`, `activities`, and `routeLegs` become empty arrays.
- Use sourced coordinates for short or ambiguous names such as `A`, named viewpoints, trailheads, and ferry terminals. A specific query is otherwise sufficient.
- Omit route directives for ordinary adjacent `drive` + `automatic` legs, including normal ferry, tunnel, bridge, and vehicle-shuttle crossings; `allow` and empty waypoints are implicit.
- Add ordered waypoints only when a named place materially shapes a route. Add `ferryPolicy: "avoid"` or `"require"` only when ferry intent is material.
- Use `movement: "vehicle-shipping"` plus `calculation: "manual"` only for an approved genuine discontinuity or independent vehicle-shipping transfer.
- Do not author IDs, normalized location/address metadata, or the app-derived route fields listed below.

Use this manifest directive only for an approved discontinuity that cannot be represented by automatic driving routing:

```json
{
  "fromStopKey": "vehicle-shipping-origin",
  "toStopKey": "vehicle-shipping-destination",
  "movement": "vehicle-shipping",
  "calculation": "manual",
  "notes": "Approved vehicle-shipping transfer around a physical route discontinuity."
}
```

Existing-trip route-intent patch:

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
      "links": []
    }
  ],
  "notes": "Use the approved crossing."
}
```

Writable route-intent fields are exactly `movement`, `calculation`, `ferryPolicy`, ordered `waypoints`, and `notes`. A waypoint draft may contain `name`, `place.query` and/or sourced `place.coordinates`, `notes`, and `links` as URL strings.

Endpoint selection differs by workflow:

- A manifest V2 directive selects one adjacent stop pair with `fromStopKey` and `toStopKey`. These manifest selectors are required on the directive but are not route-intent patch fields.
- For an existing trip, `update-route-leg` selects the stored leg with `--route-leg-id`. Its patch cannot change the app-owned route-leg `id`, `originDestinationId`, or `targetDestinationId`.

The complete current non-writable route-leg state is: `id`, `originDestinationId`, `targetDestinationId`, `status`, `geometry`, `distanceKm`, `travelTimeHours`, `provider`, `profile`, `routeKey`, `calculatedAt`, `sections`, `warnings`, `error`, `createdAt`, and `updatedAt`. Never put these fields in a manifest directive or `update-route-leg` input.

Route-recovery ownership rules:

- Copy the approved vehicle preset without changing it.
- Treat routing anchors, profile fallback, provider retries, geometry, and recovery warnings as app-owned data.
- A ready route may include `ROUTING_ANCHOR_ADJUSTED` or `VEHICLE_PROFILE_FALLBACK`; report the qualification but do not replan or rewrite the route.

For stored waypoints, the app owns `id`, `order`, normalized `coordinates`, and resolved location/address/provider metadata. A supplied waypoint-draft `place.coordinates` remains valid source input; do not confuse it with the normalized stored `coordinates` field. The app also enriches each waypoint URL into stored `ResearchLink` metadata: `id`, `title`, normalized `url`, `domain`, `imageUrl`, `sortOrder`, and `previewFetchedAt`. Draft `links` remain writable URL strings.

Vehicle changes require confirmation. Preview and apply are separate commands:

```bash
npm run trip -- set-vehicle --trip-id trip-1 --preset expedition-truck --dry-run
npm run trip -- set-vehicle --trip-id trip-1 --preset expedition-truck --yes
```

`update-route-leg` uses the implemented exact apply form below and does not require `--yes`. Add `--dry-run` only for a separate preview:

```bash
npm run trip -- update-route-leg --trip-id trip-1 --route-leg-id leg-1 --input /tmp/route-intent.json
```

For an approved new trip, perform one create and one audit:

```bash
npm run trip -- create --input /tmp/trip-manifest.json --summary --pretty
npm run trip -- audit --trip-id <trip-id> --pretty
```

For an existing trip, use the exact commands shown in the Commands section after reading the trip to obtain its route-leg IDs.

Stop draft:

```json
{
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

Stop patch uses the same writable fields as stop draft, but all optional and no `id`.

Use stop `tags` for approved route variants, access constraints, themes, and practical roles from the controlled route-research tag vocabulary.

Activity draft:

```json
{
  "title": "Museu Nacional do Azulejo",
  "place": {
    "query": "Museu Nacional do Azulejo, Lisbon",
    "coordinates": { "lat": 38.7241, "lng": -9.1041 }
  }
}
```

Activity drafts intentionally stay focused, but they can include `place.query`, `place.coordinates`, or both. To add activity tags, notes, description, or a refined place after creation, run `update-activity` with an activity patch.

Activity patch:

```json
{
  "title": "Museu Nacional do Azulejo",
  "description": "Tile museum in a former convent.",
  "notes": "Check opening days before going.",
  "tags": ["culture", "history"],
  "place": {
    "query": "Museu Nacional do Azulejo, Lisbon",
    "coordinates": { "lat": 38.7241, "lng": -9.1041 }
  }
}
```

Use activity `tags` for approved themes, constraints, and route-variant context from the controlled route-research tag vocabulary.

Reorder input:

```json
{
  "stopIds": ["stop-2", "stop-1"]
}
```

```json
{
  "activityIds": ["activity-2", "activity-1"]
}
```

## Output

Default success envelope:

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

Failure envelope:

```json
{
  "ok": false,
  "error": {
    "code": "STOP_LOCATION_REQUIRED",
    "message": "Place input is required.",
    "path": "stops[2].place"
  }
}
```

`--summary` keeps `ok`, `summary`, `changed`, and `counts` while omitting full stop/activity/route payloads.

For full creation and route recovery, counts include stops, activities, links, total route legs, ready/manual/failed/review-required route legs, the vehicle preset, and audit errors/warnings. Audit issues remain visible. Structural validation and activity-distance outliers block persistence.

Automatic route-provider failure does not roll back an otherwise valid manifest. The app persists the trip and approved intent, marks or retains the affected leg as failed or review-required, and reports exact diagnostics through `audit`. Do not replan, change stops, weaken ferry intent, remove waypoints, switch to manual routing, or author substitute geometry. Retry persisted failed automatic legs with `recalculate-failed-routes`, then audit again.

`recalculate-failed-routes` retries transient provider rate limits internally. Its full output reports `failedRoutesBefore`, `failedRoutesAfter`, and one `recalculatedRoutes` entry per attempted leg with `routeLegId`, `originName`, `targetName`, and final `status`; any stable failure remains in `routeLegs` with its provider error text. Run `audit` afterward for structured `FAILED_ROUTE_LEG` diagnostics containing the leg ID plus `origin` and `target` IDs, names, coordinates, resolved labels, and source providers when available.

Audit issues include structured location context for implicated entities. Activity outliers include `destination` and `activity`; failed or implausible driving legs include `origin` and `target`. Each context contains the entity `id`, display `name`, resolved `coordinates`, `resolvedLabel`, and `sourceProvider` when available. Inspect these fields before reaching for source-code inspection or a custom route diagnostic.

## Verification Snippet

For concise readback, save full JSON then summarize locally:

```bash
npm --silent run trip -- get --trip-id <id> --include-activities --include-links --pretty > /tmp/trip-readback.json
node - <<'NODE'
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('/tmp/trip-readback.json', 'utf8'));
if (!data.ok) throw new Error(JSON.stringify(data.error));
const trip = data.trip;
const rows = trip.stops.map((stop, index) => ({
  order: index + 1,
  stop: stop.name,
  links: stop.research.links.length,
  activities: (trip.activitiesByStopId?.[stop.id] ?? []).map((activity) => ({
    title: activity.title,
    links: activity.links.length,
  })),
}));
console.log(JSON.stringify({
  trip: trip.trip.name,
  stops: rows.length,
  routeLegs: trip.routeLegs.length,
  readyRouteLegs: trip.routeLegs.filter((leg) => leg.status === 'ready').length,
  rows,
}, null, 2));
NODE
```
