# Auto Routing And Ordered Stops Design

Date: 2026-06-28

## Goal

Turn the itinerary into an ordered route plan: stops can be reordered manually, adjacent stops create route legs automatically, and driving legs calculate road geometry immediately using OpenRouteService.

## Decisions

- Keep MapLibre as the renderer.
- Use MapTiler-hosted MapLibre styles through `VITE_MAPTILER_API_KEY` so roads and city labels are part of the base map.
- Use OpenRouteService Directions GeoJSON through `VITE_OPENROUTESERVICE_API_KEY` for driving road geometry, distance, and duration.
- Keep routing provider-neutral behind a small adapter.
- Use native HTML drag handles for stop reordering in this milestone. Avoid adding a drag dependency until the interaction needs more polish.
- Route legs are derived from adjacent ordered stops. The normal route editor/add button is removed.
- Each adjacent leg can be marked as `driving-auto` or `shipping-manual`.
- `driving-auto` legs calculate immediately after add/delete/reorder/mode change.
- `shipping-manual` legs skip API routing and render as dashed manual gaps.
- Route recalculation should only touch changed adjacent legs and should reuse cached route records when the origin, target, mode, and profile match.

## Data Model

Destination adds:

- `order`: number

RouteLeg changes:

- `type`: `driving-auto | shipping-manual`
- `status`: `pending | calculating | ready | failed | manual`
- `provider`: optional routing provider name
- `profile`: optional routing profile, initially `driving-car`
- `routeKey`: cache key for origin/target/profile/mode
- `calculatedAt`: timestamp when route was calculated
- `error`: user-visible route failure text

Existing records without `order`, `status`, or new route types are normalized on load.

## UI

- Itinerary stop rows include a drag handle.
- Dropping a stop in a new position persists the order.
- Routes are shown between adjacent stops as route rows, each with a mode select.
- Manual/shipping route rows show as manual and are not recalculated.
- Driving route rows show calculating/ready/failed status.
- The map uses provider road geometry when present and a dashed fallback for manual/failed legs.

## Error Handling

- Missing OpenRouteService key marks driving legs failed with a clear local message.
- API errors mark only the affected leg failed.
- Existing cached geometry is preserved unless a different adjacent pair replaces the leg.
- Route sync should not run while initial trip data is loading.

## References

- OpenRouteService Directions calculates routes between locations and supports GeoJSON responses where route features contain `LineString` geometry and summary properties.
- MapTiler documents MapLibre GL JS usage with MapTiler-hosted styles and API keys in style URLs.
