import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { assertDatabaseIntegrity, openPlotterDatabase } from './database';

const temporaryDirectories: string[] = [];

function createDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'plotter-database-'));
  temporaryDirectories.push(directory);
  return join(directory, 'test.sqlite3');
}

function insertRow(connection: DatabaseSync, table: string, row: Record<string, SQLOutputValue>): void {
  const columns = Object.keys(row);
  const placeholders = columns.map(() => '?').join(', ');
  connection.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`).run(...Object.values(row));
}

function seedRelationshipGraph(connection: DatabaseSync): void {
  const timestamp = '2026-08-17T10:00:00.000Z';
  insertRow(connection, 'trips', {
    id: 'trip-relations',
    owner_user_id: 'source-user',
    name: 'Relations',
    description: null,
    vehicle_preset: null,
    vehicle_profile: null,
    vehicle_type: null,
    vehicle_restrictions: null,
    created_at: timestamp,
    updated_at: timestamp,
  });
  for (const [id, order] of [['destination-origin', 0], ['destination-target', 1]] as const) {
    insertRow(connection, 'destinations', {
      id,
      trip_id: 'trip-relations',
      name: id,
      country_region: '',
      lat: 1,
      lng: 2,
      location: '{}',
      stop_order: order,
      status: 'planned',
      priority: 'medium',
      timing: '{}',
      why: '{}',
      media: '[]',
      research: '{}',
      activities: '{}',
      route_context: '{}',
      routing_anchors: '{}',
      tags: '[]',
      created_at: timestamp,
      updated_at: timestamp,
    });
  }
  insertRow(connection, 'route_legs', {
    id: 'route-relation',
    trip_id: 'trip-relations',
    origin_destination_id: 'destination-origin',
    target_destination_id: 'destination-target',
    movement: 'drive',
    calculation_mode: 'automatic',
    status: 'pending',
    notes: '',
    created_at: timestamp,
    updated_at: timestamp,
  });
  insertRow(connection, 'activities', {
    id: 'activity-relation',
    trip_id: 'trip-relations',
    destination_id: 'destination-origin',
    activity_order: 0,
    title: 'Activity',
    description: '',
    category: 'other',
    status: 'idea',
    priority: 'medium',
    links: '[]',
    notes: '',
    tags: '[]',
    created_at: timestamp,
    updated_at: timestamp,
  });
  insertRow(connection, 'media_assets', {
    id: 'media-relation',
    trip_id: 'trip-relations',
    destination_id: 'destination-origin',
    activity_id: 'activity-relation',
    bucket_id: 'trip-media',
    object_path: 'relations/media.webp',
    caption: '',
    credit: '',
    sort_order: 0,
    uploaded_by: 'source-user',
    relative_path: 'media/media-relation.webp',
    sha256: 'b'.repeat(64),
    created_at: timestamp,
    updated_at: timestamp,
  });
  insertRow(connection, 'trip_revisions', { trip_id: 'trip-relations', revision: 0 });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('openPlotterDatabase', () => {
  it('creates and reopens schema version 1 with bounded connection settings', () => {
    const databasePath = createDatabasePath();
    const created = openPlotterDatabase(databasePath);

    expect(created.schemaVersion).toBe(1);
    expect(created.connection.prepare('PRAGMA user_version').get()).toEqual({ user_version: 1 });
    expect(created.connection.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
    expect(created.connection.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
    expect(created.connection.prepare('PRAGMA busy_timeout').get()).toEqual({ timeout: 5_000 });
    expect(created.connection.prepare('SELECT schema_version, directory_revision, accepted_import_id FROM store_metadata').get()).toEqual({
      schema_version: 1,
      directory_revision: 0,
      accepted_import_id: null,
    });
    created.close();

    const reopened = openPlotterDatabase(databasePath);
    expect(reopened.schemaVersion).toBe(1);
    reopened.close();
  });

  it('stores complete persisted rows and revision and import metadata without loss', () => {
    const database = openPlotterDatabase(createDatabasePath());
    const timestamp = '2026-08-17T10:00:00.000Z';
    const trip = {
      id: 'trip-aurora',
      owner_user_id: 'source-user',
      name: 'Aurora drive',
      description: 'Northern Norway',
      vehicle_preset: 'large-camper',
      vehicle_profile: 'driving-car',
      vehicle_type: null,
      vehicle_restrictions: { length: 7.5, width: 2.5, height: 3.2, weight: 5, axleLoad: 3 },
      created_at: timestamp,
      updated_at: timestamp,
    };
    const origin = {
      id: 'destination-tromso',
      trip_id: trip.id,
      name: 'Tromso',
      country_region: 'Troms, Norway',
      lat: 69.6492,
      lng: 18.9553,
      location: {
        placeName: 'Tromso',
        regionName: 'Troms',
        countryName: 'Norway',
        countryCode: 'NO',
        sourceLabel: 'MapTiler',
        sourceProvider: 'maptiler',
        sourceFeatureId: 'place.1',
      },
      stop_order: 0,
      status: 'planned',
      priority: 'must-do',
      timing: {
        idealMonths: ['January'],
        expectedStayDays: 3,
        provisionalStartDate: '2027-01-10',
        provisionalEndDate: '2027-01-13',
      },
      why: { summary: 'Aurora', highlights: 'Cable car', personalRationale: 'Winter route' },
      media: [{ id: 'legacy-media', url: 'https://example.test/legacy.jpg', caption: 'Legacy', credit: 'Archive', sortOrder: 4 }],
      research: { notes: 'Northern lights', links: [], bookReferences: [] },
      activities: { items: [{ id: 'legacy-activity', label: 'Old activity', category: 'outdoors', notes: 'Keep' }] },
      route_context: { previousNextNotes: 'Northbound', drivingNotes: 'Ice', borderShippingNotes: '', notes: 'Fuel first' },
      routing_anchors: {
        'driving-car': {
          profile: 'driving-car',
          coordinates: { lat: 69.65, lng: 18.96 },
          originalCoordinates: { lat: 69.6492, lng: 18.9553 },
          snapDistanceKm: 0.4,
          provider: 'openrouteservice',
          resolvedAt: timestamp,
        },
      },
      tags: ['arctic', 'winter'],
      created_at: timestamp,
      updated_at: timestamp,
    };
    const target = {
      ...origin,
      id: 'destination-alta',
      name: 'Alta',
      lat: 69.9689,
      lng: 23.2716,
      stop_order: 1,
    };
    const activity = {
      id: 'activity-cable-car',
      trip_id: trip.id,
      destination_id: origin.id,
      activity_order: 0,
      title: 'Fjellheisen',
      description: 'Cable car viewpoint',
      category: 'outdoors',
      status: 'booked',
      priority: 'high',
      location: {
        name: 'Fjellheisen',
        address: 'Sollivegen 12',
        coordinates: { lat: 69.6389, lng: 18.9675 },
        sourceProvider: 'maptiler',
        sourceFeatureId: 'poi.1',
      },
      links: [{ id: 'official', title: 'Official', url: 'https://example.test', domain: 'example.test', sortOrder: 0 }],
      notes: 'Book sunset slot',
      tags: ['viewpoint'],
      created_at: timestamp,
      updated_at: timestamp,
    };
    const routeLeg = {
      id: 'leg-tromso-alta',
      trip_id: trip.id,
      origin_destination_id: origin.id,
      target_destination_id: target.id,
      movement: 'drive',
      calculation_mode: 'automatic',
      ferry_policy: 'avoid',
      waypoints: [{
        id: 'waypoint-1',
        order: 0,
        name: 'Fuel',
        coordinates: { lat: 69.7, lng: 19.1 },
        location: {
          placeName: 'Fuel',
          regionName: 'Troms',
          countryName: 'Norway',
          countryCode: 'NO',
          sourceLabel: 'MapTiler',
          sourceProvider: 'maptiler',
          sourceFeatureId: 'place.2',
        },
        notes: '',
        links: [],
      }],
      sections: [{ kind: 'road', startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 385.4 }],
      warnings: [{ code: 'ROUTING_ANCHOR_ADJUSTED', message: 'Start snapped to road' }],
      status: 'ready',
      distance_km: 385.4,
      travel_time_hours: 5.75,
      geometry: { type: 'LineString', coordinates: [[18.9553, 69.6492], [23.2716, 69.9689]] },
      provider: 'openrouteservice',
      profile: 'driving-car',
      route_key: 'route-key',
      calculated_at: timestamp,
      error: null,
      provider_diagnostic: {
        provider: 'openrouteservice',
        httpStatus: 200,
        providerMessage: 'Recovered route',
        requestedProfile: 'driving-hgv',
        actualProfile: 'driving-car',
        attempts: 2,
      },
      notes: 'Avoid ferries.',
      created_at: timestamp,
      updated_at: timestamp,
    };
    const media = {
      id: 'media-activity',
      trip_id: trip.id,
      destination_id: origin.id,
      activity_id: activity.id,
      bucket_id: 'trip-media',
      object_path: `${trip.id}/${origin.id}/${activity.id}/aurora.webp`,
      caption: 'Aurora',
      credit: 'Example photographer',
      sort_order: 7,
      content_type: 'image/webp',
      size_bytes: 1234,
      uploaded_by: 'source-user',
      created_at: timestamp,
      updated_at: timestamp,
    };

    insertRow(database.connection, 'trips', {
      ...trip,
      vehicle_restrictions: JSON.stringify(trip.vehicle_restrictions),
    });
    for (const destination of [origin, target]) {
      insertRow(database.connection, 'destinations', {
        ...destination,
        location: JSON.stringify(destination.location),
        timing: JSON.stringify(destination.timing),
        why: JSON.stringify(destination.why),
        media: JSON.stringify(destination.media),
        research: JSON.stringify(destination.research),
        activities: JSON.stringify(destination.activities),
        route_context: JSON.stringify(destination.route_context),
        routing_anchors: JSON.stringify(destination.routing_anchors),
        tags: JSON.stringify(destination.tags),
      });
    }
    insertRow(database.connection, 'activities', {
      ...activity,
      location: JSON.stringify(activity.location),
      links: JSON.stringify(activity.links),
      tags: JSON.stringify(activity.tags),
    });
    insertRow(database.connection, 'route_legs', {
      ...routeLeg,
      waypoints: JSON.stringify(routeLeg.waypoints),
      sections: JSON.stringify(routeLeg.sections),
      warnings: JSON.stringify(routeLeg.warnings),
      geometry: JSON.stringify(routeLeg.geometry),
      provider_diagnostic: JSON.stringify(routeLeg.provider_diagnostic),
    });
    insertRow(database.connection, 'media_assets', {
      ...media,
      relative_path: 'media/media-activity.webp',
      sha256: 'c'.repeat(64),
    });
    insertRow(database.connection, 'trip_revisions', { trip_id: trip.id, revision: 9 });
    insertRow(database.connection, 'migration_provenance', {
      id: 'import-1',
      source: 'supabase',
      source_fingerprint: 'a'.repeat(64),
      source_created_at: timestamp,
      imported_at: timestamp,
      archive_relative_path: 'imports/2026-08-17T100000Z',
      details: JSON.stringify({ projectRef: 'source-project', rowCounts: { trips: 1 } }),
    });
    database.connection.prepare('UPDATE store_metadata SET directory_revision = ?, accepted_import_id = ? WHERE singleton = 1').run(5, 'import-1');

    expect(database.connection.prepare('SELECT * FROM trips').get()).toEqual({
      ...trip,
      vehicle_restrictions: JSON.stringify(trip.vehicle_restrictions),
    });
    expect(database.connection.prepare('SELECT COUNT(*) AS count FROM destinations').get()).toEqual({ count: 2 });
    expect(database.connection.prepare('SELECT * FROM route_legs').get()).toMatchObject({
      id: routeLeg.id,
      waypoints: JSON.stringify(routeLeg.waypoints),
      sections: JSON.stringify(routeLeg.sections),
      warnings: JSON.stringify(routeLeg.warnings),
      geometry: JSON.stringify(routeLeg.geometry),
      provider_diagnostic: JSON.stringify(routeLeg.provider_diagnostic),
    });
    expect(database.connection.prepare('SELECT * FROM activities').get()).toMatchObject({
      id: activity.id,
      location: JSON.stringify(activity.location),
      links: JSON.stringify(activity.links),
      tags: JSON.stringify(activity.tags),
    });
    expect(database.connection.prepare('SELECT * FROM media_assets').get()).toMatchObject(media);
    expect(database.connection.prepare('SELECT * FROM trip_revisions').get()).toEqual({ trip_id: trip.id, revision: 9 });
    expect(database.connection.prepare('SELECT schema_version, directory_revision, accepted_import_id FROM store_metadata').get()).toEqual({
      schema_version: 1,
      directory_revision: 5,
      accepted_import_id: 'import-1',
    });
    expect(database.connection.prepare('SELECT id, source_fingerprint FROM migration_provenance').get()).toEqual({
      id: 'import-1',
      source_fingerprint: 'a'.repeat(64),
    });
    database.close();
  });

  it('rejects duplicate identities and cross-owner references and cascades owned rows', () => {
    const database = openPlotterDatabase(createDatabasePath());
    seedRelationshipGraph(database.connection);

    for (const table of ['trips', 'destinations', 'route_legs', 'activities', 'media_assets']) {
      expect(() => database.connection.exec(`INSERT INTO ${table} SELECT * FROM ${table}`)).toThrow();
    }

    expect(() => database.connection.exec(`
      INSERT INTO destinations
      SELECT id || '-invalid', 'missing-trip', name, country_region, lat, lng, location,
        stop_order, status, priority, timing, why, media, research, activities,
        route_context, routing_anchors, tags, created_at, updated_at
      FROM destinations WHERE id = 'destination-origin'
    `)).toThrow();
    expect(() => database.connection.exec(`
      INSERT INTO route_legs
      SELECT id || '-invalid', trip_id, origin_destination_id, 'missing-destination', movement,
        calculation_mode, ferry_policy, waypoints, sections, warnings, status, distance_km,
        travel_time_hours, geometry, provider, profile, route_key, calculated_at, error,
        provider_diagnostic, notes, created_at, updated_at
      FROM route_legs WHERE id = 'route-relation'
    `)).toThrow();
    expect(() => database.connection.exec(`
      INSERT INTO activities
      SELECT id || '-invalid', trip_id, 'missing-destination', activity_order, title, description,
        category, status, priority, location, links, notes, tags, created_at, updated_at
      FROM activities WHERE id = 'activity-relation'
    `)).toThrow();
    expect(() => database.connection.exec(`
      INSERT INTO media_assets
      SELECT id || '-invalid', trip_id, destination_id, 'missing-activity', bucket_id,
        object_path || '-invalid', caption, credit, sort_order + 1, content_type, size_bytes,
        uploaded_by, relative_path, sha256, created_at, updated_at
      FROM media_assets WHERE id = 'media-relation'
    `)).toThrow();
    expect(() => database.connection.exec(`
      INSERT INTO media_assets
      SELECT id || '-ownerless', trip_id, NULL, NULL, bucket_id,
        object_path || '-ownerless', caption, credit, sort_order + 2, content_type, size_bytes,
        uploaded_by, relative_path, sha256, created_at, updated_at
      FROM media_assets WHERE id = 'media-relation'
    `)).toThrow();
    expect(() => database.connection.prepare('INSERT INTO trip_revisions (trip_id, revision) VALUES (?, ?)').run('missing-trip', 0)).toThrow();
    expect(() => database.connection.prepare('UPDATE media_assets SET relative_path = NULL').run()).toThrow();
    expect(() => database.connection.prepare('UPDATE media_assets SET sha256 = NULL').run()).toThrow();

    database.connection.prepare('DELETE FROM destinations WHERE id = ?').run('destination-origin');
    expect(database.connection.prepare('SELECT COUNT(*) AS count FROM route_legs').get()).toEqual({ count: 0 });
    expect(database.connection.prepare('SELECT COUNT(*) AS count FROM activities').get()).toEqual({ count: 0 });
    expect(database.connection.prepare('SELECT COUNT(*) AS count FROM media_assets').get()).toEqual({ count: 0 });

    database.connection.prepare('DELETE FROM trips WHERE id = ?').run('trip-relations');
    expect(database.connection.prepare('SELECT COUNT(*) AS count FROM destinations').get()).toEqual({ count: 0 });
    expect(database.connection.prepare('SELECT COUNT(*) AS count FROM trip_revisions').get()).toEqual({ count: 0 });
    database.close();
  });

  it('creates the indexes required by directory, trip, topology, activity, and media access patterns', () => {
    const database = openPlotterDatabase(createDatabasePath());

    expect(database.connection.prepare(`
      SELECT name FROM sqlite_schema
      WHERE type = 'index' AND name NOT LIKE 'sqlite_autoindex_%'
      ORDER BY name
    `).all()).toEqual([
      { name: 'activities_trip_destination_order_idx' },
      { name: 'activities_trip_updated_at_idx' },
      { name: 'destinations_trip_order_idx' },
      { name: 'destinations_trip_updated_at_idx' },
      { name: 'media_assets_activity_owned_sort_order_key' },
      { name: 'media_assets_destination_owned_sort_order_key' },
      { name: 'media_assets_trip_destination_activity_idx' },
      { name: 'route_legs_origin_destination_idx' },
      { name: 'route_legs_target_destination_idx' },
      { name: 'route_legs_trip_updated_at_idx' },
      { name: 'trips_updated_created_idx' },
    ]);
    database.close();
  });

  it('keeps destination and route-leg identities scoped to their owning trip', () => {
    const database = openPlotterDatabase(createDatabasePath());
    seedRelationshipGraph(database.connection);
    database.connection.exec(`
      INSERT INTO trips
      SELECT 'trip-relations-2', owner_user_id, name, description, vehicle_preset,
        vehicle_profile, vehicle_type, vehicle_restrictions, created_at, updated_at
      FROM trips WHERE id = 'trip-relations';

      INSERT INTO destinations
      SELECT id, 'trip-relations-2', name, country_region, lat, lng, location,
        stop_order, status, priority, timing, why, media, research, activities,
        route_context, routing_anchors, tags, created_at, updated_at
      FROM destinations WHERE trip_id = 'trip-relations';

      INSERT INTO route_legs
      SELECT id, 'trip-relations-2', origin_destination_id, target_destination_id,
        movement, calculation_mode, ferry_policy, waypoints, sections, warnings,
        status, distance_km, travel_time_hours, geometry, provider, profile, route_key,
        calculated_at, error, provider_diagnostic, notes, created_at, updated_at
      FROM route_legs WHERE trip_id = 'trip-relations';
    `);

    expect(database.connection.prepare(`
      SELECT COUNT(*) AS count FROM destinations WHERE id = 'destination-origin'
    `).get()).toEqual({ count: 2 });
    expect(database.connection.prepare(`
      SELECT COUNT(*) AS count FROM route_legs WHERE id = 'route-relation'
    `).get()).toEqual({ count: 2 });
    database.close();
  });

  it('requires a healthy database and an empty foreign-key check', () => {
    const database = openPlotterDatabase(createDatabasePath());
    seedRelationshipGraph(database.connection);

    expect(database.connection.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    expect(database.connection.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(() => assertDatabaseIntegrity(database.connection)).not.toThrow();

    database.connection.exec('PRAGMA foreign_keys = OFF');
    database.connection.prepare('INSERT INTO trip_revisions (trip_id, revision) VALUES (?, ?)').run('missing-trip', 0);
    database.connection.exec('PRAGMA foreign_keys = ON');

    expect(database.connection.prepare('PRAGMA foreign_key_check').all()).not.toEqual([]);
    expect(() => assertDatabaseIntegrity(database.connection))
      .toThrow('Plotter database integrity validation failed.');
    database.close();
  });

  it('rejects unsupported and corrupt canonical state with stable path-safe errors and no repair', () => {
    const unsupportedPath = createDatabasePath();
    const unsupported = openPlotterDatabase(unsupportedPath);
    unsupported.connection.exec('PRAGMA user_version = 2');
    unsupported.connection.prepare('UPDATE store_metadata SET schema_version = 2 WHERE singleton = 1').run();
    unsupported.close();

    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect(() => openPlotterDatabase(unsupportedPath))
        .toThrow('Plotter database schema is not supported.');
    }

    const invalidForeignKeyPath = createDatabasePath();
    const invalidForeignKeyDatabase = openPlotterDatabase(invalidForeignKeyPath);
    invalidForeignKeyDatabase.connection.exec('PRAGMA foreign_keys = OFF');
    invalidForeignKeyDatabase.connection.prepare('INSERT INTO trip_revisions (trip_id, revision) VALUES (?, ?)').run('missing-trip', 0);
    invalidForeignKeyDatabase.close();

    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect(() => openPlotterDatabase(invalidForeignKeyPath))
        .toThrow('Plotter database integrity validation failed.');
    }

    const corruptPath = createDatabasePath();
    writeFileSync(corruptPath, 'not a SQLite database');
    let corruptError: unknown;
    try {
      openPlotterDatabase(corruptPath);
    } catch (error) {
      corruptError = error;
    }

    expect(corruptError).toEqual(expect.objectContaining({
      message: 'Plotter database is unavailable.',
    }));
    expect((corruptError as Error).message).not.toContain(corruptPath);
    expect((corruptError as Error).message).not.toContain('PRAGMA');
  });

  it('rejects a current-version database missing a required table without repairing it', () => {
    const databasePath = createDatabasePath();
    const database = openPlotterDatabase(databasePath);
    database.connection.exec('DROP TABLE route_legs');
    database.close();

    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect(() => openPlotterDatabase(databasePath))
        .toThrow('Plotter database schema is not supported.');
    }
  });

  it('rejects a current-version database missing a required named index without repairing it', () => {
    const databasePath = createDatabasePath();
    const database = openPlotterDatabase(databasePath);
    database.connection.exec('DROP INDEX activities_trip_updated_at_idx');
    database.close();

    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect(() => openPlotterDatabase(databasePath))
        .toThrow('Plotter database schema is not supported.');
    }
  });

  it('rejects a current-version database with a malformed required column without repairing it', () => {
    const databasePath = createDatabasePath();
    const database = openPlotterDatabase(databasePath);
    database.connection.exec('ALTER TABLE trips RENAME COLUMN name TO trip_name');
    database.close();

    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect(() => openPlotterDatabase(databasePath))
        .toThrow('Plotter database schema is not supported.');
    }
  });
});
