import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { resolveVehiclePreset } from '../domain/vehiclePresets';
import { selectedTripStorageKey } from '../storage/appRepository';
import type { TripDirectoryRepository, TripSummary } from '../storage/tripDirectoryRepository';
import type { TripRepository } from '../storage/tripRepository';
import { useTripWorkspace } from './useTripWorkspace';
import { PlotterApiError } from '../api/client';
import { TripStorageConflictError } from '../storage/revision';

function createTrip(name: string, id: string = crypto.randomUUID()): TripSummary {
  return {
    id,
    name,
    description: '',
    routingVehicle: resolveVehiclePreset('standard'),
    createdAt: '2026-07-03T10:00:00.000Z',
    updatedAt: '2026-07-03T10:00:00.000Z',
  };
}

function createRepository(): TripRepository {
  return {
    listDestinations: vi.fn(async () => []),
    saveDestination: vi.fn(),
    deleteDestination: vi.fn(),
    applyTripMutation: vi.fn(),
    listActivities: vi.fn(async () => []),
    createActivity: vi.fn(),
    updateActivity: vi.fn(),
    deleteActivity: vi.fn(),
    reorderActivities: vi.fn(),
    listDestinationMedia: vi.fn(async () => []),
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
    listRouteLegs: vi.fn(async () => []),
    saveRouteLeg: vi.fn(),
    deleteRouteLeg: vi.fn(),
    replaceTripData: vi.fn(),
  };
}

function createStorage(initialTrips: TripSummary[]) {
  let trips = [...initialTrips];
  const directory: TripDirectoryRepository = {
    listTrips: vi.fn(async () => trips),
    createTrip: vi.fn(async ({ name }) => {
      const trip = createTrip(name);
      trips = [trip, ...trips];
      return trip;
    }),
    updateTrip: vi.fn(async (tripId, patch) => {
      trips = trips.map((trip) =>
        trip.id === tripId
          ? { ...trip, ...patch, updatedAt: '2026-07-03T11:00:00.000Z' }
          : trip,
      );
      return trips.find((trip) => trip.id === tripId)!;
    }),
    deleteTrip: vi.fn(async (tripId) => {
      trips = trips.filter((trip) => trip.id !== tripId);
    }),
  };
  const createTripRepository = vi.fn(() => createRepository());

  return {
    storage: {
      directory,
      createTripRepository,
    },
    directory,
    createTripRepository,
    setTrips(nextTrips: TripSummary[]) {
      trips = [...nextTrips];
    },
  };
}

function createLocalStorage(storedTripId: string | null) {
  const values = new Map<string, string>();
  if (storedTripId !== null) {
    values.set('world-tour:selected-trip-id', storedTripId);
  }

  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
  };
}

describe('useTripWorkspace', () => {
  it('loads the directory atomically and publishes its revision', async () => {
    const trip = createTrip('Atomic trip', 'atomic-trip');
    const directory: TripDirectoryRepository = {
      loadDirectory: vi.fn(async () => ({ revision: 11, trips: [trip] })),
      listTrips: vi.fn(async () => { throw new Error('split directory read used'); }),
      createTrip: vi.fn(),
      updateTrip: vi.fn(),
      deleteTrip: vi.fn(),
    };
    const { result } = renderHook(() => useTripWorkspace({
      createStorage: async () => ({ directory, createTripRepository: () => createRepository() }),
      localStorage: createLocalStorage(null),
    }));

    await waitFor(() => expect(result.current.activeTrip?.id).toBe(trip.id));
    expect(result.current.directoryRevision).toBe(11);
    expect(directory.loadDirectory).toHaveBeenCalledTimes(1);
    expect(directory.listTrips).not.toHaveBeenCalled();
  });

  it('shows shared storage unavailable and retries the same service storage path', async () => {
    const trip = createTrip('Recovered trip', 'recovered-trip');
    const { storage } = createStorage([trip]);
    const createStorageAttempt = vi
      .fn()
      .mockRejectedValueOnce(new PlotterApiError('Storage unavailable', { status: 503, code: 'storage-unavailable' }))
      .mockResolvedValue(storage);
    const { result } = renderHook(() => useTripWorkspace({
      createStorage: createStorageAttempt,
      localStorage: createLocalStorage(null),
    }));

    await waitFor(() => expect(result.current.error?.message).toBe('Shared trip storage is unavailable.'));
    expect(result.current.repository).toBeNull();

    act(() => result.current.retryWorkspace());

    await waitFor(() => expect(result.current.activeTrip?.id).toBe(trip.id));
    expect(createStorageAttempt).toHaveBeenCalledTimes(2);
  });

  it('reloads the canonical directory once when a trip mutation conflicts', async () => {
    const oldTrip = createTrip('Old trip', 'trip-1');
    const canonicalTrip = { ...oldTrip, name: 'Canonical trip', updatedAt: '2026-08-17T13:00:00.000Z' };
    const loadDirectory = vi
      .fn()
      .mockResolvedValueOnce({ revision: 2, trips: [oldTrip] })
      .mockResolvedValue({ revision: 3, trips: [canonicalTrip] });
    const directory: TripDirectoryRepository = {
      loadDirectory,
      listTrips: vi.fn(),
      createTrip: vi.fn(async () => { throw new TripStorageConflictError(3); }),
      updateTrip: vi.fn(),
      deleteTrip: vi.fn(),
    };
    const { result } = renderHook(() => useTripWorkspace({
      createStorage: async () => ({ directory, createTripRepository: () => createRepository() }),
      localStorage: createLocalStorage(null),
    }));
    await waitFor(() => expect(result.current.directoryRevision).toBe(2));

    await act(async () => {
      await result.current.createTrip('Stale new trip');
    });

    expect(loadDirectory).toHaveBeenCalledTimes(2);
    expect(result.current.directoryRevision).toBe(3);
    expect(result.current.trips).toEqual([canonicalTrip]);
    expect(result.current.actionError).toBe(
      'Another device changed this trip. Plotter reloaded the latest version.',
    );
  });
  it('restores a remembered selected trip', async () => {
    const remembered = createTrip('Remembered trip', 'remembered-trip');
    const other = createTrip('Other trip', 'other-trip');
    const localStorage = createLocalStorage(remembered.id);
    const { storage, createTripRepository } = createStorage([other, remembered]);

    const { result } = renderHook(() =>
      useTripWorkspace({
        createStorage: async () => storage,
        localStorage,
      }),
    );

    await waitFor(() => expect(result.current.activeTrip?.id).toBe(remembered.id));
    expect(createTripRepository).toHaveBeenCalledWith(remembered.id);
    expect(localStorage.setItem).toHaveBeenCalledWith(selectedTripStorageKey, remembered.id);
    expect(localStorage.getItem('world-tour:selected-trip-id')).toBe(remembered.id);
  });

  it('creates Untitled trip when no trips exist', async () => {
    const localStorage = createLocalStorage(null);
    const { storage, directory } = createStorage([]);

    const { result } = renderHook(() =>
      useTripWorkspace({
        createStorage: async () => storage,
        localStorage,
      }),
    );

    await waitFor(() => expect(result.current.activeTrip?.name).toBe('Untitled trip'));
    expect(directory.createTrip).toHaveBeenCalledWith({ name: 'Untitled trip' });
    expect(localStorage.setItem).toHaveBeenCalledWith(
      selectedTripStorageKey,
      result.current.activeTrip!.id,
    );
  });

  it('selects, creates, renames, and deletes trips', async () => {
    const first = createTrip('First', 'first-trip');
    const second = createTrip('Second', 'second-trip');
    const localStorage = createLocalStorage(null);
    const { storage } = createStorage([first, second]);

    const { result } = renderHook(() =>
      useTripWorkspace({
        createStorage: async () => storage,
        localStorage,
      }),
    );

    await waitFor(() => expect(result.current.activeTrip?.id).toBe(first.id));

    await act(async () => {
      await result.current.selectTrip(second.id);
    });
    expect(result.current.activeTrip?.id).toBe(second.id);

    await act(async () => {
      await result.current.createTrip('Third');
    });
    expect(result.current.activeTrip?.name).toBe('Third');

    await act(async () => {
      await result.current.updateTrip(result.current.activeTrip!.id, {
        name: 'Renamed third',
        vehiclePreset: 'large-camper',
      });
    });
    expect(result.current.activeTrip?.name).toBe('Renamed third');
    expect(result.current.activeTrip?.routingVehicle).toEqual(resolveVehiclePreset('large-camper'));

    await act(async () => {
      await result.current.updateTrip(first.id, {
        name: 'Renamed first',
        vehiclePreset: 'expedition-truck',
      });
    });
    expect(result.current.activeTrip?.name).toBe('Renamed third');
    expect(result.current.trips.find((trip) => trip.id === first.id)?.name).toBe('Renamed first');
    expect(result.current.trips.find((trip) => trip.id === first.id)?.routingVehicle)
      .toEqual(resolveVehiclePreset('expedition-truck'));

    await act(async () => {
      await result.current.deleteTrip(result.current.activeTrip!.id);
    });
    expect(result.current.activeTrip).not.toBeNull();
  });

  it('returns the saved trip from an update and false when an update fails', async () => {
    const first = createTrip('First', 'first-trip');
    const localStorage = createLocalStorage(null);
    const { storage, directory } = createStorage([first]);
    const { result } = renderHook(() => useTripWorkspace({
      createStorage: async () => storage,
      localStorage,
    }));

    await waitFor(() => expect(result.current.activeTrip?.id).toBe(first.id));

    let updated: TripSummary | false = false;
    await act(async () => {
      updated = await result.current.updateTrip(first.id, {
        name: 'Updated',
        vehiclePreset: 'large-camper',
      });
    });
    expect(updated).toMatchObject({
      id: first.id,
      name: 'Updated',
      routingVehicle: resolveVehiclePreset('large-camper'),
    });

    vi.mocked(directory.updateTrip).mockRejectedValueOnce(new Error('Update failed'));
    await act(async () => {
      updated = await result.current.updateTrip(first.id, {
        name: 'Ignored',
        vehiclePreset: 'standard',
      });
    });
    expect(updated).toBe(false);
    expect(result.current.actionError).toBe('Update failed');
  });

  it('refreshes trips against the current active trip when it was removed externally', async () => {
    const first = createTrip('First', 'first-trip');
    const second = createTrip('Second', 'second-trip');
    const third = createTrip('Third', 'third-trip');
    const localStorage = createLocalStorage(null);
    const { storage, createTripRepository, setTrips } = createStorage([first, second]);

    const { result } = renderHook(() =>
      useTripWorkspace({
        createStorage: async () => storage,
        localStorage,
      }),
    );

    await waitFor(() => expect(result.current.activeTrip?.id).toBe(first.id));

    await act(async () => {
      await result.current.selectTrip(second.id);
    });
    expect(result.current.activeTrip?.id).toBe(second.id);

    setTrips([third]);

    await act(async () => {
      await (
        result.current as ReturnType<typeof useTripWorkspace> & {
          refreshTrips: () => Promise<void>;
        }
      ).refreshTrips();
    });

    expect(result.current.trips).toEqual([third]);
    expect(result.current.activeTrip?.id).toBe(third.id);
    expect(createTripRepository).toHaveBeenLastCalledWith(third.id);
  });

  it('refreshes the selected trip vehicle after an external metadata update', async () => {
    const first = createTrip('First', 'first-trip');
    const localStorage = createLocalStorage(null);
    const { storage, setTrips } = createStorage([first]);
    const { result } = renderHook(() => useTripWorkspace({
      createStorage: async () => storage,
      localStorage,
    }));

    await waitFor(() => expect(result.current.activeTrip?.id).toBe(first.id));
    setTrips([{
      ...first,
      routingVehicle: resolveVehiclePreset('expedition-truck'),
      updatedAt: '2026-07-03T12:00:00.000Z',
    }]);

    await act(async () => {
      await result.current.refreshTrips();
    });

    expect(result.current.activeTrip?.routingVehicle)
      .toEqual(resolveVehiclePreset('expedition-truck'));
  });

  it('creates and activates a replacement trip when refresh finds no trips', async () => {
    const first = createTrip('First', 'first-trip');
    const localStorage = createLocalStorage(null);
    const { storage, directory, createTripRepository, setTrips } = createStorage([first]);

    const { result } = renderHook(() =>
      useTripWorkspace({
        createStorage: async () => storage,
        localStorage,
      }),
    );

    await waitFor(() => expect(result.current.activeTrip?.id).toBe(first.id));

    setTrips([]);

    await act(async () => {
      await result.current.refreshTrips();
    });

    expect(directory.createTrip).toHaveBeenCalledWith({ name: 'Untitled trip' });
    expect(result.current.trips).toHaveLength(1);
    expect(result.current.activeTrip?.name).toBe('Untitled trip');
    expect(result.current.repository).not.toBeNull();
    expect(createTripRepository).toHaveBeenLastCalledWith(result.current.activeTrip!.id);
    expect(localStorage.setItem).toHaveBeenLastCalledWith(
      selectedTripStorageKey,
      result.current.activeTrip!.id,
    );
    expect(localStorage.removeItem).not.toHaveBeenCalled();
  });
});
