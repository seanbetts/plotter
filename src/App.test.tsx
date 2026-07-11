import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { resolveMapTilerCoordinates, searchMapTilerPlaces } from './adapters/geocoding';
import {
  calculateOpenRouteServiceRoute,
  calculateOpenRouteServiceRouteOptions,
} from './adapters/openRouteService';
import { createActivity } from './domain/activities';
import { createDestination } from './domain/destinations';
import { createRouteLeg } from './domain/routeLegs';
import type { RouteOption } from './domain/routeOptions';
import type { Activity, ActivityLocation, Destination, MediaItem, MediaRollupItem, RouteLeg } from './domain/types';
import { resolveVehiclePreset, standardRoutingVehicle } from './domain/vehiclePresets';
import { useTripWorkspace } from './hooks/useTripWorkspace';
import { downloadTripMap } from './map/tripMapExport';
import { createAppLinkPreviewClient } from './services/linkPreviewClient';
import { createAppWebImageSearchClient } from './services/webImageSearchClient';
import type { WebImageSearchClient, WebImageSearchResult } from './services/webImageSearchClient';
import type { TripRepository } from './storage/tripRepository';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
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
  getContainer: Mock;
  getZoom: Mock;
  getCenter: Mock;
  fitBounds: Mock;
  easeTo: Mock;
  unproject: Mock;
  project: Mock;
};

type CreateActivityInput = {
  destinationId: string;
  title: string;
  location?: ActivityLocation;
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
      getContainer: vi.fn(() => ({
        clientWidth: 1280,
        clientHeight: 720,
        getBoundingClientRect: () => ({ width: 1280, height: 720 }),
      })),
      getZoom: vi.fn(() => 1.4),
      getCenter: vi.fn(() => ({ lat: 24, lng: 18 })),
      fitBounds: vi.fn(),
      easeTo: vi.fn(),
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
    listActivities: vi.fn<TripRepository['listActivities']>(async () => []),
    createActivity: vi.fn(async (input: CreateActivityInput): Promise<Activity> => ({
      id: 'activity-mock',
      destinationId: input.destinationId,
      order: 0,
      title: input.title,
      description: '',
      category: 'other',
      status: 'idea',
      priority: 'medium',
      links: [],
      notes: '',
      tags: [],
      location: input.location,
      createdAt: '2026-07-03T12:00:00.000Z',
      updatedAt: '2026-07-03T12:00:00.000Z',
    })),
    updateActivity: vi.fn(async (): Promise<Activity> => ({
      id: 'activity-mock',
      destinationId: 'destination-mock',
      order: 0,
      title: 'Updated activity',
      description: '',
      category: 'other',
      status: 'idea',
      priority: 'medium',
      links: [],
      notes: '',
      tags: [],
      createdAt: '2026-07-03T12:00:00.000Z',
      updatedAt: '2026-07-03T12:00:01.000Z',
    })),
    deleteActivity: vi.fn(async (): Promise<void> => undefined),
    reorderActivities: vi.fn(async (): Promise<Activity[]> => []),
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
    listDestinationMedia: vi.fn<TripRepository['listDestinationMedia']>(async () => []),
    uploadDestinationMedia: vi.fn(),
    importDestinationMediaFromSearch: vi.fn(),
    updateDestinationMedia: vi.fn(),
    deleteDestinationMedia: vi.fn(),
    reorderDestinationMedia: vi.fn(),
    listDestinationMediaRollup: vi.fn<TripRepository['listDestinationMediaRollup']>(async () => []),
    listActivityMedia: vi.fn(async (): Promise<MediaItem[]> => []),
    uploadActivityMedia: vi.fn(),
    importActivityMediaFromSearch: vi.fn(),
    updateActivityMedia: vi.fn(),
    deleteActivityMedia: vi.fn(),
    reorderActivityMedia: vi.fn(),
  };

  return repository;
});

const linkPreviewClientMock = vi.hoisted(() => ({
  fetchPreview: vi.fn(async () => ({
    url: 'https://example.com',
    title: 'Example',
    domain: 'example.com',
  })),
}));

const defaultWebImageSearchClientMock = vi.hoisted(() => ({
  searchImages: vi.fn(async () => []),
}));

const tripsMock = [
  {
    id: 'trip-one',
    name: 'World tour',
    description: '',
    routingVehicle: standardRoutingVehicle,
    createdAt: '2026-07-01T10:00:00.000Z',
    updatedAt: '2026-07-01T10:00:00.000Z',
  },
  {
    id: 'trip-two',
    name: 'Japan winter',
    description: '',
    routingVehicle: standardRoutingVehicle,
    createdAt: '2026-07-02T10:00:00.000Z',
    updatedAt: '2026-07-02T10:00:00.000Z',
  },
];

function mockTripWorkspace(overrides: Partial<ReturnType<typeof useTripWorkspace>> = {}) {
  vi.mocked(useTripWorkspace).mockReturnValue({
    trips: tripsMock,
    activeTrip: tripsMock[0],
    repository: repositoryMock,
    isLoading: false,
    error: null,
    actionError: null,
    selectTrip: vi.fn(),
    createTrip: vi.fn(),
    updateTrip: vi.fn(),
    deleteTrip: vi.fn(),
    refreshTrips: vi.fn(),
    realtime: null,
    ...overrides,
  } as ReturnType<typeof useTripWorkspace>);
}

vi.mock('./hooks/useTripWorkspace', () => ({
  useTripWorkspace: vi.fn(),
}));

vi.mock('./map/tripMapExport', () => ({ downloadTripMap: vi.fn() }));

vi.mock('./services/linkPreviewClient', () => ({
  createAppLinkPreviewClient: vi.fn(() => linkPreviewClientMock),
}));

vi.mock('./services/webImageSearchClient', () => ({
  createAppWebImageSearchClient: vi.fn(() => defaultWebImageSearchClientMock),
}));

vi.mock('./adapters/geocoding', () => ({
  createBoundingBoxAroundCoordinates: vi.fn(() => [0.9869, 47.9583, 3.7175, 49.7549]),
  resolveMapTilerCoordinates: vi.fn(),
  searchMapTilerPlaces: vi.fn(),
}));

vi.mock('./adapters/openRouteService', () => ({
  calculateOpenRouteServiceRoute: vi.fn(async () => ({
    distanceKm: 160,
    travelTimeHours: 2.25,
    geometry: {
      type: 'LineString',
      coordinates: [
        [28.9784, 41.0082],
        [44.8271, 41.7151],
      ],
    },
    provider: 'openrouteservice',
    profile: 'driving-car',
    sections: [{ kind: 'road', startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 160 }],
  })),
  calculateOpenRouteServiceRouteOptions: vi.fn(async () => [
    {
      id: 'recommended',
      label: 'Recommended',
      source: 'recommended',
      distanceKm: 160,
      travelTimeHours: 2.25,
      geometry: {
        type: 'LineString',
        coordinates: [
          [28.9784, 41.0082],
          [44.8271, 41.7151],
        ],
      },
      provider: 'openrouteservice',
      profile: 'driving-car',
      routeKey: 'recommended-route-key',
      sections: [{ kind: 'road', startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 160 }],
    },
    {
      id: 'avoid-highways',
      label: 'Avoid highways',
      source: 'avoid-feature',
      distanceKm: 220,
      travelTimeHours: 3.4,
      geometry: {
        type: 'LineString',
        coordinates: [
          [28.9784, 41.0082],
          [34.5, 40.9],
          [44.8271, 41.7151],
        ],
      },
      provider: 'openrouteservice',
      profile: 'driving-car',
      routeKey: 'avoid-highways-route-key',
      sections: [{ kind: 'road', startGeometryIndex: 0, endGeometryIndex: 2, distanceKm: 220 }],
    },
  ]),
}));

vi.mock('maplibre-gl', () => ({
  default: {
    Map: maplibreMock.Map,
    NavigationControl: maplibreMock.NavigationControl,
  },
}));

async function waitForTripReady() {
  await waitFor(() => expect(screen.queryByText('Loading world tour')).not.toBeInTheDocument());
}

describe('App', () => {
  beforeEach(() => {
    repositoryMock.destinations = [];
    repositoryMock.routeLegs = [];
    repositoryMock.initialDestinations = Promise.resolve([]);
    repositoryMock.initialRouteLegs = Promise.resolve([]);
    repositoryMock.listDestinations.mockClear();
    repositoryMock.listDestinations.mockImplementation(async () => repositoryMock.initialDestinations);
    repositoryMock.saveDestination.mockClear();
    repositoryMock.saveDestination.mockImplementation(async (destination: Destination) => {
      repositoryMock.destinations.push(destination);
    });
    repositoryMock.deleteDestination.mockClear();
    repositoryMock.listActivities.mockClear();
    repositoryMock.listActivities.mockImplementation(async () => []);
    repositoryMock.createActivity.mockClear();
    repositoryMock.createActivity.mockImplementation(async (input: CreateActivityInput) =>
      createActivity({ ...input, order: 0 }),
    );
    repositoryMock.updateActivity.mockClear();
    repositoryMock.updateActivity.mockImplementation(async () => {
      throw new Error('updateActivity mock implementation was not configured');
    });
    repositoryMock.deleteActivity.mockClear();
    repositoryMock.deleteActivity.mockImplementation(async () => undefined);
    repositoryMock.reorderActivities.mockClear();
    repositoryMock.reorderActivities.mockImplementation(async () => []);
    repositoryMock.listRouteLegs.mockClear();
    repositoryMock.listRouteLegs.mockImplementation(async () => repositoryMock.initialRouteLegs);
    repositoryMock.saveRouteLeg.mockClear();
    repositoryMock.deleteRouteLeg.mockClear();
    repositoryMock.replaceTripData.mockClear();
    repositoryMock.listDestinationMedia.mockClear();
    repositoryMock.listDestinationMedia.mockImplementation(async () => []);
    repositoryMock.uploadDestinationMedia.mockClear();
    repositoryMock.importDestinationMediaFromSearch.mockClear();
    repositoryMock.updateDestinationMedia.mockClear();
    repositoryMock.deleteDestinationMedia.mockClear();
    repositoryMock.reorderDestinationMedia.mockClear();
    repositoryMock.listDestinationMediaRollup.mockClear();
    repositoryMock.listDestinationMediaRollup.mockImplementation(async () => []);
    repositoryMock.listActivityMedia.mockClear();
    repositoryMock.listActivityMedia.mockImplementation(async () => []);
    repositoryMock.uploadActivityMedia.mockClear();
    repositoryMock.updateActivityMedia.mockClear();
    repositoryMock.deleteActivityMedia.mockClear();
    repositoryMock.reorderActivityMedia.mockClear();
    mockTripWorkspace();
    linkPreviewClientMock.fetchPreview.mockReset();
    linkPreviewClientMock.fetchPreview.mockResolvedValue({
      url: 'https://example.com',
      title: 'Example',
      domain: 'example.com',
    });
    vi.mocked(createAppLinkPreviewClient).mockReset();
    vi.mocked(createAppLinkPreviewClient).mockReturnValue(linkPreviewClientMock);
    vi.mocked(createAppWebImageSearchClient).mockReset();
    vi.mocked(createAppWebImageSearchClient).mockReturnValue(defaultWebImageSearchClientMock);
    defaultWebImageSearchClientMock.searchImages.mockReset().mockResolvedValue([]);
    vi.mocked(searchMapTilerPlaces).mockReset();
    vi.mocked(resolveMapTilerCoordinates).mockReset();
    vi.mocked(calculateOpenRouteServiceRoute).mockClear();
    vi.mocked(calculateOpenRouteServiceRouteOptions).mockClear();
    vi.mocked(downloadTripMap).mockReset().mockResolvedValue(undefined);
    maplibreMock.Map.mockClear();
    maplibreMock.NavigationControl.mockClear();
    maplibreMock.mapInstances.length = 0;
    maplibreMock.resetSources();
    maplibreMock.project.mockClear();
    vi.unstubAllGlobals();
    const localStorageItems = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        clear: vi.fn(() => localStorageItems.clear()),
        getItem: vi.fn((key: string) => localStorageItems.get(key) ?? null),
        key: vi.fn((index: number) => [...localStorageItems.keys()][index] ?? null),
        removeItem: vi.fn((key: string) => {
          localStorageItems.delete(key);
        }),
        setItem: vi.fn((key: string, value: string) => {
          localStorageItems.set(key, value);
        }),
        get length() {
          return localStorageItems.size;
        },
      },
    });
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      complete = true;
      #src = '';

      get src() {
        return this.#src;
      }

      set src(value: string) {
        this.#src = value;
        this.onload?.();
      }
    }
    vi.stubGlobal('Image', FakeImage);
  });

  it('disables trip map export for an empty trip', async () => {
    repositoryMock.initialDestinations = Promise.resolve([]);
    repositoryMock.initialRouteLegs = Promise.resolve([]);

    render(<App />);

    expect(await screen.findByRole('button', { name: 'Download trip map' })).toBeDisabled();
  });

  it('exports the active trip name, stops, and route legs', async () => {
    const user = userEvent.setup();
    const balcombe = createDestination({
      name: 'Balcombe',
      countryRegion: 'United Kingdom',
      coordinates: { lat: 51.0579, lng: -0.1371 },
      order: 0,
    });
    const paris = createDestination({
      name: 'Paris',
      countryRegion: 'France',
      coordinates: { lat: 48.8566, lng: 2.3522 },
      order: 1,
    });
    const readyRouteLeg = createRouteLeg({
      originDestinationId: balcombe.id,
      targetDestinationId: paris.id,
      type: 'driving-auto',
      status: 'ready',
      distanceKm: 442,
      travelTimeHours: 5.5,
      geometry: {
        type: 'LineString',
        coordinates: [
          [balcombe.coordinates.lng, balcombe.coordinates.lat],
          [paris.coordinates.lng, paris.coordinates.lat],
        ],
      },
      provider: 'openrouteservice',
      routeKey: 'balcombe-paris',
    });
    repositoryMock.initialDestinations = Promise.resolve([balcombe, paris]);
    repositoryMock.initialRouteLegs = Promise.resolve([readyRouteLeg]);

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Download trip map' }));
    await waitFor(() =>
      expect(downloadTripMap).toHaveBeenCalledWith({
        tripName: tripsMock[0].name,
        destinations: [balcombe, paris],
        routeLegs: [readyRouteLeg],
      }),
    );
  });

  it('shows a centered storage bootstrap error when the app repository cannot be prepared', async () => {
    mockTripWorkspace({
      repository: null,
      error: {
        title: 'Trip storage unavailable',
        message: 'Unable to create an anonymous Supabase session.',
      },
    });

    render(<App />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveClass('app-status-panel', 'app-status-panel--error');
    expect(alert).toHaveTextContent('Trip storage unavailable');
    expect(alert).toHaveTextContent('Unable to create an anonymous Supabase session.');
    expect(screen.queryByText('Blank planning map')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Search for a destination')).not.toBeInTheDocument();
    expectNoStatusPlaceholderPin();
  });

  it('shows Supabase setup guidance when storage configuration is missing', async () => {
    mockTripWorkspace({
      repository: null,
      error: {
        title: 'Supabase is not configured',
        message: 'Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.',
      },
    });

    render(<App />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Supabase is not configured');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.',
    );
  });

  it('subscribes to trip realtime changes and cleans up channels', async () => {
    const refreshTrips = vi.fn(async () => undefined);
    const unsubscribeTrips = vi.fn();
    const unsubscribeTripData = vi.fn();
    const tripsChanges: Array<() => void> = [];
    const tripDataChanges: Array<() => void> = [];
    const realtime = {
      subscribeToTrips: vi.fn((onChange: () => void) => {
        tripsChanges.push(onChange);
        return unsubscribeTrips;
      }),
      subscribeToTripData: vi.fn((tripId: string, onChange: () => void) => {
        expect(tripId).toBe(tripsMock[0].id);
        tripDataChanges.push(onChange);
        return unsubscribeTripData;
      }),
    };
    mockTripWorkspace({
      refreshTrips,
      realtime,
    } as Partial<ReturnType<typeof useTripWorkspace>>);

    const { unmount } = render(<App />);

    await waitFor(() => expect(realtime.subscribeToTrips).toHaveBeenCalledTimes(1));
    expect(realtime.subscribeToTripData).toHaveBeenCalledTimes(1);

    tripsChanges[0]();
    expect(refreshTrips).toHaveBeenCalledTimes(1);
    expect(calculateOpenRouteServiceRoute).not.toHaveBeenCalled();

    repositoryMock.listDestinations.mockClear();
    tripDataChanges[0]();
    await waitFor(() => expect(repositoryMock.listDestinations).toHaveBeenCalledTimes(1));

    unmount();
    expect(unsubscribeTrips).toHaveBeenCalledTimes(1);
    expect(unsubscribeTripData).toHaveBeenCalledTimes(1);
  });

  it('recalculates routes exactly once when the active trip vehicle is saved', async () => {
    const origin = createDestination({ name: 'Origin', coordinates: { lat: 50, lng: 1 }, order: 0 });
    const target = createDestination({ name: 'Target', coordinates: { lat: 51, lng: 2 }, order: 1 });
    const readyLeg = {
      ...createRouteLeg({
        originDestinationId: origin.id,
        targetDestinationId: target.id,
        type: 'driving-auto',
      }),
      status: 'ready' as const,
      distanceKm: 150,
      travelTimeHours: 2,
      geometry: { type: 'LineString' as const, coordinates: [[1, 50], [2, 51]] },
      provider: 'openrouteservice',
      profile: 'driving-car' as const,
      routeKey: 'old-car-key',
      calculatedAt: '2026-07-01T10:00:00.000Z',
    };
    repositoryMock.initialDestinations = Promise.resolve([origin, target]);
    repositoryMock.initialRouteLegs = Promise.resolve([readyLeg]);
    const updatedTrip = {
      ...tripsMock[0],
      routingVehicle: {
        preset: 'expedition-truck' as const,
        profile: 'driving-hgv' as const,
        vehicleType: 'hgv' as const,
        restrictions: { length: 9, width: 2.55, height: 3.8, weight: 15, axleLoad: 7.5 },
      },
    };
    const updateTrip = vi.fn(async () => updatedTrip);
    mockTripWorkspace({ updateTrip } as Partial<ReturnType<typeof useTripWorkspace>>);

    render(<App />);
    await waitForTripReady();
    await userEvent.click(screen.getByRole('button', { name: /current trip/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit World tour' }));
    await userEvent.click(screen.getByRole('button', { name: 'Expedition truck' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save trip' }));

    await waitFor(() => expect(calculateOpenRouteServiceRoute).toHaveBeenCalledTimes(1));
    expect(updateTrip).toHaveBeenCalledWith('trip-one', {
      name: 'World tour',
      vehiclePreset: 'expedition-truck',
    });
  });

  it('restores prior routes and trip metadata after a partial vehicle-route write failure', async () => {
    const first = createDestination({ name: 'First', coordinates: { lat: 50, lng: 1 }, order: 0 });
    const second = createDestination({ name: 'Second', coordinates: { lat: 51, lng: 2 }, order: 1 });
    const third = createDestination({ name: 'Third', coordinates: { lat: 52, lng: 3 }, order: 2 });
    const priorRouteLegs = [
      createRouteLeg({ originDestinationId: first.id, targetDestinationId: second.id, type: 'driving-auto' }),
      createRouteLeg({ originDestinationId: second.id, targetDestinationId: third.id, type: 'shipping-manual' }),
    ];
    repositoryMock.initialDestinations = Promise.resolve([first, second, third]);
    repositoryMock.initialRouteLegs = Promise.resolve(priorRouteLegs);
    let saveCall = 0;
    repositoryMock.saveRouteLeg.mockImplementation(async () => {
      saveCall += 1;
      if (saveCall === 2) throw new Error('second route write failed');
    });
    const updatedTrip = {
      ...tripsMock[0],
      routingVehicle: resolveVehiclePreset('expedition-truck'),
    };
    const updateTrip = vi.fn()
      .mockResolvedValueOnce(updatedTrip)
      .mockResolvedValueOnce(tripsMock[0]);
    mockTripWorkspace({ updateTrip } as Partial<ReturnType<typeof useTripWorkspace>>);

    render(<App />);
    await waitForTripReady();
    await userEvent.click(screen.getByRole('button', { name: /current trip/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit World tour' }));
    await userEvent.click(screen.getByRole('button', { name: 'Expedition truck' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save trip' }));

    await waitFor(() => expect(updateTrip).toHaveBeenCalledTimes(2));
    expect(updateTrip).toHaveBeenLastCalledWith('trip-one', {
      name: 'World tour',
      vehiclePreset: 'standard',
    });
    expect(repositoryMock.saveRouteLeg).toHaveBeenCalledTimes(4);
    expect(repositoryMock.saveRouteLeg).toHaveBeenNthCalledWith(3, priorRouteLegs[0]);
    expect(repositoryMock.saveRouteLeg).toHaveBeenNthCalledWith(4, priorRouteLegs[1]);
    expect(await screen.findByText(/second route write failed.*trip metadata was restored/i))
      .toBeInTheDocument();
  });

  it('surfaces route and metadata rollback failures together', async () => {
    const origin = createDestination({ name: 'Origin', coordinates: { lat: 50, lng: 1 }, order: 0 });
    const target = createDestination({ name: 'Target', coordinates: { lat: 51, lng: 2 }, order: 1 });
    const priorRouteLeg = createRouteLeg({
      originDestinationId: origin.id,
      targetDestinationId: target.id,
      type: 'driving-auto',
    });
    repositoryMock.initialDestinations = Promise.resolve([origin, target]);
    repositoryMock.initialRouteLegs = Promise.resolve([priorRouteLeg]);
    repositoryMock.saveRouteLeg
      .mockRejectedValueOnce(new Error('route write failed'))
      .mockRejectedValueOnce(new Error('route rollback failed'));
    const updateTrip = vi.fn()
      .mockResolvedValueOnce({
        ...tripsMock[0],
        routingVehicle: resolveVehiclePreset('large-camper'),
      })
      .mockResolvedValueOnce(false);
    mockTripWorkspace({ updateTrip } as Partial<ReturnType<typeof useTripWorkspace>>);

    render(<App />);
    await waitForTripReady();
    await userEvent.click(screen.getByRole('button', { name: /current trip/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit World tour' }));
    await userEvent.click(screen.getByRole('button', { name: 'Large camper' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save trip' }));

    expect(await screen.findByText(
      /route write failed.*route rollback failed.*trip metadata rollback failed/i,
    )).toBeInTheDocument();
  });

  it('keeps the concrete workspace rollback error visible with the consistency warning', async () => {
    const origin = createDestination({ name: 'Origin', coordinates: { lat: 50, lng: 1 }, order: 0 });
    const target = createDestination({ name: 'Target', coordinates: { lat: 51, lng: 2 }, order: 1 });
    repositoryMock.initialDestinations = Promise.resolve([origin, target]);
    repositoryMock.initialRouteLegs = Promise.resolve([
      createRouteLeg({
        originDestinationId: origin.id,
        targetDestinationId: target.id,
        type: 'driving-auto',
      }),
    ]);
    repositoryMock.saveRouteLeg.mockRejectedValueOnce(new Error('route write rejected'));
    const updateTrip = vi.fn();
    vi.mocked(useTripWorkspace).mockImplementation(() => {
      const [actionError, setActionError] = useState<string | null>(null);
      updateTrip.mockImplementationOnce(async () => ({
        ...tripsMock[0],
        routingVehicle: resolveVehiclePreset('large-camper'),
      }));
      updateTrip.mockImplementationOnce(async () => {
        setActionError('metadata write rejected');
        return false;
      });
      return {
        trips: tripsMock,
        activeTrip: tripsMock[0],
        repository: repositoryMock,
        isLoading: false,
        error: null,
        actionError,
        selectTrip: vi.fn(),
        createTrip: vi.fn(),
        updateTrip,
        deleteTrip: vi.fn(),
        refreshTrips: vi.fn(),
        realtime: null,
      } as ReturnType<typeof useTripWorkspace>;
    });

    render(<App />);
    await waitForTripReady();
    await userEvent.click(screen.getByRole('button', { name: /current trip/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit World tour' }));
    await userEvent.click(screen.getByRole('button', { name: 'Large camper' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save trip' }));

    const error = await screen.findByText(/trip metadata rollback failed/i);
    expect(error).toHaveTextContent('metadata write rejected');
    expect(error).toHaveTextContent('trip metadata may not match the restored route legs');
  });

  it('shows one centered loading panel while app clients and trip data load', async () => {
    const initialDestinations = createDeferred<Destination[]>();
    const initialRouteLegs = createDeferred<RouteLeg[]>();
    repositoryMock.initialDestinations = initialDestinations.promise;
    repositoryMock.initialRouteLegs = initialRouteLegs.promise;

    render(<App />);

    const status = screen.getByRole('status');
    expect(status).toHaveClass('app-status-panel', 'app-status-panel--loading');
    expect(status).toHaveTextContent('Loading world tour');
    expect(status).toHaveTextContent('Preparing your trip map.');
    expect(screen.queryByText('Loading trip data')).not.toBeInTheDocument();
    expect(screen.queryByText('Blank planning map')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Search for a destination')).not.toBeInTheDocument();
    expectNoStatusPlaceholderPin();

    await act(async () => {
      initialDestinations.resolve([]);
      initialRouteLegs.resolve([]);
    });
    await waitForTripReady();
  });

  it('shows an empty trip panel with normal add controls after an empty trip loads', async () => {
    repositoryMock.initialDestinations = Promise.resolve([]);
    repositoryMock.initialRouteLegs = Promise.resolve([]);

    render(<App />);

    expect(await screen.findByText('No stops in this trip yet')).toBeInTheDocument();
    const status = screen.getByRole('status');
    expect(status).toHaveClass('app-status-panel', 'app-status-panel--empty');
    expect(status).toHaveTextContent('Search for a destination or add a stop from the map.');
    expect(screen.getByLabelText('Search for a destination')).toBeInTheDocument();
    expect(screen.queryByText('Blank planning map')).not.toBeInTheDocument();
    expectNoStatusPlaceholderPin();
  });

  it('shows active trip data load errors in the centered status panel and retries with reload', async () => {
    repositoryMock.initialDestinations = Promise.reject(new Error('Trip rows unavailable.'));
    repositoryMock.initialRouteLegs = Promise.resolve([]);

    render(<App />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveClass('app-status-panel', 'app-status-panel--error');
    expect(alert).toHaveTextContent('Unable to load trip data');
    expect(alert).toHaveTextContent('Trip rows unavailable.');
    expect(screen.queryByLabelText('Search for a destination')).not.toBeInTheDocument();
    expectNoStatusPlaceholderPin();

    repositoryMock.initialDestinations = Promise.resolve([]);
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('No stops in this trip yet')).toBeInTheDocument();
  });

  it('clears open route, panel, and preview surfaces when trip data reload fails', async () => {
    const user = userEvent.setup();
    const tripDataChanges: Array<() => void> = [];
    const realtime = {
      subscribeToTrips: vi.fn(() => vi.fn()),
      subscribeToTripData: vi.fn((tripId: string, onChange: () => void) => {
        expect(tripId).toBe(tripsMock[0].id);
        tripDataChanges.push(onChange);
        return vi.fn();
      }),
    };
    const paris = createDestination({
      name: 'Paris',
      countryRegion: 'France',
      coordinates: { lat: 48.8566, lng: 2.3522 },
    });
    const rome = createDestination({
      name: 'Rome',
      countryRegion: 'Italy',
      coordinates: { lat: 41.9028, lng: 12.4964 },
      order: 1,
    });
    const louvre = createActivity({
      destinationId: paris.id,
      title: 'Louvre',
      order: 0,
    });
    const routeLeg = createRouteLeg({
      originDestinationId: paris.id,
      targetDestinationId: rome.id,
      type: 'driving-auto',
      status: 'ready',
      distanceKm: 1420,
      travelTimeHours: 14.5,
      geometry: {
        type: 'LineString',
        coordinates: [
          [paris.coordinates.lng, paris.coordinates.lat],
          [rome.coordinates.lng, rome.coordinates.lat],
        ],
      },
      provider: 'openrouteservice',
      routeKey: 'paris-rome',
    });
    repositoryMock.initialDestinations = Promise.resolve([paris, rome]);
    repositoryMock.initialRouteLegs = Promise.resolve([routeLeg]);
    repositoryMock.listActivities.mockImplementation(async (destinationId: string) =>
      destinationId === paris.id ? [louvre] : [],
    );
    repositoryMock.listDestinationMedia.mockResolvedValue([createMediaItem({ id: 'paris-stop-media', url: '/paris.jpg' })]);
    repositoryMock.listDestinationMediaRollup.mockResolvedValue([
      createDestinationRollupItem(
        paris.id,
        createMediaItem({
          id: 'paris-stop-media',
          url: '/paris.jpg',
          caption: 'Paris street',
        }),
      ),
    ]);
    mockTripWorkspace({ realtime } as Partial<ReturnType<typeof useTripWorkspace>>);

    render(<App />);

    await waitForTripReady();
    await user.click(screen.getByRole('button', { name: 'Paris, France' }));
    await user.click(await screen.findByRole('button', { name: 'Select activity Louvre' }));
    await user.click(await screen.findByRole('button', { name: 'Open full image: Paris street' }));
    await user.click(screen.getByRole('button', { name: 'Edit route from Paris to Rome' }));

    expect(screen.getByRole('complementary', { name: 'Paris profile' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Louvre activity' })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Image preview' })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Edit route from Paris to Rome' })).toBeInTheDocument();

    repositoryMock.listDestinations.mockRejectedValueOnce(new Error('Trip rows unavailable.'));
    act(() => {
      tripDataChanges[0]?.();
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Unable to load trip data');
    expect(alert).toHaveTextContent('Trip rows unavailable.');
    expect(screen.queryByRole('complementary', { name: 'Paris profile' })).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Louvre activity' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Image preview' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Edit route from Paris to Rome' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Search for a destination')).not.toBeInTheDocument();

    repositoryMock.listDestinations.mockResolvedValue([paris, rome]);
    repositoryMock.listRouteLegs.mockResolvedValue([routeLeg]);
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.getByLabelText('Search for a destination')).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Paris profile' })).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Louvre activity' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Image preview' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Edit route from Paris to Rome' })).not.toBeInTheDocument();
  });

  it('closes pending map-stop confirmation when trip data reload fails', async () => {
    const tripDataChanges: Array<() => void> = [];
    const realtime = {
      subscribeToTrips: vi.fn(() => vi.fn()),
      subscribeToTripData: vi.fn((tripId: string, onChange: () => void) => {
        expect(tripId).toBe(tripsMock[0].id);
        tripDataChanges.push(onChange);
        return vi.fn();
      }),
    };
    const paris = createDestination({
      name: 'Paris',
      countryRegion: 'France',
      coordinates: { lat: 48.8566, lng: 2.3522 },
    });
    vi.mocked(resolveMapTilerCoordinates).mockResolvedValue(
      createPlaceSearchResult({
        id: 'place-balcombe',
        label: 'Balcombe, United Kingdom',
        placeName: 'Balcombe',
        regionName: 'West Sussex',
        countryName: 'United Kingdom',
        coordinates: { lat: 51.0576, lng: -0.1342 },
      }),
    );
    repositoryMock.initialDestinations = Promise.resolve([paris]);
    repositoryMock.initialRouteLegs = Promise.resolve([]);
    repositoryMock.listActivities.mockResolvedValue([]);
    mockTripWorkspace({ realtime } as Partial<ReturnType<typeof useTripWorkspace>>);

    render(<App />);

    await waitForTripReady();
    await waitFor(() => expect(maplibreMock.mapInstances.length).toBeGreaterThan(0));

    const contextMenuHandler = getMapEventHandler(maplibreMock.mapInstances.at(-1)!, 'contextmenu');
    act(() => {
      contextMenuHandler({
        preventDefault: vi.fn(),
        lngLat: { lat: 51.0576, lng: -0.1342 },
        point: { x: 300, y: 220 },
      });
    });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Add stop here' }));

    expect(await screen.findByRole('dialog', { name: 'Add stop from map' })).toBeInTheDocument();

    repositoryMock.listDestinations.mockRejectedValueOnce(new Error('Trip rows unavailable.'));
    act(() => {
      tripDataChanges[0]?.();
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Trip rows unavailable.');
    expect(screen.queryByRole('dialog', { name: 'Add stop from map' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Search for a destination')).not.toBeInTheDocument();
  });

  it('renders the trip selector above the stop panel and clears selected stop when the active trip changes', async () => {
    const firstDestination = createDestination({
      name: 'Paris',
      coordinates: { lat: 48.8566, lng: 2.3522 },
    });
    repositoryMock.initialDestinations = Promise.resolve([firstDestination]);
    const { rerender } = render(<App />);

    await waitForTripReady();
    await userEvent.click(await screen.findByRole('button', { name: 'Select Paris' }));
    expect(screen.getByRole('complementary', { name: 'Paris profile' })).toBeInTheDocument();

    mockTripWorkspace({
      trips: tripsMock,
      activeTrip: tripsMock[1],
      repository: repositoryMock,
      isLoading: false,
      error: null,
      actionError: null,
      selectTrip: vi.fn(),
      createTrip: vi.fn(),
      updateTrip: vi.fn(),
      deleteTrip: vi.fn(),
    });
    rerender(<App />);

    await waitForTripReady();
    expect(screen.getByRole('button', { name: /current trip: Japan winter/i })).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Paris profile' })).not.toBeInTheDocument();
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

    await waitForTripReady();

    await userEvent.type(screen.getByLabelText('Search for a destination'), 'Kyoto');
    await userEvent.click(await screen.findByRole('option', { name: 'Kyoto, Japan' }));

    expect(searchMapTilerPlaces).toHaveBeenCalledWith('Kyoto', {
      apiKey: expect.any(String),
      profile: 'stop',
    });
    expect(await screen.findByRole('button', { name: 'Kyoto, Japan' })).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Kyoto profile' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select Kyoto' })).not.toHaveClass('is-selected');
  });

  it('opens route alternatives from the route row and saves the selected option', async () => {
    const user = userEvent.setup();
    const istanbul = createDestination({
      name: 'Istanbul',
      coordinates: { lat: 41.0082, lng: 28.9784 },
      order: 0,
    });
    const tbilisi = createDestination({
      name: 'Tbilisi',
      coordinates: { lat: 41.7151, lng: 44.8271 },
      order: 1,
    });
    const waypoint = {
      id: 'waypoint-batumi',
      order: 1,
      name: 'Batumi',
      coordinates: { lat: 41.6461, lng: 41.6402 },
      location: tbilisi.location,
      notes: 'Keep the Black Sea route.',
      links: [],
    };
    const earlierWaypoint = {
      ...waypoint,
      id: 'waypoint-samsun',
      order: 0,
      name: 'Samsun',
      coordinates: { lat: 41.2867, lng: 36.33 },
    };
    const routeLeg = {
      ...createRouteLeg({
        originDestinationId: istanbul.id,
        targetDestinationId: tbilisi.id,
        type: 'driving-auto',
        movement: 'drive',
        calculation: 'automatic',
        ferryPolicy: 'allow',
        waypoints: [waypoint, earlierWaypoint],
        warnings: [{ code: 'SUSPICIOUS_DETOUR', message: 'Stale warning.' }],
        notes: 'Keep the border research notes.',
      }),
      status: 'ready' as const,
      distanceKm: 160,
      travelTimeHours: 2.25,
      geometry: { type: 'LineString' as const, coordinates: [[28.9784, 41.0082], [44.8271, 41.7151]] },
      provider: 'openrouteservice',
      profile: 'driving-car' as const,
      routeKey: 'recommended-route-key',
      calculatedAt: '2026-07-01T10:00:00.000Z',
    };
    repositoryMock.initialDestinations = Promise.resolve([istanbul, tbilisi]);
    repositoryMock.initialRouteLegs = Promise.resolve([routeLeg]);
    const routingVehicle = resolveVehiclePreset('large-camper');
    mockTripWorkspace({
      activeTrip: { ...tripsMock[0], routingVehicle },
    } as Partial<ReturnType<typeof useTripWorkspace>>);

    render(<App />);

    await waitForTripReady();

    const editRouteButton = await screen.findByRole('button', {
      name: 'Edit route from Istanbul to Tbilisi',
    });
    await user.click(editRouteButton);

    expect(calculateOpenRouteServiceRouteOptions).toHaveBeenCalledWith({
      apiKey: expect.any(String),
      origin: istanbul.coordinates,
      target: tbilisi.coordinates,
      routingVehicle,
      waypoints: [earlierWaypoint, waypoint],
      ferryPolicy: 'allow',
    });

    expect(await screen.findByRole('dialog', { name: 'Edit route from Istanbul to Tbilisi' })).toBeInTheDocument();
    expect(await screen.findByText('Avoid highways')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Avoid highways 137 mi 3.4 hr' }));
    await user.click(screen.getByRole('button', { name: 'Use selected route' }));

    await waitFor(() =>
      expect(repositoryMock.saveRouteLeg).toHaveBeenLastCalledWith(
        expect.objectContaining({
          routeKey: 'avoid-highways-route-key',
          distanceKm: 220,
          travelTimeHours: 3.4,
          status: 'ready',
          movement: 'drive',
          calculation: 'automatic',
          ferryPolicy: 'allow',
          waypoints: [waypoint, earlierWaypoint],
          notes: 'Keep the border research notes.',
          sections: [{ kind: 'road', startGeometryIndex: 0, endGeometryIndex: 2, distanceKm: 220 }],
          warnings: [],
        }),
      ),
    );
  });

  it('does not save a stale alternative after route intent changes while the picker is open', async () => {
    const bremen = createDestination({ name: 'Bremen', coordinates: { lat: 53.0793, lng: 8.8017 }, order: 0 });
    const hamburg = createDestination({ name: 'Hamburg', coordinates: { lat: 53.5502, lng: 10.0013 }, order: 1 });
    const routeLeg = createRouteLeg({
      originDestinationId: bremen.id,
      targetDestinationId: hamburg.id,
      type: 'driving-auto',
      status: 'ready',
      distanceKm: 125,
      travelTimeHours: 2,
      geometry: { type: 'LineString', coordinates: [[8.8017, 53.0793], [10.0013, 53.5502]] },
      provider: 'openrouteservice',
      profile: 'driving-car',
      routeKey: 'original-route',
      calculatedAt: '2026-07-01T10:00:00.000Z',
      notes: 'Original intent.',
    });
    repositoryMock.initialDestinations = Promise.resolve([bremen, hamburg]);
    repositoryMock.initialRouteLegs = Promise.resolve([routeLeg]);

    render(<App />);
    await waitForTripReady();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit route from Bremen to Hamburg' }));
    await userEvent.click(screen.getByRole('button', { name: 'Set Bremen to Hamburg to Vehicle shipping' }));
    await waitFor(() => expect(repositoryMock.saveRouteLeg).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole('button', { name: 'Use selected route' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Route intent changed'));
    expect(repositoryMock.saveRouteLeg).toHaveBeenCalledTimes(1);
    expect(repositoryMock.saveRouteLeg).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'shipping-manual', status: 'manual', notes: 'Original intent.' }),
    );
  });

  it.each([
    {
      name: 'fails when a required ferry is missing',
      ferryPolicy: 'require' as const,
      distanceKm: 800,
      sections: [{ kind: 'road' as const, startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 800 }],
      expectedStatus: 'failed',
      warningCode: 'FERRY_REQUIRED_NOT_FOUND',
      retainsGeometry: false,
    },
    {
      name: 'fails when an avoided ferry is returned',
      ferryPolicy: 'avoid' as const,
      distanceKm: 800,
      sections: [{ kind: 'ferry' as const, startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 800 }],
      expectedStatus: 'failed',
      warningCode: 'FERRY_AVOIDED_BUT_FOUND',
      retainsGeometry: false,
    },
    {
      name: 'requires review for a suspicious detour',
      ferryPolicy: 'allow' as const,
      distanceKm: 1372.6,
      sections: [{ kind: 'road' as const, startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 1372.6 }],
      expectedStatus: 'review-required',
      warningCode: 'SUSPICIOUS_DETOUR',
      retainsGeometry: true,
    },
  ])('$name when applying a route alternative', async ({
    ferryPolicy,
    distanceKm,
    sections,
    expectedStatus,
    warningCode,
    retainsGeometry,
  }) => {
    const bremen = createDestination({ name: 'Bremen', coordinates: { lat: 53.0793, lng: 8.8017 }, order: 0 });
    const hirtshals = createDestination({ name: 'Hirtshals', coordinates: { lat: 57.5881, lng: 9.9598 }, order: 1 });
    const geometry = {
      type: 'LineString' as const,
      coordinates: [[bremen.coordinates.lng, bremen.coordinates.lat], [hirtshals.coordinates.lng, hirtshals.coordinates.lat]],
    };
    const routeLeg = createRouteLeg({
      originDestinationId: bremen.id,
      targetDestinationId: hirtshals.id,
      type: 'driving-auto',
      status: 'ready',
      ferryPolicy,
      distanceKm: 700,
      travelTimeHours: 9,
      geometry,
      provider: 'openrouteservice',
      profile: 'driving-car',
      routeKey: 'old-route',
      calculatedAt: '2026-07-01T10:00:00.000Z',
      warnings: [{ code: 'SUSPICIOUS_DETOUR', message: 'Stale warning.' }],
      notes: 'Preserve route notes.',
    });
    const option: RouteOption = {
      id: 'selected-option',
      label: 'Selected option',
      source: 'recommended',
      distanceKm,
      travelTimeHours: 18,
      geometry,
      sections,
      provider: 'openrouteservice',
      profile: 'driving-car',
      routeKey: 'selected-route-key',
    };
    vi.mocked(calculateOpenRouteServiceRouteOptions).mockResolvedValueOnce([option]);
    repositoryMock.initialDestinations = Promise.resolve([bremen, hirtshals]);
    repositoryMock.initialRouteLegs = Promise.resolve([routeLeg]);

    render(<App />);
    await waitForTripReady();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit route from Bremen to Hirtshals' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Use selected route' }));

    await waitFor(() => expect(repositoryMock.saveRouteLeg).toHaveBeenCalled());
    const savedRoute = repositoryMock.saveRouteLeg.mock.calls.at(-1)?.[0];
    expect(savedRoute).toMatchObject({
      status: expectedStatus,
      distanceKm: undefined,
      travelTimeHours: undefined,
      geometry: retainsGeometry ? geometry : undefined,
      warnings: [expect.objectContaining({ code: warningCode })],
      movement: 'drive',
      calculation: 'automatic',
      ferryPolicy,
      waypoints: [],
      notes: 'Preserve route notes.',
    });
  });

  it('hides an open route alternatives panel while trip data reloads in the loading state', async () => {
    const user = userEvent.setup();
    const tripDataChanges: Array<() => void> = [];
    const reloadDestinations = createDeferred<Destination[]>();
    const reloadRouteLegs = createDeferred<RouteLeg[]>();
    const realtime = {
      subscribeToTrips: vi.fn(() => vi.fn()),
      subscribeToTripData: vi.fn((tripId: string, onChange: () => void) => {
        expect(tripId).toBe(tripsMock[0].id);
        tripDataChanges.push(onChange);
        return vi.fn();
      }),
    };
    vi.mocked(searchMapTilerPlaces)
      .mockResolvedValueOnce([
        createPlaceSearchResult({
          id: 'place-paris',
          label: 'Paris, France',
          placeName: 'Paris',
          regionName: '',
          countryName: 'France',
          coordinates: { lat: 48.8566, lng: 2.3522 },
        }),
      ])
      .mockResolvedValueOnce([
        createPlaceSearchResult({
          id: 'place-rome',
          label: 'Rome, Italy',
          placeName: 'Rome',
          regionName: '',
          countryName: 'Italy',
          coordinates: { lat: 41.9028, lng: 12.4964 },
        }),
      ]);
    repositoryMock.initialDestinations = Promise.resolve([]);
    repositoryMock.initialRouteLegs = Promise.resolve([]);
    mockTripWorkspace({ realtime } as Partial<ReturnType<typeof useTripWorkspace>>);

    render(<App />);

    await waitForTripReady();

    await user.type(screen.getByLabelText('Search for a destination'), 'Paris');
    await user.click(await screen.findByRole('option', { name: 'Paris, France' }));
    await user.clear(screen.getByLabelText('Search for a destination'));
    await user.type(screen.getByLabelText('Search for a destination'), 'Rome');
    await user.click(await screen.findByRole('option', { name: 'Rome, Italy' }));

    await user.click(
      await screen.findByRole('button', {
        name: 'Edit route from Paris to Rome',
      }),
    );

    expect(await screen.findByRole('dialog', { name: 'Edit route from Paris to Rome' })).toBeInTheDocument();
    expect(await screen.findByText('Avoid highways')).toBeInTheDocument();

    repositoryMock.listDestinations.mockImplementationOnce(async () => reloadDestinations.promise);
    repositoryMock.listRouteLegs.mockImplementationOnce(async () => reloadRouteLegs.promise);

    act(() => {
      tripDataChanges[0]?.();
    });

    expect(await screen.findByRole('status')).toHaveTextContent('Loading world tour');
    expect(screen.queryByRole('dialog', { name: 'Edit route from Paris to Rome' })).not.toBeInTheDocument();

    await act(async () => {
      reloadDestinations.resolve(repositoryMock.destinations);
      reloadRouteLegs.resolve(repositoryMock.routeLegs);
      await reloadDestinations.promise;
      await reloadRouteLegs.promise;
    });

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(screen.queryByRole('dialog', { name: 'Edit route from Paris to Rome' })).not.toBeInTheDocument();
  });

  it('remembers when the stops panel is collapsed', async () => {
    const destination = createDestination({
      name: 'Brest',
      countryRegion: 'France',
      coordinates: { lat: 48.3904, lng: -4.4861 },
    });
    repositoryMock.initialDestinations = Promise.resolve([destination]);
    window.localStorage.setItem('world-tour:stops-panel-collapsed', 'true');

    render(<App />);

    await waitForTripReady();

    expect(screen.getByLabelText('Itinerary')).toHaveClass('is-collapsed');
    expect(screen.getByText('1 stop')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Brest, France' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Expand itinerary panel' }));

    expect(screen.getByRole('button', { name: 'Brest, France' })).toBeInTheDocument();
    expect(window.localStorage.getItem('world-tour:stops-panel-collapsed')).toBe('false');
  });

  it('adds a right-clicked map stop after reverse-geocoded confirmation and opens its profile', async () => {
    vi.mocked(resolveMapTilerCoordinates)
      .mockResolvedValueOnce(
        createPlaceSearchResult({
          id: 'place-balcombe',
          label: 'Balcombe, United Kingdom',
          placeName: 'Balcombe',
          regionName: 'West Sussex',
          countryName: 'United Kingdom',
          coordinates: { lat: 51.0576, lng: -0.1342 },
        }),
      )
      .mockResolvedValueOnce(
        createPlaceSearchResult({
          id: 'place-paris',
          label: 'Paris, France',
          placeName: 'Paris',
          regionName: 'Ile-de-France',
          countryName: 'France',
          coordinates: { lat: 48.8566, lng: 2.3522 },
        }),
      );

    render(<App />);

    await waitForTripReady();
    await waitFor(() => expect(maplibreMock.mapInstances.length).toBeGreaterThan(0));

    const contextMenuHandler = getMapEventHandler(maplibreMock.mapInstances.at(-1)!, 'contextmenu');
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
    expect(screen.getByText('Start')).toBeInTheDocument();
  });

  it('keeps the map stop confirmation inside the viewport near the bottom-right edge', async () => {
    vi.mocked(resolveMapTilerCoordinates).mockResolvedValue(
      createPlaceSearchResult({
        id: 'place-balcombe',
        label: 'Balcombe, United Kingdom',
        placeName: 'Balcombe',
        regionName: 'West Sussex',
        countryName: 'United Kingdom',
        coordinates: { lat: 51.0576, lng: -0.1342 },
      }),
    );

    render(<App />);

    await waitForTripReady();
    await waitFor(() => expect(maplibreMock.mapInstances.length).toBeGreaterThan(0));

    const contextMenuHandler = getMapEventHandler(maplibreMock.mapInstances.at(-1)!, 'contextmenu');
    act(() => {
      contextMenuHandler({
        preventDefault: vi.fn(),
        lngLat: { lat: 51.0576, lng: -0.1342 },
        point: { x: 1000, y: 740 },
      });
    });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Add stop here' }));

    expect(await screen.findByRole('dialog', { name: 'Add stop from map' })).toHaveStyle({
      left: '688px',
      top: '492px',
    });
  });

  it('caps the map stop confirmation height from its clamped top edge', async () => {
    vi.mocked(resolveMapTilerCoordinates).mockResolvedValue(
      createPlaceSearchResult({
        id: 'place-long-name',
        label:
          'A very long map stop name that wraps repeatedly, West Sussex with an equally long region name, United Kingdom',
        placeName: 'A very long map stop name that wraps repeatedly',
        regionName: 'West Sussex with an equally long region name',
        countryName: 'United Kingdom',
        coordinates: { lat: 51.0576, lng: -0.1342 },
      }),
    );

    render(<App />);

    await waitForTripReady();
    await waitFor(() => expect(maplibreMock.mapInstances.length).toBeGreaterThan(0));

    const contextMenuHandler = getMapEventHandler(maplibreMock.mapInstances.at(-1)!, 'contextmenu');
    act(() => {
      contextMenuHandler({
        preventDefault: vi.fn(),
        lngLat: { lat: 51.0576, lng: -0.1342 },
        point: { x: 1000, y: 740 },
      });
    });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Add stop here' }));

    expect(await screen.findByRole('dialog', { name: 'Add stop from map' })).toHaveStyle({
      maxHeight: '260px',
    });
  });

  it('disables map stop confirmation while reverse geocoding is resolving', async () => {
    const coordinateLookup = createDeferred<Awaited<ReturnType<typeof resolveMapTilerCoordinates>>>();
    vi.mocked(resolveMapTilerCoordinates).mockReturnValue(coordinateLookup.promise);

    render(<App />);

    await openContextMenuMapStop({ lat: 51.0576, lng: -0.1342 });

    const addButton = await screen.findByRole('button', { name: 'Add stop' });
    expect(addButton).toBeDisabled();

    await act(async () => {
      coordinateLookup.resolve(
        createPlaceSearchResult({
          id: 'place-balcombe',
          label: 'Balcombe, United Kingdom',
          placeName: 'Balcombe',
          regionName: 'West Sussex',
          countryName: 'United Kingdom',
          coordinates: { lat: 51.0576, lng: -0.1342 },
        }),
      );
      await coordinateLookup.promise;
    });

    expect(await screen.findByRole('button', { name: 'Add stop' })).toBeEnabled();
  });

  it('allows adding a map stop when reverse geocoding fails', async () => {
    vi.mocked(resolveMapTilerCoordinates).mockRejectedValue(new Error('Coordinate lookup failed'));

    render(<App />);

    await openContextMenuMapStop({ lat: 12.345678, lng: 98.765432 });

    expect(await screen.findByRole('dialog', { name: 'Add stop from map' })).toHaveTextContent('Dropped pin');
    expect(screen.getByRole('dialog', { name: 'Add stop from map' })).toHaveTextContent('12.3457, 98.7654');
    expect(screen.getByRole('dialog', { name: 'Add stop from map' })).toHaveTextContent('Coordinate lookup failed');
    expect(screen.getByRole('button', { name: 'Add stop' })).toBeEnabled();

    await userEvent.click(screen.getByRole('button', { name: 'Add stop' }));

    expect(await screen.findByRole('complementary', { name: 'Dropped pin profile' })).toBeInTheDocument();
  });

  it('does not create duplicate map stops from rapid Add stop clicks', async () => {
    const user = userEvent.setup();
    const saveDestination = createDeferred<void>();
    repositoryMock.saveDestination.mockImplementation(async (destination: Destination) => {
      repositoryMock.destinations.push(destination);
      await saveDestination.promise;
    });
    vi.mocked(resolveMapTilerCoordinates).mockResolvedValue(
      createPlaceSearchResult({
        id: 'place-balcombe',
        label: 'Balcombe, United Kingdom',
        placeName: 'Balcombe',
        regionName: 'West Sussex',
        countryName: 'United Kingdom',
        coordinates: { lat: 51.0576, lng: -0.1342 },
      }),
    );

    render(<App />);

    await openContextMenuMapStop({ lat: 51.0576, lng: -0.1342 });

    const addButton = await screen.findByRole('button', { name: 'Add stop' });
    await waitFor(() => expect(addButton).toBeEnabled());
    await user.click(addButton);
    expect(addButton).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await user.click(addButton);

    expect(repositoryMock.saveDestination).toHaveBeenCalledTimes(1);

    const wasNotCanceled = fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
    expect(wasNotCanceled).toBe(false);
    expect(screen.getByRole('dialog', { name: 'Add stop from map' })).toBeInTheDocument();

    await openContextMenuMapStop({ lat: 48.8566, lng: 2.3522 });

    expect(screen.getByRole('dialog', { name: 'Add stop from map' })).toHaveTextContent('Balcombe');
    expect(screen.getByRole('dialog', { name: 'Add stop from map' })).not.toHaveTextContent('Paris');
    expect(resolveMapTilerCoordinates).toHaveBeenCalledTimes(1);

    await act(async () => {
      saveDestination.resolve(undefined);
      await saveDestination.promise;
    });
    expect(await screen.findByRole('complementary', { name: 'Balcombe profile' })).toBeInTheDocument();
  });

  it('keeps stale reverse geocode responses from replacing a newer pending map stop', async () => {
    const firstLookup = createDeferred<Awaited<ReturnType<typeof resolveMapTilerCoordinates>>>();
    const secondLookup = createDeferred<Awaited<ReturnType<typeof resolveMapTilerCoordinates>>>();
    vi.mocked(resolveMapTilerCoordinates)
      .mockReturnValueOnce(firstLookup.promise)
      .mockReturnValueOnce(secondLookup.promise);

    render(<App />);

    await waitForTripReady();
    await waitFor(() => expect(maplibreMock.mapInstances.length).toBeGreaterThan(0));

    await openContextMenuMapStop({ lat: 51.0576, lng: -0.1342 });
    await openContextMenuMapStop({ lat: 48.8566, lng: 2.3522 });

    await act(async () => {
      secondLookup.resolve(
        createPlaceSearchResult({
          id: 'place-paris',
          label: 'Paris, France',
          placeName: 'Paris',
          regionName: 'Ile-de-France',
          countryName: 'France',
          coordinates: { lat: 24, lng: 18 },
        }),
      );
      await secondLookup.promise;
    });

    expect(await screen.findByRole('dialog', { name: 'Add stop from map' })).toHaveTextContent('Paris');

    await act(async () => {
      firstLookup.resolve(
        createPlaceSearchResult({
          id: 'place-stale',
          label: 'Stale place, France',
          placeName: 'Stale place',
          regionName: 'Ile-de-France',
          countryName: 'France',
          coordinates: { lat: 24, lng: 18 },
        }),
      );
      await firstLookup.promise;
    });

    expect(screen.getByRole('dialog', { name: 'Add stop from map' })).toHaveTextContent('Paris');
    expect(screen.getByRole('dialog', { name: 'Add stop from map' })).not.toHaveTextContent('Stale place');
  });

  it('moves focus into the map stop confirmation when it opens', async () => {
    const coordinateLookup = createDeferred<Awaited<ReturnType<typeof resolveMapTilerCoordinates>>>();
    vi.mocked(resolveMapTilerCoordinates).mockReturnValue(coordinateLookup.promise);

    render(<App />);

    await openContextMenuMapStop({ lat: 51.0576, lng: -0.1342 });

    expect(await screen.findByRole('dialog', { name: 'Add stop from map' })).toHaveFocus();

    coordinateLookup.reject(new Error('Coordinate lookup failed'));
  });

  it('does not render a toolbar action for adding a stop at the map center', async () => {
    render(<App />);

    await waitForTripReady();
    await waitFor(() => expect(maplibreMock.mapInstances.length).toBeGreaterThan(0));
    const map = maplibreMock.mapInstances.at(-1)!;
    map.getCenter.mockReturnValue({ lat: 48.8566, lng: 2.3522 });
    act(() => {
      getMapEventHandler(map, 'move')();
    });

    expect(screen.queryByRole('button', { name: 'Add stop at map center' })).not.toBeInTheDocument();
  });

  it('closes the selected destination profile with Escape when no activity is open', async () => {
    const user = userEvent.setup();
    const destination = createDestination({
      name: 'Balcombe',
      countryRegion: 'United Kingdom',
      coordinates: { lat: 51.0576, lng: -0.1342 },
    });
    repositoryMock.initialDestinations = Promise.resolve([destination]);

    render(<App />);

    await waitForTripReady();
    await user.click(screen.getByRole('button', { name: 'Balcombe, United Kingdom' }));
    expect(screen.getByRole('complementary', { name: 'Balcombe profile' })).toBeInTheDocument();
    expect(screen.getByText('Start')).toBeInTheDocument();

    const wasNotCanceled = fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });

    expect(wasNotCanceled).toBe(false);
    expect(screen.queryByRole('complementary', { name: 'Balcombe profile' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Balcombe, United Kingdom' })).not.toHaveAttribute('aria-current');
  });

  it('shows tag suggestion values used by other stops and activities', async () => {
    const user = userEvent.setup();
    const home = {
      ...createDestination({
        name: 'Home',
        countryRegion: 'United Kingdom',
        coordinates: { lat: 51.0576, lng: -0.1342 },
      }),
      tags: [],
    };
    const brest = {
      ...createDestination({
        name: 'Brest',
        countryRegion: 'France',
        coordinates: { lat: 48.3904, lng: -4.4861 },
      }),
      tags: ['family'],
    };
    const activity = {
      ...createActivity({
        destinationId: home.id,
        title: 'Louvre',
        order: 0,
      }),
      tags: ['museum'],
    };
    repositoryMock.initialDestinations = Promise.resolve([home, brest]);
    repositoryMock.listActivities.mockImplementation(async (destinationId: string) =>
      destinationId === home.id ? [activity] : [],
    );

    render(<App />);

    await waitForTripReady();
    await user.click(screen.getByRole('button', { name: 'Home, United Kingdom' }));
    await user.click(screen.getByRole('button', { name: 'Add tag' }));

    expect(screen.getByRole('button', { name: 'Add tag suggestion family' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add tag suggestion museum' })).toBeInTheDocument();
  });

  it('loads destination media after opening a profile without blocking the pane', async () => {
    const user = userEvent.setup();
    const destination = createDestination({
      name: 'Balcombe',
      countryRegion: 'United Kingdom',
      coordinates: { lat: 51.0576, lng: -0.1342 },
    });
    const mediaLoad = createDeferred<MediaItem[]>();
    const mediaItems = [
      createMediaItem({
        id: 'media-1',
        url: '/balcombe.jpg',
        caption: 'Balcombe lane',
      }),
    ];
    repositoryMock.initialDestinations = Promise.resolve([destination]);
    repositoryMock.listDestinationMedia.mockReturnValue(mediaLoad.promise);
    repositoryMock.listDestinationMediaRollup.mockResolvedValue(
      mediaItems.map((mediaItem) => createDestinationRollupItem(destination.id, mediaItem)),
    );

    render(<App />);

    await waitForTripReady();
    await user.click(screen.getByRole('button', { name: 'Balcombe, United Kingdom' }));

    expect(await screen.findByRole('complementary', { name: 'Balcombe profile' })).toBeInTheDocument();
    expect(repositoryMock.listDestinationMedia).toHaveBeenCalledWith(destination.id);
    expect(screen.getByRole('region', { name: 'Stop images' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Loading images' })).toBeInTheDocument();

    await act(async () => {
      mediaLoad.resolve(mediaItems);
      await mediaLoad.promise;
    });

    expect(screen.getByRole('button', { name: 'Open full image: Balcombe lane' })).toBeInTheDocument();
  });

  it('searches web images with stop context and imports a selected result', async () => {
    const user = userEvent.setup();
    const destination = createDestination({
      name: 'Paris',
      location: {
        placeName: 'Paris',
        regionName: 'Ile-de-France',
        countryName: 'France',
        countryCode: 'FR',
        sourceLabel: 'Paris, France',
        sourceProvider: 'maptiler',
      },
      coordinates: { lat: 48.8566, lng: 2.3522 },
    });
    const selectedResult: WebImageSearchResult = {
      id: 'web-image-paris-mural',
      title: 'Paris mural',
      sourceName: 'Example Source',
      sourceUrl: 'https://example.com/paris-mural',
      thumbnailUrl: 'https://example.com/paris-mural-thumb.jpg',
      imageUrl: 'https://example.com/paris-mural.jpg',
      width: 1600,
      height: 1000,
    };
    const webImageSearchClient: WebImageSearchClient = {
      searchImages: vi.fn(async () => [selectedResult]),
    };
    repositoryMock.initialDestinations = Promise.resolve([destination]);
    repositoryMock.importDestinationMediaFromSearch.mockResolvedValue(
      createMediaItem({
        id: 'imported-paris-mural',
        url: selectedResult.imageUrl,
        caption: selectedResult.title,
      }),
    );

    render(<App webImageSearchClient={webImageSearchClient} />);

    await waitForTripReady();
    await user.click(screen.getByRole('button', { name: 'Paris, Ile-de-France, France' }));
    await user.type(await screen.findByLabelText('Search web images'), 'mural');
    await user.click(await screen.findByRole('option', { name: 'Import Paris mural from Example Source' }));

    expect(webImageSearchClient.searchImages).toHaveBeenCalledWith('mural', {
      stopName: 'Paris',
      regionName: 'Ile-de-France',
      countryName: 'France',
      countryCode: 'FR',
    });
    expect(repositoryMock.importDestinationMediaFromSearch).toHaveBeenCalledWith({
      destinationId: destination.id,
      result: selectedResult,
    });
  });

  it('searches activity images with activity subject and stop location context', async () => {
    const user = userEvent.setup();
    const destination = createDestination({
      name: 'Home',
      location: {
        placeName: 'Balcombe',
        regionName: 'West Sussex',
        countryName: 'United Kingdom',
        countryCode: 'GB',
        sourceLabel: 'Balcombe, West Sussex, United Kingdom',
        sourceProvider: 'maptiler',
      },
      coordinates: { lat: 51.0562, lng: -0.1307 },
    });
    const activity = createActivity({
      destinationId: destination.id,
      title: 'Ouse Valley Viaduct',
      order: 0,
      location: {
        name: 'Ouse Valley Viaduct',
        address: 'Borde Hill Lane, Haywards Heath RH16 1XP, United Kingdom',
        coordinates: { lat: 51.0299, lng: -0.1162 },
        sourceProvider: 'maptiler',
        sourceFeatureId: 'activity-location-1',
      },
    });
    const selectedResult: WebImageSearchResult = {
      id: 'web-image-ouse-valley',
      title: 'Ouse Valley Viaduct',
      sourceName: 'Example Source',
      sourceUrl: 'https://example.com/ouse-valley',
      thumbnailUrl: 'https://example.com/ouse-valley-thumb.jpg',
      imageUrl: 'https://example.com/ouse-valley.jpg',
      width: 1600,
      height: 1000,
    };
    const webImageSearchClient: WebImageSearchClient = {
      searchImages: vi.fn(async () => [selectedResult]),
    };
    repositoryMock.initialDestinations = Promise.resolve([destination]);
    repositoryMock.listActivities.mockResolvedValue([activity]);
    repositoryMock.listActivityMedia.mockResolvedValue([]);
    repositoryMock.importActivityMediaFromSearch.mockResolvedValue(
      createMediaItem({
        id: 'imported-ouse-valley',
        url: selectedResult.imageUrl,
        caption: selectedResult.title,
      }),
    );

    render(<App webImageSearchClient={webImageSearchClient} />);

    await waitForTripReady();
    await user.click(screen.getByRole('button', { name: 'Home, Balcombe, West Sussex, United Kingdom' }));
    await user.click(await screen.findByRole('button', { name: 'Select activity Ouse Valley Viaduct' }));
    const activityPanel = await screen.findByRole('complementary', { name: 'Ouse Valley Viaduct activity' });

    await user.type(within(activityPanel).getByLabelText('Search web images'), 'arches');
    await user.click(await within(activityPanel).findByRole('option', {
      name: 'Import Ouse Valley Viaduct from Example Source',
    }));

    expect(webImageSearchClient.searchImages).toHaveBeenCalledWith('arches', {
      stopName: 'Ouse Valley Viaduct',
      locationName: 'Ouse Valley Viaduct',
      address: 'Borde Hill Lane, Haywards Heath RH16 1XP, United Kingdom',
      latitude: 51.0299,
      longitude: -0.1162,
      regionName: 'West Sussex',
      countryName: 'United Kingdom',
      countryCode: 'GB',
    });
    expect(repositoryMock.importActivityMediaFromSearch).toHaveBeenCalledWith({
      destinationId: destination.id,
      activityId: activity.id,
      result: selectedResult,
    });
  });

  it('does not reload stale stop media when selected stop changes during web image import', async () => {
    const user = userEvent.setup();
    const paris = createDestination({
      name: 'Paris',
      countryRegion: 'France',
      coordinates: { lat: 48.8566, lng: 2.3522 },
      order: 0,
    });
    const rome = createDestination({
      name: 'Rome',
      countryRegion: 'Italy',
      coordinates: { lat: 41.9028, lng: 12.4964 },
      order: 1,
    });
    const selectedResult: WebImageSearchResult = {
      id: 'web-image-paris-mural',
      title: 'Paris mural',
      sourceName: 'Example Source',
      sourceUrl: 'https://example.com/paris-mural',
      thumbnailUrl: 'https://example.com/paris-mural-thumb.jpg',
      imageUrl: 'https://example.com/paris-mural.jpg',
      width: 1600,
      height: 1000,
    };
    const webImageSearchClient: WebImageSearchClient = {
      searchImages: vi.fn(async () => [selectedResult]),
    };
    const importResult = createDeferred<MediaItem>();
    repositoryMock.initialDestinations = Promise.resolve([paris, rome]);
    repositoryMock.importDestinationMediaFromSearch.mockReturnValue(importResult.promise);
    repositoryMock.listDestinationMedia.mockImplementation(async (destinationId: string) =>
      destinationId === rome.id
        ? [createMediaItem({ id: 'rome-stop-media', url: '/rome-stop.jpg', caption: 'Rome stop' })]
        : [createMediaItem({ id: 'paris-stop-media', url: '/paris-stop.jpg', caption: 'Paris stop' })],
    );
    repositoryMock.listDestinationMediaRollup.mockImplementation(async (destinationId: string) =>
      destinationId === rome.id
        ? [
            createDestinationRollupItem(
              rome.id,
              createMediaItem({ id: 'rome-media', url: '/rome.jpg', caption: 'Rome street' }),
            ),
          ]
        : [
            createDestinationRollupItem(
              paris.id,
              createMediaItem({ id: 'paris-media', url: '/paris.jpg', caption: 'Paris street' }),
            ),
          ],
    );

    render(<App webImageSearchClient={webImageSearchClient} />);

    await waitForTripReady();
    await user.click(screen.getByRole('button', { name: 'Paris, France' }));
    await user.type(await screen.findByLabelText('Search web images'), 'mural');
    await user.click(await screen.findByRole('option', { name: 'Import Paris mural from Example Source' }));
    await waitFor(() => expect(repositoryMock.importDestinationMediaFromSearch).toHaveBeenCalledWith({
      destinationId: paris.id,
      result: selectedResult,
    }));

    await user.click(screen.getByRole('button', { name: 'Rome, Italy' }));
    expect(await screen.findByRole('button', { name: 'Open full image: Rome street' })).toBeInTheDocument();
    repositoryMock.listDestinationMedia.mockClear();
    repositoryMock.listDestinationMediaRollup.mockClear();

    await act(async () => {
      importResult.resolve(createMediaItem({
        id: 'imported-paris-mural',
        url: selectedResult.imageUrl,
        caption: selectedResult.title,
      }));
      await importResult.promise;
      await Promise.resolve();
    });

    expect(repositoryMock.importDestinationMediaFromSearch).toHaveBeenCalledWith({
      destinationId: paris.id,
      result: selectedResult,
    });
    expect(repositoryMock.listDestinationMedia).not.toHaveBeenCalled();
    expect(repositoryMock.listDestinationMediaRollup).not.toHaveBeenCalled();
    expect(screen.getByRole('complementary', { name: 'Rome profile' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open full image: Rome street' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open full image: Paris street' })).not.toBeInTheDocument();
  });

  it('opens the image preview over the map stage instead of inside the stop pane', async () => {
    const user = userEvent.setup();
    const destination = createDestination({
      name: 'Balcombe',
      countryRegion: 'United Kingdom',
      coordinates: { lat: 51.0576, lng: -0.1342 },
    });
    const mediaItems = [
      createMediaItem({
        id: 'media-1',
        url: '/balcombe.jpg',
        caption: 'Balcombe lane',
      }),
    ];
    repositoryMock.initialDestinations = Promise.resolve([destination]);
    repositoryMock.listDestinationMedia.mockResolvedValue(mediaItems);
    repositoryMock.listDestinationMediaRollup.mockResolvedValue(
      mediaItems.map((mediaItem) => createDestinationRollupItem(destination.id, mediaItem)),
    );

    render(<App />);

    await waitForTripReady();
    await user.click(screen.getByRole('button', { name: 'Balcombe, United Kingdom' }));
    await user.click(await screen.findByRole('button', { name: 'Open full image: Balcombe lane' }));

    const profile = screen.getByRole('complementary', { name: 'Balcombe profile' });
    const mapStage = screen.getByRole('region', { name: 'World tour map workspace' });
    const preview = screen.getByRole('dialog', { name: 'Image preview' });

    expect(mapStage).toContainElement(preview);
    expect(profile).not.toContainElement(preview);
    expect(within(preview).queryByRole('heading', { name: 'Image preview' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Caption')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Credit')).not.toBeInTheDocument();

    const wasNotCanceled = fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });

    expect(wasNotCanceled).toBe(false);
    expect(screen.queryByRole('dialog', { name: 'Image preview' })).not.toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Balcombe profile' })).toBeInTheDocument();
  });

  it('uses thumbnails and arrows for image preview selection, then loops full images without reordering', async () => {
    const user = userEvent.setup();
    const destination = createDestination({
      name: 'Balcombe',
      countryRegion: 'United Kingdom',
      coordinates: { lat: 51.0576, lng: -0.1342 },
    });
    const mediaItems = [
      createMediaItem({
        id: 'media-1',
        url: '/balcombe-1.jpg',
        previewUrl: '/balcombe-1-preview.jpg',
        fullUrl: '/balcombe-1-full.jpg',
        caption: 'Balcombe lane',
        sortOrder: 0,
      }),
      createMediaItem({
        id: 'media-2',
        url: '/balcombe-2.jpg',
        previewUrl: '/balcombe-2-preview.jpg',
        fullUrl: '/balcombe-2-full.jpg',
        caption: 'Garden',
        sortOrder: 1,
      }),
      createMediaItem({
        id: 'media-3',
        url: '/balcombe-3.jpg',
        previewUrl: '/balcombe-3-preview.jpg',
        fullUrl: '/balcombe-3-full.jpg',
        caption: 'Front drive',
        sortOrder: 2,
      }),
    ];
    repositoryMock.initialDestinations = Promise.resolve([destination]);
    repositoryMock.listDestinationMedia.mockResolvedValue(mediaItems);
    repositoryMock.listDestinationMediaRollup.mockResolvedValue(
      mediaItems.map((mediaItem) => createDestinationRollupItem(destination.id, mediaItem)),
    );

    render(<App />);

    await waitForTripReady();
    await user.click(screen.getByRole('button', { name: 'Balcombe, United Kingdom' }));
    await user.click(await screen.findByRole('button', { name: 'Show image 2: Garden' }));

    expect(screen.queryByRole('dialog', { name: 'Image preview' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open full image: Garden' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open full image: Garden' }));
    const preview = screen.getByRole('dialog', { name: 'Image preview' });
    expect(within(preview).getByRole('img', { name: 'Garden' })).toHaveAttribute('src', '/balcombe-2-full.jpg');

    await user.click(screen.getByRole('button', { name: 'Previous full image' }));

    expect(within(preview).getByRole('img', { name: 'Balcombe lane' })).toHaveAttribute('src', '/balcombe-1-full.jpg');
    expect(screen.getByRole('button', { name: 'Previous full image' })).not.toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Previous full image' }));

    expect(within(preview).getByRole('img', { name: 'Front drive' })).toHaveAttribute('src', '/balcombe-3-full.jpg');
    expect(screen.getByRole('button', { name: 'Next full image' })).not.toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Next full image' }));

    expect(within(preview).getByRole('img', { name: 'Balcombe lane' })).toHaveAttribute('src', '/balcombe-1-full.jpg');
    expect(repositoryMock.reorderDestinationMedia).not.toHaveBeenCalled();
  });

  it('shows stop activities and selects a newly added activity', async () => {
    const user = userEvent.setup();
    const destination = createDestination({
      name: 'Paris',
      countryRegion: 'France',
      coordinates: { lat: 48.8566, lng: 2.3522 },
    });
    const louvre = createActivity({
      destinationId: destination.id,
      title: 'Louvre',
      order: 0,
    });
    const bakery = createActivity({
      destinationId: destination.id,
      title: 'Bakery crawl',
      order: 1,
    });
    repositoryMock.initialDestinations = Promise.resolve([destination]);
    repositoryMock.listActivities.mockResolvedValue([louvre] satisfies Activity[]);
    repositoryMock.createActivity.mockResolvedValue(bakery);

    render(<App />);

    await waitForTripReady();
    await user.click(screen.getByRole('button', { name: 'Paris, France' }));

    expect(screen.getByRole('heading', { name: 'Paris Activities' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select activity Louvre' })).toHaveTextContent('Louvre');
    expect(screen.queryByDisplayValue('Louvre')).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('Search for an activity'), 'Bakery crawl');
    await user.click(screen.getByRole('button', { name: 'Add activity' }));

    expect(repositoryMock.createActivity).toHaveBeenCalledWith({
      destinationId: destination.id,
      title: 'Bakery crawl',
      location: undefined,
    });
    expect(await screen.findByRole('complementary', { name: 'Bakery crawl activity' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select activity Bakery crawl' })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('creates a location-aware activity from stop-proximate activity search', async () => {
    const user = userEvent.setup();
    const destination = createDestination({
      name: 'Paris',
      countryRegion: 'France',
      coordinates: { lat: 48.8566, lng: 2.3522 },
    });
    const louvre = {
      kind: 'place',
      id: 'poi.123',
      label: 'Louvre Museum, Rue de Rivoli, 75001 Paris, France',
      coordinates: { lat: 48.8606, lng: 2.3364 },
      location: {
        placeName: 'Louvre Museum',
        regionName: 'Ile-de-France',
        countryName: 'France',
        countryCode: 'fr',
        sourceLabel: 'Louvre Museum, Rue de Rivoli, 75001 Paris, France',
        sourceProvider: 'maptiler',
        sourceFeatureId: 'poi.123',
      },
      placeTypes: ['poi'],
      placeTypeNames: ['Museum'],
      address: 'Rue de Rivoli',
      context: [],
      distanceFromProximityKm: 1.3,
    } satisfies Awaited<ReturnType<typeof searchMapTilerPlaces>>[number];
    repositoryMock.initialDestinations = Promise.resolve([destination]);
    vi.mocked(searchMapTilerPlaces).mockResolvedValue([louvre]);
    repositoryMock.createActivity.mockImplementation(async (input: CreateActivityInput) =>
      createActivity({ ...input, order: 0 }),
    );

    render(<App />);

    await waitForTripReady();
    await user.click(screen.getByRole('button', { name: 'Paris, France' }));
    await user.type(screen.getByLabelText('Search for an activity'), 'Louvre');
    await user.click(await screen.findByRole('option', { name: 'Louvre Museum, Rue de Rivoli, 75001 Paris, France' }));

    expect(searchMapTilerPlaces).toHaveBeenCalledWith('Louvre', {
      apiKey: expect.any(String),
      profile: 'activity',
      proximity: { lat: 48.8566, lng: 2.3522 },
      bbox: [0.9869, 47.9583, 3.7175, 49.7549],
      fallbackWithoutBbox: true,
    });
    expect(repositoryMock.createActivity).toHaveBeenCalledWith({
      destinationId: destination.id,
      title: 'Louvre Museum',
      location: {
        name: 'Louvre Museum',
        address: 'Rue de Rivoli',
        coordinates: louvre.coordinates,
        sourceProvider: 'maptiler',
        sourceFeatureId: 'poi.123',
      },
    });
    expect(await screen.findByRole('complementary', { name: 'Louvre Museum activity' })).toBeInTheDocument();
  });

  it('opens the activity panel when an existing activity is selected', async () => {
    const user = userEvent.setup();
    const destination = createDestination({
      name: 'Paris',
      countryRegion: 'France',
      coordinates: { lat: 48.8566, lng: 2.3522 },
    });
    const louvre = createActivity({
      destinationId: destination.id,
      title: 'Louvre',
      order: 0,
    });
    repositoryMock.initialDestinations = Promise.resolve([destination]);
    repositoryMock.listActivities.mockResolvedValue([louvre] satisfies Activity[]);

    render(<App />);

    await waitForTripReady();
    await user.click(screen.getByRole('button', { name: 'Paris, France' }));
    await user.click(await screen.findByRole('button', { name: 'Select activity Louvre' }));

    expect(screen.getByRole('complementary', { name: 'Louvre activity' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Paris profile' })).toBeInTheDocument();
    expect(repositoryMock.listActivityMedia).toHaveBeenCalledWith(louvre.id);
  });

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

    await waitForTripReady();
    await userEvent.click(screen.getByRole('button', { name: 'Paris, France' }));
    await screen.findByRole('complementary', { name: 'Paris profile' });

    const map = maplibreMock.mapInstances.at(-1)!;
    triggerMapLayerEvent(map, 'click', 'world-tour-activity-points', {
      features: [{ properties: { id: louvre.id } }],
    });

    expect(await screen.findByRole('complementary', { name: 'Louvre Museum activity' })).toBeInTheDocument();
  });

  it('reverse geocodes coordinates entered for a manual activity location', async () => {
    const user = userEvent.setup();
    const destination = createDestination({
      name: 'Paris',
      countryRegion: 'France',
      coordinates: { lat: 48.8566, lng: 2.3522 },
    });
    const bakery = createActivity({
      destinationId: destination.id,
      title: 'Bakery crawl',
      order: 0,
    });
    repositoryMock.initialDestinations = Promise.resolve([destination]);
    repositoryMock.listActivities.mockResolvedValue([bakery] satisfies Activity[]);
    const updateActivityMock = repositoryMock.updateActivity as unknown as Mock<TripRepository['updateActivity']>;
    updateActivityMock.mockImplementation(async (activityId, patch) => ({
      ...bakery,
      id: activityId,
      ...patch,
      updatedAt: '2026-07-04T12:00:00.000Z',
    }));
    vi.mocked(resolveMapTilerCoordinates).mockResolvedValue(
      createPlaceSearchResult({
        id: 'reverse.75001',
        label: 'Rue de Rivoli, 75001 Paris, France',
        placeName: 'Rue de Rivoli',
        regionName: 'Ile-de-France',
        countryName: 'France',
        coordinates: { lat: 48.8566, lng: 2.3522 },
      }),
    );

    render(<App />);

    await waitForTripReady();
    await user.click(screen.getByRole('button', { name: 'Paris, France' }));
    await user.click(await screen.findByRole('button', { name: 'Select activity Bakery crawl' }));
    const activityPanel = screen.getByRole('complementary', { name: 'Bakery crawl activity' });
    await user.click(within(activityPanel).getByRole('button', { name: 'Edit coordinates' }));
    await user.type(within(activityPanel).getByLabelText('Latitude'), '48.8566');
    await user.type(within(activityPanel).getByLabelText('Longitude'), '2.3522');
    await user.click(within(activityPanel).getByRole('button', { name: 'Save coordinates' }));

    expect(resolveMapTilerCoordinates).toHaveBeenCalledWith(
      { lat: 48.8566, lng: 2.3522 },
      { apiKey: expect.any(String), profile: 'activity' },
    );
    await waitFor(() =>
      expect(repositoryMock.updateActivity).toHaveBeenCalledWith(bakery.id, {
        location: {
          name: 'Rue de Rivoli',
          address: 'Rue de Rivoli, Ile-de-France, France',
          coordinates: { lat: 48.8566, lng: 2.3522 },
          sourceProvider: 'maptiler',
          sourceFeatureId: 'reverse.75001',
        },
      }),
    );
  });

  it('reverse geocodes coordinates edited on a stop before saving the updated address', async () => {
    const user = userEvent.setup();
    const destination = createDestination({
      name: 'Balcombe',
      countryRegion: 'United Kingdom',
      coordinates: { lat: 51.0576, lng: -0.1342 },
      location: {
        placeName: 'Balcombe',
        regionName: 'West Sussex',
        countryName: 'United Kingdom',
        countryCode: 'gb',
        sourceLabel: 'Balcombe, West Sussex, England, United Kingdom',
        sourceProvider: 'maptiler',
        sourceFeatureId: 'place-balcombe',
      },
    });
    repositoryMock.initialDestinations = Promise.resolve([destination]);
    vi.mocked(resolveMapTilerCoordinates).mockResolvedValue(
      createPlaceSearchResult({
        id: 'place-crawley',
        label: 'Crawley, West Sussex, United Kingdom',
        placeName: 'Crawley',
        regionName: 'West Sussex',
        countryName: 'United Kingdom',
        coordinates: { lat: 51.1091, lng: -0.1872 },
      }),
    );

    render(<App />);

    await waitForTripReady();
    await user.click(screen.getByRole('button', { name: 'Select Balcombe' }));
    const stopPanel = screen.getByRole('complementary', { name: 'Balcombe profile' });
    await user.click(within(stopPanel).getByRole('button', { name: 'Edit coordinates' }));
    await user.clear(within(stopPanel).getByLabelText('Latitude'));
    await user.type(within(stopPanel).getByLabelText('Latitude'), '51.1091');
    await user.clear(within(stopPanel).getByLabelText('Longitude'));
    await user.type(within(stopPanel).getByLabelText('Longitude'), '-0.1872');
    await user.keyboard('{Enter}');

    expect(resolveMapTilerCoordinates).toHaveBeenCalledWith(
      { lat: 51.1091, lng: -0.1872 },
      { apiKey: expect.any(String), profile: 'stop' },
    );
    await waitFor(() =>
      expect(repositoryMock.saveDestination).toHaveBeenCalledWith(
        expect.objectContaining({
          id: destination.id,
          coordinates: { lat: 51.1091, lng: -0.1872 },
          countryRegion: 'United Kingdom',
          location: expect.objectContaining({
            placeName: 'Crawley',
            regionName: 'West Sussex',
            countryName: 'United Kingdom',
            sourceProvider: 'maptiler',
            sourceFeatureId: 'place-crawley',
          }),
        }),
      ),
    );
  });

  it('reverse geocodes coordinate edits for an existing activity location', async () => {
    const user = userEvent.setup();
    const destination = createDestination({
      name: 'Paris',
      countryRegion: 'France',
      coordinates: { lat: 48.8566, lng: 2.3522 },
    });
    const location: ActivityLocation = {
      name: 'Louvre Museum',
      address: 'Rue de Rivoli, 75001 Paris, France',
      coordinates: { lat: 48.8606, lng: 2.3364 },
      sourceProvider: 'maptiler',
      sourceFeatureId: 'poi-louvre',
    };
    const louvre = createActivity({
      destinationId: destination.id,
      title: 'Louvre',
      order: 0,
      location,
    });
    repositoryMock.initialDestinations = Promise.resolve([destination]);
    repositoryMock.listActivities.mockResolvedValue([louvre] satisfies Activity[]);
    const updateActivityMock = repositoryMock.updateActivity as unknown as Mock<TripRepository['updateActivity']>;
    updateActivityMock.mockImplementation(async (activityId, patch) => ({
      ...louvre,
      id: activityId,
      ...patch,
      updatedAt: '2026-07-04T12:00:00.000Z',
    }));
    vi.mocked(resolveMapTilerCoordinates).mockResolvedValue(
      createPlaceSearchResult({
        id: 'reverse.75001',
        label: '6 Place de l Hotel de Ville, 75004 Paris, France',
        placeName: 'Hotel de Ville',
        regionName: 'Ile-de-France',
        countryName: 'France',
        coordinates: { lat: 48.8566, lng: 2.3522 },
      }),
    );

    render(<App />);

    await waitForTripReady();
    await user.click(screen.getByRole('button', { name: 'Paris, France' }));
    await user.click(await screen.findByRole('button', { name: 'Select activity Louvre' }));
    const activityPanel = screen.getByRole('complementary', { name: 'Louvre activity' });
    await user.click(within(activityPanel).getByRole('button', { name: 'Edit coordinates' }));
    await user.clear(within(activityPanel).getByLabelText('Latitude'));
    await user.type(within(activityPanel).getByLabelText('Latitude'), '48.8566');
    await user.clear(within(activityPanel).getByLabelText('Longitude'));
    await user.type(within(activityPanel).getByLabelText('Longitude'), '2.3522');
    await user.keyboard('{Enter}');

    expect(resolveMapTilerCoordinates).toHaveBeenCalledWith(
      { lat: 48.8566, lng: 2.3522 },
      { apiKey: expect.any(String), profile: 'activity' },
    );
    await waitFor(() =>
      expect(repositoryMock.updateActivity).toHaveBeenCalledWith(louvre.id, {
        location: {
          name: 'Hotel de Ville',
          address: 'Hotel de Ville, Ile-de-France, France',
          coordinates: { lat: 48.8566, lng: 2.3522 },
          sourceProvider: 'maptiler',
          sourceFeatureId: 'reverse.75001',
        },
      }),
    );
  });

  it('closes only the activity panel with Escape', async () => {
    const user = userEvent.setup();
    const destination = createDestination({
      name: 'Paris',
      countryRegion: 'France',
      coordinates: { lat: 48.8566, lng: 2.3522 },
    });
    const louvre = createActivity({
      destinationId: destination.id,
      title: 'Louvre',
      order: 0,
    });
    repositoryMock.initialDestinations = Promise.resolve([destination]);
    repositoryMock.listActivities.mockResolvedValue([louvre] satisfies Activity[]);

    render(<App />);

    await waitForTripReady();
    await user.click(screen.getByRole('button', { name: 'Paris, France' }));
    await user.click(await screen.findByRole('button', { name: 'Select activity Louvre' }));

    expect(screen.getByRole('complementary', { name: 'Louvre activity' })).toBeInTheDocument();

    const wasNotCanceled = fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });

    expect(wasNotCanceled).toBe(false);
    expect(screen.queryByRole('complementary', { name: 'Louvre activity' })).not.toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Paris profile' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select activity Louvre' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('scrolls the selected activity panel into view on mobile', async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(max-width: 760px)',
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    const destination = createDestination({
      name: 'Paris',
      countryRegion: 'France',
      coordinates: { lat: 48.8566, lng: 2.3522 },
    });
    const louvre = createActivity({
      destinationId: destination.id,
      title: 'Louvre',
      order: 0,
    });
    repositoryMock.initialDestinations = Promise.resolve([destination]);
    repositoryMock.listActivities.mockResolvedValue([louvre] satisfies Activity[]);

    render(<App />);

    await waitForTripReady();
    await user.click(screen.getByRole('button', { name: 'Paris, France' }));
    await user.click(await screen.findByRole('button', { name: 'Select activity Louvre' }));

    expect(await screen.findByRole('complementary', { name: 'Louvre activity' })).toBeInTheDocument();
    await waitFor(() =>
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', inline: 'nearest' }),
    );
  });

  it('uploads activity panel media through activity-owned storage', async () => {
    const user = userEvent.setup();
    const destination = createDestination({
      name: 'Paris',
      countryRegion: 'France',
      coordinates: { lat: 48.8566, lng: 2.3522 },
    });
    const louvre = createActivity({
      destinationId: destination.id,
      title: 'Louvre',
      order: 0,
    });
    const file = new File(['image-bytes'], 'louvre.jpg', { type: 'image/jpeg' });
    repositoryMock.initialDestinations = Promise.resolve([destination]);
    repositoryMock.listActivities.mockResolvedValue([louvre] satisfies Activity[]);
    repositoryMock.uploadActivityMedia.mockResolvedValue(
      createMediaItem({
        id: 'activity-media-upload',
        url: '/louvre.jpg',
        caption: 'Louvre',
      }),
    );

    render(<App />);

    await waitForTripReady();
    await user.click(screen.getByRole('button', { name: 'Paris, France' }));
    await user.click(await screen.findByRole('button', { name: 'Select activity Louvre' }));
    const input = screen.getByLabelText('Choose activity images file input') as HTMLInputElement;

    await user.upload(input, file);

    expect(repositoryMock.uploadActivityMedia).toHaveBeenCalledWith({
      destinationId: destination.id,
      activityId: louvre.id,
      file,
    });
  });

  it('shows activity attribution on the selected stop preview image', async () => {
    const user = userEvent.setup();
    const destination = createDestination({
      name: 'Paris',
      countryRegion: 'France',
      coordinates: { lat: 48.8566, lng: 2.3522 },
    });
    const louvre = createActivity({
      destinationId: destination.id,
      title: 'Louvre',
      order: 0,
    });
    repositoryMock.initialDestinations = Promise.resolve([destination]);
    repositoryMock.listActivities.mockResolvedValue([louvre] satisfies Activity[]);
    repositoryMock.listDestinationMedia.mockResolvedValue([createMediaItem({ id: 'stop-media-1', url: '/paris.jpg' })]);
    repositoryMock.listDestinationMediaRollup.mockResolvedValue([
      {
        mediaItem: createMediaItem({
          id: 'stop-media-1',
          url: '/paris.jpg',
          caption: 'Paris street',
          sortOrder: 0,
        }),
        ownerType: 'destination',
        destinationId: destination.id,
        canReorderInStopCarousel: true,
      },
      {
        mediaItem: createMediaItem({
          id: 'activity-media-1',
          url: '/louvre.jpg',
          caption: 'Museum wing',
          sortOrder: 0,
        }),
        ownerType: 'activity',
        destinationId: destination.id,
        activityId: louvre.id,
        activityTitle: 'Louvre',
        canReorderInStopCarousel: false,
      },
    ] satisfies MediaRollupItem[]);

    render(<App />);

    await waitForTripReady();
    await user.click(screen.getByRole('button', { name: 'Paris, France' }));
    await user.click(await screen.findByRole('button', { name: 'Show image 2: Museum wing' }));

    expect(within(screen.getByRole('group', { name: 'Image preview' })).getByText('Louvre')).toHaveClass(
      'destination-image-attribution',
    );
  });

  it('opens an activity-owned rollup image in the modal without reordering destination media', async () => {
    const user = userEvent.setup();
    const destination = createDestination({
      name: 'Paris',
      countryRegion: 'France',
      coordinates: { lat: 48.8566, lng: 2.3522 },
    });
    const louvre = createActivity({
      destinationId: destination.id,
      title: 'Louvre',
      order: 0,
    });
    repositoryMock.initialDestinations = Promise.resolve([destination]);
    repositoryMock.listActivities.mockResolvedValue([louvre] satisfies Activity[]);
    repositoryMock.listDestinationMedia.mockResolvedValue([createMediaItem({ id: 'stop-media-1', url: '/paris.jpg' })]);
    repositoryMock.listDestinationMediaRollup.mockResolvedValue([
      {
        mediaItem: createMediaItem({
          id: 'stop-media-1',
          url: '/paris.jpg',
          caption: 'Paris street',
          fullUrl: '/paris-full.jpg',
          sortOrder: 0,
        }),
        ownerType: 'destination',
        destinationId: destination.id,
        canReorderInStopCarousel: true,
      },
      {
        mediaItem: createMediaItem({
          id: 'activity-media-1',
          url: '/louvre.jpg',
          caption: 'Museum wing',
          fullUrl: '/louvre-full.jpg',
          sortOrder: 0,
        }),
        ownerType: 'activity',
        destinationId: destination.id,
        activityId: louvre.id,
        activityTitle: 'Louvre',
        canReorderInStopCarousel: false,
      },
    ] satisfies MediaRollupItem[]);

    render(<App />);

    await waitForTripReady();
    await user.click(screen.getByRole('button', { name: 'Paris, France' }));
    await user.click(await screen.findByRole('button', { name: 'Show image 2: Museum wing' }));
    await user.click(screen.getByRole('button', { name: 'Open full image: Museum wing' }));

    const preview = screen.getByRole('dialog', { name: 'Image preview' });
    expect(within(preview).getByRole('img', { name: 'Museum wing' })).toHaveAttribute('src', '/louvre-full.jpg');
    await user.click(within(preview).getByRole('button', { name: 'Open activity Louvre' }));

    expect(screen.queryByRole('dialog', { name: 'Image preview' })).not.toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Louvre activity' })).toBeInTheDocument();
    expect(repositoryMock.reorderDestinationMedia).not.toHaveBeenCalled();
  });

  it('keeps activity panel preview navigation scoped to activity media when the image also appears in stop rollup', async () => {
    const user = userEvent.setup();
    const destination = createDestination({
      name: 'Paris',
      countryRegion: 'France',
      coordinates: { lat: 48.8566, lng: 2.3522 },
    });
    const louvre = createActivity({
      destinationId: destination.id,
      title: 'Louvre',
      order: 0,
    });
    repositoryMock.initialDestinations = Promise.resolve([destination]);
    repositoryMock.listActivities.mockResolvedValue([louvre] satisfies Activity[]);
    repositoryMock.listActivityMedia.mockResolvedValue([
      createMediaItem({
        id: 'activity-media-1',
        url: '/louvre.jpg',
        caption: 'Museum wing',
        fullUrl: '/louvre-full.jpg',
        sortOrder: 0,
      }),
      createMediaItem({
        id: 'activity-media-2',
        url: '/louvre-detail.jpg',
        caption: 'Activity detail',
        fullUrl: '/louvre-detail-full.jpg',
        sortOrder: 1,
      }),
    ]);
    repositoryMock.listDestinationMediaRollup.mockResolvedValue([
      {
        mediaItem: createMediaItem({
          id: 'stop-media-1',
          url: '/paris.jpg',
          caption: 'Paris street',
          fullUrl: '/paris-full.jpg',
          sortOrder: 0,
        }),
        ownerType: 'destination',
        destinationId: destination.id,
        canReorderInStopCarousel: true,
      },
      {
        mediaItem: createMediaItem({
          id: 'activity-media-1',
          url: '/louvre.jpg',
          caption: 'Museum wing',
          fullUrl: '/louvre-full.jpg',
          sortOrder: 0,
        }),
        ownerType: 'activity',
        destinationId: destination.id,
        activityId: louvre.id,
        activityTitle: 'Louvre',
        canReorderInStopCarousel: false,
      },
    ] satisfies MediaRollupItem[]);

    render(<App />);

    await waitForTripReady();
    await user.click(screen.getByRole('button', { name: 'Paris, France' }));
    await user.click(await screen.findByRole('button', { name: 'Select activity Louvre' }));
    const activityPanel = screen.getByRole('complementary', { name: 'Louvre activity' });
    await user.click(await within(activityPanel).findByRole('button', { name: 'Open full image: Museum wing' }));

    const preview = screen.getByRole('dialog', { name: 'Image preview' });
    expect(within(preview).queryByText('Louvre')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next full image' }));

    expect(within(preview).getByRole('img', { name: 'Activity detail' })).toHaveAttribute(
      'src',
      '/louvre-detail-full.jpg',
    );
    expect(repositoryMock.reorderDestinationMedia).not.toHaveBeenCalled();
  });

  it('keeps modal previous and next navigation from reordering rollup images', async () => {
    const user = userEvent.setup();
    const destination = createDestination({
      name: 'Paris',
      countryRegion: 'France',
      coordinates: { lat: 48.8566, lng: 2.3522 },
    });
    const louvre = createActivity({
      destinationId: destination.id,
      title: 'Louvre',
      order: 0,
    });
    repositoryMock.initialDestinations = Promise.resolve([destination]);
    repositoryMock.listActivities.mockResolvedValue([louvre] satisfies Activity[]);
    repositoryMock.listDestinationMedia.mockResolvedValue([createMediaItem({ id: 'stop-media-1', url: '/paris.jpg' })]);
    repositoryMock.listDestinationMediaRollup.mockResolvedValue([
      {
        mediaItem: createMediaItem({
          id: 'stop-media-1',
          url: '/paris.jpg',
          caption: 'Paris street',
          fullUrl: '/paris-full.jpg',
          sortOrder: 0,
        }),
        ownerType: 'destination',
        destinationId: destination.id,
        canReorderInStopCarousel: true,
      },
      {
        mediaItem: createMediaItem({
          id: 'activity-media-1',
          url: '/louvre.jpg',
          caption: 'Museum wing',
          fullUrl: '/louvre-full.jpg',
          sortOrder: 0,
        }),
        ownerType: 'activity',
        destinationId: destination.id,
        activityId: louvre.id,
        activityTitle: 'Louvre',
        canReorderInStopCarousel: false,
      },
    ] satisfies MediaRollupItem[]);

    render(<App />);

    await waitForTripReady();
    await user.click(screen.getByRole('button', { name: 'Paris, France' }));
    await user.click(await screen.findByRole('button', { name: 'Open full image: Paris street' }));
    const preview = screen.getByRole('dialog', { name: 'Image preview' });

    await user.click(screen.getByRole('button', { name: 'Next full image' }));
    expect(within(preview).getByRole('img', { name: 'Museum wing' })).toHaveAttribute('src', '/louvre-full.jpg');

    await user.click(screen.getByRole('button', { name: 'Previous full image' }));
    expect(within(preview).getByRole('img', { name: 'Paris street' })).toHaveAttribute('src', '/paris-full.jpg');
    expect(repositoryMock.reorderDestinationMedia).not.toHaveBeenCalled();
  });

  it('ignores stale stop rollup reloads after switching stops during activity media upload', async () => {
    const user = userEvent.setup();
    const paris = createDestination({
      name: 'Paris',
      countryRegion: 'France',
      coordinates: { lat: 48.8566, lng: 2.3522 },
      order: 0,
    });
    const rome = createDestination({
      name: 'Rome',
      countryRegion: 'Italy',
      coordinates: { lat: 41.9028, lng: 12.4964 },
      order: 1,
    });
    const louvre = createActivity({
      destinationId: paris.id,
      title: 'Louvre',
      order: 0,
    });
    const upload = createDeferred<MediaItem>();
    const file = new File(['image-bytes'], 'louvre.jpg', { type: 'image/jpeg' });
    repositoryMock.initialDestinations = Promise.resolve([paris, rome]);
    repositoryMock.listActivities.mockImplementation(async (destinationId: string) =>
      destinationId === paris.id ? [louvre] : [],
    );
    repositoryMock.uploadActivityMedia.mockReturnValue(upload.promise);
    repositoryMock.listDestinationMediaRollup.mockImplementation(async (destinationId: string) =>
      destinationId === paris.id
        ? [
            {
              mediaItem: createMediaItem({
                id: 'paris-stale-media',
                url: '/paris-stale.jpg',
                caption: 'Paris stale',
              }),
              ownerType: 'destination',
              destinationId: paris.id,
              canReorderInStopCarousel: true,
            },
          ]
        : [
            {
              mediaItem: createMediaItem({
                id: 'rome-media',
                url: '/rome.jpg',
                caption: 'Rome street',
              }),
              ownerType: 'destination',
              destinationId: rome.id,
              canReorderInStopCarousel: true,
            },
          ],
    );

    render(<App />);

    await waitForTripReady();
    await user.click(screen.getByRole('button', { name: 'Paris, France' }));
    await user.click(await screen.findByRole('button', { name: 'Select activity Louvre' }));
    await user.upload(
      screen.getByLabelText('Choose activity images file input') as HTMLInputElement,
      file,
    );
    await user.click(screen.getByRole('button', { name: 'Rome, Italy' }));

    expect(await screen.findByRole('button', { name: 'Open full image: Rome street' })).toBeInTheDocument();

    await act(async () => {
      upload.resolve(
        createMediaItem({
          id: 'activity-uploaded',
          url: '/louvre.jpg',
          caption: 'Uploaded Louvre',
        }),
      );
      await upload.promise;
    });

    expect(screen.getByRole('button', { name: 'Open full image: Rome street' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open full image: Paris stale' })).not.toBeInTheDocument();
  });

  it('clears old stop rollup media when the newly selected stop rollup fails to load', async () => {
    const user = userEvent.setup();
    const paris = createDestination({
      name: 'Paris',
      countryRegion: 'France',
      coordinates: { lat: 48.8566, lng: 2.3522 },
      order: 0,
    });
    const rome = createDestination({
      name: 'Rome',
      countryRegion: 'Italy',
      coordinates: { lat: 41.9028, lng: 12.4964 },
      order: 1,
    });
    repositoryMock.initialDestinations = Promise.resolve([paris, rome]);
    repositoryMock.listDestinationMediaRollup.mockImplementation(async (destinationId: string) => {
      if (destinationId === rome.id) {
        throw new Error('Rome rollup failed');
      }

      return [
        {
          mediaItem: createMediaItem({
            id: 'paris-media',
            url: '/paris.jpg',
            caption: 'Paris street',
          }),
          ownerType: 'destination',
          destinationId: paris.id,
          canReorderInStopCarousel: true,
        },
      ];
    });

    render(<App />);

    await waitForTripReady();
    await user.click(screen.getByRole('button', { name: 'Paris, France' }));
    expect(await screen.findByRole('button', { name: 'Open full image: Paris street' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Rome, Italy' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Rome rollup failed');
    expect(screen.queryByRole('button', { name: 'Open full image: Paris street' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show image 1: Paris street' })).not.toBeInTheDocument();
  });

  it('keeps mutation actions unavailable while trip data is loading', async () => {
    const initialDestinations = createDeferred<Destination[]>();
    const initialRouteLegs = createDeferred<RouteLeg[]>();
    repositoryMock.initialDestinations = initialDestinations.promise;
    repositoryMock.initialRouteLegs = initialRouteLegs.promise;

    render(<App />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading world tour');
    expect(screen.queryByLabelText('Search for a destination')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add stop at map center' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export trip data' })).not.toBeInTheDocument();

    await waitFor(() => expect(maplibreMock.mapInstances.length).toBeGreaterThan(0));
    const currentMap = maplibreMock.mapInstances.at(-1)!;
    const doubleClickHandler = currentMap.on.mock.calls.find(
      ([eventName]) => eventName === 'dblclick',
    )?.[1];
    expect(doubleClickHandler).toBeUndefined();

    expect(repositoryMock.saveDestination).not.toHaveBeenCalled();

    await act(async () => {
      initialDestinations.resolve([]);
      initialRouteLegs.resolve([]);
    });
    await waitForTripReady();
    expect(screen.getByLabelText('Search for a destination')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export trip data' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Import trip data' })).not.toBeInTheDocument();
  });
});

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

function createPlaceSearchResult(input: {
  id: string;
  label: string;
  placeName: string;
  regionName: string;
  countryName: string;
  coordinates: Destination['coordinates'];
}): Awaited<ReturnType<typeof resolveMapTilerCoordinates>> {
  return {
    kind: 'place',
    id: input.id,
    label: input.label,
    coordinates: input.coordinates,
    location: {
      placeName: input.placeName,
      regionName: input.regionName,
      countryName: input.countryName,
      sourceLabel: [input.placeName, input.regionName, input.countryName].filter(Boolean).join(', '),
      sourceProvider: 'maptiler',
      sourceFeatureId: input.id,
    },
  };
}

function createMediaItem(input: Partial<MediaItem> & Pick<MediaItem, 'id' | 'url'>): MediaItem {
  return {
    caption: '',
    credit: '',
    sortOrder: 0,
    ...input,
  };
}

function createDestinationRollupItem(
  destinationId: string,
  mediaItem: MediaItem,
): MediaRollupItem {
  return {
    mediaItem,
    ownerType: 'destination',
    destinationId,
    canReorderInStopCarousel: true,
  };
}

function getMapEventHandler(map: MockMap, eventName: string): (...args: unknown[]) => void {
  const handler = map.on.mock.calls.find(([calledEventName]) => calledEventName === eventName)?.[1];
  expect(handler).toEqual(expect.any(Function));

  return handler as (...args: unknown[]) => void;
}

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

function expectNoStatusPlaceholderPin() {
  expect(screen.queryByRole('button', { name: 'Select App status placeholder' })).not.toBeInTheDocument();
}

async function openContextMenuMapStop(coordinates: Destination['coordinates']) {
  await waitForTripReady();
  await waitFor(() => expect(maplibreMock.mapInstances.length).toBeGreaterThan(0));

  const contextMenuHandler = getMapEventHandler(maplibreMock.mapInstances.at(-1)!, 'contextmenu');
  act(() => {
    contextMenuHandler({
      preventDefault: vi.fn(),
      lngLat: coordinates,
      point: { x: 300, y: 220 },
    });
  });
  await userEvent.click(screen.getByRole('menuitem', { name: 'Add stop here' }));
}
