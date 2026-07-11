# Trip Map Export Stop Pill Fidelity Design

## Purpose

Make stop labels in the downloaded trip-map PNG match the live app's stop pills exactly instead of using a separate MapLibre text treatment.

The export remains a map-only 1600 × 1000 image showing the complete trip route. It continues to exclude app chrome, activities, selected-stop state, panels, and map controls.

## Confirmed Visual Contract

Every exported stop uses the live map's normal, unselected `.map-destination-label` presentation:

- The same label text and numbering produced by `formatStopMarker`: `ST`, `02`, `03`, and so on.
- The same `<marker> - <stop name>` content.
- The same font family, size, weight, and line height.
- The same padding, minimum height, maximum width, ellipsis behavior, border, pill radius, foreground colour, translucent background, and shadow.
- The same below-pin placement by default and the same above-pin class when shared placement logic chooses it.

The export must not introduce export-only stop typography, black text halos, circular number badges, or plain unpadded numbering.

## Root Cause

The live map and exported image currently use independent label renderers:

- `MapCanvas` projects destinations into an HTML overlay and styles button elements with `.map-destination-label`.
- `tripMapExport` creates separate MapLibre circle, number, and name layers with its own text, font, colour, halo, and placement configuration.

Because the export reconstructs the presentation rather than reusing it, the two surfaces have drifted. Correcting only the current MapLibre paint values would still leave two independent implementations that can diverge again.

## Architecture

Keep the dedicated temporary MapLibre map and its complete-route framing. Replace only the export-specific stop-label presentation.

Introduce a small shared stop-label presentation model that owns:

- Canonical label text derived from destination order and `formatStopMarker`.
- Projected screen coordinates.
- Below/above placement state.
- Stable identity and stop name.

`MapCanvas` and `tripMapExport` consume that same model. The interactive map continues rendering accessible buttons. The exporter renders non-interactive HTML elements with the same `.map-destination-label` class and placement class inside an overlay attached to the temporary export container.

The export map retains MapLibre route and stop-point layers. It removes the export-only number and stop-name symbol layers. After MapLibre reaches `idle`, the exporter composites:

1. The temporary map canvas.
2. The HTML stop-pill overlay rendered with the app's loaded stylesheet.
3. Required provider attribution.

The final PNG therefore uses the same browser CSS rendering as the app rather than an approximation made from duplicated drawing values.

## Data Flow

```text
camera click
  -> create temporary 1600 × 1000 MapLibre map
  -> add routes and stop points
  -> fit complete trip bounds
  -> wait for map idle
  -> project each stop into export screen coordinates
  -> build shared stop-label models
  -> render normal unselected app pills in an HTML overlay
  -> composite map canvas + pill overlay + attribution
  -> download PNG named from the trip
  -> remove all temporary resources
```

## Placement and Collision Behaviour

The exporter uses the same destination-pill placement helper as `MapCanvas`, including any below/above collision decision available when implementation begins. This is intentionally shared so the pending overlapping-stop-pill work and later placement changes can update both surfaces together.

The export does not use MapLibre's variable-anchor name placement. It does not hide labels merely because MapLibre considers them colliding; visibility and placement follow the app's destination-pill rules.

## Rendering and Failure Handling

The temporary overlay remains inside the off-screen export container so the existing stylesheet and CSS custom properties resolve normally. It is rasterized only after fonts and the map have settled.

If overlay rasterization, canvas composition, or PNG conversion fails:

- No partial file is downloaded.
- The existing compact toolbar error is shown.
- The visible interactive map remains untouched.
- The map, overlay, temporary image resources, object URL, anchor, and container are removed in `finally` cleanup.

The existing load and idle timeouts remain in force. Overlay composition must also settle within the export lifecycle rather than leaving the camera action busy indefinitely.

## Testing

Use test-driven development with a regression that fails against the current exporter before changing production code.

Focused coverage will verify:

- Shared stop-label models use `ST`, `02`, `03` numbering and canonical order.
- Export labels contain the same `<marker> - <stop name>` text as `MapCanvas`.
- Export labels use `.map-destination-label` and the shared above-placement class when applicable.
- Export creates route and stop-point MapLibre layers but no export-only number or name symbol layers.
- Overlay composition occurs after map idle and before `toBlob`.
- Success and every failure path remove the temporary overlay and other export resources.
- Existing filename, bounds, dateline, route-semantic, timeout, and toolbar tests remain green.

Rendered verification will use the normal app trip and Browser tooling:

- Capture the live map stop pills as the reference.
- Download a fresh Nordkapp Winter Expedition Loop PNG.
- Confirm the PNG is 1600 × 1000, map-only, and includes the whole route.
- Compare pill text, numbering, foreground, background, border, radius, shadow, font, padding, and placement against the live app.
- Check dense clusters and the first stop specifically.
- Confirm the browser console has no relevant errors or warnings and the visible map does not move during export.

## Non-Goals

- Capturing app chrome or the current viewport.
- Exporting activity labels or selected-stop styling.
- Changing the route, basemap, framing, filename, or camera-button behaviour.
- Redesigning the live stop pills.
- Solving unrelated label placement or itinerary layout issues inside this change.
