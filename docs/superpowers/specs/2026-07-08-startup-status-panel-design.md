# Startup Status Panel Design

## Context

The app currently shows two independent startup messages when no destinations are available. `MapCanvas` renders `Blank planning map` whenever it receives an empty destination list, and the app shell separately renders `Loading trip data` or a storage error.

During startup this makes the screen feel broken: the blank-map label appears before the app knows whether data is empty, still loading, or unavailable, and the loading message sits in a small top-left badge.

The next version should treat loading, loaded-empty, and load failure as first-class app states with one centered status panel.

## Goals

- Show one prominent centered status panel during startup and data-load transitions.
- Suppress the `Blank planning map` label while trip data is loading or storage is unavailable.
- Distinguish successful empty-trip state from storage or trip-data failure.
- Keep the map visible behind the status panel so the app still feels map-first.
- Make the status panel accessible and testable.

## Non-Goals

- No changes to trip discovery, trip creation, or Supabase storage architecture.
- No schema changes.
- No new onboarding flow or landing page.
- No change to the normal map, toolbar, or panel layout after trip data has loaded.

## Recommended Approach

Create a small app-owned startup status layer above the map. It receives a status model from `App` and `TripWorkspace`, then renders the correct centered panel:

- `loading`: trip workspace or active trip data is loading.
- `empty`: trip data loaded successfully and the active trip has no destinations.
- `error`: storage bootstrap or active trip-data load failed.

`MapCanvas` should no longer independently decide to show `Blank planning map` from `destinations.length === 0`. The app shell owns whether the map is in a loading, empty, or ready state because only the app shell knows the repository and trip-data status.

This keeps the state decision in one place and prevents accidental duplicate messaging.

## Alternatives Considered

### Restyle the Existing Badges

This would be the smallest code change, but it preserves the split ownership that caused the problem. `MapCanvas` would still show empty-map copy while data is loading.

### Replace the Map With a Full-Screen Loader

This would make loading unmistakable, but it makes the app feel less like a map-first planning tool. Keeping the map visible in the background gives continuity and avoids a landing-page feel.

### Recommended: App-Owned Center Status Panel

This is slightly more structure than restyling, but it fixes the state model directly. It also gives future startup states a single place to render without adding more floating badges.

## State Behavior

### Loading

When trip storage is preparing, app clients are not ready, the active repository is switching, or active trip data is loading, show one centered panel:

- Title: `Loading world tour`
- Detail: `Preparing your trip map.`
- Visual: spinner.

The panel uses `role="status"` and `aria-live="polite"`. Mutation controls remain hidden while loading, matching current behavior.

### Loaded Empty Trip

When trip data loads successfully and `destinations.length === 0`, show a centered empty-state panel:

- Title: `No stops in this trip yet`
- Detail: `Search for a destination or add a stop from the map.`

The normal toolbar and trip selector should be available in this state. This is not an error: it means the selected trip exists and loaded correctly.

The map add-stop gesture should remain available because the app has a valid repository and can save new stops.

### Error

When storage bootstrap fails or active trip data cannot load, show one centered error panel:

- Title: use the existing structured storage title when available, or `Unable to load trip data`.
- Detail: show the current error message.
- Action: `Retry` when a retry path exists.

The panel uses `role="alert"`. The map can remain visible behind it, but mutation controls should stay unavailable until loading succeeds.

## Component Shape

Add a small presentational `AppStatusPanel` component with props:

- `status`: `loading | empty | error`
- `title`
- `message`
- `onRetry?`

The component should not know about repositories, trips, or map data. It only renders the panel.

The app shell or `TripWorkspace` derives the status model from existing state:

- workspace storage loading and client readiness
- storage bootstrap error
- active trip data loading
- active trip data error
- loaded destination count

## Styling

The status panel is centered inside `.map-stage` above the map. It should be larger and calmer than the current small badges:

- Width: responsive, roughly `min(420px, calc(100vw - 32px))`.
- Border radius: use the existing panel radius.
- Background: use the existing translucent overlay surface and backdrop blur.
- Typography: clear title, smaller muted detail text.
- Spinner: sized as a visible status affordance, not decorative noise.

The panel should not introduce a new color theme. Error state may use existing danger tokens for border or title.

Respect reduced motion by disabling spinner animation when `prefers-reduced-motion: reduce`.

## Accessibility

- Loading panel uses `role="status"` and `aria-live="polite"`.
- Empty panel uses `role="status"` and does not interrupt the user.
- Error panel uses `role="alert"`.
- Spinner is marked `aria-hidden="true"` because the text carries the status.
- Retry button, if present, has a clear text label.

## Testing

Update app tests to cover:

- Startup renders one centered status panel with `Loading world tour`.
- `Blank planning map` does not appear while workspace or trip data is loading.
- Storage bootstrap error renders as the centered error panel and hides mutation controls.
- Active trip-data load error renders as the centered error panel.
- Loaded empty trip renders `No stops in this trip yet` with normal add/search controls available.

Update map tests so `MapCanvas` no longer owns the empty-app message.

Add style tests for:

- Centered panel positioning.
- Larger responsive panel width.
- Spinner styles.
- Reduced-motion spinner behavior.
