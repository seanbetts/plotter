import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
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
});
