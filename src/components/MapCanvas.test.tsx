import { act, fireEvent, render, screen } from '@testing-library/react';
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
      getCenter: vi.fn(() => ({ lat: 24, lng: 18 })),
      unproject: vi.fn(([x, y]: [number, number]) => ({ lng: (x - 1000) / 10, lat: (500 - y) / 10 })),
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
      getCanvas: vi.fn(() => ({ style: { cursor: '' } })),
      fitBounds: vi.fn(),
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

    expect(screen.getByText('Blank planning map')).toHaveClass('map-empty-label', 'is-prominent');
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

  it('renders destination stop labels as positioned pill overlays', () => {
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

    maplibreMock.setZoom(4);
    act(() => {
      zoomEndHandler();
    });

    const destinationLabelLayer = map.addLayer.mock.calls
      .map(([layer]) => layer)
      .find((layer) => layer.id === 'world-tour-destination-labels');
    const stopLabel = screen.getByText('1. Cappadocia');

    expect(destinationLabelLayer).toBeUndefined();
    expect(stopLabel).toHaveClass('map-destination-label');
    expect(Number.parseFloat(stopLabel.style.left)).toBeCloseTo(1348.289);
    expect(Number.parseFloat(stopLabel.style.top)).toBeCloseTo(113.569);
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
