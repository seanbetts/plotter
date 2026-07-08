# Trip CLI Reference

Use from the repository root.

## Commands

```bash
npm run trip -- list --pretty
npm run trip -- get --trip-id <id> --include-activities --include-links --summary --pretty
npm run trip -- create --input ./trip.json --dry-run --pretty
npm run trip -- rename --trip-id <id> --name "North Coast 500 Trip"
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

Trip draft:

```json
{
  "name": "Iberia loop",
  "stops": []
}
```

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

Activity draft:

```json
{
  "title": "Museu Nacional do Azulejo",
  "place": {
    "query": "Museu Nacional do Azulejo, Lisbon"
  }
}
```

Activity patch:

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
