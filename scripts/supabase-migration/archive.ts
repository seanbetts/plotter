import { createHash, randomUUID } from 'node:crypto';
import {
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
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

const PAYLOAD_DIRECTORY = 'source-archive';
const ARCHIVE_VERIFY_ERROR = 'Raw Supabase archive verification failed.';
const ARCHIVE_PUBLISH_ERROR = 'Raw Supabase archive could not be published.';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type RawArchive = {
  root: string;
  payloadRoot: string;
  inventoryPath: string;
  sourceFingerprintDigest: string;
  verify(): Promise<void>;
};

export type RawArchiveSyncPhase = 'archive-ready' | 'archive-published' | 'archive-rolled-back';

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
  syncDirectory?(path: string, phase: RawArchiveSyncPhase): Promise<void> | void;
};

type FileInventoryItem = { archivePath: string; byteCount: number; sha256: string };

type StorageInventoryItem = {
  archivePath: string;
  sourcePath: string;
  listing: SourceSnapshot['storage'][number]['listing'];
  byteCount: number;
  sha256: string;
};

type ArchiveInventory = {
  formatVersion: 1;
  files: FileInventoryItem[];
  tables: SourceFingerprint['tableInventories'];
  storage: StorageInventoryItem[];
  totals: { rowCount: number; objectCount: number; byteCount: number };
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
    || (metadata.mode & 0o777) !== 0o700
  ) throw new Error('Migration staging directory is invalid.');
}

async function defaultSyncDirectory(path: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    if (!(await handle.stat()).isDirectory()) throw new Error(ARCHIVE_PUBLISH_ERROR);
    await handle.sync();
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function writePrivateFile(path: string, bytes: string | Uint8Array): Promise<void> {
  const handle = await open(
    path,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || (metadata.mode & 0o777) !== 0o600) {
      throw new Error('Migration archive file is invalid.');
    }
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function readPrivateFile(path: string, payloadRoot: string): Promise<Buffer> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    if (!isContained(path, payloadRoot) || realpathSync(dirname(path)) !== dirname(path)) {
      throw new Error(ARCHIVE_VERIFY_ERROR);
    }
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await handle.stat();
    if (!before.isFile() || (before.mode & 0o777) !== 0o600) {
      throw new Error(ARCHIVE_VERIFY_ERROR);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size) {
      throw new Error(ARCHIVE_VERIFY_ERROR);
    }
    return bytes;
  } finally {
    await handle?.close().catch(() => undefined);
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

function walkArchive(payloadRoot: string): { files: string[]; directories: string[] } {
  const files: string[] = [];
  const directories: string[] = ['.'];
  function visit(directory: string): void {
    assertPrivateDirectory(directory, payloadRoot);
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const metadata = lstatSync(path);
      if (entry.isSymbolicLink() || metadata.isSymbolicLink()) throw new Error(ARCHIVE_VERIFY_ERROR);
      const archivePath = relative(payloadRoot, path);
      if (entry.isDirectory() && metadata.isDirectory()) {
        directories.push(archivePath);
        visit(path);
      } else if (entry.isFile() && metadata.isFile()) {
        if ((metadata.mode & 0o777) !== 0o600) throw new Error(ARCHIVE_VERIFY_ERROR);
        files.push(archivePath);
      } else {
        throw new Error(ARCHIVE_VERIFY_ERROR);
      }
    }
  }
  visit(payloadRoot);
  return {
    files: files.sort((left, right) => left.localeCompare(right)),
    directories: directories.sort((left, right) => left.localeCompare(right)),
  };
}

function expectedDirectories(files: readonly string[]): string[] {
  const directories = new Set<string>(['.', 'objects', 'raw', 'tables']);
  for (const file of files) {
    let current = dirname(file);
    while (current !== '.') {
      directories.add(current);
      current = dirname(current);
    }
  }
  return [...directories].sort((left, right) => left.localeCompare(right));
}

async function verifyRawArchive(
  payloadRoot: string,
  expected: {
    inventory: ArchiveInventory;
    sourceMetadata: Record<string, unknown>;
    source: SourceSnapshot;
    rawSchemaSql: string;
    rawDataSql: string;
  },
): Promise<void> {
  try {
    assertPrivateDirectory(payloadRoot, payloadRoot);
    const inventoryBytes = await readPrivateFile(join(payloadRoot, 'inventory.json'), payloadRoot);
    const inventory = JSON.parse(inventoryBytes.toString('utf8')) as unknown;
    if (canonicalJson(inventory) !== canonicalJson(expected.inventory)) {
      throw new Error(ARCHIVE_VERIFY_ERROR);
    }
    const expectedFiles = [
      'inventory.json',
      ...expected.inventory.files.map((item) => item.archivePath),
    ].sort((left, right) => left.localeCompare(right));
    if (new Set(expectedFiles).size !== expectedFiles.length) throw new Error(ARCHIVE_VERIFY_ERROR);
    const walked = walkArchive(payloadRoot);
    if (canonicalJson(walked.files) !== canonicalJson(expectedFiles)) {
      throw new Error(ARCHIVE_VERIFY_ERROR);
    }
    if (canonicalJson(walked.directories) !== canonicalJson(expectedDirectories(expectedFiles))) {
      throw new Error(ARCHIVE_VERIFY_ERROR);
    }
    for (const item of expected.inventory.files) {
      const bytes = await readPrivateFile(join(payloadRoot, item.archivePath), payloadRoot);
      if (bytes.byteLength !== item.byteCount || sha256(bytes) !== item.sha256) {
        throw new Error(ARCHIVE_VERIFY_ERROR);
      }
    }
    if ((await readPrivateFile(join(payloadRoot, 'raw', 'schema.sql'), payloadRoot)).toString('utf8')
      !== expected.rawSchemaSql) throw new Error(ARCHIVE_VERIFY_ERROR);
    if ((await readPrivateFile(join(payloadRoot, 'raw', 'data.sql'), payloadRoot)).toString('utf8')
      !== expected.rawDataSql) throw new Error(ARCHIVE_VERIFY_ERROR);
    for (const table of SOURCE_TABLES) {
      const value = JSON.parse((await readPrivateFile(
        join(payloadRoot, 'tables', `${table}.json`),
        payloadRoot,
      )).toString('utf8')) as unknown;
      if (canonicalJson(value) !== canonicalJson(expected.source.tables[table])) {
        throw new Error(ARCHIVE_VERIFY_ERROR);
      }
    }
    const sourceMetadata = JSON.parse((await readPrivateFile(
      join(payloadRoot, 'source.json'),
      payloadRoot,
    )).toString('utf8')) as unknown;
    if (canonicalJson(sourceMetadata) !== canonicalJson(expected.sourceMetadata)) {
      throw new Error(ARCHIVE_VERIFY_ERROR);
    }
    for (const object of expected.source.storage) {
      const bytes = await readPrivateFile(join(payloadRoot, 'objects', object.path), payloadRoot);
      if (bytes.byteLength !== object.bytes.byteLength || sha256(bytes) !== sha256(object.bytes)) {
        throw new Error(ARCHIVE_VERIFY_ERROR);
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message === ARCHIVE_VERIFY_ERROR) throw error;
    throw new Error(ARCHIVE_VERIFY_ERROR, { cause: error });
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
  if (!UUID_PATTERN.test(identifier)) throw new Error('Migration staging identity is invalid.');
  const finalRoot = join(stagingParent, `supabase-${timestampName(now)}-${identifier}`);
  const preparingRoot = join(stagingParent, `.supabase-preparing-${identifier}`);
  if (existsSync(finalRoot) || existsSync(preparingRoot)) {
    throw new Error('Migration staging identity is invalid.');
  }
  mkdirSync(preparingRoot, { mode: 0o700 });
  assertPrivateDirectory(preparingRoot, stagingParent);
  const payloadRoot = join(preparingRoot, PAYLOAD_DIRECTORY);
  const rawRoot = join(payloadRoot, 'raw');
  const tablesRoot = join(payloadRoot, 'tables');
  const objectsRoot = join(payloadRoot, 'objects');
  for (const path of [payloadRoot, rawRoot, tablesRoot, objectsRoot]) {
    mkdirSync(path, { mode: 0o700 });
    assertPrivateDirectory(path, preparingRoot);
  }
  const syncDirectory = options.syncDirectory
    ?? (async (path: string) => defaultSyncDirectory(path));

  const fileInventory: FileInventoryItem[] = [];
  async function writePayload(archivePath: string, bytes: string | Uint8Array): Promise<void> {
    const encoded = typeof bytes === 'string' ? Buffer.from(bytes) : bytes;
    await writePrivateFile(join(payloadRoot, archivePath), encoded);
    fileInventory.push({
      archivePath,
      byteCount: encoded.byteLength,
      sha256: sha256(encoded),
    });
  }

  try {
    await writePayload('raw/schema.sql', options.rawSchemaSql);
    await writePayload('raw/data.sql', options.rawDataSql);
    for (const table of SOURCE_TABLES) {
      await writePayload(`tables/${table}.json`, `${canonicalJson(options.source.tables[table])}\n`);
    }

    const storageInventory: StorageInventoryItem[] = [];
    for (const object of [...options.source.storage]
      .sort((left, right) => left.path.localeCompare(right.path))) {
      const archivePath = `objects/${object.path}`;
      const destination = join(payloadRoot, archivePath);
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

    const digest = sourceFingerprintDigest(options.fingerprint);
    const sourceMetadata = {
      formatVersion: 1,
      createdAt: now.toISOString(),
      schema: options.schema,
      sourceFingerprint: options.fingerprint,
      sourceFingerprintDigest: digest,
    };
    await writePayload('source.json', `${canonicalJson(sourceMetadata)}\n`);
    const inventory: ArchiveInventory = {
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
    await writePrivateFile(join(payloadRoot, 'inventory.json'), `${canonicalJson(inventory)}\n`);
    const verification = {
      inventory,
      sourceMetadata,
      source: options.source,
      rawSchemaSql: options.rawSchemaSql,
      rawDataSql: options.rawDataSql,
    };
    const directories = walkArchive(payloadRoot).directories
      .map((path) => path === '.' ? payloadRoot : join(payloadRoot, path))
      .sort((left, right) => right.length - left.length);
    for (const directory of directories) await syncDirectory(directory, 'archive-ready');
    await syncDirectory(preparingRoot, 'archive-ready');
    await verifyRawArchive(payloadRoot, verification);
    await rename(preparingRoot, finalRoot);
    try {
      await syncDirectory(stagingParent, 'archive-published');
    } catch (error) {
      try {
        await rename(finalRoot, preparingRoot);
        await syncDirectory(stagingParent, 'archive-rolled-back');
        await rm(preparingRoot, { recursive: true, force: true });
        await syncDirectory(stagingParent, 'archive-rolled-back');
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          ARCHIVE_PUBLISH_ERROR,
          { cause: rollbackError },
        );
      }
      throw new Error(ARCHIVE_PUBLISH_ERROR, { cause: error });
    }
    const publishedPayloadRoot = join(finalRoot, PAYLOAD_DIRECTORY);
    const verify = () => verifyRawArchive(publishedPayloadRoot, verification);
    await verify();
    options.log?.(
      `Supabase source archived rows=${inventory.totals.rowCount} objects=${inventory.totals.objectCount} bytes=${inventory.totals.byteCount} fingerprint=${digest}`,
    );
    return {
      root: finalRoot,
      payloadRoot: publishedPayloadRoot,
      inventoryPath: join(publishedPayloadRoot, 'inventory.json'),
      sourceFingerprintDigest: digest,
      verify,
    };
  } catch (error) {
    if (existsSync(preparingRoot)) {
      await rm(preparingRoot, { recursive: true, force: true }).catch(() => undefined);
      await Promise.resolve(syncDirectory(stagingParent, 'archive-rolled-back')).catch(() => undefined);
    }
    throw error;
  }
}
