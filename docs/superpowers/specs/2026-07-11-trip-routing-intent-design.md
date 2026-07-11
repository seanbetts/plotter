# Trip Routing Intent Design

Date: 2026-07-11

## Goal

Extend the app's existing OpenRouteService-backed route calculation so trips can express a vehicle class and exceptional route intent without asking users or agents to author geometry or manage ordinary route legs.

The feature must work identically when stops are changed through the app UI or the trip CLI. The route-research skill decides itinerary semantics. The trip-data skill writes the approved data mechanically. The app owns route defaults, calculation, validation, persistence, and realtime updates.

## Problems To Solve

The current app calculates every automatic leg with `driving-car` and two endpoint coordinates. Route legs only distinguish `driving-auto` from `shipping-manual`.

This causes several practical problems:

- Large campers and expedition trucks are routed as ordinary cars.
- A researched route cannot say that an automatic leg must pass through a waypoint.
- A researched route cannot distinguish allowing, avoiding, or requiring a routable ferry.
- Ferry geometry returned by OpenRouteService is not identified in the stored route or map rendering.
- A technically valid but implausible route can be accepted, as happened when Bremen to Hirtshals was routed through an unintended ferry detour.
- The trip-data agent can be drawn into reconstructing or revising route decisions that belong to route research.

## Design Principles

- Stops remain ordered overnight stays.
- Activities remain things to do around a stop.
- Waypoints are lightweight locations an automatic route must pass through; they are not stops or activities.
- The same vehicle applies to the entire trip.
- Users choose one of three understandable vehicle presets and do not routinely enter dimensions.
- OpenRouteService continues to calculate exact geometry, distance, and travel time.
- Ordinary ferries are automatic route content, not manual shipping legs.
- Manual vehicle shipping is reserved for genuine route discontinuities or independent vehicle transport.
- Ordinary route intent stays implicit. Exceptional directives are stored only when needed.
- App-owned routing behavior is shared by UI and CLI mutations.
- A valid trip write is not rolled back solely because one or more routes fail or require review.
- The research skill makes semantic decisions once; the trip-data skill does not reinterpret them.

## Scope

This design includes:

- trip-level vehicle presets
- HGV routing restrictions for larger vehicle presets
- ordered route waypoints
- ferry allow, avoid, and require intent
- provider-derived road and ferry route sections
- route-intent validation and suspicious-route diagnostics
- automatic behavior after manual stop changes
- CLI manifest and command changes
- updates to both agent skills and their portable repo guides
- compact UI changes and realtime refresh

## Non-Goals

- public transport journey planning
- a general multimodal segment graph
- per-leg vehicle overrides
- user-authored route geometry
- exact user-configurable dimensions in v1
- a full waypoint or ferry-policy editor in the app UI
- moving planning decisions into the trip-data skill
- replacing OpenRouteService with agent-authored routes

## Vehicle Presets

The app defines three presets:

| Preset | User-facing label | ORS profile | ORS vehicle type | Length | Width | Height | Weight | Axle load |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| `standard` | Standard vehicle | `driving-car` | n/a | n/a | n/a | n/a | n/a | n/a |
| `large-camper` | Large camper | `driving-hgv` | `hgv` | 7.5 m | 2.5 m | 3.2 m | 5 t | 3 t |
| `expedition-truck` | Expedition truck | `driving-hgv` | `hgv` | 9 m | 2.55 m | 3.8 m | 15 t | 7.5 t |

The large-camper HGV profile is a conservative routing approximation. It may avoid roads that are legally available to some motorhomes because OpenRouteService does not provide a dedicated camper profile. None of the presets is a legal-access or physical-clearance guarantee; results depend on available OpenStreetMap restriction data.

Preset definitions are app constants. A resolved restriction snapshot is stored with each trip so an existing trip does not silently change if preset defaults are tuned later. Selecting a preset again refreshes the snapshot from the current app definition.

## Domain Model

### Trip Routing Vehicle

```ts
type VehiclePreset =
  | 'standard'
  | 'large-camper'
  | 'expedition-truck';

type VehicleRestrictions = {
  length?: number;
  width?: number;
  height?: number;
  weight?: number;
  axleLoad?: number;
};

type TripRoutingVehicle = {
  preset: VehiclePreset;
  profile: 'driving-car' | 'driving-hgv';
  vehicleType?: 'hgv';
  restrictions: VehicleRestrictions;
};
```

`TripSummary` gains `routingVehicle: TripRoutingVehicle`. The existing trip description remains unchanged and is not added to agent-writable trip drafts.

### Route Intent

```ts
type RouteMovement = 'drive' | 'vehicle-shipping';
type RouteCalculationMode = 'automatic' | 'manual';
type FerryPolicy = 'allow' | 'avoid' | 'require';

type RouteWaypoint = {
  id: string;
  order: number;
  name: string;
  coordinates: Coordinates;
  location: DestinationLocation;
  notes: string;
  links: ResearchLink[];
};

type RouteSection = {
  kind: 'road' | 'ferry';
  startGeometryIndex: number;
  endGeometryIndex: number;
  distanceKm: number;
};

type RouteIntentSnapshot = {
  movement: RouteMovement;
  calculation: RouteCalculationMode;
  ferryPolicy: FerryPolicy;
  waypoints: RouteWaypoint[];
  notes: string;
};

type RouteWarning = {
  code:
    | 'SUSPICIOUS_DETOUR'
    | 'FERRY_REQUIRED_NOT_FOUND'
    | 'FERRY_AVOIDED_BUT_FOUND'
    | 'ROUTE_INTENT_REASSIGNMENT_REQUIRED';
  message: string;
  context?: {
    sourceRouteLegId: string;
    unresolvedIntent: RouteIntentSnapshot;
  };
};
```

`RouteLeg` replaces its overloaded `type` with:

```ts
type RouteLeg = {
  // Existing identity, endpoints, timestamps, notes, metrics and geometry remain.
  movement: RouteMovement;
  calculation: RouteCalculationMode;
  ferryPolicy: FerryPolicy;
  waypoints: RouteWaypoint[];
  sections: RouteSection[];
  warnings: RouteWarning[];
};
```

`RouteLegStatus` gains `review-required`. A route with trustworthy geometry and a non-blocking diagnostic can retain its geometry with this status. A provider failure or explicit ferry-policy contradiction uses `failed` and does not contribute geometry or metrics to trip totals.

Supported v1 combinations are:

- `drive + automatic`
- `vehicle-shipping + manual`

The fields remain separate because calculation method and movement semantics are distinct concepts, but unsupported combinations are rejected in v1.

### Defaults

Every new adjacent route leg defaults to:

```ts
{
  movement: 'drive',
  calculation: 'automatic',
  ferryPolicy: 'allow',
  waypoints: []
}
```

These defaults are owned by the app domain service. They do not depend on either skill.

## Persistence And Migration

The `trips` table gains:

- `vehicle_preset text not null default 'standard'`
- `vehicle_profile text not null default 'driving-car'`
- `vehicle_type text null`
- `vehicle_restrictions jsonb not null`

These four fields form the complete routing snapshot. Reads do not re-resolve an existing trip from current preset constants. Selecting a vehicle preset writes a new complete snapshot.

The `route_legs` table gains:

- `movement text not null`
- `calculation_mode text not null`
- `ferry_policy text not null default 'allow'`
- `waypoints jsonb not null default '[]'`
- `sections jsonb not null default '[]'`
- `warnings jsonb not null default '[]'`
- `review-required` in the route-status constraint

The migration maps:

- `driving-auto` to `drive + automatic + allow`
- `shipping-manual` to `vehicle-shipping + manual + allow`
- all existing trips to `standard` with the standard restriction snapshot
- all existing route legs to empty waypoints, sections, and warnings

The final domain model has no dual source of truth. Transitional readers may accept the legacy `type` field while local data migrates, but new writes use only the new fields.

IndexedDB receives the equivalent versioned migration for local and isolated e2e storage.

## OpenRouteService Integration

### Automatic Request Construction

An automatic route request contains ordered coordinates:

```text
origin -> waypoint 1 -> ... -> waypoint n -> target
```

The selected trip preset determines the ORS profile. HGV requests include `options.vehicle_type` and `options.profile_params.restrictions` from the trip snapshot.

Ferry policies map as follows:

- `allow`: no ferry avoidance option
- `avoid`: include `options.avoid_features: ['ferries']`
- `require`: calculate with ferries allowed, then validate that the returned metadata contains a ferry section

ORS has no hosted `require ferry` switch. The app must not emulate one with manual geometry. A named required crossing is expressed through ordered waypoints and validated against the returned ferry metadata.

Every automatic request asks for `waycategory` extra information. The adapter converts ferry-category ranges into normalized `RouteSection` records whose indices refer to the stored geometry. Road sections fill the remaining geometry ranges.

### Route Cache Key

The route key includes all calculation inputs:

- origin coordinates
- target coordinates
- ordered waypoint coordinates
- profile
- HGV vehicle type and restriction snapshot
- ferry policy
- provider-affecting route-option parameters

Changing a vehicle preset, waypoint, ferry policy, endpoint, or selected route option invalidates the route.

### Alternatives

Route alternatives inherit the trip vehicle, ordered waypoints, and existing ferry policy. An alternative may not silently weaken stored intent. For example, an `Avoid ferries` supplemental option is not offered for a leg whose ferry policy is `require`.

### Manual Vehicle Shipping

`vehicle-shipping + manual` skips ORS and retains the current straight-line manual representation. It is used for a genuine discontinuity such as independent vehicle freight around the Darien Gap, not for an ordinary vehicle ferry present in the routable network.

## Route Validation

The app validates the calculated result before marking a leg ready.

### Ferry Intent

- `require` with no ferry section: `failed` with `FERRY_REQUIRED_NOT_FOUND`
- `avoid` with a ferry section: `failed` with `FERRY_AVOIDED_BUT_FOUND`
- `allow`: accept either road-only or ferry-inclusive output

### Suspicious Geometry

The initial suspicious-detour rule marks a route `review-required` when both are true:

- route distance is greater than twice the direct geodesic distance
- route distance exceeds the direct distance by at least 500 km

Using both ratio and absolute excess avoids flagging legitimate short coastal or ferry detours while catching severe long-distance errors such as the observed Bremen to Hirtshals result. The warning includes origin, target, route distance, direct distance, ratio, and excess distance.

The candidate geometry is retained for warning-styled inspection but does not contribute distance or duration to trip totals. The user or agent can recalculate or revise explicit route intent without recreating the trip.

## Stop Mutation Behavior

All UI and CLI stop mutations use the same reconciliation and routing service.

### Ordinary Leg

Adding a stop between two overnight stops removes the old leg, creates two default automatic legs, applies the trip vehicle to both, and calculates both with ORS.

Deletion and reordering follow the same adjacent-stop reconciliation rules.

### Leg With Exceptional Intent

When insertion splits a constrained leg:

- `avoid` is copied to both resulting legs.
- Waypoints are projected onto the existing ready route geometry and assigned before or after the inserted stop while preserving their original order.
- `require` is assigned to the resulting leg containing the existing ferry section.
- If ready geometry or ferry metadata makes automatic-leg reassignment ambiguous, the app calculates the new default legs but marks them `review-required`. One replacement leg carries `ROUTE_INTENT_REASSIGNMENT_REQUIRED` with a structured snapshot of the original unresolved intent, so the CLI or a later UI cannot silently lose it.
- Splitting a manual vehicle-shipping leg is rejected before persistence with a targeted route-intent error. The user or research workflow must first decide where the discontinuity belongs because no automatic split is defensible.

An ordinary manual stop insertion never asks the user for route settings. Only an exceptional ambiguous mutation surfaces a targeted warning.

## App UI

### Trip Editor

The existing per-trip pencil action changes from `Rename trip` to `Edit trip`. The existing lightweight editor adds a three-button icon control:

- car icon: Standard vehicle
- caravan icon: Large camper
- truck icon: Expedition truck

The implementation uses available Lucide icons, accessible labels, tooltips, and a clear selected state. It does not add a new settings dialog or permanently visible toolbar controls.

New manually created trips default to Standard vehicle. Saving a changed vehicle preset:

1. stores the new preset and current restriction snapshot
2. invalidates every automatic route leg in the trip
3. recalculates those legs using the normal route-calculation states
4. updates the itinerary and map through the existing state and realtime paths

### Itinerary And Map

The app does not add a full waypoint or ferry-policy editor in v1.

- Ordinary legs continue to show distance and travel time.
- Ferry geometry uses distinct ferry styling on the map.
- A compact ferry indicator appears only when a calculated route contains a ferry section.
- A compact waypoint indicator appears only when a leg has stored waypoints.
- A route warning indicator appears only for failed or review-required intent.
- Existing route alternatives remain available and inherit current route intent.
- The current manual route control remains as an escape hatch, but its wording changes from generic shipping/manual language to `Vehicle shipping`.

Waypoints and ferry policies are readable through returned app and CLI data but are not general-purpose editable UI controls in v1. The agent and CLI are the primary authoring surface for exceptional route intent.

## Realtime Behavior

Realtime remains a v1 requirement.

- External CLI updates to trip vehicle metadata refresh the active trip UI.
- Pending, ready, failed, and review-required route-leg changes refresh itinerary metrics and map geometry.
- A vehicle change invalidates routes once; realtime echoes must not trigger a second recalculation loop.
- Local optimistic state may show the selected vehicle immediately while persisted route updates arrive.

## CLI Contract

### Manifest Version 2

`manifestVersion: 2` adds trip vehicle and exceptional route intent:

```json
{
  "manifestVersion": 2,
  "name": "Nordkapp Winter Expedition Loop",
  "vehiclePreset": "expedition-truck",
  "stops": [
    {
      "key": "bremen",
      "name": "Bremen",
      "place": { "query": "Bremen, Germany" },
      "expectedStayDays": 1,
      "tags": [],
      "links": [],
      "activities": []
    },
    {
      "key": "kristiansand",
      "name": "Kristiansand",
      "place": { "query": "Kristiansand, Norway" },
      "expectedStayDays": 1,
      "tags": [],
      "links": [],
      "activities": []
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
          "notes": "Use the researched Denmark to Norway crossing.",
          "links": []
        }
      ]
    }
  ]
}
```

Ordinary adjacent legs remain omitted. An omitted `vehiclePreset` is invalid in version 2 so a handoff cannot accidentally lose an approved vehicle decision.

A manual discontinuity is explicit:

```json
{
  "fromStopKey": "panama-city",
  "toStopKey": "cartagena",
  "movement": "vehicle-shipping",
  "calculation": "manual",
  "notes": "Independent vehicle freight around the Darien Gap."
}
```

Version 1 remains readable and defaults to Standard vehicle with existing driving and manual-shipping semantics. New agent-authored trips use version 2.

### Existing-Trip Commands

Add:

```bash
npm run trip -- set-vehicle --trip-id <id> --preset <standard|large-camper|expedition-truck>
npm run trip -- update-route-leg --trip-id <id> --route-leg-id <id> --input ./route-intent.json
```

`set-vehicle` changes only trip vehicle metadata and triggers recalculation of all automatic legs.

`update-route-leg` atomically replaces only supplied route-intent fields after validation. Its writable fields are:

- `movement`
- `calculation`
- `ferryPolicy`
- ordered `waypoints`
- `notes`

It never accepts geometry, distance, duration, provider fields, route sections, warnings, status, or cache keys.

`get` returns the trip vehicle snapshot and route intent. The create and update responses summarize route counts by status and include precise leg diagnostics without printing full geometry when `--summary` is used.

### Write And Failure Semantics

Structural validation completes before persistence. Invalid stop references, non-adjacent directives, unsupported movement/calculation pairs, invalid waypoint places, or unknown presets block the write.

After structural validation succeeds:

- valid trip, stop, activity, link, and route-intent data persists
- route calculations run through the shared app service
- provider failures and route diagnostics do not roll back the trip
- command output reports ready, failed, and review-required route counts
- `audit` reports exact route-leg issues after creation

An authorized new trip remains one create command followed by one audit. The agent must not replace a route failure with granular reconstruction of the trip.

## Skill Ownership

### World Tour Route Research

The route-research skill owns:

- inferring the vehicle preset from ordinary language
- defaulting to Standard vehicle when no vehicle is mentioned
- asking about vehicle class only when it could invalidate every plausible corridor and cannot be inferred
- evaluating route suitability for the selected preset
- selecting stops, stay durations, activities, and route shape
- adding waypoints only when passing through a particular place is materially important
- choosing `avoid` or `require` only when ferry intent is material
- identifying genuine vehicle-shipping discontinuities
- producing an approved, manifest-compatible handoff

The skill does not ask for exact dimensions routinely, calculate geometry, emit ordinary route legs, or use manual shipping for a normal routable ferry.

Its user-facing response remains decision-oriented. It mentions the vehicle assumption and exceptional crossings when material but does not expose the full manifest schema unless requested.

### World Tour Trip Data

The trip-data skill owns:

- validating the approved handoff
- resolving stop, activity, and waypoint places
- writing the approved vehicle preset and exceptional route intent
- invoking the shared app routing service through the CLI
- auditing and reporting exact persisted results

It must not choose a vehicle, add or remove waypoints, change ferry intent, alter stop order or stays, or convert a provider failure into a new itinerary decision.

The approved research handoff is the source artifact for `manifestVersion: 2`. The writer translates planning-only evidence fields if needed but does not reconstruct the itinerary from conversational prose. Once implementation is approved, it proceeds directly to one create command and one audit unless structural validation identifies a specific correction.

### Portable And Installed Copies

The repo guides and installed skills must stay synchronized:

- `docs/agent-guides/world-tour-route-research/`
- `docs/agent-guides/world-tour-trip-data/`
- installed `world-tour-route-research`
- installed `world-tour-trip-data`

Schema references, examples, CLI references, and skill metadata must advertise the same version-2 contract and ownership boundaries.

## Error Handling

- Missing ORS credentials preserve current no-calculator behavior and leave automatic routes pending or failed with a clear error.
- A malformed provider response fails only the affected route leg.
- Place-resolution failure identifies the exact waypoint or stop path.
- Required or avoided ferry contradictions fail the affected leg and preserve the stored intent.
- Suspicious geometry becomes review-required and is excluded from ordinary ready-route assumptions.
- Recalculation clears stale provider errors, sections, and warnings before validating the new result.
- Realtime updates do not start duplicate calculations.
- Automatic route-intent reassignment ambiguity preserves the unresolved original directive in structured warning context rather than silently dropping it.
- A manual vehicle-shipping split is rejected before stop persistence rather than inventing two replacement transfers.

## Testing

### Domain And Migration

- preset definitions resolve to the expected profile and restriction snapshot
- existing trips migrate to Standard vehicle
- legacy driving and shipping legs map to the new model
- unsupported movement/calculation combinations are rejected
- route keys change for vehicle, waypoint, ferry-policy, and endpoint changes

### OpenRouteService Adapter

- Standard vehicle requests use `driving-car`
- larger presets use `driving-hgv` with vehicle type and restrictions
- ordered waypoints appear between endpoints
- `avoid` sends `avoid_features: ['ferries']`
- `require` allows ferries and validates returned metadata
- ferry-category ranges become normalized route sections
- malformed extras fail safely

### Route Reconciliation And Validation

- manual stop insertion into an ordinary leg creates and calculates two default legs
- changing the trip vehicle invalidates every automatic leg and preserves manual shipping
- `avoid` is copied to both sides of a split constrained leg
- waypoints are partitioned in order around an inserted stop
- `require` follows the existing ferry section
- ambiguous constrained and manual-shipping splits become review-required
- ferry contradictions fail only the affected leg
- the ratio-plus-excess heuristic catches the observed Bremen to Hirtshals defect without flagging the current legitimate short ferry and coastal samples

### CLI

- manifest version 2 requires a valid vehicle preset
- version 1 remains readable with Standard vehicle defaults
- ordinary route directives remain unnecessary
- waypoint places and links are resolved and enriched by the app
- `set-vehicle` modifies no itinerary content
- `update-route-leg` rejects derived fields
- route failures return diagnostics without rolling back valid trip data
- a complete approved handoff uses one create and one audit

### UI And Realtime

- the existing trip editor exposes three accessible vehicle icon buttons
- new manual trips default to Standard vehicle
- saving a different preset recalculates automatic legs once
- external CLI vehicle and route updates refresh the active UI
- ferry sections render distinctly on the map
- ferry, waypoint, and warning indicators appear only when relevant
- normal stop insertion requires no route-settings interaction

### End-To-End Regression

Use the Nordkapp case as the primary regression:

- Balcombe to the first continental overnight remains an ordinary automatic route
- the trip uses Expedition truck routing throughout
- a researched Denmark-to-Norway crossing is represented as automatic route intent rather than manual geometry
- the bad Bremen-to-Hirtshals detour cannot become a normal ready leg silently
- inserting another ordinary overnight stop recalculates adjacent legs through the same service
- the approved handoff reaches the app without a second planning or manifest-reconstruction pass

## Provider References

- OpenRouteService routing options and HGV restrictions: https://giscience.github.io/openrouteservice/api-reference/endpoints/directions/routing-options
- OpenRouteService route extra information: https://giscience.github.io/openrouteservice/api-reference/endpoints/directions/extra-info/
- OpenRouteService supported profiles: https://giscience.github.io/openrouteservice/run-instance/configuration/engine/profiles/

## Success Criteria

- Users can manually add, remove, reorder, or edit stops and receive automatic routes appropriate to the trip vehicle.
- Agents can express exceptional via points, ferry intent, and genuine vehicle shipping without writing geometry.
- Ordinary users do not need to understand ferry policies, waypoints, ORS profiles, or vehicle dimensions.
- The research and trip-data skills retain separate, enforceable responsibilities.
- The app detects rather than silently accepts known classes of ferry and severe-detour routing errors.
- CLI writes remain reviewable, realtime, and fast enough that approved handoffs are executed rather than rebuilt.
