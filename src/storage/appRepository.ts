import { createBrowserSupabaseClient, isSupabaseConfigured as defaultIsSupabaseConfigured } from './supabaseClient';
import { createSupabaseTripRepository } from './supabaseTripRepository';
import { tripDb } from './tripDb';
import { createTripRepository } from './tripRepository';
import type { TripRepository } from './tripRepository';
import type { Activity } from '../domain/types';

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

type MigrationStorage = Pick<Storage, 'getItem' | 'setItem'>;

type CreateAppTripRepositoryOptions = {
  isSupabaseConfigured?: boolean;
  tripStorageMode?: string;
  localRepository?: TripRepository;
  createSupabaseClient?: () => SupabaseAuthClient;
  createSupabaseRepository?: (supabase: SupabaseAuthClient) => TripRepository;
  storage?: MigrationStorage;
};

const migrationKeyForUser = (userId: string) => `world-tour:supabase-migrated:${userId}`;

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

async function migrateLocalTripDataOnce(input: {
  userId: string;
  localRepository: TripRepository;
  cloudRepository: TripRepository;
  storage: MigrationStorage;
}) {
  const migrationKey = migrationKeyForUser(input.userId);
  if (input.storage.getItem(migrationKey) === 'true') return;

  const [cloudDestinations, cloudRouteLegs] = await Promise.all([
    input.cloudRepository.listDestinations(),
    input.cloudRepository.listRouteLegs(),
  ]);
  if (cloudDestinations.length > 0 || cloudRouteLegs.length > 0) {
    input.storage.setItem(migrationKey, 'true');
    return;
  }

  const [localDestinations, localRouteLegs] = await Promise.all([
    input.localRepository.listDestinations(),
    input.localRepository.listRouteLegs(),
  ]);
  const localActivities: Activity[] = (
    await Promise.all(
      localDestinations.map((destination) => input.localRepository.listActivities(destination.id)),
    )
  ).flat();

  if (localDestinations.length > 0 || localRouteLegs.length > 0 || localActivities.length > 0) {
    await input.cloudRepository.replaceTripData({
      destinations: localDestinations,
      routeLegs: localRouteLegs,
      activities: localActivities,
    });
  }

  input.storage.setItem(migrationKey, 'true');
}

export async function createAppTripRepository(options: CreateAppTripRepositoryOptions = {}) {
  const isSupabaseConfigured = options.isSupabaseConfigured ?? defaultIsSupabaseConfigured;
  const tripStorageMode = options.tripStorageMode ?? import.meta.env.VITE_TRIP_STORAGE;
  const localRepository = options.localRepository ?? createTripRepository(tripDb);

  if (tripStorageMode === 'e2e-local') {
    return localRepository;
  }

  if (!isSupabaseConfigured) {
    throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.');
  }

  const storage = options.storage ?? window.localStorage;
  const createSupabaseClient = options.createSupabaseClient ?? createBrowserSupabaseClient;
  const supabase = createSupabaseClient();
  const user = await ensureAnonymousSession(supabase);
  const cloudRepository = options.createSupabaseRepository
    ? options.createSupabaseRepository(supabase)
    : createSupabaseTripRepository(supabase as BrowserSupabaseClient);

  await migrateLocalTripDataOnce({
    userId: user.id,
    localRepository,
    cloudRepository,
    storage,
  });

  return cloudRepository;
}
