import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createActivity } from '../src/domain/activities';
import { createDestination } from '../src/domain/destinations';
import { createRouteLeg } from '../src/domain/routeLegs';
import { resolveVehiclePreset } from '../src/domain/vehiclePresets';
import { openPlotterDatabase, type PlotterDatabase } from './database';
import { createSqliteDirectoryRepository } from './directoryRepository';
import { createRevisionEventBus } from './events';
import { createSqliteTripRepository } from './tripRepository';
import { createWriteCoordinator } from './writeCoordinator';

const temporaryDirectories: string[] = [];
const openDatabases: PlotterDatabase[] = [];

function createHarness() {
  const directory = mkdtempSync(join(tmpdir(), 'plotter-repositories-'));
  temporaryDirectories.push(directory);
  const database = openPlotterDatabase(join(directory, 'plotter.sqlite3'));
  openDatabases.push(database);
  const writes = createWriteCoordinator(
    database,
    {
      async createAutomaticBackup() {
        return join(directory, 'disposable-backup.sqlite3');
      },
    },
    createRevisionEventBus(),
  );
  const tripDirectory = createSqliteDirectoryRepository(database, writes);

  return {
    database,
    directory: tripDirectory,
    trip(tripId: string) {
      return createSqliteTripRepository(database, writes, tripId);
    },
  };
}

async function createTrip(harness: ReturnType<typeof createHarness>, name = 'Atlas') {
  const result = await harness.directory.create(0, {
    expectedRevision: 0,
    name,
  });
  if (!result.trip) throw new Error('Expected a created trip.');
  return result.trip;
}

afterEach(() => {
  for (const database of openDatabases.splice(0)) {
    database.close();
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('SQLite directory repository contract', () => {
  it('creates, updates, orders, and revision-checks complete trip metadata', async () => {
    const harness = createHarness();
    await expect(harness.directory.load()).resolves.toEqual({ revision: 0, trips: [] });

    const created = await harness.directory.create(0, {
      expectedRevision: 0,
      name: 'Alps',
    });

    expect(created.revision).toBe(1);
    expect(created.trip).toMatchObject({
      id: expect.any(String),
      name: 'Alps',
      description: '',
      routingVehicle: resolveVehiclePreset('standard'),
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    const routingVehicle = resolveVehiclePreset('large-camper');
    const updated = await harness.directory.update(1, created.trip!.id, {
      expectedRevision: 1,
      patch: {
        name: 'Winter Alps',
        description: 'Snow roads',
        routingVehicle,
      },
    });

    expect(updated).toEqual({
      revision: 2,
      trip: {
        ...created.trip,
        name: 'Winter Alps',
        description: 'Snow roads',
        routingVehicle,
        updatedAt: expect.any(String),
      },
    });
    expect(Date.parse(updated.trip!.updatedAt)).toBeGreaterThan(Date.parse(created.trip!.updatedAt));
    await expect(harness.directory.load()).resolves.toEqual({ revision: 2, trips: [updated.trip] });

    await expect(harness.directory.update(1, created.trip!.id, {
      expectedRevision: 1,
      patch: { name: 'Stale name' },
    })).rejects.toMatchObject({
      name: 'TripStorageConflictError',
      currentRevision: 2,
    });
    expect(harness.database.connection.prepare(
      'SELECT revision FROM trip_revisions WHERE trip_id = ?',
    ).get(created.trip!.id)).toEqual({ revision: 0 });
  });

  it('deletes trip-owned metadata through schema cascades and removes its revision', async () => {
    const harness = createHarness();
    const trip = await createTrip(harness);
    const repository = harness.trip(trip.id);
    const destination = createDestination({
      name: 'Marrakesh',
      coordinates: { lat: 31.6295, lng: -7.9811 },
    });
    await repository.mutate(0, { type: 'save-destination', destination });
    const activityResult = await repository.mutate(1, {
      type: 'create-activity',
      input: { destinationId: destination.id, title: 'Medina walk' },
    });
    const activity = activityResult.activity!;
    harness.database.connection.prepare(`
      INSERT INTO media_assets (
        id, trip_id, destination_id, activity_id, bucket_id, object_path,
        caption, credit, sort_order, uploaded_by, relative_path, sha256,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'media-one', trip.id, destination.id, activity.id, 'trip-media', 'asset.jpg',
      'Caption', 'Credit', 0, 'local', 'media/asset.jpg', 'a'.repeat(64),
      '2026-08-17T10:00:00.000Z', '2026-08-17T10:00:00.000Z',
    );

    await expect(harness.directory.delete(1, trip.id)).resolves.toEqual({ revision: 2 });
    expect(harness.database.connection.prepare('SELECT COUNT(*) AS count FROM trips').get()).toEqual({ count: 0 });
    expect(harness.database.connection.prepare('SELECT COUNT(*) AS count FROM destinations').get()).toEqual({ count: 0 });
    expect(harness.database.connection.prepare('SELECT COUNT(*) AS count FROM activities').get()).toEqual({ count: 0 });
    expect(harness.database.connection.prepare('SELECT COUNT(*) AS count FROM media_assets').get()).toEqual({ count: 0 });
    expect(harness.database.connection.prepare('SELECT COUNT(*) AS count FROM trip_revisions').get()).toEqual({ count: 0 });
  });
});

describe('SQLite trip repository contract', () => {
  it('creates, updates, and deletes a destination through the bounded mutation contract', async () => {
    const harness = createHarness();
    const trip = await createTrip(harness);
    const repository = harness.trip(trip.id);
    const destination = createDestination({
      name: 'Lake Bled',
      countryRegion: 'Slovenia',
      coordinates: { lat: 46.3683, lng: 14.1146 },
    });

    await repository.mutate(0, { type: 'save-destination', destination });
    await repository.mutate(1, {
      type: 'save-destination',
      destination: { ...destination, name: 'Bled' },
    });
    await expect(repository.load()).resolves.toEqual({
      revision: 2,
      destinations: [{ ...destination, name: 'Bled' }],
      routeLegs: [],
      activities: [],
    });

    await expect(repository.mutate(2, {
      type: 'delete-destination', destinationId: destination.id,
    })).resolves.toEqual({ revision: 3 });
    await expect(repository.load()).resolves.toEqual({
      revision: 3,
      destinations: [],
      routeLegs: [],
      activities: [],
    });
  });

  it('preserves normalized destination and route data in an ordered revisioned snapshot', async () => {
    const harness = createHarness();
    const trip = await createTrip(harness);
    const repository = harness.trip(trip.id);
    const second = {
      ...createDestination({ name: 'Second', coordinates: { lat: 2, lng: 2 }, order: 2 }),
      research: {
        notes: 'Research',
        bookReferences: [],
        links: [
          { id: 'later', title: 'Later', url: 'https://later.example', domain: 'later.example', sortOrder: 2 },
          { id: 'earlier', title: 'Earlier', url: 'https://earlier.example', domain: 'earlier.example', sortOrder: 1 },
        ],
      },
    };
    const first = createDestination({ name: 'First', coordinates: { lat: 1, lng: 1 }, order: 1 });
    const leg = {
      ...createRouteLeg({
        originDestinationId: first.id,
        targetDestinationId: second.id,
        movement: 'drive',
        calculation: 'automatic',
        ferryPolicy: 'avoid',
        waypoints: [{
          id: 'middle-waypoint',
          order: 0,
          name: 'Middle',
          coordinates: { lat: 1.5, lng: 1.5 },
          location: first.location,
          notes: 'Scenic road',
          links: [],
        }],
      }),
      sections: [{ kind: 'ferry' as const, startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 12 }],
      warnings: [{ code: 'FERRY_AVOIDED_BUT_FOUND' as const, message: 'Ferry found' }],
      providerDiagnostic: {
        provider: 'openrouteservice' as const,
        httpStatus: 429,
        providerMessage: 'Rate limit',
      },
    };

    expect(await repository.mutate(0, { type: 'save-destination', destination: second })).toEqual({ revision: 1 });
    expect(await repository.mutate(1, { type: 'save-destination', destination: first })).toEqual({ revision: 2 });
    expect(await repository.mutate(2, { type: 'save-route-leg', routeLeg: leg })).toEqual({ revision: 3 });

    const snapshot = await repository.load();
    expect(snapshot.revision).toBe(3);
    expect(snapshot.destinations.map(({ id }) => id)).toEqual([first.id, second.id]);
    expect(snapshot.destinations[1].research.links.map(({ id }) => id)).toEqual(['earlier', 'later']);
    expect(snapshot.routeLegs).toEqual([leg]);
    expect(snapshot.activities).toEqual([]);
  });

  it('creates, updates, strictly reorders, and deletes activities', async () => {
    const harness = createHarness();
    const trip = await createTrip(harness);
    const repository = harness.trip(trip.id);
    const destination = createDestination({
      name: 'Paris',
      coordinates: { lat: 48.8566, lng: 2.3522 },
    });
    await repository.mutate(0, { type: 'save-destination', destination });
    const location = {
      name: 'Louvre Museum',
      address: 'Rue de Rivoli',
      coordinates: { lat: 48.8606, lng: 2.3364 },
      sourceProvider: 'maptiler' as const,
      sourceFeatureId: 'poi.123',
    };
    const louvre = (await repository.mutate(1, {
      type: 'create-activity',
      input: { destinationId: destination.id, title: 'Louvre', location },
    })).activity!;
    const bakery = (await repository.mutate(2, {
      type: 'create-activity',
      input: { destinationId: destination.id, title: 'Bakery crawl' },
    })).activity!;

    expect(louvre).toMatchObject({ destinationId: destination.id, order: 0, title: 'Louvre', location });
    expect(bakery).toMatchObject({ destinationId: destination.id, order: 1, title: 'Bakery crawl' });
    const updated = await repository.mutate(3, {
      type: 'update-activity',
      activityId: louvre.id,
      patch: {
        title: 'Morning Louvre',
        links: [{ id: 'wiki', title: '', url: 'www.wikipedia.org/wiki/Louvre' }] as never,
      },
    });
    expect(updated.activity).toMatchObject({
      id: louvre.id,
      title: 'Morning Louvre',
      links: [expect.objectContaining({
        id: 'wiki', title: 'wikipedia.org', url: 'https://www.wikipedia.org/wiki/Louvre', domain: 'wikipedia.org', sortOrder: 0,
      })],
    });

    await expect(repository.mutate(4, {
      type: 'reorder-activities',
      destinationId: destination.id,
      orderedActivityIds: [bakery.id],
    })).rejects.toThrow('Activity order must include each destination activity exactly once.');
    expect((await repository.load()).revision).toBe(4);

    await expect(repository.mutate(4, {
      type: 'reorder-activities',
      destinationId: destination.id,
      orderedActivityIds: [bakery.id, louvre.id],
    })).resolves.toEqual({ revision: 5 });
    expect((await repository.load()).activities.map(({ title, order }) => ({ title, order }))).toEqual([
      { title: 'Bakery crawl', order: 0 },
      { title: 'Morning Louvre', order: 1 },
    ]);

    await expect(repository.mutate(5, { type: 'delete-activity', activityId: bakery.id }))
      .resolves.toEqual({ revision: 6 });
    expect((await repository.load()).activities.map(({ id }) => id)).toEqual([louvre.id]);
  });

  it('appends an activity after the maximum existing order', async () => {
    const harness = createHarness();
    const trip = await createTrip(harness);
    const repository = harness.trip(trip.id);
    const destination = createDestination({ name: 'Paris', coordinates: { lat: 1, lng: 1 } });
    await repository.mutate(0, { type: 'save-destination', destination });
    const first = (await repository.mutate(1, {
      type: 'create-activity', input: { destinationId: destination.id, title: 'First' },
    })).activity!;
    const second = (await repository.mutate(2, {
      type: 'create-activity', input: { destinationId: destination.id, title: 'Second' },
    })).activity!;
    await repository.mutate(3, {
      type: 'create-activity', input: { destinationId: destination.id, title: 'Third' },
    });
    await repository.mutate(4, { type: 'delete-activity', activityId: second.id });
    const fourth = (await repository.mutate(5, {
      type: 'create-activity', input: { destinationId: destination.id, title: 'Fourth' },
    })).activity!;

    expect(first.order).toBe(0);
    expect(fourth.order).toBe(3);
  });

  it('deletes destinations and attached topology and activities atomically', async () => {
    const harness = createHarness();
    const trip = await createTrip(harness);
    const repository = harness.trip(trip.id);
    const origin = createDestination({ name: 'Origin', coordinates: { lat: 0, lng: 0 }, order: 0 });
    const target = createDestination({ name: 'Target', coordinates: { lat: 1, lng: 1 }, order: 1 });
    const leg = createRouteLeg({ originDestinationId: origin.id, targetDestinationId: target.id });
    await repository.mutate(0, {
      type: 'replace-trip-data',
      snapshot: { destinations: [origin, target], routeLegs: [leg] },
    });
    await repository.mutate(1, {
      type: 'create-activity', input: { destinationId: target.id, title: 'Target activity' },
    });

    await expect(repository.mutate(2, { type: 'delete-destinations', destinationIds: [target.id] }))
      .resolves.toEqual({ revision: 3 });
    await expect(repository.load()).resolves.toEqual({
      revision: 3,
      destinations: [origin],
      routeLegs: [],
      activities: [],
    });
  });

  it('replaces destinations, routes, and activities as one coherent snapshot', async () => {
    const harness = createHarness();
    const trip = await createTrip(harness);
    const repository = harness.trip(trip.id);
    const oldDestination = createDestination({ name: 'Old', coordinates: { lat: 0, lng: 0 } });
    await repository.mutate(0, { type: 'save-destination', destination: oldDestination });
    const first = createDestination({ name: 'First', coordinates: { lat: 1, lng: 1 }, order: 0 });
    const second = createDestination({ name: 'Second', coordinates: { lat: 2, lng: 2 }, order: 1 });
    const leg = createRouteLeg({ originDestinationId: first.id, targetDestinationId: second.id });
    const activity = createActivity({ destinationId: second.id, title: 'Museum', order: 4 });

    const write = repository.mutate(1, {
      type: 'replace-trip-data',
      snapshot: { destinations: [first, second], routeLegs: [leg], activities: [activity] },
    });
    const concurrentSnapshot = await repository.load();
    expect(concurrentSnapshot).toEqual({
      revision: 1,
      destinations: [oldDestination],
      routeLegs: [],
      activities: [],
    });
    await expect(write).resolves.toEqual({ revision: 2 });
    await expect(repository.load()).resolves.toEqual({
      revision: 2,
      destinations: [first, second],
      routeLegs: [leg],
      activities: [activity],
    });
  });

  it('applies a topology delta as one coherent snapshot', async () => {
    const harness = createHarness();
    const trip = await createTrip(harness);
    const repository = harness.trip(trip.id);
    const origin = createDestination({ name: 'Origin', coordinates: { lat: 0, lng: 0 }, order: 0 });
    const removed = createDestination({ name: 'Removed', coordinates: { lat: 0, lng: 5 }, order: 1 });
    const target = createDestination({ name: 'Target', coordinates: { lat: 0, lng: 10 }, order: 2 });
    const firstLeg = createRouteLeg({ originDestinationId: origin.id, targetDestinationId: removed.id });
    const secondLeg = createRouteLeg({ originDestinationId: removed.id, targetDestinationId: target.id });
    await repository.mutate(0, {
      type: 'replace-trip-data',
      snapshot: { destinations: [origin, removed, target], routeLegs: [firstLeg, secondLeg] },
    });
    const replacementTarget = { ...target, order: 1 };
    const replacementLeg = createRouteLeg({ originDestinationId: origin.id, targetDestinationId: target.id });

    await expect(repository.mutate(1, {
      type: 'apply-trip-mutation',
      delta: {
        destinationsToUpsert: [replacementTarget],
        destinationIdsToDelete: [removed.id],
        routeLegsToUpsert: [replacementLeg],
        routeLegIdsToDelete: [firstLeg.id, secondLeg.id],
      },
    })).resolves.toEqual({ revision: 2 });
    await expect(repository.load()).resolves.toEqual({
      revision: 2,
      destinations: [origin, replacementTarget],
      routeLegs: [replacementLeg],
      activities: [],
    });
  });

  it('rejects incomplete bulk ID sets and invalid replacement topology without partial writes', async () => {
    const harness = createHarness();
    const trip = await createTrip(harness);
    const repository = harness.trip(trip.id);
    const destination = createDestination({ name: 'Only', coordinates: { lat: 1, lng: 1 } });
    await repository.mutate(0, { type: 'save-destination', destination });

    await expect(repository.mutate(1, {
      type: 'delete-destinations', destinationIds: [destination.id, 'missing'],
    })).rejects.toThrow('Destination set does not match the current trip.');
    await expect(repository.mutate(1, {
      type: 'replace-trip-data',
      snapshot: {
        destinations: [destination],
        routeLegs: [createRouteLeg({
          originDestinationId: destination.id,
          targetDestinationId: 'another-trip-destination',
        })],
      },
    })).rejects.toThrow('Route leg endpoints must belong to the trip.');
    await expect(repository.load()).resolves.toEqual({
      revision: 1,
      destinations: [destination],
      routeLegs: [],
      activities: [],
    });
  });

  it('keeps identical destination and route IDs isolated between trips', async () => {
    const harness = createHarness();
    const firstTrip = await createTrip(harness, 'First');
    const secondResult = await harness.directory.create(1, { expectedRevision: 1, name: 'Second' });
    const secondTrip = secondResult.trip!;
    const destination = createDestination({ name: 'Shared', coordinates: { lat: 1, lng: 1 } });
    const target = createDestination({ name: 'Target', coordinates: { lat: 2, lng: 2 } });
    const leg = createRouteLeg({ originDestinationId: destination.id, targetDestinationId: target.id });
    const firstRepository = harness.trip(firstTrip.id);
    const secondRepository = harness.trip(secondTrip.id);

    await firstRepository.mutate(0, {
      type: 'replace-trip-data', snapshot: { destinations: [destination, target], routeLegs: [leg] },
    });
    await secondRepository.mutate(0, {
      type: 'replace-trip-data',
      snapshot: {
        destinations: [{ ...destination, name: 'Second shared' }, target],
        routeLegs: [{ ...leg, notes: 'Second route' }],
      },
    });
    await firstRepository.mutate(1, { type: 'delete-route-leg', routeLegId: leg.id });

    expect((await firstRepository.load()).routeLegs).toEqual([]);
    expect((await secondRepository.load()).destinations[0].name).toBe('Second shared');
    expect((await secondRepository.load()).routeLegs).toEqual([{ ...leg, notes: 'Second route' }]);
  });
});
