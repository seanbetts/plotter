# Route Research Schema Reference

Use this schema for route research plans. Markdown tables are acceptable for human-facing output, but field names should stay stable so another agent can implement the approved plan through the trip data CLI.

All values in the JSON examples are synthetic structural fixtures. Reserved `example.com` URLs are placeholders; a live plan must use current, traceable sources and must not reuse fixture assumptions or recommendations.

## RouteResearchPlan

```json
{
  "routeName": "Home to Remote Endpoint",
  "start": "Home",
  "end": "Remote Endpoint",
  "routeShape": "ambiguous-point-to-point",
  "researchDepth": "candidate-plan",
  "assumptions": [],
  "corridors": [],
  "recommendedCorridorId": "hybrid-scenic-finish",
  "scopeDecision": null,
  "expeditionViability": null,
  "phases": [],
  "logisticsGates": [],
  "sourceEvidence": [],
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
- `remote-expedition-track`

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

`researchDepth`:

- `sketch`
- `candidate-plan`
- `handoff-ready`

Older references to `implementation-ready` mean `handoff-ready`. Do not emit `implementation-ready` in new plans.

`RoutePhase.status`:

- `researchable`
- `blocked`
- `deferred`

`CorridorOption.status`:

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
- `safety-advisory`
- `vehicle-import`
- `insurance-customs`
- `restricted-area`
- `ferry-or-operator`

`logisticsGate.severity`:

- `blocking-decision`
- `pre-implementation-check`
- `travel-time-validation`

`sourceType`:

- `official`
- `operator`
- `community`
- `guidebook`
- `map`
- `review`
- `trip-report`
- `media`
- `user-provided`

## CorridorOption

```json
{
  "id": "hybrid-scenic-finish",
  "name": "Efficient inland transit with a scenic finish",
  "summary": "Efficient long-distance transit, then a scenic final region.",
  "status": "researchable",
  "strengths": ["Fewer ferry dependencies"],
  "tradeoffs": ["Misses some scenery on the fully scenic corridor"],
  "blockers": [],
  "restartOptions": [],
  "researchablePhaseIds": ["long-distance-transit", "destination-region"],
  "requiredDecision": "Choose this as the default corridor before detailed stop selection.",
  "evidenceLevel": "medium",
  "sources": []
}
```

For open-ended geopolitical route families, use `corridors` as a corridor viability matrix before selecting candidate stops. Put border closures, visa constraints, conflict advisories, permit requirements, shipping constraints, and hard seasonal issues in `blockers`; put overfly, shipping, restart, or deferral choices in `restartOptions`.

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

## ExpeditionViability

Use `expeditionViability` before candidate stop selection for remote expedition tracks where logistics, access, permits, and recovery risk determine whether the route is viable.

```json
{
  "status": "researchable",
  "seasonWindow": "May to September",
  "requiredVehicle": "High-clearance 4WD with long-range fuel, water, spares, recovery equipment, and communications.",
  "permits": [
    {
      "name": "Remote track visitor permit",
      "status": "required",
      "sourceIds": ["current-permit-authority"]
    }
  ],
  "fuelWaterPlan": [
    "Confirm fuel, food, and water availability before departure.",
    "Carry enough range for long remote legs between confirmed resupply points."
  ],
  "communicationsAndRecovery": [
    "No mobile reception should be assumed.",
    "Carry satellite communications and recovery equipment."
  ],
  "officialRoadConditionSources": [],
  "bailoutOptions": [],
  "culturalAccessNotes": [
    "Do not list culturally sensitive sites as activities unless public visitor access is explicitly confirmed."
  ],
  "blockers": [],
  "requiredDecision": "Confirm permits, season, vehicle suitability, resupply, communications, and bailout plan before stop selection."
}
```

Allowed `expeditionViability.status` values match `RoutePhase.status`: `researchable`, `blocked`, or `deferred`.

## RoutePhase

```json
{
  "id": "regional-transit",
  "name": "Regional transit",
  "summary": "A cross-border regional phase with access validation before final routing.",
  "start": "Regional Gateway",
  "end": "Transfer Port",
  "routeShape": "regional-corridor",
  "status": "researchable",
  "density": "immersive",
  "corridorOptions": [],
  "logisticsGateIds": ["route-discontinuity-transfer"],
  "candidateStops": [],
  "openQuestions": [],
  "blockedReason": null,
  "restartOptions": []
}
```

For blocked or deferred phases, keep `candidateStops` empty unless the user explicitly approves researching a reachable subsection. Use `blockedReason` to explain the hard constraint and `restartOptions` for choices such as overflying, vehicle shipping, restarting with a rental or local vehicle, or deferring the phase.

## LogisticsGate

Use `logisticsGates` as the canonical home for route blockers, pre-write checks, and travel-time refresh reminders.

```json
{
  "id": "route-discontinuity-transfer",
  "name": "Route discontinuity transfer",
  "type": "route-discontinuity",
  "severity": "blocking-decision",
  "appliesToRecommendedRoute": true,
  "appliesToVariantId": null,
  "appliesToPhaseId": "regional-transit",
  "conditionalOn": null,
  "between": ["Transfer Port", "Restart Port"],
  "impact": "Vehicle travel is not continuous; plan vehicle shipping and passenger transfer separately.",
  "requiredDecision": "Choose shipping method, ports, agent, and timing before implementing this phase.",
  "vehicleConfidence": "check",
  "evidenceLevel": "high",
  "sources": []
}
```

Set severity by consequence. Use `blocking-decision` when an unresolved condition invalidates the affected route, phase, or variant until it is resolved or the user chooses a viable alternative. Use `pre-implementation-check` when research can continue and the unresolved issue does not invalidate the route, but it should normally be resolved before writing affected trip data. Use `travel-time-validation` for routine current checks such as road, weather, ferry, access, seasonal status, ambitious driving days, ferry-dependent days, remote access, or dense activity days that should be refreshed close to travel.

A current closure, unavailable required authorization, confirmed restricted access, broken physical continuity, or safety condition that makes the affected route non-viable is blocking. A routinely obtainable permit, booking, timetable, or operational detail may be a pre-implementation check when failure would not invalidate the approved route.

Gate scope matters. A conditional gate on an unchosen variant is not a blocker for the recommended route. A gate in one mega-corridor phase is not a blocker for unrelated researchable phases. Use `appliesToRecommendedRoute`, `appliesToVariantId`, `appliesToPhaseId`, and `conditionalOn` to show what the gate affects.

Severity-specific handoff:

- `blocking-decision`: do not write affected stops or activities yet.
- `pre-implementation-check`: resolve before writing affected data, or preserve as a note only when the uncertainty does not invalidate the route and the user explicitly accepts it.
- `travel-time-validation`: safe to write as a refresh reminder note.

Scope `travel-time-validation` to the affected route, phase, variant, stop pair, or activity day. Do not use it as a blocker unless the uncertainty changes the route choice.

For mega-corridors, every blocking or pre-implementation gate should identify the affected phase or variant and what must be resolved or decided. Preserve researchable phases separately from blocked or deferred phases; attach scoped gates to researchable phases that still need checks.

## CandidateStop

Top-level `stops` array order is canonical for implementation. For phased routes, preserve phase order first, then `candidateStops` order inside each phase. If a human-facing table is flattened, include an explicit order column.

```json
{
  "name": "Final Resupply Base",
  "countryRegion": "Destination Region",
  "stopType": ["town", "practical", "buffer"],
  "classification": ["practical", "buffer"],
  "priority": "strong",
  "score": 4,
  "suggestedStay": "1 night",
  "tags": ["practical-route", "resupply", "buffer-stop"],
  "placeQuery": "Final Resupply Base, Destination Region",
  "coordinates": { "lat": 45.0, "lng": 7.0 },
  "whyItMatters": "Useful resupply and buffer base before the remote endpoint.",
  "vehicleConfidence": "good",
  "evidenceLevel": "medium",
  "notes": "Validate current road and weather conditions close to travel.",
  "sources": ["current-road-authority"],
  "activities": []
}
```

## CandidateActivity

Schema-native activities should stay nested under their parent `CandidateStop`. If a human-facing table is flattened, include the parent stop name so the trip data agent can attach the activity correctly.

```json
{
  "title": "Remote Endpoint Viewpoint",
  "activityType": ["landmark", "viewpoint"],
  "priority": "must-do",
  "score": 5,
  "tags": ["viewpoint", "seasonal-access"],
  "placeQuery": "Remote Endpoint Viewpoint, Destination Region",
  "coordinates": { "lat": 45.5, "lng": 7.5 },
  "whyItMatters": "Symbolic destination at the end of the route.",
  "vehicleConfidence": "check",
  "evidenceLevel": "high",
  "notes": "Seasonal access may require a controlled final-road procedure.",
  "sources": ["current-access-authority", "current-road-authority"]
}
```

## Tag Guidance

Use `tags` for lightweight routing, filtering, UI badges, and handoff. Tags must come from this controlled vocabulary.

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

Use the fewest tags that materially distinguish the candidate. Do not apply broad experience tags to every stop on a route just because the whole route has that theme. For official scenic routes, `official-route` may be common across base stops, but experience tags should describe the specific stop or activity. Prefer activity-level tags when the theme belongs to a sight, walk, meal, or viewpoint rather than the overnight base.

Tags are not a separate route-variant model. If a route later needs first-class alternatives, use tags as the evidence for what should be promoted.

If a useful tag is repeatedly missing, add the proposed value and rationale to `implementationNotes` or `openQuestions`; do not place it in candidate `tags` until the controlled vocabulary is updated.

Candidate future tags backlog: `city`, `scenic-drive`, `ferry`, `camping`, `lake`, `desert`, and `beach`. These are not allowed candidate tags until explicitly promoted into the controlled vocabulary.

## SourceEvidence

```json
{
  "id": "current-access-authority",
  "title": "Current access authority",
  "url": "https://example.com/current-access-authority",
  "sourceType": "official",
  "usedFor": ["seasonal access", "vehicle confidence"],
  "retrievedAt": "2026-07-10",
  "confidence": "high"
}
```

Use `sourceEvidence` as the top-level canonical source table for a route research plan. Source IDs are required whenever candidates, logistics gates, corridors, or phases refer to sources by ID. Candidate `sources` may contain source IDs or inline source evidence objects; prefer source IDs in `candidate-plan` and `handoff-ready` outputs. Allowed `sourceType` values are listed above.

The user-facing answer may cite sources compactly, but the research artifact should keep route-defining claims, safety or advisory claims, operator/logistics claims, anchor stops, material activities, and validation gates traceable to source IDs or links.

If the visible answer names a specific authority, advisory, ferry, shipper, operator, permit body, or official route source, include a visible link in the answer or a matching `sourceEvidence` entry in the handoff artifact.

## Unsupported Data

Do not include these values in a route research plan as app-writeable data:

- Route geometry, encoded polylines, route-leg alternatives, or calculated distances/durations.
- Normalized app locations, reverse-geocoded labels, provider place IDs, or location enrichment that the app can calculate.
- Stop sort indexes, timestamps, sync metadata, row IDs, or direct Supabase table shapes.
- Link previews, downloaded media, image uploads, or local file references.
- Final activity/stop IDs or ownership metadata.
- App-resolved address fields or provider location metadata. Use `placeQuery` for source address or venue text that should help the app resolve a place.

If one of these details matters to the recommendation, describe the caveat in `notes`, `logisticsGates`, `openQuestions`, or `implementationNotes` instead of treating it as data for the trip CLI to write.

## Implementation Mapping

- Approved `CandidateStop` records become stop drafts for the trip CLI.
- Approved `CandidateActivity` records become activities under the nearest approved stop.
- Approved `placeQuery` values become `place.query` for both stop and activity writes.
- Approved `coordinates` values become `place.coordinates` for both stop and activity writes.
- Approved candidate `tags` become stop or activity tags.
- Candidate and activity source IDs or inline `sources.url` values become stop or activity links.
- Scores, vehicle warnings, logistics gates, caveats, and evidence notes become notes.
- `blocking-decision` gates prevent writing affected content until resolved.
- `pre-implementation-check` gates are resolved before writing affected content or preserved as notes only when they do not invalidate the route and the user explicitly accepts the uncertainty.
- `travel-time-validation` gates are safe to write as refresh reminder notes.
- Expedition viability details become route-level planning notes or stop notes on the nearest practical anchor.
- Coordinates are passed only when sourced.
- Route geometry is never authored.
- Blocked or deferred phases are not implemented as stops or activities until the user approves a resolved restart, skip, or deferral plan.
