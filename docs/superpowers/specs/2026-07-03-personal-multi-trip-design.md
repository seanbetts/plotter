# Personal Multi-Trip Design

## Purpose

Let the app store, select, create, rename, and delete multiple personal trips.

This is not a collaboration or account-management project. The app remains a personal planning tool backed by the existing anonymous Supabase session. The important change is that trip identity becomes explicit in the UI and repository boundary instead of being guessed during startup.

## Product Scope

The first version supports:

- Selecting an existing trip.
- Creating a new empty trip.
- Renaming a trip.
- Deleting a trip.
- Remembering the last selected trip on the current device.

The first version does not include sharing, multiple named users, trip duplication, import, export, archival, or recovery after delete.

## UI Model

Add a compact trip dropdown in the top-left corner of the map stage, above the itinerary stop panel.

This selector is part of the left-side workspace stack rather than the destination search toolbar. The placement should make it clear that the user is choosing the active trip workspace, not filtering the current itinerary.

The closed control shows the active trip name. Opening it shows:

- Existing trips.
- A `New trip` action.
- A `Rename trip` action for the active trip.
- A `Delete trip` action.

The selector should stay usable while a trip has no stops. It should not depend on itinerary content being loaded before the user can switch trips.

## Trip Switching Behavior

Switching trips should:

- Persist the selected trip id to `localStorage` under `world-tour:selected-trip-id`.
- Close any selected destination profile.
- Close any pending map-add confirmation.
- Clear transient errors tied to the previous trip.
- Create a fresh trip-scoped repository for the selected trip.
- Let `useTripData` reload destinations and route legs from that repository.

The map and itinerary should show the standard loading state during the reload. Existing route calculation and route reconciliation logic remain scoped to the loaded trip data.

## Boot Flow

Application startup should:

1. Create the Supabase client.
2. Ensure the existing anonymous Supabase session.
3. Create a trip directory repository.
4. Load the user's trips ordered by `updated_at` descending, then `created_at` descending.
5. Restore `world-tour:selected-trip-id` if it still points to an existing trip.
6. Otherwise select the first available trip.
7. If no trips exist, create and select a trip named `World tour`.
8. Create a scoped `TripRepository` for the selected trip.

This flow replaces hidden trip discovery. The app should not choose a trip by counting destinations or route legs.

## Repository Boundaries

Introduce a `TripDirectoryRepository` for trip metadata and trip lifecycle operations:

```ts
type TripSummary = {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
};

type TripDirectoryRepository = {
  listTrips(): Promise<TripSummary[]>;
  createTrip(input: { name: string }): Promise<TripSummary>;
  updateTrip(tripId: string, patch: { name?: string; description?: string }): Promise<TripSummary>;
  deleteTrip(tripId: string): Promise<void>;
};
```

Keep `TripRepository` focused on the contents of one selected trip: destinations, route legs, media, and full-trip replacement. The Supabase repository constructor should accept an explicit trip id:

```ts
createSupabaseTripRepository(supabase, tripId)
```

The repository should not cache or discover its own active trip id. All destination, route-leg, and media queries should use the constructor-supplied trip id.

## Supabase Behavior

The current database schema is already trip-scoped. `trips`, `destinations`, `route_legs`, and `media_assets` all carry or reference `trip_id`.

Trip directory operations should use the `trips` table:

- `listTrips` selects visible trips ordered consistently.
- `createTrip` inserts a new trip owned by the current anonymous user.
- `updateTrip` updates the selected trip name or description.
- `deleteTrip` deletes the trip row after storage cleanup.

Deleting a trip row cascades database records for destinations, route legs, and media metadata through existing foreign keys. Supabase Storage objects are not deleted by database cascade, so `deleteTrip` must remove storage objects for that trip before deleting the row.

Storage cleanup should select media rows for the trip, group object paths by bucket, and remove those objects through Supabase Storage. If storage cleanup fails, the trip row should not be deleted.

## Local And E2E Storage

`VITE_TRIP_STORAGE=e2e-local` should keep e2e tests isolated from Supabase.

The local path should use an IndexedDB-backed trip directory and trip-scoped local repositories. Local destination and route-leg records should include `tripId`, matching Supabase semantics closely enough for the trip selector to be tested without touching Supabase.

This local path exists for deterministic testing and manual e2e inspection. It should stay narrow and should not grow into a second production storage system.

## Error Handling

If trip list loading fails, show the existing app-level storage error surface.

If creating or renaming a trip fails, keep the current trip selected and show an inline menu/dialog error.

If deleting a trip fails, keep the trip and its data visible. The delete action should report the failure instead of leaving the app in an unknown state.

Deleting a trip requires confirmation that clearly names the trip. After successful deletion:

- If other trips remain, select the next available trip.
- If no trips remain, create and select a new empty `World tour`.
- Remove the deleted id from `localStorage` if it was selected.

## Accessibility

The trip selector should be keyboard reachable before the itinerary panel. Its menu or dialog actions should use standard button semantics, preserve focus, and support `Escape` to close non-destructive UI.

Delete confirmation should move focus into the confirmation UI and return focus to the selector after cancel or completion.

## Testing

Repository tests should cover:

- Listing trips from Supabase.
- Creating a trip for the current anonymous user.
- Renaming a trip.
- Deleting a trip after removing storage objects.
- Not deleting the trip row when storage cleanup fails.
- Creating scoped Supabase trip repositories with explicit trip ids.

App or component tests should cover:

- Startup selecting the remembered trip when it exists.
- Startup falling back when the remembered trip was deleted.
- Startup creating `World tour` when no trips exist.
- Switching trips clears selected and pending UI state.
- Create, rename, and delete flows update the selector and active trip.

E2E coverage should continue using `VITE_TRIP_STORAGE=e2e-local` and should include at least one smoke test proving that trip switching changes the visible itinerary without touching Supabase.

## Migration Notes

Existing Supabase data should not need a schema migration for basic multi-trip selection. The current trip rows and trip-scoped child records are reused.

The main migration is application behavior: remove automatic trip guessing and make every trip-content repository explicit about which trip it serves.
