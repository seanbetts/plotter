# Trip Map Export Stop Pill Fidelity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the downloaded 1600 × 1000 trip-map PNG render the same stop-pill text and CSS presentation as the live map.

**Architecture:** Extract the live destination-pill presentation model into a small pure module consumed by `MapCanvas` and the exporter. Keep the dedicated export MapLibre map for basemap, routes, and stop points, but replace its number/name symbol layers with a DOM overlay using the app's real `.map-destination-label` classes; rasterize that styled overlay and composite it over the map canvas before attribution and PNG conversion.

**Tech Stack:** React 19, TypeScript 6, MapLibre GL 5, browser DOM/SVG/canvas APIs, Vitest, Testing Library, Playwright, Codex Browser

## Global Constraints

- Output remains exactly 1600 × 1000 pixels and map-only.
- Keep complete-route bounds, dateline unwrapping, route semantics, export padding, maximum zoom, attribution, filename sanitization, and camera-button behaviour unchanged.
- Exported stop text is exactly `<marker> - <stop name>` using `formatStopMarker`: `ST`, `02`, `03`, and so on.
- Every exported stop uses the normal unselected `.map-destination-label` treatment.
- Do not export activity labels, selected-stop styling, app chrome, panels, controls, or development tools.
- The visible interactive map must not move, resize, or otherwise change during export.
- Do not add a DOM-screenshot dependency; use the browser's existing SVG `foreignObject`, `Image`, and canvas composition APIs.
- Any overlay-render failure prevents download and uses the existing toolbar error path.
- Every temporary map, overlay, SVG URL, image handler, download URL, anchor, and container is cleaned up on success and failure.
- Preserve unrelated working-tree changes and path-limit commits.
- Use `VITE_TRIP_STORAGE=e2e-local` only through the repository's existing Playwright workflow.

---

## File Structure

- Create `src/map/stopPillPresentation.ts`: canonical stop-pill text, class names, projected presentation type, and DOM element construction shared by live and export maps.
- Create `src/map/stopPillPresentation.test.ts`: pure regression coverage for numbering, state, classes, and generated overlay elements.
- Modify `src/components/MapCanvas.tsx`: consume the shared presentation model and class builder without changing live behaviour.
- Modify `src/components/MapCanvas.test.tsx`: prove live labels still render canonical text, selection class, and placement class through the shared contract.
- Modify `src/map/tripMapExport.ts`: remove export-only text layers, create/project the DOM overlay, inline its computed CSS, rasterize it, and composite it into the final PNG.
- Modify `src/map/tripMapExport.test.ts`: prove the old renderer fails the new contract, then cover overlay timing, exact classes/text, layer removal, and cleanup.
- Modify `tests/world-tour.spec.ts`: retain existing download/dimension/map-stability coverage and assert the live reference pills are present before export.

### Task 1: Share the Live Stop-Pill Presentation Contract

**Files:**
- Create: `src/map/stopPillPresentation.ts`
- Create: `src/map/stopPillPresentation.test.ts`
- Modify: `src/components/MapCanvas.tsx:44-63, 910-932, 1598-1620`
- Test: `src/components/MapCanvas.test.tsx:1388-1430`

**Interfaces:**
- Consumes: `Destination`, `formatStopMarker(stopNumber)`, and projected `{ x, y }` coordinates.
- Produces: `StopPillPosition`, `StopPillPresentation`, `stopPillText(name, stopIndex)`, `stopPillClassName({ selected, position })`, `buildStopPillPresentations(input)`, and `createStopPillElement(pill)`.
- Consumed by: `MapCanvas` in this task and `tripMapExport` in Task 2.

- [ ] **Step 1: Write failing pure presentation tests**

Create `src/map/stopPillPresentation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createDestination } from '../domain/destinations';
import {
  buildStopPillPresentations,
  createStopPillElement,
  stopPillClassName,
  stopPillText,
} from './stopPillPresentation';

const balcombe = createDestination({
  name: 'Balcombe',
  countryRegion: 'United Kingdom',
  coordinates: { lat: 51.055, lng: -0.136 },
});
const ghent = createDestination({
  name: 'Ghent',
  countryRegion: 'Belgium',
  coordinates: { lat: 51.054, lng: 3.717 },
});

describe('stopPillPresentation', () => {
  it('uses the live app numbering and text contract', () => {
    expect(stopPillText('Balcombe', 0)).toBe('ST - Balcombe');
    expect(stopPillText('Ghent', 1)).toBe('02 - Ghent');
    expect(stopPillText('Honningsvåg', 14)).toBe('15 - Honningsvåg');
  });

  it('builds projected pills in canonical destination order', () => {
    const project = ([lng, lat]: [number, number]) => ({ x: lng * 10, y: lat * 10 });

    expect(buildStopPillPresentations({
      destinations: [balcombe, ghent],
      selectedDestinationId: ghent.id,
      project,
    })).toEqual([
      expect.objectContaining({
        id: balcombe.id,
        name: 'Balcombe',
        text: 'ST - Balcombe',
        selected: false,
        position: 'below',
        x: -1.36,
        y: 510.55,
      }),
      expect.objectContaining({
        id: ghent.id,
        name: 'Ghent',
        text: '02 - Ghent',
        selected: true,
        position: 'below',
        x: 37.17,
        y: 510.54,
      }),
    ]);
  });

  it('uses the exact live CSS classes for state and placement', () => {
    expect(stopPillClassName({ selected: false, position: 'below' })).toBe('map-destination-label');
    expect(stopPillClassName({ selected: true, position: 'above' })).toBe(
      'map-destination-label is-selected map-label-position-above',
    );
  });

  it('creates a non-interactive export element with live pill text and geometry', () => {
    const element = createStopPillElement({
      id: balcombe.id,
      name: 'Balcombe',
      text: 'ST - Balcombe',
      selected: false,
      position: 'below',
      x: 240,
      y: 180,
    });

    expect(element).toHaveClass('map-destination-label');
    expect(element).not.toHaveClass('is-selected');
    expect(element).toHaveTextContent('ST - Balcombe');
    expect(element.style.left).toBe('240px');
    expect(element.style.top).toBe('180px');
    expect(element.getAttribute('aria-hidden')).toBe('true');
    expect(element.tabIndex).toBe(-1);
  });
});
```

- [ ] **Step 2: Run the pure tests and verify RED**

Run:

```bash
npm test -- src/map/stopPillPresentation.test.ts
```

Expected: FAIL because `src/map/stopPillPresentation.ts` does not exist.

- [ ] **Step 3: Implement the minimal shared presentation module**

Create `src/map/stopPillPresentation.ts`:

```ts
import type { Destination } from '../domain/types';
import { formatStopMarker } from '../components/stopLabels';

export type StopPillPosition = 'below' | 'above';

export type StopPillPresentation = {
  id: string;
  name: string;
  text: string;
  selected: boolean;
  position: StopPillPosition;
  x: number;
  y: number;
};

type BuildStopPillPresentationsInput = {
  destinations: Destination[];
  selectedDestinationId: string | null;
  project: (coordinates: [number, number]) => { x: number; y: number };
  positions?: ReadonlyMap<string, StopPillPosition>;
};

export function stopPillText(name: string, stopIndex: number) {
  return `${formatStopMarker(stopIndex + 1)} - ${name}`;
}

export function stopPillClassName(input: Pick<StopPillPresentation, 'selected' | 'position'>) {
  return [
    'map-destination-label',
    input.selected ? 'is-selected' : '',
    input.position === 'above' ? 'map-label-position-above' : '',
  ].filter(Boolean).join(' ');
}

export function buildStopPillPresentations({
  destinations,
  selectedDestinationId,
  project,
  positions,
}: BuildStopPillPresentationsInput): StopPillPresentation[] {
  return destinations.map((destination, index) => {
    const point = project([destination.coordinates.lng, destination.coordinates.lat]);
    return {
      id: destination.id,
      name: destination.name,
      text: stopPillText(destination.name, index),
      selected: destination.id === selectedDestinationId,
      position: positions?.get(destination.id) ?? 'below',
      x: point.x,
      y: point.y,
    };
  });
}

export function createStopPillElement(pill: StopPillPresentation) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = stopPillClassName(pill);
  element.textContent = pill.text;
  element.style.left = `${pill.x}px`;
  element.style.top = `${pill.y}px`;
  element.tabIndex = -1;
  element.setAttribute('aria-hidden', 'true');
  return element;
}
```

- [ ] **Step 4: Run the pure tests and verify GREEN**

Run:

```bash
npm test -- src/map/stopPillPresentation.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add a failing live-map shared-contract assertion**

Extend `renders the first destination stop label as the start label` in `src/components/MapCanvas.test.tsx`:

```tsx
expect(startLabel).toHaveClass('map-destination-label');
expect(startLabel).toHaveAttribute('data-stop-pill-id', destination.id);
expect(nextStopLabel).toHaveAttribute('data-stop-pill-id', targetDestination.id);
```

Run:

```bash
npm test -- src/components/MapCanvas.test.tsx -t "renders the first destination stop label as the start label"
```

Expected: FAIL because current live pills do not expose the shared presentation identity.

- [ ] **Step 6: Refactor `MapCanvas` to consume the shared presentation model**

In `src/components/MapCanvas.tsx`:

```ts
import {
  buildStopPillPresentations,
  stopPillClassName,
  type StopPillPresentation,
} from '../map/stopPillPresentation';
```

Replace `ProjectedDestinationLabel` with the shared type:

```ts
type ProjectedDestinationLabel = StopPillPresentation;
```

Replace the body of `updateDestinationLabelPositions` with:

```ts
const updateDestinationLabelPositions = useCallback(() => {
  const map = mapRef.current;
  if (!map) {
    setProjectedDestinationLabels([]);
    return;
  }

  setProjectedDestinationLabels(buildStopPillPresentations({
    destinations: latestDestinationsRef.current,
    selectedDestinationId: latestSelectedDestinationIdRef.current,
    project: (coordinates) => map.project(coordinates),
  }));
}, []);
```

Update destination label bounds to use `label.text`, then render the shared class and identity:

```tsx
<button
  key={destinationLabel.id}
  type="button"
  className={stopPillClassName(destinationLabel)}
  data-stop-pill-id={destinationLabel.id}
  style={{ left: `${destinationLabel.x}px`, top: `${destinationLabel.y}px` }}
  aria-label={`Open ${destinationLabel.name} stop details`}
  onClick={() => onSelectDestinationRef.current(destinationLabel.id)}
>
  {destinationLabel.text}
</button>
```

For activity-label collision bounds, create destination models with `buildStopPillPresentations` and pass each model to `destinationLabelBounds`; do not duplicate `formatStopMarker` or label text.

- [ ] **Step 7: Run shared and live-map tests**

Run:

```bash
npm test -- src/map/stopPillPresentation.test.ts src/components/MapCanvas.test.tsx
```

Expected: PASS with no changes to visible live-map behaviour.

- [ ] **Step 8: Commit the shared contract**

```bash
git add src/map/stopPillPresentation.ts src/map/stopPillPresentation.test.ts src/components/MapCanvas.tsx src/components/MapCanvas.test.tsx
git commit -m "refactor: share map stop pill presentation"
```

### Task 2: Composite the Real Stop-Pill Overlay into the PNG

**Files:**
- Modify: `src/map/tripMapExport.ts:18-31, 46-73, 205-297, 327-361, 364-399`
- Test: `src/map/tripMapExport.test.ts:1-426`

**Interfaces:**
- Consumes: `buildStopPillPresentations`, `createStopPillElement`, `map.project`, the existing export map lifecycle, and the existing `.map-destination-label` stylesheet.
- Produces: map layers containing routes and stop points only; a temporary `[data-trip-map-export-labels]` overlay; `rasterizeStopPillOverlay(overlay)`; and a composed PNG containing map canvas, real pill pixels, then attribution.

- [ ] **Step 1: Change existing expectations to the required contract and verify RED**

Update the ordered-feature assertion in `src/map/tripMapExport.test.ts`:

```ts
expect(buildExportStopFeatures([origin, target]).features.map(({ properties }) => properties)).toEqual([
  { id: origin.id, name: 'Balcombe', number: 1, label: 'ST - Balcombe' },
  { id: target.id, name: 'Paris', number: 2, label: '02 - Paris' },
]);
```

Replace `adds route, stop point, stop number, and stop name layers after load` with:

```ts
it('uses MapLibre only for routes and stop points', async () => {
  const { promise, map } = await advanceExportToIdle();
  expect(map.layers.map(({ id }) => id)).toEqual([
    'trip-map-export-routes',
    'trip-map-export-stop-points',
  ]);
  map.callbacks.get('idle')?.();
  await promise;
});
```

Add:

```ts
it('renders normal unselected app pills in an export overlay', async () => {
  const { promise, map } = await advanceExportToIdle();
  map.callbacks.get('idle')?.();
  await promise;

  expect(exportOverlaySnapshot).toEqual([
    { className: 'map-destination-label', text: 'ST - Balcombe', selected: false },
    { className: 'map-destination-label', text: '02 - Paris', selected: false },
  ]);
});
```

Run:

```bash
npm test -- src/map/tripMapExport.test.ts
```

Expected: FAIL because labels still use MapLibre number/name layers, plain numbering, and no DOM overlay.

- [ ] **Step 2: Extend the MapLibre and browser mocks for projection and overlay rasterization**

Add a stable canvas and `project` to each recorded mock instance and `MapMock`:

```ts
canvas = document.createElement('canvas');

getCanvas() {
  return this.canvas;
}

project = vi.fn(([longitude, latitude]: [number, number]) => ({
  x: 800 + longitude * 10,
  y: 500 - latitude * 5,
}));
```

Add test state:

```ts
let exportOverlaySnapshot: Array<{ className: string; text: string; selected: boolean }>;
let imageLoadShouldFail: boolean;
```

Install an `Image` mock in `beforeEach` that records the overlay before scheduling load:

```ts
exportOverlaySnapshot = [];
imageLoadShouldFail = false;
vi.stubGlobal('Image', class {
  onload: null | (() => void) = null;
  onerror: null | (() => void) = null;
  set src(_value: string) {
    exportOverlaySnapshot = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[data-trip-map-export-labels] .map-destination-label'),
      (element) => ({
        className: element.className,
        text: element.textContent ?? '',
        selected: element.classList.contains('is-selected'),
      }),
    );
    queueMicrotask(() => imageLoadShouldFail ? this.onerror?.() : this.onload?.());
  }
});
```

Extend the canvas context mock with `save`, `restore`, `translate`, and `clearRect` spies if the implementation uses them. Keep `drawImage`, `fillRect`, `fillText`, and `measureText`.

- [ ] **Step 3: Remove export-only number and name layers and use canonical text**

In `src/map/tripMapExport.ts`:

```ts
import {
  buildStopPillPresentations,
  createStopPillElement,
} from './stopPillPresentation';
```

Use `stopPillText` through the shared builder for feature labels, then delete `stopNumbersLayerId`, `stopNamesLayerId`, and both `map.addLayer` calls. Retain only route and stop-point layers. Keep the stop-point radius, colour, and stroke unchanged.

- [ ] **Step 4: Create the styled off-screen overlay after map idle**

Add:

```ts
function createStopPillOverlay(
  container: HTMLDivElement,
  map: maplibregl.Map,
  destinations: Destination[],
) {
  const overlay = document.createElement('div');
  overlay.dataset.tripMapExportLabels = '';
  overlay.className = 'map-destination-label-layer';
  overlay.style.width = `${exportWidth}px`;
  overlay.style.height = `${exportHeight}px`;

  for (const pill of buildStopPillPresentations({
    destinations,
    selectedDestinationId: null,
    project: (coordinates) => map.project(coordinates),
  })) {
    overlay.append(createStopPillElement(pill));
  }

  container.append(overlay);
  return overlay;
}
```

Call this only after `waitForMapEvent(map, 'idle', ...)` resolves so `map.project` reflects the final fitted viewport.

- [ ] **Step 5: Inline computed CSS and rasterize the overlay with browser primitives**

Add these helpers to `src/map/tripMapExport.ts`:

```ts
function inlineComputedStyles(source: Element, target: Element) {
  const style = getComputedStyle(source);
  const targetElement = target as HTMLElement;
  for (let index = 0; index < style.length; index += 1) {
    const property = style.item(index);
    targetElement.style.setProperty(property, style.getPropertyValue(property), style.getPropertyPriority(property));
  }

  Array.from(source.children).forEach((child, index) => {
    const targetChild = target.children[index];
    if (targetChild) inlineComputedStyles(child, targetChild);
  });
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Unable to render trip map stop labels.'));
    image.src = url;
  });
}

async function rasterizeStopPillOverlay(overlay: HTMLDivElement) {
  if (document.fonts) await document.fonts.ready;
  const clone = overlay.cloneNode(true) as HTMLDivElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  inlineComputedStyles(overlay, clone);

  const serialized = new XMLSerializer().serializeToString(clone);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${exportWidth}" height="${exportHeight}"><foreignObject width="100%" height="100%">${serialized}</foreignObject></svg>`;
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    return await loadImage(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}
```

Do not suppress the `loadImage` rejection; it must reach the existing toolbar failure path.

- [ ] **Step 6: Composite map, overlay, and attribution in the correct order**

Change `exportBlob` to accept the label image:

```ts
function exportBlob(map: maplibregl.Map, stopPillImage: HTMLImageElement) {
  return new Promise<Blob>((resolve, reject) => {
    const output = document.createElement('canvas');
    output.width = exportWidth;
    output.height = exportHeight;
    const context = output.getContext('2d');
    if (!context) {
      reject(new Error('Unable to create trip map PNG.'));
      return;
    }

    context.drawImage(map.getCanvas(), 0, 0, exportWidth, exportHeight);
    context.drawImage(stopPillImage, 0, 0, exportWidth, exportHeight);
    drawAttribution(context, map);
    output.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Unable to create trip map PNG.')), 'image/png');
  });
}
```

Extract the existing attribution statements unchanged into `drawAttribution(context, map)`. In `downloadTripMap`, create the overlay, rasterize it, then call `exportBlob`. Track the overlay in a local variable and remove it in `finally` before removing the container.

- [ ] **Step 7: Add timing and failure-cleanup regressions**

Add:

```ts
it('composites stop pills after the map canvas and before attribution and PNG conversion', async () => {
  const { promise, map } = await advanceExportToIdle();
  map.callbacks.get('idle')?.();
  await promise;

  const drawCalls = (context.drawImage as ReturnType<typeof vi.fn>).mock.calls;
  expect(drawCalls).toHaveLength(2);
  expect(drawCalls[0][0]).toBe(map.canvas);
  expect((context.drawImage as ReturnType<typeof vi.fn>).mock.invocationCallOrder[1]).toBeLessThan(
    (context.fillText as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0],
  );
  expect((context.fillText as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]).toBeLessThan(
    (HTMLCanvasElement.prototype.toBlob as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0],
  );
});

it('rejects label rasterization failure and removes the overlay', async () => {
  imageLoadShouldFail = true;
  const { promise, map } = await advanceExportToIdle();
  map.callbacks.get('idle')?.();

  await expect(promise).rejects.toThrow('Unable to render trip map stop labels.');
  expect(anchorClick).not.toHaveBeenCalled();
  expect(document.querySelector('[data-trip-map-export-labels]')).not.toBeInTheDocument();
  expect(document.querySelector('[data-trip-map-export]')).not.toBeInTheDocument();
  expect(map.remove).toHaveBeenCalledOnce();
});
```

Extend `afterEach` cleanup selector to include `[data-trip-map-export-labels]`. Assert both SVG and PNG object URLs are revoked without relying on their exact creation order.

- [ ] **Step 8: Run exporter tests and verify GREEN**

Run:

```bash
npm test -- src/map/stopPillPresentation.test.ts src/map/tripMapExport.test.ts src/components/MapCanvas.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit the exporter fix**

```bash
git add src/map/tripMapExport.ts src/map/tripMapExport.test.ts
git commit -m "fix: match exported stop pills to app"
```

### Task 3: Strengthen the Browser Flow and Verify the Nordkapp Export

**Files:**
- Modify: `tests/world-tour.spec.ts:50-151`
- Verify: `src/styles.css:131-181`
- Reference: `/var/folders/hy/cc8_lp7n5q7384jfff1lljyh0000gn/T/codex-clipboard-ea17690a-409d-44bc-8b12-3612dd8893e3.png`
- Before image: `~/Downloads/Nordkapp-Winter-Expedition-Loop.png`

**Interfaces:**
- Consumes: the existing e2e-local map export flow and Browser plugin.
- Produces: automated proof that the live reference uses canonical app pills before download, plus rendered evidence of the corrected normal-app Nordkapp PNG.

- [ ] **Step 1: Add an e2e reference-pill assertion**

After adding Galway and Cork in `downloads a map-only PNG`, add:

```ts
const liveStopPills = page.locator('.map-destination-label-layer .map-destination-label');
await expect(liveStopPills).toHaveCount(2);
await expect(liveStopPills).toHaveText(['ST - Galway', '02 - Cork']);
await expect(liveStopPills.filter({ hasText: 'ST - Galway' })).not.toHaveClass(/is-selected/);
```

Run:

```bash
npm run test:e2e -- --grep "downloads a map-only PNG"
```

Expected after Tasks 1 and 2: PASS while preserving PNG dimensions and live-map pixel stability. This extends an existing end-to-end flow after the production behaviour is already covered by the RED/GREEN unit and component cycles in Tasks 1 and 2.

- [ ] **Step 2: Run focused and repository-wide automated verification**

Run:

```bash
npm test -- src/map/stopPillPresentation.test.ts src/map/tripMapExport.test.ts src/components/MapCanvas.test.tsx
npm run test:e2e -- --grep "downloads a map-only PNG"
npm test
npm run lint
npm run build
```

Expected: all focused tests, all unit/component tests, the export e2e test, lint, and build pass. The existing Vite bundle-size warning is informational; no new warning or error is acceptable.

- [ ] **Step 3: Commit the e2e assertion**

```bash
git add tests/world-tour.spec.ts
git commit -m "test: verify live stop pill export contract"
```

- [ ] **Step 4: Run the normal app for reference-driven Browser QA**

Run:

```bash
npm run dev
```

The flow under test is: normal app loads Nordkapp Winter Expedition Loop -> camera action downloads the map-only PNG -> downloaded stop pills match the live map's normal unselected pills while the visible map remains unchanged.

Use the Browser plugin first. Verify:

1. Page URL and title identify the World Tour app.
2. DOM snapshot contains the trip selector, search control, camera action, map, itinerary, and live stop pills.
3. No framework error overlay is present.
4. Console has no relevant warning or error.
5. Capture a live-map screenshot containing representative pills.
6. Record the visible map canvas pixel hash before export.
7. Click the unique `Download trip map` button and wait for the download.
8. Confirm filename `Nordkapp-Winter-Expedition-Loop.png` and dimensions 1600 × 1000.
9. Open or inspect the downloaded PNG and capture it as after evidence.
10. Confirm the visible map canvas pixel hash is unchanged.

- [ ] **Step 5: Complete the mismatch ledger against the supplied references**

Record PASS/FAIL for:

| Attribute | Live app reference | Corrected PNG requirement |
|---|---|---|
| Text format | `ST - Name`, `02 - Name` | Exact match |
| Foreground | Accent pink | Exact match |
| Background | Translucent white pill | Exact match |
| Border | Thin translucent accent | Exact match |
| Radius | Fully pill-shaped | Exact match |
| Shadow | Soft app shadow | Exact match |
| Typography | App family, size, weight, line height | Exact match |
| Padding and minimum height | App CSS | Exact match |
| Placement | Shared below/above class | Exact match |
| Selection/activity state | Excluded | No selected or activity styling |
| Map chrome | Present only in live app | Absent from PNG |
| Route framing | Whole trip | Whole trip visible |

If any app-pill attribute differs, do not declare completion. Return to Task 2 with one isolated hypothesis and a failing regression before changing production code.

- [ ] **Step 6: Final branch verification**

Run:

```bash
git status --short
git diff --check
git log --oneline --decorate -5
```

Expected: clean worktree, no whitespace errors, and exactly the scoped implementation/test commits above the approved spec and plan commits.
