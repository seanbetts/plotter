import { describe, expect, it, vi } from 'vitest';
import type { Activity, Destination, RouteLeg } from '../domain/types';
import { standardRoutingVehicle } from '../domain/vehiclePresets';
import {
  createAppTripRepository,
  createAppTripStorage,
  selectedTripStorageKey,
} from './appRepository';
import type { PlotterApiClient } from '../api/client';
import type { TripDb } from './tripDb';
import type { TripRepository } from './tripRepository';

function createMockRepository(snapshot: {
  destinations?: Destination[];
  routeLegs?: RouteLeg[];
  activities?: Activity[];
} = {}): TripRepository {
  return {
    listDestinations: vi.fn(async () => snapshot.destinations ?? []),
    saveDestination: vi.fn(),
    deleteDestination: vi.fn(),
    applyTripMutation: vi.fn(),
    listActivities: vi.fn(async (destinationId: string) =>
      (snapshot.activities ?? []).filter((activity) => activity.destinationId === destinationId),
    ),
    createActivity: vi.fn(),
    updateActivity: vi.fn(),
    deleteActivity: vi.fn(),
    reorderActivities: vi.fn(),
    listRouteLegs: vi.fn(async () => snapshot.routeLegs ?? []),
    saveRouteLeg: vi.fn(),
    deleteRouteLeg: vi.fn(),
    replaceTripData: vi.fn(),
    listDestinationMedia: vi.fn(),
    uploadDestinationMedia: vi.fn(),
    importDestinationMediaFromSearch: vi.fn(),
    updateDestinationMedia: vi.fn(),
    deleteDestinationMedia: vi.fn(),
    reorderDestinationMedia: vi.fn(),
    listDestinationMediaRollup: vi.fn(async () => []),
    listActivityMedia: vi.fn(async () => []),
    uploadActivityMedia: vi.fn(),
    importActivityMediaFromSearch: vi.fn(),
    updateActivityMedia: vi.fn(),
    deleteActivityMedia: vi.fn(),
    reorderActivityMedia: vi.fn(),
  };
}

describe('app repository bootstrap', () => {
  it.each([undefined, 'e2e-service'])(
    'uses service repositories in %s mode without checking Supabase or opening local storage',
    async (tripStorageMode) => {
      const trip = {
        id: 'trip-1',
        name: 'Example trip',
        description: '',
        routingVehicle: standardRoutingVehicle,
        createdAt: '2026-07-01T10:00:00.000Z',
        updatedAt: '2026-07-01T10:00:00.000Z',
      };
      const client: PlotterApiClient = {
        request: vi.fn(async (path: string) => {
          if (path === '/api/v1/trips') return { revision: 3, trips: [trip] };
          if (path === '/api/v1/trips/trip-1') {
            return { revision: 7, destinations: [], routeLegs: [], activities: [] };
          }
          throw new Error(`Unexpected request: ${path}`);
        }) as PlotterApiClient['request'],
        upload: vi.fn(),
      };
      const createSupabaseClient = vi.fn();
      const createLocalRepository = vi.fn();
      const realtime = {
        subscribeToDirectory: vi.fn(),
        subscribeToTrip: vi.fn(),
        reconcile: vi.fn(),
      };

      const storage = await createAppTripStorage({
        tripStorageMode,
        isSupabaseConfigured: false,
        createSupabaseClient,
        createLocalRepository,
        serviceClient: client,
        createRealtime: () => realtime,
      });

      await expect(storage.directory.listTrips()).resolves.toEqual([trip]);
      await expect(storage.createTripRepository(trip.id).loadSnapshot?.()).resolves.toEqual({
        revision: 7,
        destinations: [],
        routeLegs: [],
        activities: [],
      });
      expect(storage.realtime).toBe(realtime);
      expect(createSupabaseClient).not.toHaveBeenCalled();
      expect(createLocalRepository).not.toHaveBeenCalled();
    },
  );

  it('uses the local repository for the explicit e2e storage mode', async () => {
    const localRepository = createMockRepository();
    const createSupabaseClient = vi.fn();

    const repository = await createAppTripRepository({
      isSupabaseConfigured: false,
      tripStorageMode: 'e2e-local',
      localRepository,
      createSupabaseClient,
      createSupabaseRepository: vi.fn(),
    });

    expect(repository).toBe(localRepository);
    expect(createSupabaseClient).not.toHaveBeenCalled();
  });

  it('loads the Dexie database only for the explicit e2e-local mode', async () => {
    const loadLocalDb = vi.fn(async () => ({} as TripDb));

    await createAppTripStorage({
      tripStorageMode: 'e2e-local',
      loadLocalDb,
    });

    expect(loadLocalDb).toHaveBeenCalledTimes(1);
  });

  it('returns local directory and trip repository factory for e2e-local mode', async () => {
    const localRepository = createMockRepository();
    const localDirectory = {
      listTrips: vi.fn(),
      createTrip: vi.fn(),
      updateTrip: vi.fn(),
      deleteTrip: vi.fn(),
    };
    const createSupabaseClient = vi.fn();

    const storage = await createAppTripStorage({
      isSupabaseConfigured: false,
      tripStorageMode: 'e2e-local',
      localRepository,
      localDirectory,
      createSupabaseClient,
    });

    expect(storage.directory).toBe(localDirectory);
    expect(storage.createTripRepository('trip-1')).toBe(localRepository);
    expect(createSupabaseClient).not.toHaveBeenCalled();
    expect('realtime' in storage).toBe(false);
  });

  it('exports the selected trip storage key used by the app shell', () => {
    expect(selectedTripStorageKey).toBe('plotter:selected-trip-id');
  });
});
