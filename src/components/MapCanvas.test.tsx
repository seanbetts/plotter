import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  setData: Mock;
  fitBounds: Mock;
  project: Mock;
};

const maplibreMock = vi.hoisted(() => {
  const mapInstances: MockMap[] = [];
  let zoom = 1.4;
  const project = vi.fn(([lng, lat]: [number, number]) => ({ x: lng * 10 + 1000, y: lat * -10 + 500 }));
  const Map = vi.fn(function () {
    const map = {
      on: vi.fn(),
      off: vi.fn(),
      remove: vi.fn(),
      addControl: vi.fn(),
      getZoom: vi.fn(() => zoom),
      getSource: vi.fn(),
      addSource: vi.fn(),
      addLayer: vi.fn(),
      getLayer: vi.fn(),
      setData: vi.fn(),
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

  return { Map, NavigationControl, mapInstances, project, setZoom };
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
    type: 'driving',
    notes: '',
    createdAt: '2026-06-28T00:00:00.000Z',
    updatedAt: '2026-06-28T00:00:00.000Z',
  };

  beforeEach(() => {
    maplibreMock.Map.mockClear();
    maplibreMock.NavigationControl.mockClear();
    maplibreMock.mapInstances.length = 0;
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

  it('renders a route line and route count for a route leg', () => {
    const { container } = render(
      <MapCanvas
        destinations={[destination, targetDestination]}
        routeLegs={[routeLeg]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
      />,
    );

    expect(screen.getByText('1 route leg')).toBeInTheDocument();
    expect(container.querySelector('.route-line-driving')).toBeInTheDocument();
  });

  it('uses map projection for pin and route placement', () => {
    maplibreMock.project.mockImplementation(([lng, lat]: [number, number]) => ({ x: lng, y: lat }));

    const { container } = render(
      <MapCanvas
        destinations={[destination, targetDestination]}
        routeLegs={[routeLeg]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
      />,
    );

    const pin = screen.getByRole('button', { name: 'Select Cappadocia' });
    const route = container.querySelector('.route-line-driving');

    expect(maplibreMock.project).toHaveBeenCalledWith([destination.coordinates.lng, destination.coordinates.lat]);
    expect(pin).toHaveStyle({ left: '34.8289px', top: '38.6431px' });
    expect(route).toHaveAttribute('points', '34.8289,38.6431 44.8271,41.7151');
  });

  it('reprojects overlay positions on map move, zoom, and resize events', () => {
    render(
      <MapCanvas
        destinations={[destination]}
        routeLegs={[]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
      />,
    );

    const map = maplibreMock.mapInstances[0];
    const moveHandler = map.on.mock.calls.find(([eventName]) => eventName === 'move')?.[1];
    const zoomHandler = map.on.mock.calls.find(([eventName]) => eventName === 'zoom')?.[1];
    const resizeHandler = map.on.mock.calls.find(([eventName]) => eventName === 'resize')?.[1];

    maplibreMock.project.mockReturnValue({ x: 222, y: 333 });

    act(() => {
      moveHandler();
      zoomHandler();
      resizeHandler();
    });

    const pin = screen.getByRole('button', { name: 'Select Cappadocia' });
    expect(pin).toHaveStyle({ left: '222px', top: '333px' });
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

  it('shows major city labels after zooming in', () => {
    render(
      <MapCanvas
        destinations={[]}
        routeLegs={[]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
      />,
    );

    expect(screen.queryByText('London')).not.toBeInTheDocument();

    const map = maplibreMock.mapInstances[0];
    const zoomHandler = map.on.mock.calls.find(([eventName]) => eventName === 'zoom')?.[1];

    maplibreMock.setZoom(4);
    act(() => {
      zoomHandler();
    });

    expect(screen.getByText('London')).toBeInTheDocument();
    expect(screen.getByText('Istanbul')).toBeInTheDocument();
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
