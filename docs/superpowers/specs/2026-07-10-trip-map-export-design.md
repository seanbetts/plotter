# Trip Map Export Design

## Purpose

Add a camera action beside the main destination search that downloads a clean PNG showing the active trip's complete route and numbered stops.

The export is a generated map image, not a screenshot of the current app viewport. It must include the trip map only: no search toolbar, trip selector, itinerary panel, detail panels, navigation controls, selected-stop treatment, or activity markers.

## User Experience

Add a camera icon button to the right of the central search control. Use the existing `toolbar-icon-action` treatment and Lucide's `Camera` icon.

The button:

- Has the accessible name `Download trip map`.
- Is disabled when there is no active trip or the active trip has no stops.
- Is disabled while an export is being generated.
- Shows a loading indicator while export work is in progress, preventing concurrent exports.
- Downloads the completed PNG immediately without opening a preview or confirmation step.

The downloaded filename is derived from the active trip name. Sanitize characters that are invalid or unsafe in filenames, collapse whitespace and separators, and append `.png`. For example, `Wild Atlantic Way` becomes `Wild-Atlantic-Way.png`. Use `world-tour.png` when sanitization produces an empty name.

If export fails, do not download a partial image. Show a compact toolbar-level error such as `Couldn't export trip map. Try again.` and keep the interactive map unchanged.

## Architecture

Use a dedicated, temporary MapLibre map for export rather than capturing or manipulating the interactive `MapCanvas`.

`App` owns the export request because it already has the active trip, destinations, and route legs. It passes an async export callback and availability state to `TopToolbar`. `TopToolbar` owns only the camera button's interaction presentation; it does not construct map data.

A focused export module owns:

- Filename sanitization.
- Export GeoJSON construction.
- Complete-trip bounds calculation.
- Temporary MapLibre map creation and render synchronization.
- Canvas-to-PNG conversion and download.
- Resource cleanup and export-specific errors.

Keep `MapCanvas` focused on the interactive map. Share small pure route-feature or styling helpers only where doing so avoids semantic drift without coupling the two map lifecycles.

The data flow is:

```text
camera click
  -> App passes active trip name, destinations, and route legs
  -> export module creates a temporary off-screen MapLibre map
  -> export module fits, renders, and converts the map to PNG
  -> browser downloads the PNG using the sanitized trip name
  -> export module destroys all temporary resources
```

## Export Map

Render into a fixed 1600 x 1000 landscape container so output dimensions and composition do not depend on the browser window. The container may be positioned off-screen, but it must remain renderable; do not use `display: none`.

Configure the export map with `preserveDrawingBuffer: true`. Do not add interactive controls. Apply the same calm basemap treatment and route visual language as the main map.

The export contains, from back to front:

1. The basemap.
2. Renderable route legs using the same ready, manual-shipping, pending, and failed semantics as the interactive map.
3. Stop markers in canonical trip order.
4. Export-specific MapLibre symbol labels formatted as `<number> - <stop name>`.

Do not include activities, selection halos, app overlays, development controls, or HTML labels. Preserve tile-provider attribution in the image where required.

Render stop labels as MapLibre layers so they are included in the WebGL canvas. Use variable anchors and collision handling to find readable positions around stop markers. Numbered stop markers must remain visible even when nearby stop names cannot both be placed without collision.

## Framing

Calculate export bounds from:

- Every stop coordinate.
- Every coordinate in every route geometry that will be rendered.

Using full line geometry matters because a road or shipping route can extend beyond the straight bounds between its endpoints.

Fit those bounds with generous, label-safe padding. Apply a maximum zoom so a single-stop or geographically compact trip still reads as a map rather than an extreme close-up. The export viewport must be calculated independently of the interactive map's current selection, center, zoom, and stop-focus state.

If a trip has one stop and no route geometry, center on that stop using the export maximum zoom. Trips with no stops are not exportable.

## Capture Lifecycle

For each export:

1. Create the temporary renderable container and MapLibre map.
2. Wait for the map style to load.
3. Apply the calm basemap treatment and add route, stop, and label sources and layers.
4. Fit the complete-trip bounds without animation.
5. Wait for MapLibre's `idle` event so visible tiles and layers have rendered.
6. Convert the canvas with `canvas.toBlob()` using PNG output.
7. Create a temporary object URL, trigger a download with the sanitized filename, and revoke the URL.
8. Remove the MapLibre instance and its container.

Apply a finite timeout to the load and idle phases so a failed tile request cannot leave the toolbar permanently busy. Canvas conversion failure, a null blob, a render timeout, and a tainted canvas are export failures.

Cleanup must run for success, failure, and cancellation. It removes the map, DOM container, outstanding timeout, temporary anchor, and object URL. Only one export may run at a time.

## Error Handling

Export errors are local to the camera action. They must not enter the app's blocking trip-storage error state or alter trip data.

On error:

- Return the camera action to its enabled state when the trip is otherwise exportable.
- Show the compact toolbar error message.
- Leave the interactive map viewport and selection untouched.
- Do not retain a failed off-screen map or partially generated URL.

A later click retries from a fresh export map.

## Testing and Verification

Add unit coverage for pure export behavior:

- Sanitizes ordinary trip names and characters invalid in filenames.
- Collapses whitespace and separators predictably.
- Falls back to `world-tour.png` for an empty sanitized name.
- Builds bounds from all stops and every coordinate in rendered route geometry.
- Handles one-stop trips.
- Builds ordered stop features and numbered label text.
- Uses the same renderable route semantics as the interactive map.

Add `TopToolbar` component coverage:

- Renders the camera action to the right of search.
- Disables it without an exportable trip.
- Calls the export callback once when clicked.
- Disables repeat clicks and shows loading state while the promise is pending.
- Shows the local failure message when export rejects.

Add focused export lifecycle coverage with a mocked MapLibre map and browser download APIs:

- Adds sources and layers after style load.
- Fits complete-trip bounds without animation.
- Waits for `idle` before canvas conversion.
- Downloads the blob using the sanitized trip filename.
- Times out cleanly when rendering does not settle.
- Cleans up the map and temporary DOM and URL resources on success and failure.

Finally, verify the rendered app in a browser using e2e-local storage. Confirm that the downloaded PNG:

- Is 1600 x 1000.
- Includes the complete route geometry and ordered stop markers.
- Includes readable numbered stop labels.
- Excludes app chrome and activity or selection state.
- Uses the active trip name as its filename.
- Does not move or otherwise disturb the visible interactive map.
