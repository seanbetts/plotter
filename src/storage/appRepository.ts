import { createBrowserSupabaseClient, isSupabaseConfigured as defaultIsSupabaseConfigured } from './supabaseClient';
import { createSupabaseTripRepository } from './supabaseTripRepository';
import { tripDb } from './tripDb';
import { createTripRepository } from './tripRepository';
import type { TripRepository } from './tripRepository';
import { createSupabaseTripRealtime, type TripRealtimeSubscriptions } from './tripRealtime';
import {
  createLocalTripDirectoryRepository,
  createSupabaseTripDirectoryRepository,
  type TripDirectoryRepository,
} from './tripDirectoryRepository';

type BrowserSupabaseClient = ReturnType<typeof createBrowserSupabaseClient>;

type SupabaseUser = {
  id: string;
};

type SupabaseAuthResponse = {
  data: {
    user: SupabaseUser | null;
  };
  error: {
    message: string;
  } | null;
};

type SupabaseAuthClient = {
  auth: {
    getUser(): Promise<SupabaseAuthResponse>;
    signInAnonymously(): Promise<SupabaseAuthResponse>;
  };
};

export const selectedTripStorageKey = 'world-tour:selected-trip-id';

type AppTripStorage = {
  directory: TripDirectoryRepository;
  createTripRepository: (tripId: string) => TripRepository;
  realtime?: TripRealtimeSubscriptions;
};

type CreateAppTripStorageOptions = {
  isSupabaseConfigured?: boolean;
  tripStorageMode?: string;
  localRepository?: TripRepository;
  localDirectory?: TripDirectoryRepository;
  createLocalRepository?: (tripId: string) => TripRepository;
  createSupabaseClient?: () => SupabaseAuthClient;
  createSupabaseDirectory?: (supabase: SupabaseAuthClient) => TripDirectoryRepository;
  createSupabaseRepository?: (supabase: SupabaseAuthClient, tripId: string) => TripRepository;
};

export async function ensureAnonymousSession(supabase: SupabaseAuthClient) {
  const existingUser = await supabase.auth.getUser();

  if (existingUser.data.user) {
    return existingUser.data.user;
  }

  const anonymousUser = await supabase.auth.signInAnonymously();

  if (anonymousUser.error || !anonymousUser.data.user) {
    throw new Error(anonymousUser.error?.message || 'Unable to create an anonymous Supabase session.');
  }

  return anonymousUser.data.user;
}

export async function createAppTripStorage(
  options: CreateAppTripStorageOptions = {},
): Promise<AppTripStorage> {
  const isSupabaseConfigured = options.isSupabaseConfigured ?? defaultIsSupabaseConfigured;
  const tripStorageMode = options.tripStorageMode ?? import.meta.env.VITE_TRIP_STORAGE;
  const createLocalRepository =
    options.createLocalRepository ??
    ((tripId: string) => options.localRepository ?? createTripRepository(tripDb, tripId));
  const localDirectory = options.localDirectory ?? createLocalTripDirectoryRepository(tripDb);

  if (tripStorageMode === 'e2e-local') {
    return {
      directory: localDirectory,
      createTripRepository: createLocalRepository,
    };
  }

  if (!isSupabaseConfigured) {
    throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.');
  }

  const createSupabaseClient = options.createSupabaseClient ?? createBrowserSupabaseClient;
  const supabase = createSupabaseClient();
  await ensureAnonymousSession(supabase);

  return {
    directory: options.createSupabaseDirectory
      ? options.createSupabaseDirectory(supabase)
      : createSupabaseTripDirectoryRepository(supabase as BrowserSupabaseClient),
    createTripRepository: (tripId: string) =>
      options.createSupabaseRepository
        ? options.createSupabaseRepository(supabase, tripId)
        : createSupabaseTripRepository(supabase as BrowserSupabaseClient, tripId),
    realtime: createSupabaseTripRealtime(supabase as BrowserSupabaseClient),
  };
}

export async function createAppTripRepository(options: CreateAppTripStorageOptions = {}) {
  const storage = await createAppTripStorage(options);
  const trips = await storage.directory.listTrips();
  const trip = trips[0] ?? await storage.directory.createTrip({ name: 'World tour' });

  return storage.createTripRepository(trip.id);
}
