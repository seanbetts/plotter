# Route Recovery and Alternatives Design

Date: 2026-07-11
Status: Approved for implementation planning

## Purpose

Make automatic routing resilient to transient provider limits, unsuitable geocoded endpoints, and routing-profile gaps without asking users or agents to manage provider details. Reuse the in-progress route alternatives flow as the place where a user can inspect or replace a recovered route.

The app remains responsible for route geometry and recovery. Research and trip-data skills provide stop order, approved route intent, and one vehicle preset; they do not diagnose provider failures, create routing anchors, choose fallback profiles, or author substitute geometry.

## Goals

- Treat a car plus caravan or large motorhome as ordinary motor traffic for routing.
- Keep strict HGV routing for a genuine expedition truck.
- Retry transient provider failures without presenting them as route problems.
- Recover from unsuitable stop coordinates without changing the displayed stop location.
- Provide usable fallback geometry when strict HGV routing cannot produce a route.
- Preserve distance and duration for successful recoveries.
- Explain recovered routes through the existing leg-scoped alternatives UI.
- Apply the same behavior to imports, manual stop insertion, reordering, vehicle changes, route edits, and explicit recalculation.

## Non-goals

- Replacing OpenRouteService or authoring route geometry in an agent skill.
- Asking users for exact vehicle dimensions during ordinary trip planning.
- Automatically granting a motorhome or truck access to delivery-only roads.
- Treating ordinary ferries, tunnels, bridges, or vehicle shuttles as manual route discontinuities.
- Adding a separate routing settings dialog.
- Replanning stops when route calculation fails.

## Vehicle Presets

The three product presets keep their existing user-facing meanings but use these routing contracts:

| Preset | Primary ORS profile | Meaning |
| --- | --- | --- |
| `standard` | `driving-car` | Car or other ordinary road vehicle |
| `large-camper` | `driving-car` | Car and caravan, large motorhome, or similar ordinary motor vehicle |
| `expedition-truck` | `driving-hgv` | Genuine heavy expedition vehicle |

`large-camper` retains its representative dimensions as descriptive metadata, but those dimensions are not sent to ORS while the preset uses `driving-car`. The app must not imply that ORS has validated height, width, length, weight, or axle load for a car-profile route.

`expedition-truck` continues to send its representative dimensions and `vehicle_type: "hgv"` through the HGV profile.

The route-research skill should infer `large-camper` from ordinary car-and-caravan, campervan, or large-motorhome language. It should reserve `expedition-truck` for a genuine heavy truck. The trip-data skill copies the approved preset without changing it.

## Provider Failure Classification

The ORS adapter must preserve enough structured information to distinguish failures. A provider error includes:

- HTTP status;
- ORS error code and message when present;
- implicated coordinate index when the message identifies one;
- retry timing or rate-limit metadata when supplied;
- provider name and requested profile.

The app classifies failures into these behaviors:

| Failure | Behavior |
| --- | --- |
| HTTP 429 | Transient retry; do not persist a failed route before the retry policy is exhausted |
| Authentication or quota exhaustion | Stop and report the configuration/provider problem; do not try route fallbacks |
| ORS 2010 unroutable coordinate | Attempt endpoint recovery |
| ORS 2009 disconnected route | Attempt an eligible profile fallback |
| Other provider failure | Persist a failed leg with the structured diagnostic; do not guess |

Stable errors are never retried unchanged in a loop. The explicit failed-route recalculation command follows the same classification and retry rules.

## Request Scheduling

All structural and semantic validation that does not depend on route results runs before directions requests. In particular, invalid activity locations must fail before consuming route quota.

Directions requests pass through one shared scheduler used by the app and CLI. The scheduler respects the provider's sliding request window, serializes or spaces requests as required, and delays 429 retries until the provider window permits another attempt. A single bulk import must not trigger an immediate second full-route retry pass.

Realtime persistence remains unchanged in principle: successful and terminal route results are saved through the repository and become visible to other app clients. A transient retry stays an in-flight calculation rather than briefly publishing a failed leg.

## Routing Anchors

A stop keeps its display coordinates as the canonical place location. Endpoint recovery can additionally persist a routing anchor for a specific routing profile.

```ts
type RoutingAnchor = {
  profile: 'driving-car' | 'driving-hgv';
  coordinates: Coordinates;
  originalCoordinates: Coordinates;
  snapDistanceKm: number;
  provider: 'openrouteservice';
  resolvedAt: string;
};
```

Anchors are stored against the destination, keyed by profile, in a dedicated `routing_anchors` JSON field. They are internal app data and are not exposed as stop fields in research or trip-data manifests.

When calculating a leg, the app uses a saved anchor for the requested profile if one exists. When no anchor exists and ORS reports an unroutable endpoint, the app retries with an endpoint radius of up to 2 km. If ORS returns a route, the corresponding first or last geometry coordinate becomes the routing anchor and is saved for reuse.

Endpoint recovery must:

- leave the map marker and normalized stop location unchanged;
- preserve route waypoints and ferry policy;
- reject an anchor more than 2 km from the canonical stop coordinate;
- record the actual snap distance;
- attach a `ROUTING_ANCHOR_ADJUSTED` warning to route legs using the anchor;
- reuse one saved anchor for every leg touching that stop under the same profile.

If the primary profile cannot find an anchor within the recovery limit, processing continues to profile fallback only when that fallback is eligible.

## Profile Fallback

Profile fallback is only relevant when the trip's primary profile is `driving-hgv`. A `driving-car` failure does not fall back to another vehicle class.

After HGV endpoint recovery is exhausted or ORS returns a disconnected-route error, the app calculates the same route with `driving-car`, preserving ordered waypoints and ferry policy. It must never silently switch to ORS `delivery`, because delivery access does not describe a private expedition vehicle.

A successful car fallback:

- remains an automatic driving leg;
- has status `ready`;
- keeps geometry, sections, distance, and duration;
- records `profile: "driving-car"` as the profile actually used;
- carries a `VEHICLE_PROFILE_FALLBACK` warning explaining that truck dimensions were not validated;
- may also carry `ROUTING_ANCHOR_ADJUSTED` when endpoint recovery was needed;
- is included in map rendering and trip totals.

Fallback warnings are informational qualifications on a usable result. They do not use `review-required`, which remains reserved for unresolved route intent where the app cannot safely treat the result as final.

## Route Alternatives Integration

The existing route alternatives panel remains on-demand and scoped to one adjacent stop pair. It is extended rather than replaced.

`RouteOption` gains recovery provenance and warnings. Supported option sources become:

- `recommended`;
- `provider-alternative`;
- `avoid-feature`;
- `adjusted-endpoint`;
- `profile-fallback`.

Normal routes retain their current presentation. Recovery options add a concise label and qualification:

- `Adjusted endpoint` for a route using a saved or newly resolved routing anchor;
- `Car-profile fallback` for a route calculated as a car after HGV routing failed.

The panel shows actual distance and duration for every usable option. A recovery option also states the relevant limitation, such as the endpoint being moved to a nearby routable road or truck dimensions not being validated. Only provider-returned, renderable geometry can be offered.

Selecting an option persists its actual profile, route key, geometry, metrics, sections, recovery provenance, and warnings on the existing route leg. It does not create another leg or stop. Existing stale-result and route-intent fingerprint protections continue to apply.

The alternatives service includes the current recovered route even when the primary profile cannot produce normal provider alternatives. Supplemental requests must follow the same rate-limit scheduler and error classification as ordinary route calculation.

## Itinerary and Map UI

A recovered route is immediately usable. The itinerary row shows its normal distance and time plus the existing warning indicator. The warning tooltip names the specific qualification. The pencil button opens the route alternatives panel when the user wants more detail or another route.

The app does not automatically open a dialog, demand confirmation, or expose routing-anchor controls. Complexity remains internal unless the user chooses to inspect the route.

Map rendering uses the saved provider geometry. A routing anchor may create a short visual offset between a stop marker and the route endpoint; the stop marker must not be moved to conceal that fact. The warning explains the adjustment.

Failed routes retain the existing failed presentation and retry affordance when no recovery succeeds.

## Data Ownership and Persistence

- Destination display coordinates and normalized location remain place-resolver-owned.
- Destination routing anchors are app-derived and profile-specific.
- Route geometry, sections, distance, duration, provider, and actual profile remain app-derived.
- Route recovery provenance and warnings belong to the selected route leg.
- Trip vehicle preset and representative dimensions remain trip-level data.
- Skills can select a preset but cannot write anchors, fallback provenance, provider errors, or geometry.

Supabase requires a destination `routing_anchors jsonb not null default '{}'::jsonb` column. Local storage and Supabase row mappers must default missing anchors to an empty map for backward compatibility. Existing realtime destination and route-leg subscriptions carry the new data through their normal update paths.

## Existing Trips and Recalculation

The Supabase migration updates existing `large-camper` trip snapshots to `driving-car`, clears `vehicle_type`, and retains their representative restrictions as descriptive metadata. Local-storage normalization performs the equivalent update when loading an older snapshot. Existing automatic HGV legs no longer match the trip vehicle fingerprint and become pending through ordinary route reconciliation. Manual vehicle-shipping legs remain untouched.

Changing a trip to another vehicle preset invalidates anchors only when the requested profile differs. Car anchors can be shared by `standard` and `large-camper`; HGV anchors belong to the expedition-truck profile.

Updating a stop's canonical coordinates invalidates all of that stop's saved routing anchors. Renaming or editing notes does not.

## Skill and Documentation Changes

The repository and installed copies of both skills must stay aligned:

- Route research documents the revised ordinary-language mapping for vehicle presets.
- Trip data continues to copy the approved preset and lets the app calculate and recover routes.
- CLI documentation explains that successful recoveries are reported as ready legs with warnings.
- Audit output exposes structured warning and provider-failure details without instructing an agent to replan the trip.

No skill should add waypoints, manual shipping, or alternate stops merely to work around an automatic routing failure.

## Verification

Focused tests cover:

- `large-camper` resolving to `driving-car` while retaining descriptive dimensions;
- `expedition-truck` retaining HGV restrictions;
- provider error body parsing and classification;
- semantic audit failure before any route request;
- scheduler behavior across more than 40 directions requests;
- delayed 429 retry without publishing transient failure;
- car-profile endpoint recovery and routing-anchor persistence;
- reuse of one anchor by both inbound and outbound legs;
- anchor invalidation after coordinate changes;
- HGV 2009 and unrecoverable 2010 car-profile fallback;
- no fallback for auth, quota, or unrelated provider failures;
- ready fallback routes retaining metrics and contributing to totals;
- warning display in the itinerary row and alternatives panel;
- selection and persistence of adjusted-endpoint and profile-fallback options;
- stale alternative protection and route-intent preservation;
- imports, manual stop insertion, reordering, vehicle changes, and explicit failed-route recalculation;
- Supabase/local round trips and realtime refresh for anchors and recovery warnings.

The Nordkapp test case is retained as a regression fixture at the routing-service level: Alta exercises endpoint adjustment and Lillehammer to Oslo confirms that `large-camper` now uses car routing. Tests use mocked provider responses rather than consuming live ORS quota.

## Acceptance Criteria

- A valid large import does not exhaust the provider's minute window or spend route quota before blocking semantic validation.
- Temporary 429 responses recover without leaving failed legs for an agent or user to diagnose.
- Alta-style city-center coordinates can produce a reusable nearby route anchor without moving the stop.
- A car and caravan trip does not receive HGV access-graph failures.
- An expedition-truck fallback is visible and usable but clearly says dimensions were not validated.
- Recovered routes render, contribute metrics, survive reload/realtime updates, and remain editable through route alternatives.
- No agent-authored geometry, routing anchors, or provider-specific workaround data enters the trip manifest.
