import { describe, expect, it, vi } from 'vitest';
import { createDestination } from '../domain/destinations';
import type { Destination, RouteLeg } from '../domain/types';
import { createAppTripRepository, ensureAnonymousSession } from './appRepository';
import type { TripRepository } from './tripRepository';

function createMockRepository(snapshot: {
  destinations?: Destination[];
  routeLegs?: RouteLeg[];
} = {}): TripRepository {
  return {
    listDestinations: vi.fn(async () => snapshot.destinations ?? []),
    saveDestination: vi.fn(),
    deleteDestination: vi.fn(),
    listRouteLegs: vi.fn(async () => snapshot.routeLegs ?? []),
    saveRouteLeg: vi.fn(),
    deleteRouteLeg: vi.fn(),
    replaceTripData: vi.fn(),
  };
}

function createMockStorage() {
  const values = new Map<string, string>();

  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
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

  it('falls back to the local repository when Supabase is not configured', async () => {
    const localRepository = createMockRepository();

    const repository = await createAppTripRepository({
      isSupabaseConfigured: false,
      localRepository,
      createSupabaseClient: vi.fn(),
      createSupabaseRepository: vi.fn(),
    });

    expect(repository).toBe(localRepository);
  });

  it('uses the local repository when the storage mode is forced to local', async () => {
    const localRepository = createMockRepository();
    const createSupabaseClient = vi.fn();

    const repository = await createAppTripRepository({
      isSupabaseConfigured: true,
      tripStorageMode: 'local',
      localRepository,
      createSupabaseClient,
      createSupabaseRepository: vi.fn(),
    });

    expect(repository).toBe(localRepository);
    expect(createSupabaseClient).not.toHaveBeenCalled();
  });

  it('uploads existing local trip data once after anonymous Supabase bootstrap', async () => {
    const user = { id: crypto.randomUUID() };
    const localDestination = createDestination({
      name: 'Oslo',
      coordinates: { lat: 59.9139, lng: 10.7522 },
    });
    const localRepository = createMockRepository({
      destinations: [localDestination],
      routeLegs: [],
    });
    const cloudRepository = createMockRepository();
    const storage = createMockStorage();
    const supabase = {
      auth: {
        getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
        signInAnonymously: vi.fn(async () => ({ data: { user }, error: null })),
      },
    };

    const repository = await createAppTripRepository({
      isSupabaseConfigured: true,
      localRepository,
      createSupabaseClient: () => supabase,
      createSupabaseRepository: () => cloudRepository,
      storage,
    });

    expect(repository).toBe(cloudRepository);
    expect(cloudRepository.replaceTripData).toHaveBeenCalledWith({
      destinations: [localDestination],
      routeLegs: [],
    });
    expect(storage.setItem).toHaveBeenCalledWith(`world-tour:supabase-migrated:${user.id}`, 'true');
  });

  it('does not overwrite existing Supabase trip data during local migration', async () => {
    const user = { id: crypto.randomUUID() };
    const localDestination = createDestination({
      name: 'Local',
      coordinates: { lat: 1, lng: 1 },
    });
    const cloudDestination = createDestination({
      name: 'Cloud',
      coordinates: { lat: 2, lng: 2 },
    });
    const localRepository = createMockRepository({
      destinations: [localDestination],
      routeLegs: [],
    });
    const cloudRepository = createMockRepository({
      destinations: [cloudDestination],
      routeLegs: [],
    });

    await createAppTripRepository({
      isSupabaseConfigured: true,
      localRepository,
      createSupabaseClient: () => ({
        auth: {
          getUser: vi.fn(async () => ({ data: { user }, error: null })),
          signInAnonymously: vi.fn(),
        },
      }),
      createSupabaseRepository: () => cloudRepository,
      storage: createMockStorage(),
    });

    expect(cloudRepository.replaceTripData).not.toHaveBeenCalled();
  });
});
