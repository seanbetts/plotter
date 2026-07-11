# Overlapping Stop Pill Positioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display the earlier of two overlapping trip-stop pills above its map pin and the later pill below it, for both duplicate coordinates and zoom-dependent screen-space collisions.

**Architecture:** Keep label placement inside `MapCanvas`, where geographic coordinates are already projected into screen coordinates. Add a pure destination-label placement helper that detects collisions between default below-pin bounds, resolves the earlier colliding stop above, and supplies those resolved bounds to the existing activity-label collision pass.

**Tech Stack:** React 19, TypeScript 6, MapLibre GL, Vitest, Testing Library, Playwright/browser QA

## Global Constraints

- Non-overlapping stop pills remain below their pins.
- For a pair of overlapping stop pills, route order wins: the earlier stop is above and the later stop is below.
- Exact-coordinate repeats and nearby screen-space overlaps use the same rule.
- Placement recalculates through the existing map label update lifecycle.
- Stop selection, click behavior, marker geometry, route ordering, and persisted trip data do not change.
- Three-or-more-stop stacking is out of scope.
- E2e storage remains isolated with `VITE_TRIP_STORAGE=e2e-local`.

---

## File Structure

- Modify `src/components/MapCanvas.tsx`: resolve destination pill positions, render the existing above-position class, and reserve resolved bounds for activities.
- Modify `src/components/MapCanvas.test.tsx`: cover exact repeats, nearby overlaps, non-overlapping stops, and activity collision behavior around resolved stop pills.

### Task 1: Resolve Colliding Destination Pills

**Files:**
- Modify: `src/components/MapCanvas.tsx:44-86,635-705,910-987,1598-1619`
- Test: `src/components/MapCanvas.test.tsx:1390-1424`

**Interfaces:**
- Consumes: ordered `Destination[]`, `map.project([lng, lat])`, `LabelBounds`, and the existing `map-label-position-above` CSS class.
- Produces: `positionDestinationLabels(labels: Array<Omit<ProjectedDestinationLabel, 'position'>>): ProjectedDestinationLabel[]`, where every destination label has `position: LabelPosition`.

- [ ] **Step 1: Write the failing exact-coordinate regression test**

Add after `renders the first destination stop label as the start label` in `src/components/MapCanvas.test.tsx`:

```tsx
it('places the earlier stop above and the later stop below when a trip returns to identical coordinates', () => {
  const returnDestination: Destination = {
    ...targetDestination,
    id: 'dest-return',
    name: 'Cappadocia return',
    coordinates: destination.coordinates,
  };

  render(
    <MapCanvas
      destinations={[destination, returnDestination]}
      routeLegs={[]}
      selectedDestinationId={null}
      onSelectDestination={vi.fn()}
    />,
  );

  const map = maplibreMock.mapInstances[0];
  const loadHandler = map.on.mock.calls.find(([eventName]) => eventName === 'load')?.[1];
  const zoomEndHandler = map.on.mock.calls.find(([eventName]) => eventName === 'zoomend')?.[1];
  act(() => { loadHandler(); });
  maplibreMock.setZoom(4);
  act(() => { zoomEndHandler(); });

  expect(screen.getByRole('button', { name: 'Open Cappadocia stop details' })).toHaveClass(
    'map-label-position-above',
  );
  expect(screen.getByRole('button', { name: 'Open Cappadocia return stop details' })).not.toHaveClass(
    'map-label-position-above',
  );
});
```

- [ ] **Step 2: Run the exact-coordinate test and verify RED**

Run:

```bash
npm test -- src/components/MapCanvas.test.tsx -t "places the earlier stop above and the later stop below when a trip returns to identical coordinates"
```

Expected: FAIL because the first stop button lacks `map-label-position-above`.

- [ ] **Step 3: Add the remaining failing collision coverage and a non-overlap assertion**

Add beside the exact-coordinate test:

```tsx
it('uses the same placement when nearby stop pills overlap in screen space', () => {
  const nearbyDestination: Destination = {
    ...targetDestination,
    id: 'dest-nearby',
    name: 'Nearby return',
    coordinates: {
      lat: destination.coordinates.lat + 0.02,
      lng: destination.coordinates.lng + 0.02,
    },
  };

  render(
    <MapCanvas
      destinations={[destination, nearbyDestination]}
      routeLegs={[]}
      selectedDestinationId={null}
      onSelectDestination={vi.fn()}
    />,
  );

  const map = maplibreMock.mapInstances[0];
  const loadHandler = map.on.mock.calls.find(([eventName]) => eventName === 'load')?.[1];
  const zoomEndHandler = map.on.mock.calls.find(([eventName]) => eventName === 'zoomend')?.[1];
  act(() => { loadHandler(); });
  maplibreMock.setZoom(4);
  act(() => { zoomEndHandler(); });

  expect(screen.getByRole('button', { name: 'Open Cappadocia stop details' })).toHaveClass(
    'map-label-position-above',
  );
  expect(screen.getByRole('button', { name: 'Open Nearby return stop details' })).not.toHaveClass(
    'map-label-position-above',
  );
});
```

Extend `renders the first destination stop label as the start label` with:

```tsx
expect(startLabel).not.toHaveClass('map-label-position-above');
expect(nextStopLabel).not.toHaveClass('map-label-position-above');
```

Add this activity-reservation test beside the existing stop/activity collision tests:

```tsx
it('reserves both resolved stop pill positions when placing an activity pill', () => {
  const returnDestination: Destination = {
    ...targetDestination,
    id: 'dest-return',
    name: 'Cappadocia return',
    coordinates: destination.coordinates,
  };
  const caveActivity: Activity = {
    ...louvreActivity,
    id: 'activity-cave',
    title: 'Cave Church',
    destinationId: destination.id,
    location: {
      name: 'Cave Church',
      address: 'Cappadocia, Turkey',
      coordinates: destination.coordinates,
      sourceProvider: 'maptiler',
      sourceFeatureId: 'poi-cave',
    },
  };

  render(
    <MapCanvas
      destinations={[destination, returnDestination]}
      routeLegs={[]}
      selectedDestinationId={destination.id}
      focusedActivities={[caveActivity]}
      selectedActivityId={null}
      onSelectDestination={vi.fn()}
      onSelectActivity={vi.fn()}
    />,
  );

  const map = maplibreMock.mapInstances[0];
  const loadHandler = map.on.mock.calls.find(([eventName]) => eventName === 'load')?.[1];
  const zoomEndHandler = map.on.mock.calls.find(([eventName]) => eventName === 'zoomend')?.[1];
  act(() => { loadHandler(); });
  maplibreMock.setZoom(4);
  act(() => { zoomEndHandler(); });

  expect(screen.queryByRole('button', { name: 'Open Cave Church activity details' })).not.toBeInTheDocument();
});
```

- [ ] **Step 4: Run the focused stop-label tests and verify RED**

Run:

```bash
npm test -- src/components/MapCanvas.test.tsx -t "start label|identical coordinates|nearby stop pills|reserves both resolved stop pill positions"
```

Expected: the exact-repeat and nearby-overlap tests FAIL on the missing above class, the activity-reservation test FAILS because the activity remains visible, and the non-overlap baseline passes.

- [ ] **Step 5: Implement the minimal destination placement model**

In `src/components/MapCanvas.tsx`, replace `ActivityLabelPosition` with `LabelPosition` and require the position on projected destination labels:

```tsx
type LabelPosition = 'below' | 'above';

type ProjectedDestinationLabel = {
  id: string;
  name: string;
  label: string;
  selected: boolean;
  position: LabelPosition;
  x: number;
  y: number;
};
```

Make destination bounds honor the resolved position and add the pure placement helper:

```tsx
function destinationLabelBounds(label: ProjectedDestinationLabel) {
  return labelCandidateBounds(
    { title: `${label.label} - ${label.name}`, x: label.x, y: label.y },
    label.position,
  );
}

function positionDestinationLabels(labels: Array<Omit<ProjectedDestinationLabel, 'position'>>) {
  const belowBounds = labels.map((label) =>
    labelCandidateBounds(
      { title: `${label.label} - ${label.name}`, x: label.x, y: label.y },
      'below',
    ),
  );

  return labels.map((label, index) => ({
    ...label,
    position: belowBounds.slice(index + 1).some((bounds) =>
      activityLabelBoundsOverlap(belowBounds[index], bounds),
    ) ? 'above' as const : 'below' as const,
  }));
}
```

Extract the projection used by both update callbacks:

```tsx
const projectDestinationLabels = useCallback(() => {
  const map = mapRef.current;
  if (!map) return [];

  return positionDestinationLabels(
    latestDestinationsRef.current.map((destination, index) => {
      const point = map.project([destination.coordinates.lng, destination.coordinates.lat]);
      return {
        id: destination.id,
        name: destination.name,
        label: formatStopMarker(index + 1),
        selected: destination.id === latestSelectedDestinationIdRef.current,
        x: point.x,
        y: point.y,
      };
    }),
  );
}, []);
```

Use `setProjectedDestinationLabels(projectDestinationLabels())` in `updateDestinationLabelPositions`. In `updateActivityLabelPositions`, replace the below-only destination projection with:

```tsx
const reservedDestinationLabelBounds = projectDestinationLabels().map(destinationLabelBounds);
```

Add `projectDestinationLabels` to both callbacks' dependency arrays. In the destination button class list, add:

```tsx
destinationLabel.position === 'above' ? 'map-label-position-above' : '',
```

- [ ] **Step 6: Run the focused tests and verify GREEN**

Run:

```bash
npm test -- src/components/MapCanvas.test.tsx -t "start label|identical coordinates|nearby stop pills|reserves both resolved stop pill positions"
```

Expected: PASS with zero failures.

- [ ] **Step 7: Prove the activity test detects below-only reservation, then restore GREEN**

Temporarily pass `'below'` instead of `label.position` from `destinationLabelBounds`, then run:

```bash
npm test -- src/components/MapCanvas.test.tsx -t "reserves both resolved stop pill positions"
```

Expected: FAIL because the activity pill remains visible above the duplicate stop pins. Restore `label.position`, rerun the same command, and expect PASS.

- [ ] **Step 8: Run the complete component test file**

Run:

```bash
npm test -- src/components/MapCanvas.test.tsx
```

Expected: all `MapCanvas` tests PASS with zero failures.

- [ ] **Step 9: Commit the implementation**

```bash
git diff --check
git diff -- src/components/MapCanvas.tsx src/components/MapCanvas.test.tsx
git add src/components/MapCanvas.tsx src/components/MapCanvas.test.tsx
git commit -m "fix: separate overlapping stop pills"
```

Expected: the commit contains only `MapCanvas.tsx` and `MapCanvas.test.tsx`.

### Task 2: Full and Rendered Verification

**Files:**
- Verify: `src/components/MapCanvas.tsx`
- Verify: `src/components/MapCanvas.test.tsx`

**Interfaces:**
- Consumes: the completed destination placement behavior from Task 1.
- Produces: fresh automated and rendered evidence that the behavior works without regressions.

- [ ] **Step 1: Run repository verification**

Run each command independently:

```bash
npm test
npm run lint
npm run build
```

Expected: every command exits 0; Vitest reports zero failed tests; ESLint reports zero errors; TypeScript and Vite complete the production build.

- [ ] **Step 2: Start the isolated app for rendered QA**

Run:

```bash
npm run dev:e2e
```

Expected: Vite serves the isolated app at `http://127.0.0.1:5174` using `VITE_TRIP_STORAGE=e2e-local`.

- [ ] **Step 3: Verify return-loop labels in the browser**

In the isolated app, create or edit two route stops so they share identical coordinates, zoom to level 4 or closer, and confirm:

```text
Earlier route stop pill: above the shared pin
Later route stop pill: below the shared pin
Both pills: visible and independently clickable
```

Move and zoom the map and confirm the relationship is preserved. Move the later stop slightly so the pills still overlap and confirm the same relationship. Move it far enough that the pills no longer overlap and confirm both pills return below their pins.

- [ ] **Step 4: Stop the isolated server and inspect final scope**

Stop Vite with `Ctrl-C`, then run:

```bash
git status --short
git show --stat --oneline HEAD
```

Expected: no temporary QA files are present; unrelated pre-existing files remain untouched; the implementation commit contains only `MapCanvas.tsx` and `MapCanvas.test.tsx`.
