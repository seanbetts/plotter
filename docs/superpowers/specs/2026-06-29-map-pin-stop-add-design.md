# Map Pin Stop Add Design

## Goal

Let users add a stop directly from the map without entering a dedicated add mode. The interaction should feel intentional, avoid accidental stops during normal pan and zoom work, and reuse the existing stop creation, ordering, persistence, and route reconciliation flow.

## User Interaction

Desktop users can right-click on an empty part of the map to open a compact context menu at the pointer position. The menu contains one primary action: `Add stop here`.

Touch users can long-press an empty part of the map to open the same menu. The long-press should be canceled if the pointer moves enough to indicate map panning.

Existing stop pins and labels keep their current behavior. Clicking a rendered stop selects it and opens the stop details. The add-stop context menu is only for the base map, not for existing destination overlays.

## Add Stop Flow

When the user chooses `Add stop here`, the app stores a pending stop request with the clicked coordinates and starts a reverse-geocode lookup through MapTiler.

If the lookup succeeds, the app shows a compact confirmation popover with the resolved place name, region/country when available, coordinates, `Add stop`, and `Cancel`.

If the lookup fails or finds no useful location, the confirmation still appears with a fallback name such as `Dropped pin` and the coordinates. The user should still be able to add the stop.

On confirm, the app calls the existing `addDestination` action with the resolved or fallback location data. The existing route insertion, Supabase save, and route-leg reconciliation remain the source of truth.

After the destination is added, the new stop is selected so the profile opens for immediate editing.

## Component Boundaries

`MapCanvas` owns map gestures and emits a request event with coordinates when the user asks to add a stop from the map. It does not mutate trip data and does not call geocoding directly.

`App` owns pending-add state, reverse-geocoding, confirmation UI state, and the final call into `addDestination`.

The existing `TopToolbar` search flow remains unchanged. Both search and map-pin add paths converge on the same destination creation behavior.

## Error Handling

Reverse-geocoding failures should not block adding a stop. The confirmation UI should show a concise error state and keep `Add stop` available using fallback coordinate-based location data.

If destination save fails, the app should surface the existing trip-data error path or a local pending-add error without leaving a stale pending pin on the map.

When trip data is loading, the map context-menu add action should be unavailable, matching the current behavior where mutation controls are hidden while loading.

## Accessibility

The context menu and confirmation popover should be keyboard reachable after they open. `Escape` closes the active menu or confirmation before it closes an existing destination profile.

Because right-click and long-press are pointer-first gestures, a keyboard-accessible fallback should be included. The recommended fallback is an action that adds at the current map center, exposed from the map/toolbar surface, using the same confirmation flow.

## Testing

Unit tests should cover `MapCanvas` emitting an add request on right-click and long-press, while preserving existing destination selection behavior.

App tests should cover successful reverse-geocoded add, reverse-geocode failure fallback, no mutation while trip data is loading, and selecting the newly added destination after confirm.

The final implementation should be checked in a browser for desktop right-click, drag cancellation, touch-style long-press behavior, and responsive placement of the confirmation UI.
