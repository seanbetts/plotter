import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { resolveVehiclePreset } from '../domain/vehiclePresets';
import { selectedTripStorageKey } from '../storage/appRepository';
import type { TripDirectoryRepository, TripSummary } from '../storage/tripDirectoryRepository';
import type { TripRepository } from '../storage/tripRepository';
import { useTripWorkspace } from './useTripWorkspace';

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
  return {
    getItem: vi.fn(() => storedTripId),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  };
}

describe('useTripWorkspace', () => {
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
  });

  it('creates World tour when no trips exist', async () => {
    const localStorage = createLocalStorage(null);
    const { storage, directory } = createStorage([]);

    const { result } = renderHook(() =>
      useTripWorkspace({
        createStorage: async () => storage,
        localStorage,
      }),
    );

    await waitFor(() => expect(result.current.activeTrip?.name).toBe('World tour'));
    expect(directory.createTrip).toHaveBeenCalledWith({ name: 'World tour' });
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
      await result.current.renameTrip(result.current.activeTrip!.id, 'Renamed third');
    });
    expect(result.current.activeTrip?.name).toBe('Renamed third');

    await act(async () => {
      await result.current.renameTrip(first.id, 'Renamed first');
    });
    expect(result.current.activeTrip?.name).toBe('Renamed third');
    expect(result.current.trips.find((trip) => trip.id === first.id)?.name).toBe('Renamed first');

    await act(async () => {
      await result.current.deleteTrip(result.current.activeTrip!.id);
    });
    expect(result.current.activeTrip).not.toBeNull();
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

    expect(directory.createTrip).toHaveBeenCalledWith({ name: 'World tour' });
    expect(result.current.trips).toHaveLength(1);
    expect(result.current.activeTrip?.name).toBe('World tour');
    expect(result.current.repository).not.toBeNull();
    expect(createTripRepository).toHaveBeenLastCalledWith(result.current.activeTrip!.id);
    expect(localStorage.setItem).toHaveBeenLastCalledWith(
      selectedTripStorageKey,
      result.current.activeTrip!.id,
    );
    expect(localStorage.removeItem).not.toHaveBeenCalled();
  });
});
