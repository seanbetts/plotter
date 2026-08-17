import { defaultTripName } from '../domain/tripDefaults';
import { createPlotterApiClient, type PlotterApiClient } from '../api/client';
import type { TripDb } from './tripDb';
import { createTripRepository } from './tripRepository';
import type { TripRepository } from './tripRepository';
import { createServiceRealtime, type ServiceRealtimeSubscriptions } from './serviceRealtime';
import { createServiceRepositories } from './serviceRepositories';
import {
  createLocalTripDirectoryRepository,
  type TripDirectoryRepository,
} from './tripDirectoryRepository';

export const selectedTripStorageKey = 'plotter:selected-trip-id';
export const legacySelectedTripStorageKey = 'world-tour:selected-trip-id';

export type AppTripStorage = {
  directory: TripDirectoryRepository;
  createTripRepository: (tripId: string) => TripRepository;
  realtime?: ServiceRealtimeSubscriptions;
};

export type CreateAppTripStorageOptions = {
  isSupabaseConfigured?: boolean;
  tripStorageMode?: string;
  baseUrl?: string;
  serviceClient?: PlotterApiClient;
  createRealtime?: typeof createServiceRealtime;
  localRepository?: TripRepository;
  localDirectory?: TripDirectoryRepository;
  createLocalRepository?: (tripId: string) => TripRepository;
  loadLocalDb?: () => Promise<TripDb>;
  createSupabaseClient?: () => unknown;
  createSupabaseDirectory?: (...args: never[]) => TripDirectoryRepository;
  createSupabaseRepository?: (...args: never[]) => TripRepository;
};

export async function createAppTripStorage(
  options: CreateAppTripStorageOptions = {},
): Promise<AppTripStorage> {
  const tripStorageMode = options.tripStorageMode ?? import.meta.env.VITE_TRIP_STORAGE;

  if (tripStorageMode === 'e2e-local') {
    const needsLocalDb = !options.localDirectory
      || (!options.createLocalRepository && !options.localRepository);
    const localDb = needsLocalDb
      ? await (options.loadLocalDb ?? (async () => (await import('./tripDb')).tripDb))()
      : null;
    const createLocalRepository = options.createLocalRepository
      ?? ((tripId: string) => options.localRepository ?? createTripRepository(localDb!, tripId));
    const localDirectory = options.localDirectory
      ?? createLocalTripDirectoryRepository(localDb!);
    return {
      directory: localDirectory,
      createTripRepository: createLocalRepository,
    };
  }

  const baseUrl = options.baseUrl ?? import.meta.env.BASE_URL;
  const client = options.serviceClient ?? createPlotterApiClient({ baseUrl });
  const repositories = createServiceRepositories(client);
  const realtime = (options.createRealtime ?? createServiceRealtime)({ baseUrl, client });
  return { ...repositories, realtime };
}

export async function createAppTripRepository(options: CreateAppTripStorageOptions = {}) {
  const storage = await createAppTripStorage(options);
  const trips = await storage.directory.listTrips();
  const trip = trips[0] ?? await storage.directory.createTrip({ name: defaultTripName });

  return storage.createTripRepository(trip.id);
}
