import { lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRawArchive } from './archive';
import { KNOWN_SOURCE_SCHEMA, fingerprintSourceSnapshot, type SourceSnapshot } from './source';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true });
});

function snapshot(): SourceSnapshot {
  return {
    tables: {
      trips: [{
        id: 'trip-sensitive', owner_user_id: 'owner-sensitive', name: 'Private trip',
        description: '', metadata: {}, vehicle_preset: 'standard', vehicle_profile: 'driving-car',
        vehicle_type: null, vehicle_restrictions: {}, created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      }],
      trip_members: [], destinations: [], route_legs: [], activities: [], media_assets: [],
    },
    storage: [{
      path: 'trip-sensitive/private-object.png',
      listing: { name: 'private-object.png', id: 'object-sensitive', metadata: { size: 4 } },
      bytes: new TextEncoder().encode('data'),
    }],
  };
}

describe('lossless raw source archive', () => {
  it('writes a unique owner-only contained archive with canonical rows, SQL dumps, hashes, and bytes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'plotter-supabase-archive-'));
    temporaryDirectories.push(root);
    const source = snapshot();
    const fingerprint = fingerprintSourceSnapshot(source, KNOWN_SOURCE_SCHEMA);

    const first = await createRawArchive({
      stagingParent: root,
      source,
      schema: KNOWN_SOURCE_SCHEMA,
      fingerprint,
      rawSchemaSql: '-- synthetic schema\n',
      rawDataSql: '-- synthetic COPY data\n',
      now: () => new Date('2026-08-17T12:34:56.789Z'),
      randomId: () => '00000000-0000-4000-8000-000000000001',
    });
    const second = await createRawArchive({
      stagingParent: root,
      source,
      schema: KNOWN_SOURCE_SCHEMA,
      fingerprint,
      rawSchemaSql: '-- synthetic schema\n',
      rawDataSql: '-- synthetic COPY data\n',
      now: () => new Date('2026-08-17T12:34:56.789Z'),
      randomId: () => '00000000-0000-4000-8000-000000000002',
    });

    expect(first.root).not.toBe(second.root);
    expect(first.root.startsWith(`${realpathSync(root)}/`)).toBe(true);
    expect(lstatSync(first.root).mode & 0o777).toBe(0o700);
    expect(lstatSync(join(first.root, 'tables', 'trips.json')).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(join(first.root, 'tables', 'trips.json'), 'utf8')))
      .toEqual(source.tables.trips);
    expect(readFileSync(join(first.root, 'raw', 'schema.sql'), 'utf8')).toBe('-- synthetic schema\n');
    expect(readFileSync(join(first.root, 'raw', 'data.sql'), 'utf8')).toBe('-- synthetic COPY data\n');
    expect(readFileSync(join(first.root, 'objects', 'trip-sensitive', 'private-object.png'), 'utf8'))
      .toBe('data');
    const inventory = JSON.parse(readFileSync(join(first.root, 'inventory.json'), 'utf8')) as {
      tables: Record<string, { rowCount: number }>;
      storage: Array<{ byteCount: number; sha256: string }>;
      files: Array<{ archivePath: string; byteCount: number; sha256: string }>;
    };
    expect(inventory.tables.trips.rowCount).toBe(1);
    expect(inventory.storage).toEqual([{
      byteCount: 4,
      sha256: fingerprint.storageInventorySha256 === '' ? '' : expect.stringMatching(/^[0-9a-f]{64}$/),
      archivePath: 'objects/trip-sensitive/private-object.png',
      sourcePath: 'trip-sensitive/private-object.png',
      listing: source.storage[0]!.listing,
    }]);
    expect(inventory.files).toEqual(expect.arrayContaining([
      { archivePath: 'raw/schema.sql', byteCount: 20, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
      { archivePath: 'raw/data.sql', byteCount: 23, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
      { archivePath: 'objects/trip-sensitive/private-object.png', byteCount: 4, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
      expect.objectContaining({ archivePath: 'tables/trips.json', sha256: expect.stringMatching(/^[0-9a-f]{64}$/) }),
    ]));
    expect(inventory.files).toHaveLength(2 + 6 + 1);
  });

  it('does not put sensitive row values, URLs, keys, or object names in progress logs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'plotter-supabase-log-'));
    temporaryDirectories.push(root);
    const source = snapshot();
    const messages: string[] = [];
    await createRawArchive({
      stagingParent: root,
      source,
      schema: KNOWN_SOURCE_SCHEMA,
      fingerprint: fingerprintSourceSnapshot(source, KNOWN_SOURCE_SCHEMA),
      rawSchemaSql: '-- schema',
      rawDataSql: '-- data',
      log: (message) => messages.push(message),
    });
    const output = messages.join('\n');
    expect(output).not.toContain('trip-sensitive');
    expect(output).not.toContain('owner-sensitive');
    expect(output).not.toContain('private-object');
    expect(output).not.toContain('supabase.co');
    expect(output).not.toContain('secret');
    expect(output).toMatch(/rows=1/);
    expect(output).toMatch(/objects=1/);
  });

  it('rejects traversal before creating object bytes outside staging', async () => {
    const root = mkdtempSync(join(tmpdir(), 'plotter-supabase-traversal-'));
    temporaryDirectories.push(root);
    const source = snapshot();
    source.storage[0] = { ...source.storage[0]!, path: '../escape.png' };
    await expect(createRawArchive({
      stagingParent: root,
      source,
      schema: KNOWN_SOURCE_SCHEMA,
      fingerprint: fingerprintSourceSnapshot(source, KNOWN_SOURCE_SCHEMA),
      rawSchemaSql: '-- schema',
      rawDataSql: '-- data',
    })).rejects.toThrow('Source storage path is invalid.');
  });
});
