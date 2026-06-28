import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { searchNominatimPlaces } from './adapters/geocoding';
import type { Destination, RouteLeg } from './domain/types';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

type MockMap = {
  on: Mock;
  off: Mock;
  remove: Mock;
  addControl: Mock;
  getZoom: Mock;
  project: Mock;
};

const maplibreMock = vi.hoisted(() => {
  const mapInstances: MockMap[] = [];
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
      getZoom: vi.fn(() => 1.4),
      project,
    };
    mapInstances.push(map);
    return map;
  });
  const NavigationControl = vi.fn(function () {
    return {};
  });

  return { Map, NavigationControl, mapInstances, project };
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
  };

  return repository;
});

vi.mock('./storage/tripDb', () => ({
  tripDb: {},
}));

vi.mock('./storage/tripRepository', () => ({
  createTripRepository: vi.fn(() => repositoryMock),
}));

vi.mock('./adapters/geocoding', () => ({
  searchNominatimPlaces: vi.fn(),
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
    vi.mocked(searchNominatimPlaces).mockReset();
    maplibreMock.Map.mockClear();
    maplibreMock.NavigationControl.mockClear();
    maplibreMock.mapInstances.length = 0;
    maplibreMock.project.mockClear();
    vi.unstubAllGlobals();
  });

  it('adds a searched destination and opens its profile after trip data loads', async () => {
    vi.mocked(searchNominatimPlaces).mockResolvedValue([
      {
        id: 'place-kyoto',
        label: 'Kyoto, Japan',
        countryRegion: 'Japan',
        coordinates: { lat: 35.0116, lng: 135.7681 },
      },
    ]);

    render(<App />);

    await waitFor(() => expect(screen.queryByText('Loading trip data')).not.toBeInTheDocument());

    await userEvent.type(screen.getByLabelText('Search for a destination'), 'Kyoto');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Add Kyoto, Japan' }));

    expect(searchNominatimPlaces).toHaveBeenCalledWith('Kyoto');
    expect(await screen.findByRole('complementary', { name: 'Kyoto profile' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Kyoto' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select Kyoto' })).toHaveClass('is-selected');
  });

  it('keeps mutation and export actions unavailable while trip data is loading', async () => {
    const initialDestinations = createDeferred<Destination[]>();
    const initialRouteLegs = createDeferred<RouteLeg[]>();
    repositoryMock.initialDestinations = initialDestinations.promise;
    repositoryMock.initialRouteLegs = initialRouteLegs.promise;
    const createObjectUrl = vi.fn(() => 'blob:trip-data');
    const revokeObjectUrl = vi.fn();
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: createObjectUrl,
      revokeObjectURL: revokeObjectUrl,
    });

    render(<App />);

    expect(screen.getByText('Loading trip data')).toBeInTheDocument();
    expect(screen.queryByLabelText('Search for a destination')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export trip data' })).not.toBeInTheDocument();

    await waitFor(() => expect(maplibreMock.mapInstances).toHaveLength(1));
    const doubleClickHandler = maplibreMock.mapInstances[0].on.mock.calls.find(
      ([eventName]) => eventName === 'dblclick',
    )?.[1];
    expect(doubleClickHandler).toBeUndefined();

    expect(repositoryMock.saveDestination).not.toHaveBeenCalled();
    expect(createObjectUrl).not.toHaveBeenCalled();

    initialDestinations.resolve([]);
    initialRouteLegs.resolve([]);
    await waitFor(() => expect(screen.queryByText('Loading trip data')).not.toBeInTheDocument());
    expect(screen.getByLabelText('Search for a destination')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export trip data' })).toBeInTheDocument();
  });

  it('locks mutation and export actions while imported trip data is replacing storage', async () => {
    const user = userEvent.setup();
    const replaceTripData = createDeferred<void>();
    repositoryMock.replaceTripData.mockImplementationOnce(async (snapshot) => {
      repositoryMock.destinations = [...snapshot.destinations];
      repositoryMock.routeLegs = [...snapshot.routeLegs];
      await replaceTripData.promise;
    });
    const createObjectUrl = vi.fn(() => 'blob:trip-data');
    const revokeObjectUrl = vi.fn();
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: createObjectUrl,
      revokeObjectURL: revokeObjectUrl,
    });
    const importedDestination = createDestinationSnapshot('dest-imported', 'Lisbon');
    const importFile = new File(
      [
        JSON.stringify({
          version: 1,
          exportedAt: '2026-06-28T00:00:00.000Z',
          destinations: [importedDestination],
          routeLegs: [],
        }),
      ],
      'world-tour-planner.json',
      { type: 'application/json' },
    );

    render(<App />);

    await waitFor(() => expect(screen.queryByText('Loading trip data')).not.toBeInTheDocument());
    await user.upload(screen.getByLabelText('Trip data import file'), importFile);
    await waitFor(() => expect(repositoryMock.replaceTripData).toHaveBeenCalled());

    expect(screen.queryByRole('button', { name: 'Export trip data' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Search for a destination')).not.toBeInTheDocument();
    expect(createObjectUrl).not.toHaveBeenCalled();

    replaceTripData.resolve();
    await waitFor(() => expect(screen.queryByText('Loading trip data')).not.toBeInTheDocument());
    expect(screen.getByLabelText('Search for a destination')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export trip data' })).toBeInTheDocument();
  });
});

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}

function createDestinationSnapshot(id: string, name: string): Destination {
  return {
    id,
    name,
    countryRegion: 'Portugal',
    coordinates: { lat: 38.7223, lng: -9.1393 },
    order: 0,
    status: 'idea',
    priority: 'medium',
    timing: {
      idealMonths: [],
      expectedStayDays: 3,
      provisionalStartDate: '',
      provisionalEndDate: '',
    },
    why: {
      summary: '',
      highlights: '',
      personalRationale: '',
    },
    media: [],
    research: {
      notes: '',
      links: [],
      bookReferences: [],
    },
    activities: {
      items: [],
    },
    routeContext: {
      previousNextNotes: '',
      drivingNotes: '',
      borderShippingNotes: '',
      notes: '',
    },
    tags: [],
    createdAt: '2026-06-28T00:00:00.000Z',
    updatedAt: '2026-06-28T00:00:00.000Z',
  };
}
