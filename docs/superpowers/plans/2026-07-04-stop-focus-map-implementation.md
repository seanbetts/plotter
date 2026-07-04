# Stop Focus Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add stop focus map behavior so selecting a stop zooms into its local area, shows clickable activity pins, and restores the route viewport when the stop panel closes.

**Architecture:** `App` owns selected stop/activity state and passes only the selected stop's activities into `MapCanvas`. `MapCanvas` owns the focused activity GeoJSON source/layers and viewport transitions. Activity pins are rendered only in stop focus view and call back to `App` through `onSelectActivity`.

**Tech Stack:** React, TypeScript, MapLibre GL, GeoJSON, Vitest, Testing Library, Playwright.

---

## File Structure

- Modify `src/components/MapCanvas.tsx`
  - Add focused activity props.
  - Build activity GeoJSON features.
  - Add MapLibre activity source and layers.
  - Save route viewport, fit to selected stop/activity bounds, and restore on exit.
  - Handle MapLibre activity-pin clicks.
- Modify `src/components/MapCanvas.test.tsx`
  - Add activity fixtures.
  - Extend the map mock with `easeTo`.
  - Cover activity source/layers, source data, pin click, focus fit, and route viewport restore.
- Modify `src/App.tsx`
  - Pass `selectedDestinationActivities`, `selectedActivityId`, and `setSelectedActivityId` into `MapCanvas`.
- Modify `src/App.test.tsx`
  - Add an app-level regression that clicking a map activity pin opens the activity panel.
  - Extend the map mock with the event triggering helper shown in Task 3.
- Optional modify `src/styles.css`
  - Only if rendered browser verification shows label or marker overlap in the DOM overlay. The MapLibre circle/symbol layer styles should be preferred first.

Before starting implementation, run `git status --short`. This repo currently has unrelated unstaged image-strip style edits in `src/styles.css` and `src/styles.test.ts`; do not stage or commit those while working on this plan unless the user explicitly asks.

## Task 1: Add Focused Activity Map Data And Layers

**Files:**
- Modify: `src/components/MapCanvas.tsx`
- Modify: `src/components/MapCanvas.test.tsx`

- [ ] **Step 1: Write failing MapCanvas tests for focused activity source and features**

In `src/components/MapCanvas.test.tsx`, update the imports:

```ts
import type { Activity, Destination, RouteLeg } from '../domain/types';
```

Add these fixtures after `routeLeg`:

```ts
  const louvreActivity: Activity = {
    id: 'activity-louvre',
    destinationId: destination.id,
    order: 0,
    title: 'Louvre Museum',
    description: '',
    category: 'culture',
    status: 'idea',
    priority: 'medium',
    location: {
      name: 'Louvre Museum',
      address: 'Rue de Rivoli, 75001 Paris, France',
      coordinates: { lat: 48.8606, lng: 2.3376 },
      sourceProvider: 'maptiler',
      sourceFeatureId: 'poi-louvre',
    },
    links: [],
    notes: '',
    tags: [],
    createdAt: '2026-07-04T00:00:00.000Z',
    updatedAt: '2026-07-04T00:00:00.000Z',
  };

  const manualActivity: Activity = {
    ...louvreActivity,
    id: 'activity-manual',
    order: 1,
    title: 'Loose idea',
    location: undefined,
  };
```

Add this test near the existing source/layer tests:

```ts
  it('adds focused activity sources and layers after the selected destination layer', () => {
    render(
      <MapCanvas
        destinations={[destination]}
        routeLegs={[]}
        selectedDestinationId={destination.id}
        focusedActivities={[louvreActivity]}
        selectedActivityId={null}
        onSelectDestination={vi.fn()}
        onSelectActivity={vi.fn()}
      />,
    );

    const map = maplibreMock.mapInstances[0];
    const loadHandler = map.on.mock.calls.find(([eventName]) => eventName === 'load')?.[1];

    act(() => {
      loadHandler();
    });

    expect(map.addSource).toHaveBeenCalledWith(
      'world-tour-focused-activities',
      expect.objectContaining({ type: 'geojson' }),
    );

    const layers = map.addLayer.mock.calls.map(([layer]) => layer);
    expect(layers.map((layer) => layer.id)).toEqual(
      expect.arrayContaining([
        'world-tour-activity-points',
        'world-tour-selected-activity-halo',
        'world-tour-activity-labels',
      ]),
    );
    expect(layers.find((layer) => layer.id === 'world-tour-activity-points')).toMatchObject({
      type: 'circle',
      source: 'world-tour-focused-activities',
    });
    expect(layers.find((layer) => layer.id === 'world-tour-activity-labels')).toMatchObject({
      type: 'symbol',
      source: 'world-tour-focused-activities',
      layout: expect.objectContaining({
        'text-field': ['get', 'title'],
      }),
    });
  });

  it('populates focused activity features only for selected-stop activities with coordinates', () => {
    render(
      <MapCanvas
        destinations={[destination]}
        routeLegs={[]}
        selectedDestinationId={destination.id}
        focusedActivities={[louvreActivity, manualActivity]}
        selectedActivityId={louvreActivity.id}
        onSelectDestination={vi.fn()}
        onSelectActivity={vi.fn()}
      />,
    );

    const map = maplibreMock.mapInstances[0];
    const loadHandler = map.on.mock.calls.find(([eventName]) => eventName === 'load')?.[1];

    act(() => {
      loadHandler();
    });

    const activitySource = maplibreMock.getSource('world-tour-focused-activities');
    const activityData = activitySource?.setData.mock.calls.at(-1)?.[0] as FeatureCollection<Point>;

    expect(activityData.features).toHaveLength(1);
    expect(activityData.features[0]).toMatchObject({
      id: louvreActivity.id,
      geometry: {
        type: 'Point',
        coordinates: [2.3376, 48.8606],
      },
      properties: {
        id: louvreActivity.id,
        title: 'Louvre Museum',
        order: 1,
        selected: true,
      },
    });
  });

  it('empties focused activity features when no stop is selected', () => {
    render(
      <MapCanvas
        destinations={[destination]}
        routeLegs={[]}
        selectedDestinationId={null}
        focusedActivities={[louvreActivity]}
        selectedActivityId={louvreActivity.id}
        onSelectDestination={vi.fn()}
        onSelectActivity={vi.fn()}
      />,
    );

    const map = maplibreMock.mapInstances[0];
    const loadHandler = map.on.mock.calls.find(([eventName]) => eventName === 'load')?.[1];

    act(() => {
      loadHandler();
    });

    const activitySource = maplibreMock.getSource('world-tour-focused-activities');
    const activityData = activitySource?.setData.mock.calls.at(-1)?.[0] as FeatureCollection<Point>;

    expect(activityData.features).toEqual([]);
  });
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npm test -- src/components/MapCanvas.test.tsx
```

Expected: FAIL with TypeScript errors because `focusedActivities`, `selectedActivityId`, and `onSelectActivity` are not `MapCanvas` props, and with missing `world-tour-focused-activities` source/layers.

- [ ] **Step 3: Add activity feature types, source ids, and feature builder**

In `src/components/MapCanvas.tsx`, update imports:

```ts
import type { Activity, Coordinates, Destination, RouteLeg } from '../domain/types';
```

Update `MapCanvasProps`:

```ts
type MapCanvasProps = {
  destinations: Destination[];
  routeLegs: RouteLeg[];
  selectedDestinationId: string | null;
  focusedActivities?: Activity[];
  selectedActivityId?: string | null;
  onSelectDestination: (destinationId: string) => void;
  onSelectActivity?: (activityId: string) => void;
  onRequestAddStop?: (request: MapAddStopRequest) => void;
};
```

Add the activity feature property type near `DestinationFeatureProperties`:

```ts
type ActivityFeatureProperties = {
  id: string;
  title: string;
  order: number;
  selected: boolean;
};
```

Add source/layer constants near the existing map layer constants:

```ts
const focusedActivitiesSourceId = 'world-tour-focused-activities';
const activityPointsLayerId = 'world-tour-activity-points';
const selectedActivityHaloLayerId = 'world-tour-selected-activity-halo';
const activityLabelsLayerId = 'world-tour-activity-labels';
```

Add this helper after `buildDestinationFeatures`:

```ts
function buildFocusedActivityFeatures(
  selectedDestinationId: string | null,
  focusedActivities: Activity[],
  selectedActivityId: string | null,
): FeatureCollection<Point, ActivityFeatureProperties> {
  if (!selectedDestinationId) {
    return emptyFeatureCollection<Point, ActivityFeatureProperties>();
  }

  return {
    type: 'FeatureCollection',
    features: focusedActivities.flatMap((activity, index) => {
      const coordinates = activity.location?.coordinates;
      if (!coordinates) return [];

      return [
        {
          type: 'Feature' as const,
          id: activity.id,
          geometry: {
            type: 'Point' as const,
            coordinates: [coordinates.lng, coordinates.lat],
          },
          properties: {
            id: activity.id,
            title: activity.title,
            order: index + 1,
            selected: activity.id === selectedActivityId,
          },
        },
      ];
    }),
  };
}
```

- [ ] **Step 4: Wire activity refs and source updates**

In the `MapCanvas` function signature, include defaults:

```ts
export function MapCanvas({
  destinations,
  routeLegs,
  selectedDestinationId,
  focusedActivities = [],
  selectedActivityId = null,
  onSelectDestination,
  onSelectActivity,
  onRequestAddStop,
}: MapCanvasProps) {
```

Add refs after `latestRouteLegsRef`:

```ts
  const latestFocusedActivitiesRef = useRef(focusedActivities);
  const latestSelectedActivityIdRef = useRef(selectedActivityId);
```

Add callback refs after `onSelectDestinationRef`:

```ts
  const onSelectActivityRef = useRef(onSelectActivity);
```

Inside `updateMapSources`, after the destinations source update and before the routes source update, add:

```ts
    setSourceData(
      map,
      focusedActivitiesSourceId,
      buildFocusedActivityFeatures(
        latestSelectedDestinationIdRef.current,
        latestFocusedActivitiesRef.current,
        latestSelectedActivityIdRef.current,
      ),
    );
```

Inside the main props sync `useEffect`, add these assignments:

```ts
    latestFocusedActivitiesRef.current = focusedActivities;
    latestSelectedActivityIdRef.current = selectedActivityId;
    onSelectActivityRef.current = onSelectActivity;
```

Add `focusedActivities`, `selectedActivityId`, and `onSelectActivity` to that effect dependency array.

- [ ] **Step 5: Add MapLibre activity source and layers**

Inside `addMapLayers`, after the destinations source block and before the routes source block, add:

```ts
    if (!map.getSource(focusedActivitiesSourceId)) {
      map.addSource(focusedActivitiesSourceId, {
        type: 'geojson',
        data: emptyFeatureCollection<Point, ActivityFeatureProperties>(),
      });
    }
```

After the selected destination halo layer and before destination points, add:

```ts
    if (!map.getLayer(selectedActivityHaloLayerId)) {
      map.addLayer({
        id: selectedActivityHaloLayerId,
        type: 'circle',
        source: focusedActivitiesSourceId,
        filter: ['==', ['get', 'selected'], true],
        paint: {
          'circle-color': mapColors.selected,
          'circle-radius': 14,
          'circle-stroke-color': mapColors.accent,
          'circle-stroke-opacity': 0.72,
          'circle-stroke-width': 2,
        },
      } as maplibregl.LayerSpecification);
    }

    if (!map.getLayer(activityPointsLayerId)) {
      map.addLayer({
        id: activityPointsLayerId,
        type: 'circle',
        source: focusedActivitiesSourceId,
        paint: {
          'circle-color': ['case', ['get', 'selected'], mapColors.selected, mapColors.textInverse],
          'circle-radius': ['case', ['get', 'selected'], 7, 5],
          'circle-stroke-color': mapColors.accent,
          'circle-stroke-width': 2,
        },
      } as maplibregl.LayerSpecification);
    }
```

After the destination points layer, add:

```ts
    if (!map.getLayer(activityLabelsLayerId)) {
      map.addLayer({
        id: activityLabelsLayerId,
        type: 'symbol',
        source: focusedActivitiesSourceId,
        layout: {
          'text-field': ['get', 'title'],
          'text-font': cityLabelFontStack,
          'text-offset': [0.8, 0],
          'text-size': 11,
          'text-anchor': 'left',
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': mapColors.cityText,
          'text-halo-color': mapColors.cityHalo,
          'text-halo-width': 1.2,
        },
      } as maplibregl.LayerSpecification);
    }
```

- [ ] **Step 6: Run focused tests and commit**

Run:

```bash
npm test -- src/components/MapCanvas.test.tsx
```

Expected: PASS.

Commit:

```bash
git add src/components/MapCanvas.tsx src/components/MapCanvas.test.tsx
git commit -m "Add focused activity map layers"
```

## Task 2: Add Stop Focus Viewport Transitions

**Files:**
- Modify: `src/components/MapCanvas.tsx`
- Modify: `src/components/MapCanvas.test.tsx`

- [ ] **Step 1: Extend the map mock and write failing viewport tests**

In `src/components/MapCanvas.test.tsx`, update `MockMap`:

```ts
  easeTo: Mock;
```

Inside the mocked map object, add:

```ts
      easeTo: vi.fn(),
```

Add these tests near the existing fit-bounds test:

```ts
  it('fits to the selected stop and mappable activity coordinates when entering stop focus', () => {
    const { rerender } = render(
      <MapCanvas
        destinations={[destination]}
        routeLegs={[]}
        selectedDestinationId={null}
        focusedActivities={[]}
        selectedActivityId={null}
        onSelectDestination={vi.fn()}
        onSelectActivity={vi.fn()}
      />,
    );
    const map = maplibreMock.mapInstances[0];

    rerender(
      <MapCanvas
        destinations={[destination]}
        routeLegs={[]}
        selectedDestinationId={destination.id}
        focusedActivities={[louvreActivity, manualActivity]}
        selectedActivityId={null}
        onSelectDestination={vi.fn()}
        onSelectActivity={vi.fn()}
      />,
    );

    expect(map.fitBounds).toHaveBeenLastCalledWith(
      [
        [2.3376, 38.6431],
        [34.8289, 48.8606],
      ],
      expect.objectContaining({
        padding: expect.objectContaining({
          top: 96,
          right: 760,
          bottom: 96,
          left: 96,
        }),
        maxZoom: 13,
        duration: 700,
      }),
    );
  });

  it('zooms toward a selected stop with no mappable activities', () => {
    const { rerender } = render(
      <MapCanvas
        destinations={[destination]}
        routeLegs={[]}
        selectedDestinationId={null}
        focusedActivities={[]}
        selectedActivityId={null}
        onSelectDestination={vi.fn()}
        onSelectActivity={vi.fn()}
      />,
    );
    const map = maplibreMock.mapInstances[0];

    rerender(
      <MapCanvas
        destinations={[destination]}
        routeLegs={[]}
        selectedDestinationId={destination.id}
        focusedActivities={[manualActivity]}
        selectedActivityId={null}
        onSelectDestination={vi.fn()}
        onSelectActivity={vi.fn()}
      />,
    );

    expect(map.fitBounds).toHaveBeenLastCalledWith(
      [
        [34.8289, 38.6431],
        [34.8289, 38.6431],
      ],
      expect.objectContaining({
        maxZoom: 13,
      }),
    );
  });

  it('restores the saved route viewport when leaving stop focus', () => {
    const { rerender } = render(
      <MapCanvas
        destinations={[destination]}
        routeLegs={[]}
        selectedDestinationId={null}
        focusedActivities={[]}
        selectedActivityId={null}
        onSelectDestination={vi.fn()}
        onSelectActivity={vi.fn()}
      />,
    );
    const map = maplibreMock.mapInstances[0];
    map.getCenter.mockReturnValue({ lng: 18, lat: 24 });
    map.getZoom.mockReturnValue(4.5);

    rerender(
      <MapCanvas
        destinations={[destination]}
        routeLegs={[]}
        selectedDestinationId={destination.id}
        focusedActivities={[louvreActivity]}
        selectedActivityId={null}
        onSelectDestination={vi.fn()}
        onSelectActivity={vi.fn()}
      />,
    );

    rerender(
      <MapCanvas
        destinations={[destination]}
        routeLegs={[]}
        selectedDestinationId={null}
        focusedActivities={[]}
        selectedActivityId={null}
        onSelectDestination={vi.fn()}
        onSelectActivity={vi.fn()}
      />,
    );

    expect(map.easeTo).toHaveBeenCalledWith({
      center: [18, 24],
      zoom: 4.5,
      duration: 700,
    });
  });
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npm test -- src/components/MapCanvas.test.tsx
```

Expected: FAIL because stop focus does not call `fitBounds` and restore does not call `easeTo`.

- [ ] **Step 3: Add viewport helpers and saved viewport ref**

In `src/components/MapCanvas.tsx`, add these types near `OverlayPosition`:

```ts
type MapViewport = {
  center: [number, number];
  zoom: number;
};
```

Add constants near `addStopMenuApproxSize`:

```ts
const stopFocusPadding = {
  top: 96,
  right: 760,
  bottom: 96,
  left: 96,
};
const stopFocusMaxZoom = 13;
const mapViewportTransitionMs = 700;
```

Add helpers near `fitMapToDestinations`:

```ts
function mapViewport(map: maplibregl.Map): MapViewport {
  const center = map.getCenter();

  return {
    center: [center.lng, center.lat],
    zoom: map.getZoom(),
  };
}

function focusedCoordinatesForDestination(destination: Destination, focusedActivities: Activity[]): Coordinates[] {
  return [
    destination.coordinates,
    ...focusedActivities.flatMap((activity) =>
      activity.location?.coordinates ? [activity.location.coordinates] : [],
    ),
  ];
}
```

Inside `MapCanvas`, add this ref after `previousDestinationCountRef`:

```ts
  const routeViewportBeforeFocusRef = useRef<MapViewport | null>(null);
```

- [ ] **Step 4: Implement stop focus fit and route viewport restore**

Add this callback after `fitMapToDestinations`:

```ts
  const fitMapToStopFocus = useCallback((destination: Destination, activities: Activity[]) => {
    const map = mapRef.current;
    if (!map) return;

    const coordinates = focusedCoordinatesForDestination(destination, activities);
    const lngs = coordinates.map((coordinate) => coordinate.lng);
    const lats = coordinates.map((coordinate) => coordinate.lat);

    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      {
        padding: stopFocusPadding,
        maxZoom: stopFocusMaxZoom,
        duration: mapViewportTransitionMs,
      },
    );
  }, []);
```

Add this effect after the main props sync effect:

```ts
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const previousSelectedDestinationId = latestSelectedDestinationIdRef.current;
    const selectedDestination = selectedDestinationId
      ? destinations.find((candidate) => candidate.id === selectedDestinationId) ?? null
      : null;

    if (selectedDestination) {
      if (!previousSelectedDestinationId && !routeViewportBeforeFocusRef.current) {
        routeViewportBeforeFocusRef.current = mapViewport(map);
      }
      fitMapToStopFocus(selectedDestination, focusedActivities);
      return;
    }

    if (previousSelectedDestinationId && routeViewportBeforeFocusRef.current) {
      map.easeTo({
        center: routeViewportBeforeFocusRef.current.center,
        zoom: routeViewportBeforeFocusRef.current.zoom,
        duration: mapViewportTransitionMs,
      });
      routeViewportBeforeFocusRef.current = null;
    }
  }, [destinations, fitMapToStopFocus, focusedActivities, selectedDestinationId]);
```

Important: this effect relies on comparing against the previous selected destination id. If the existing main props sync effect updates `latestSelectedDestinationIdRef.current` before this effect runs, split that ref into `previousSelectedDestinationIdRef` or move the assignment after this focus effect. The implementation must preserve these cases:

- `null -> dest-1`: save route viewport and fit.
- `dest-1 -> dest-2`: do not overwrite saved route viewport, fit new stop.
- `dest-1 -> null`: restore saved route viewport and clear the saved viewport.

A simple implementation is to add:

```ts
  const previousSelectedDestinationIdRef = useRef(selectedDestinationId);
```

Then use `previousSelectedDestinationIdRef.current` in the focus effect and set it at the end of that effect:

```ts
    previousSelectedDestinationIdRef.current = selectedDestinationId;
```

- [ ] **Step 5: Run focused tests and commit**

Run:

```bash
npm test -- src/components/MapCanvas.test.tsx
```

Expected: PASS.

Commit:

```bash
git add src/components/MapCanvas.tsx src/components/MapCanvas.test.tsx
git commit -m "Add stop focus viewport transitions"
```

## Task 3: Add Clickable Activity Pins And App Wiring

**Files:**
- Modify: `src/components/MapCanvas.tsx`
- Modify: `src/components/MapCanvas.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

- [ ] **Step 1: Write failing MapCanvas test for activity pin clicks**

In `src/components/MapCanvas.test.tsx`, add:

```ts
  it('fires onSelectActivity when an activity pin is clicked', () => {
    const onSelectActivity = vi.fn();

    render(
      <MapCanvas
        destinations={[destination]}
        routeLegs={[]}
        selectedDestinationId={destination.id}
        focusedActivities={[louvreActivity]}
        selectedActivityId={null}
        onSelectDestination={vi.fn()}
        onSelectActivity={onSelectActivity}
      />,
    );

    const map = maplibreMock.mapInstances[0];
    const activityClickHandler = map.on.mock.calls.find(
      ([eventName, layerId]) => eventName === 'click' && layerId === 'world-tour-activity-points',
    )?.[2];

    act(() => {
      activityClickHandler({
        features: [{ properties: { id: louvreActivity.id } }],
      });
    });

    expect(onSelectActivity).toHaveBeenCalledWith(louvreActivity.id);
  });
```

- [ ] **Step 2: Implement activity pin click handlers**

In the map initialization effect in `src/components/MapCanvas.tsx`, add:

```ts
    const handleActivityClick = (event: maplibregl.MapLayerMouseEvent) => {
      const activityId = event.features?.[0]?.properties?.id;

      if (typeof activityId === 'string') {
        onSelectActivityRef.current?.(activityId);
      }
    };
    const handleActivityMouseEnter = () => {
      map.getCanvas().style.cursor = 'pointer';
    };
    const handleActivityMouseLeave = () => {
      map.getCanvas().style.cursor = '';
    };
```

Register the handlers after destination point handlers:

```ts
    map.on('click', activityPointsLayerId, handleActivityClick);
    map.on('mouseenter', activityPointsLayerId, handleActivityMouseEnter);
    map.on('mouseleave', activityPointsLayerId, handleActivityMouseLeave);
```

Clean them up in the return block:

```ts
      map.off('click', activityPointsLayerId, handleActivityClick);
      map.off('mouseenter', activityPointsLayerId, handleActivityMouseEnter);
      map.off('mouseleave', activityPointsLayerId, handleActivityMouseLeave);
```

- [ ] **Step 3: Wire App props into MapCanvas**

In `src/App.tsx`, update the `MapCanvas` call:

```tsx
        <MapCanvas
          destinations={destinations}
          routeLegs={routeLegs}
          selectedDestinationId={selectedDestinationId}
          focusedActivities={selectedDestinationActivities}
          selectedActivityId={selectedActivityId}
          onSelectDestination={handleSelectDestination}
          onSelectActivity={setSelectedActivityId}
          onRequestAddStop={openPendingMapStop}
        />
```

- [ ] **Step 4: Write app-level test for map pin opening the activity panel**

In `src/App.test.tsx`, update `MockMap`:

```ts
  easeTo: Mock;
```

Inside the mocked map object, add:

```ts
      easeTo: vi.fn(),
```

Add this helper near the other local test helpers:

```ts
function triggerMapLayerEvent(map: MockMap, eventName: string, layerId: string, event: unknown) {
  const handler = map.on.mock.calls.find(
    ([candidateEventName, candidateLayerId]) =>
      candidateEventName === eventName && candidateLayerId === layerId,
  )?.[2];

  if (typeof handler !== 'function') {
    throw new Error(`No ${eventName} handler registered for ${layerId}`);
  }

  act(() => {
    handler(event);
  });
}
```

Add this test near the existing activity panel tests:

```ts
  it('opens the activity panel when a focused activity map pin is clicked', async () => {
    const destination = createDestination({
      name: 'Paris',
      countryRegion: 'France',
      coordinates: { lat: 48.8566, lng: 2.3522 },
    });
    const louvre = createActivity({
      destinationId: destination.id,
      title: 'Louvre Museum',
      order: 0,
      location: {
        name: 'Louvre Museum',
        address: 'Rue de Rivoli, 75001 Paris, France',
        coordinates: { lat: 48.8606, lng: 2.3376 },
        sourceProvider: 'maptiler',
        sourceFeatureId: 'poi-louvre',
      },
    });
    repositoryMock.initialDestinations = Promise.resolve([destination]);
    repositoryMock.listActivities.mockResolvedValue([louvre]);

    render(<App />);

    await waitFor(() => expect(screen.queryByText('Loading trip data')).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Paris, France' }));
    await screen.findByRole('complementary', { name: 'Paris profile' });

    const map = maplibreMock.mapInstances[0];
    triggerMapLayerEvent(map, 'click', 'world-tour-activity-points', {
      features: [{ properties: { id: louvre.id } }],
    });

    expect(await screen.findByRole('complementary', { name: 'Louvre Museum activity' })).toBeInTheDocument();
  });
```

- [ ] **Step 5: Run focused tests and commit**

Run:

```bash
npm test -- src/components/MapCanvas.test.tsx src/App.test.tsx
```

Expected: PASS.

Commit:

```bash
git add src/components/MapCanvas.tsx src/components/MapCanvas.test.tsx src/App.tsx src/App.test.tsx
git commit -m "Wire clickable activity map pins"
```

## Task 4: Rendered Verification And Final Checks

**Files:**
- Modify: `src/styles.css` only if rendered verification proves the default MapLibre layer styling needs app-level CSS support.
- Modify: `tests/world-tour.spec.ts` only if a stable e2e assertion can be added without making MapLibre internals brittle.

- [ ] **Step 1: Run focused unit tests**

Run:

```bash
npm test -- src/components/MapCanvas.test.tsx src/App.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run broader tests likely affected by panel and activity selection**

Run:

```bash
npm test -- src/components/DestinationProfile.test.tsx src/components/ActivityPanel.test.tsx src/components/ActivityList.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run lint and build**

Run:

```bash
npm run lint
npm run build
```

Expected: PASS. The build may print the existing Vite large chunk warning; that warning is acceptable.

- [ ] **Step 4: Browser verification**

Start the normal dev server:

```bash
npm run dev
```

Open the app in a browser and verify:

- Route view shows stop pins and no activity pins.
- Selecting a stop zooms into the stop area.
- Mappable activities around the stop appear as activity pins.
- Clicking an activity pin opens the activity panel.
- Closing only the activity panel keeps the stop focus view active.
- Closing the stop panel returns to the route-level viewport and hides activity pins.

If the browser check shows activity labels overlap the panels, update `stopFocusPadding` in `src/components/MapCanvas.tsx` first. Only edit `src/styles.css` if the problem is caused by DOM overlay styling rather than MapLibre layer placement.

- [ ] **Step 5: Run e2e**

Run:

```bash
npm run test:e2e
```

Expected: PASS. If Playwright reports that `127.0.0.1:5174` is already in use, run:

```bash
lsof -nP -iTCP:5174 -sTCP:LISTEN
```

If the listener is a Vite process from `.`, stop that process and rerun `npm run test:e2e`.

- [ ] **Step 6: Final status check**

Run:

```bash
git status --short
```

Expected: only intentional stop-focus map files are modified. If `src/styles.css` and `src/styles.test.ts` still show the unrelated image-strip edits from before this plan, leave them unstaged.

- [ ] **Step 7: Final commit if verification required changes**

If Task 4 required code or test changes, commit them:

```bash
git add src/components/MapCanvas.tsx src/components/MapCanvas.test.tsx src/App.tsx src/App.test.tsx tests/world-tour.spec.ts
git commit -m "Verify stop focus map behavior"
```

If Task 4 made no changes, do not create an empty commit.

## Self-Review

- Spec coverage: Task 1 covers focused activity source/layers, feature filtering, selected activity properties, and empty route-view data. Task 2 covers zooming into selected stops, mappable activities, no-activity local zoom, direct stop transitions, and route viewport restore. Task 3 covers clickable pins and app state flow. Task 4 covers rendered behavior and final verification.
- Red-flag scan: no vague steps or unspecified test commands remain.
- Type consistency: `focusedActivities`, `selectedActivityId`, and `onSelectActivity` are introduced in `MapCanvasProps`, used in `App`, and covered by test fixtures using the existing `Activity` type.
