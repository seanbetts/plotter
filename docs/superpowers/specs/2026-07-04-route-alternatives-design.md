# Route Alternatives Design

Date: 2026-07-04

## Goal

Let the user choose between a small number of calculated route options for an existing route leg without changing the current stop-order model. The current route calculation remains the default: adjacent stops produce one active route leg, and the map renders that active leg.

## Decisions

- Keep route legs derived from adjacent ordered stops.
- Keep one active route per `RouteLeg` for normal rendering, metrics, persistence, and map display.
- Add a pencil icon button to each inline driving route row in the stops list.
- The pencil opens an on-demand route alternatives panel for that route leg only.
- Do not calculate alternatives automatically for every leg.
- Do not create extra stops or extra route legs when the user reviews alternatives.
- Show a limited set of route options, with a target of three visible options in v1.
- Every displayed option must be backed by an actual successful route calculation with geometry, distance, duration, and a descriptive label.
- Supplemental options are allowed only when they can be implemented with provider-supported routing parameters.

## User Flow

1. The user sees the existing inline route row between two adjacent stops.
2. The user clicks the pencil icon on a driving route row.
3. The app opens a route alternatives panel for that origin and target.
4. The app calculates route options on demand.
5. The user previews and compares available options.
6. The user selects an option and confirms it.
7. The selected option replaces the active geometry and metrics on the existing route leg.

The route row remains readable without opening the panel. It continues to show the selected route's current distance, travel time, status, and route type.

## Route Option Sources

The app should request OpenRouteService alternatives first by using the provider's `alternative_routes` request parameters. These are treated as true provider-generated alternatives for the same origin and target.

If the provider returns too few useful alternatives, the app may supplement the list with provider-supported recalculations. Initial supplemental candidates are:

- `Avoid highways`
- `Avoid ferries`
- `Avoid tollways`

Supplemental candidates must be omitted when the request fails, when the provider does not support the option for the current profile, or when the resulting geometry is not meaningfully different from an already displayed option.

The app must not invent labels such as `Scenic`, `Coastal`, or `Quiet` unless the implementation has a real calculation strategy for those labels. Labels must describe the request or result honestly.

## Option Labels

Route option labels should be concise and descriptive:

- `Recommended`
- `Alternative 1`
- `Alternative 2`
- `Avoid highways`
- `Avoid ferries`
- `Avoid tollways`

Each option should show distance and duration. If an option differs from the currently selected route, the panel may show a small delta such as `+42 mi` or `+1.3 hr`, but deltas are secondary to the route geometry and core metrics.

## UI

The stops list gets an icon-only pencil button on each inline driving route row. The actual implementation should use a lucide pencil icon, not visible `Edit` text.

The button must have:

- an accessible label such as `Edit route from Bilbao to Porto`
- a tooltip such as `Edit route`
- a stable hit target that does not resize the inline route row

The route alternatives panel should be scoped to one route leg. It can be a modal, popover, or side panel in implementation, but it must make the origin and target clear.

The panel should show:

- origin and target stop names
- loading state while options are calculated
- the selected route option
- up to three route options
- distance and duration for each option
- a confirm action to use the selected option
- a cancel/close action that leaves the current route unchanged

The map may preview the hovered or selected option while the panel is open. Previewing is temporary until the user confirms.

## Data Model

The current `RouteLeg` remains the persisted active route. Selecting an alternative updates the existing leg's active fields:

- `geometry`
- `distanceKm`
- `travelTimeHours`
- `provider`
- `profile`
- `routeKey`
- `calculatedAt`
- `error`
- `status`

The first implementation does not need to persist all discarded alternatives. Options can be calculated, displayed, and then discarded unless selected.

If preserving calculated alternatives becomes useful later, add a separate child model for route-option cache entries rather than creating additional route legs.

## Routing Adapter

The route adapter should grow from "calculate one route" to "calculate route options for one leg" while preserving the existing single-route path.

The route-options result should normalize provider alternatives and supplemental recalculations into the same shape:

- `id`
- `label`
- `source`
- `distanceKm`
- `travelTimeHours`
- `geometry`
- `provider`
- `profile`
- `routeKey`

The adapter should deduplicate options before display. A route option is a duplicate if its geometry is effectively the same as another option or if it resolves to the same route key and comparable metrics.

## Error Handling

If the alternatives request fails, the app may still try supported supplemental requests. Failed supplemental requests are hidden from the option list.

If no alternatives can be calculated, show:

`No alternate routes found for this leg.`

The current route remains untouched in all failed or cancelled flows.

If saving the selected option fails, keep the panel open, show the save error, and leave the current route unchanged.

## Testing

Unit tests should cover:

- route option normalization
- hiding failed supplemental routes
- deduplicating equivalent options
- applying a selected option to an existing route leg

Component tests should cover:

- pencil button appears on inline driving route rows
- pencil button has accessible text and tooltip
- opening the panel triggers on-demand option calculation
- no-options empty state leaves the route unchanged
- selecting and confirming an option updates the existing route leg

Adapter tests should cover:

- OpenRouteService requests include `alternative_routes`
- supplemental requests include supported `avoid_features`
- malformed provider responses are rejected without corrupting the current route

E2e coverage can remain focused: open a route row, choose a mocked alternative, and verify the route row/map reflect the selected geometry.
