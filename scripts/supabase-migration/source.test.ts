import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import {
  KNOWN_SOURCE_SCHEMA,
  SOURCE_TABLES,
  createSupabaseSourceBackend,
  fingerprintSourceSnapshot,
  readSourceSnapshot,
  sourceFingerprintDigest,
  validateSourceSchema,
  type SourceBackend,
  type SourceStorageEntry,
} from './source';

function row(id: string) {
  return { id, created_at: '2026-01-01T00:00:00.000Z' };
}

function strictBackend(input: {
  tables?: Partial<Record<(typeof SOURCE_TABLES)[number], Record<string, unknown>[]>>;
  directories?: Record<string, SourceStorageEntry[]>;
  bytes?: Record<string, string>;
  reportedCounts?: Partial<Record<(typeof SOURCE_TABLES)[number], number>>;
}) {
  const calls: Array<{ method: string; target: string; offset?: number; limit?: number }> = [];
  const backend: SourceBackend = {
    async select(request) {
      calls.push({ method: 'select', target: request.table, offset: request.offset, limit: request.limit });
      const rows = input.tables?.[request.table] ?? [];
      return {
        rows: rows.slice(request.offset, request.offset + request.limit),
        count: input.reportedCounts?.[request.table] ?? rows.length,
      };
    },
    async list(request) {
      calls.push({ method: 'list', target: request.prefix, offset: request.offset, limit: request.limit });
      const entries = input.directories?.[request.prefix] ?? [];
      return entries.slice(request.offset, request.offset + request.limit);
    },
    async download(request) {
      calls.push({ method: 'download', target: request.path });
      const value = input.bytes?.[request.path];
      if (value === undefined) throw new Error('missing synthetic object');
      return new TextEncoder().encode(value);
    },
  };
  return { backend, calls };
}

describe('read-only Supabase source inventory', () => {
  it('adapts the SDK through a strict select/list/download-only boundary with inclusive ranges', async () => {
    const operations: Array<{ method: string; target: string; range?: [number, number] }> = [];
    let selectedTable = '';
    const query = {
      order() { return this; },
      async range(from: number, to: number) {
        operations.at(-1)!.range = [from, to];
        return { data: [], error: null, count: 0 };
      },
    };
    const client = new Proxy({
      from(table: string) {
        selectedTable = table;
        return new Proxy({
          select() {
            operations.push({ method: 'select', target: selectedTable });
            return query;
          },
        }, { get(target, property) {
          if (property in target) return Reflect.get(target, property);
          throw new Error(`unexpected table operation ${String(property)}`);
        } });
      },
      storage: {
        from(bucket: string) {
          return new Proxy({
            async list() {
              operations.push({ method: 'list', target: bucket });
              return { data: [], error: null };
            },
            async download(path: string) {
              operations.push({ method: 'download', target: path });
              return { data: new Uint8Array([1]), error: null };
            },
          }, { get(target, property) {
            if (property in target) return Reflect.get(target, property);
            throw new Error(`unexpected storage operation ${String(property)}`);
          } });
        },
      },
    }, { get(target, property) {
      if (property in target) return Reflect.get(target, property);
      throw new Error(`unexpected Supabase operation ${String(property)}`);
    } }) as unknown as SupabaseClient;

    const backend = createSupabaseSourceBackend(client);
    await backend.select({ table: 'trips', columns: ['id'], order: ['id'], offset: 500, limit: 500 });
    await backend.list({ bucket: 'trip-media', prefix: '', offset: 0, limit: 500 });
    await backend.download({ bucket: 'trip-media', path: 'trip/image.png' });

    expect(operations).toEqual([
      { method: 'select', target: 'trips', range: [500, 999] },
      { method: 'list', target: 'trip-media' },
      { method: 'download', target: 'trip/image.png' },
    ]);
    expect(operations.every((operation) => ['select', 'list', 'download'].includes(operation.method))).toBe(true);
  });

  it('pages every known table through a short page and recursively downloads every storage object', async () => {
    const { backend, calls } = strictBackend({
      tables: {
        trips: [row('trip-b'), row('trip-a'), row('trip-c')],
        trip_members: [
          { trip_id: 'trip-a', user_id: 'user-b', role: 'viewer', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
          { trip_id: 'trip-a', user_id: 'user-a', role: 'owner', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
        ],
      },
      directories: {
        '': [
          { name: 'trip-a', id: null, metadata: null },
          { name: 'root.png', id: 'object-root', metadata: { size: 4 } },
        ],
        'trip-a': [
          { name: 'nested', id: null, metadata: null },
          { name: 'hero.jpg', id: 'object-hero', metadata: { size: 4 } },
        ],
        'trip-a/nested': [
          { name: 'detail.webp', id: 'object-detail', metadata: { size: 6 } },
        ],
      },
      bytes: {
        'root.png': 'root',
        'trip-a/hero.jpg': 'hero',
        'trip-a/nested/detail.webp': 'detail',
      },
    });

    const snapshot = await readSourceSnapshot(backend, { pageSize: 2, maxPages: 20 });

    expect(snapshot.tables.trips.map((item) => item.id)).toEqual(['trip-a', 'trip-b', 'trip-c']);
    expect(snapshot.storage.map((item) => item.path)).toEqual([
      'root.png',
      'trip-a/hero.jpg',
      'trip-a/nested/detail.webp',
    ]);
    expect(snapshot.storage.map((item) => new TextDecoder().decode(item.bytes))).toEqual([
      'root', 'hero', 'detail',
    ]);
    expect(calls.every((call) => ['select', 'list', 'download'].includes(call.method))).toBe(true);
    expect(calls.filter((call) => call.method === 'select' && call.target === 'trips'))
      .toEqual([
        { method: 'select', target: 'trips', offset: 0, limit: 2 },
        { method: 'select', target: 'trips', offset: 2, limit: 2 },
      ]);
    expect(calls.filter((call) => call.method === 'download')).toHaveLength(3);
  });

  it('fails closed on a count mismatch rather than accepting a truncated table', async () => {
    const { backend } = strictBackend({
      tables: { trips: [row('trip-a')] },
      reportedCounts: { trips: 2 },
    });
    await expect(readSourceSnapshot(backend, { pageSize: 2, maxPages: 20 }))
      .rejects.toThrow('Source table inventory is truncated.');
  });

  it('pages Storage at its current 100-entry list boundary instead of assuming the table page size', async () => {
    const entries = Array.from({ length: 101 }, (_, index) => ({
      name: `object-${String(index).padStart(3, '0')}.png`,
      id: `object-${index}`,
      metadata: { size: 1 },
    }));
    const bytes = Object.fromEntries(entries.map((entry) => [entry.name, 'x']));
    const { backend, calls } = strictBackend({ directories: { '': entries }, bytes });

    const snapshot = await readSourceSnapshot(backend);

    expect(snapshot.storage).toHaveLength(101);
    expect(calls.filter((call) => call.method === 'list')).toEqual([
      { method: 'list', target: '', offset: 0, limit: 100 },
      { method: 'list', target: '', offset: 100, limit: 100 },
    ]);
  });

  it('rejects downloaded bytes that disagree with authoritative listing size, including unreferenced objects', async () => {
    const { backend } = strictBackend({
      directories: {
        '': [{ name: 'unreferenced.bin', id: 'object', metadata: { size: 5 } }],
      },
      bytes: { 'unreferenced.bin': 'four' },
    });

    await expect(readSourceSnapshot(backend))
      .rejects.toThrow('Source storage download size does not match listing metadata.');
  });

  it('still enforces listing size when the referencing legacy media row has nullable size metadata', async () => {
    const { backend } = strictBackend({
      tables: {
        media_assets: [{
          id: '00000000-0000-4000-8000-000000000006',
          object_path: 'legacy.png',
          size_bytes: null,
        }],
      },
      directories: {
        '': [{ name: 'legacy.png', id: 'object', metadata: { size: 7 } }],
      },
      bytes: { 'legacy.png': 'legacy' },
    });

    await expect(readSourceSnapshot(backend))
      .rejects.toThrow('Source storage download size does not match listing metadata.');
  });

  it.each(['5', -1, 1.5])('rejects ambiguous listing size metadata %p', async (size) => {
    const { backend } = strictBackend({
      directories: {
        '': [{ name: 'ambiguous.bin', id: 'object', metadata: { size } }],
      },
      bytes: { 'ambiguous.bin': 'value' },
    });

    await expect(readSourceSnapshot(backend))
      .rejects.toThrow('Source storage listing size is invalid.');
  });

  it.each([null, { mimetype: 'application/octet-stream' }])(
    'preserves an object when listing size metadata is unavailable (%p)',
    async (metadata) => {
      const { backend } = strictBackend({
        directories: {
          '': [{ name: 'legacy.bin', id: 'object', metadata }],
        },
        bytes: { 'legacy.bin': 'legacy' },
      });

      const snapshot = await readSourceSnapshot(backend);

      expect(snapshot.storage[0]).toMatchObject({
        path: 'legacy.bin', listing: { metadata },
      });
      expect(new TextDecoder().decode(snapshot.storage[0]!.bytes)).toBe('legacy');
    },
  );

  it('fails closed when a full page reaches the configured page ceiling', async () => {
    const { backend } = strictBackend({ tables: { trips: [row('trip-a'), row('trip-b')] } });
    await expect(readSourceSnapshot(backend, { pageSize: 1, maxPages: 2 }))
      .rejects.toThrow('Source pagination limit was reached.');
  });

  it.each([
    {
      root: [
        { name: 'same', id: null, metadata: null },
        { name: 'same', id: 'file', metadata: { size: 1 } },
      ],
      child: [],
    },
    {
      root: [
        { name: 'duplicate.png', id: 'one', metadata: { size: 1 } },
        { name: 'duplicate.png', id: 'two', metadata: { size: 1 } },
      ],
      child: [],
    },
  ])('rejects duplicate or ambiguous Storage paths', async ({ root, child }) => {
    const { backend } = strictBackend({
      directories: { '': root, same: child },
      bytes: { same: 'x', 'duplicate.png': 'x' },
    });
    await expect(readSourceSnapshot(backend, { pageSize: 100, maxPages: 20 }))
      .rejects.toThrow('Source storage path is duplicate or ambiguous.');
  });

  it('rejects unknown source tables and columns against the repository-derived schema', () => {
    expect(() => validateSourceSchema({ ...KNOWN_SOURCE_SCHEMA, surprise: ['id'] }))
      .toThrow('Source schema contains an unknown table.');
    expect(() => validateSourceSchema({
      ...KNOWN_SOURCE_SCHEMA,
      trips: [...KNOWN_SOURCE_SCHEMA.trips, 'surprise'],
    })).toThrow('Source schema contains an unknown column.');
  });

  it('produces a deterministic full fingerprint that changes with row or object bytes', async () => {
    const make = (body: string) => strictBackend({
      tables: { trips: [row('trip-a')] },
      directories: { '': [{ name: 'object.png', id: 'object', metadata: { size: body.length } }] },
      bytes: { 'object.png': body },
    }).backend;
    const first = fingerprintSourceSnapshot(
      await readSourceSnapshot(make('same'), { pageSize: 2, maxPages: 20 }),
      KNOWN_SOURCE_SCHEMA,
    );
    const repeated = fingerprintSourceSnapshot(
      await readSourceSnapshot(make('same'), { pageSize: 2, maxPages: 20 }),
      KNOWN_SOURCE_SCHEMA,
    );
    const changed = fingerprintSourceSnapshot(
      await readSourceSnapshot(make('changed'), { pageSize: 2, maxPages: 20 }),
      KNOWN_SOURCE_SCHEMA,
    );

    expect(repeated).toEqual(first);
    expect(changed.storageInventorySha256).not.toBe(first.storageInventorySha256);
    expect(sourceFingerprintDigest(first)).toBe(
      createHash('sha256').update(JSON.stringify(first)).digest('hex'),
    );
  });
});
