import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { openPlotterDatabase } from '../../server/database';
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
