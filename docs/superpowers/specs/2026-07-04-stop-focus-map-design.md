# Stop Focus Map Design

## Purpose

Implement the map focus behavior for selected stops so activities become spatially useful without cluttering the route-level map.

The route map remains the default planning view: route legs, stop pins, and stop labels. Activity pins appear only while a stop is selected.

## Behavior

Selecting a stop opens the stop profile and puts the map into stop focus view.

In stop focus view:

- The map fits to the selected stop plus that stop's activities with coordinates.
- Activities without coordinates stay in the stop activity list but do not render pins.
- Activity pins are clickable.
- Clicking an activity pin selects the activity and opens the activity panel.
- The selected activity pin has a stronger visual state than the other activity pins.
- Selecting another stop transitions directly to the new stop's local focus bounds.

Closing the stop profile exits stop focus view:

- Activity pins disappear.
- Selected activity state is cleared by the existing close handler.
- The map restores the previously saved route-level viewport.

If a stop has no mappable activities, focusing the stop still zooms toward the selected stop with a sensible local max zoom rather than staying at route scale.

## Component Boundaries

`App` remains the owner of selection state. It passes only the selected stop's activities into `MapCanvas`, along with the selected activity id and an activity selection callback.

`MapCanvas` remains the owner of MapLibre sources, layers, and viewport transitions. It should not load activities itself and should not know about activities for unselected stops.

This keeps the data flow simple:

```text
App selectedDestinationId
  -> selectedDestinationActivities
  -> MapCanvas focused activity features
  -> click activity pin
  -> App setSelectedActivityId
```

## Map Data

Add a dedicated GeoJSON source for focused activities. Feature properties should include:

- `id`
- `title`
- `order`
- `selected`

The source contains only activities from the selected stop that have coordinates. When no stop is selected, or no focused activities have coordinates, the source should contain an empty feature collection.

Activity pins should be visually distinct from stop pins but still use the existing map palette. The selected activity pin should be obvious without competing with the selected stop halo.

## Viewport

When entering stop focus from route view, save the current route-level viewport before moving the map. Restoring should use that saved viewport when the stop profile closes.

The focused viewport should fit these points:

- selected stop coordinates
- coordinates for mappable activities under that stop

Use panel-aware padding so pins are not hidden underneath the stop and activity panels. Use a local max zoom that works for a single stop and nearby points.

If the user selects another stop while already focused, do not overwrite the saved route viewport. Fit directly to the new stop's focused bounds.

## Interaction

Activity pin click behavior mirrors activity list selection:

- Click a pin for an unselected activity: select it and open its activity panel.
- Click the already selected activity pin: keep it selected.
- Closing only the activity panel keeps stop focus active and keeps activity pins visible.
- Closing the stop panel exits focus and restores the route viewport.

## Testing

Add focused unit coverage for `MapCanvas`:

- Adds focused activity source and layers.
- Populates focused activity features only for activities with coordinates.
- Empties activity features when no stop is selected.
- Fits to the selected stop plus activity coordinates when entering focus.
- Restores the saved route viewport when leaving focus.
- Clicks on activity pins call `onSelectActivity`.

Add app-level coverage where useful to confirm the selected stop's activities are passed to the map and activity pin selection opens the activity panel.
