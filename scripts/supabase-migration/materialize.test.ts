import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { openPlotterDatabase } from '../../server/database';
import { createRawArchive } from './archive';
import { loadFixtureSource } from './cli';
import { materializeSource } from './materialize';
import { fingerprintSourceSnapshot, type SourceSnapshot } from './source';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true });
});

async function fixture() {
  return loadFixtureSource(join(import.meta.dirname, 'fixtures', 'complete-project.json'));
}

describe('Supabase source materialization', () => {
  it('creates a fresh production-schema SQLite database and immutable media while preserving source fields', async () => {
    const root = mkdtempSync(join(tmpdir(), 'plotter-materialize-'));
    temporaryDirectories.push(root);
    const loaded = await fixture();
    const fingerprint = fingerprintSourceSnapshot(loaded.source, loaded.schema);
    const materialized = await materializeSource({
      destinationRoot: root,
      archiveRelativePath: 'imports/synthetic',
      source: loaded.source,
      fingerprint,
      importedAt: '2026-08-17T12:00:00.000Z',
    });

    expect(materialized.failures).toEqual([]);
    const database = openPlotterDatabase(materialized.databasePath);
    expect(database.connection.prepare('SELECT * FROM trips').get()).toMatchObject({
      id: '00000000-0000-4000-8000-000000000001',
      owner_user_id: '00000000-0000-4000-8000-000000000010',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z',
    });
    expect(database.connection.prepare('SELECT * FROM migration_provenance').get()).toMatchObject({
      source: 'supabase',
      archive_relative_path: 'imports/synthetic',
    });
    expect(database.connection.prepare('SELECT * FROM media_assets').get()).toMatchObject({
      id: '00000000-0000-4000-8000-000000000006',
      bucket_id: 'trip-media',
      object_path: '00000000-0000-4000-8000-000000000001/hero.png',
      uploaded_by: '00000000-0000-4000-8000-000000000010',
      relative_path: 'media/00000000-0000-4000-8000-000000000006.png',
    });
    database.close();
    expect(readFileSync(join(materialized.mediaRoot, '00000000-0000-4000-8000-000000000006.png'), 'utf8'))
      .toBe('fixture-image');
    expect(materialized.orphanClassifications).toEqual(expect.arrayContaining([
      { kind: 'trip-member', sourceId: '00000000-0000-4000-8000-000000000001\u000000000000-0000-4000-8000-000000000010', disposition: 'preserved-in-raw-archive' },
      { kind: 'unreferenced-storage-object', sourceId: 'unreferenced/readme.bin', disposition: 'preserved-in-raw-archive' },
    ]));
  });

  it.each([
    ['foreign-key', (source: SourceSnapshot) => {
      source.tables.route_legs[0]!.target_destination_id = '00000000-0000-4000-8000-999999999999';
    }],
    ['domain', (source: SourceSnapshot) => {
      source.tables.destinations[0]!.status = 'not-a-status';
    }],
    ['domain', (source: SourceSnapshot) => {
      source.tables.trip_members[0]!.role = 'not-a-role';
    }],
    ['referenced-media', (source: SourceSnapshot) => {
      source.storage = source.storage.filter((object) => object.path !== source.tables.media_assets[0]!.object_path);
    }],
  ])('returns a failed %s gate without a promotable candidate', async (gate, mutate) => {
    const root = mkdtempSync(join(tmpdir(), `plotter-materialize-${gate}-`));
    temporaryDirectories.push(root);
    const loaded = await fixture();
    mutate(loaded.source);
    const materialized = await materializeSource({
      destinationRoot: root,
      archiveRelativePath: 'imports/synthetic',
      source: loaded.source,
      fingerprint: fingerprintSourceSnapshot(loaded.source, loaded.schema),
      importedAt: '2026-08-17T12:00:00.000Z',
    });
    expect(materialized.failures.some((failure) => failure.gate === gate)).toBe(true);
    expect(materialized.promotable).toBe(false);
    if (gate === 'foreign-key') {
      expect(materialized.orphanClassifications).toContainEqual({
        kind: 'orphan-route-leg',
        sourceId: '00000000-0000-4000-8000-000000000004',
        disposition: 'preserved-in-raw-archive-and-rejected',
      });
    }
  });

  it('accepts complete canonical nested destination, routing, and activity domain values', async () => {
    const root = mkdtempSync(join(tmpdir(), 'plotter-materialize-complete-domain-'));
    temporaryDirectories.push(root);
    const loaded = await fixture();
    const destination = loaded.source.tables.destinations[0]!;
    destination.routing_anchors = {
      'driving-car': {
        profile: 'driving-car',
        coordinates: { lat: 51, lng: -0.1 },
        originalCoordinates: { lat: 51, lng: -0.1 },
        snapDistanceKm: 0,
        provider: 'openrouteservice',
        resolvedAt: '2026-01-01T00:00:00.000Z',
      },
    };
    destination.media = [{
      id: '00000000-0000-4000-8000-000000000030',
      url: 'https://example.invalid/image',
      thumbnailUrl: 'https://example.invalid/thumb',
      caption: 'Nested media', credit: '', sortOrder: 0,
      bucketId: 'trip-media', objectPath: 'nested/image.png',
      contentType: 'image/png', sizeBytes: 1,
      uploadedAt: '2026-01-01T00:00:00.000Z',
    }];
    destination.research = {
      notes: '',
      links: [{
        id: '00000000-0000-4000-8000-000000000031', title: 'Research',
        url: 'https://example.invalid/research', domain: 'example.invalid', sortOrder: 0,
        previewFetchedAt: '2026-01-01T00:00:00.000Z',
      }],
      bookReferences: [{
        id: '00000000-0000-4000-8000-000000000032', source: 'Other',
        reference: 'Chapter', note: '',
      }],
    };
    destination.activities = { items: [{
      id: '00000000-0000-4000-8000-000000000033', label: 'Legacy item',
      category: 'other', notes: '',
    }] };
    const waypoint = {
      id: '00000000-0000-4000-8000-000000000034', order: 0, name: 'Waypoint',
      coordinates: { lat: 52, lng: -1 },
      location: {
        placeName: 'Waypoint', regionName: 'England', countryName: 'United Kingdom',
        sourceLabel: 'Waypoint, England', sourceProvider: 'maptiler', sourceFeatureId: 'feature',
      },
      notes: '',
      links: [{
        id: '00000000-0000-4000-8000-000000000035', title: 'Waypoint link',
        url: 'https://example.invalid/waypoint', domain: 'example.invalid', sortOrder: 0,
      }],
    };
    const route = loaded.source.tables.route_legs[0]!;
    route.geometry = { type: 'LineString', coordinates: [[-0.1, 51], [-3, 56]] };
    route.waypoints = [waypoint];
    route.sections = [{ kind: 'road', startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 10 }];
    route.warnings = [{
      code: 'ROUTE_INTENT_REASSIGNMENT_REQUIRED', message: 'Review intent',
      context: {
        sourceRouteLegId: '00000000-0000-4000-8000-000000000004',
        unresolvedIntent: {
          movement: 'drive', calculation: 'manual', ferryPolicy: 'avoid',
          waypoints: [waypoint], notes: '',
        },
      },
    }];
    route.provider_diagnostic = {
      provider: 'openrouteservice', httpStatus: 429, code: 2010,
      providerMessage: 'Retry', coordinateIndex: 0,
      requestedProfile: 'driving-car', actualProfile: 'driving-hgv',
      retryAfterMs: 1000, attempts: 2, retryAttempts: 1,
    };
    loaded.source.tables.activities[0]!.location = {
      name: 'Trail', address: '', coordinates: { lat: 51.1, lng: -0.2 },
      sourceProvider: 'manual', sourceFeatureId: 'manual-location',
    };
    loaded.source.tables.activities[0]!.links = [{
      id: '00000000-0000-4000-8000-000000000036', title: 'Activity link',
      url: 'https://example.invalid/activity', domain: 'example.invalid', sortOrder: 0,
    }];

    const materialized = await materializeSource({
      destinationRoot: root,
      archiveRelativePath: 'imports/synthetic',
      source: loaded.source,
      fingerprint: fingerprintSourceSnapshot(loaded.source, loaded.schema),
      importedAt: '2026-08-17T12:00:00.000Z',
    });

    expect(materialized.failures).toEqual([]);
    expect(materialized.promotable).toBe(true);
    expect(() => materialized.validate()).not.toThrow();
  });

  it('normalizes production-supported legacy destination research without mutating the source row', async () => {
    const root = mkdtempSync(join(tmpdir(), 'plotter-materialize-legacy-research-'));
    temporaryDirectories.push(root);
    const loaded = await fixture();
    const destination = loaded.source.tables.destinations[0]!;
    const legacyResearch = {
      notes: null,
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
    };
    destination.research = structuredClone(legacyResearch);
    const rawSourceRow = structuredClone(destination);
    const fingerprint = fingerprintSourceSnapshot(loaded.source, loaded.schema);
    const archive = await createRawArchive({
      stagingParent: root,
      source: loaded.source,
      schema: loaded.schema,
      fingerprint,
      rawSchemaSql: loaded.rawSchemaSql,
      rawDataSql: loaded.rawDataSql,
    });
    const materializedRoot = join(archive.root, 'materialized');
    mkdirSync(materializedRoot, { mode: 0o700 });

    const materialized = await materializeSource({
      destinationRoot: materializedRoot,
      archiveRelativePath: 'imports/synthetic',
      source: loaded.source,
      fingerprint,
      importedAt: '2026-08-17T12:00:00.000Z',
    });

    expect(materialized.failures).toEqual([]);
    expect(materialized.promotable).toBe(true);
    expect(destination).toEqual(rawSourceRow);
    const archivedRows = JSON.parse(readFileSync(
      join(archive.payloadRoot, 'tables', 'destinations.json'),
      'utf8',
    )) as Array<Record<string, unknown>>;
    expect(archivedRows[0]!.research).toEqual(legacyResearch);
    const database = new DatabaseSync(materialized.databasePath, { readOnly: true });
    const persisted = database.prepare('SELECT research FROM destinations WHERE id = ?')
      .get(String(destination.id)) as { research: string };
    const provenance = database.prepare('SELECT details FROM migration_provenance').get() as {
      details: string;
    };
    expect(JSON.parse(persisted.research)).toEqual({
      notes: '',
      bookReferences: [],
      links: [
        {
          id: 'official-link',
          title: 'Official',
          url: 'https://kyoto.example/official',
          domain: 'kyoto.example',
          sortOrder: 0,
        },
        {
          id: 'wiki-link',
          title: 'wikipedia.org',
          url: 'https://www.wikipedia.org/wiki/Kyoto',
          domain: 'wikipedia.org',
          sortOrder: 0,
        },
      ],
    });
    expect(JSON.parse(provenance.details)).toMatchObject({
      normalizedDestinationFields: [{
        id: destination.id,
        fields: ['research'],
      }],
    });
    database.close();
  });

  it('rejects unknown legacy research-link fields before normalization can discard them', async () => {
    const root = mkdtempSync(join(tmpdir(), 'plotter-materialize-unknown-legacy-link-field-'));
    temporaryDirectories.push(root);
    const loaded = await fixture();
    const destination = loaded.source.tables.destinations[0]!;
    const legacyResearch = {
      notes: null,
      links: [{
        id: 'legacy-link',
        title: '',
        url: 'example.invalid',
        unexpectedLegacyField: 'must-not-disappear',
      }],
    };
    destination.research = structuredClone(legacyResearch);
    const rawSourceRow = structuredClone(destination);
    const fingerprint = fingerprintSourceSnapshot(loaded.source, loaded.schema);
    const archive = await createRawArchive({
      stagingParent: root,
      source: loaded.source,
      schema: loaded.schema,
      fingerprint,
      rawSchemaSql: loaded.rawSchemaSql,
      rawDataSql: loaded.rawDataSql,
    });
    const materializedRoot = join(archive.root, 'materialized');
    mkdirSync(materializedRoot, { mode: 0o700 });

    const materialized = await materializeSource({
      destinationRoot: materializedRoot,
      archiveRelativePath: 'imports/synthetic',
      source: loaded.source,
      fingerprint,
      importedAt: '2026-08-17T12:00:00.000Z',
    });

    expect(materialized.failures).toContainEqual({
      gate: 'domain',
      message: 'Source destination domain data is invalid.',
    });
    expect(materialized.promotable).toBe(false);
    expect(destination).toEqual(rawSourceRow);
    const archivedRows = JSON.parse(readFileSync(
      join(archive.payloadRoot, 'tables', 'destinations.json'),
      'utf8',
    )) as Array<Record<string, unknown>>;
    expect(archivedRows[0]!.research).toEqual(legacyResearch);
  });

  it.each([
    ['vehicle restrictions', (source: SourceSnapshot) => {
      source.tables.trips[0]!.vehicle_restrictions = { height: 'too-tall' };
    }],
    ['destination location', (source: SourceSnapshot) => {
      source.tables.destinations[0]!.location = {
        placeName: 'First stop', regionName: 'England', countryName: 'United Kingdom',
        sourceLabel: 'First stop, England', sourceProvider: 'unknown-provider',
      };
    }],
    ['routing anchor', (source: SourceSnapshot) => {
      source.tables.destinations[0]!.routing_anchors = {
        'driving-car': {
          profile: 'driving-car', coordinates: { lat: '51', lng: -0.1 },
          originalCoordinates: { lat: 51, lng: -0.1 }, snapDistanceKm: 0,
          provider: 'openrouteservice', resolvedAt: '2026-01-01T00:00:00.000Z',
        },
      };
    }],
    ['destination media item', (source: SourceSnapshot) => {
      source.tables.destinations[0]!.media = [{
        id: 'media', url: 'https://example.invalid/image', caption: 3, credit: '',
      }];
    }],
    ['research link', (source: SourceSnapshot) => {
      source.tables.destinations[0]!.research = {
        notes: '', links: [{ id: 'link', title: 'Link', url: 3, domain: 'example.invalid', sortOrder: 0 }],
        bookReferences: [],
      };
    }],
    ['legacy research notes', (source: SourceSnapshot) => {
      source.tables.destinations[0]!.research = { notes: 42, links: [] };
    }],
    ['legacy research link derived fields', (source: SourceSnapshot) => {
      source.tables.destinations[0]!.research = {
        notes: null,
        links: [{
          id: 'legacy-link', title: '', url: 'example.invalid', imageUrl: 42,
        }],
      };
    }],
    ['legacy research container', (source: SourceSnapshot) => {
      source.tables.destinations[0]!.research = 42;
    }],
    ['legacy research container unknown field', (source: SourceSnapshot) => {
      source.tables.destinations[0]!.research = {
        notes: null, links: [], unexpectedLegacyField: 'must-not-disappear',
      };
    }],
    ['book reference', (source: SourceSnapshot) => {
      source.tables.destinations[0]!.research = {
        notes: '', links: [], bookReferences: [{ id: 'book', source: 'Invalid', reference: '', note: '' }],
      };
    }],
    ['book reference unknown field', (source: SourceSnapshot) => {
      source.tables.destinations[0]!.research = {
        notes: '', links: [], bookReferences: [{
          id: '00000000-0000-4000-8000-000000000032', source: 'Other', reference: '', note: '',
          unexpectedLegacyField: 'must-not-disappear',
        }],
      };
    }],
    ['destination media item unknown field', (source: SourceSnapshot) => {
      source.tables.destinations[0]!.media = [{
        id: '00000000-0000-4000-8000-000000000030',
        url: 'https://example.invalid/image', caption: '', credit: '',
        unexpectedLegacyField: 'must-not-disappear',
      }];
    }],
    ['legacy activity item', (source: SourceSnapshot) => {
      source.tables.destinations[0]!.activities = {
        items: [{ id: 'activity', label: 3, category: 'other', notes: '' }],
      };
    }],
    ['route geometry', (source: SourceSnapshot) => {
      source.tables.route_legs[0]!.geometry = { type: 'LineString', coordinates: [[-0.1]] };
    }],
    ['route waypoint', (source: SourceSnapshot) => {
      source.tables.route_legs[0]!.waypoints = [{
        id: 'waypoint', order: 0, name: 'Waypoint', coordinates: { lat: 51, lng: -0.1 },
        location: { placeName: 'Waypoint' }, notes: '', links: [],
      }];
    }],
    ['route section', (source: SourceSnapshot) => {
      source.tables.route_legs[0]!.sections = [{
        kind: 'tunnel', startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 1,
      }];
    }],
    ['route warning', (source: SourceSnapshot) => {
      source.tables.route_legs[0]!.warnings = [{ code: 'UNKNOWN', message: 'bad' }];
    }],
    ['provider diagnostic', (source: SourceSnapshot) => {
      source.tables.route_legs[0]!.provider_diagnostic = {
        provider: 'unknown', httpStatus: '500', providerMessage: 'bad',
      };
    }],
    ['activity location', (source: SourceSnapshot) => {
      source.tables.activities[0]!.location = {
        name: 'Place', address: '', coordinates: { lat: '51', lng: -0.1 },
      };
    }],
    ['activity link', (source: SourceSnapshot) => {
      source.tables.activities[0]!.links = [{
        id: 'link', title: 'Link', url: 'https://example.invalid', domain: 'example.invalid',
        sortOrder: 'first',
      }];
    }],
  ])('fails closed on malformed nested %s domain data', async (_label, mutate) => {
    const root = mkdtempSync(join(tmpdir(), 'plotter-materialize-nested-domain-'));
    temporaryDirectories.push(root);
    const loaded = await fixture();
    mutate(loaded.source);
    const materialized = await materializeSource({
      destinationRoot: root,
      archiveRelativePath: 'imports/synthetic',
      source: loaded.source,
      fingerprint: fingerprintSourceSnapshot(loaded.source, loaded.schema),
      importedAt: '2026-08-17T12:00:00.000Z',
    });

    expect(materialized.failures.some((failure) => failure.gate === 'domain')).toBe(true);
    expect(materialized.promotable).toBe(false);
  });

  it('detects changed materialized media bytes before promotion', async () => {
    const root = mkdtempSync(join(tmpdir(), 'plotter-materialize-changed-'));
    temporaryDirectories.push(root);
    const loaded = await fixture();
    const materialized = await materializeSource({
      destinationRoot: root,
      archiveRelativePath: 'imports/synthetic',
      source: loaded.source,
      fingerprint: fingerprintSourceSnapshot(loaded.source, loaded.schema),
      importedAt: '2026-08-17T12:00:00.000Z',
    });
    writeFileSync(join(materialized.mediaRoot, '00000000-0000-4000-8000-000000000006.png'), 'changed');
    expect(() => materialized.validate()).toThrow('Materialized media bytes changed.');
  });

  it('accepts PostgREST offset/microsecond timestamps and derives nullable legacy media facts from preserved bytes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'plotter-materialize-legacy-media-'));
    temporaryDirectories.push(root);
    const loaded = await fixture();
    loaded.source.tables.trips[0]!.created_at = '2026-01-01T00:00:00.123456+00:00';
    loaded.source.tables.media_assets[0]!.content_type = null;
    loaded.source.tables.media_assets[0]!.size_bytes = null;
    const materialized = await materializeSource({
      destinationRoot: root,
      archiveRelativePath: 'imports/synthetic',
      source: loaded.source,
      fingerprint: fingerprintSourceSnapshot(loaded.source, loaded.schema),
      importedAt: '2026-08-17T12:00:00.000Z',
    });
    expect(materialized.failures).toEqual([]);
    const database = new DatabaseSync(materialized.databasePath, { readOnly: true });
    expect(database.prepare('SELECT created_at FROM trips').get()).toEqual({
      created_at: '2026-01-01T00:00:00.123456+00:00',
    });
    expect(database.prepare('SELECT content_type, size_bytes FROM media_assets').get()).toEqual({
      content_type: 'image/png', size_bytes: 13,
    });
    database.close();
  });
});
