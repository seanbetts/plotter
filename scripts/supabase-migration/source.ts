import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export const SOURCE_TABLES = [
  'trips',
  'trip_members',
  'destinations',
  'route_legs',
  'activities',
  'media_assets',
] as const;

export type SourceTableName = (typeof SOURCE_TABLES)[number];
export type SourceSchema = Record<SourceTableName, readonly string[]>;

export const KNOWN_SOURCE_SCHEMA: SourceSchema = {
  trips: [
    'id', 'owner_user_id', 'name', 'description', 'metadata', 'created_at', 'updated_at',
    'vehicle_preset', 'vehicle_profile', 'vehicle_type', 'vehicle_restrictions',
  ],
  trip_members: ['trip_id', 'user_id', 'role', 'created_at', 'updated_at'],
  destinations: [
    'id', 'trip_id', 'name', 'country_region', 'lat', 'lng', 'location', 'stop_order',
    'status', 'priority', 'timing', 'why', 'media', 'research', 'activities', 'route_context',
    'tags', 'created_at', 'updated_at', 'routing_anchors',
  ],
  route_legs: [
    'id', 'trip_id', 'origin_destination_id', 'target_destination_id', 'status', 'distance_km',
    'travel_time_hours', 'geometry', 'provider', 'profile', 'route_key', 'calculated_at', 'error',
    'notes', 'created_at', 'updated_at', 'movement', 'calculation_mode', 'ferry_policy',
    'waypoints', 'sections', 'warnings', 'provider_diagnostic',
  ],
  activities: [
    'id', 'trip_id', 'destination_id', 'activity_order', 'title', 'description', 'category',
    'status', 'priority', 'location', 'links', 'notes', 'tags', 'created_at', 'updated_at',
  ],
  media_assets: [
    'id', 'trip_id', 'destination_id', 'bucket_id', 'object_path', 'caption', 'credit',
    'content_type', 'size_bytes', 'uploaded_by', 'created_at', 'updated_at', 'sort_order',
    'activity_id',
  ],
};

export type SourceFingerprint = {
  schemaSha256: string;
  tableInventories: Record<string, { rowCount: number; idsSha256: string; rowsSha256: string }>;
  storageInventorySha256: string;
};

export type SourceStorageEntry = {
  name: string;
  id: string | null;
  metadata: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
  last_accessed_at?: string | null;
};

export type SourceStorageObject = {
  path: string;
  listing: SourceStorageEntry;
  bytes: Uint8Array;
};

export type SourceSnapshot = {
  tables: Record<SourceTableName, Record<string, unknown>[]>;
  storage: SourceStorageObject[];
};

export type SourceBackend = {
  select(request: {
    table: SourceTableName;
    columns: readonly string[];
    order: readonly string[];
    offset: number;
    limit: number;
  }): Promise<{ rows: Record<string, unknown>[]; count: number | null }>;
  list(request: {
    bucket: 'trip-media';
    prefix: string;
    offset: number;
    limit: number;
  }): Promise<SourceStorageEntry[]>;
  download(request: { bucket: 'trip-media'; path: string }): Promise<Uint8Array>;
};

type ReadOptions = {
  pageSize?: number;
  maxPages?: number;
  maxRows?: number;
};

const TABLE_ORDER: Record<SourceTableName, readonly string[]> = {
  trips: ['id'],
  trip_members: ['trip_id', 'user_id'],
  destinations: ['id'],
  route_legs: ['id'],
  activities: ['id'],
  media_assets: ['id'],
};
const STORAGE_LIST_PAGE_SIZE = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]),
  );
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableRowKey(table: SourceTableName, row: Record<string, unknown>): string {
  const values = TABLE_ORDER[table].map((column) => row[column]);
  if (values.some((value) => typeof value !== 'string' || value.length === 0)) {
    throw new Error('Source row identity is invalid.');
  }
  return values.join('\0');
}

export function validateSourceSchema(schema: Record<string, readonly string[]>): asserts schema is SourceSchema {
  const actualTables = Object.keys(schema).sort();
  const expectedTables = [...SOURCE_TABLES].sort();
  const unknownTable = actualTables.find((table) => !expectedTables.includes(table as SourceTableName));
  if (unknownTable) throw new Error('Source schema contains an unknown table.');
  const missingTable = expectedTables.find((table) => !actualTables.includes(table));
  if (missingTable) throw new Error('Source schema is missing a known table.');
  for (const table of SOURCE_TABLES) {
    const actual = [...(schema[table] ?? [])].sort();
    const expected = [...KNOWN_SOURCE_SCHEMA[table]].sort();
    if (actual.some((column) => !expected.includes(column))) {
      throw new Error('Source schema contains an unknown column.');
    }
    if (expected.some((column) => !actual.includes(column))) {
      throw new Error('Source schema is missing a known column.');
    }
    if (new Set(actual).size !== actual.length) throw new Error('Source schema contains a duplicate column.');
  }
}

function assertStorageSegment(name: string): void {
  if (
    name.length === 0
    || name === '.'
    || name === '..'
    || name.includes('/')
    || name.includes('\\')
    || name.includes('\0')
  ) throw new Error('Source storage path is invalid.');
}

export function validateStorageObjectBytes(
  listing: SourceStorageEntry,
  bytes: Uint8Array,
): void {
  if (listing.metadata === null || !Object.hasOwn(listing.metadata, 'size')) return;
  const size = listing.metadata.size;
  if (!Number.isSafeInteger(size) || (size as number) < 0) {
    throw new Error('Source storage listing size is invalid.');
  }
  if (bytes.byteLength !== size) {
    throw new Error('Source storage download size does not match listing metadata.');
  }
}

export function assertSourceStoragePath(path: string): void {
  if (
    path.length === 0
    || path.startsWith('/')
    || path.includes('\\')
    || path.includes('\0')
    || path.split('/').some((segment) => segment.length === 0 || segment === '.' || segment === '..')
  ) throw new Error('Source storage path is invalid.');
}

async function readTable(
  backend: SourceBackend,
  table: SourceTableName,
  pageSize: number,
  maxPages: number,
  maxRows: number,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  let expectedCount: number | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    const response = await backend.select({
      table,
      columns: KNOWN_SOURCE_SCHEMA[table],
      order: TABLE_ORDER[table],
      offset: page * pageSize,
      limit: pageSize,
    });
    if (!Number.isSafeInteger(response.count) || (response.count ?? -1) < 0) {
      throw new Error('Source table count is unavailable.');
    }
    if (expectedCount === undefined) expectedCount = response.count!;
    if (response.count !== expectedCount) throw new Error('Source table changed during pagination.');
    if (!Array.isArray(response.rows) || response.rows.length > pageSize) {
      throw new Error('Source table response is invalid.');
    }
    rows.push(...response.rows);
    if (rows.length > maxRows) throw new Error('Source row limit was reached.');
    if (response.rows.length < pageSize) break;
    if (page + 1 === maxPages) throw new Error('Source pagination limit was reached.');
  }
  if (rows.length !== expectedCount) throw new Error('Source table inventory is truncated.');
  const sorted = [...rows].sort((left, right) => stableRowKey(table, left).localeCompare(stableRowKey(table, right)));
  const keys = sorted.map((row) => stableRowKey(table, row));
  if (new Set(keys).size !== keys.length) throw new Error('Source row identity is duplicate.');
  return sorted;
}

async function listPrefix(
  backend: SourceBackend,
  prefix: string,
  pageSize: number,
  maxPages: number,
): Promise<SourceStorageEntry[]> {
  const entries: SourceStorageEntry[] = [];
  for (let page = 0; page < maxPages; page += 1) {
    const response = await backend.list({
      bucket: 'trip-media',
      prefix,
      offset: page * pageSize,
      limit: pageSize,
    });
    if (!Array.isArray(response) || response.length > pageSize) {
      throw new Error('Source storage response is invalid.');
    }
    entries.push(...response);
    if (response.length < pageSize) break;
    if (page + 1 === maxPages) throw new Error('Source pagination limit was reached.');
  }
  return entries;
}

async function readStorage(
  backend: SourceBackend,
  pageSize: number,
  maxPages: number,
  maxRows: number,
): Promise<SourceStorageObject[]> {
  const prefixes = [''];
  const seenPaths = new Set<string>();
  const files: Array<{ path: string; listing: SourceStorageEntry }> = [];
  for (let index = 0; index < prefixes.length; index += 1) {
    const prefix = prefixes[index]!;
    const entries = await listPrefix(backend, prefix, pageSize, maxPages);
    for (const entry of entries) {
      if (!isRecord(entry) || typeof entry.name !== 'string') {
        throw new Error('Source storage response is invalid.');
      }
      if (entry.metadata !== null && !isRecord(entry.metadata)) {
        throw new Error('Source storage response is invalid.');
      }
      assertStorageSegment(entry.name);
      const path = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
      assertSourceStoragePath(path);
      if (seenPaths.has(path)) throw new Error('Source storage path is duplicate or ambiguous.');
      seenPaths.add(path);
      if (seenPaths.size > maxRows) throw new Error('Source row limit was reached.');
      if (entry.id === null) {
        prefixes.push(path);
      } else if (typeof entry.id === 'string' && entry.id.length > 0) {
        files.push({ path, listing: entry });
      } else {
        throw new Error('Source storage response is invalid.');
      }
    }
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  const objects: SourceStorageObject[] = [];
  for (const file of files) {
    const bytes = await backend.download({ bucket: 'trip-media', path: file.path });
    if (!(bytes instanceof Uint8Array)) throw new Error('Source storage download is invalid.');
    validateStorageObjectBytes(file.listing, bytes);
    objects.push({ path: file.path, listing: file.listing, bytes });
  }
  return objects;
}

export async function readSourceSnapshot(
  backend: SourceBackend,
  options: ReadOptions = {},
): Promise<SourceSnapshot> {
  const pageSize = options.pageSize ?? 500;
  const maxPages = options.maxPages ?? 10_000;
  const maxRows = options.maxRows ?? 1_000_000;
  if (!Number.isSafeInteger(pageSize) || pageSize <= 0 || !Number.isSafeInteger(maxPages) || maxPages <= 0) {
    throw new Error('Source pagination configuration is invalid.');
  }
  const tables = {} as SourceSnapshot['tables'];
  for (const table of SOURCE_TABLES) {
    tables[table] = await readTable(backend, table, pageSize, maxPages, maxRows);
  }
  return {
    tables,
    storage: await readStorage(
      backend,
      Math.min(pageSize, STORAGE_LIST_PAGE_SIZE),
      maxPages,
      maxRows,
    ),
  };
}

export function fingerprintSourceSnapshot(
  source: SourceSnapshot,
  schema: Record<string, readonly string[]>,
): SourceFingerprint {
  validateSourceSchema(schema);
  const tableInventories: SourceFingerprint['tableInventories'] = {};
  for (const table of SOURCE_TABLES) {
    const rows = [...source.tables[table]].sort((left, right) =>
      stableRowKey(table, left).localeCompare(stableRowKey(table, right)));
    tableInventories[table] = {
      rowCount: rows.length,
      idsSha256: sha256(canonicalJson(rows.map((row) => stableRowKey(table, row)))),
      rowsSha256: sha256(canonicalJson(rows)),
    };
  }
  const storageInventory = [...source.storage]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((object) => ({
      path: object.path,
      listing: object.listing,
      byteCount: object.bytes.byteLength,
      sha256: sha256(object.bytes),
    }));
  return {
    schemaSha256: sha256(canonicalJson(schema)),
    tableInventories,
    storageInventorySha256: sha256(canonicalJson(storageInventory)),
  };
}

export function sourceFingerprintDigest(source: SourceFingerprint): string {
  return sha256(JSON.stringify(source));
}

type QueryResult = { data: unknown[] | null; error: { message?: string } | null; count: number | null };
type StorageListResult = { data: unknown[] | null; error: { message?: string } | null };
type StorageDownloadResult = { data: Blob | ArrayBuffer | Uint8Array | null; error: { message?: string } | null };

/** Adapts the real SDK to the deliberately tiny read-only source boundary. */
export function createSupabaseSourceBackend(client: SupabaseClient): SourceBackend {
  return {
    async select(request) {
      let query = client.from(request.table).select(request.columns.join(','), { count: 'exact' });
      for (const column of request.order) query = query.order(column, { ascending: true });
      const response = await query.range(request.offset, request.offset + request.limit - 1) as QueryResult;
      if (response.error) throw new Error('Supabase source table read failed.');
      if (!Array.isArray(response.data)) throw new Error('Supabase source table read failed.');
      return { rows: response.data as Record<string, unknown>[], count: response.count };
    },
    async list(request) {
      const response = await client.storage.from(request.bucket).list(request.prefix, {
        limit: request.limit,
        offset: request.offset,
        sortBy: { column: 'name', order: 'asc' },
      }) as StorageListResult;
      if (response.error || !Array.isArray(response.data)) throw new Error('Supabase source storage list failed.');
      return response.data as SourceStorageEntry[];
    },
    async download(request) {
      const response = await client.storage.from(request.bucket).download(request.path) as StorageDownloadResult;
      if (response.error || response.data === null) throw new Error('Supabase source storage download failed.');
      if (response.data instanceof Uint8Array) return response.data;
      if (response.data instanceof ArrayBuffer) return new Uint8Array(response.data);
      return new Uint8Array(await response.data.arrayBuffer());
    },
  };
}
