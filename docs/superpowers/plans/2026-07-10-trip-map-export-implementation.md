# Trip Map Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a camera action beside destination search that downloads a fixed-size PNG containing the active trip's full route and numbered stop labels.

**Architecture:** Keep the interactive `MapCanvas` untouched during capture. Extract the small map-presentation and route-feature primitives that both maps need, then create a temporary 1600 x 1000 MapLibre map for each export, render it to a composed PNG, and destroy it. `App` passes current trip data into the exporter while `TopToolbar` owns only busy and local-error presentation.

**Tech Stack:** React 19, TypeScript 6, MapLibre GL 5, GeoJSON, Lucide React, Vitest, Testing Library, Playwright

## Global Constraints

- Output is a fixed 1600 x 1000 PNG with `pixelRatio: 1`.
- Output contains only the calm basemap, route legs, ordered stop markers, numbered stop labels, and required provider attribution.
- Output excludes app chrome, activities, selection state, navigation controls, and development controls.
- The export viewport includes every stop coordinate and every coordinate in rendered route geometry.
- The active trip name becomes a safe hyphenated filename; the fallback is exactly `world-tour.png`.
- Trips with no stops are not exportable.
- Export must never move, resize, or otherwise mutate the interactive `MapCanvas`.
- Only one export may run at a time, and every temporary map, DOM node, timer, anchor, and blob URL must be released on success or failure.
- Use normal app storage for manual browser verification and `VITE_TRIP_STORAGE=e2e-local` for Playwright.
- Preserve unrelated working-tree edits and path-limit every commit to the files named by its task.

---

### Task 1: Share Map Presentation and Route Feature Primitives

**Files:**
- Create: `src/map/mapPresentation.ts`
- Create: `src/map/mapPresentation.test.ts`
- Create: `src/map/tripRouteFeatures.ts`
- Create: `src/map/tripRouteFeatures.test.ts`
- Modify: `src/components/MapCanvas.tsx`
- Test: `src/components/MapCanvas.test.tsx`

**Interfaces:**
- Produces: `mapStyleUrl: string`, `mapLabelFontStack: string[]`, `calmBasemapStyle(map): void`, and `readMapLayerColors(): MapLayerColors`.
- Produces: `routeGeometryForLeg(destinations, leg): LineString | null`, `buildRenderableRouteFeatures(destinations, routeLegs)`, and `tripMapBounds(destinations, routeLegs)`.
- Consumed by: `src/map/tripMapExport.ts` in Task 2.

- [ ] **Step 1: Write failing tests for shared map presentation**

Create `src/map/mapPresentation.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { calmBasemapStyle, mapLabelFontStack, mapStyleUrl, readMapLayerColors } from './mapPresentation';

describe('mapPresentation', () => {
  it('provides a usable style and label font stack', () => {
    expect(mapStyleUrl).toMatch(/^https:\/\//);
    expect(mapLabelFontStack.length).toBeGreaterThan(0);
  });

  it('hides noisy basemap layers', () => {
    const setLayoutProperty = vi.fn();
    const setPaintProperty = vi.fn();
    const map = {
      getStyle: () => ({
        layers: [
          { id: 'poi-label', type: 'symbol' },
          { id: 'road_minor', type: 'line' },
          { id: 'country-label', type: 'symbol' },
        ],
      }),
      setLayoutProperty,
      setPaintProperty,
    };

    calmBasemapStyle(map as never);

    expect(setLayoutProperty).toHaveBeenCalledWith('poi-label', 'visibility', 'none');
    expect(setPaintProperty).toHaveBeenCalledWith('road_minor', 'line-opacity', 0.32);
    expect(setLayoutProperty).not.toHaveBeenCalledWith('country-label', 'visibility', 'none');
  });

  it('returns complete layer colors', () => {
    expect(readMapLayerColors()).toMatchObject({
      accent: expect.any(String),
      shipping: expect.any(String),
      text: expect.any(String),
      textInverse: expect.any(String),
    });
  });
});
```

- [ ] **Step 2: Write failing tests for route semantics and complete bounds**

Create `src/map/tripRouteFeatures.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createDestination } from '../domain/destinations';
import { createRouteLeg } from '../domain/routeLegs';
import { buildRenderableRouteFeatures, routeGeometryForLeg, tripMapBounds } from './tripRouteFeatures';

const origin = createDestination({ name: 'Origin', countryRegion: 'A', coordinates: { lat: 10, lng: 20 } });
const target = createDestination({ name: 'Target', countryRegion: 'B', coordinates: { lat: 30, lng: 40 } });

describe('tripRouteFeatures', () => {
  it('uses ready driving geometry and its furthest waypoint in bounds', () => {
    const leg = {
      ...createRouteLeg(origin.id, target.id, 0),
      status: 'ready' as const,
      geometry: { type: 'LineString' as const, coordinates: [[20, 10], [55, -5], [40, 30]] },
    };

    expect(routeGeometryForLeg([origin, target], leg)).toEqual(leg.geometry);
    expect(tripMapBounds([origin, target], [leg])).toEqual([[20, -5], [55, 30]]);
  });

  it('uses endpoint fallback for shipping geometry and failed driving legs', () => {
    const shipping = { ...createRouteLeg(origin.id, target.id, 0), type: 'shipping-manual' as const, status: 'manual' as const };
    const failed = { ...createRouteLeg(origin.id, target.id, 1), status: 'failed' as const };
    expect(routeGeometryForLeg([origin, target], shipping)?.coordinates).toEqual([[20, 10], [40, 30]]);
    expect(buildRenderableRouteFeatures([origin, target], [failed]).features[0].properties.type).toBe('failed');
  });

  it('omits pending driving legs', () => {
    const pending = { ...createRouteLeg(origin.id, target.id, 0), status: 'pending' as const };
    expect(buildRenderableRouteFeatures([origin, target], [pending]).features).toEqual([]);
  });

  it('returns identical corners for one stop and null for no stops', () => {
    expect(tripMapBounds([origin], [])).toEqual([[20, 10], [20, 10]]);
    expect(tripMapBounds([], [])).toBeNull();
  });
});
```

- [ ] **Step 3: Run the tests and verify the missing-module failure**

Run:

```bash
npm test -- src/map/mapPresentation.test.ts src/map/tripRouteFeatures.test.ts
```

Expected: FAIL because both modules are missing.

- [ ] **Step 4: Extract the presentation primitives**

Create `src/map/mapPresentation.ts` by moving the existing style URL, label font selection, calm basemap arrays, CSS token fallbacks, and color readers out of `MapCanvas.tsx`. Export these signatures:

```ts
import type maplibregl from 'maplibre-gl';

export const mapStyleUrl: string;
export const mapLabelFontStack: string[];
export type MapLayerColors = {
  accent: string;
  accentHalo: string;
  selected: string;
  shipping: string;
  text: string;
  textInverse: string;
  cityText: string;
  cityHalo: string;
};
export function readMapLayerColors(): MapLayerColors;
export function calmBasemapStyle(
  map: Pick<maplibregl.Map, 'getStyle' | 'setLayoutProperty' | 'setPaintProperty'>,
): void;
```

Retain the existing MapTiler-key behavior and exact fallback colors. Update `MapCanvas.tsx` to import these APIs and remove only the duplicate local definitions. Keep detail-category configuration local to `MapCanvas`.

- [ ] **Step 5: Extract route rendering and implement bounds**

Create `src/map/tripRouteFeatures.ts` by moving the existing destination lookup, straight-line fallback, usable-LineString check, route type, and feature construction out of `MapCanvas.tsx`:

```ts
import type { FeatureCollection, LineString } from 'geojson';
import type { Destination, RouteLeg } from '../domain/types';

export type RouteFeatureProperties = {
  id: string;
  type: RouteLeg['type'] | 'failed';
  status: RouteLeg['status'];
};

export function routeGeometryForLeg(destinations: Destination[], leg: RouteLeg): LineString | null;
export function buildRenderableRouteFeatures(
  destinations: Destination[],
  routeLegs: RouteLeg[],
): FeatureCollection<LineString, RouteFeatureProperties>;
export function tripMapBounds(
  destinations: Destination[],
  routeLegs: RouteLeg[],
): [[number, number], [number, number]] | null;
```

`tripMapBounds` must fold all stop `[lng, lat]` pairs plus every coordinate returned by `routeGeometryForLeg` into min/max corners. Update `MapCanvas.tsx` to call `buildRenderableRouteFeatures` and delete its duplicate helpers.

- [ ] **Step 6: Run focused regression coverage**

Run:

```bash
npm test -- src/map/mapPresentation.test.ts src/map/tripRouteFeatures.test.ts src/components/MapCanvas.test.tsx
```

Expected: PASS, including existing calm-style, shipping, failed-route, source, and viewport tests.

- [ ] **Step 7: Commit the shared primitives**

```bash
git add src/map/mapPresentation.ts src/map/mapPresentation.test.ts src/map/tripRouteFeatures.ts src/map/tripRouteFeatures.test.ts src/components/MapCanvas.tsx src/components/MapCanvas.test.tsx
git commit -m "refactor: share trip map rendering primitives"
```

---

### Task 2: Build the Off-Screen PNG Exporter

**Files:**
- Create: `src/map/tripMapExport.ts`
- Create: `src/map/tripMapExport.test.ts`

**Interfaces:**
- Consumes Task 1 presentation and route helpers.
- Produces: `downloadTripMap({ tripName, destinations, routeLegs }): Promise<void>`.
- Produces for direct tests: `tripMapFilename(name): string` and `buildExportStopFeatures(destinations)`.
- Consumed by: `App.tsx` in Task 4.

- [ ] **Step 1: Write failing pure-behavior tests**

Create `src/map/tripMapExport.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { createDestination } from '../domain/destinations';
import { buildExportStopFeatures, tripMapFilename } from './tripMapExport';

describe('tripMapFilename', () => {
  it.each([
    ['Wild Atlantic Way', 'Wild-Atlantic-Way.png'],
    ['  Japan / Korea: 2027  ', 'Japan-Korea-2027.png'],
    ['***', 'world-tour.png'],
  ])('turns %j into %j', (input, expected) => {
    expect(tripMapFilename(input)).toBe(expected);
  });
});

it('numbers stop labels in canonical array order', () => {
  const first = createDestination({ name: 'Balcombe', countryRegion: 'UK', coordinates: { lat: 51, lng: 0 } });
  const second = createDestination({ name: 'Paris', countryRegion: 'France', coordinates: { lat: 49, lng: 2 } });
  expect(buildExportStopFeatures([first, second]).features.map(({ properties }) => properties)).toEqual([
    { id: first.id, name: 'Balcombe', number: 1, label: '1 - Balcombe' },
    { id: second.id, name: 'Paris', number: 2, label: '2 - Paris' },
  ]);
});
```

- [ ] **Step 2: Add failing lifecycle tests with a hoisted MapLibre mock**

In the same file, mock `maplibre-gl` with recorded constructor options, event callbacks, sources, layers, `fitBounds`, `jumpTo`, `getStyle`, `getCanvas`, and `remove`. Stub `HTMLCanvasElement.getContext`, `toBlob`, object URL APIs, and anchor clicks.

Add named tests that assert:

- Constructor receives `pixelRatio: 1`, `attributionControl: false`, `interactive: false`, and `canvasContextAttributes.preserveDrawingBuffer: true`.
- The temporary `[data-trip-map-export]` container is exactly 1600 x 1000.
- `load` adds route, stop point, stop number, and stop name layers.
- Stop numbers use `text-allow-overlap: true`; stop names use variable anchors.
- Multi-point bounds call `fitBounds(bounds, { padding: 120, maxZoom: 6, duration: 0 })`.
- A one-stop trip calls `jumpTo({ center, zoom: 6 })`.
- No PNG conversion occurs before `idle`.
- Source attribution is drawn onto the output canvas before `toBlob`.
- The anchor download name is `Wild-Atlantic-Way.png`.
- Success removes the map/container/anchor and revokes the URL.
- A 15,000 ms load or idle timeout rejects and cleans up, using fake timers.
- A null blob rejects with `Unable to create trip map PNG.` and cleans up.
- Empty destinations reject before constructing MapLibre.

- [ ] **Step 3: Run the exporter test and verify failure**

Run:

```bash
npm test -- src/map/tripMapExport.test.ts
```

Expected: FAIL because `tripMapExport.ts` is missing.

- [ ] **Step 4: Implement filename and stop feature helpers**

Create `src/map/tripMapExport.ts` with:

```ts
export type TripMapExportInput = {
  tripName: string;
  destinations: Destination[];
  routeLegs: RouteLeg[];
};

export function tripMapFilename(name: string) {
  const stem = name
    .normalize('NFKD')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return `${stem || 'world-tour'}.png`;
}

export function buildExportStopFeatures(destinations: Destination[]) {
  return {
    type: 'FeatureCollection' as const,
    features: destinations.map((destination, index) => ({
      type: 'Feature' as const,
      id: destination.id,
      geometry: {
        type: 'Point' as const,
        coordinates: [destination.coordinates.lng, destination.coordinates.lat],
      },
      properties: {
        id: destination.id,
        name: destination.name,
        number: index + 1,
        label: `${index + 1} - ${destination.name}`,
      },
    })),
  };
}
```

- [ ] **Step 5: Implement the deterministic export map**

Use exact constants:

```ts
const exportWidth = 1600;
const exportHeight = 1000;
const exportPadding = 120;
const exportMaxZoom = 6;
const exportTimeoutMs = 15_000;
```

Create an off-screen but renderable fixed container at `left: -100000px`, append it to `document.body`, and construct:

```ts
new maplibregl.Map({
  container,
  style: mapStyleUrl,
  center: [18, 24],
  zoom: 1.4,
  pixelRatio: 1,
  attributionControl: false,
  interactive: false,
  canvasContextAttributes: { preserveDrawingBuffer: true },
});
```

After `load`, apply `calmBasemapStyle`, add Task 1 route features and export stop features, and add:

1. The same type-based route color/dash/opacity layer used by `MapCanvas`.
2. Accent stop circles with inverse two-pixel strokes.
3. Centered stop numbers with overlap and placement ignored so every numeric marker remains visible.
4. `<number> - <name>` labels using `mapLabelFontStack`, `text-variable-anchor: ['top', 'bottom', 'left', 'right']`, radial offset 1.4, auto justification, inverse text, and a two-pixel light halo.

Use `tripMapBounds`. Call zero-duration `fitBounds` for an area and `jumpTo` at zoom 6 for one coordinate.

- [ ] **Step 6: Implement waiting, attribution composition, download, and cleanup**

Implement `waitForMapEvent(map, event, 15_000)` with `map.once`, a rejecting timeout, and timer cleanup.

After `idle`, copy the WebGL canvas into a new 1600 x 1000 2D canvas. Collect non-empty `attribution` strings from `map.getStyle().sources`, strip HTML through a detached element, deduplicate, and draw them at bottom-right over a translucent light rectangle. Convert the output with `toBlob(callback, 'image/png')`.

Implement the lifecycle as one `try/finally`:

```ts
export async function downloadTripMap(input: TripMapExportInput): Promise<void> {
  if (input.destinations.length === 0) {
    throw new Error('Trip map export requires at least one stop.');
  }

  const container = createExportContainer();
  const map = createExportMap(container);
  let objectUrl: string | null = null;
  let anchor: HTMLAnchorElement | null = null;

  try {
    await waitForMapEvent(map, 'load', exportTimeoutMs);
    addExportSourcesAndLayers(map, input.destinations, input.routeLegs);
    frameExportMap(map, input.destinations, input.routeLegs);
    await waitForMapEvent(map, 'idle', exportTimeoutMs);
    const blob = await exportBlob(map);
    objectUrl = URL.createObjectURL(blob);
    anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = tripMapFilename(input.tripName);
    document.body.append(anchor);
    anchor.click();
  } finally {
    anchor?.remove();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    map.remove();
    container.remove();
  }
}
```

Reject with `Unable to create trip map PNG.` if the 2D context is unavailable or `toBlob` returns null. Canvas security exceptions may propagate to the toolbar's single error treatment.

- [ ] **Step 7: Run exporter regressions**

Run:

```bash
npm test -- src/map/tripMapExport.test.ts src/map/tripRouteFeatures.test.ts src/map/mapPresentation.test.ts src/components/MapCanvas.test.tsx
```

Expected: PASS, with fake timers restored in `afterEach`.

- [ ] **Step 8: Commit the exporter**

```bash
git add src/map/tripMapExport.ts src/map/tripMapExport.test.ts
git commit -m "feat: generate downloadable trip map PNGs"
```

---

### Task 3: Add Camera, Busy, and Local Error States to the Toolbar

**Files:**
- Modify: `src/components/TopToolbar.tsx`
- Modify: `src/components/TopToolbar.test.tsx`
- Modify: `src/styles.css`
- Modify: `src/styles.test.ts`

**Interfaces:**
- Consumes: `canExportTripMap: boolean` and `onExportTripMap: () => Promise<void> | void`.
- Produces: one camera action with local `isExporting` and `exportError` state.

- [ ] **Step 1: Write failing toolbar tests**

Add a `renderToolbar` helper that supplies all existing props plus export defaults. Add:

```ts
it('renders export to the right of search', () => {
  const { container } = renderToolbar({ canExportTripMap: true });
  const camera = screen.getByRole('button', { name: 'Download trip map' });
  expect(container.querySelector('.top-toolbar')?.lastElementChild).toBe(camera);
});

it('disables export when there are no stops', () => {
  renderToolbar({ canExportTripMap: false });
  expect(screen.getByRole('button', { name: 'Download trip map' })).toBeDisabled();
});

it('prevents repeat clicks while pending', async () => {
  const request = deferred<void>();
  const onExportTripMap = vi.fn(() => request.promise);
  const user = userEvent.setup();
  renderToolbar({ canExportTripMap: true, onExportTripMap });
  await user.click(screen.getByRole('button', { name: 'Download trip map' }));
  expect(screen.getByRole('button', { name: 'Generating trip map' })).toBeDisabled();
  expect(onExportTripMap).toHaveBeenCalledTimes(1);
  request.resolve();
  expect(await screen.findByRole('button', { name: 'Download trip map' })).toBeEnabled();
});

it('shows a retryable local error', async () => {
  const user = userEvent.setup();
  renderToolbar({ canExportTripMap: true, onExportTripMap: vi.fn().mockRejectedValue(new Error('failed')) });
  await user.click(screen.getByRole('button', { name: 'Download trip map' }));
  expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't export trip map. Try again.");
});
```

- [ ] **Step 2: Verify the focused test fails**

Run:

```bash
npm test -- src/components/TopToolbar.test.tsx
```

Expected: FAIL because export props and UI are missing.

- [ ] **Step 3: Implement the camera action**

Import `useEffect`, `useState`, `Camera`, and `LoaderCircle`. Extend props:

```ts
canExportTripMap: boolean;
onExportTripMap: () => Promise<void> | void;
```

The click handler clears old errors, sets busy, awaits the callback, sets exactly `Couldn't export trip map. Try again.` on rejection, and clears busy in `finally`. Clear errors when `canExportTripMap` becomes false.

Render immediately after `SearchCombobox`:

```tsx
<button
  type="button"
  className="toolbar-icon-action trip-map-export-action"
  aria-label={isExporting ? 'Generating trip map' : 'Download trip map'}
  disabled={!canExportTripMap || isExporting}
  onClick={() => void handleExportTripMap()}
>
  {isExporting
    ? <LoaderCircle className="trip-map-export-spinner" aria-hidden="true" />
    : <Camera aria-hidden="true" />}
</button>
{exportError ? <span className="trip-map-export-error" role="alert">{exportError}</span> : null}
```

- [ ] **Step 4: Style busy, disabled, and error presentation**

Use existing toolbar tokens. Keep the camera 44 x 44, add a clear disabled treatment, animate the spinner with existing `route-spin 900ms linear infinite`, and position the error absolutely below the camera so it does not resize search. Extend the reduced-motion media query to set `.trip-map-export-spinner { animation: none; }`.

Add style assertions:

```ts
expect(styles).toMatch(/\.trip-map-export-spinner\s*{[^}]*animation:\s*route-spin 900ms linear infinite;/s);
expect(styles).toMatch(/\.trip-map-export-error\s*{[^}]*position:\s*absolute;/s);
expect(styles).toMatch(/@media \(prefers-reduced-motion:\s*reduce\)\s*{[^}]*\.trip-map-export-spinner\s*{[^}]*animation:\s*none;/s);
```

- [ ] **Step 5: Run toolbar and style tests**

Run:

```bash
npm test -- src/components/TopToolbar.test.tsx src/styles.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the toolbar slice**

```bash
git add src/components/TopToolbar.tsx src/components/TopToolbar.test.tsx src/styles.css src/styles.test.ts
git commit -m "feat: add trip map download action"
```

---

### Task 4: Wire Active Trip Data and Verify the Download

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `tests/world-tour.spec.ts`

**Interfaces:**
- Consumes: `downloadTripMap(TripMapExportInput)` from Task 2.
- Consumes: toolbar props from Task 3.
- Produces: the complete active-trip-to-PNG flow.

- [ ] **Step 1: Mock the exporter and write failing App tests**

In `src/App.test.tsx`:

```ts
vi.mock('./map/tripMapExport', () => ({ downloadTripMap: vi.fn() }));
import { downloadTripMap } from './map/tripMapExport';
```

Reset it with `vi.mocked(downloadTripMap).mockReset().mockResolvedValue(undefined)`. Add:

```ts
it('disables trip map export for an empty trip', async () => {
  repositoryMock.initialDestinations = Promise.resolve([]);
  repositoryMock.initialRouteLegs = Promise.resolve([]);
  render(<App />);
  expect(await screen.findByRole('button', { name: 'Download trip map' })).toBeDisabled();
});

it('exports the active trip name, stops, and route legs', async () => {
  const user = userEvent.setup();
  repositoryMock.initialDestinations = Promise.resolve([balcombe, paris]);
  repositoryMock.initialRouteLegs = Promise.resolve([readyRouteLeg]);
  render(<App />);
  await user.click(await screen.findByRole('button', { name: 'Download trip map' }));
  await waitFor(() => expect(downloadTripMap).toHaveBeenCalledWith({
    tripName: tripsMock[0].name,
    destinations: [balcombe, paris],
    routeLegs: [readyRouteLeg],
  }));
});
```

Use existing suite fixtures or domain factories with those local names.

- [ ] **Step 2: Verify App tests fail**

Run:

```bash
npm test -- src/App.test.tsx
```

Expected: FAIL because `TripWorkspace` does not pass export props.

- [ ] **Step 3: Wire `TripWorkspace`**

Import `downloadTripMap`. Add:

```ts
const handleExportTripMap = useCallback(async () => {
  if (!activeTrip || destinations.length === 0) {
    throw new Error('Trip map export requires an active trip with at least one stop.');
  }

  await downloadTripMap({
    tripName: activeTrip.name,
    destinations,
    routeLegs,
  });
}, [activeTrip, destinations, routeLegs]);
```

Pass:

```tsx
canExportTripMap={Boolean(activeTrip) && destinations.length > 0}
onExportTripMap={handleExportTripMap}
```

Do not add export state to `App` or use the blocking storage error panel.

- [ ] **Step 4: Add a Playwright download test**

In `tests/world-tour.spec.ts`, import `readFile` from `node:fs/promises`. Follow the suite's existing e2e-local setup: clear IndexedDB with CDP, mock MapTiler geocoding for two named stops, mock OpenRouteService with a ready LineString, create a new trip named `Wild Atlantic Way` through `TripSelector`, and add both stops through destination search. Wait for the download, assert `Wild-Atlantic-Way.png`, and read PNG IHDR bytes:

```ts
const bytes = await readFile((await download.path())!);
expect(bytes.subarray(1, 4).toString()).toBe('PNG');
expect(bytes.readUInt32BE(16)).toBe(1600);
expect(bytes.readUInt32BE(20)).toBe(1000);
```

Before clicking, record the live `.maplibregl-canvas` element's width, height, and CSS transform. Assert those values are unchanged after the download. The exporter lifecycle tests prove that `fitBounds` and `jumpTo` are called only on the separately constructed export map; manual verification below confirms center and zoom visually.

- [ ] **Step 5: Run complete verification**

Run:

```bash
npm test -- src/App.test.tsx src/components/TopToolbar.test.tsx src/map/tripMapExport.test.ts src/map/tripRouteFeatures.test.ts src/map/mapPresentation.test.ts src/components/MapCanvas.test.tsx src/styles.test.ts
npm run lint
npm run build
npm run test:e2e -- --grep "downloads a map-only PNG"
```

Expected: all commands exit 0; Playwright downloads a 1600 x 1000 PNG with the trip-derived name and unchanged visible map pixels.

- [ ] **Step 6: Perform manual rendered verification**

Run `npm run dev` separately and export a real multi-stop trip. Confirm:

- Camera is to the right of centered search.
- The image includes the complete line geometry, numeric markers, and readable stop labels.
- Activities, selection halos, panels, controls, and search are absent.
- Attribution appears at bottom-right when supplied by style sources.
- The filename matches the active trip name.
- The live map center, zoom, and selection do not change.

Stop the server after verification.

- [ ] **Step 7: Commit App wiring and e2e coverage**

```bash
git add src/App.tsx src/App.test.tsx tests/world-tour.spec.ts
git commit -m "feat: wire trip map export into the app"
```

- [ ] **Step 8: Confirm final scope**

Run:

```bash
git status --short
git log -4 --oneline
```

Expected: only pre-existing unrelated edits remain unstaged, and the four feature commits appear in task order.
