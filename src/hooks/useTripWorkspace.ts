import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { VehiclePreset } from '../domain/types';
import { resolveVehiclePreset } from '../domain/vehiclePresets';
import { defaultTripName } from '../domain/tripDefaults';
import { PlotterApiError } from '../api/client';
import {
  type AppTripStorage,
  createAppTripStorage,
  legacySelectedTripStorageKey,
  selectedTripStorageKey,
} from '../storage/appRepository';
import {
  getBrowserStorage,
  readMigratedStorageValue,
  removeStorageValue,
  writeStorageValue,
} from '../storage/localPreferences';
import type { TripSummary } from '../storage/tripDirectoryRepository';
import type { TripRepository } from '../storage/tripRepository';
import { TripStorageConflictError } from '../storage/revision';

type LocalStorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

type UseTripWorkspaceOptions = {
  createStorage?: () => Promise<AppTripStorage>;
  localStorage?: LocalStorageLike;
};

type RepositoryError = {
  title: string;
  message: string;
};

const tripConflictMessage = 'Another device changed this trip. Plotter reloaded the latest version.';

function formatRepositoryError(caught: unknown): RepositoryError {
  const message = caught instanceof Error ? caught.message : 'Unable to prepare trip storage';

  if (caught instanceof PlotterApiError && (caught.status === undefined || caught.status === 503)) {
    return {
      title: 'Trip storage unavailable',
      message: 'Shared trip storage is unavailable.',
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
  return getBrowserStorage();
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
  const [directoryRevision, setDirectoryRevision] = useState<number | null>(null);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const activeTripRef = useRef<TripSummary | null>(null);
  const refreshSequenceRef = useRef(0);

  const activateTrip = useCallback((nextStorage: AppTripStorage, nextTrip: TripSummary) => {
    writeStorageValue(localStorage ?? null, selectedTripStorageKey, nextTrip.id);
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
        const directorySnapshot = nextStorage.directory.loadDirectory
          ? await nextStorage.directory.loadDirectory()
          : null;
        let nextTrips = directorySnapshot?.trips ?? await nextStorage.directory.listTrips();
        let selectedTrip = chooseInitialTrip(
          nextTrips,
          readMigratedStorageValue(
            localStorage ?? null,
            selectedTripStorageKey,
            legacySelectedTripStorageKey,
          ),
        );

        if (!selectedTrip) {
          selectedTrip = await nextStorage.directory.createTrip({ name: defaultTripName });
          nextTrips = [selectedTrip];
        }

        if (isCancelled) return;

        setStorage(nextStorage);
        setTrips(nextTrips);
        setDirectoryRevision(directorySnapshot?.revision ?? null);
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
  }, [activateTrip, createStorage, localStorage, retryAttempt]);

  const retryWorkspace = useCallback(() => {
    setRetryAttempt((current) => current + 1);
  }, []);

  const recoverDirectoryConflict = useCallback(async (caught: unknown) => {
    if (!(caught instanceof TripStorageConflictError) || !storage) return false;
    const directorySnapshot = storage.directory.loadDirectory
      ? await storage.directory.loadDirectory()
      : null;
    const nextTrips = directorySnapshot?.trips ?? await storage.directory.listTrips();
    const currentActive = activeTripRef.current;
    const nextActive = currentActive
      ? nextTrips.find((trip) => trip.id === currentActive.id) ?? nextTrips[0] ?? null
      : nextTrips[0] ?? null;
    setTrips(nextTrips);
    setDirectoryRevision(directorySnapshot?.revision ?? null);
    setActiveTrip(nextActive);
    activeTripRef.current = nextActive;
    setRepository(nextActive ? storage.createTripRepository(nextActive.id) : null);
    if (nextActive) {
      writeStorageValue(localStorage ?? null, selectedTripStorageKey, nextActive.id);
    } else {
      removeStorageValue(localStorage ?? null, selectedTripStorageKey);
    }
    setActionError(tripConflictMessage);
    return true;
  }, [localStorage, storage]);

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
      if (await recoverDirectoryConflict(caught)) return false;
      setActionError(caught instanceof Error ? caught.message : 'Unable to create trip');
      return false;
    }
  }, [activateTrip, recoverDirectoryConflict, storage]);

  const updateTrip = useCallback(async (
    tripId: string,
    patch: { name: string; vehiclePreset: VehiclePreset },
  ): Promise<TripSummary | false> => {
    if (!storage) return false;

    setActionError(null);
    try {
      const updatedTrip = await storage.directory.updateTrip(tripId, {
        name: patch.name,
        routingVehicle: resolveVehiclePreset(patch.vehiclePreset),
      });
      setTrips((current) =>
        current.map((trip) => (trip.id === updatedTrip.id ? updatedTrip : trip)),
      );
      setActiveTrip((current) => {
        const nextActive = current?.id === updatedTrip.id ? updatedTrip : current;
        activeTripRef.current = nextActive;
        return nextActive;
      });
      return updatedTrip;
    } catch (caught) {
      if (await recoverDirectoryConflict(caught)) return false;
      setActionError(caught instanceof Error ? caught.message : 'Unable to update trip');
      return false;
    }
  }, [recoverDirectoryConflict, storage]);

  const deleteTrip = useCallback(async (tripId: string) => {
    if (!storage) return false;

    setActionError(null);
    try {
      await storage.directory.deleteTrip(tripId);
      let nextTrips = trips.filter((trip) => trip.id !== tripId);

      if (nextTrips.length === 0) {
        const replacementTrip = await storage.directory.createTrip({ name: defaultTripName });
        nextTrips = [replacementTrip];
      }

      setTrips(nextTrips);
      activateTrip(storage, nextTrips[0]);
      return true;
    } catch (caught) {
      if (await recoverDirectoryConflict(caught)) return false;
      setActionError(caught instanceof Error ? caught.message : 'Unable to delete trip');
      return false;
    }
  }, [activateTrip, recoverDirectoryConflict, storage, trips]);

  const refreshTrips = useCallback(async () => {
    if (!storage) return undefined;

    const sequence = refreshSequenceRef.current + 1;
    refreshSequenceRef.current = sequence;
    const isCurrentRefresh = () => refreshSequenceRef.current === sequence;
    setActionError(null);

    try {
      const directorySnapshot = storage.directory.loadDirectory
        ? await storage.directory.loadDirectory()
        : null;
      let nextTrips = directorySnapshot?.trips ?? await storage.directory.listTrips();
      if (!isCurrentRefresh()) return undefined;
      if (nextTrips.length === 0) {
        const replacementTrip = await storage.directory.createTrip({ name: defaultTripName });
        if (!isCurrentRefresh()) return undefined;
        nextTrips = [replacementTrip];
      }

      const currentActive = activeTripRef.current;
      const nextActive = currentActive
        ? nextTrips.find((trip) => trip.id === currentActive.id) ?? nextTrips[0] ?? null
        : nextTrips[0] ?? null;

      setTrips(nextTrips);
      setDirectoryRevision(directorySnapshot?.revision ?? null);
      setActiveTrip(nextActive);
      activeTripRef.current = nextActive;
      setRepository(nextActive ? storage.createTripRepository(nextActive.id) : null);
      if (nextActive) {
        writeStorageValue(localStorage ?? null, selectedTripStorageKey, nextActive.id);
      } else {
        removeStorageValue(localStorage ?? null, selectedTripStorageKey);
      }
      return directorySnapshot?.revision ?? null;
    } catch (caught) {
      if (!isCurrentRefresh()) return undefined;
      setActionError(formatRepositoryError(caught).message);
      throw caught;
    }
  }, [localStorage, storage]);

  return useMemo(() => ({
    trips,
    activeTrip,
    repository,
    realtime: storage?.realtime ?? null,
    directoryRevision,
    isLoading,
    error,
    actionError,
    selectTrip,
    createTrip,
    updateTrip,
    deleteTrip,
    refreshTrips,
    retryWorkspace,
  }), [
    actionError,
    activeTrip,
    createTrip,
    deleteTrip,
    directoryRevision,
    error,
    isLoading,
    repository,
    updateTrip,
    refreshTrips,
    retryWorkspace,
    selectTrip,
    storage?.realtime,
    trips,
  ]);
}
