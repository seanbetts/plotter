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
      type: 'driving',
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
      type: 'driving',
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
      type: 'driving',
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
      type: 'uncertain',
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
      type: 'driving',
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
});
