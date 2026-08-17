import { createHash, randomUUID } from 'node:crypto';
import { constants, lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { mkdir, open } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import {
  SOURCE_TABLES,
  assertSourceStoragePath,
  canonicalJson,
  sourceFingerprintDigest,
  validateSourceSchema,
  type SourceFingerprint,
  type SourceSchema,
  type SourceSnapshot,
} from './source';

export type RawArchive = {
  root: string;
  inventoryPath: string;
  sourceFingerprintDigest: string;
};

type CreateRawArchiveOptions = {
  stagingParent: string;
  source: SourceSnapshot;
  schema: SourceSchema;
  fingerprint: SourceFingerprint;
  rawSchemaSql: string;
  rawDataSql: string;
  now?: () => Date;
  randomId?: () => string;
  log?: (message: string) => void;
};

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function isContained(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}${sep}`);
}

function assertPrivateDirectory(path: string, root: string): void {
  const metadata = lstatSync(path);
  if (
    metadata.isSymbolicLink()
    || !metadata.isDirectory()
    || realpathSync(path) !== path
    || !isContained(path, root)
    || (metadata.mode & 0o077) !== 0
  ) throw new Error('Migration staging directory is invalid.');
}

async function writePrivateFile(path: string, bytes: string | Uint8Array): Promise<void> {
  const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function timestampName(date: Date): string {
  return date.toISOString().replaceAll(/[-:.]/g, '');
}

async function ensureObjectParent(path: string, objectsRoot: string): Promise<void> {
  const parent = dirname(path);
  if (parent === objectsRoot) return;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  let current = parent;
  while (current !== objectsRoot) {
    assertPrivateDirectory(current, objectsRoot);
    current = dirname(current);
  }
}

export async function createRawArchive(options: CreateRawArchiveOptions): Promise<RawArchive> {
  validateSourceSchema(options.schema);
  const stagingParent = realpathSync(options.stagingParent);
  const parentMetadata = lstatSync(stagingParent);
  if (parentMetadata.isSymbolicLink() || !parentMetadata.isDirectory()) {
    throw new Error('Migration staging parent is invalid.');
  }
  for (const object of options.source.storage) assertSourceStoragePath(object.path);

  const now = options.now?.() ?? new Date();
  const identifier = options.randomId?.() ?? randomUUID();
  if (!/^[0-9a-f-]{36}$/.test(identifier)) throw new Error('Migration staging identity is invalid.');
  const root = join(stagingParent, `supabase-${timestampName(now)}-${identifier}`);
  mkdirSync(root, { mode: 0o700 });
  assertPrivateDirectory(root, stagingParent);
  const rawRoot = join(root, 'raw');
  const tablesRoot = join(root, 'tables');
  const objectsRoot = join(root, 'objects');
  for (const path of [rawRoot, tablesRoot, objectsRoot]) {
    mkdirSync(path, { mode: 0o700 });
    assertPrivateDirectory(path, root);
  }

  const fileInventory: Array<{ archivePath: string; byteCount: number; sha256: string }> = [];
  async function writePayload(archivePath: string, bytes: string | Uint8Array): Promise<void> {
    const encoded = typeof bytes === 'string' ? Buffer.from(bytes) : bytes;
    await writePrivateFile(join(root, archivePath), encoded);
    fileInventory.push({
      archivePath,
      byteCount: encoded.byteLength,
      sha256: sha256(encoded),
    });
  }

  await writePayload('raw/schema.sql', options.rawSchemaSql);
  await writePayload('raw/data.sql', options.rawDataSql);
  for (const table of SOURCE_TABLES) {
    await writePayload(
      `tables/${table}.json`,
      `${canonicalJson(options.source.tables[table])}\n`,
    );
  }

  const storageInventory: Array<{
    archivePath: string;
    sourcePath: string;
    listing: SourceSnapshot['storage'][number]['listing'];
    byteCount: number;
    sha256: string;
  }> = [];
  for (const object of [...options.source.storage].sort((left, right) => left.path.localeCompare(right.path))) {
    const archivePath = `objects/${object.path}`;
    const destination = join(root, archivePath);
    if (!isContained(destination, objectsRoot)) throw new Error('Source storage path is invalid.');
    await ensureObjectParent(destination, objectsRoot);
    await writePayload(archivePath, object.bytes);
    storageInventory.push({
      archivePath,
      sourcePath: object.path,
      listing: object.listing,
      byteCount: object.bytes.byteLength,
      sha256: sha256(object.bytes),
    });
  }

  const inventory = {
    formatVersion: 1,
    files: fileInventory.sort((left, right) => left.archivePath.localeCompare(right.archivePath)),
    tables: options.fingerprint.tableInventories,
    storage: storageInventory,
    totals: {
      rowCount: SOURCE_TABLES.reduce(
        (total, table) => total + options.source.tables[table].length,
        0,
      ),
      objectCount: storageInventory.length,
      byteCount: storageInventory.reduce((total, object) => total + object.byteCount, 0),
    },
  };
  const digest = sourceFingerprintDigest(options.fingerprint);
  const sourceMetadata = {
    formatVersion: 1,
    createdAt: now.toISOString(),
    schema: options.schema,
    sourceFingerprint: options.fingerprint,
    sourceFingerprintDigest: digest,
  };
  const inventoryPath = join(root, 'inventory.json');
  await writePrivateFile(inventoryPath, `${canonicalJson(inventory)}\n`);
  await writePrivateFile(join(root, 'source.json'), `${canonicalJson(sourceMetadata)}\n`);
  options.log?.(
    `Supabase source archived rows=${inventory.totals.rowCount} objects=${inventory.totals.objectCount} bytes=${inventory.totals.byteCount} fingerprint=${digest}`,
  );
  return { root, inventoryPath, sourceFingerprintDigest: digest };
}
