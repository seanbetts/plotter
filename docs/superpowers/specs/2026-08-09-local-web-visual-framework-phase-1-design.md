# Plotter Local-Web Visual Framework Phase 1 Design

**Date:** 2026-08-09

**Status:** Implemented and verified

## Purpose

Adapt Plotter to the shared local-web visual foundation without redesigning the
application. Phase 1 adds the platform-owned edge-to-edge shell, universal
navigation, shared colour-mode handling, typography and semantic tokens, correct
map-stage sizing, and complete platform-contract compliance.

Plotter keeps its existing full-bleed map composition, floating panel hierarchy,
controls, workflows, domain behaviour, and Supabase-backed storage. Shared control
and feedback primitive migrations are deliberately deferred to a later phase.

## Current Context

Plotter is a React, TypeScript, and Vite static application whose primary surface
is a MapLibre map. Its current workspace contains:

- a full-viewport map canvas;
- the destination search and map export toolbar;
- the trip selector;
- the bottom-left itinerary panel;
- right-side destination and activity panels;
- route-alternative, map-stop, and media-preview overlays; and
- MapLibre navigation, route, stop, activity, and label layers.

The domain and persistence boundaries are already app-owned. Supabase repositories,
realtime subscriptions, IndexedDB e2e storage, trip commands, routing providers,
media services, and map presentation remain outside the platform shell.

The supported existing-app updater has already adopted Plotter into the generated
platform contract in commit `2f0906c`:

- `@local-web/ui` 0.5.2 is vendored with digest
  `47101a066ece3447c14956d959df3986df7c647d9bccaf0eb2023a99856bdcf0`;
- the manifest declares platform contract 1, template 1, and the `supabase`
  capability;
- the canonical Plotter accent is `#D9467A`;
- the reserved live-theme stylesheet is present; and
- the app-local `check` script now runs lint, unit tests, and build.

`local-web app doctor --repository .` reports `plotter: compatible`. The existing
ten-test Playwright suite passes after installing its matching Chromium headless
shell. One verification run exposed an intermittent persistence-polling race in
the Nordkapp test: its UI showed the inserted Aalborg stop and calculating route
legs before the test observed the IndexedDB record. The same test then passed three
targeted repetitions and the next complete suite passed. The new aggregate check
also exposes two pre-existing lint failures in `useTripData.ts` and
`useTripData.test.tsx`. The lint failures and test-stability risk must be resolved
without changing trip behaviour before Phase 1 can pass the complete platform
matrix.

## Scope

### Included in Phase 1

- Use the current `@local-web/ui` public package and generated contract.
- Render every Plotter state inside the shared universal application shell.
- Select the shell's `edge-to-edge` content mode.
- Add the shared system, light, and dark colour-mode behaviour.
- Use the platform typography, neutral palette, spacing, radius, focus, motion,
  shadow, and semantic status tokens.
- Retain `#D9467A` as Plotter's controlled app accent.
- Make the map fill the shell's remaining content track at all supported viewport
  sizes.
- Rebase coordinate-positioned overlays on the map stage rather than the browser
  viewport where the new header makes that distinction material.
- Add focused unit and browser acceptance coverage for shell, theme, sizing,
  responsive behaviour, and unchanged domain workflows.
- Catalogue suitable later shared-primitive migrations without implementing them.

### Excluded from Phase 1

- Replacing existing Plotter buttons, inputs, selects, dialogs, menus, notices,
  icons, or feedback components.
- Changing panel hierarchy, panel content, or workflow sequencing.
- Changing the MapTiler basemap or making it switch with interface colour mode.
- Changing route colours, route rendering semantics, export rendering, stop or
  activity labels, or map-detail logic.
- Changing Supabase schemas, repositories, realtime behaviour, environment names,
  credentials, IndexedDB storage, migrations, or the trip CLI.
- Changing geocoding, reverse geocoding, routing providers, media services, or
  network error behaviour.
- Adding a dashboard container, platform side rail, duplicate Plotter masthead,
  page heading, or bordered map card.
- Registering, deploying, or changing any other application.

## Visual Design

The universal navigation forms one platform-owned row above the application. On
desktop it presents the location trail and colour-mode control on one line. At the
platform's narrow breakpoint it uses its reviewed compact arrangement. Plotter does
not duplicate its name beneath that row.

The map begins immediately below the platform header and reaches all four edges of
the remaining content area. There is no content padding, maximum width, outer
border, or enclosing surface:

```text
+ Local / System Index / Plotter                 System | Light | Dark +
+-----------------------------------------------------------------------+
|                         FULL-BLEED MAP                                |
|                                                                       |
| [Current trip]             [Destination search] [Export]              |
|                                                                       |
|                                            [Activity] [Stop details]  |
|                                                                       |
| [Itinerary]                                              [Map +/-]   |
+-----------------------------------------------------------------------+
```

The existing Plotter overlays retain their current positions relative to the map:

- search and export remain centred at the top;
- the trip selector remains at the top-left or below the toolbar at its existing
  responsive collision breakpoint;
- the itinerary remains bottom-left;
- destination and activity panels remain on the right;
- map navigation remains bottom-right with its existing itinerary clearance; and
- mobile retains the current search, trip selector, bottom itinerary, and full-width
  detail-panel arrangement.

Only the available map height changes: it becomes the shell content track rather
than the entire browser viewport.

## Architecture and Ownership

### Platform contract

The committed updater output remains authoritative. Plotter must not reconstruct or
copy templates, provenance, or the UI artifact. Future platform refreshes use:

```sh
"$LOCAL_WEB" app update --repository . --dry-run
"$LOCAL_WEB" app update --repository .
```

The `supabase` capability is supplied only for initial legacy adoption and is not
repeated for normal refreshes.

### Shared shell

Add one thin app-owned wrapper around the public `AppShell` API. It supplies the
Plotter identity and `contentMode="edge-to-edge"`; it does not add navigation or
action slots. With no legacy slots, `AppShell` renders the current universal
location shell and shared colour-mode control.

Both the startup/loading branch and the ready workspace branch render inside this
wrapper exactly once. The shared shell owns the page's sole `main` landmark.
Plotter's current root `main.app-shell` becomes a non-landmark workspace element,
while the labelled map stage remains a region.

### Theme bootstrap and fallback

Import `@local-web/ui/styles.css` through the application entry point. Add the public
`localWebApp()` Vite integration using Plotter's existing normalized public base
path. The plugin owns independent-development fallback theme serving and build-time
colour-mode bootstrap injection. The reserved live theme URL remains the hosted
source of truth.

Plotter must not copy the platform fallback stylesheet, theme control, bootstrap
script, or shell CSS into app source. If the live theme is unavailable, the
vendored package fallback tokens keep the app usable.

### Token compatibility layer

Preserve established Plotter CSS variable names where doing so avoids a broad
selector rewrite, but redefine generic values through public `--lwp-*` tokens.
The compatibility layer covers:

- canvas, surface, text, muted text, line, accent, danger, warning, and success
  colours;
- shared sans and mono typography;
- spacing;
- control and surface radii;
- focus width and colour;
- shadows; and
- motion duration and easing.

Floating panel translucency remains a Plotter composition. It is expressed with
`color-mix()` from platform surface and canvas tokens rather than duplicated fixed
light/dark palettes. The existing blur strength and spatial role remain app-owned.

Map-specific colours remain explicit domain tokens. Interface theme changes must
not silently recolour saved route semantics, the basemap, map export, selected-stop
presentation, shipping legs, border crossings, or native MapLibre label paint.

### Map-stage sizing

The edge-to-edge platform shell is a two-row grid: universal header plus a
`minmax(0, 1fr)` main track. Plotter fills that track using percentage/grid sizing
and `min-height: 0`; it must not subtract a guessed header height or retain a
workspace `100vh` minimum that creates overflow below the header.

MapLibre continues to use an absolutely positioned canvas within the relative map
stage. A resize caused by shell or viewport geometry must reach MapLibre through
the existing component lifecycle or an explicit resize observation if current
behaviour proves insufficient.

Coordinate-positioned overlays such as the non-modal add-stop confirmation use the
map-stage bounding rectangle for coordinate translation, clamping, and available
height. This preserves their visual relationship to the pointer after the map is no
longer aligned with viewport coordinate `0,0`.

## Behaviour and Data Preservation

The shell and token integration do not alter application state or data flow.
`App`, `useTripWorkspace`, and `useTripData` continue to own trip selection,
destination selection, activity selection, route alternatives, map-stop
confirmation, media preview, and persistence operations.

No Phase 1 change may modify:

- repository selection or Supabase client creation;
- subscription or reload timing;
- optimistic or atomic mutation paths;
- routing calculation, fallback, or persisted geometry rules;
- trip map export contents or filename behaviour;
- provider request construction;
- storage keys or migration behaviour; or
- user-facing workflow labels and action ordering.

Existing component and e2e tests remain behavioural regression contracts.

## Deferred Shared-Primitive Catalogue

The following are suitable candidates for a separately designed Phase 2. Their
inclusion here records opportunities only; Phase 1 must not convert them.

| Plotter surface | Candidate public primitive | Reason to defer |
| --- | --- | --- |
| Startup and empty/error overlay | `LoadingState`, `EmptyState`, `ErrorState` | Preserve current map-overlay positioning while Phase 1 changes shell geometry. |
| Search and export toolbar | `TextInput`, `IconButton`, `InlineNotice`, `Icon` | Combobox ARIA, keyboard scheduling, and export state require focused regression work. |
| Trip create/edit/delete | `Dialog`, `Field`, `TextInput`, `Select`, `Button` | Trip menu, focus return, vehicle selection, and destructive confirmation form one independent workflow. |
| Common action icons | `Icon`, `IconButton`, `Tooltip` | A full icon inventory should precede removal of Lucide. |
| Panel edit controls | `Button`, `IconButton`, form primitives | Destination, activity, tag, link, and media editors should migrate component by component. |
| Route and storage notices | `InlineNotice`, `Badge`, `StatusDot` | Domain severity and compact itinerary placement need separate visual review. |

Map-specific menus, drag handles, route diagrams, image layouts, itinerary rows, and
non-modal pointer-positioned confirmations remain app-owned even if their internal
generic controls later use shared primitives.

## Failure Handling

- An unavailable live theme falls back to vendored package tokens.
- Blocked local storage leaves the shared colour control in system mode without
  preventing Plotter from loading.
- Shell integration applies to loading and repository-error states, so navigation
  and theme control remain available during failure.
- Theme changes never trigger Supabase reloads, route recalculation, map export, or
  domain persistence.
- If the shared edge-to-edge contract cannot express a required map geometry, work
  stops at the platform boundary rather than adding a private shell substitute.

No such full-bleed platform gap is currently known: UI 0.5.2 exposes and tests the
required `edge-to-edge` content mode at desktop, 390 px, and 320 px.

## Verification and Acceptance

### Focused source checks

- Platform identity and base-path tests cover Plotter, route icon, `#D9467A`, and
  `/plotter/` normalization.
- Shell tests prove one universal header, one `main` landmark, the Plotter location,
  shared colour control, and edge-to-edge main class in startup and ready states.
- Style tests prove generic Plotter aliases resolve through `--lwp-*` tokens and
  preserve an allowlist of map/domain colours.
- Map-stage tests cover remaining-track sizing and map-relative overlay clamping.
- Existing unit tests remain green without expectation weakening.

### Rendered acceptance

Inspect light and dark modes at desktop, 390 px, and 320 px. At each size verify:

- the platform navigation and colour control are visible and usable;
- the map touches every edge of the shell content track;
- there is no page-level horizontal or vertical overflow;
- search, trip selector, itinerary, detail panels, route alternatives, map controls,
  and media overlays retain their hierarchy;
- colour choice persists across reload and system mode follows the OS preference;
- focus indicators and text remain legible over the map; and
- changing theme does not change domain data or route/map semantics.

Exercise representative existing flows: trip switching, destination search, map
stop addition, route recovery/alternatives, activity panel opening, media import,
itinerary scrolling, and map-only export.

### Complete platform matrix

After resolving the recorded lint baseline and completing source integration, run:

```sh
"$LOCAL_WEB" app doctor --repository .
npm run check
npm run test:e2e
"$LOCAL_WEB" app check --repository .
git diff --check
```

Also verify independent root development with package fallback tokens and a
`VITE_PUBLIC_BASE_PATH=/plotter/` build with the hosted live theme. Completion
requires every matrix row to pass; the existing lint failures may not be waived or
hidden by weakening the check script. The observed Nordkapp polling race must be
stabilized or disproved with repeated complete-suite evidence; any test adjustment
must wait for persistence instead of weakening its domain assertions.

## Success Criteria

Phase 1 succeeds when Plotter visibly belongs to the shared local-web system while
still feeling like the same map application: one universal header, one shared theme
contract, one token language, and the existing full-bleed workspace and behaviour
unchanged beneath it.
