# Map Pin Stop Add Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add right-click and long-press map stop creation with reverse-geocoded confirmation, fallback coordinate stops, and keyboard-accessible map-center add.

**Architecture:** `MapCanvas` owns map pointer gestures and the initial `Add stop here` context menu, then emits coordinates to the app. `App` owns reverse-geocoding, confirmation state, fallback location data, save errors, and selection of the newly created stop. `TopToolbar` gets a secondary keyboard-accessible add-at-center action that uses the same app-owned confirmation flow.

**Tech Stack:** React 19, TypeScript, MapLibre GL JS, MapTiler geocoding adapter, Vitest, Testing Library, Playwright, existing CSS tokens.

---

## File Structure

- Modify `src/components/MapCanvas.tsx`
  - Add exported `MapAddStopRequest` type.
  - Add optional `onRequestAddStop` prop.
  - Track context-menu coordinates and screen position.
  - Open context menu on MapLibre `contextmenu`.
  - Detect long-press through pointer events on the map container with drag cancellation.
  - Expose `getMapCenterCoordinates()` through a ref callback prop so `App` can support toolbar fallback.
- Modify `src/components/MapCanvas.test.tsx`
  - Extend the MapLibre mock with `getCenter`.
  - Add tests for right-click request, long-press request, drag-canceled long-press, destination selection preservation, and center-coordinate callback.
- Modify `src/components/TopToolbar.tsx`
  - Add optional `onRequestAddAtMapCenter` prop.
  - Add an icon button next to the search field with accessible label `Add stop at map center`.
- Modify `src/App.tsx`
  - Add pending map-stop confirmation state.
  - Reuse `resolveMapTilerCoordinates` for reverse geocoding.
  - Build fallback legacy-style location data when reverse geocoding fails.
  - Confirm by calling existing `addDestination`, then select the returned destination id.
  - Ensure `Escape` closes pending map-stop UI before closing an existing profile.
- Modify `src/App.test.tsx`
  - Extend MapLibre mock with `getCenter`.
  - Add app-level tests for reverse-geocoded add, reverse-geocode fallback, loading-state mutation lock, and selecting the newly added stop.
- Modify `src/styles.css`
  - Add styling for map context menu, pending add confirmation, and toolbar map-center button using existing overlay/control tokens.
- Modify `tests/world-tour.spec.ts`
  - Add a focused browser check for right-click add flow when API responses are mocked.

---

### Task 1: MapCanvas Context Menu And Long Press

**Files:**
- Modify: `src/components/MapCanvas.tsx`
- Test: `src/components/MapCanvas.test.tsx`

- [ ] **Step 1: Write failing tests for map add-stop gestures**

Add these tests near the existing `MapCanvas` interaction tests in `src/components/MapCanvas.test.tsx`:

```tsx
  it('opens an add-stop context menu on right-click and emits clicked coordinates', async () => {
    const onRequestAddStop = vi.fn();

    render(
      <MapCanvas
        destinations={[]}
        routeLegs={[]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
        onRequestAddStop={onRequestAddStop}
      />,
    );

    const map = maplibreMock.mapInstances[0];
    const contextMenuHandler = map.on.mock.calls.find(([eventName]) => eventName === 'contextmenu')?.[1];

    act(() => {
      contextMenuHandler({
        preventDefault: vi.fn(),
        lngLat: { lat: 51.0576, lng: -0.1342 },
        point: { x: 320, y: 180 },
      });
    });

    await userEvent.click(screen.getByRole('menuitem', { name: 'Add stop here' }));

    expect(onRequestAddStop).toHaveBeenCalledWith({
      coordinates: { lat: 51.0576, lng: -0.1342 },
      screenPosition: { x: 320, y: 180 },
      source: 'context-menu',
    });
  });

  it('emits an add-stop request after a long press on the map', () => {
    vi.useFakeTimers();
    const onRequestAddStop = vi.fn();

    render(
      <MapCanvas
        destinations={[]}
        routeLegs={[]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
        onRequestAddStop={onRequestAddStop}
      />,
    );

    const map = maplibreMock.mapInstances[0];
    const container = screen.getByTestId('map-container');
    map.unproject.mockReturnValue({ lat: 35.0116, lng: 135.7681 });

    fireEvent.pointerDown(container, {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 240,
      clientY: 220,
    });
    act(() => {
      vi.advanceTimersByTime(550);
    });

    expect(onRequestAddStop).toHaveBeenCalledWith({
      coordinates: { lat: 35.0116, lng: 135.7681 },
      screenPosition: { x: 240, y: 220 },
      source: 'long-press',
    });

    vi.useRealTimers();
  });

  it('cancels a pending long press when the pointer moves like a map drag', () => {
    vi.useFakeTimers();
    const onRequestAddStop = vi.fn();

    render(
      <MapCanvas
        destinations={[]}
        routeLegs={[]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
        onRequestAddStop={onRequestAddStop}
      />,
    );

    const container = screen.getByTestId('map-container');

    fireEvent.pointerDown(container, {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 240,
      clientY: 220,
    });
    fireEvent.pointerMove(container, {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 260,
      clientY: 242,
    });
    act(() => {
      vi.advanceTimersByTime(550);
    });

    expect(onRequestAddStop).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('provides current map center coordinates through the center callback', () => {
    const onMapCenterCoordinatesChange = vi.fn();

    render(
      <MapCanvas
        destinations={[]}
        routeLegs={[]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
        onMapCenterCoordinatesChange={onMapCenterCoordinatesChange}
      />,
    );

    const map = maplibreMock.mapInstances[0];
    map.getCenter.mockReturnValue({ lat: 48.8566, lng: 2.3522 });
    const moveHandler = map.on.mock.calls.find(([eventName]) => eventName === 'move')?.[1];

    act(() => {
      moveHandler();
    });

    expect(onMapCenterCoordinatesChange).toHaveBeenLastCalledWith({ lat: 48.8566, lng: 2.3522 });
  });
```

Update the test mock type and mock map in `src/components/MapCanvas.test.tsx`:

```tsx
type MockMap = {
  on: Mock;
  off: Mock;
  remove: Mock;
  addControl: Mock;
  getZoom: Mock;
  getCenter: Mock;
  unproject: Mock;
  getSource: Mock;
  addSource: Mock;
  addLayer: Mock;
  getLayer: Mock;
  getStyle: Mock;
  setLayoutProperty: Mock;
  setPaintProperty: Mock;
  getCanvas: Mock;
  fitBounds: Mock;
  project: Mock;
  jumpTo: Mock;
};
```

Inside the mocked map object add:

```tsx
      getCenter: vi.fn(() => ({ lat: 24, lng: 18 })),
      unproject: vi.fn(([x, y]: [number, number]) => ({ lng: (x - 1000) / 10, lat: (500 - y) / 10 })),
```

- [ ] **Step 2: Run the focused MapCanvas tests and verify failure**

Run:

```bash
npm run test -- src/components/MapCanvas.test.tsx
```

Expected: FAIL because `MapCanvasProps` does not yet accept `onRequestAddStop` or `onMapCenterCoordinatesChange`, and no `contextmenu`/pointer add-stop behavior exists.

- [ ] **Step 3: Implement MapCanvas add-stop request behavior**

In `src/components/MapCanvas.tsx`, update imports and props:

```tsx
import type { ChangeEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { Coordinates, Destination, RouteLeg } from '../domain/types';

export type MapAddStopRequest = {
  coordinates: Coordinates;
  screenPosition: {
    x: number;
    y: number;
  };
  source: 'context-menu' | 'long-press' | 'map-center';
};

type MapCanvasProps = {
  destinations: Destination[];
  routeLegs: RouteLeg[];
  selectedDestinationId: string | null;
  onSelectDestination: (destinationId: string) => void;
  onRequestAddStop?: (request: MapAddStopRequest) => void;
  onMapCenterCoordinatesChange?: (coordinates: Coordinates) => void;
};
```

Add state and refs inside `MapCanvas`:

```tsx
  const onRequestAddStopRef = useRef(onRequestAddStop);
  const onMapCenterCoordinatesChangeRef = useRef(onMapCenterCoordinatesChange);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressStartRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const [addStopMenu, setAddStopMenu] = useState<MapAddStopRequest | null>(null);
```

Add helper functions inside `MapCanvas`:

```tsx
  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current === null) return;

    window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  }, []);

  const closeAddStopMenu = useCallback(() => {
    setAddStopMenu(null);
  }, []);

  const emitMapCenterCoordinates = useCallback(() => {
    const map = mapRef.current;
    if (!map || !onMapCenterCoordinatesChangeRef.current) return;

    const center = map.getCenter();
    onMapCenterCoordinatesChangeRef.current({ lat: center.lat, lng: center.lng });
  }, []);

  const requestAddStop = useCallback((request: MapAddStopRequest) => {
    setAddStopMenu(null);
    onRequestAddStopRef.current?.(request);
  }, []);

  const openAddStopMenu = useCallback((request: MapAddStopRequest) => {
    setAddStopMenu(request);
  }, []);
```

Update the existing prop sync effect to track new refs:

```tsx
    onSelectDestinationRef.current = onSelectDestination;
    onRequestAddStopRef.current = onRequestAddStop;
    onMapCenterCoordinatesChangeRef.current = onMapCenterCoordinatesChange;
```

Add pointer handlers:

```tsx
  const handleMapPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!onRequestAddStopRef.current || event.pointerType === 'mouse') return;

    clearLongPressTimer();
    longPressStartRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
    longPressTimerRef.current = window.setTimeout(() => {
      const map = mapRef.current;
      const longPressStart = longPressStartRef.current;
      if (!map || !longPressStart) return;

      const coordinates = map.unproject([longPressStart.x, longPressStart.y]);
      requestAddStop({
        coordinates: { lat: coordinates.lat, lng: coordinates.lng },
        screenPosition: { x: longPressStart.x, y: longPressStart.y },
        source: 'long-press',
      });
      longPressStartRef.current = null;
      clearLongPressTimer();
    }, 500);
  };

  const handleMapPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const longPressStart = longPressStartRef.current;
    if (!longPressStart || longPressStart.pointerId !== event.pointerId) return;

    const deltaX = Math.abs(event.clientX - longPressStart.x);
    const deltaY = Math.abs(event.clientY - longPressStart.y);
    if (deltaX > 10 || deltaY > 10) {
      longPressStartRef.current = null;
      clearLongPressTimer();
    }
  };

  const handleMapPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const longPressStart = longPressStartRef.current;
    if (!longPressStart || longPressStart.pointerId !== event.pointerId) return;

    longPressStartRef.current = null;
    clearLongPressTimer();
  };
```

Inside the MapLibre setup effect, add context menu and center reporting:

```tsx
    const handleContextMenu = (event: maplibregl.MapMouseEvent) => {
      if (!onRequestAddStopRef.current) return;

      event.preventDefault();
      openAddStopMenu({
        coordinates: { lat: event.lngLat.lat, lng: event.lngLat.lng },
        screenPosition: { x: event.point.x, y: event.point.y },
        source: 'context-menu',
      });
    };
```

Update `handleMapMove`:

```tsx
    const handleMapMove = () => {
      updateDestinationLabelPositions();
      emitMapCenterCoordinates();
    };
```

Register and unregister the context menu:

```tsx
    map.on('contextmenu', handleContextMenu);
```

```tsx
      map.off('contextmenu', handleContextMenu);
```

Call `emitMapCenterCoordinates()` after assigning `mapRef.current = map`.

Update the map container JSX:

```tsx
      <div
        ref={mapContainerRef}
        className="maplibre-container"
        data-testid="map-container"
        onPointerDown={handleMapPointerDown}
        onPointerMove={handleMapPointerMove}
        onPointerUp={handleMapPointerEnd}
        onPointerCancel={handleMapPointerEnd}
      />
```

Render the context menu before the destination label layer:

```tsx
      {addStopMenu ? (
        <div
          className="map-add-stop-menu"
          role="menu"
          style={{
            left: `${addStopMenu.screenPosition.x}px`,
            top: `${addStopMenu.screenPosition.y}px`,
          }}
        >
          <button type="button" role="menuitem" onClick={() => requestAddStop(addStopMenu)}>
            Add stop here
          </button>
          <button type="button" role="menuitem" onClick={closeAddStopMenu}>
            Cancel
          </button>
        </div>
      ) : null}
```

Update the effect dependency array to include `emitMapCenterCoordinates` and `openAddStopMenu`.

- [ ] **Step 4: Run MapCanvas tests and verify pass**

Run:

```bash
npm run test -- src/components/MapCanvas.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add src/components/MapCanvas.tsx src/components/MapCanvas.test.tsx
git commit -m "feat: request map stop adds from canvas"
```

Expected: Commit succeeds and includes only `MapCanvas` source and tests.

---

### Task 2: App-Owned Confirmation And Destination Creation

**Files:**
- Modify: `src/App.tsx`
- Test: `src/App.test.tsx`

- [ ] **Step 1: Write failing app tests for confirmed map stop add**

In `src/App.test.tsx`, extend `MockMap`:

```tsx
type MockMap = {
  on: Mock;
  off: Mock;
  remove: Mock;
  addControl: Mock;
  getSource: Mock;
  addSource: Mock;
  getLayer: Mock;
  addLayer: Mock;
  getCanvas: Mock;
  getZoom: Mock;
  getCenter: Mock;
  unproject: Mock;
  project: Mock;
};
```

Inside the mocked map object add:

```tsx
      getCenter: vi.fn(() => ({ lat: 24, lng: 18 })),
      unproject: vi.fn(([x, y]: [number, number]) => ({ lng: (x - 1000) / 10, lat: (500 - y) / 10 })),
```

Add this test after the searched-destination test:

```tsx
  it('adds a right-clicked map stop after reverse-geocoded confirmation and opens its profile', async () => {
    vi.mocked(resolveMapTilerCoordinates).mockResolvedValue({
      kind: 'place',
      id: 'place-balcombe',
      label: 'Balcombe, United Kingdom',
      coordinates: { lat: 51.0576, lng: -0.1342 },
      location: {
        placeName: 'Balcombe',
        regionName: 'West Sussex',
        countryName: 'United Kingdom',
        sourceLabel: 'Balcombe, West Sussex, United Kingdom',
        sourceProvider: 'maptiler',
        sourceFeatureId: 'place-balcombe',
      },
    });

    render(<App />);

    await waitFor(() => expect(screen.queryByText('Loading trip data')).not.toBeInTheDocument());
    await waitFor(() => expect(maplibreMock.mapInstances).toHaveLength(1));

    const map = maplibreMock.mapInstances[0];
    const contextMenuHandler = map.on.mock.calls.find(([eventName]) => eventName === 'contextmenu')?.[1];
    act(() => {
      contextMenuHandler({
        preventDefault: vi.fn(),
        lngLat: { lat: 51.0576, lng: -0.1342 },
        point: { x: 300, y: 220 },
      });
    });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Add stop here' }));

    expect(await screen.findByRole('dialog', { name: 'Add stop from map' })).toHaveTextContent('Balcombe');
    await userEvent.click(screen.getByRole('button', { name: 'Add stop' }));

    expect(resolveMapTilerCoordinates).toHaveBeenCalledWith(
      { lat: 51.0576, lng: -0.1342 },
      { apiKey: expect.any(String) },
    );
    expect(await screen.findByRole('complementary', { name: 'Balcombe profile' })).toBeInTheDocument();
    expect(screen.getByText('Stop 01')).toBeInTheDocument();
  });

  it('allows adding a map stop when reverse geocoding fails', async () => {
    vi.mocked(resolveMapTilerCoordinates).mockRejectedValue(new Error('Coordinate lookup failed'));

    render(<App />);

    await waitFor(() => expect(screen.queryByText('Loading trip data')).not.toBeInTheDocument());
    await waitFor(() => expect(maplibreMock.mapInstances).toHaveLength(1));

    const map = maplibreMock.mapInstances[0];
    const contextMenuHandler = map.on.mock.calls.find(([eventName]) => eventName === 'contextmenu')?.[1];
    act(() => {
      contextMenuHandler({
        preventDefault: vi.fn(),
        lngLat: { lat: 12.345678, lng: 98.765432 },
        point: { x: 300, y: 220 },
      });
    });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Add stop here' }));

    expect(await screen.findByRole('dialog', { name: 'Add stop from map' })).toHaveTextContent('Dropped pin');
    expect(screen.getByRole('dialog', { name: 'Add stop from map' })).toHaveTextContent('12.3457, 98.7654');
    expect(screen.getByRole('dialog', { name: 'Add stop from map' })).toHaveTextContent('Coordinate lookup failed');

    await userEvent.click(screen.getByRole('button', { name: 'Add stop' }));

    expect(await screen.findByRole('complementary', { name: 'Dropped pin profile' })).toBeInTheDocument();
  });

  it('adds a stop from the map center toolbar action', async () => {
    vi.mocked(resolveMapTilerCoordinates).mockResolvedValue({
      kind: 'place',
      id: 'place-paris',
      label: 'Paris, France',
      coordinates: { lat: 48.8566, lng: 2.3522 },
      location: {
        placeName: 'Paris',
        regionName: 'Ile-de-France',
        countryName: 'France',
        sourceLabel: 'Paris, Ile-de-France, France',
        sourceProvider: 'maptiler',
        sourceFeatureId: 'place-paris',
      },
    });

    render(<App />);

    await waitFor(() => expect(screen.queryByText('Loading trip data')).not.toBeInTheDocument());
    await waitFor(() => expect(maplibreMock.mapInstances).toHaveLength(1));
    maplibreMock.mapInstances[0].getCenter.mockReturnValue({ lat: 48.8566, lng: 2.3522 });

    await userEvent.click(screen.getByRole('button', { name: 'Add stop at map center' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Add stop' }));

    expect(await screen.findByRole('complementary', { name: 'Paris profile' })).toBeInTheDocument();
  });
```

Update the existing loading-state test to assert the fallback button is absent while loading:

```tsx
    expect(screen.queryByRole('button', { name: 'Add stop at map center' })).not.toBeInTheDocument();
```

- [ ] **Step 2: Run app tests and verify failure**

Run:

```bash
npm run test -- src/App.test.tsx
```

Expected: FAIL because app confirmation state and toolbar fallback action do not exist.

- [ ] **Step 3: Implement app pending stop state and confirmation UI**

In `src/App.tsx`, import the map request type and fallback helper:

```tsx
import type { MapAddStopRequest } from './components/MapCanvas';
import { createLegacyLocation, formatLocationParts } from './domain/locations';
import type { Coordinates, DestinationLocation } from './domain/types';
```

Add these types near `RepositoryError`:

```tsx
type PendingMapStop = {
  coordinates: Coordinates;
  screenPosition: MapAddStopRequest['screenPosition'];
  source: MapAddStopRequest['source'];
  name: string;
  location: DestinationLocation;
  isResolving: boolean;
  resolveError: string | null;
  saveError: string | null;
};
```

Add helpers near `formatRepositoryError`:

```tsx
function formatCoordinate(value: number) {
  return value.toFixed(4);
}

function formatCoordinatePair(coordinates: Coordinates) {
  return `${formatCoordinate(coordinates.lat)}, ${formatCoordinate(coordinates.lng)}`;
}

function createFallbackMapStop(coordinates: Coordinates): Pick<PendingMapStop, 'name' | 'location'> {
  const name = 'Dropped pin';

  return {
    name,
    location: createLegacyLocation({
      name,
      countryRegion: formatCoordinatePair(coordinates),
    }),
  };
}
```

Inside `TripWorkspace`, add state:

```tsx
  const [pendingMapStop, setPendingMapStop] = useState<PendingMapStop | null>(null);
  const [mapCenterCoordinates, setMapCenterCoordinates] = useState<Coordinates | null>(null);
```

Replace `handleAddDestination` with a version that returns the created destination:

```tsx
  const handleAddDestination = useCallback(
    async (input: Parameters<typeof addDestination>[0]) => {
      if (isInteractionLocked) return undefined;

      return addDestination(input);
    },
    [addDestination, isInteractionLocked],
  );
```

Add pending map-stop handlers:

```tsx
  const openPendingMapStop = useCallback(
    async (request: MapAddStopRequest) => {
      if (isInteractionLocked) return;

      const fallback = createFallbackMapStop(request.coordinates);
      setPendingMapStop({
        coordinates: request.coordinates,
        screenPosition: request.screenPosition,
        source: request.source,
        name: fallback.name,
        location: fallback.location,
        isResolving: true,
        resolveError: null,
        saveError: null,
      });

      try {
        const resolvedResult = await resolveMapTilerCoordinates(request.coordinates, { apiKey: mapTilerApiKey });
        setPendingMapStop((current) => {
          if (!current || current.coordinates !== request.coordinates) return current;

          return {
            ...current,
            name: resolvedResult.location.placeName,
            location: resolvedResult.location,
            isResolving: false,
            resolveError: null,
          };
        });
      } catch (caught) {
        setPendingMapStop((current) => {
          if (!current || current.coordinates !== request.coordinates) return current;

          return {
            ...current,
            isResolving: false,
            resolveError: caught instanceof Error ? caught.message : 'Coordinate lookup failed',
          };
        });
      }
    },
    [isInteractionLocked],
  );

  const handleRequestAddAtMapCenter = useCallback(() => {
    if (!mapCenterCoordinates) return;

    void openPendingMapStop({
      coordinates: mapCenterCoordinates,
      screenPosition: { x: window.innerWidth / 2, y: window.innerHeight / 2 },
      source: 'map-center',
    });
  }, [mapCenterCoordinates, openPendingMapStop]);

  const closePendingMapStop = useCallback(() => {
    setPendingMapStop(null);
  }, []);

  const confirmPendingMapStop = useCallback(async () => {
    if (!pendingMapStop || isInteractionLocked) return;

    setPendingMapStop((current) => (current ? { ...current, saveError: null } : current));
    try {
      const destination = await handleAddDestination({
        name: pendingMapStop.name,
        location: pendingMapStop.location,
        coordinates: pendingMapStop.coordinates,
      });
      setPendingMapStop(null);
      if (destination) {
        setSelectedDestinationId(destination.id);
      }
    } catch (caught) {
      setPendingMapStop((current) =>
        current
          ? {
              ...current,
              saveError: caught instanceof Error ? caught.message : 'Unable to add stop',
            }
          : current,
      );
    }
  }, [handleAddDestination, isInteractionLocked, pendingMapStop]);
```

Add an Escape handler before the existing selected-destination Escape handler or update it to close pending UI first:

```tsx
  useEffect(() => {
    if (!pendingMapStop || isInteractionLocked) return undefined;

    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;

      event.preventDefault();
      setPendingMapStop(null);
    };

    window.addEventListener('keydown', handleWindowKeyDown);
    return () => {
      window.removeEventListener('keydown', handleWindowKeyDown);
    };
  }, [isInteractionLocked, pendingMapStop]);
```

Pass the new props:

```tsx
        <MapCanvas
          destinations={destinations}
          routeLegs={routeLegs}
          selectedDestinationId={selectedDestinationId}
          onSelectDestination={setSelectedDestinationId}
          onRequestAddStop={openPendingMapStop}
          onMapCenterCoordinatesChange={setMapCenterCoordinates}
        />
```

```tsx
            <TopToolbar
              searchPlaces={searchPlaces}
              resolveSearchResult={resolveSearchResult}
              onAddDestination={handleAddDestination}
              onRequestAddAtMapCenter={mapCenterCoordinates ? handleRequestAddAtMapCenter : undefined}
            />
```

Render the confirmation before `DestinationProfile`:

```tsx
        {!isInteractionLocked && pendingMapStop ? (
          <section
            className="map-stop-confirmation"
            role="dialog"
            aria-modal="false"
            aria-label="Add stop from map"
            style={{
              left: `${pendingMapStop.screenPosition.x}px`,
              top: `${pendingMapStop.screenPosition.y}px`,
            }}
          >
            <div>
              <span className="map-stop-confirmation__eyebrow">
                {pendingMapStop.isResolving ? 'Resolving map location' : 'Map stop'}
              </span>
              <h2>{pendingMapStop.name}</h2>
              <p>{formatLocationParts(pendingMapStop.location) || formatCoordinatePair(pendingMapStop.coordinates)}</p>
              <p>{formatCoordinatePair(pendingMapStop.coordinates)}</p>
            </div>
            {pendingMapStop.resolveError ? (
              <p className="map-stop-confirmation__error">{pendingMapStop.resolveError}</p>
            ) : null}
            {pendingMapStop.saveError ? (
              <p className="map-stop-confirmation__error">{pendingMapStop.saveError}</p>
            ) : null}
            <div className="map-stop-confirmation__actions">
              <button type="button" onClick={closePendingMapStop}>
                Cancel
              </button>
              <button type="button" onClick={() => void confirmPendingMapStop()}>
                Add stop
              </button>
            </div>
          </section>
        ) : null}
```

- [ ] **Step 4: Update TopToolbar for map-center fallback**

In `src/components/TopToolbar.tsx`, update imports:

```tsx
import { MapPinPlus, Search, X } from 'lucide-react';
```

Update props:

```tsx
type TopToolbarProps = {
  searchPlaces: (query: string) => Promise<PlaceSearchResult[]>;
  resolveSearchResult: (result: PlaceSearchResult) => Promise<Extract<PlaceSearchResult, { kind: 'place' }>>;
  onAddDestination: (input: AddDestinationInput) => Promise<void> | void;
  onRequestAddAtMapCenter?: () => void;
};
```

Update function signature:

```tsx
export function TopToolbar({
  searchPlaces,
  resolveSearchResult,
  onAddDestination,
  onRequestAddAtMapCenter,
}: TopToolbarProps) {
```

Render this button after the search group:

```tsx
      {onRequestAddAtMapCenter ? (
        <button
          type="button"
          className="toolbar-icon-action"
          aria-label="Add stop at map center"
          onClick={onRequestAddAtMapCenter}
        >
          <MapPinPlus size={18} aria-hidden="true" />
        </button>
      ) : null}
```

- [ ] **Step 5: Run app tests and verify pass**

Run:

```bash
npm run test -- src/App.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

Run:

```bash
git add src/App.tsx src/App.test.tsx src/components/TopToolbar.tsx
git commit -m "feat: confirm map stop additions"
```

Expected: Commit succeeds and includes app, app tests, and toolbar source.

---

### Task 3: Styling, Toolbar Tests, And Browser Verification

**Files:**
- Modify: `src/components/TopToolbar.test.tsx`
- Modify: `src/styles.css`
- Modify: `tests/world-tour.spec.ts`

- [ ] **Step 1: Write failing toolbar test for map-center action**

Add this test to `src/components/TopToolbar.test.tsx`:

```tsx
  it('calls the map-center add handler from the icon action', async () => {
    const onRequestAddAtMapCenter = vi.fn();

    render(
      <TopToolbar
        searchPlaces={vi.fn()}
        resolveSearchResult={vi.fn()}
        onAddDestination={vi.fn()}
        onRequestAddAtMapCenter={onRequestAddAtMapCenter}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Add stop at map center' }));

    expect(onRequestAddAtMapCenter).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 2: Run toolbar test and verify failure or pass from Task 2**

Run:

```bash
npm run test -- src/components/TopToolbar.test.tsx
```

Expected: PASS after Task 2 because the accessible button exists and calls `onRequestAddAtMapCenter`.

- [ ] **Step 3: Add CSS for context menu, confirmation, and toolbar icon**

Add this CSS near the map and toolbar rules in `src/styles.css`:

```css
.map-add-stop-menu {
  position: absolute;
  z-index: 12;
  display: grid;
  min-width: 148px;
  gap: 4px;
  padding: 6px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-panel);
  color: var(--color-text);
  background: var(--surface-overlay-menu);
  box-shadow: var(--shadow-panel);
  transform: translate(8px, 8px);
  -webkit-backdrop-filter: blur(var(--blur-overlay)) saturate(1.2);
  backdrop-filter: blur(var(--blur-overlay)) saturate(1.2);
}

.map-add-stop-menu button {
  display: flex;
  min-height: 34px;
  align-items: center;
  justify-content: flex-start;
  border: 0;
  border-radius: var(--radius-control);
  padding: 8px 10px;
  color: var(--color-text);
  background: transparent;
  font-weight: 800;
  text-align: left;
  cursor: pointer;
}

.map-add-stop-menu button:hover,
.map-add-stop-menu button:focus-visible {
  background: var(--surface-action-subtle);
  outline: 0;
}

.toolbar-icon-action {
  display: grid;
  width: 44px;
  height: 44px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-panel);
  color: var(--color-text);
  background: var(--surface-overlay);
  box-shadow: var(--shadow-panel);
  cursor: pointer;
  -webkit-backdrop-filter: blur(var(--blur-overlay)) saturate(1.25);
  backdrop-filter: blur(var(--blur-overlay)) saturate(1.25);
}

.toolbar-icon-action:hover,
.toolbar-icon-action:focus-visible {
  border-color: var(--border-hover);
  background: var(--surface-control-hover);
}

.map-stop-confirmation {
  position: absolute;
  z-index: 17;
  display: grid;
  width: min(320px, calc(100vw - 32px));
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-panel);
  color: var(--color-text);
  background: var(--surface-overlay-profile);
  box-shadow: var(--shadow-panel);
  transform: translate(12px, 12px);
  -webkit-backdrop-filter: blur(var(--blur-overlay)) saturate(1.2);
  backdrop-filter: blur(var(--blur-overlay)) saturate(1.2);
}

.map-stop-confirmation h2 {
  margin: 4px 0 0;
  font-size: 1.05rem;
  line-height: 1.2;
  letter-spacing: 0;
}

.map-stop-confirmation p {
  margin: 4px 0 0;
  color: var(--text-secondary);
  font-size: 0.84rem;
  line-height: 1.35;
}

.map-stop-confirmation__eyebrow {
  color: var(--text-muted);
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0;
  text-transform: uppercase;
}

.map-stop-confirmation__error {
  color: var(--color-danger);
}

.map-stop-confirmation__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.map-stop-confirmation__actions button {
  min-height: 34px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-control);
  padding: 8px 10px;
  color: var(--color-text);
  background: var(--surface-action-subtle);
  font-weight: 800;
  cursor: pointer;
}

.map-stop-confirmation__actions button:last-child {
  border-color: rgb(var(--color-accent-rgb) / 0.42);
  color: var(--color-text-inverse);
  background: var(--color-accent);
}
```

Add this mobile adjustment in the existing media query:

```css
  .map-stop-confirmation {
    left: 16px !important;
    right: 16px;
    bottom: 16px;
    top: auto !important;
    transform: none;
  }
```

- [ ] **Step 4: Add Playwright route and right-click flow check**

In `tests/world-tour.spec.ts`, add this MapTiler route mock to the setup for the new test:

```ts
  await page.route('https://api.maptiler.com/geocoding/**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        features: [
          {
            id: 'place-map-click',
            text: 'Map stop',
            place_name: 'Map stop, Test Region',
            center: [0, 0],
            context: [
              { id: 'region.1', text: 'Test Region' },
              { id: 'country.1', text: 'Test Country', short_code: 'tc' },
            ],
          },
        ],
      }),
    });
  });
```

Add this test:

```ts
test('adds a stop from the map context menu', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByLabel('Interactive world tour map')).toBeVisible();
  await page.mouse.click(360, 260, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Add stop here' }).click();

  await expect(page.getByRole('dialog', { name: 'Add stop from map' })).toBeVisible();
  await page.getByRole('button', { name: 'Add stop' }).click();

  await expect(page.getByRole('complementary', { name: /profile/ })).toBeVisible();
});
```

- [ ] **Step 5: Run focused unit tests**

Run:

```bash
npm run test -- src/components/TopToolbar.test.tsx src/components/MapCanvas.test.tsx src/App.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Run lint and build**

Run:

```bash
npm run lint
npm run build
```

Expected: both commands PASS.

- [ ] **Step 7: Run browser verification**

Run:

```bash
npm run test:e2e -- tests/world-tour.spec.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

Run:

```bash
git add src/components/TopToolbar.test.tsx src/styles.css tests/world-tour.spec.ts
git commit -m "test: verify map stop add flow"
```

Expected: Commit succeeds and includes only the toolbar test, styles, and Playwright test.

---

## Final Verification

- [ ] Run the complete unit test suite:

```bash
npm run test
```

Expected: PASS.

- [ ] Run lint:

```bash
npm run lint
```

Expected: PASS.

- [ ] Run production build:

```bash
npm run build
```

Expected: PASS.

- [ ] Run e2e tests:

```bash
npm run test:e2e
```

Expected: PASS.

- [ ] Inspect git status:

```bash
git status --short
```

Expected: only pre-existing unrelated local edits remain, or the worktree is clean if those edits were part of this implementation.
