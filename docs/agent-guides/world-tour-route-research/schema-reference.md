# Route Research Schema Reference

Use this schema for route research plans. Markdown tables are acceptable for human-facing output, but field names should stay stable so another agent can implement the approved plan through the trip data CLI.

## RouteResearchPlan

```json
{
  "routeName": "Home to Nordkapp",
  "start": "Balcombe, West Sussex, UK",
  "end": "Nordkapp, Norway",
  "routeShape": "ambiguous-point-to-point",
  "assumptions": [],
  "corridors": [],
  "recommendedCorridorId": "hybrid-sweden-northern-norway",
  "scopeDecision": null,
  "phases": [],
  "logisticsGates": [],
  "stops": [],
  "openQuestions": [],
  "unsupportedData": [],
  "implementationNotes": []
}
```

## Allowed Values

`routeShape`:

- `ambiguous-point-to-point`
- `official-scenic-route`
- `mega-corridor`
- `region-loop`
- `open-ended-route-family`
- `regional-corridor`

`priority`:

- `must-do`
- `strong`
- `optional`
- `practical`

`classification`:

- `anchor`
- `experience`
- `scenic-transit`
- `practical`
- `buffer`

`vehicleConfidence`:

- `good`
- `check`
- `likely-difficult`

`evidenceLevel`:

- `high`
- `medium`
- `low`

`density`:

- `compressed`
- `immersive`
- `exhaustive`

`phaseStatus`:

- `researchable`
- `blocked`
- `deferred`

`logisticsGate.type`:

- `route-discontinuity`
- `border-crossing`
- `vehicle-shipping`
- `seasonal-access`
- `permit-or-booking`
- `road-status-check`

## CorridorOption

```json
{
  "id": "hybrid-sweden-northern-norway",
  "name": "Hybrid Sweden northbound with scenic northern Norway",
  "summary": "Efficient southern transit, then scenic Arctic Norway.",
  "strengths": ["Fewer ferry dependencies"],
  "tradeoffs": ["Less fjord-heavy than the coast route"],
  "evidenceLevel": "medium",
  "sources": []
}
```

## ScopeDecision

```json
{
  "coverage": "full-route",
  "direction": "north-to-south",
  "density": "immersive",
  "rationale": "The canonical route is already defined, so stop selection should choose base stops along that route.",
  "sectionOptions": []
}
```

## RoutePhase

```json
{
  "id": "central-america",
  "name": "Central America",
  "summary": "Guatemala to Panama, with border and security validation before final routing.",
  "start": "Guatemala",
  "end": "Panama City, Panama",
  "routeShape": "regional-corridor",
  "status": "researchable",
  "density": "immersive",
  "corridorOptions": [],
  "logisticsGateIds": ["darien-gap-vehicle-shipping"],
  "candidateStops": [],
  "openQuestions": [],
  "blockedReason": null,
  "restartOptions": []
}
```

For blocked or deferred phases, keep `candidateStops` empty unless the user explicitly approves researching a reachable subsection. Use `blockedReason` to explain the hard constraint and `restartOptions` for choices such as overflying, vehicle shipping, restarting with a rental or local vehicle, or deferring the phase.

## LogisticsGate

Use `logisticsGates` as the canonical home for route constraints and validation items that must be resolved before implementation.

```json
{
  "id": "darien-gap-vehicle-shipping",
  "name": "Darien Gap vehicle shipping",
  "type": "route-discontinuity",
  "between": ["Panama", "Colombia"],
  "impact": "Vehicle travel is not continuous; plan vehicle shipping and passenger transfer separately.",
  "requiredDecision": "Choose shipping method, ports, agent, and timing before implementing this phase.",
  "vehicleConfidence": "check",
  "evidenceLevel": "high",
  "sources": []
}
```

## CandidateStop

```json
{
  "name": "Alta",
  "countryRegion": "Finnmark, Norway",
  "stopType": ["town", "practical", "buffer"],
  "classification": ["practical", "buffer"],
  "priority": "strong",
  "score": 4,
  "suggestedStay": "1 night",
  "tags": ["practical-route", "resupply", "buffer-stop"],
  "coordinates": { "lat": 69.9689, "lng": 23.2716 },
  "whyItMatters": "Useful Arctic base before Honningsvag and Nordkapp.",
  "vehicleConfidence": "good",
  "evidenceLevel": "medium",
  "notes": "Validate current road and weather conditions close to travel.",
  "sources": [],
  "activities": []
}
```

## CandidateActivity

```json
{
  "title": "North Cape Plateau",
  "activityType": ["landmark", "viewpoint"],
  "priority": "must-do",
  "score": 5,
  "tags": ["viewpoint", "seasonal-access"],
  "coordinates": { "lat": 71.1695, "lng": 25.783 },
  "whyItMatters": "Symbolic destination at the end of the route.",
  "vehicleConfidence": "check",
  "evidenceLevel": "high",
  "notes": "Winter access may require convoy travel on the final E69 section.",
  "sources": []
}
```

## Tag Guidance

Use `tags` for lightweight routing, filtering, and UI badges. Tags must come from this controlled vocabulary.

Route variant tags:

- `official-route`
- `adventure-variant`
- `practical-route`
- `optional-detour`

Access and logistics tags:

- `road-status-check`
- `seasonal-access`
- `permit-or-booking`
- `border-crossing`
- `high-clearance-4wd`

Stop role tags:

- `resupply`
- `recovery-stop`
- `buffer-stop`

Experience tags:

- `history`
- `nature`
- `coast`
- `mountains`
- `gorge`
- `caves`
- `wildlife`
- `culture`
- `food`
- `walk`
- `viewpoint`

Do not invent route-specific tags during research. If a useful detail does not fit the vocabulary, put it in `notes`, `logisticsGates`, or `openQuestions`.

Tags are not a separate route-variant model. If a route later needs first-class alternatives, use tags as the evidence for what should be promoted.

## SourceEvidence

```json
{
  "title": "Visit Nordkapp practical information",
  "url": "https://www.nordkapp.no/practical-info/",
  "sourceType": "official",
  "usedFor": ["seasonal access", "vehicle confidence"],
  "retrievedAt": "2026-07-08",
  "confidence": "high"
}
```

## Unsupported Data

Do not include these values in a route research plan as app-writeable data:

- Route geometry, encoded polylines, route-leg alternatives, or calculated distances/durations.
- Normalized app locations, reverse-geocoded labels, provider place IDs, or location enrichment that the app can calculate.
- Stop sort indexes, timestamps, sync metadata, row IDs, or direct Supabase table shapes.
- Link previews, downloaded media, image uploads, or local file references.
- Final activity/stop IDs or ownership metadata.

If one of these details matters to the recommendation, describe the caveat in `notes`, `logisticsGates`, `openQuestions`, or `implementationNotes` instead of treating it as data for the trip CLI to write.

## Implementation Mapping

- Approved `CandidateStop` records become stop drafts for the trip CLI.
- Approved `CandidateActivity` records become activities under the nearest approved stop.
- Approved candidate `tags` become stop or activity tags.
- Candidate and activity `sources.url` values become stop or activity links.
- Scores, vehicle warnings, logistics gates, caveats, and evidence notes become notes.
- Coordinates are passed only when sourced.
- Route geometry is never authored.
- Blocked or deferred phases are not implemented as stops or activities until the user approves a resolved restart, skip, or deferral plan.
