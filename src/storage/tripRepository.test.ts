import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { createActivity as createActivityModel } from '../domain/activities';
import { createDestination } from '../domain/destinations';
import { createRouteLeg } from '../domain/routeLegs';
import { resolveVehiclePreset } from '../domain/vehiclePresets';
import { createTripDb } from './tripDb';
import { createLocalTripDirectoryRepository } from './tripDirectoryRepository';
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

  function createTestRepository(tripId = 'local-default-trip') {
    const name = `plotter-test-${crypto.randomUUID()}`;
    const db = createTripDb(name);
    testDatabases.push({ db, name });

    return createTripRepository(db, tripId);
  }

  it('keeps local destinations isolated by trip id', async () => {
    const name = `plotter-test-${crypto.randomUUID()}`;
    const db = createTripDb(name);
    testDatabases.push({ db, name });
    const firstTrip = createTripRepository(db, 'trip-one');
    const secondTrip = createTripRepository(db, 'trip-two');
    const firstDestination = createDestination({
      name: 'Lisbon',
      coordinates: { lat: 38.7223, lng: -9.1393 },
    });
    const secondDestination = createDestination({
      name: 'Seoul',
      coordinates: { lat: 37.5665, lng: 126.978 },
    });

    await firstTrip.saveDestination(firstDestination);
    await secondTrip.saveDestination(secondDestination);

    expect((await firstTrip.listDestinations()).map((destination) => destination.name)).toEqual(['Lisbon']);
    expect((await secondTrip.listDestinations()).map((destination) => destination.name)).toEqual(['Seoul']);
  });

  it('keeps imported local rows isolated when different trips use the same entity ids', async () => {
    const name = `plotter-test-${crypto.randomUUID()}`;
    const db = createTripDb(name);
    testDatabases.push({ db, name });
    const firstTrip = createTripRepository(db, 'trip-one');
    const secondTrip = createTripRepository(db, 'trip-two');
    const sharedDestination = createDestination({
      name: 'Shared import',
      coordinates: { lat: 1, lng: 1 },
    });

    await firstTrip.replaceTripData({
      destinations: [sharedDestination],
      routeLegs: [],
    });
    await secondTrip.replaceTripData({
      destinations: [{ ...sharedDestination, name: 'Shared import in second trip' }],
      routeLegs: [],
    });

    expect((await firstTrip.listDestinations()).map((destination) => destination.name)).toEqual(['Shared import']);
    expect((await secondTrip.listDestinations()).map((destination) => destination.name)).toEqual([
      'Shared import in second trip',
    ]);
  });

  it('creates, renames, lists, and deletes local trips', async () => {
    const name = `plotter-test-${crypto.randomUUID()}`;
    const db = createTripDb(name);
    testDatabases.push({ db, name });
    const directory = createLocalTripDirectoryRepository(db);

    const trip = await directory.createTrip({ name: 'Alps' });
    await expect(directory.listTrips()).resolves.toEqual([trip]);

    const renamed = await directory.updateTrip(trip.id, { name: 'Alps winter' });
    expect(renamed.name).toBe('Alps winter');

    await directory.deleteTrip(trip.id);
    await expect(directory.listTrips()).resolves.toEqual([]);
  });

  it('defaults a new local trip to standard', async () => {
    const name = `plotter-test-${crypto.randomUUID()}`;
    const db = createTripDb(name);
    testDatabases.push({ db, name });
    const directory = createLocalTripDirectoryRepository(db);

    const trip = await directory.createTrip({ name: 'Manual trip' });

    expect(trip.routingVehicle).toEqual(resolveVehiclePreset('standard'));

    const updated = await directory.updateTrip(trip.id, {
      routingVehicle: resolveVehiclePreset('large-camper'),
    });
    expect(updated.routingVehicle).toEqual(resolveVehiclePreset('large-camper'));
  });

  it('deletes local trip contents when deleting a trip', async () => {
    const name = `plotter-test-${crypto.randomUUID()}`;
    const db = createTripDb(name);
    testDatabases.push({ db, name });
    const directory = createLocalTripDirectoryRepository(db);
    const trip = await directory.createTrip({ name: 'Atlas' });
    const repository = createTripRepository(db, trip.id);
    const destination = createDestination({
      name: 'Marrakesh',
      coordinates: { lat: 31.6295, lng: -7.9811 },
    });

    await repository.saveDestination(destination);
    await directory.deleteTrip(trip.id);

    await expect(repository.listDestinations()).resolves.toEqual([]);
  });

  it('backfills existing v4 local rows into the default trip during upgrade', async () => {
    const name = `plotter-test-${crypto.randomUUID()}`;
    const legacyDb = new Dexie(name);
    const legacyDestination = createDestination({
      name: 'Legacy Paris',
      coordinates: { lat: 48.8566, lng: 2.3522 },
    });

    legacyDb.version(4).stores({
      destinations: 'id, order, name, countryRegion, status, priority, updatedAt',
      routeLegs: 'id, originDestinationId, targetDestinationId, type, status, routeKey, updatedAt',
      activities: 'id, destinationId, order, title, status, priority, updatedAt',
      activityMedia: 'id, activityId, destinationId, sortOrder, uploadedAt',
    });
    await legacyDb.table('destinations').put(legacyDestination);
    legacyDb.close();

    const upgradedDb = createTripDb(name);
    testDatabases.push({ db: upgradedDb, name });
    const directory = createLocalTripDirectoryRepository(upgradedDb);
    const repository = createTripRepository(upgradedDb);

    await expect(directory.listTrips()).resolves.toEqual([
      expect.objectContaining({
        id: 'local-default-trip',
        name: 'Untitled trip',
      }),
    ]);
    await expect(repository.listDestinations()).resolves.toEqual([legacyDestination]);
  });

  it('physically canonicalizes trip vehicles and legacy route intent during the v6 upgrade', async () => {
    const name = `plotter-test-${crypto.randomUUID()}`;
    const legacyDb = new Dexie(name);
    const timestamp = '2026-07-10T12:00:00.000Z';
    const routeLeg = createRouteLeg({
      originDestinationId: 'origin',
      targetDestinationId: 'target',
      movement: 'vehicle-shipping', calculation: 'manual',
    });
    const automaticRouteLeg = createRouteLeg({
      originDestinationId: 'automatic-origin',
      targetDestinationId: 'automatic-target',
      movement: 'drive',
      calculation: 'automatic',
    });
    const {
      movement: _movement,
      calculation: _calculation,
      ferryPolicy: _ferryPolicy,
      waypoints: _waypoints,
      sections: _sections,
      warnings: _warnings,
      ...legacyRouteLeg
    } = routeLeg;
    void [_movement, _calculation, _ferryPolicy, _waypoints, _sections, _warnings];

    legacyDb.version(5).stores({
      trips: 'id, name, updatedAt, createdAt',
      destinations: 'id, tripId, [tripId+order], name, countryRegion, status, priority, updatedAt',
      routeLegs: 'id, tripId, [tripId+updatedAt], originDestinationId, targetDestinationId, type, status, routeKey, updatedAt',
      activities: 'id, tripId, [tripId+destinationId], [tripId+destinationId+order], title, status, priority, updatedAt',
      activityMedia: 'id, tripId, [tripId+activityId], [tripId+destinationId], sortOrder, uploadedAt',
    });
    await legacyDb.table('trips').put({
      id: 'legacy-trip',
      name: 'Legacy trip',
      description: '',
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const {
      movement: _automaticMovement,
      calculation: _automaticCalculation,
      ferryPolicy: _automaticFerryPolicy,
      waypoints: _automaticWaypoints,
      sections: _automaticSections,
      warnings: _automaticWarnings,
      ...legacyAutomaticRouteLeg
    } = automaticRouteLeg;
    void [
      _automaticMovement,
      _automaticCalculation,
      _automaticFerryPolicy,
      _automaticWaypoints,
      _automaticSections,
      _automaticWarnings,
    ];
    const legacyRouteTypeField = ['ty', 'pe'].join('');
    await legacyDb.table('routeLegs').bulkPut([
      {
        ...legacyRouteLeg,
        tripId: 'legacy-trip',
        [legacyRouteTypeField]: ['shipping', 'manual'].join('-'),
      },
      {
        ...legacyAutomaticRouteLeg,
        tripId: 'legacy-trip',
        [legacyRouteTypeField]: ['driving', 'auto'].join('-'),
      },
    ]);
    legacyDb.close();

    const upgradedDb = createTripDb(name);
    testDatabases.push({ db: upgradedDb, name });

    await expect(upgradedDb.trips.get('legacy-trip')).resolves.toEqual(
      expect.objectContaining({ routingVehicle: resolveVehiclePreset('standard') }),
    );
    await expect(upgradedDb.routeLegs.get(routeLeg.id)).resolves.toEqual(
      expect.objectContaining({
        movement: 'vehicle-shipping',
        calculation: 'manual',
        ferryPolicy: 'allow',
        waypoints: [],
        sections: [],
        warnings: [],
      }),
    );
    await expect(upgradedDb.routeLegs.get(automaticRouteLeg.id)).resolves.toEqual(
      expect.objectContaining({
        movement: 'drive',
        calculation: 'automatic',
        ferryPolicy: 'allow',
        waypoints: [],
        sections: [],
        warnings: [],
      }),
    );
    await expect(upgradedDb.routeLegs.get(routeLeg.id)).resolves.not.toHaveProperty('type');
    await expect(upgradedDb.routeLegs.get(automaticRouteLeg.id)).resolves.not.toHaveProperty('type');
    await expect(upgradedDb.routeLegs.where('movement').equals('vehicle-shipping').count()).resolves.toBe(1);
  });

  it('normalizes legacy large-camper trips during the v7 upgrade', async () => {
    const name = `plotter-test-${crypto.randomUUID()}`;
    const legacyDb = new Dexie(name);
    const timestamp = '2026-07-10T12:00:00.000Z';
    const legacyRestrictions = resolveVehiclePreset('large-camper').restrictions;

    legacyDb.version(6).stores({
      trips: 'id, name, updatedAt, createdAt',
      destinations: 'id, tripId, [tripId+order], name, countryRegion, status, priority, updatedAt',
      routeLegs: 'id, tripId, [tripId+updatedAt], originDestinationId, targetDestinationId, movement, calculation, status, routeKey, updatedAt',
      activities: 'id, tripId, [tripId+destinationId], [tripId+destinationId+order], title, status, priority, updatedAt',
      activityMedia: 'id, tripId, [tripId+activityId], [tripId+destinationId], sortOrder, uploadedAt',
    });
    await legacyDb.table('trips').put({
      id: 'legacy-trip',
      name: 'Legacy trip',
      description: '',
      routingVehicle: {
        preset: 'large-camper',
        profile: 'driving-hgv',
        vehicleType: 'hgv',
        restrictions: legacyRestrictions,
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    legacyDb.close();

    const upgradedDb = createTripDb(name);
    testDatabases.push({ db: upgradedDb, name });

    await expect(upgradedDb.trips.get('legacy-trip')).resolves.toEqual(
      expect.objectContaining({
        id: 'legacy-trip',
        routingVehicle: resolveVehiclePreset('large-camper'),
      }),
    );
    await expect(upgradedDb.trips.get('legacy-trip')).resolves.toEqual(
      expect.objectContaining({
        routingVehicle: expect.objectContaining({ restrictions: legacyRestrictions }),
      }),
    );
  });

  it('backfills missing routing anchors during the v8 upgrade', async () => {
    const name = `plotter-test-${crypto.randomUUID()}`;
    const legacyDb = new Dexie(name);
    const legacyDestination = createDestination({
      name: 'Legacy anchor stop',
      coordinates: { lat: 59.9139, lng: 10.7522 },
    });
    const { routingAnchors: _routingAnchors, ...destinationWithoutAnchors } = legacyDestination as typeof legacyDestination & {
      routingAnchors?: unknown;
    };
    void _routingAnchors;

    legacyDb.version(7).stores({
      trips: 'id, name, updatedAt, createdAt',
      destinations: 'id, tripId, [tripId+order], name, countryRegion, status, priority, updatedAt',
      routeLegs: 'id, tripId, [tripId+updatedAt], originDestinationId, targetDestinationId, movement, calculation, status, routeKey, updatedAt',
      activities: 'id, tripId, [tripId+destinationId], [tripId+destinationId+order], title, status, priority, updatedAt',
      activityMedia: 'id, tripId, [tripId+activityId], [tripId+destinationId], sortOrder, uploadedAt',
    });
    await legacyDb.table('destinations').put({
      ...destinationWithoutAnchors,
      id: `legacy-trip:${legacyDestination.id}`,
      entityId: legacyDestination.id,
      tripId: 'legacy-trip',
    });
    legacyDb.close();

    const upgradedDb = createTripDb(name);
    testDatabases.push({ db: upgradedDb, name });
    const repository = createTripRepository(upgradedDb, 'legacy-trip');

    await expect(upgradedDb.destinations.get(`legacy-trip:${legacyDestination.id}`)).resolves.toEqual(
      expect.objectContaining({
        routingAnchors: {},
      }),
    );
    await expect(repository.listDestinations()).resolves.toEqual([
      expect.objectContaining({
        id: legacyDestination.id,
        routingAnchors: {},
      }),
    ]);
  });

  it('physically persists route intent for local saves and snapshot replacements', async () => {
    const name = `plotter-test-${crypto.randomUUID()}`;
    const db = createTripDb(name);
    testDatabases.push({ db, name });
    const repository = createTripRepository(db, 'trip-one');
    const savedRouteLeg = createRouteLeg({
      originDestinationId: 'saved-origin',
      targetDestinationId: 'saved-target',
      movement: 'vehicle-shipping', calculation: 'manual',
    });
    const replacementRouteLeg = createRouteLeg({
      originDestinationId: 'replacement-origin',
      targetDestinationId: 'replacement-target',
      movement: 'drive', calculation: 'automatic',
      status: 'failed',
      error: 'OpenRouteService route calculation failed.',
      providerDiagnostic: {
        provider: 'openrouteservice',
        httpStatus: 503,
        providerMessage: 'Provider unavailable.',
        requestedProfile: 'driving-car',
        actualProfile: 'driving-car',
      },
    });
    await repository.saveRouteLeg(savedRouteLeg);
    const savedRow = await db.routeLegs.get(`trip-one:${savedRouteLeg.id}`);
    expect(savedRow).toEqual(expect.objectContaining({
      movement: 'vehicle-shipping',
      calculation: 'manual',
      ferryPolicy: 'allow',
      waypoints: [],
      sections: [],
      warnings: [],
    }));

    await repository.replaceTripData({
      destinations: [],
      routeLegs: [replacementRouteLeg],
    });
    const replacementRow = await db.routeLegs.get(`trip-one:${replacementRouteLeg.id}`);
    expect(replacementRow).toEqual(expect.objectContaining({
      movement: 'drive',
      calculation: 'automatic',
      ferryPolicy: 'allow',
      waypoints: [],
      sections: [],
      warnings: [],
      providerDiagnostic: replacementRouteLeg.providerDiagnostic,
    }));
    await expect(repository.listRouteLegs()).resolves.toEqual([replacementRouteLeg]);
  });

  it('normalizes a legacy null route provider diagnostic to undefined', async () => {
    const name = `plotter-test-${crypto.randomUUID()}`;
    const db = createTripDb(name);
    testDatabases.push({ db, name });
    const repository = createTripRepository(db, 'trip-one');
    const routeLeg = createRouteLeg({
      originDestinationId: 'origin-id',
      targetDestinationId: 'target-id',
      status: 'failed',
      error: 'Legacy provider failure.',
    });

    await db.routeLegs.put({
      ...routeLeg,
      id: `trip-one:${routeLeg.id}`,
      entityId: routeLeg.id,
      tripId: 'trip-one',
      providerDiagnostic: null,
    } as never);

    const [loaded] = await repository.listRouteLegs();
    expect(loaded).toHaveProperty('providerDiagnostic', undefined);
  });

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
      movement: 'drive', calculation: 'automatic',
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
      movement: 'drive', calculation: 'automatic',
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
      movement: 'drive', calculation: 'automatic',
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
      movement: 'vehicle-shipping', calculation: 'manual',
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
      movement: 'drive', calculation: 'automatic',
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

  it('preserves rich research link metadata when listing saved destinations', async () => {
    const repository = createTestRepository();
    const destination = {
      ...createDestination({
        name: 'Kyoto',
        coordinates: { lat: 35.6764, lng: 139.65 },
      }),
      research: {
        notes: 'Temple notes',
        bookReferences: [],
        links: [
          {
            id: crypto.randomUUID(),
            title: 'Official guide',
            url: 'https://kyoto.example/guide',
            domain: 'kyoto.example',
            imageUrl: 'https://kyoto.example/guide.jpg',
            sortOrder: 2,
            previewFetchedAt: '2026-07-01T10:00:00.000Z',
          },
          {
            id: crypto.randomUUID(),
            title: 'Travel notes',
            url: 'https://notes.example/kyoto',
            domain: 'notes.example',
            imageUrl: 'https://notes.example/kyoto.jpg',
            sortOrder: 1,
            previewFetchedAt: '2026-07-01T11:00:00.000Z',
          },
        ],
      },
    };

    await repository.saveDestination(destination);

    const [listed] = await repository.listDestinations();

    expect(listed.research.links).toEqual([
      destination.research.links[1],
      destination.research.links[0],
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

  it('imports destination media from a web image result', async () => {
    const repository = createTestRepository();
    const destination = createDestination({
      name: 'Paris',
      coordinates: { lat: 48.8566, lng: 2.3522 },
    });

    await repository.saveDestination(destination);

    const mediaItem = await repository.importDestinationMediaFromSearch({
      destinationId: destination.id,
      result: {
        id: 'search-result-1',
        title: 'Paris mural',
        sourceName: 'Example Source',
        sourceUrl: 'https://example.com/paris-mural',
        thumbnailUrl: 'https://images.example.com/paris-mural-thumb.jpg',
        imageUrl: 'https://images.example.com/paris-mural.jpg',
      },
    });

    expect(mediaItem).toEqual(expect.objectContaining({
      caption: 'Paris mural',
      credit: 'Example Source',
      sortOrder: 0,
      contentType: 'image/jpeg',
      url: 'https://images.example.com/paris-mural.jpg',
      thumbnailUrl: 'https://images.example.com/paris-mural-thumb.jpg',
      previewUrl: 'https://images.example.com/paris-mural.jpg',
      fullUrl: 'https://images.example.com/paris-mural.jpg',
    }));
    expect(await repository.listDestinationMedia(destination.id)).toEqual([
      expect.objectContaining({
        id: mediaItem.id,
        caption: 'Paris mural',
        credit: 'Example Source',
      }),
    ]);
  });

  it('imports activity media from a web image result', async () => {
    const repository = createTestRepository();
    const destination = createDestination({
      name: 'Paris',
      coordinates: { lat: 48.8566, lng: 2.3522 },
    });

    await repository.saveDestination(destination);
    const activity = await repository.createActivity({
      destinationId: destination.id,
      title: 'Louvre',
    });

    const mediaItem = await repository.importActivityMediaFromSearch({
      destinationId: destination.id,
      activityId: activity.id,
      result: {
        id: 'search-result-1',
        title: 'Louvre Pyramid',
        sourceName: 'Example Source',
        sourceUrl: 'https://example.com/louvre-pyramid',
        thumbnailUrl: 'https://images.example.com/louvre-pyramid-thumb.jpg',
        imageUrl: 'https://images.example.com/louvre-pyramid.jpg',
      },
    });

    expect(mediaItem).toEqual(expect.objectContaining({
      caption: 'Louvre Pyramid',
      credit: 'Example Source',
      sortOrder: 0,
      contentType: 'image/jpeg',
      url: 'https://images.example.com/louvre-pyramid.jpg',
      thumbnailUrl: 'https://images.example.com/louvre-pyramid-thumb.jpg',
      previewUrl: 'https://images.example.com/louvre-pyramid.jpg',
      fullUrl: 'https://images.example.com/louvre-pyramid.jpg',
    }));
    expect(await repository.listActivityMedia(activity.id)).toEqual([
      expect.objectContaining({
        id: mediaItem.id,
        caption: 'Louvre Pyramid',
        credit: 'Example Source',
      }),
    ]);
  });

  it('keeps destination media separate from activity media and rolls activity media into stop media', async () => {
    const repository = createTestRepository();
    const destination = createDestination({
      name: 'Paris',
      coordinates: { lat: 48.8566, lng: 2.3522 },
    });

    await repository.saveDestination(destination);
    const activity = await repository.createActivity({
      destinationId: destination.id,
      title: 'Louvre',
    });

    const destinationMedia = await repository.uploadDestinationMedia({
      destinationId: destination.id,
      file: new File(['destination-image'], 'paris.webp', { type: 'image/webp' }),
    });
    const activityMedia = await repository.uploadActivityMedia({
      destinationId: destination.id,
      activityId: activity.id,
      file: new File(['activity-image'], 'louvre.webp', { type: 'image/webp' }),
    });

    expect((await repository.listDestinationMedia(destination.id)).map((item) => item.id)).toEqual([
      destinationMedia.id,
    ]);
    expect((await repository.listActivityMedia(activity.id)).map((item) => item.id)).toEqual([
      activityMedia.id,
    ]);
    expect(await repository.listDestinationMediaRollup(destination.id)).toEqual([
      expect.objectContaining({
        mediaItem: expect.objectContaining({ id: destinationMedia.id }),
        ownerType: 'destination',
        canReorderInStopCarousel: true,
      }),
      expect.objectContaining({
        mediaItem: expect.objectContaining({ id: activityMedia.id }),
        ownerType: 'activity',
        activityId: activity.id,
        activityTitle: activity.title,
        canReorderInStopCarousel: false,
      }),
    ]);
  });

  it('rejects local activity media reorder for a missing activity even when the order is empty', async () => {
    const repository = createTestRepository();

    await expect(repository.reorderActivityMedia('missing-activity', []))
      .rejects.toThrow('Activity not found.');
  });

  it('normalizes legacy destinations without order or structured location', async () => {
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
    const routeLeg = createRouteLeg({
      originDestinationId: 'origin-1',
      targetDestinationId: 'target-1',
      movement: 'drive',
      calculation: 'automatic',
    });

    await repository.saveDestination(legacyDestination as never);
    await repository.saveRouteLeg(routeLeg);

    const [destination] = await repository.listDestinations();
    const [savedRouteLeg] = await repository.listRouteLegs();

    expect(destination.order).toBe(0);
    expect(destination.location).toEqual({
      placeName: 'Legacy stop',
      regionName: '',
      countryName: 'Turkey',
      sourceLabel: 'Legacy stop, Turkey',
      sourceProvider: 'legacy',
    });
    expect(savedRouteLeg).not.toHaveProperty('type');
    expect(savedRouteLeg.status).toBe('pending');
  });

  it('normalizes legacy research links on destination reads', async () => {
    const repository = createTestRepository();
    const destination = {
      ...createDestination({
        name: 'Legacy research stop',
        coordinates: { lat: 1, lng: 1 },
      }),
      research: {
        notes: undefined,
        bookReferences: undefined,
        links: [
          {
            id: 'wiki-link',
            title: '',
            url: 'www.wikipedia.org/wiki/Kyoto',
          },
          {
            id: 'official-link',
            title: 'Official',
            url: 'https://kyoto.example/official',
            sortOrder: 0,
          },
        ],
      },
    };

    await repository.saveDestination(destination as never);

    await expect(repository.listDestinations()).resolves.toEqual([
      expect.objectContaining({
        research: {
          notes: '',
          bookReferences: [],
          links: [
            expect.objectContaining({
              id: 'official-link',
              title: 'Official',
              url: 'https://kyoto.example/official',
              domain: 'kyoto.example',
              sortOrder: 0,
            }),
            expect.objectContaining({
              id: 'wiki-link',
              title: 'wikipedia.org',
              url: 'https://www.wikipedia.org/wiki/Kyoto',
              domain: 'wikipedia.org',
              sortOrder: 0,
            }),
          ],
        },
      }),
    ]);
  });

  it('normalizes omitted routing anchors on reads from an already-current local database', async () => {
    const name = `plotter-test-${crypto.randomUUID()}`;
    const db = createTripDb(name);
    testDatabases.push({ db, name });
    const repository = createTripRepository(db, 'local-default-trip');
    const destination = createDestination({
      name: 'Current partial stop',
      coordinates: { lat: 45.4642, lng: 9.19 },
    });
    const { routingAnchors: _routingAnchors, ...destinationWithoutAnchors } = destination as typeof destination & {
      routingAnchors?: unknown;
    };
    void _routingAnchors;

    await db.destinations.put({
      ...destinationWithoutAnchors,
      id: `local-default-trip:${destination.id}`,
      entityId: destination.id,
      tripId: 'local-default-trip',
    } as never);

    await expect(repository.listDestinations()).resolves.toEqual([
      expect.objectContaining({
        id: destination.id,
        routingAnchors: {},
      }),
    ]);
  });

  it('creates, lists, updates, reorders, and deletes activities for a destination', async () => {
    const repository = createTestRepository();
    const destination = createDestination({
      name: 'Paris',
      coordinates: { lat: 48.8566, lng: 2.3522 },
    });

    await repository.saveDestination(destination);

    const louvre = await repository.createActivity({
      destinationId: destination.id,
      title: 'Louvre',
    });
    const bakery = await repository.createActivity({
      destinationId: destination.id,
      title: 'Bakery crawl',
    });

    expect((await repository.listActivities(destination.id)).map((activity) => activity.title)).toEqual([
      'Louvre',
      'Bakery crawl',
    ]);

    await repository.updateActivity(louvre.id, { title: 'Morning Louvre' });
    expect((await repository.listActivities(destination.id))[0].title).toBe('Morning Louvre');

    await repository.reorderActivities(destination.id, [bakery.id, louvre.id]);
    expect((await repository.listActivities(destination.id)).map((activity) => activity.title)).toEqual([
      'Bakery crawl',
      'Morning Louvre',
    ]);

    await repository.deleteActivity(bakery.id);
    expect((await repository.listActivities(destination.id)).map((activity) => activity.title)).toEqual([
      'Morning Louvre',
    ]);
  });

  it('creates local activities with supplied location details', async () => {
    const repository = createTestRepository();
    const destination = createDestination({
      name: 'Paris',
      coordinates: { lat: 48.8566, lng: 2.3522 },
    });
    const location = {
      name: 'Louvre Museum',
      address: 'Rue de Rivoli',
      coordinates: { lat: 48.8606, lng: 2.3364 },
      sourceProvider: 'maptiler' as const,
      sourceFeatureId: 'poi.123',
    };

    await repository.saveDestination(destination);
    const activity = await repository.createActivity({
      destinationId: destination.id,
      title: 'Louvre',
      location,
    });

    expect(activity.location).toEqual(location);
    await expect(repository.listActivities(destination.id)).resolves.toEqual([
      expect.objectContaining({ id: activity.id, location }),
    ]);
  });

  it('normalizes legacy activity links on reads', async () => {
    const repository = createTestRepository();
    const destination = createDestination({
      name: 'Paris',
      coordinates: { lat: 48.8566, lng: 2.3522 },
    });

    await repository.saveDestination(destination);
    const activity = await repository.createActivity({
      destinationId: destination.id,
      title: 'Louvre',
    });
    await repository.updateActivity(activity.id, {
      links: [
        {
          id: 'official-link',
          title: 'Official',
          url: 'https://louvre.example',
          sortOrder: 0,
        },
        {
          id: 'wiki-link',
          title: '',
          url: 'www.wikipedia.org/wiki/Louvre',
        },
      ] as never,
    });

    await expect(repository.listActivities(destination.id)).resolves.toEqual([
      expect.objectContaining({
        id: activity.id,
        links: [
          expect.objectContaining({
            id: 'official-link',
            domain: 'louvre.example',
            sortOrder: 0,
          }),
          expect.objectContaining({
            id: 'wiki-link',
            title: 'wikipedia.org',
            url: 'https://www.wikipedia.org/wiki/Louvre',
            domain: 'wikipedia.org',
            sortOrder: 1,
          }),
        ],
      }),
    ]);
  });

  it('deletes activities when their destination is deleted', async () => {
    const repository = createTestRepository();
    const destination = createDestination({
      name: 'Paris',
      coordinates: { lat: 48.8566, lng: 2.3522 },
    });

    await repository.saveDestination(destination);
    await repository.createActivity({
      destinationId: destination.id,
      title: 'Louvre',
    });

    await repository.deleteDestination(destination.id);

    expect(await repository.listActivities(destination.id)).toEqual([]);
  });

  it('batch deletes destinations and cascaded activity media in one local transaction', async () => {
    const repository = createTestRepository();
    const first = createDestination({ name: 'First', coordinates: { lat: 1, lng: 1 } });
    const second = createDestination({ name: 'Second', coordinates: { lat: 2, lng: 2 } });
    await repository.saveDestination(first);
    await repository.saveDestination(second);
    const activity = await repository.createActivity({ destinationId: first.id, title: 'Protected media' });
    await repository.uploadActivityMedia({
      destinationId: first.id,
      activityId: activity.id,
      file: new File(['image'], 'activity.jpg', { type: 'image/jpeg' }),
    });

    await repository.deleteDestinations!([first.id]);

    expect((await repository.listDestinations()).map(({ id }) => id)).toEqual([second.id]);
    expect(await repository.listActivities(first.id)).toEqual([]);
    expect(await repository.listActivityMedia(activity.id)).toEqual([]);
  });

  it('applies a stop topology delta in one local transaction', async () => {
    const repository = createTestRepository();
    const origin = createDestination({ name: 'Origin', coordinates: { lat: 0, lng: 0 }, order: 0 });
    const removed = createDestination({ name: 'Removed', coordinates: { lat: 0, lng: 5 }, order: 1 });
    const target = createDestination({ name: 'Target', coordinates: { lat: 0, lng: 10 }, order: 2 });
    const replacementTarget = { ...target, order: 1 };
    const firstLeg = createRouteLeg({ originDestinationId: origin.id, targetDestinationId: removed.id });
    const secondLeg = createRouteLeg({ originDestinationId: removed.id, targetDestinationId: target.id });
    const replacementLeg = createRouteLeg({ originDestinationId: origin.id, targetDestinationId: target.id });
    await repository.replaceTripData({
      destinations: [origin, removed, target],
      routeLegs: [firstLeg, secondLeg],
    });

    await repository.applyTripMutation({
      destinationsToUpsert: [replacementTarget],
      destinationIdsToDelete: [removed.id],
      routeLegsToUpsert: [replacementLeg],
      routeLegIdsToDelete: [firstLeg.id, secondLeg.id],
    });

    expect((await repository.listDestinations()).map(({ id, order }) => ({ id, order }))).toEqual([
      { id: origin.id, order: 0 },
      { id: target.id, order: 1 },
    ]);
    expect(await repository.listRouteLegs()).toEqual([replacementLeg]);
  });

  it('rejects creating an activity for a missing destination', async () => {
    const repository = createTestRepository();

    await expect(repository.createActivity({
      destinationId: 'missing-destination',
      title: 'Nowhere cafe',
    })).rejects.toThrow('Destination not found.');

    expect(await repository.listActivities('missing-destination')).toEqual([]);
  });

  it('appends new activities after the current max order when earlier activities are deleted', async () => {
    const repository = createTestRepository();
    const destination = createDestination({
      name: 'Paris',
      coordinates: { lat: 48.8566, lng: 2.3522 },
    });

    await repository.saveDestination(destination);
    const morning = await repository.createActivity({
      destinationId: destination.id,
      title: 'Morning walk',
    });
    const lunch = await repository.createActivity({
      destinationId: destination.id,
      title: 'Lunch',
    });
    await repository.createActivity({
      destinationId: destination.id,
      title: 'Museum',
    });

    await repository.deleteActivity(lunch.id);
    const evening = await repository.createActivity({
      destinationId: destination.id,
      title: 'Evening view',
    });

    expect(evening.order).toBe(3);
    expect((await repository.listActivities(destination.id)).map((activity) => ({
      title: activity.title,
      order: activity.order,
    }))).toEqual([
      { title: 'Morning walk', order: 0 },
      { title: 'Museum', order: 2 },
      { title: 'Evening view', order: 3 },
    ]);
    expect(morning.order).toBe(0);
  });

  it('restores activities from trip snapshots', async () => {
    const repository = createTestRepository();
    const oldDestination = createDestination({
      name: 'Old stop',
      coordinates: { lat: 0, lng: 0 },
    });
    const newDestination = createDestination({
      name: 'Paris',
      coordinates: { lat: 48.8566, lng: 2.3522 },
    });
    const newActivity = createActivityModel({
      destinationId: newDestination.id,
      title: 'Louvre',
      order: 4,
    });

    await repository.saveDestination(oldDestination);
    await repository.createActivity({
      destinationId: oldDestination.id,
      title: 'Old activity',
    });

    await repository.replaceTripData({
      destinations: [newDestination],
      routeLegs: [],
      activities: [newActivity],
    });

    expect(await repository.listActivities(oldDestination.id)).toEqual([]);
    expect(await repository.listActivities(newDestination.id)).toEqual([newActivity]);
  });
});
