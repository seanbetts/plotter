import { describe, expect, it, vi } from 'vitest';
import type { Activity, Destination, RouteLeg } from '../domain/types';
import { standardRoutingVehicle } from '../domain/vehiclePresets';
import {
  createAppTripRepository,
  createAppTripStorage,
  ensureAnonymousSession,
  selectedTripStorageKey,
} from './appRepository';
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
  it('signs in anonymously when no Supabase user exists', async () => {
    const user = { id: crypto.randomUUID() };
    const supabase = {
      auth: {
        getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
        signInAnonymously: vi.fn(async () => ({ data: { user }, error: null })),
      },
    };

    await expect(ensureAnonymousSession(supabase)).resolves.toBe(user);
    expect(supabase.auth.signInAnonymously).toHaveBeenCalledTimes(1);
  });

  it('reuses an existing Supabase user session without creating a new anonymous user', async () => {
    const user = { id: crypto.randomUUID() };
    const supabase = {
      auth: {
        getUser: vi.fn(async () => ({ data: { user }, error: null })),
        signInAnonymously: vi.fn(),
      },
    };

    await expect(ensureAnonymousSession(supabase)).resolves.toBe(user);
    expect(supabase.auth.signInAnonymously).not.toHaveBeenCalled();
  });

  it('requires Supabase configuration instead of falling back to local storage', async () => {
    const localRepository = createMockRepository();

    await expect(createAppTripRepository({
      isSupabaseConfigured: false,
      localRepository,
      createSupabaseClient: vi.fn(),
      createSupabaseRepository: vi.fn(),
    })).rejects.toThrow('Supabase is not configured');

    expect(localRepository.listDestinations).not.toHaveBeenCalled();
  });

  it('ignores the old local storage mode override', async () => {
    const localRepository = createMockRepository();
    const cloudRepository = createMockRepository();
    const cloudDirectory = {
      listTrips: vi.fn(async () => [{
        id: 'trip-1',
        name: 'World tour',
        description: '',
        routingVehicle: standardRoutingVehicle,
        createdAt: '2026-07-01T10:00:00.000Z',
        updatedAt: '2026-07-01T10:00:00.000Z',
      }]),
      createTrip: vi.fn(),
      updateTrip: vi.fn(),
      deleteTrip: vi.fn(),
    };
    const createSupabaseClient = vi.fn();
    const user = { id: crypto.randomUUID() };
    const supabase = {
      auth: {
        getUser: vi.fn(async () => ({ data: { user }, error: null })),
        signInAnonymously: vi.fn(),
      },
    };

    const repository = await createAppTripRepository({
      isSupabaseConfigured: true,
      tripStorageMode: 'local',
      localRepository,
      createSupabaseClient: () => {
        createSupabaseClient();
        return supabase;
      },
      createSupabaseDirectory: () => cloudDirectory,
      createSupabaseRepository: () => cloudRepository,
    });

    expect(repository).toBe(cloudRepository);
    expect(createSupabaseClient).toHaveBeenCalledTimes(1);
    expect(localRepository.listDestinations).not.toHaveBeenCalled();
  });

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

  it('returns a trip directory and explicit Supabase trip repository factory', async () => {
    const user = { id: crypto.randomUUID() };
    const supabase = {
      auth: {
        getUser: vi.fn(async () => ({ data: { user }, error: null })),
        signInAnonymously: vi.fn(),
      },
    };
    const createSupabaseDirectory = vi.fn(() => ({
      listTrips: vi.fn(),
      createTrip: vi.fn(),
      updateTrip: vi.fn(),
      deleteTrip: vi.fn(),
    }));
    const createSupabaseRepository = vi.fn(() => createMockRepository());

    const storage = await createAppTripStorage({
      isSupabaseConfigured: true,
      createSupabaseClient: () => supabase,
      createSupabaseDirectory,
      createSupabaseRepository,
    });

    expect(createSupabaseDirectory).toHaveBeenCalledWith(supabase);
    storage.createTripRepository('trip-1');
    expect(createSupabaseRepository).toHaveBeenCalledWith(supabase, 'trip-1');
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

  it('returns Supabase realtime subscriptions for Supabase storage', async () => {
    const user = { id: crypto.randomUUID() };
    const supabase = {
      auth: {
        getUser: vi.fn(async () => ({ data: { user }, error: null })),
        signInAnonymously: vi.fn(),
      },
      channel: vi.fn(),
      removeChannel: vi.fn(),
    };
    const createSupabaseDirectory = vi.fn(() => ({
      listTrips: vi.fn(),
      createTrip: vi.fn(),
      updateTrip: vi.fn(),
      deleteTrip: vi.fn(),
    }));

    const storage = await createAppTripStorage({
      isSupabaseConfigured: true,
      createSupabaseClient: () => supabase,
      createSupabaseDirectory,
      createSupabaseRepository: vi.fn(() => createMockRepository()),
    });

    expect((storage as { realtime?: unknown }).realtime).toEqual({
      subscribeToTrips: expect.any(Function),
      subscribeToTripData: expect.any(Function),
    });
  });

  it('exports the selected trip storage key used by the app shell', () => {
    expect(selectedTripStorageKey).toBe('world-tour:selected-trip-id');
  });
});
