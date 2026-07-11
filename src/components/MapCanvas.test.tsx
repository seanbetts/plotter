import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FeatureCollection, LineString, Point } from 'geojson';
import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Activity, Destination, RouteLeg } from '../domain/types';
import { buildRouteFeatures } from '../map/tripRouteFeatures';
import { MapCanvas } from './MapCanvas';

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
  hasImage: Mock;
  addImage: Mock;
  getLayer: Mock;
  getStyle: Mock;
  setLayoutProperty: Mock;
  setPaintProperty: Mock;
  getContainer: Mock;
  getCanvas: Mock;
  fitBounds: Mock;
  easeTo: Mock;
  project: Mock;
  jumpTo: Mock;
};

type MockGeoJsonSource = {
  setData: Mock;
};

const maplibreMock = vi.hoisted(() => {
  const mapInstances: MockMap[] = [];
  const sources = new globalThis.Map<string, MockGeoJsonSource>();
  let zoom = 1.4;
  let containerSize = { width: 1280, height: 720 };
  const project = vi.fn(([lng, lat]: [number, number]) => ({ x: lng * 10 + 1000, y: lat * -10 + 500 }));
  const Map = vi.fn(function () {
    const map = {
      on: vi.fn(),
      off: vi.fn(),
      remove: vi.fn(),
      addControl: vi.fn(),
      getZoom: vi.fn(() => zoom),
      getCenter: vi.fn(() => ({ lat: 24, lng: 18 })),
      unproject: vi.fn(([x, y]: [number, number]) => ({ lng: (x - 1000) / 10, lat: (500 - y) / 10 })),
      getSource: vi.fn((sourceId: string) => sources.get(sourceId)),
      addSource: vi.fn((sourceId: string) => {
        const source = { setData: vi.fn() };
        sources.set(sourceId, source);
      }),
      addLayer: vi.fn(),
      hasImage: vi.fn(() => false),
      addImage: vi.fn(),
      getLayer: vi.fn(),
      getStyle: vi.fn(() => ({
        layers: [
          { id: 'poi-label', type: 'symbol' },
          { id: 'mountain-peak-label', type: 'symbol' },
          { id: 'road_minor', type: 'line' },
          { id: 'road_major', type: 'line' },
          { id: 'Water', type: 'fill', 'source-layer': 'water' },
          { id: 'Country labels', type: 'symbol', 'source-layer': 'country_label' },
          { id: 'Road labels', type: 'symbol', 'source-layer': 'road_label' },
          { id: 'Airport zone', type: 'fill', 'source-layer': 'aviation' },
          { id: 'Highway', type: 'line', 'source-layer': 'road' },
          { id: 'Major road', type: 'line', 'source-layer': 'road' },
          { id: 'Capital city labels', type: 'symbol', 'source-layer': 'city_label' },
          { id: 'City labels', type: 'symbol', 'source-layer': 'city_label' },
          { id: 'country-label', type: 'symbol' },
        ],
      })),
      setLayoutProperty: vi.fn(),
      setPaintProperty: vi.fn(),
      getContainer: vi.fn(() => ({
        clientWidth: containerSize.width,
        clientHeight: containerSize.height,
        getBoundingClientRect: () => ({
          width: containerSize.width,
          height: containerSize.height,
        }),
      })),
      getCanvas: vi.fn(() => ({ style: { cursor: '' } })),
      fitBounds: vi.fn(),
      easeTo: vi.fn(),
      project,
      jumpTo: vi.fn(),
    };
    mapInstances.push(map);
    return map;
  });
  const NavigationControl = vi.fn(function () {
    return {};
  });
  const setZoom = (nextZoom: number) => {
    zoom = nextZoom;
  };
  const setContainerSize = (width: number, height: number) => {
    containerSize = { width, height };
  };
  const resetSources = () => {
    sources.clear();
  };
  const getSource = (sourceId: string) => sources.get(sourceId);

  return { Map, NavigationControl, mapInstances, project, setZoom, setContainerSize, resetSources, getSource };
});

vi.mock('maplibre-gl', () => ({
  default: {
    Map: maplibreMock.Map,
    NavigationControl: maplibreMock.NavigationControl,
  },
}));

describe('MapCanvas', () => {
  const destination: Destination = {
    id: 'dest-1',
    name: 'Cappadocia',
    countryRegion: 'Turkey',
    coordinates: { lat: 38.6431, lng: 34.8289 },
    location: {
      placeName: 'Cappadocia',
      regionName: '',
      countryName: 'Turkey',
      sourceLabel: 'Cappadocia, Turkey',
      sourceProvider: 'legacy',
    },
    order: 0,
    status: 'idea',
    priority: 'medium',
    timing: { idealMonths: [], expectedStayDays: 3, provisionalStartDate: '', provisionalEndDate: '' },
    why: { summary: '', highlights: '', personalRationale: '' },
    media: [],
    research: { notes: '', links: [], bookReferences: [] },
    activities: { items: [] },
    routeContext: { previousNextNotes: '', drivingNotes: '', borderShippingNotes: '', notes: '' },
    tags: [],
    createdAt: '2026-06-28T00:00:00.000Z',
    updatedAt: '2026-06-28T00:00:00.000Z',
  };

  const targetDestination: Destination = {
    ...destination,
    id: 'dest-2',
    name: 'Tbilisi',
    countryRegion: 'Georgia',
    coordinates: { lat: 41.7151, lng: 44.8271 },
    location: {
      placeName: 'Tbilisi',
      regionName: '',
      countryName: 'Georgia',
      sourceLabel: 'Tbilisi, Georgia',
      sourceProvider: 'legacy',
    },
  };

  const routeLeg: RouteLeg = {
    id: 'route-1',
    originDestinationId: destination.id,
    targetDestinationId: targetDestination.id,
    movement: 'drive', calculation: 'automatic',
    status: 'ready',
    geometry: {
      type: 'LineString',
      coordinates: [
        [34.8289, 38.6431],
        [39, 40],
        [44.8271, 41.7151],
      ],
    },
    notes: '',
    createdAt: '2026-06-28T00:00:00.000Z',
    updatedAt: '2026-06-28T00:00:00.000Z',
  };

  it('splits stored ferry sections into exact road and ferry geometry slices', () => {
    const coordinates = Array.from({ length: 11 }, (_, index) => [index, index + 40]);
    const ferryRouteLeg: RouteLeg = {
      ...routeLeg,
      id: 'route-with-ferry',
      status: 'review-required',
      geometry: { type: 'LineString', coordinates },
      sections: [{ kind: 'ferry', startGeometryIndex: 2, endGeometryIndex: 8, distanceKm: 135 }],
    };

    const features = buildRouteFeatures([ferryRouteLeg]).features;

    expect(features.map((feature) => feature.properties.kind)).toEqual(['road', 'ferry', 'road']);
    expect(features.map((feature) => feature.geometry.coordinates)).toEqual([
      coordinates.slice(0, 3),
      coordinates.slice(2, 9),
      coordinates.slice(8),
    ]);
    expect(features.every((feature) => feature.properties.status === 'review-required')).toBe(true);
  });

  it('retains a distinct map feature for manual Vehicle shipping', () => {
    const manualShippingLeg: RouteLeg = {
      ...routeLeg,
      id: 'route-manual-shipping',
      movement: 'vehicle-shipping',
      calculation: 'manual',
      status: 'manual',
    };

    expect(buildRouteFeatures([manualShippingLeg]).features[0].properties).toMatchObject({
      kind: 'manual',
      type: 'manual',
    });
  });

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

  beforeEach(() => {
    maplibreMock.Map.mockClear();
    maplibreMock.NavigationControl.mockClear();
    maplibreMock.mapInstances.length = 0;
    maplibreMock.resetSources();
    maplibreMock.setZoom(1.4);
    maplibreMock.setContainerSize(1280, 720);
    maplibreMock.project.mockClear();
    maplibreMock.project.mockImplementation(([lng, lat]: [number, number]) => ({
      x: lng * 10 + 1000,
      y: lat * -10 + 500,
    }));
  });

  it('renders destination pins as accessible buttons', () => {
    render(
      <MapCanvas
        destinations={[destination]}
        routeLegs={[]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Select Cappadocia' })).toBeInTheDocument();
  });

  it('fires onSelectDestination when a pin button is clicked', async () => {
    const onSelectDestination = vi.fn();

    render(
      <MapCanvas
        destinations={[destination]}
        routeLegs={[]}
        selectedDestinationId={null}
        onSelectDestination={onSelectDestination}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Select Cappadocia' }));

    expect(onSelectDestination).toHaveBeenCalledWith(destination.id);
  });

  it('fires onSelectDestination when a visible stop label is clicked', async () => {
    const onSelectDestination = vi.fn();

    render(
      <MapCanvas
        destinations={[destination]}
        routeLegs={[]}
        selectedDestinationId={null}
        onSelectDestination={onSelectDestination}
      />,
    );

    const map = maplibreMock.mapInstances[0];
    const loadHandler = map.on.mock.calls.find(([eventName]) => eventName === 'load')?.[1];
    const zoomEndHandler = map.on.mock.calls.find(([eventName]) => eventName === 'zoomend')?.[1];

    act(() => {
      loadHandler();
    });

    maplibreMock.setZoom(4);
    act(() => {
      zoomEndHandler();
    });

    await userEvent.click(screen.getByRole('button', { name: 'Open Cappadocia stop details' }));

    expect(onSelectDestination).toHaveBeenCalledWith(destination.id);
  });

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

  it('opens the add-stop menu when the map container receives a browser context menu event', async () => {
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
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      x: 100,
      y: 40,
      left: 100,
      top: 40,
      right: 900,
      bottom: 640,
      width: 800,
      height: 600,
      toJSON: () => ({}),
    });
    map.unproject.mockReturnValue({ lat: 35.0116, lng: 135.7681 });

    fireEvent.contextMenu(container, { clientX: 420, clientY: 220 });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Add stop here' }));

    expect(map.unproject).toHaveBeenCalledWith([320, 180]);
    expect(onRequestAddStop).toHaveBeenCalledWith({
      coordinates: { lat: 35.0116, lng: 135.7681 },
      screenPosition: { x: 320, y: 180 },
      source: 'context-menu',
    });
  });

  it('opens the add-stop menu from a secondary mouse pointer down on the map', async () => {
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
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      x: 100,
      y: 40,
      left: 100,
      top: 40,
      right: 900,
      bottom: 640,
      width: 800,
      height: 600,
      toJSON: () => ({}),
    });
    map.unproject.mockReturnValue({ lat: 35.0116, lng: 135.7681 });

    fireEvent.pointerDown(container, {
      button: 2,
      clientX: 420,
      clientY: 220,
      pointerType: 'mouse',
    });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Add stop here' }));

    expect(map.unproject).toHaveBeenCalledWith([320, 180]);
    expect(onRequestAddStop).toHaveBeenCalledWith({
      coordinates: { lat: 35.0116, lng: 135.7681 },
      screenPosition: { x: 320, y: 180 },
      source: 'context-menu',
    });
  });

  it('keeps the add-stop context menu inside the viewport near the bottom-right edge', () => {
    render(
      <MapCanvas
        destinations={[]}
        routeLegs={[]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
        onRequestAddStop={vi.fn()}
      />,
    );

    const map = maplibreMock.mapInstances[0];
    const contextMenuHandler = map.on.mock.calls.find(([eventName]) => eventName === 'contextmenu')?.[1];

    act(() => {
      contextMenuHandler({
        preventDefault: vi.fn(),
        lngLat: { lat: 51.0576, lng: -0.1342 },
        point: { x: 1000, y: 740 },
      });
    });

    const menu = screen.getByRole('menu');

    expect(menu).toHaveStyle({ left: '828px', top: '640px' });
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
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      x: 100,
      y: 40,
      left: 100,
      top: 40,
      right: 900,
      bottom: 640,
      width: 800,
      height: 600,
      toJSON: () => ({}),
    } as DOMRect);
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

    expect(map.unproject).toHaveBeenCalledWith([140, 180]);
    expect(onRequestAddStop).toHaveBeenCalledWith({
      coordinates: { lat: 35.0116, lng: 135.7681 },
      screenPosition: { x: 140, y: 180 },
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

  it('marks the selected pin', () => {
    render(
      <MapCanvas
        destinations={[destination]}
        routeLegs={[]}
        selectedDestinationId={destination.id}
        onSelectDestination={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Select Cappadocia' })).toHaveClass('is-selected');
  });

  it('leaves empty-trip messaging to the app shell', () => {
    render(
      <MapCanvas
        destinations={[]}
        routeLegs={[] as RouteLeg[]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
      />,
    );

    expect(screen.queryByText('Blank planning map')).not.toBeInTheDocument();
  });

  it('does not render the route leg count badge', () => {
    render(
      <MapCanvas
        destinations={[destination, targetDestination]}
        routeLegs={[routeLeg]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
      />,
    );

    expect(screen.queryByText('1 route leg')).not.toBeInTheDocument();
  });

  it('uses the quieter streets basemap style by default', () => {
    render(
      <MapCanvas
        destinations={[]}
        routeLegs={[]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
      />,
    );

    expect(maplibreMock.Map).toHaveBeenCalledWith(
      expect.objectContaining({
        style: expect.stringContaining('/maps/streets-v4/style.json'),
      }),
    );
  });

  it('hides noisy basemap layers and keeps enabled detail layers visible after style load', () => {
    render(
      <MapCanvas
        destinations={[]}
        routeLegs={[]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
      />,
    );

    const map = maplibreMock.mapInstances[0];
    const loadHandler = map.on.mock.calls.find(([eventName]) => eventName === 'load')?.[1];

    act(() => {
      loadHandler();
    });

    expect(map.setLayoutProperty).toHaveBeenCalledWith('poi-label', 'visibility', 'none');
    expect(map.setLayoutProperty).toHaveBeenCalledWith('mountain-peak-label', 'visibility', 'none');
    expect(map.setLayoutProperty).not.toHaveBeenCalledWith('country-label', 'visibility', 'none');
    expect(map.setLayoutProperty).toHaveBeenCalledWith('road_minor', 'visibility', 'none');
    expect(map.setLayoutProperty).toHaveBeenCalledWith('Water', 'visibility', 'visible');
    expect(map.setPaintProperty).not.toHaveBeenCalled();
  });

  it('adds transparent placeholders only for known missing MapTiler road sprites', () => {
    render(
      <MapCanvas
        destinations={[]}
        routeLegs={[]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
      />,
    );

    const map = maplibreMock.mapInstances[0];
    const imageMissingHandler = map.on.mock.calls.find(([eventName]) => eventName === 'styleimagemissing')?.[1];

    expect(imageMissingHandler).toBeTypeOf('function');

    act(() => {
      imageMissingHandler({ id: 'road_' });
      imageMissingHandler({ id: ' ' });
      imageMissingHandler({ id: 'poi_missing' });
    });

    expect(map.addImage).toHaveBeenCalledTimes(2);
    expect(map.addImage).toHaveBeenCalledWith(
      'road_',
      expect.objectContaining({
        width: 1,
        height: 1,
        data: expect.any(Uint8Array),
      }),
    );
    expect(map.addImage).toHaveBeenCalledWith(
      ' ',
      expect.objectContaining({
        width: 1,
        height: 1,
        data: expect.any(Uint8Array),
      }),
    );
    expect(map.addImage).not.toHaveBeenCalledWith('poi_missing', expect.anything());
  });

  it('adds focused activity sources and layers after the selected destination layer', () => {
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
    const loadHandler = map.on.mock.calls.find(([eventName]) => eventName === 'load')?.[1];
    const zoomEndHandler = map.on.mock.calls.find(([eventName]) => eventName === 'zoomend')?.[1];

    act(() => {
      loadHandler();
    });
    maplibreMock.setZoom(4);
    act(() => {
      zoomEndHandler();
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
      ]),
    );
    expect(layers.map((layer) => layer.id)).not.toContain('world-tour-activity-labels');
    expect(layers.find((layer) => layer.id === 'world-tour-selected-activity-halo')).toMatchObject({
      filter: ['==', ['get', 'selected'], true],
      paint: {
        'circle-color': 'rgba(217, 70, 122, 0.22)',
        'circle-radius': 16,
        'circle-stroke-color': '#d9467a',
        'circle-stroke-opacity': 0.34,
        'circle-stroke-width': 1,
      },
    });
    expect(layers.find((layer) => layer.id === 'world-tour-activity-points')).toMatchObject({
      type: 'circle',
      source: 'world-tour-focused-activities',
      paint: {
        'circle-color': '#d9467a',
        'circle-radius': ['case', ['get', 'selected'], 8, 7],
        'circle-stroke-color': '#111814',
        'circle-stroke-width': 2,
      },
    });

    const activityLabel = screen.getByRole('button', { name: 'Open Louvre Museum activity details' });
    expect(activityLabel).toHaveClass('map-destination-label', 'map-activity-label');
    expect(activityLabel).toHaveTextContent('Louvre Museum');
    expect(activityLabel).not.toHaveTextContent('01 -');
    fireEvent.click(activityLabel);
    expect(onSelectActivity).toHaveBeenCalledWith(louvreActivity.id);
  });

  it('hides lower-priority activity name pills only when below and above positions both clash', () => {
    const nearbyActivity: Activity = {
      ...louvreActivity,
      id: 'activity-nearby',
      order: 1,
      title: 'Tuileries Garden',
      location: {
        name: 'Tuileries Garden',
        address: 'Place de la Concorde, 75001 Paris, France',
        coordinates: { lat: 48.8608, lng: 2.3378 },
        sourceProvider: 'maptiler',
        sourceFeatureId: 'poi-tuileries',
      },
    };
    const thirdActivity: Activity = {
      ...louvreActivity,
      id: 'activity-third',
      order: 2,
      title: 'Carrousel Gallery',
      location: {
        name: 'Carrousel Gallery',
        address: '75001 Paris, France',
        coordinates: { lat: 48.8609, lng: 2.3379 },
        sourceProvider: 'maptiler',
        sourceFeatureId: 'poi-carrousel',
      },
    };

    render(
      <MapCanvas
        destinations={[destination]}
        routeLegs={[]}
        selectedDestinationId={destination.id}
        focusedActivities={[louvreActivity, nearbyActivity, thirdActivity]}
        selectedActivityId={null}
        onSelectDestination={vi.fn()}
        onSelectActivity={vi.fn()}
      />,
    );

    const map = maplibreMock.mapInstances[0];
    const loadHandler = map.on.mock.calls.find(([eventName]) => eventName === 'load')?.[1];
    const zoomEndHandler = map.on.mock.calls.find(([eventName]) => eventName === 'zoomend')?.[1];

    act(() => {
      loadHandler();
    });
    maplibreMock.setZoom(4);
    act(() => {
      zoomEndHandler();
    });

    expect(screen.getByRole('button', { name: 'Open Louvre Museum activity details' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Tuileries Garden activity details' })).toHaveClass(
      'map-label-position-above',
    );
    expect(screen.queryByRole('button', { name: 'Open Carrousel Gallery activity details' })).not.toBeInTheDocument();
  });

  it('flips an activity name pill above its pin when it would clash with the stop pill below', () => {
    const caveActivity: Activity = {
      ...louvreActivity,
      id: 'activity-cave',
      title: 'Cave Church',
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
        destinations={[destination]}
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

    act(() => {
      loadHandler();
    });
    maplibreMock.setZoom(4);
    act(() => {
      zoomEndHandler();
    });

    expect(screen.getByRole('button', { name: 'Open Cappadocia stop details' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Cave Church activity details' })).toHaveClass(
      'map-label-position-above',
    );
  });

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

  it('flips a nearby activity pill above its pin to display close activity labels together', () => {
    const firstActivity: Activity = {
      ...louvreActivity,
      id: 'activity-first',
      title: 'First Gallery',
      location: {
        name: 'First Gallery',
        address: 'Cappadocia, Turkey',
        coordinates: { lat: 40, lng: 0 },
        sourceProvider: 'maptiler',
        sourceFeatureId: 'poi-first',
      },
    };
    const secondActivity: Activity = {
      ...louvreActivity,
      id: 'activity-second',
      order: 1,
      title: 'Second Gallery',
      location: {
        name: 'Second Gallery',
        address: 'Cappadocia, Turkey',
        coordinates: { lat: 40.02, lng: 0.02 },
        sourceProvider: 'maptiler',
        sourceFeatureId: 'poi-second',
      },
    };

    render(
      <MapCanvas
        destinations={[destination]}
        routeLegs={[]}
        selectedDestinationId={destination.id}
        focusedActivities={[firstActivity, secondActivity]}
        selectedActivityId={null}
        onSelectDestination={vi.fn()}
        onSelectActivity={vi.fn()}
      />,
    );

    const map = maplibreMock.mapInstances[0];
    const loadHandler = map.on.mock.calls.find(([eventName]) => eventName === 'load')?.[1];
    const zoomEndHandler = map.on.mock.calls.find(([eventName]) => eventName === 'zoomend')?.[1];

    act(() => {
      loadHandler();
    });
    maplibreMock.setZoom(4);
    act(() => {
      zoomEndHandler();
    });

    expect(screen.getByRole('button', { name: 'Open First Gallery activity details' })).not.toHaveClass(
      'map-label-position-above',
    );
    expect(screen.getByRole('button', { name: 'Open Second Gallery activity details' })).toHaveClass(
      'map-label-position-above',
    );
  });

  it('keeps the selected activity pill visible when nearby activity pills collide', () => {
    const selectedNearbyActivity: Activity = {
      ...louvreActivity,
      id: 'activity-selected-nearby',
      order: 1,
      title: 'Tuileries Garden',
      location: {
        name: 'Tuileries Garden',
        address: 'Place de la Concorde, 75001 Paris, France',
        coordinates: { lat: 48.8608, lng: 2.3378 },
        sourceProvider: 'maptiler',
        sourceFeatureId: 'poi-tuileries',
      },
    };

    render(
      <MapCanvas
        destinations={[destination]}
        routeLegs={[]}
        selectedDestinationId={destination.id}
        focusedActivities={[louvreActivity, selectedNearbyActivity]}
        selectedActivityId={selectedNearbyActivity.id}
        onSelectDestination={vi.fn()}
        onSelectActivity={vi.fn()}
      />,
    );

    const map = maplibreMock.mapInstances[0];
    const loadHandler = map.on.mock.calls.find(([eventName]) => eventName === 'load')?.[1];
    const zoomEndHandler = map.on.mock.calls.find(([eventName]) => eventName === 'zoomend')?.[1];

    act(() => {
      loadHandler();
    });
    maplibreMock.setZoom(4);
    act(() => {
      zoomEndHandler();
    });

    expect(screen.getByRole('button', { name: 'Open Tuileries Garden activity details' })).toHaveClass('is-selected');
    expect(screen.getByRole('button', { name: 'Open Louvre Museum activity details' })).toHaveClass(
      'map-label-position-above',
    );
  });

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

  it('populates focused activity features only for selected-stop activities with coordinates', () => {
    const otherDestinationActivity = {
      ...louvreActivity,
      id: 'activity-other-destination',
      destinationId: targetDestination.id,
      order: 2,
      title: 'Wrong stop activity',
      location: {
        name: 'Wrong stop activity',
        address: 'Tbilisi, Georgia',
        coordinates: { lat: 41.7151, lng: 44.8271 },
        sourceProvider: 'maptiler' as const,
        sourceFeatureId: 'poi-wrong-stop',
      },
    };

    render(
      <MapCanvas
        destinations={[destination]}
        routeLegs={[]}
        selectedDestinationId={destination.id}
        focusedActivities={[louvreActivity, manualActivity, otherDestinationActivity]}
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

  it('renders development map detail controls for the selected zoom step', () => {
    render(
      <MapCanvas
        destinations={[]}
        routeLegs={[]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
      />,
    );

    expect(screen.getByRole('group', { name: 'Map detail by zoom' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Zoom step' })).toHaveValue('1');
    expect(screen.getByRole('slider', { name: 'Zoom step' })).toHaveAttribute('min', '1');
    expect(screen.getByRole('checkbox', { name: 'POIs' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Minor roads' })).not.toBeChecked();
  });

  it('syncs the selected zoom step when the map zoom changes outside the slider', async () => {
    render(
      <MapCanvas
        destinations={[]}
        routeLegs={[]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
      />,
    );

    const map = maplibreMock.mapInstances[0];
    const zoomEndHandler = map.on.mock.calls.find(([eventName]) => eventName === 'zoomend')?.[1];

    fireEvent.change(screen.getByRole('slider', { name: 'Zoom step' }), { target: { value: '8' } });
    await userEvent.click(screen.getByRole('checkbox', { name: 'POIs' }));
    fireEvent.change(screen.getByRole('slider', { name: 'Zoom step' }), { target: { value: '1' } });

    maplibreMock.setZoom(8.2);
    act(() => {
      zoomEndHandler();
    });

    expect(screen.getByRole('slider', { name: 'Zoom step' })).toHaveValue('8');
    expect(screen.getByRole('checkbox', { name: 'POIs' })).toBeChecked();
  });

  it('keeps the dev controls mounted when the map style is temporarily unavailable during zoom changes', () => {
    render(
      <MapCanvas
        destinations={[]}
        routeLegs={[]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
      />,
    );

    const map = maplibreMock.mapInstances[0];
    map.getStyle.mockReturnValue(undefined);

    fireEvent.change(screen.getByRole('slider', { name: 'Zoom step' }), { target: { value: '8' } });

    expect(screen.getByRole('group', { name: 'Map detail by zoom' })).toBeInTheDocument();
  });

  it('toggles basemap detail visibility for the selected zoom step', async () => {
    render(
      <MapCanvas
        destinations={[]}
        routeLegs={[]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
      />,
    );

    const map = maplibreMock.mapInstances[0];
    const loadHandler = map.on.mock.calls.find(([eventName]) => eventName === 'load')?.[1];

    act(() => {
      loadHandler();
    });

    await userEvent.click(screen.getByRole('checkbox', { name: 'POIs' }));

    expect(map.setLayoutProperty).toHaveBeenCalledWith('poi-label', 'visibility', 'visible');
  });

  it('keeps detail checkbox choices separate for each zoom step', async () => {
    render(
      <MapCanvas
        destinations={[]}
        routeLegs={[]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
      />,
    );

    const zoomSlider = screen.getByRole('slider', { name: 'Zoom step' });
    const poiCheckbox = screen.getByRole('checkbox', { name: 'POIs' });

    expect(poiCheckbox).not.toBeChecked();

    fireEvent.change(zoomSlider, { target: { value: '8' } });
    await userEvent.click(poiCheckbox);
    expect(poiCheckbox).toBeChecked();

    fireEvent.change(zoomSlider, { target: { value: '1' } });
    expect(screen.getByRole('checkbox', { name: 'POIs' })).not.toBeChecked();

    fireEvent.change(zoomSlider, { target: { value: '8' } });
    expect(screen.getByRole('checkbox', { name: 'POIs' })).toBeChecked();
  });

  it('shows a copyable JSON snapshot of the zoom detail settings', () => {
    render(
      <MapCanvas
        destinations={[]}
        routeLegs={[]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
      />,
    );

    expect(screen.getByText('Config JSON')).toBeInTheDocument();
    expect(screen.getByLabelText('Map detail settings JSON')).toHaveTextContent('"poi": false');
  });

  it('exposes broader MapTiler detail categories as checkboxes', () => {
    render(
      <MapCanvas
        destinations={[]}
        routeLegs={[]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
      />,
    );

    expect(screen.getByRole('checkbox', { name: 'Water' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Country labels' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Road labels' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Airports' })).toBeInTheDocument();
  });

  it('controls highways separately from major roads and capital labels separately from city labels', async () => {
    render(
      <MapCanvas
        destinations={[]}
        routeLegs={[]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
      />,
    );

    const map = maplibreMock.mapInstances[0];
    const loadHandler = map.on.mock.calls.find(([eventName]) => eventName === 'load')?.[1];

    act(() => {
      loadHandler();
    });

    fireEvent.change(screen.getByRole('slider', { name: 'Zoom step' }), { target: { value: '6' } });

    await userEvent.click(screen.getByRole('checkbox', { name: 'Highways' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Capital city labels' }));

    expect(map.setLayoutProperty).toHaveBeenCalledWith('Highway', 'visibility', 'none');
    expect(map.setLayoutProperty).toHaveBeenCalledWith('Major road', 'visibility', 'visible');
    expect(map.setLayoutProperty).toHaveBeenCalledWith('Capital city labels', 'visibility', 'none');
    expect(map.setLayoutProperty).toHaveBeenCalledWith('City labels', 'visibility', 'visible');
  });

  it('loads calibrated minimum detail settings for zoom levels 1 through 5', () => {
    render(
      <MapCanvas
        destinations={[]}
        routeLegs={[]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
      />,
    );

    expect(screen.getByRole('checkbox', { name: 'Water' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Rivers & streams' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Country labels' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Continent labels' })).toBeChecked();

    fireEvent.change(screen.getByRole('slider', { name: 'Zoom step' }), { target: { value: '4' } });
    expect(screen.getByRole('checkbox', { name: 'Regional borders' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Capital city labels' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'City labels' })).not.toBeChecked();

    fireEvent.change(screen.getByRole('slider', { name: 'Zoom step' }), { target: { value: '5' } });
    expect(screen.getByRole('checkbox', { name: 'Highways' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Capital city labels' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'City labels' })).toBeChecked();
  });

  it('loads recommended progressive detail settings for zoom levels 6 through 18', () => {
    render(
      <MapCanvas
        destinations={[]}
        routeLegs={[]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
      />,
    );

    const zoomSlider = screen.getByRole('slider', { name: 'Zoom step' });

    fireEvent.change(zoomSlider, { target: { value: '6' } });
    expect(screen.getByRole('checkbox', { name: 'Major roads' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Road labels' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Region labels' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Rivers & streams' })).not.toBeChecked();

    fireEvent.change(zoomSlider, { target: { value: '7' } });
    expect(screen.getByRole('checkbox', { name: 'Rivers & streams' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Terrain surfaces' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Town & place labels' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Minor roads' })).not.toBeChecked();

    fireEvent.change(zoomSlider, { target: { value: '8' } });
    expect(screen.getByRole('checkbox', { name: 'Minor roads' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Railways' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Airports' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Service roads' })).not.toBeChecked();

    fireEvent.change(zoomSlider, { target: { value: '9' } });
    expect(screen.getByRole('checkbox', { name: 'Service roads' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Residential areas' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Pedestrian areas' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Transit stops' })).not.toBeChecked();

    fireEvent.change(zoomSlider, { target: { value: '10' } });
    expect(screen.getByRole('checkbox', { name: 'Paths & cycleways' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Tracks' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Transit stops' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Parking' })).not.toBeChecked();

    fireEvent.change(zoomSlider, { target: { value: '11' } });
    expect(screen.getByRole('checkbox', { name: 'Parking' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Transport POIs' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Accommodation' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Food' })).not.toBeChecked();

    fireEvent.change(zoomSlider, { target: { value: '12' } });
    expect(screen.getByRole('checkbox', { name: 'Food' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Shopping' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Park labels' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Buildings' })).not.toBeChecked();

    fireEvent.change(zoomSlider, { target: { value: '13' } });
    expect(screen.getByRole('checkbox', { name: 'Buildings' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Road construction' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Steps' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Street furniture' })).not.toBeChecked();

    fireEvent.change(zoomSlider, { target: { value: '14' } });
    expect(screen.getByRole('checkbox', { name: 'Street furniture' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Mountain labels' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Aerialways' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Building numbers' })).not.toBeChecked();

    fireEvent.change(zoomSlider, { target: { value: '15' } });
    expect(screen.getByRole('checkbox', { name: 'Building numbers' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'House numbers' })).toBeChecked();

    fireEvent.change(zoomSlider, { target: { value: '18' } });
    expect(screen.getByRole('checkbox', { name: 'Building numbers' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'House numbers' })).toBeChecked();
  });

  it('steps zoom levels up and down with dedicated buttons', async () => {
    render(
      <MapCanvas
        destinations={[]}
        routeLegs={[]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
      />,
    );

    const map = maplibreMock.mapInstances[0];
    const zoomSlider = screen.getByRole('slider', { name: 'Zoom step' });
    const zoomOut = screen.getByRole('button', { name: 'Decrease zoom step' });
    const zoomIn = screen.getByRole('button', { name: 'Increase zoom step' });

    expect(zoomSlider).toHaveValue('1');
    expect(zoomOut).toBeDisabled();

    await userEvent.click(zoomIn);
    expect(zoomSlider).toHaveValue('2');
    expect(map.jumpTo).toHaveBeenLastCalledWith({ zoom: 2 });

    await userEvent.click(zoomOut);
    expect(zoomSlider).toHaveValue('1');
    expect(map.jumpTo).toHaveBeenLastCalledWith({ zoom: 1 });

    fireEvent.change(zoomSlider, { target: { value: '18' } });
    expect(zoomIn).toBeDisabled();
  });

  it('adds MapLibre sources and layers for destinations and routes', () => {
    render(
      <MapCanvas
        destinations={[destination, targetDestination]}
        routeLegs={[routeLeg]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
      />,
    );

    const map = maplibreMock.mapInstances[0];
    const loadHandler = map.on.mock.calls.find(([eventName]) => eventName === 'load')?.[1];

    act(() => {
      loadHandler();
    });

    expect(map.addSource).toHaveBeenCalledWith(
      'world-tour-destinations',
      expect.objectContaining({ type: 'geojson' }),
    );
    expect(map.addSource).toHaveBeenCalledWith(
      'world-tour-routes',
      expect.objectContaining({ type: 'geojson' }),
    );
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: 'world-tour-routes-line' }));
    const routeLayer = map.addLayer.mock.calls
      .map(([layer]) => layer)
      .find((layer) => layer.id === 'world-tour-routes-line');
    expect(routeLayer.paint['line-color'].flat(Infinity)).toEqual(
      expect.arrayContaining(['kind', 'ferry', 'manual', 'review-required']),
    );
    expect(routeLayer.paint['line-dasharray'].flat(Infinity)).toEqual(
      expect.arrayContaining(['manual', 2, 2, 'review-required', 3, 1]),
    );
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: 'world-tour-selected-destination-halo' }));
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: 'world-tour-destination-points' }));
    expect(screen.queryByText('1 route leg')).not.toBeInTheDocument();
  });

  it('uses an accent halo instead of changing the selected destination point color', () => {
    render(
      <MapCanvas
        destinations={[destination]}
        routeLegs={[]}
        selectedDestinationId={destination.id}
        onSelectDestination={vi.fn()}
      />,
    );

    const map = maplibreMock.mapInstances[0];
    const loadHandler = map.on.mock.calls.find(([eventName]) => eventName === 'load')?.[1];

    act(() => {
      loadHandler();
    });

    const layers = map.addLayer.mock.calls.map(([layer]) => layer);
    const selectedHaloLayer = layers.find((layer) => layer.id === 'world-tour-selected-destination-halo');
    const destinationPointsLayer = layers.find((layer) => layer.id === 'world-tour-destination-points');

    expect(layers.indexOf(selectedHaloLayer)).toBeLessThan(layers.indexOf(destinationPointsLayer));
    expect(selectedHaloLayer).toMatchObject({
      filter: ['==', ['get', 'selected'], true],
      paint: {
        'circle-color': 'rgba(217, 70, 122, 0.22)',
        'circle-stroke-color': '#d9467a',
      },
    });
    expect(destinationPointsLayer).toMatchObject({
      paint: {
        'circle-color': '#d9467a',
        'circle-radius': ['case', ['get', 'selected'], 8, 7],
      },
    });
  });

  it('renders the first destination stop label as the start label', () => {
    const nonOverlappingTargetDestination: Destination = {
      ...targetDestination,
      coordinates: {
        ...targetDestination.coordinates,
        lng: targetDestination.coordinates.lng + 10,
      },
    };

    render(
      <MapCanvas
        destinations={[destination, nonOverlappingTargetDestination]}
        routeLegs={[]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
      />,
    );

    const map = maplibreMock.mapInstances[0];
    const loadHandler = map.on.mock.calls.find(([eventName]) => eventName === 'load')?.[1];
    const zoomEndHandler = map.on.mock.calls.find(([eventName]) => eventName === 'zoomend')?.[1];

    act(() => {
      loadHandler();
    });

    maplibreMock.setZoom(4);
    act(() => {
      zoomEndHandler();
    });

    const destinationLabelLayer = map.addLayer.mock.calls
      .map(([layer]) => layer)
      .find((layer) => layer.id === 'world-tour-destination-labels');
    const startLabel = screen.getByText('ST - Cappadocia');
    const nextStopLabel = screen.getByText('02 - Tbilisi');

    expect(destinationLabelLayer).toBeUndefined();
    expect(startLabel).toHaveClass('map-destination-label');
    expect(nextStopLabel).toHaveClass('map-destination-label');
    expect(startLabel).not.toHaveClass('map-label-position-above');
    expect(nextStopLabel).not.toHaveClass('map-label-position-above');
    expect(Number.parseFloat(startLabel.style.left)).toBeCloseTo(1348.289);
    expect(Number.parseFloat(startLabel.style.top)).toBeCloseTo(113.569);
  });

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

  it('keeps vertically separated stop pills below when their rendered bounds do not overlap', () => {
    const verticallySeparatedDestination: Destination = {
      ...targetDestination,
      id: 'dest-vertical-gap',
      name: 'Vertical return',
      coordinates: {
        lat: destination.coordinates.lat + 3,
        lng: destination.coordinates.lng,
      },
    };

    render(
      <MapCanvas
        destinations={[destination, verticallySeparatedDestination]}
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

    expect(screen.getByRole('button', { name: 'Open Cappadocia stop details' })).not.toHaveClass(
      'map-label-position-above',
    );
    expect(screen.getByRole('button', { name: 'Open Vertical return stop details' })).not.toHaveClass(
      'map-label-position-above',
    );
  });

  it('hides destination stop labels until the map is zoomed into planning level', () => {
    render(
      <MapCanvas
        destinations={[destination]}
        routeLegs={[]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
      />,
    );

    const map = maplibreMock.mapInstances[0];
    const loadHandler = map.on.mock.calls.find(([eventName]) => eventName === 'load')?.[1];
    const zoomEndHandler = map.on.mock.calls.find(([eventName]) => eventName === 'zoomend')?.[1];

    act(() => {
      loadHandler();
    });

    expect(screen.queryByRole('button', { name: 'Open Cappadocia stop details' })).not.toBeInTheDocument();

    maplibreMock.setZoom(4);
    act(() => {
      zoomEndHandler();
    });

    expect(screen.getByRole('button', { name: 'Open Cappadocia stop details' })).toBeInTheDocument();
  });

  it('stores destinations and real route geometry in MapLibre sources', () => {
    render(
      <MapCanvas
        destinations={[destination, targetDestination]}
        routeLegs={[routeLeg]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
      />,
    );

    const map = maplibreMock.mapInstances[0];
    const loadHandler = map.on.mock.calls.find(([eventName]) => eventName === 'load')?.[1];

    act(() => {
      loadHandler();
    });

    const destinationSource = maplibreMock.getSource('world-tour-destinations');
    const routeSource = maplibreMock.getSource('world-tour-routes');
    const destinationData = destinationSource?.setData.mock.calls.at(-1)?.[0] as FeatureCollection<Point>;
    const routeData = routeSource?.setData.mock.calls.at(-1)?.[0] as FeatureCollection<LineString>;

    expect(destinationData.features).toHaveLength(2);
    expect(destinationData.features[0]).toMatchObject({
      id: destination.id,
      geometry: { type: 'Point', coordinates: [34.8289, 38.6431] },
      properties: { name: 'Cappadocia', selected: false },
    });
    expect(routeData.features).toHaveLength(1);
    expect(routeData.features[0]).toMatchObject({
      id: routeLeg.id,
      geometry: routeLeg.geometry,
      properties: { type: 'drive', status: 'ready' },
    });
  });

  it('selects destinations through the MapLibre destination layer', () => {
    const onSelectDestination = vi.fn();
    render(
      <MapCanvas
        destinations={[destination]}
        routeLegs={[]}
        selectedDestinationId={null}
        onSelectDestination={onSelectDestination}
      />,
    );

    const map = maplibreMock.mapInstances[0];
    const clickHandler = map.on.mock.calls.find(
      ([eventName, layerId]) =>
        eventName === 'click' && layerId === 'world-tour-destination-points',
    )?.[2];

    clickHandler({
      features: [{ properties: { id: destination.id } }],
    });

    expect(onSelectDestination).toHaveBeenCalledWith(destination.id);
  });

  it('does not render pending driving legs as rough straight-line route geometry', () => {
    const pendingLeg: RouteLeg = {
      ...routeLeg,
      id: 'route-pending',
      status: 'pending',
      geometry: undefined,
    };

    render(
      <MapCanvas
        destinations={[destination, targetDestination]}
        routeLegs={[pendingLeg]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
      />,
    );

    const map = maplibreMock.mapInstances[0];
    const loadHandler = map.on.mock.calls.find(([eventName]) => eventName === 'load')?.[1];

    act(() => {
      loadHandler();
    });

    const routeSource = maplibreMock.getSource('world-tour-routes');
    const routeData = routeSource?.setData.mock.calls.at(-1)?.[0] as FeatureCollection<LineString>;

    expect(routeData.features).toEqual([]);
  });

  it('fits the map to destinations when new stops are added', () => {
    const { rerender } = render(
      <MapCanvas
        destinations={[]}
        routeLegs={[]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
      />,
    );
    const map = maplibreMock.mapInstances[0];

    rerender(
      <MapCanvas
        destinations={[destination, targetDestination]}
        routeLegs={[]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
      />,
    );

    expect(map.fitBounds).toHaveBeenCalledWith(
      [
        [34.8289, 38.6431],
        [44.8271, 41.7151],
      ],
      expect.objectContaining({
        padding: 92,
        maxZoom: 6,
      }),
    );
  });

  it('fits to the selected stop and mappable activity coordinates when entering stop focus', () => {
    const otherDestinationActivity = {
      ...louvreActivity,
      id: 'activity-other-destination',
      destinationId: targetDestination.id,
      order: 2,
      title: 'Wrong stop activity',
      location: {
        name: 'Wrong stop activity',
        address: 'Tbilisi, Georgia',
        coordinates: { lat: 41.7151, lng: 44.8271 },
        sourceProvider: 'maptiler' as const,
        sourceFeatureId: 'poi-wrong-stop',
      },
    };

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
        focusedActivities={[louvreActivity, manualActivity, otherDestinationActivity]}
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

  it('clamps stop focus padding inside narrow map containers', () => {
    maplibreMock.setContainerSize(360, 220);

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
        focusedActivities={[louvreActivity]}
        selectedActivityId={null}
        onSelectDestination={vi.fn()}
        onSelectActivity={vi.fn()}
      />,
    );

    const padding = map.fitBounds.mock.lastCall?.[1].padding;

    expect(padding).toEqual(
      expect.objectContaining({
        top: expect.any(Number),
        right: expect.any(Number),
        bottom: expect.any(Number),
        left: expect.any(Number),
      }),
    );
    expect(padding.left + padding.right).toBeLessThan(360);
    expect(padding.top + padding.bottom).toBeLessThan(220);
    expect(padding.right).toBeGreaterThan(padding.left);
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

  it('focuses an initially selected stop after the map loads', () => {
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

  it('restores the route overview instead of startup camera when leaving initial stop focus', () => {
    const { rerender } = render(
      <MapCanvas
        destinations={[destination, targetDestination]}
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
    map.fitBounds.mockClear();
    map.easeTo.mockClear();

    rerender(
      <MapCanvas
        destinations={[destination, targetDestination]}
        routeLegs={[]}
        selectedDestinationId={null}
        focusedActivities={[]}
        selectedActivityId={null}
        onSelectDestination={vi.fn()}
        onSelectActivity={vi.fn()}
      />,
    );

    expect(map.fitBounds).toHaveBeenLastCalledWith(
      [
        [34.8289, 38.6431],
        [44.8271, 41.7151],
      ],
      expect.objectContaining({
        padding: 92,
        maxZoom: 6,
        duration: 700,
      }),
    );
    expect(map.easeTo).not.toHaveBeenCalled();
  });

  it('does not refit focused maps when equivalent destination and activity data rerenders', () => {
    const { rerender } = render(
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
    const fitCountAfterFocus = map.fitBounds.mock.calls.length;

    rerender(
      <MapCanvas
        destinations={[{ ...destination, coordinates: { ...destination.coordinates } }]}
        routeLegs={[]}
        selectedDestinationId={destination.id}
        focusedActivities={[{ ...louvreActivity, location: { ...louvreActivity.location! } }]}
        selectedActivityId={null}
        onSelectDestination={vi.fn()}
        onSelectActivity={vi.fn()}
      />,
    );

    expect(map.fitBounds).toHaveBeenCalledTimes(fitCountAfterFocus);
  });

  it('refits focused maps when activity coordinates materially change', () => {
    const movedActivity: Activity = {
      ...louvreActivity,
      location: {
        ...louvreActivity.location!,
        coordinates: { lat: 48.8738, lng: 2.295 },
      },
    };

    const { rerender } = render(
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
    const fitCountAfterFocus = map.fitBounds.mock.calls.length;

    rerender(
      <MapCanvas
        destinations={[destination]}
        routeLegs={[]}
        selectedDestinationId={destination.id}
        focusedActivities={[movedActivity]}
        selectedActivityId={null}
        onSelectDestination={vi.fn()}
        onSelectActivity={vi.fn()}
      />,
    );

    expect(map.fitBounds).toHaveBeenCalledTimes(fitCountAfterFocus + 1);
    expect(map.fitBounds).toHaveBeenLastCalledWith(
      [
        [2.295, 38.6431],
        [34.8289, 48.8738],
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

  it('clears the saved route viewport after restoring it when leaving focus', () => {
    const { rerender } = render(
      <MapCanvas
        destinations={[destination, targetDestination]}
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
        destinations={[destination, targetDestination]}
        routeLegs={[]}
        selectedDestinationId={destination.id}
        focusedActivities={[]}
        selectedActivityId={null}
        onSelectDestination={vi.fn()}
        onSelectActivity={vi.fn()}
      />,
    );
    rerender(
      <MapCanvas
        destinations={[destination, targetDestination]}
        routeLegs={[]}
        selectedDestinationId={null}
        focusedActivities={[]}
        selectedActivityId={null}
        onSelectDestination={vi.fn()}
        onSelectActivity={vi.fn()}
      />,
    );
    map.getCenter.mockReturnValue({ lng: 30, lat: 40 });
    map.getZoom.mockReturnValue(6.5);
    rerender(
      <MapCanvas
        destinations={[destination, targetDestination]}
        routeLegs={[]}
        selectedDestinationId={targetDestination.id}
        focusedActivities={[]}
        selectedActivityId={null}
        onSelectDestination={vi.fn()}
        onSelectActivity={vi.fn()}
      />,
    );
    rerender(
      <MapCanvas
        destinations={[destination, targetDestination]}
        routeLegs={[]}
        selectedDestinationId={null}
        focusedActivities={[]}
        selectedActivityId={null}
        onSelectDestination={vi.fn()}
        onSelectActivity={vi.fn()}
      />,
    );

    expect(map.easeTo).toHaveBeenLastCalledWith({
      center: [30, 40],
      zoom: 6.5,
      duration: 700,
    });
  });

  it('does not intercept map double-clicks so MapLibre can zoom normally', () => {
    render(
      <MapCanvas
        destinations={[]}
        routeLegs={[]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
      />,
    );

    const map = maplibreMock.mapInstances[0];

    expect(map.on).not.toHaveBeenCalledWith('dblclick', expect.any(Function));
  });

  it('uses MapTiler basemap labels instead of adding duplicate major city labels', () => {
    render(
      <MapCanvas
        destinations={[]}
        routeLegs={[]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
      />,
    );

    const map = maplibreMock.mapInstances[0];
    const loadHandler = map.on.mock.calls.find(([eventName]) => eventName === 'load')?.[1];

    act(() => {
      loadHandler();
    });

    expect(map.addSource).not.toHaveBeenCalledWith(
      'world-tour-major-cities',
      expect.objectContaining({ type: 'geojson' }),
    );
    expect(map.addLayer).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'world-tour-city-points' }));
    expect(map.addLayer).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'world-tour-city-labels' }));
  });

  it('removes the map on unmount', () => {
    const { unmount } = render(
      <MapCanvas
        destinations={[]}
        routeLegs={[]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
      />,
    );

    const map = maplibreMock.mapInstances[0];
    unmount();

    expect(map.remove).toHaveBeenCalled();
  });

  it('does not recreate the map when parent rerenders', () => {
    const { rerender } = render(
      <MapCanvas
        destinations={[]}
        routeLegs={[]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
      />,
    );

    rerender(
      <MapCanvas
        destinations={[]}
        routeLegs={[]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
      />,
    );

    expect(maplibreMock.Map).toHaveBeenCalledTimes(1);
  });
});
