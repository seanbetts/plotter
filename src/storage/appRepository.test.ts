import { describe, expect, it, vi } from 'vitest';
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
    listDestinationMedia: vi.fn(),
    uploadDestinationMedia: vi.fn(),
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
    const supabase = {
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: crypto.randomUUID() } }, error: null })),
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
      createSupabaseRepository: () => cloudRepository,
    });

    expect(repository).toBe(cloudRepository);
    expect(createSupabaseClient).toHaveBeenCalledTimes(1);
    expect(localRepository.listDestinations).not.toHaveBeenCalled();
  });

  it('does not migrate local trip data during Supabase bootstrap', async () => {
    const user = { id: crypto.randomUUID() };
    const localRepository = createMockRepository({
      destinations: [{} as Destination],
      routeLegs: [],
    });
    const cloudRepository = createMockRepository();
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
    });

    expect(repository).toBe(cloudRepository);
    expect(localRepository.listDestinations).not.toHaveBeenCalled();
    expect(localRepository.listRouteLegs).not.toHaveBeenCalled();
    expect(cloudRepository.replaceTripData).not.toHaveBeenCalled();
  });
});
