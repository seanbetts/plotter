import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FeatureCollection, LineString, Point } from 'geojson';
import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Destination, RouteLeg } from '../domain/types';
import { MapCanvas } from './MapCanvas';

type MockMap = {
  on: Mock;
  off: Mock;
  remove: Mock;
  addControl: Mock;
  getZoom: Mock;
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
};

type MockGeoJsonSource = {
  setData: Mock;
};

const maplibreMock = vi.hoisted(() => {
  const mapInstances: MockMap[] = [];
  const sources = new globalThis.Map<string, MockGeoJsonSource>();
  let zoom = 1.4;
  const project = vi.fn(([lng, lat]: [number, number]) => ({ x: lng * 10 + 1000, y: lat * -10 + 500 }));
  const Map = vi.fn(function () {
    const map = {
      on: vi.fn(),
      off: vi.fn(),
      remove: vi.fn(),
      addControl: vi.fn(),
      getZoom: vi.fn(() => zoom),
      getSource: vi.fn((sourceId: string) => sources.get(sourceId)),
      addSource: vi.fn((sourceId: string) => {
        const source = { setData: vi.fn() };
        sources.set(sourceId, source);
      }),
      addLayer: vi.fn(),
      getLayer: vi.fn(),
      getStyle: vi.fn(() => ({
        layers: [
          { id: 'poi-label', type: 'symbol' },
          { id: 'mountain-peak-label', type: 'symbol' },
          { id: 'road_minor', type: 'line' },
          { id: 'road_major', type: 'line' },
          { id: 'country-label', type: 'symbol' },
        ],
      })),
      setLayoutProperty: vi.fn(),
      setPaintProperty: vi.fn(),
      getCanvas: vi.fn(() => ({ style: { cursor: '' } })),
      fitBounds: vi.fn(),
      project,
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
  const resetSources = () => {
    sources.clear();
  };
  const getSource = (sourceId: string) => sources.get(sourceId);

  return { Map, NavigationControl, mapInstances, project, setZoom, resetSources, getSource };
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
  };

  const routeLeg: RouteLeg = {
    id: 'route-1',
    originDestinationId: destination.id,
    targetDestinationId: targetDestination.id,
    type: 'driving-auto',
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

  beforeEach(() => {
    maplibreMock.Map.mockClear();
    maplibreMock.NavigationControl.mockClear();
    maplibreMock.mapInstances.length = 0;
    maplibreMock.resetSources();
    maplibreMock.setZoom(1.4);
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

  it('renders the empty planning map label with no destinations', () => {
    render(
      <MapCanvas
        destinations={[]}
        routeLegs={[] as RouteLeg[]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
      />,
    );

    expect(screen.getByText('Blank planning map')).toBeInTheDocument();
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

  it('hides noisy basemap layers and softens minor roads after style load', () => {
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
    expect(map.setPaintProperty).toHaveBeenCalledWith('road_minor', 'line-opacity', 0.32);
    expect(map.setPaintProperty).not.toHaveBeenCalledWith('road_major', 'line-opacity', expect.any(Number));
  });

  it('adds MapLibre sources and layers for destinations, routes, and major cities', () => {
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
    expect(map.addSource).toHaveBeenCalledWith(
      'world-tour-major-cities',
      expect.objectContaining({ type: 'geojson' }),
    );
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: 'world-tour-routes-line' }));
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: 'world-tour-destination-points' }));
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: 'world-tour-city-points' }));
    expect(screen.getByText('1 route leg')).toBeInTheDocument();
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
      properties: { type: 'driving-auto', status: 'ready' },
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

  it('keeps major cities in a MapLibre source with a minimum zoom layer', () => {
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

    const citySource = maplibreMock.getSource('world-tour-major-cities');
    const cityData = citySource?.setData.mock.calls.at(-1)?.[0] as FeatureCollection<Point>;

    expect(cityData.features.some((feature) => feature.properties?.name === 'London')).toBe(true);
    expect(map.addLayer).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'world-tour-city-labels',
        minzoom: 5,
      }),
    );
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
