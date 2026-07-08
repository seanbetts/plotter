import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createAppTripStorage,
  selectedTripStorageKey,
} from '../storage/appRepository';
import type { TripDirectoryRepository, TripSummary } from '../storage/tripDirectoryRepository';
import type { TripRealtimeSubscriptions } from '../storage/tripRealtime';
import type { TripRepository } from '../storage/tripRepository';

type AppTripStorage = {
  directory: TripDirectoryRepository;
  createTripRepository: (tripId: string) => TripRepository;
  realtime?: TripRealtimeSubscriptions;
};

type LocalStorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

type UseTripWorkspaceOptions = {
  createStorage?: () => Promise<AppTripStorage>;
  localStorage?: LocalStorageLike;
};

type RepositoryError = {
  title: string;
  message: string;
};

function formatRepositoryError(caught: unknown): RepositoryError {
  const message = caught instanceof Error ? caught.message : 'Unable to prepare trip storage';

  if (message.includes('Supabase is not configured')) {
    return {
      title: 'Supabase is not configured',
      message: 'Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.',
    };
  }

  if (message.includes('row-level security') || message.includes('permission denied')) {
    return {
      title: 'Supabase permission denied',
      message,
    };
  }

  return {
    title: 'Trip storage unavailable',
    message,
  };
}

function chooseInitialTrip(trips: TripSummary[], storedTripId: string | null) {
  return trips.find((trip) => trip.id === storedTripId) ?? trips[0] ?? null;
}

function getDefaultLocalStorage(): LocalStorageLike | null {
  return typeof window === 'undefined' ? null : window.localStorage;
}

export function useTripWorkspace(options: UseTripWorkspaceOptions = {}) {
  const [createStorage] = useState(() => options.createStorage ?? createAppTripStorage);
  const [localStorage] = useState(() => options.localStorage ?? getDefaultLocalStorage());
  const [storage, setStorage] = useState<AppTripStorage | null>(null);
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [activeTrip, setActiveTrip] = useState<TripSummary | null>(null);
  const [repository, setRepository] = useState<TripRepository | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<RepositoryError | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const activeTripRef = useRef<TripSummary | null>(null);

  const activateTrip = useCallback((nextStorage: AppTripStorage, nextTrip: TripSummary) => {
    localStorage?.setItem(selectedTripStorageKey, nextTrip.id);
    activeTripRef.current = nextTrip;
    setActiveTrip(nextTrip);
    setRepository(nextStorage.createTripRepository(nextTrip.id));
  }, [localStorage]);

  useEffect(() => {
    activeTripRef.current = activeTrip;
  }, [activeTrip]);

  useEffect(() => {
    let isCancelled = false;

    async function loadWorkspace() {
      setIsLoading(true);
      setError(null);

      try {
        const nextStorage = await createStorage();
        let nextTrips = await nextStorage.directory.listTrips();
        let selectedTrip = chooseInitialTrip(
          nextTrips,
          localStorage?.getItem(selectedTripStorageKey) ?? null,
        );

        if (!selectedTrip) {
          selectedTrip = await nextStorage.directory.createTrip({ name: 'World tour' });
          nextTrips = [selectedTrip];
        }

        if (isCancelled) return;

        setStorage(nextStorage);
        setTrips(nextTrips);
        activateTrip(nextStorage, selectedTrip);
      } catch (caught) {
        if (isCancelled) return;

        setError(formatRepositoryError(caught));
        setRepository(null);
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadWorkspace();

    return () => {
      isCancelled = true;
    };
  }, [activateTrip, createStorage, localStorage]);

  const selectTrip = useCallback(async (tripId: string) => {
    if (!storage) return false;

    const nextTrip = trips.find((trip) => trip.id === tripId);
    if (!nextTrip) return false;

    setActionError(null);
    activateTrip(storage, nextTrip);
    return true;
  }, [activateTrip, storage, trips]);

  const createTrip = useCallback(async (name: string) => {
    if (!storage) return false;

    setActionError(null);
    try {
      const nextTrip = await storage.directory.createTrip({ name });
      setTrips((current) => [nextTrip, ...current]);
      activateTrip(storage, nextTrip);
      return true;
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Unable to create trip');
      return false;
    }
  }, [activateTrip, storage]);

  const renameTrip = useCallback(async (tripId: string, name: string) => {
    if (!storage) return false;

    setActionError(null);
    try {
      const updatedTrip = await storage.directory.updateTrip(tripId, { name });
      setTrips((current) =>
        current.map((trip) => (trip.id === updatedTrip.id ? updatedTrip : trip)),
      );
      setActiveTrip((current) => {
        const nextActive = current?.id === updatedTrip.id ? updatedTrip : current;
        activeTripRef.current = nextActive;
        return nextActive;
      });
      return true;
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Unable to rename trip');
      return false;
    }
  }, [storage]);

  const deleteTrip = useCallback(async (tripId: string) => {
    if (!storage) return false;

    setActionError(null);
    try {
      await storage.directory.deleteTrip(tripId);
      let nextTrips = trips.filter((trip) => trip.id !== tripId);

      if (nextTrips.length === 0) {
        const replacementTrip = await storage.directory.createTrip({ name: 'World tour' });
        nextTrips = [replacementTrip];
      }

      setTrips(nextTrips);
      activateTrip(storage, nextTrips[0]);
      return true;
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Unable to delete trip');
      return false;
    }
  }, [activateTrip, storage, trips]);

  const refreshTrips = useCallback(async () => {
    if (!storage) return;

    let nextTrips = await storage.directory.listTrips();
    if (nextTrips.length === 0) {
      const replacementTrip = await storage.directory.createTrip({ name: 'World tour' });
      nextTrips = [replacementTrip];
    }

    const currentActive = activeTripRef.current;
    const nextActive = currentActive
      ? nextTrips.find((trip) => trip.id === currentActive.id) ?? nextTrips[0] ?? null
      : nextTrips[0] ?? null;

    setTrips(nextTrips);
    setActiveTrip(nextActive);
    activeTripRef.current = nextActive;
    setRepository(nextActive ? storage.createTripRepository(nextActive.id) : null);
    if (nextActive) {
      localStorage?.setItem(selectedTripStorageKey, nextActive.id);
    } else {
      localStorage?.removeItem(selectedTripStorageKey);
    }
  }, [localStorage, storage]);

  return useMemo(() => ({
    trips,
    activeTrip,
    repository,
    realtime: storage?.realtime ?? null,
    isLoading,
    error,
    actionError,
    selectTrip,
    createTrip,
    renameTrip,
    deleteTrip,
    refreshTrips,
  }), [
    actionError,
    activeTrip,
    createTrip,
    deleteTrip,
    error,
    isLoading,
    repository,
    renameTrip,
    refreshTrips,
    selectTrip,
    storage?.realtime,
    trips,
  ]);
}
