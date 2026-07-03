import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { createDestination } from '../domain/destinations';
import { createRouteLeg } from '../domain/routeLegs';
import { createTripDb } from './tripDb';
import { createTripRepository } from './tripRepository';

describe('trip repository', () => {
  const testDatabases: Array<{ db: ReturnType<typeof createTripDb>; name: string }> = [];

  afterEach(async () => {
    for (const { db, name } of testDatabases) {
      db.close();
      await Dexie.delete(name);
    }

    testDatabases.length = 0;
  });

  function createTestRepository() {
    const name = `world-tour-test-${crypto.randomUUID()}`;
    const db = createTripDb(name);
    testDatabases.push({ db, name });

    return createTripRepository(db);
  }

  it('creates, lists, updates, and deletes destinations', async () => {
    const repository = createTestRepository();
    const destination = createDestination({
      name: 'Lake Bled',
      countryRegion: 'Slovenia',
      coordinates: { lat: 46.3683, lng: 14.1146 },
    });

    await repository.saveDestination(destination);
    expect(await repository.listDestinations()).toHaveLength(1);

    await repository.saveDestination({ ...destination, name: 'Bled' });
    expect((await repository.listDestinations())[0].name).toBe('Bled');

    await repository.deleteDestination(destination.id);
    expect(await repository.listDestinations()).toEqual([]);
  });

  it('deletes route legs where a deleted destination is the origin', async () => {
    const repository = createTestRepository();
    const origin = createDestination({
      name: 'Istanbul',
      coordinates: { lat: 41.0082, lng: 28.9784 },
    });
    const target = createDestination({
      name: 'Tbilisi',
      coordinates: { lat: 41.7151, lng: 44.8271 },
    });
    const leg = createRouteLeg({
      originDestinationId: origin.id,
      targetDestinationId: target.id,
      type: 'driving-auto',
    });

    await repository.saveDestination(origin);
    await repository.saveDestination(target);
    await repository.saveRouteLeg(leg);
    await repository.deleteDestination(origin.id);

    expect(await repository.listRouteLegs()).toEqual([]);
  });

  it('deletes route legs where a deleted destination is the target', async () => {
    const repository = createTestRepository();
    const origin = createDestination({
      name: 'Istanbul',
      coordinates: { lat: 41.0082, lng: 28.9784 },
    });
    const target = createDestination({
      name: 'Tbilisi',
      coordinates: { lat: 41.7151, lng: 44.8271 },
    });
    const leg = createRouteLeg({
      originDestinationId: origin.id,
      targetDestinationId: target.id,
      type: 'driving-auto',
    });

    await repository.saveDestination(origin);
    await repository.saveDestination(target);
    await repository.saveRouteLeg(leg);
    await repository.deleteDestination(target.id);

    expect(await repository.listRouteLegs()).toEqual([]);
  });

  it('deletes route legs directly', async () => {
    const repository = createTestRepository();
    const origin = createDestination({
      name: 'Istanbul',
      coordinates: { lat: 41.0082, lng: 28.9784 },
    });
    const target = createDestination({
      name: 'Tbilisi',
      coordinates: { lat: 41.7151, lng: 44.8271 },
    });
    const leg = createRouteLeg({
      originDestinationId: origin.id,
      targetDestinationId: target.id,
      type: 'driving-auto',
    });

    await repository.saveRouteLeg(leg);
    expect(await repository.listRouteLegs()).toHaveLength(1);

    await repository.deleteRouteLeg(leg.id);

    expect(await repository.listRouteLegs()).toEqual([]);
  });

  it('replaces all trip data from a snapshot', async () => {
    const repository = createTestRepository();
    const oldOrigin = createDestination({
      name: 'Old origin',
      coordinates: { lat: 0, lng: 0 },
    });
    const oldTarget = createDestination({
      name: 'Old target',
      coordinates: { lat: 0.5, lng: 0.5 },
    });
    const oldLeg = createRouteLeg({
      originDestinationId: oldOrigin.id,
      targetDestinationId: oldTarget.id,
      type: 'shipping-manual',
    });
    const newOrigin = createDestination({
      name: 'New origin',
      coordinates: { lat: 1, lng: 1 },
    });
    const newTarget = createDestination({
      name: 'New target',
      coordinates: { lat: 2, lng: 2 },
    });
    const newLeg = createRouteLeg({
      originDestinationId: newOrigin.id,
      targetDestinationId: newTarget.id,
      type: 'driving-auto',
    });

    await repository.saveDestination(oldOrigin);
    await repository.saveDestination(oldTarget);
    await repository.saveRouteLeg(oldLeg);
    await repository.replaceTripData({
      destinations: [newOrigin, newTarget],
      routeLegs: [newLeg],
    });

    const destinationNames = (await repository.listDestinations()).map(
      (destination) => destination.name,
    );
    const routeLegIds = (await repository.listRouteLegs()).map((routeLeg) => routeLeg.id);

    expect(destinationNames).toHaveLength(2);
    expect(destinationNames).toContain('New origin');
    expect(destinationNames).toContain('New target');
    expect(destinationNames).not.toContain('Old origin');
    expect(destinationNames).not.toContain('Old target');
    expect(routeLegIds).toEqual([newLeg.id]);
    expect(routeLegIds).not.toContain(oldLeg.id);
  });

  it('lists destinations by itinerary order', async () => {
    const repository = createTestRepository();
    const second = createDestination({
      name: 'Second',
      coordinates: { lat: 2, lng: 2 },
      order: 2,
    });
    const first = createDestination({
      name: 'First',
      coordinates: { lat: 1, lng: 1 },
      order: 1,
    });

    await repository.saveDestination(second);
    await repository.saveDestination(first);

    expect((await repository.listDestinations()).map((destination) => destination.name)).toEqual([
      'First',
      'Second',
    ]);
  });

  it('updates, deletes, and reorders destination media locally', async () => {
    const repository = createTestRepository();
    const destination = {
      ...createDestination({
        name: 'Paris',
        coordinates: { lat: 48.8566, lng: 2.3522 },
      }),
      media: [
        {
          id: crypto.randomUUID(),
          url: 'first.webp',
          caption: 'First',
          credit: '',
          sortOrder: 0,
        },
        {
          id: crypto.randomUUID(),
          url: 'second.webp',
          caption: 'Second',
          credit: '',
          sortOrder: 1,
        },
      ],
    };
    const [firstMedia, secondMedia] = destination.media;

    await repository.saveDestination(destination);

    await expect(repository.updateDestinationMedia(secondMedia.id, {
      caption: 'Hero image',
      credit: 'Example photographer',
    })).resolves.toEqual(expect.objectContaining({
      id: secondMedia.id,
      caption: 'Hero image',
      credit: 'Example photographer',
      url: 'second.webp',
    }));

    await expect(repository.reorderDestinationMedia(destination.id, [
      secondMedia.id,
      firstMedia.id,
    ])).resolves.toEqual([
      expect.objectContaining({ id: secondMedia.id, sortOrder: 0 }),
      expect.objectContaining({ id: firstMedia.id, sortOrder: 1 }),
    ]);

    await repository.deleteDestinationMedia(firstMedia.id);

    expect(await repository.listDestinationMedia(destination.id)).toEqual([
      expect.objectContaining({
        id: secondMedia.id,
        caption: 'Hero image',
        sortOrder: 0,
      }),
    ]);
  });

  it('assigns local uploads after the existing max media sort order', async () => {
    const repository = createTestRepository();
    const destination = {
      ...createDestination({
        name: 'Bergen',
        coordinates: { lat: 60.3913, lng: 5.3221 },
      }),
      media: [
        {
          id: crypto.randomUUID(),
          url: 'existing.webp',
          caption: '',
          credit: '',
          sortOrder: 4,
        },
      ],
    };

    await repository.saveDestination(destination);

    const mediaItem = await repository.uploadDestinationMedia({
      destinationId: destination.id,
      file: new File(['image-data'], 'bergen.webp', { type: 'image/webp' }),
    });

    expect(mediaItem.sortOrder).toBe(5);
    expect(mediaItem.url).toBe('data:image/webp;base64,aW1hZ2UtZGF0YQ==');
  });

  it('normalizes legacy records without order or route status', async () => {
    const repository = createTestRepository();
    const legacyDestination = {
      ...createDestination({
        name: 'Legacy stop',
        countryRegion: 'Turkey',
        coordinates: { lat: 1, lng: 1 },
      }),
      location: undefined,
      order: undefined,
    };
    const legacyLeg = {
      ...createRouteLeg({
        originDestinationId: 'origin-1',
        targetDestinationId: 'target-1',
        type: 'driving-auto',
      }),
      type: 'driving',
      status: undefined,
    };

    await repository.saveDestination(legacyDestination as never);
    await repository.saveRouteLeg(legacyLeg as never);

    const [destination] = await repository.listDestinations();
    const [routeLeg] = await repository.listRouteLegs();

    expect(destination.order).toBe(0);
    expect(destination.location).toEqual({
      placeName: 'Legacy stop',
      regionName: '',
      countryName: 'Turkey',
      sourceLabel: 'Legacy stop, Turkey',
      sourceProvider: 'legacy',
    });
    expect(routeLeg.type).toBe('driving-auto');
    expect(routeLeg.status).toBe('pending');
  });
});
