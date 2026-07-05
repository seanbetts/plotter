import { describe, expect, it, vi } from 'vitest';
import type { Activity, Destination, RouteLeg } from '../domain/types';
import { createAppTripRepository, ensureAnonymousSession } from './appRepository';
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
    const createSupabaseClient = vi.fn();
    const user = { id: crypto.randomUUID() };
    const storage = {
      getItem: vi.fn(() => 'true'),
      setItem: vi.fn(),
    };
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
      storage,
      createSupabaseClient: () => {
        createSupabaseClient();
        return supabase;
      },
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

  it('migrates local trip data into an empty Supabase trip during bootstrap', async () => {
    const user = { id: crypto.randomUUID() };
    const destination = { id: crypto.randomUUID() } as Destination;
    const routeLeg = { id: crypto.randomUUID() } as RouteLeg;
    const activity = {
      id: crypto.randomUUID(),
      destinationId: destination.id,
    } as Activity;
    const localRepository = createMockRepository({
      destinations: [destination],
      routeLegs: [routeLeg],
      activities: [activity],
    });
    const cloudRepository = createMockRepository();
    const storage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    };
    const supabase = {
      auth: {
        getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
        signInAnonymously: vi.fn(async () => ({ data: { user }, error: null })),
      },
    };

    const repository = await createAppTripRepository({
      isSupabaseConfigured: true,
      localRepository,
      storage,
      createSupabaseClient: () => supabase,
      createSupabaseRepository: () => cloudRepository,
    });

    expect(repository).toBe(cloudRepository);
    expect(cloudRepository.replaceTripData).toHaveBeenCalledWith({
      destinations: [destination],
      routeLegs: [routeLeg],
      activities: [activity],
    });
    expect(storage.setItem).toHaveBeenCalledWith(
      `world-tour:supabase-migrated:${user.id}`,
      'true',
    );
  });
});
