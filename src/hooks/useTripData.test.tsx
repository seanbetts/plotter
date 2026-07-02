import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createDestination } from '../domain/destinations';
import { createTripDb } from '../storage/tripDb';
import { createTripRepository } from '../storage/tripRepository';
import { useTripData } from './useTripData';

type TripRepository = ReturnType<typeof createTripRepository>;

describe('useTripData', () => {
  const testDatabases: Array<{ db: ReturnType<typeof createTripDb>; name: string }> = [];

  afterEach(async () => {
    for (const { db, name } of testDatabases) {
      db.close();
      await Dexie.delete(name);
    }
    testDatabases.length = 0;
  });

  function createTestRepository() {
    const name = `world-tour-hook-test-${crypto.randomUUID()}`;
    const db = createTripDb(name);
    testDatabases.push({ db, name });
    return createTripRepository(db);
  }

  it('adds, updates, and deletes a destination', async () => {
    const repository = createTestRepository();
    const { result } = renderHook(() => useTripData(repository));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.addDestination({
        name: 'Durmitor',
        countryRegion: 'Montenegro',
        coordinates: { lat: 43.1306, lng: 19.0342 },
      });
    });

    expect(result.current.destinations[0].name).toBe('Durmitor');

    await act(async () => {
      await result.current.updateDestination(result.current.destinations[0].id, {
        tags: ['mountains'],
      });
    });

    expect(result.current.destinations[0].tags).toEqual(['mountains']);

    await act(async () => {
      await result.current.deleteDestination(result.current.destinations[0].id);
    });

    expect(result.current.destinations).toEqual([]);
  });

  it('updates a destination through an action object captured before the destination was added', async () => {
    const repository = createTestRepository();
    const { result } = renderHook(() => useTripData(repository));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const capturedActions = result.current;
    let addedDestinationId = '';

    await act(async () => {
      const added = await capturedActions.addDestination({
        name: 'Kotor',
        countryRegion: 'Montenegro',
        coordinates: { lat: 42.4247, lng: 18.7712 },
      });
      addedDestinationId = added.id;
      await capturedActions.updateDestination(added.id, {
        tags: ['bay'],
      });
    });

    expect(result.current.destinations[0].id).toBe(addedDestinationId);
    expect(result.current.destinations[0].tags).toEqual(['bay']);
  });

  it('adds and deletes an automatic route leg', async () => {
    const repository = createTestRepository();
    const { result } = renderHook(() => useTripData(repository));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let originDestinationId = '';
    let targetDestinationId = '';

    await act(async () => {
      const origin = await result.current.addDestination({
        name: 'Durmitor',
        countryRegion: 'Montenegro',
        coordinates: { lat: 43.1306, lng: 19.0342 },
      });
      const target = await result.current.addDestination({
        name: 'Kotor',
        countryRegion: 'Montenegro',
        coordinates: { lat: 42.4247, lng: 18.7712 },
      });
      originDestinationId = origin.id;
      targetDestinationId = target.id;
    });

    const [routeLeg] = result.current.routeLegs;

    expect(result.current.routeLegs).toMatchObject([
      {
        id: routeLeg.id,
        originDestinationId,
        targetDestinationId,
        type: 'driving-auto',
        status: 'pending',
      },
    ]);

    await act(async () => {
      await result.current.deleteRouteLeg(routeLeg.id);
    });

    expect(result.current.routeLegs).toEqual([]);
  });

  it('automatically creates and calculates a driving route leg between adjacent destinations', async () => {
    const repository = createTestRepository();
    const calculateRoute = vi.fn().mockResolvedValue({
      distanceKm: 123.4,
      travelTimeHours: 2.5,
      geometry: {
        type: 'LineString',
        coordinates: [
          [19.0342, 43.1306],
          [18.7712, 42.4247],
        ],
      },
      provider: 'openrouteservice',
      profile: 'driving-car',
    });
    const { result } = renderHook(() => useTripData(repository, { calculateRoute }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.addDestination({
        name: 'Durmitor',
        countryRegion: 'Montenegro',
        coordinates: { lat: 43.1306, lng: 19.0342 },
      });
      await result.current.addDestination({
        name: 'Kotor',
        countryRegion: 'Montenegro',
        coordinates: { lat: 42.4247, lng: 18.7712 },
      });
    });

    expect(calculateRoute).toHaveBeenCalledWith({
      origin: { lat: 43.1306, lng: 19.0342 },
      target: { lat: 42.4247, lng: 18.7712 },
      profile: 'driving-car',
    });
    expect(result.current.routeLegs).toMatchObject([
      {
        type: 'driving-auto',
        status: 'ready',
        distanceKm: 123.4,
        travelTimeHours: 2.5,
        provider: 'openrouteservice',
        profile: 'driving-car',
      },
    ]);
  });

  it('recalculates affected driving route legs after destination coordinates change', async () => {
    const repository = createTestRepository();
    const calculateRoute = vi
      .fn()
      .mockResolvedValueOnce({
        distanceKm: 123.4,
        travelTimeHours: 2.5,
        geometry: {
          type: 'LineString',
          coordinates: [
            [19.0342, 43.1306],
            [18.7712, 42.4247],
          ],
        },
        provider: 'openrouteservice',
        profile: 'driving-car',
      })
      .mockResolvedValueOnce({
        distanceKm: 125.6,
        travelTimeHours: 2.7,
        geometry: {
          type: 'LineString',
          coordinates: [
            [19.045, 43.14],
            [18.7712, 42.4247],
          ],
        },
        provider: 'openrouteservice',
        profile: 'driving-car',
      });
    const { result } = renderHook(() => useTripData(repository, { calculateRoute }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.addDestination({
        name: 'Durmitor',
        countryRegion: 'Montenegro',
        coordinates: { lat: 43.1306, lng: 19.0342 },
      });
      await result.current.addDestination({
        name: 'Kotor',
        countryRegion: 'Montenegro',
        coordinates: { lat: 42.4247, lng: 18.7712 },
      });
    });

    const [origin] = result.current.destinations;

    await act(async () => {
      await result.current.updateDestination(origin.id, {
        coordinates: { lat: 43.14, lng: 19.045 },
      });
    });

    expect(calculateRoute).toHaveBeenLastCalledWith({
      origin: { lat: 43.14, lng: 19.045 },
      target: { lat: 42.4247, lng: 18.7712 },
      profile: 'driving-car',
    });
    expect(result.current.routeLegs[0]).toMatchObject({
      status: 'ready',
      distanceKm: 125.6,
      travelTimeHours: 2.7,
      geometry: {
        type: 'LineString',
        coordinates: [
          [19.045, 43.14],
          [18.7712, 42.4247],
        ],
      },
    });
  });

  it('reorders destinations and recalculates adjacent route legs', async () => {
    const repository = createTestRepository();
    const { result } = renderHook(() => useTripData(repository));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.addDestination({
        name: 'First',
        coordinates: { lat: 1, lng: 1 },
      });
      await result.current.addDestination({
        name: 'Second',
        coordinates: { lat: 2, lng: 2 },
      });
      await result.current.addDestination({
        name: 'Third',
        coordinates: { lat: 3, lng: 3 },
      });
    });

    const [first, second, third] = result.current.destinations;

    await act(async () => {
      await result.current.reorderDestinations([third.id, first.id, second.id]);
    });

    expect(result.current.destinations.map((destination) => destination.name)).toEqual([
      'Third',
      'First',
      'Second',
    ]);
    expect(result.current.destinations.map((destination) => destination.order)).toEqual([0, 1, 2]);
    expect(result.current.routeLegs.map((leg) => [leg.originDestinationId, leg.targetDestinationId])).toEqual([
      [third.id, first.id],
      [first.id, second.id],
    ]);
  });

  it('inserts new destinations at the best route position after the first stop', async () => {
    const repository = createTestRepository();
    const { result } = renderHook(() => useTripData(repository));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.addDestination({
        name: 'Balcombe',
        coordinates: { lat: 51.0576, lng: -0.1342 },
      });
      await result.current.addDestination({
        name: 'Liseleje',
        coordinates: { lat: 56.0111, lng: 11.9656 },
      });
      await result.current.addDestination({
        name: 'Paris',
        coordinates: { lat: 48.8566, lng: 2.3522 },
      });
    });

    const [balcombe, paris, liseleje] = result.current.destinations;

    expect(result.current.destinations.map((destination) => destination.name)).toEqual([
      'Balcombe',
      'Paris',
      'Liseleje',
    ]);
    expect(result.current.destinations.map((destination) => destination.order)).toEqual([0, 1, 2]);
    expect(result.current.routeLegs.map((leg) => [leg.originDestinationId, leg.targetDestinationId])).toEqual([
      [balcombe.id, paris.id],
      [paris.id, liseleje.id],
    ]);

    expect((await repository.listDestinations()).map((destination) => destination.name)).toEqual([
      'Balcombe',
      'Paris',
      'Liseleje',
    ]);
  });

  it('places Norway stops into the expected route order while keeping Oslo first', async () => {
    const repository = createTestRepository();
    const { result } = renderHook(() => useTripData(repository));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.addDestination({
        name: 'Oslo',
        coordinates: { lat: 59.9139, lng: 10.7522 },
      });
      await result.current.addDestination({
        name: 'Bodo',
        coordinates: { lat: 67.2804, lng: 14.4049 },
      });
      await result.current.addDestination({
        name: 'Trondheim',
        coordinates: { lat: 63.4305, lng: 10.3951 },
      });
      await result.current.addDestination({
        name: 'Bergen',
        coordinates: { lat: 60.3913, lng: 5.3221 },
      });
    });

    const [oslo, bergen, trondheim, bodo] = result.current.destinations;

    expect(result.current.destinations.map((destination) => destination.name)).toEqual([
      'Oslo',
      'Bergen',
      'Trondheim',
      'Bodo',
    ]);
    expect(result.current.destinations.map((destination) => destination.order)).toEqual([0, 1, 2, 3]);
    expect(result.current.routeLegs.map((leg) => [leg.originDestinationId, leg.targetDestinationId])).toEqual([
      [oslo.id, bergen.id],
      [bergen.id, trondheim.id],
      [trondheim.id, bodo.id],
    ]);
  });

  it('optimistically reorders destinations and shows pending route legs while persistence is in flight', async () => {
    const first = createDestination({
      name: 'First',
      coordinates: { lat: 1, lng: 1 },
      order: 0,
    });
    const second = createDestination({
      name: 'Second',
      coordinates: { lat: 2, lng: 2 },
      order: 1,
    });
    const third = createDestination({
      name: 'Third',
      coordinates: { lat: 3, lng: 3 },
      order: 2,
    });
    const saveDestination = createDeferred<void>(undefined);
    const repository = createMemoryRepository(Promise.resolve([first, second, third]), {
      saveDestination: () => saveDestination.promise,
    });
    const { result } = renderHook(() => useTripData(repository));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let reorderPromise: Promise<void>;

    await act(async () => {
      reorderPromise = result.current.reorderDestinations([third.id, first.id, second.id]);
      await Promise.resolve();
    });

    expect(result.current.destinations.map((destination) => destination.name)).toEqual([
      'Third',
      'First',
      'Second',
    ]);
    expect(result.current.routeLegs).toMatchObject([
      {
        originDestinationId: third.id,
        targetDestinationId: first.id,
        type: 'driving-auto',
        status: 'pending',
      },
      {
        originDestinationId: first.id,
        targetDestinationId: second.id,
        type: 'driving-auto',
        status: 'pending',
      },
    ]);

    await act(async () => {
      saveDestination.resolve();
      await reorderPromise;
    });
  });

  it('marks an automatic route leg as a manual shipping leg', async () => {
    const repository = createTestRepository();
    const { result } = renderHook(() => useTripData(repository));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.addDestination({
        name: 'Panama City',
        coordinates: { lat: 8.9824, lng: -79.5199 },
      });
      await result.current.addDestination({
        name: 'Cartagena',
        coordinates: { lat: 10.391, lng: -75.4794 },
      });
    });

    const [routeLeg] = result.current.routeLegs;

    await act(async () => {
      await result.current.updateRouteLeg(routeLeg.id, {
        type: 'shipping-manual',
        notes: 'Ship around the Darien Gap.',
      });
    });

    expect(result.current.routeLegs[0]).toMatchObject({
      id: routeLeg.id,
      type: 'shipping-manual',
      status: 'manual',
      notes: 'Ship around the Darien Gap.',
      geometry: {
        type: 'LineString',
        coordinates: [
          [-79.5199, 8.9824],
          [-75.4794, 10.391],
        ],
      },
    });
  });

  it('removes attached route legs from state when deleting a destination', async () => {
    const repository = createTestRepository();
    const { result } = renderHook(() => useTripData(repository));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let originDestinationId = '';
    let targetDestinationId = '';

    await act(async () => {
      const origin = await result.current.addDestination({
        name: 'Durmitor',
        countryRegion: 'Montenegro',
        coordinates: { lat: 43.1306, lng: 19.0342 },
      });
      const target = await result.current.addDestination({
        name: 'Kotor',
        countryRegion: 'Montenegro',
        coordinates: { lat: 42.4247, lng: 18.7712 },
      });
      originDestinationId = origin.id;
      targetDestinationId = target.id;

    });

    expect(result.current.routeLegs).toHaveLength(1);

    await act(async () => {
      await result.current.deleteDestination(originDestinationId);
    });

    expect(result.current.destinations.map((destination) => destination.id)).toEqual([
      targetDestinationId,
    ]);
    expect(result.current.routeLegs).toEqual([]);
  });

  it('ignores stale reload results after the repository changes', async () => {
    const slowDestination = createDestination({
      name: 'Slow',
      coordinates: { lat: 1, lng: 1 },
    });
    const currentDestination = createDestination({
      name: 'Current',
      coordinates: { lat: 2, lng: 2 },
    });
    const slowDestinations = createDeferred([slowDestination]);
    const currentDestinations = createDeferred([currentDestination]);
    const slowRepository = createMemoryRepository(slowDestinations.promise);
    const currentRepository = createMemoryRepository(currentDestinations.promise);

    const { result, rerender } = renderHook(
      ({ repository }) => useTripData(repository),
      { initialProps: { repository: slowRepository } },
    );

    await waitFor(() => expect(slowRepository.destinationListCalls).toBe(1));

    rerender({ repository: currentRepository });

    await waitFor(() => expect(currentRepository.destinationListCalls).toBe(1));

    await act(async () => {
      currentDestinations.resolve();
    });

    await waitFor(() => expect(result.current.destinations[0].name).toBe('Current'));

    await act(async () => {
      slowDestinations.resolve();
    });

    expect(result.current.destinations[0].name).toBe('Current');
  });

  it('does not start the queued initial reload after fast unmount', async () => {
    const repository = createMemoryRepository(Promise.resolve([]));
    const { unmount } = renderHook(() => useTripData(repository));

    unmount();

    await act(async () => {
      await Promise.resolve();
    });

    expect(repository.destinationListCalls).toBe(0);
  });

  it('does not apply stale add destination results after the repository changes', async () => {
    const oldSave = createDeferred<void>(undefined);
    const oldRepository = createMemoryRepository(Promise.resolve([]), {
      saveDestination: () => oldSave.promise,
    });
    const newRepository = createMemoryRepository(Promise.resolve([]));
    const { result, rerender } = renderHook(
      ({ repository }) => useTripData(repository),
      { initialProps: { repository: oldRepository } },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const capturedActions = result.current;
    const addDestinationPromise = capturedActions.addDestination({
      name: 'Old repository destination',
      coordinates: { lat: 3, lng: 3 },
    });

    rerender({ repository: newRepository });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      oldSave.resolve();
      await addDestinationPromise;
    });

    expect(result.current.destinations).toEqual([]);
  });
});

function createDeferred<T>(value: T) {
  let resolve!: () => void;
  const promise = new Promise<T>((done) => {
    resolve = () => done(value);
  });

  return { promise, resolve };
}

function createMemoryRepository(
  destinations: Promise<ReturnType<typeof createDestination>[]>,
  overrides: Partial<TripRepository> = {},
): TripRepository & { destinationListCalls: number } {
  const repository = {
    destinationListCalls: 0,

    async listDestinations() {
      this.destinationListCalls += 1;
      return destinations;
    },

    async saveDestination() {},

    async deleteDestination() {},

    async listDestinationMedia() {
      return [];
    },

    async uploadDestinationMedia() {
      throw new Error('Media uploads are not supported by this test repository.');
    },

    async listRouteLegs() {
      return [];
    },

    async saveRouteLeg() {},

    async deleteRouteLeg() {},

    async replaceTripData() {},
  } satisfies TripRepository & { destinationListCalls: number };

  return Object.assign(repository, overrides);
}
