import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { resolveMapTilerCoordinates, searchMapTilerPlaces } from './adapters/geocoding';
import { createDestination } from './domain/destinations';
import type { Destination, RouteLeg } from './domain/types';
import { createAppTripRepository } from './storage/appRepository';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

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

const maplibreMock = vi.hoisted(() => {
  const mapInstances: MockMap[] = [];
  const sources = new globalThis.Map<string, { setData: Mock }>();
  const project = vi.fn(([lng, lat]: [number, number]) => ({
    x: lng * 10 + 1000,
    y: lat * -10 + 500,
  }));
  const Map = vi.fn(function () {
    const map = {
      on: vi.fn(),
      off: vi.fn(),
      remove: vi.fn(),
      addControl: vi.fn(),
      getSource: vi.fn((sourceId: string) => sources.get(sourceId)),
      addSource: vi.fn((sourceId: string) => {
        sources.set(sourceId, { setData: vi.fn() });
      }),
      getLayer: vi.fn(),
      addLayer: vi.fn(),
      getCanvas: vi.fn(() => ({ style: { cursor: '' } })),
      getZoom: vi.fn(() => 1.4),
      getCenter: vi.fn(() => ({ lat: 24, lng: 18 })),
      unproject: vi.fn(([x, y]: [number, number]) => ({ lng: (x - 1000) / 10, lat: (500 - y) / 10 })),
      project,
    };
    mapInstances.push(map);
    return map;
  });
  const NavigationControl = vi.fn(function () {
    return {};
  });
  const resetSources = () => {
    sources.clear();
  };

  return { Map, NavigationControl, mapInstances, project, resetSources };
});

const repositoryMock = vi.hoisted(() => {
  const repository = {
    destinations: [] as Destination[],
    routeLegs: [] as RouteLeg[],
    initialDestinations: Promise.resolve([] as Destination[]),
    initialRouteLegs: Promise.resolve([] as RouteLeg[]),
    listDestinations: vi.fn(async () => repository.initialDestinations),
    saveDestination: vi.fn(async (destination: Destination) => {
      repository.destinations.push(destination);
    }),
    deleteDestination: vi.fn(async (destinationId: string) => {
      repository.destinations = repository.destinations.filter((destination) => destination.id !== destinationId);
      repository.routeLegs = repository.routeLegs.filter(
        (leg) => leg.originDestinationId !== destinationId && leg.targetDestinationId !== destinationId,
      );
    }),
    listRouteLegs: vi.fn(async () => repository.initialRouteLegs),
    saveRouteLeg: vi.fn(async (routeLeg: RouteLeg) => {
      repository.routeLegs.push(routeLeg);
    }),
    deleteRouteLeg: vi.fn(async (routeLegId: string) => {
      repository.routeLegs = repository.routeLegs.filter((routeLeg) => routeLeg.id !== routeLegId);
    }),
    replaceTripData: vi.fn(async (snapshot: { destinations: Destination[]; routeLegs: RouteLeg[] }) => {
      repository.destinations = [...snapshot.destinations];
      repository.routeLegs = [...snapshot.routeLegs];
    }),
    listDestinationMedia: vi.fn(async () => []),
    uploadDestinationMedia: vi.fn(),
  };

  return repository;
});

vi.mock('./storage/appRepository', () => ({
  createAppTripRepository: vi.fn(async () => repositoryMock),
}));

vi.mock('./adapters/geocoding', () => ({
  resolveMapTilerCoordinates: vi.fn(),
  searchMapTilerPlaces: vi.fn(),
}));

vi.mock('maplibre-gl', () => ({
  default: {
    Map: maplibreMock.Map,
    NavigationControl: maplibreMock.NavigationControl,
  },
}));

describe('App', () => {
  beforeEach(() => {
    repositoryMock.destinations = [];
    repositoryMock.routeLegs = [];
    repositoryMock.initialDestinations = Promise.resolve([]);
    repositoryMock.initialRouteLegs = Promise.resolve([]);
    repositoryMock.listDestinations.mockClear();
    repositoryMock.saveDestination.mockClear();
    repositoryMock.deleteDestination.mockClear();
    repositoryMock.listRouteLegs.mockClear();
    repositoryMock.saveRouteLeg.mockClear();
    repositoryMock.deleteRouteLeg.mockClear();
    repositoryMock.replaceTripData.mockClear();
    repositoryMock.listDestinationMedia.mockClear();
    repositoryMock.uploadDestinationMedia.mockClear();
    vi.mocked(createAppTripRepository).mockResolvedValue(repositoryMock);
    vi.mocked(searchMapTilerPlaces).mockReset();
    vi.mocked(resolveMapTilerCoordinates).mockReset();
    maplibreMock.Map.mockClear();
    maplibreMock.NavigationControl.mockClear();
    maplibreMock.mapInstances.length = 0;
    maplibreMock.resetSources();
    maplibreMock.project.mockClear();
    vi.unstubAllGlobals();
  });

  it('shows a storage bootstrap error when the app repository cannot be prepared', async () => {
    vi.mocked(createAppTripRepository).mockRejectedValue(new Error('Unable to create an anonymous Supabase session.'));

    render(<App />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Trip storage unavailable');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Unable to create an anonymous Supabase session.',
    );
    expect(screen.queryByLabelText('Search for a destination')).not.toBeInTheDocument();
  });

  it('shows Supabase setup guidance when storage configuration is missing', async () => {
    vi.mocked(createAppTripRepository).mockRejectedValue(
      new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.'),
    );

    render(<App />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Supabase is not configured');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.',
    );
  });

  it('adds a searched destination without opening its profile after trip data loads', async () => {
    vi.mocked(searchMapTilerPlaces).mockResolvedValue([
      {
        kind: 'place',
        id: 'place-kyoto',
        label: 'Kyoto, Japan',
        coordinates: { lat: 35.0116, lng: 135.7681 },
        location: {
          placeName: 'Kyoto',
          regionName: '',
          countryName: 'Japan',
          sourceLabel: 'Kyoto, Japan',
          sourceProvider: 'maptiler',
          sourceFeatureId: 'place-kyoto',
        },
      },
    ]);

    render(<App />);

    await waitFor(() => expect(screen.queryByText('Loading trip data')).not.toBeInTheDocument());

    await userEvent.type(screen.getByLabelText('Search for a destination'), 'Kyoto');
    await userEvent.click(await screen.findByRole('option', { name: 'Kyoto, Japan' }));

    expect(searchMapTilerPlaces).toHaveBeenCalledWith('Kyoto', { apiKey: expect.any(String) });
    expect(await screen.findByRole('button', { name: 'Kyoto, Japan' })).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Kyoto profile' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select Kyoto' })).not.toHaveClass('is-selected');
  });

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
    await waitFor(() => expect(maplibreMock.mapInstances.length).toBeGreaterThan(0));

    const map = maplibreMock.mapInstances.at(-1)!;
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
    await waitFor(() => expect(maplibreMock.mapInstances.length).toBeGreaterThan(0));

    const map = maplibreMock.mapInstances.at(-1)!;
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
    await waitFor(() => expect(maplibreMock.mapInstances.length).toBeGreaterThan(0));
    maplibreMock.mapInstances.at(-1)!.getCenter.mockReturnValue({ lat: 48.8566, lng: 2.3522 });

    await userEvent.click(screen.getByRole('button', { name: 'Add stop at map center' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Add stop' }));

    expect(await screen.findByRole('complementary', { name: 'Paris profile' })).toBeInTheDocument();
  });

  it('closes the selected destination profile with Escape', async () => {
    const user = userEvent.setup();
    const destination = createDestination({
      name: 'Balcombe',
      countryRegion: 'United Kingdom',
      coordinates: { lat: 51.0576, lng: -0.1342 },
    });
    repositoryMock.initialDestinations = Promise.resolve([destination]);

    render(<App />);

    await waitFor(() => expect(screen.queryByText('Loading trip data')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Balcombe, United Kingdom' }));
    expect(screen.getByRole('complementary', { name: 'Balcombe profile' })).toBeInTheDocument();
    expect(screen.getByText('Stop 01')).toBeInTheDocument();

    const wasNotCanceled = fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });

    expect(wasNotCanceled).toBe(false);
    expect(screen.queryByRole('complementary', { name: 'Balcombe profile' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Balcombe, United Kingdom' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('keeps mutation actions unavailable while trip data is loading', async () => {
    const initialDestinations = createDeferred<Destination[]>();
    const initialRouteLegs = createDeferred<RouteLeg[]>();
    repositoryMock.initialDestinations = initialDestinations.promise;
    repositoryMock.initialRouteLegs = initialRouteLegs.promise;

    render(<App />);

    expect(screen.getByText('Loading trip data')).toBeInTheDocument();
    expect(screen.queryByLabelText('Search for a destination')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add stop at map center' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export trip data' })).not.toBeInTheDocument();

    await waitFor(() => expect(maplibreMock.mapInstances).toHaveLength(1));
    const doubleClickHandler = maplibreMock.mapInstances[0].on.mock.calls.find(
      ([eventName]) => eventName === 'dblclick',
    )?.[1];
    expect(doubleClickHandler).toBeUndefined();

    expect(repositoryMock.saveDestination).not.toHaveBeenCalled();

    initialDestinations.resolve([]);
    initialRouteLegs.resolve([]);
    await waitFor(() => expect(screen.queryByText('Loading trip data')).not.toBeInTheDocument());
    expect(screen.getByLabelText('Search for a destination')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export trip data' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Import trip data' })).not.toBeInTheDocument();
  });
});

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}
