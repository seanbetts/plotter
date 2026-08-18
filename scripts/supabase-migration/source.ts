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
  ddlSha256: string;
  tableInventories: Record<string, { rowCount: number; idsSha256: string; rowsSha256: string }>;
  copyInventories: Record<string, {
    columnsSha256: string;
    rowCount: number;
    idsSha256: string;
    rowsSha256: string;
  }>;
  storageInventorySha256: string;
};

export type SourceCopyInventory = {
  columns: string[];
  rows: Record<string, unknown>[];
  columnsSha256: string;
  rowCount: number;
  idsSha256: string;
  rowsSha256: string;
};

export type SourceDumpEvidence = {
  ddlSha256: string;
  copyInventories: Record<SourceTableName, SourceCopyInventory>;
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

export const SOURCE_TABLE_ORDER: Record<SourceTableName, readonly string[]> = {
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
  const values = SOURCE_TABLE_ORDER[table].map((column) => row[column]);
  if (values.some((value) => typeof value !== 'string' || value.length === 0)) {
    throw new Error('Source row identity is invalid.');
  }
  return values.join('\0');
}

const JSON_COLUMNS: Partial<Record<SourceTableName, Set<string>>> = {
  trips: new Set(['metadata', 'vehicle_restrictions']),
  destinations: new Set([
    'location', 'timing', 'why', 'media', 'research', 'activities', 'route_context',
    'routing_anchors',
  ]),
  route_legs: new Set(['geometry', 'waypoints', 'sections', 'warnings', 'provider_diagnostic']),
  activities: new Set(['location', 'links']),
};

const TEXT_ARRAY_COLUMNS: Partial<Record<SourceTableName, Set<string>>> = {
  destinations: new Set(['tags']),
  activities: new Set(['tags']),
};

const NUMBER_COLUMNS: Partial<Record<SourceTableName, Set<string>>> = {
  destinations: new Set(['lat', 'lng', 'stop_order']),
  route_legs: new Set(['distance_km', 'travel_time_hours']),
  activities: new Set(['activity_order']),
  media_assets: new Set(['size_bytes', 'sort_order']),
};

const INTEGER_COLUMNS: Partial<Record<SourceTableName, Set<string>>> = {
  destinations: new Set(['stop_order']),
  activities: new Set(['activity_order']),
  media_assets: new Set(['size_bytes', 'sort_order']),
};

function canonicalTimestamp(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)$/.exec(value);
  if (!match) throw new Error('Source timestamp is invalid.');
  const fraction = (match[3] ?? '').padEnd(6, '0');
  let zone = match[4]!;
  if (/^[+-]\d{2}$/.test(zone)) zone = `${zone}:00`;
  if (/^[+-]\d{4}$/.test(zone)) zone = `${zone.slice(0, 3)}:${zone.slice(3)}`;
  const epoch = Date.parse(`${match[1]}T${match[2]}.${fraction.slice(0, 3)}${zone}`);
  if (!Number.isFinite(epoch)) throw new Error('Source timestamp is invalid.');
  return `${new Date(epoch).toISOString().slice(0, 19)}.${fraction}Z`;
}

function decodeCopyText(value: string): string {
  let decoded = '';
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (character !== '\\') {
      decoded += character;
      continue;
    }
    const escaped = value[index + 1];
    if (escaped === undefined) throw new Error('Source COPY escape is invalid.');
    const replacements: Record<string, string> = {
      b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '\\': '\\',
    };
    const replacement = replacements[escaped];
    if (replacement === undefined) throw new Error('Source COPY escape is unsupported.');
    decoded += replacement;
    index += 1;
  }
  return decoded;
}

function parseTextArray(value: string): string[] {
  if (!value.startsWith('{') || !value.endsWith('}')) {
    throw new Error('Source COPY text array is invalid.');
  }
  if (value === '{}') return [];
  const values: string[] = [];
  let index = 1;
  while (index < value.length - 1) {
    let item = '';
    if (value[index] === '"') {
      index += 1;
      let closed = false;
      while (index < value.length - 1) {
        const character = value[index]!;
        index += 1;
        if (character === '"') {
          closed = true;
          break;
        }
        if (character === '\\') {
          if (index >= value.length - 1) throw new Error('Source COPY text array is invalid.');
          item += value[index]!;
          index += 1;
        } else {
          item += character;
        }
      }
      if (!closed) throw new Error('Source COPY text array is invalid.');
    } else {
      while (index < value.length - 1 && value[index] !== ',') {
        const character = value[index]!;
        index += 1;
        if (character === '\\') {
          if (index >= value.length - 1) throw new Error('Source COPY text array is invalid.');
          item += value[index]!;
          index += 1;
        } else {
          item += character;
        }
      }
      if (item === 'NULL') throw new Error('Source COPY text array is unsupported.');
    }
    values.push(item);
    if (index === value.length - 1) break;
    if (value[index] !== ',') throw new Error('Source COPY text array is invalid.');
    index += 1;
  }
  if (index !== value.length - 1) throw new Error('Source COPY text array is invalid.');
  return values;
}

function canonicalColumnValue(
  table: SourceTableName,
  column: string,
  value: unknown,
): unknown {
  if (value === null) return null;
  if (JSON_COLUMNS[table]?.has(column)) {
    if (typeof value === 'string') return canonicalValue(JSON.parse(value) as unknown);
    return canonicalValue(value);
  }
  if (TEXT_ARRAY_COLUMNS[table]?.has(column)) {
    if (typeof value === 'string') return parseTextArray(value);
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
      throw new Error('Source text array is invalid.');
    }
    return [...value];
  }
  if (NUMBER_COLUMNS[table]?.has(column)) {
    const number = typeof value === 'number'
      ? value
      : typeof value === 'string' && /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)
        ? Number(value)
        : Number.NaN;
    if (!Number.isFinite(number)) throw new Error('Source number is invalid.');
    if (INTEGER_COLUMNS[table]?.has(column) && !Number.isSafeInteger(number)) {
      throw new Error('Source integer is invalid.');
    }
    return number;
  }
  if (column.endsWith('_at')) {
    if (typeof value !== 'string') throw new Error('Source timestamp is invalid.');
    return canonicalTimestamp(value);
  }
  if (typeof value !== 'string') throw new Error('Source text value is invalid.');
  return value;
}

function canonicalCopyRow(
  table: SourceTableName,
  columns: string[],
  cells: string[],
): Record<string, unknown> {
  if (cells.length !== columns.length) throw new Error('Source COPY row is invalid.');
  return Object.fromEntries(columns.map((column, index) => {
    const raw = cells[index]!;
    return [
      column,
      raw === '\\N' ? null : canonicalColumnValue(table, column, decodeCopyText(raw)),
    ];
  }));
}

function canonicalStructuredRow(
  table: SourceTableName,
  columns: readonly string[],
  row: Record<string, unknown>,
): Record<string, unknown> {
  const actualColumns = Object.keys(row).sort();
  const expectedColumns = [...columns].sort();
  if (
    actualColumns.length !== expectedColumns.length
    || actualColumns.some((column, index) => column !== expectedColumns[index])
  ) throw new Error('Source SDK row columns are incomplete.');
  return Object.fromEntries(columns.map((column) => [
    column,
    canonicalColumnValue(table, column, row[column]),
  ]));
}

function parseCopyIdentifier(value: string): string {
  const trimmed = value.trim();
  const quoted = /^"((?:[^"]|"")+)"$/.exec(trimmed);
  if (quoted) return quoted[1]!.replaceAll('""', '"');
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) return trimmed;
  throw new Error('Source COPY identifier is invalid.');
}

export function canonicalizeDumpSql(sql: string): string {
  const lines = sql.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n')
    .filter((line) => !(
      /^-- Dumped (?:from database|by pg_dump) version /.test(line)
      || /^-- (?:Started|Completed) on /.test(line)
      || /^\\(?:un)?restrict\s+\S+\s*$/.test(line)
    ))
    .map((line) => line.replace(/[ \t]+$/g, ''));
  while (lines[0] === '') lines.shift();
  while (lines.at(-1) === '') lines.pop();
  return `${lines.join('\n')}\n`;
}

export function parseSourceDumpEvidence(
  rawSchemaSql: string,
  rawDataSql: string,
  schema: SourceSchema,
): SourceDumpEvidence {
  validateSourceSchema(schema);
  const normalized = rawDataSql.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  const lines = normalized.split('\n');
  const copyInventories = {} as Record<SourceTableName, SourceCopyInventory>;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!line.startsWith('COPY ')) continue;
    const match = /^COPY (?:(?:"public")|public)\.(?:"((?:[^"]|"")+)"|([a-zA-Z_][a-zA-Z0-9_]*)) \((.*)\) FROM stdin;$/.exec(line);
    if (!match) throw new Error('Source COPY statement is unsupported.');
    const tableValue = (match[1] ?? match[2]!).replaceAll('""', '"');
    if (!SOURCE_TABLES.includes(tableValue as SourceTableName)) {
      throw new Error('Source COPY contains an unknown table.');
    }
    const table = tableValue as SourceTableName;
    if (copyInventories[table]) throw new Error('Source COPY table is duplicate.');
    const columns = match[3]!.split(',').map(parseCopyIdentifier);
    if (canonicalJson(columns) !== canonicalJson(schema[table])) {
      throw new Error('Source COPY columns do not match the schema.');
    }
    const rows: Record<string, unknown>[] = [];
    let terminated = false;
    for (index += 1; index < lines.length; index += 1) {
      const rowLine = lines[index]!;
      if (rowLine === '\\.') {
        terminated = true;
        break;
      }
      rows.push(canonicalCopyRow(table, columns, rowLine.split('\t')));
    }
    if (!terminated) throw new Error('Source COPY table is unterminated.');
    rows.sort((left, right) => stableRowKey(table, left).localeCompare(stableRowKey(table, right)));
    const ids = rows.map((row) => stableRowKey(table, row));
    if (new Set(ids).size !== ids.length) throw new Error('Source COPY identity is duplicate.');
    copyInventories[table] = {
      columns,
      rows,
      columnsSha256: sha256(canonicalJson(columns)),
      rowCount: rows.length,
      idsSha256: sha256(canonicalJson(ids)),
      rowsSha256: sha256(canonicalJson(rows)),
    };
  }
  for (const table of SOURCE_TABLES) {
    if (!copyInventories[table]) throw new Error('Source COPY is missing a known table.');
  }
  return {
    ddlSha256: sha256(canonicalizeDumpSql(rawSchemaSql)),
    copyInventories,
  };
}

export function assertCopyMatchesSource(
  evidence: SourceDumpEvidence,
  source: SourceSnapshot,
): void {
  try {
    for (const table of SOURCE_TABLES) {
      const copy = evidence.copyInventories[table];
      const structured = source.tables[table]
        .map((row) => canonicalStructuredRow(table, copy.columns, row))
        .sort((left, right) => stableRowKey(table, left).localeCompare(stableRowKey(table, right)));
      const ids = structured.map((row) => stableRowKey(table, row));
      if (
        new Set(ids).size !== ids.length
        || structured.length !== copy.rowCount
        || sha256(canonicalJson(ids)) !== copy.idsSha256
        || sha256(canonicalJson(structured)) !== copy.rowsSha256
      ) throw new Error('mismatch');
    }
  } catch {
    throw new Error('Supabase COPY rows do not exactly match the SDK inventory.');
  }
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
      order: SOURCE_TABLE_ORDER[table],
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
  dumpEvidence?: SourceDumpEvidence,
): SourceFingerprint {
  validateSourceSchema(schema);
  if (dumpEvidence) assertCopyMatchesSource(dumpEvidence, source);
  const tableInventories: SourceFingerprint['tableInventories'] = {};
  for (const table of SOURCE_TABLES) {
    const rows = (dumpEvidence
      ? source.tables[table].map((row) => canonicalStructuredRow(table, schema[table], row))
      : [...source.tables[table]]).sort((left, right) =>
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
  const copyInventories = Object.fromEntries(SOURCE_TABLES.map((table) => {
    const evidence = dumpEvidence?.copyInventories[table];
    if (evidence) {
      return [table, {
        columnsSha256: evidence.columnsSha256,
        rowCount: evidence.rowCount,
        idsSha256: evidence.idsSha256,
        rowsSha256: evidence.rowsSha256,
      }];
    }
    const rows = [...source.tables[table]].sort((left, right) =>
      stableRowKey(table, left).localeCompare(stableRowKey(table, right)));
    const ids = rows.map((row) => stableRowKey(table, row));
    return [table, {
      columnsSha256: sha256(canonicalJson(schema[table])),
      rowCount: rows.length,
      idsSha256: sha256(canonicalJson(ids)),
      rowsSha256: sha256(canonicalJson(rows)),
    }];
  }));
  const schemaSha256 = sha256(canonicalJson(schema));
  return {
    schemaSha256,
    ddlSha256: dumpEvidence?.ddlSha256 ?? schemaSha256,
    tableInventories,
    copyInventories,
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
