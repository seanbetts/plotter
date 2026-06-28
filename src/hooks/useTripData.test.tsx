import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createDestination } from '../domain/destinations';
import { createTripDb } from '../storage/tripDb';
import { createTripRepository } from '../storage/tripRepository';
import { useTripData } from './useTripData';

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

  it('adds and deletes a route leg', async () => {
    const repository = createTestRepository();
    const { result } = renderHook(() => useTripData(repository));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let originDestinationId = '';
    let targetDestinationId = '';
    let routeLegId = '';

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

    await act(async () => {
      const leg = await result.current.addRouteLeg({
        originDestinationId,
        targetDestinationId,
        type: 'driving',
        notes: 'Mountain road',
      });
      routeLegId = leg.id;
    });

    expect(result.current.routeLegs).toMatchObject([
      {
        id: routeLegId,
        originDestinationId,
        targetDestinationId,
        type: 'driving',
        notes: 'Mountain road',
      },
    ]);

    await act(async () => {
      await result.current.deleteRouteLeg(routeLegId);
    });

    expect(result.current.routeLegs).toEqual([]);
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

      await result.current.addRouteLeg({
        originDestinationId,
        targetDestinationId,
        type: 'driving',
      });
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
});

function createDeferred<T>(value: T) {
  let resolve!: () => void;
  const promise = new Promise<T>((done) => {
    resolve = () => done(value);
  });

  return { promise, resolve };
}

function createMemoryRepository(destinations: Promise<ReturnType<typeof createDestination>[]>) {
  return {
    destinationListCalls: 0,

    async listDestinations() {
      this.destinationListCalls += 1;
      return destinations;
    },

    async saveDestination() {},

    async deleteDestination() {},

    async listRouteLegs() {
      return [];
    },

    async saveRouteLeg() {},

    async deleteRouteLeg() {},

    async replaceTripData() {},
  };
}
