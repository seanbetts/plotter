import { createHash, randomUUID } from 'node:crypto';
import {
  constants,
  closeSync,
  copyFileSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from 'node:fs';
import {
  mkdir,
  link,
  mkdtemp,
  open,
  readFile,
  realpath,
  rename,
  rm,
  unlink,
} from 'node:fs/promises';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  normalize,
  resolve,
  sep,
} from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  BackupManifest,
  BackupSummary,
  RestoreBackupRequest,
} from '../src/api/contracts';
import { isCanonicalId } from '../src/api/identifiers';
import { openPlotterDatabase, type PlotterDatabase } from './database';

const ARCHIVE_BLOCK_BYTES = 512;
const ARCHIVE_END_BYTES = ARCHIVE_BLOCK_BYTES * 2;
const ARCHIVE_IO_BYTES = 64 * 1024;
const MAX_ARCHIVE_BYTES = 21_474_836_480;
const MAX_ARCHIVE_ENTRIES = 10_002;
const MAX_DATABASE_BYTES = 4_294_967_296;
const MAX_MANIFEST_BYTES = 8_388_608;
const MAX_MEDIA_BYTES = 52_428_800;
const MANIFEST_PATH = 'manifest.json';
const DATABASE_ARCHIVE_PATH = 'database/plotter.sqlite3';
const DATABASE_FILENAME = 'plotter.sqlite3';
const INVALID_BACKUP_MESSAGE = 'Portable backup is invalid.';
const INVALID_CONFIRMATION_MESSAGE = 'Portable restore confirmation is invalid.';
const BACKUP_NOT_FOUND_MESSAGE = 'Portable backup not found.';
const BACKUP_CREATE_MESSAGE = 'Portable backup could not be created.';
const RESTORE_RECOVERED_MESSAGE = 'Portable restore failed; canonical state was recovered.';
const RESTORE_INCOMPLETE_MESSAGE = 'Portable restore failed and canonical recovery is incomplete.';
const BACKUP_ID_PATTERN = /^(?:portable|recovery-before-restore)-\d{8}T\d{9}Z-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RESTORE_PREPARING_DIRECTORY_PATTERN = /^\.portable-restore-preparing-([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;
const RESTORE_DIRECTORY_PATTERN = /^\.portable-restore-([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;
const RESTORE_CLEANUP_DIRECTORY_PATTERN = /^\.portable-restore-cleanup-([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;
const RESTORE_COMMITTED_FILENAME = 'restore-committed';
const RESTORE_PLAN_FILENAME = 'restore-plan';
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export type PortableBackupManifest = {
  formatVersion: 1;
  schemaVersion: number;
  createdAt: string;
  directoryRevision: number;
  tripRevisions: Record<string, number>;
  files: Array<{ path: string; byteCount: number; sha256: string }>;
};

export type PortableBackupOperations = {
  create(): Promise<BackupSummary>;
  list(): Promise<BackupSummary[]>;
  inspect(backupId: string): Promise<BackupManifest>;
  restore(backupId: string, request: RestoreBackupRequest): Promise<BackupSummary>;
};

export type StorageOperationGate = {
  run<T>(operation: () => Promise<T>): Promise<T>;
};

export type PortableBackupPhase =
  | 'archive-ready'
  | 'archive-published'
  | 'archive-temp-cleaned'
  | 'recovery-archive-durable'
  | 'storage-quiesced'
  | 'originals-durable'
  | 'promotion-durable'
  | 'commit-marker-durable'
  | 'commit-marker-invalidated'
  | 'rollback-durable'
  | 'cleanup-published'
  | 'restore-transaction-validated'
  | 'transaction-cleaned';

export type PortableBackupSyncPhase =
  | 'archive-published'
  | 'archive-temp-cleaned'
  | 'restore-transaction-created'
  | 'restore-rollback-created'
  | 'restore-originals-moved'
  | 'restore-promoted'
  | 'restore-marker-published'
  | 'restore-marker-invalidated'
  | 'restore-rolled-back'
  | 'restore-cleanup-published'
  | 'restore-transaction-cleaned';

export type PortableBackupDurability = {
  onPhase?(phase: PortableBackupPhase): Promise<void> | void;
  syncDirectory?(path: string, phase: PortableBackupSyncPhase): Promise<void> | void;
};

export type PortableBackupOptions = {
  dataDirectory: string;
  backupsDirectory?: string;
  currentDatabase(): PlotterDatabase;
  closeStorage(): Promise<void> | void;
  openStorage(): Promise<void> | void;
  publishRestoreReset(input: { epoch: string; tripIds: string[] }): void;
  now?: () => Date;
  randomId?: () => string;
  durability?: PortableBackupDurability;
};

type SourceFile = {
  archivePath: string;
  sourcePath: string;
  byteCount: number;
  sha256: string;
};

type ExtractedArchive = {
  stageDirectory: string;
  payloadDirectory: string;
  manifest: PortableBackupManifest;
};

type DurabilityController = {
  phase(phase: PortableBackupPhase): Promise<void>;
  syncDirectories(paths: string[], phase: PortableBackupSyncPhase): Promise<void>;
};

export class PortableBackupInvalidError extends Error {
  constructor() {
    super(INVALID_BACKUP_MESSAGE);
    this.name = 'PortableBackupInvalidError';
  }
}

export class PortableRestoreConfirmationError extends Error {
  constructor() {
    super(INVALID_CONFIRMATION_MESSAGE);
    this.name = 'PortableRestoreConfirmationError';
  }
}

export class PortableBackupNotFoundError extends Error {
  constructor() {
    super(BACKUP_NOT_FOUND_MESSAGE);
    this.name = 'PortableBackupNotFoundError';
  }
}

export class PortableBackupCreateError extends Error {
  constructor() {
    super(BACKUP_CREATE_MESSAGE);
    this.name = 'PortableBackupCreateError';
  }
}

export class PortableRestoreRecoveredError extends Error {
  constructor() {
    super(RESTORE_RECOVERED_MESSAGE);
    this.name = 'PortableRestoreRecoveredError';
  }
}

export class PortableRestoreIncompleteError extends Error {
  constructor() {
    super(RESTORE_INCOMPLETE_MESSAGE);
    this.name = 'PortableRestoreIncompleteError';
  }
}

function isContained(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}${sep}`);
}

function ensureContainedDirectory(path: string, root: string): string {
  if (!existsSync(path)) mkdirSync(path);
  const canonical = realpathSync(path);
  if (!isContained(canonical, root) || !statSync(canonical).isDirectory()) {
    throw new PortableBackupInvalidError();
  }
  return canonical;
}

function assertCanonicalDirectory(path: string, root: string): void {
  try {
    const metadata = lstatSync(path);
    if (
      metadata.isSymbolicLink()
      || !metadata.isDirectory()
      || realpathSync(path) !== path
      || !isContained(path, root)
    ) throw new PortableBackupInvalidError();
  } catch (error) {
    if (error instanceof PortableBackupInvalidError) throw error;
    throw new PortableBackupInvalidError();
  }
}

type RestoreTransactionKind = 'preparing' | 'active' | 'cleanup';

function restoreTransactionPattern(kind: RestoreTransactionKind): RegExp {
  if (kind === 'preparing') return RESTORE_PREPARING_DIRECTORY_PATTERN;
  return kind === 'active' ? RESTORE_DIRECTORY_PATTERN : RESTORE_CLEANUP_DIRECTORY_PATTERN;
}

function assertPrivateRestoreTransaction(
  dataRoot: string,
  path: string,
  kind: RestoreTransactionKind,
): string {
  try {
    const match = restoreTransactionPattern(kind).exec(basename(path));
    const metadata = lstatSync(path);
    if (
      !match
      || dirname(path) !== dataRoot
      || metadata.isSymbolicLink()
      || !metadata.isDirectory()
      || (metadata.mode & 0o777) !== 0o700
      || realpathSync(path) !== path
      || !isContained(path, dataRoot)
    ) throw new PortableBackupInvalidError();
    return match[1]!;
  } catch (error) {
    if (error instanceof PortableBackupInvalidError) throw error;
    throw new PortableBackupInvalidError();
  }
}

function assertPrivateInternalDirectory(path: string, transactionRoot: string): void {
  try {
    const metadata = lstatSync(path);
    if (
      metadata.isSymbolicLink()
      || !metadata.isDirectory()
      || (metadata.mode & 0o077) !== 0
      || realpathSync(path) !== path
      || !isContained(path, transactionRoot)
    ) throw new PortableBackupInvalidError();
  } catch (error) {
    if (error instanceof PortableBackupInvalidError) throw error;
    throw new PortableBackupInvalidError();
  }
}

function pathMetadata(path: string): ReturnType<typeof lstatSync> | undefined {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function validateRestoreTransaction(
  dataRoot: string,
  transaction: string,
  kind: RestoreTransactionKind,
  durability: DurabilityController,
  announce = false,
): Promise<string> {
  const transactionId = assertPrivateRestoreTransaction(dataRoot, transaction, kind);
  if (announce) {
    await durability.phase('restore-transaction-validated');
    assertPrivateRestoreTransaction(dataRoot, transaction, kind);
  }
  return transactionId;
}

function createDurabilityController(
  durability: PortableBackupDurability | undefined,
): DurabilityController {
  return {
    async phase(phase) {
      await durability?.onPhase?.(phase);
    },
    async syncDirectories(paths, phase) {
      for (const path of [...new Set(paths)]) {
        if (durability?.syncDirectory) {
          await durability.syncDirectory(path, phase);
          continue;
        }
        let handle: Awaited<ReturnType<typeof open>> | undefined;
        try {
          handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
          if (!(await handle.stat()).isDirectory()) throw new PortableBackupInvalidError();
          await handle.sync();
        } finally {
          await handle?.close().catch(() => undefined);
        }
      }
    },
  };
}

function validNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function validPositiveInteger(value: unknown): value is number {
  return validNonNegativeInteger(value) && value > 0;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return keys.length === sortedExpected.length
    && keys.every((key, index) => key === sortedExpected[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertArchivePath(path: string): void {
  if (
    path.length === 0
    || Buffer.byteLength(path, 'utf8') > 255
    || isAbsolute(path)
    || path.includes('\\')
    || path.includes('\0')
    || normalize(path) !== path
    || path.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new PortableBackupInvalidError();
  }
}

function assertBackupId(backupId: string): void {
  if (!BACKUP_ID_PATTERN.test(backupId)) throw new PortableBackupNotFoundError();
}

function filenameTimestamp(date: Date): string {
  const iso = date.toISOString();
  return iso.replaceAll(/[-:.]/g, '');
}

function backupSummary(backupId: string, manifest: PortableBackupManifest): BackupSummary {
  return {
    id: backupId,
    createdAt: manifest.createdAt,
    schemaVersion: manifest.schemaVersion,
    directoryRevision: manifest.directoryRevision,
    tripRevisions: manifest.tripRevisions,
  };
}

function parseManifest(value: unknown): PortableBackupManifest {
  if (!isRecord(value) || !exactKeys(value, [
    'formatVersion', 'schemaVersion', 'createdAt', 'directoryRevision', 'tripRevisions', 'files',
  ])) throw new PortableBackupInvalidError();
  if (
    value.formatVersion !== 1
    || !validNonNegativeInteger(value.schemaVersion)
    || typeof value.createdAt !== 'string'
    || Number.isNaN(Date.parse(value.createdAt))
    || new Date(value.createdAt).toISOString() !== value.createdAt
    || !validNonNegativeInteger(value.directoryRevision)
    || !isRecord(value.tripRevisions)
    || !Array.isArray(value.files)
    || value.files.length === 0
    || value.files.length > MAX_ARCHIVE_ENTRIES - 1
  ) throw new PortableBackupInvalidError();

  const tripRevisions: Record<string, number> = {};
  for (const tripId of Object.keys(value.tripRevisions).sort()) {
    const revision = value.tripRevisions[tripId];
    if (!isCanonicalId(tripId) || !validNonNegativeInteger(revision)) {
      throw new PortableBackupInvalidError();
    }
    tripRevisions[tripId] = revision;
  }

  const files = value.files.map((item) => {
    if (!isRecord(item) || !exactKeys(item, ['path', 'byteCount', 'sha256'])) {
      throw new PortableBackupInvalidError();
    }
    if (
      typeof item.path !== 'string'
      || !validNonNegativeInteger(item.byteCount)
      || typeof item.sha256 !== 'string'
      || !SHA256_PATTERN.test(item.sha256)
    ) throw new PortableBackupInvalidError();
    assertArchivePath(item.path);
    if (item.path !== DATABASE_ARCHIVE_PATH) {
      const mediaPath = /^media\/(.+)\.(?:jpg|png|webp|gif)$/.exec(item.path);
      if (!mediaPath || !isCanonicalId(mediaPath[1]) || !validPositiveInteger(item.byteCount)) {
        throw new PortableBackupInvalidError();
      }
    }
    return { path: item.path, byteCount: item.byteCount, sha256: item.sha256 };
  });
  for (let index = 0; index < files.length; index += 1) {
    const current = files[index]!;
    if (current.path === MANIFEST_PATH || (index > 0 && files[index - 1]!.path >= current.path)) {
      throw new PortableBackupInvalidError();
    }
  }
  if (files.filter((file) => file.path === DATABASE_ARCHIVE_PATH).length !== 1) {
    throw new PortableBackupInvalidError();
  }

  return {
    formatVersion: 1,
    schemaVersion: value.schemaVersion,
    createdAt: value.createdAt,
    directoryRevision: value.directoryRevision,
    tripRevisions,
    files,
  };
}

async function digestFile(path: string, maximum: number): Promise<{ byteCount: number; sha256: string }> {
  const hash = createHash('sha256');
  let byteCount = 0;
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const size = fstatSync(descriptor).size;
    if (size > maximum) throw new PortableBackupInvalidError();
    while (byteCount < size) {
      const chunk = Buffer.alloc(Math.min(ARCHIVE_IO_BYTES, size - byteCount));
      const bytesRead = readSync(descriptor, chunk, 0, chunk.byteLength, byteCount);
      if (bytesRead <= 0) throw new PortableBackupInvalidError();
      byteCount += bytesRead;
      hash.update(bytesRead === chunk.byteLength ? chunk : chunk.subarray(0, bytesRead));
    }
  } finally {
    closeSync(descriptor);
  }
  return { byteCount, sha256: hash.digest('hex') };
}

function readDatabaseState(databasePath: string): {
  schemaVersion: number;
  directoryRevision: number;
  tripRevisions: Record<string, number>;
  media: Array<{ id: string; relativePath: string; byteCount: number; sha256: string; contentType: string }>;
} {
  let validated: PlotterDatabase | undefined;
  let connection: DatabaseSync | undefined;
  const validationPath = `${databasePath}.validation-${randomUUID()}`;
  try {
    copyFileSync(databasePath, validationPath, constants.COPYFILE_EXCL);
    validated = openPlotterDatabase(validationPath);
    const schemaVersion = validated.schemaVersion;
    validated.close();
    validated = undefined;
    rmSync(validationPath, { force: true });
    rmSync(`${validationPath}-wal`, { force: true });
    rmSync(`${validationPath}-shm`, { force: true });
    connection = new DatabaseSync(databasePath, { readOnly: true });
    const metadata = connection.prepare(`
      SELECT directory_revision
      FROM store_metadata
      WHERE singleton = 1
    `).get() as { directory_revision?: unknown } | undefined;
    if (!validNonNegativeInteger(metadata?.directory_revision)) throw new PortableBackupInvalidError();
    const tripRows = connection.prepare(`
      SELECT trip_id, revision
      FROM trip_revisions
      ORDER BY trip_id
    `).all() as Array<{ trip_id?: unknown; revision?: unknown }>;
    const tripRevisions: Record<string, number> = {};
    for (const row of tripRows) {
      if (typeof row.trip_id !== 'string' || !validNonNegativeInteger(row.revision)) {
        throw new PortableBackupInvalidError();
      }
      tripRevisions[row.trip_id] = row.revision;
    }
    const mediaRows = connection.prepare(`
      SELECT id, relative_path, size_bytes, sha256, content_type
      FROM media_assets
      ORDER BY relative_path
    `).all() as Array<Record<string, unknown>>;
    const media = mediaRows.map((row) => {
      if (
        typeof row.id !== 'string'
        || typeof row.relative_path !== 'string'
        || !validPositiveInteger(row.size_bytes)
        || typeof row.sha256 !== 'string'
        || !SHA256_PATTERN.test(row.sha256)
        || typeof row.content_type !== 'string'
      ) throw new PortableBackupInvalidError();
      return {
        id: row.id,
        relativePath: row.relative_path,
        byteCount: row.size_bytes,
        sha256: row.sha256,
        contentType: row.content_type,
      };
    });
    connection.close();
    return {
      schemaVersion,
      directoryRevision: metadata.directory_revision,
      tripRevisions,
      media,
    };
  } catch (error) {
    try { connection?.close(); } catch { /* Preserve the stable validation error. */ }
    try { validated?.close(); } catch { /* Preserve the stable validation error. */ }
    rmSync(validationPath, { force: true });
    rmSync(`${validationPath}-wal`, { force: true });
    rmSync(`${validationPath}-shm`, { force: true });
    if (error instanceof PortableBackupInvalidError) throw error;
    throw new PortableBackupInvalidError();
  }
}

function expectedMediaExtension(contentType: string): string | undefined {
  return ({
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
  } as Record<string, string>)[contentType];
}

function activeMediaArchivePath(media: {
  id: string;
  relativePath: string;
  contentType: string;
  byteCount: number;
}): string {
  const extension = expectedMediaExtension(media.contentType);
  if (!isCanonicalId(media.id) || extension === undefined || !validPositiveInteger(media.byteCount)) {
    throw new PortableBackupInvalidError();
  }
  const expectedRelativePath = `media/${media.id}.${extension}`;
  if (media.relativePath !== expectedRelativePath) throw new PortableBackupInvalidError();
  return expectedRelativePath;
}

async function sourceFilesForSnapshot(
  dataRoot: string,
  mediaRoot: string,
  snapshotPath: string,
  state: ReturnType<typeof readDatabaseState>,
): Promise<SourceFile[]> {
  const databaseDigest = await digestFile(snapshotPath, MAX_DATABASE_BYTES);
  const sources: SourceFile[] = [{
    archivePath: DATABASE_ARCHIVE_PATH,
    sourcePath: snapshotPath,
    ...databaseDigest,
  }];
  const seen = new Set<string>();
  for (const media of state.media) {
    const archivePath = activeMediaArchivePath(media);
    assertArchivePath(archivePath);
    if (seen.has(archivePath)) throw new PortableBackupInvalidError();
    seen.add(archivePath);
    const lexical = resolve(dataRoot, archivePath);
    if (!isContained(lexical, mediaRoot)) throw new PortableBackupInvalidError();
    const metadata = lstatSync(lexical);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new PortableBackupInvalidError();
    const canonical = await realpath(lexical);
    if (!isContained(canonical, mediaRoot) || dirname(canonical) !== mediaRoot) {
      throw new PortableBackupInvalidError();
    }
    const digest = await digestFile(canonical, MAX_MEDIA_BYTES);
    if (digest.byteCount !== media.byteCount || digest.sha256 !== media.sha256) {
      throw new PortableBackupInvalidError();
    }
    sources.push({ archivePath, sourcePath: canonical, ...digest });
  }
  return sources.sort((left, right) => left.archivePath.localeCompare(right.archivePath));
}

function tarPathParts(path: string): { name: string; prefix: string } {
  if (Buffer.byteLength(path) <= 100) return { name: path, prefix: '' };
  for (let index = path.lastIndexOf('/'); index > 0; index = path.lastIndexOf('/', index - 1)) {
    const prefix = path.slice(0, index);
    const name = path.slice(index + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) return { name, prefix };
  }
  throw new PortableBackupInvalidError();
}

function writeTarNumber(buffer: Buffer, offset: number, width: number, value: number): void {
  const encoded = `${value.toString(8).padStart(width - 1, '0')}\0`;
  if (encoded.length > width) throw new PortableBackupInvalidError();
  buffer.write(encoded, offset, width, 'ascii');
}

function tarHeader(path: string, byteCount: number, type: '0' | 'x' = '0'): Buffer {
  const { name, prefix } = tarPathParts(path);
  const header = Buffer.alloc(ARCHIVE_BLOCK_BYTES);
  header.write(name, 0, 100, 'utf8');
  writeTarNumber(header, 100, 8, 0o600);
  writeTarNumber(header, 108, 8, 0);
  writeTarNumber(header, 116, 8, 0);
  writeTarNumber(header, 124, 12, byteCount);
  writeTarNumber(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header.write(type, 156, 1, 'ascii');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  header.write(prefix, 345, 155, 'utf8');
  const checksum = [...header].reduce((total, byte) => total + byte, 0);
  writeTarNumber(header, 148, 8, checksum);
  return header;
}

async function writeAll(handle: Awaited<ReturnType<typeof open>>, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const result = await handle.write(bytes, offset, bytes.byteLength - offset);
    if (result.bytesWritten <= 0) throw new PortableBackupCreateError();
    offset += result.bytesWritten;
  }
}

async function writeTarEntry(
  handle: Awaited<ReturnType<typeof open>>,
  path: string,
  bytes: Uint8Array,
  type: '0' | 'x' = '0',
): Promise<void> {
  await writeAll(handle, tarHeader(path, bytes.byteLength, type));
  await writeAll(handle, bytes);
  const padding = (ARCHIVE_BLOCK_BYTES - (bytes.byteLength % ARCHIVE_BLOCK_BYTES)) % ARCHIVE_BLOCK_BYTES;
  if (padding > 0) await writeAll(handle, Buffer.alloc(padding));
}

function paxIdentifier(path: string): string {
  return createHash('sha256').update(path).digest('hex').slice(0, 16);
}

function paxPathRecord(path: string): Buffer {
  const payload = ` path=${path}\n`;
  let length = Buffer.byteLength(payload) + 1;
  while (true) {
    const record = `${length}${payload}`;
    const nextLength = Buffer.byteLength(record);
    if (nextLength === length) return Buffer.from(record);
    length = nextLength;
  }
}

async function writeTarPathHeader(
  handle: Awaited<ReturnType<typeof open>>,
  path: string,
  byteCount: number,
): Promise<void> {
  try {
    await writeAll(handle, tarHeader(path, byteCount));
    return;
  } catch (error) {
    if (!(error instanceof PortableBackupInvalidError)) throw error;
  }
  const identifier = paxIdentifier(path);
  await writeTarEntry(handle, `PaxHeaders/${identifier}`, paxPathRecord(path), 'x');
  await writeAll(handle, tarHeader(`PaxFiles/${identifier}`, byteCount));
}

async function writeTarFile(
  handle: Awaited<ReturnType<typeof open>>,
  source: SourceFile,
): Promise<void> {
  await writeTarPathHeader(handle, source.archivePath, source.byteCount);
  const hash = createHash('sha256');
  let byteCount = 0;
  const descriptor = openSync(source.sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const size = fstatSync(descriptor).size;
    if (size !== source.byteCount) throw new PortableBackupCreateError();
    while (byteCount < size) {
      const chunk = Buffer.alloc(Math.min(ARCHIVE_IO_BYTES, size - byteCount));
      const bytesRead = readSync(descriptor, chunk, 0, chunk.byteLength, byteCount);
      if (bytesRead <= 0) throw new PortableBackupCreateError();
      const bytes = bytesRead === chunk.byteLength ? chunk : chunk.subarray(0, bytesRead);
      byteCount += bytesRead;
      hash.update(bytes);
      await writeAll(handle, bytes);
    }
  } finally {
    closeSync(descriptor);
  }
  if (byteCount !== source.byteCount || hash.digest('hex') !== source.sha256) {
    throw new PortableBackupCreateError();
  }
  const padding = (ARCHIVE_BLOCK_BYTES - (byteCount % ARCHIVE_BLOCK_BYTES)) % ARCHIVE_BLOCK_BYTES;
  if (padding > 0) await writeAll(handle, Buffer.alloc(padding));
}

async function createArchive(
  temporaryPath: string,
  manifest: PortableBackupManifest,
  sources: SourceFile[],
): Promise<void> {
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  if (manifestBytes.byteLength > MAX_MANIFEST_BYTES) throw new PortableBackupCreateError();
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(
      temporaryPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    );
    await writeTarEntry(handle, MANIFEST_PATH, manifestBytes);
    for (const source of sources) await writeTarFile(handle, source);
    await writeAll(handle, Buffer.alloc(ARCHIVE_END_BYTES));
    await handle.sync();
    await handle.close();
    handle = undefined;
  } catch (error) {
    try { await handle?.close(); } catch { /* Preserve the stable backup failure. */ }
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    if (error instanceof PortableBackupCreateError) throw error;
    throw new PortableBackupCreateError();
  }
}

async function publishArchive(
  temporaryPath: string,
  archivePath: string,
  backupsRoot: string,
  durability: DurabilityController,
): Promise<void> {
  try {
    await link(temporaryPath, archivePath);
    await durability.syncDirectories([backupsRoot], 'archive-published');
    await durability.phase('archive-published');
  } catch (error) {
    // Once link() succeeds the final name is published. Its directory sync may
    // be ambiguous, and the pathname may already belong to a later publisher,
    // so only the unique temporary pathname is ever eligible for cleanup.
    await unlink(temporaryPath).catch(() => undefined);
    await durability.syncDirectories([backupsRoot], 'archive-temp-cleaned').catch(() => undefined);
    throw error instanceof PortableBackupCreateError ? error : new PortableBackupCreateError();
  }
  await unlink(temporaryPath).catch(() => undefined);
  try {
    await durability.syncDirectories([backupsRoot], 'archive-temp-cleaned');
    await durability.phase('archive-temp-cleaned');
  } catch {
    // The published archive name is already durable. A hidden temporary link
    // can be retried as cleanup without making a successful backup ambiguous.
  }
}

function parseTarNumber(field: Buffer): number {
  if ((field[0] ?? 0) >= 0x80) throw new PortableBackupInvalidError();
  const value = field.toString('ascii').replaceAll('\0', '').trim();
  if (!/^[0-7]+$/.test(value)) throw new PortableBackupInvalidError();
  const parsed = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new PortableBackupInvalidError();
  return parsed;
}

function tarEntryPath(header: Buffer): string {
  const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
  const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
  const path = prefix ? `${prefix}/${name}` : name;
  assertArchivePath(path);
  return path;
}

async function readExactly(
  handle: Awaited<ReturnType<typeof open>>,
  bytes: Buffer,
  position: number,
): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const result = await handle.read(bytes, offset, bytes.byteLength - offset, position + offset);
    if (result.bytesRead === 0) throw new PortableBackupInvalidError();
    offset += result.bytesRead;
  }
}

function maximumEntryBytes(path: string): number {
  if (path === MANIFEST_PATH) return MAX_MANIFEST_BYTES;
  if (path === DATABASE_ARCHIVE_PATH) return MAX_DATABASE_BYTES;
  if (path.startsWith('media/')) return MAX_MEDIA_BYTES;
  return MAX_MANIFEST_BYTES;
}

function parsePaxPathRecord(bytes: Buffer): string {
  const record = bytes.toString('utf8');
  const separator = record.indexOf(' ');
  if (separator <= 0 || !/^\d+$/.test(record.slice(0, separator))) {
    throw new PortableBackupInvalidError();
  }
  const declaredLength = Number.parseInt(record.slice(0, separator), 10);
  const body = record.slice(separator + 1);
  if (
    declaredLength !== bytes.byteLength
    || !body.startsWith('path=')
    || !body.endsWith('\n')
    || body.slice(0, -1).includes('\n')
  ) throw new PortableBackupInvalidError();
  const path = body.slice('path='.length, -1);
  assertArchivePath(path);
  return path;
}

async function extractArchive(archivePath: string, stageDirectory: string): Promise<Map<string, { byteCount: number; sha256: string }>> {
  const archiveMetadata = lstatSync(archivePath);
  if (!archiveMetadata.isFile() || archiveMetadata.isSymbolicLink() || archiveMetadata.size > MAX_ARCHIVE_BYTES) {
    throw new PortableBackupInvalidError();
  }
  const handle = await open(archivePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  const seen = new Map<string, { byteCount: number; sha256: string }>();
  let position = 0;
  let totalBytes = 0;
  let foundEnd = false;
  let pendingPax: { path: string; identifier: string } | undefined;
  try {
    while (position + ARCHIVE_BLOCK_BYTES <= archiveMetadata.size) {
      const header = Buffer.alloc(ARCHIVE_BLOCK_BYTES);
      await readExactly(handle, header, position);
      position += ARCHIVE_BLOCK_BYTES;
      if (header.every((byte) => byte === 0)) {
        const second = Buffer.alloc(ARCHIVE_BLOCK_BYTES);
        await readExactly(handle, second, position);
        position += ARCHIVE_BLOCK_BYTES;
        if (!second.every((byte) => byte === 0)) throw new PortableBackupInvalidError();
        while (position < archiveMetadata.size) {
          const trailing = Buffer.alloc(Math.min(ARCHIVE_IO_BYTES, archiveMetadata.size - position));
          await readExactly(handle, trailing, position);
          if (!trailing.every((byte) => byte === 0)) throw new PortableBackupInvalidError();
          position += trailing.byteLength;
        }
        foundEnd = true;
        break;
      }
      if (seen.size >= MAX_ARCHIVE_ENTRIES) throw new PortableBackupInvalidError();
      const checksum = parseTarNumber(header.subarray(148, 156));
      const checksumHeader = Buffer.from(header);
      checksumHeader.fill(0x20, 148, 156);
      if ([...checksumHeader].reduce((total, byte) => total + byte, 0) !== checksum) {
        throw new PortableBackupInvalidError();
      }
      const type = header.subarray(156, 157).toString('ascii');
      if (
        header.subarray(257, 263).toString('ascii') !== 'ustar\0'
        || header.subarray(263, 265).toString('ascii') !== '00'
        || !['0', '\0', 'x'].includes(type)
      ) throw new PortableBackupInvalidError();
      const headerPath = tarEntryPath(header);
      const byteCount = parseTarNumber(header.subarray(124, 136));
      totalBytes += byteCount;
      if (totalBytes > MAX_ARCHIVE_BYTES) throw new PortableBackupInvalidError();
      const paddedBytes = byteCount + ((ARCHIVE_BLOCK_BYTES - (byteCount % ARCHIVE_BLOCK_BYTES)) % ARCHIVE_BLOCK_BYTES);
      if (position + paddedBytes > archiveMetadata.size) throw new PortableBackupInvalidError();

      if (type === 'x') {
        const headerMatch = /^PaxHeaders\/([0-9a-f]{16})$/.exec(headerPath);
        if (!headerMatch || pendingPax || byteCount === 0 || byteCount > 1_024) {
          throw new PortableBackupInvalidError();
        }
        const bytes = Buffer.alloc(byteCount);
        await readExactly(handle, bytes, position);
        position += byteCount;
        const paddingBytes = paddedBytes - byteCount;
        if (paddingBytes > 0) {
          const padding = Buffer.alloc(paddingBytes);
          await readExactly(handle, padding, position);
          if (!padding.every((byte) => byte === 0)) throw new PortableBackupInvalidError();
          position += paddingBytes;
        }
        const path = parsePaxPathRecord(bytes);
        if (headerMatch[1] !== paxIdentifier(path)) throw new PortableBackupInvalidError();
        pendingPax = { path, identifier: headerMatch[1] };
        continue;
      }

      const archiveEntryPath = pendingPax?.path ?? headerPath;
      if (pendingPax && headerPath !== `PaxFiles/${pendingPax.identifier}`) {
        throw new PortableBackupInvalidError();
      }
      pendingPax = undefined;
      if (seen.has(archiveEntryPath) || byteCount > maximumEntryBytes(archiveEntryPath)) {
        throw new PortableBackupInvalidError();
      }

      const destination = resolve(stageDirectory, archiveEntryPath);
      if (!isContained(destination, stageDirectory)) throw new PortableBackupInvalidError();
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      const canonicalParent = await realpath(dirname(destination));
      if (!isContained(canonicalParent, stageDirectory)) throw new PortableBackupInvalidError();
      const output = await open(
        destination,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        0o600,
      );
      const hash = createHash('sha256');
      let copied = 0;
      try {
        while (copied < byteCount) {
          const chunk = Buffer.alloc(Math.min(ARCHIVE_IO_BYTES, byteCount - copied));
          await readExactly(handle, chunk, position + copied);
          hash.update(chunk);
          await writeAll(output, chunk);
          copied += chunk.byteLength;
        }
        await output.sync();
      } finally {
        await output.close();
      }
      position += byteCount;
      const paddingBytes = paddedBytes - byteCount;
      if (paddingBytes > 0) {
        const padding = Buffer.alloc(paddingBytes);
        await readExactly(handle, padding, position);
        if (!padding.every((byte) => byte === 0)) throw new PortableBackupInvalidError();
        position += paddingBytes;
      }
      seen.set(archiveEntryPath, { byteCount, sha256: hash.digest('hex') });
    }
  } finally {
    await handle.close();
  }
  if (!foundEnd || pendingPax) throw new PortableBackupInvalidError();
  return seen;
}

function equalRecord(left: Record<string, number>, right: Record<string, number>): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  return leftEntries.length === rightEntries.length
    && leftEntries.every(([key, value], index) => rightEntries[index]?.[0] === key && rightEntries[index]?.[1] === value);
}

async function validateExtractedArchive(
  stageDirectory: string,
  entries: Map<string, { byteCount: number; sha256: string }>,
): Promise<PortableBackupManifest> {
  const manifestEntry = entries.get(MANIFEST_PATH);
  if (!manifestEntry || manifestEntry.byteCount > MAX_MANIFEST_BYTES) throw new PortableBackupInvalidError();
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(join(stageDirectory, MANIFEST_PATH), 'utf8'));
  } catch {
    throw new PortableBackupInvalidError();
  }
  const manifest = parseManifest(parsed);
  if (entries.size !== manifest.files.length + 1) throw new PortableBackupInvalidError();
  for (const file of manifest.files) {
    const extracted = entries.get(file.path);
    if (!extracted || extracted.byteCount !== file.byteCount || extracted.sha256 !== file.sha256) {
      throw new PortableBackupInvalidError();
    }
  }
  for (const path of entries.keys()) {
    if (path !== MANIFEST_PATH && !manifest.files.some((file) => file.path === path)) {
      throw new PortableBackupInvalidError();
    }
  }

  const databasePath = join(stageDirectory, DATABASE_ARCHIVE_PATH);
  const state = readDatabaseState(databasePath);
  if (
    state.schemaVersion !== manifest.schemaVersion
    || state.directoryRevision !== manifest.directoryRevision
    || !equalRecord(state.tripRevisions, manifest.tripRevisions)
  ) throw new PortableBackupInvalidError();
  const mediaFiles = manifest.files.filter((file) => file.path.startsWith('media/'));
  if (state.media.length !== mediaFiles.length) throw new PortableBackupInvalidError();
  for (let index = 0; index < state.media.length; index += 1) {
    const media = state.media[index]!;
    const file = mediaFiles[index];
    const archivePath = activeMediaArchivePath(media);
    if (
      file?.path !== archivePath
      || file.byteCount !== media.byteCount
      || file.sha256 !== media.sha256
    ) throw new PortableBackupInvalidError();
  }
  return manifest;
}

async function validateArchiveFile(dataRoot: string, archivePath: string): Promise<void> {
  const stageDirectory = await mkdtemp(join(dataRoot, '.portable-inspect-'));
  try {
    const canonicalStage = await realpath(stageDirectory);
    if (canonicalStage !== stageDirectory || !isContained(canonicalStage, dataRoot)) {
      throw new PortableBackupInvalidError();
    }
    const entries = await extractArchive(archivePath, canonicalStage);
    await validateExtractedArchive(canonicalStage, entries);
  } finally {
    await rm(stageDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function inspectArchive(
  dataRoot: string,
  backupsRoot: string,
  backupId: string,
  restoreStageId?: string,
): Promise<ExtractedArchive> {
  assertBackupId(backupId);
  assertCanonicalDirectory(backupsRoot, dataRoot);
  const archivePath = join(backupsRoot, `${backupId}.tar`);
  if (!existsSync(archivePath)) throw new PortableBackupNotFoundError();
  const canonicalArchive = await realpath(archivePath).catch(() => { throw new PortableBackupNotFoundError(); });
  if (!isContained(canonicalArchive, backupsRoot) || canonicalArchive !== archivePath) {
    throw new PortableBackupInvalidError();
  }
  const stageDirectory = restoreStageId === undefined
    ? await mkdtemp(join(dataRoot, '.portable-inspect-'))
    : join(dataRoot, `.portable-restore-preparing-${restoreStageId}`);
  const payloadDirectory = restoreStageId === undefined
    ? stageDirectory
    : join(stageDirectory, 'payload');
  if (restoreStageId !== undefined) {
    await mkdir(stageDirectory, { mode: 0o700 });
    await mkdir(payloadDirectory, { mode: 0o700 });
  }
  try {
    const canonicalStage = await realpath(stageDirectory);
    if (!isContained(canonicalStage, dataRoot) || canonicalStage !== stageDirectory) {
      throw new PortableBackupInvalidError();
    }
    const canonicalPayload = await realpath(payloadDirectory);
    if (!isContained(canonicalPayload, canonicalStage) || canonicalPayload !== payloadDirectory) {
      throw new PortableBackupInvalidError();
    }
    const entries = await extractArchive(canonicalArchive, canonicalPayload);
    const manifest = await validateExtractedArchive(canonicalPayload, entries);
    return { stageDirectory: canonicalStage, payloadDirectory: canonicalPayload, manifest };
  } catch (error) {
    if (restoreStageId === undefined) {
      await rm(stageDirectory, { recursive: true, force: true }).catch(() => undefined);
    } else {
      try {
        assertPrivateRestoreTransaction(dataRoot, stageDirectory, 'preparing');
        await rm(stageDirectory, { recursive: true, force: true });
      } catch {
        // Never follow a replaced preparation path during validation cleanup.
      }
    }
    if (error instanceof PortableBackupNotFoundError) throw error;
    throw new PortableBackupInvalidError();
  }
}

async function renameIfExists(source: string, destination: string): Promise<boolean> {
  try {
    await rename(source, destination);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

type RestoreCommitMarker = {
  formatVersion: 1;
  transactionId: string;
  backupId: string;
  restoreEpoch: string;
};

type RestorePlan = {
  formatVersion: 1;
  transactionId: string;
  backupId: string;
  originalWal: boolean;
  originalShm: boolean;
};

function restorePlan(
  transactionId: string,
  backupId: string,
  originalWal: boolean,
  originalShm: boolean,
): RestorePlan {
  return { formatVersion: 1, transactionId, backupId, originalWal, originalShm };
}

async function writeSyncedControlFile(path: string, value: object): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(
      path,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    );
    await writeAll(handle, Buffer.from(JSON.stringify(value)));
    await handle.sync();
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function readRestorePlan(
  dataRoot: string,
  stageDirectory: string,
  kind: 'preparing' | 'active',
): Promise<RestorePlan> {
  const transactionId = assertPrivateRestoreTransaction(dataRoot, stageDirectory, kind);
  const planPath = join(stageDirectory, RESTORE_PLAN_FILENAME);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const metadata = lstatSync(planPath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size === 0 || metadata.size > 1_024) {
      throw new PortableBackupInvalidError();
    }
    handle = await open(planPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const openedMetadata = await handle.stat();
    if (
      !openedMetadata.isFile()
      || openedMetadata.size !== metadata.size
      || openedMetadata.dev !== metadata.dev
      || openedMetadata.ino !== metadata.ino
    ) throw new PortableBackupInvalidError();
    const bytes = Buffer.alloc(openedMetadata.size);
    await readExactly(handle, bytes, 0);
    const value: unknown = JSON.parse(bytes.toString('utf8'));
    if (!isRecord(value) || !exactKeys(value, [
      'formatVersion', 'transactionId', 'backupId', 'originalWal', 'originalShm',
    ])) throw new PortableBackupInvalidError();
    if (
      value.formatVersion !== 1
      || value.transactionId !== transactionId
      || typeof value.backupId !== 'string'
      || !BACKUP_ID_PATTERN.test(value.backupId)
      || typeof value.originalWal !== 'boolean'
      || typeof value.originalShm !== 'boolean'
    ) throw new PortableBackupInvalidError();
    assertPrivateRestoreTransaction(dataRoot, stageDirectory, kind);
    return {
      formatVersion: 1,
      transactionId,
      backupId: value.backupId,
      originalWal: value.originalWal,
      originalShm: value.originalShm,
    };
  } catch (error) {
    if (error instanceof PortableBackupInvalidError) throw error;
    throw new PortableBackupInvalidError();
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function restoreCommitMarker(
  transactionId: string,
  backupId: string,
): RestoreCommitMarker {
  return { formatVersion: 1, transactionId, backupId, restoreEpoch: transactionId };
}

async function hasValidRestoreCommitMarker(
  dataRoot: string,
  stageDirectory: string,
  expectedBackupId: string,
): Promise<boolean> {
  assertPrivateRestoreTransaction(dataRoot, stageDirectory, 'active');
  const transactionMatch = RESTORE_DIRECTORY_PATTERN.exec(basename(stageDirectory));
  if (!transactionMatch) return false;
  const markerPath = join(stageDirectory, RESTORE_COMMITTED_FILENAME);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const metadata = lstatSync(markerPath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size === 0 || metadata.size > 1_024) {
      return false;
    }
    handle = await open(markerPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const openedMetadata = await handle.stat();
    if (
      !openedMetadata.isFile()
      || openedMetadata.size !== metadata.size
      || openedMetadata.dev !== metadata.dev
      || openedMetadata.ino !== metadata.ino
    ) return false;
    const bytes = Buffer.alloc(openedMetadata.size);
    await readExactly(handle, bytes, 0);
    const value: unknown = JSON.parse(bytes.toString('utf8'));
    if (!isRecord(value) || !exactKeys(value, [
      'formatVersion', 'transactionId', 'backupId', 'restoreEpoch',
    ])) return false;
    const valid = value.formatVersion === 1
      && value.transactionId === transactionMatch[1]
      && value.restoreEpoch === transactionMatch[1]
      && typeof value.backupId === 'string'
      && BACKUP_ID_PATTERN.test(value.backupId)
      && value.backupId === expectedBackupId
      && typeof value.transactionId === 'string'
      && UUID_PATTERN.test(value.transactionId)
      && typeof value.restoreEpoch === 'string'
      && UUID_PATTERN.test(value.restoreEpoch);
    assertPrivateRestoreTransaction(dataRoot, stageDirectory, 'active');
    return valid;
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

type StoredObjectKind = 'file' | 'directory';

function assertOptionalStoredObject(path: string, kind: StoredObjectKind, root: string): boolean {
  const metadata = pathMetadata(path);
  if (!metadata) return false;
  if (
    metadata.isSymbolicLink()
    || (kind === 'file' ? !metadata.isFile() : !metadata.isDirectory())
    || realpathSync(path) !== path
    || !isContained(path, root)
  ) throw new PortableBackupInvalidError();
  return true;
}

async function moveAsideAndRestore(
  current: string,
  original: string,
  failed: string,
  kind: StoredObjectKind,
  currentRoot: string,
  transactionRoot: string,
  expectedOriginal: boolean,
): Promise<void> {
  const originalExists = assertOptionalStoredObject(original, kind, transactionRoot);
  const failedExists = assertOptionalStoredObject(failed, kind, transactionRoot);
  const currentExists = assertOptionalStoredObject(current, kind, currentRoot);

  if (originalExists) {
    if (failedExists && currentExists) throw new PortableBackupInvalidError();
    if (!failedExists && currentExists) await rename(current, failed);
    await rename(original, current);
    return;
  }
  if (failedExists || expectedOriginal) return;
  if (currentExists) await rename(current, failed);
}

async function invalidateRestoreCommitMarker(
  dataRoot: string,
  stageDirectory: string,
  durability: DurabilityController,
): Promise<void> {
  await validateRestoreTransaction(dataRoot, stageDirectory, 'active', durability);
  const markerPath = join(stageDirectory, RESTORE_COMMITTED_FILENAME);
  try {
    await unlink(markerPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await validateRestoreTransaction(dataRoot, stageDirectory, 'active', durability);
  await durability.syncDirectories([stageDirectory], 'restore-marker-invalidated');
  await validateRestoreTransaction(dataRoot, stageDirectory, 'active', durability);
  await durability.phase('commit-marker-invalidated');
}

async function rollbackRestoreTransaction(
  dataRoot: string,
  stageDirectory: string,
  plan: RestorePlan,
  durability: DurabilityController,
): Promise<void> {
  await validateRestoreTransaction(dataRoot, stageDirectory, 'active', durability);
  const rollbackRoot = join(stageDirectory, 'rollback');
  assertPrivateInternalDirectory(rollbackRoot, stageDirectory);
  const failedRoot = join(stageDirectory, 'failed');
  if (!pathMetadata(failedRoot)) await mkdir(failedRoot, { mode: 0o700 });
  assertPrivateInternalDirectory(failedRoot, stageDirectory);
  const databasePath = join(dataRoot, DATABASE_FILENAME);
  const rollbackStarted = assertOptionalStoredObject(
    join(rollbackRoot, DATABASE_FILENAME),
    'file',
    stageDirectory,
  ) || assertOptionalStoredObject(
    join(failedRoot, DATABASE_FILENAME),
    'file',
    stageDirectory,
  );

  if (rollbackStarted) {
    const operations: Array<{
      current: string;
      original: string;
      failed: string;
      kind: StoredObjectKind;
      expectedOriginal: boolean;
    }> = [
      {
        current: databasePath,
        original: join(rollbackRoot, DATABASE_FILENAME),
        failed: join(failedRoot, DATABASE_FILENAME),
        kind: 'file',
        expectedOriginal: true,
      },
      {
        current: `${databasePath}-wal`,
        original: join(rollbackRoot, `${DATABASE_FILENAME}-wal`),
        failed: join(failedRoot, `${DATABASE_FILENAME}-wal`),
        kind: 'file',
        expectedOriginal: plan.originalWal,
      },
      {
        current: `${databasePath}-shm`,
        original: join(rollbackRoot, `${DATABASE_FILENAME}-shm`),
        failed: join(failedRoot, `${DATABASE_FILENAME}-shm`),
        kind: 'file',
        expectedOriginal: plan.originalShm,
      },
      {
        current: join(dataRoot, 'media'),
        original: join(rollbackRoot, 'media'),
        failed: join(failedRoot, 'media'),
        kind: 'directory',
        expectedOriginal: true,
      },
    ];
    for (const operation of operations) {
      await validateRestoreTransaction(dataRoot, stageDirectory, 'active', durability, true);
      assertPrivateInternalDirectory(rollbackRoot, stageDirectory);
      assertPrivateInternalDirectory(failedRoot, stageDirectory);
      await moveAsideAndRestore(
        operation.current,
        operation.original,
        operation.failed,
        operation.kind,
        dataRoot,
        stageDirectory,
        operation.expectedOriginal,
      );
    }
  }
  await validateRestoreTransaction(dataRoot, stageDirectory, 'active', durability);
  await durability.syncDirectories([dataRoot, rollbackRoot, failedRoot], 'restore-rolled-back');
  await validateRestoreTransaction(dataRoot, stageDirectory, 'active', durability);
  await durability.phase('rollback-durable');
}

function cleanupTransactionPath(dataRoot: string, transactionId: string): string {
  return join(dataRoot, `.portable-restore-cleanup-${transactionId}`);
}

async function publishRestoreCleanup(
  dataRoot: string,
  transaction: string,
  durability: DurabilityController,
): Promise<string> {
  const transactionId = await validateRestoreTransaction(
    dataRoot,
    transaction,
    'active',
    durability,
  );
  const cleanup = cleanupTransactionPath(dataRoot, transactionId);
  if (pathMetadata(cleanup)) throw new PortableBackupInvalidError();
  await rename(transaction, cleanup);
  await durability.syncDirectories([dataRoot], 'restore-cleanup-published');
  await validateRestoreTransaction(dataRoot, cleanup, 'cleanup', durability);
  await durability.phase('cleanup-published');
  return cleanup;
}

async function removeRestoreGarbage(
  dataRoot: string,
  transaction: string,
  kind: 'preparing' | 'cleanup',
  durability: DurabilityController,
): Promise<void> {
  await validateRestoreTransaction(dataRoot, transaction, kind, durability, true);
  // Node exposes no descriptor-relative renameat/unlinkat API. Exact names,
  // no-follow checks, private 0700 transaction directories, and revalidation
  // reject archive-controlled paths, accidental/pre-existing symlinks, and
  // hook-visible swaps. They are not a security boundary against an actively
  // racing same-UID local actor, who can already mutate this personal app's
  // data root, SQLite/media files, or executable code; that actor is outside
  // the trusted-host threat model.
  assertPrivateRestoreTransaction(dataRoot, transaction, kind);
  await rm(transaction, { recursive: true, force: true });
  await durability.syncDirectories([dataRoot], 'restore-transaction-cleaned');
  await durability.phase('transaction-cleaned');
}

async function retireRestoreTransaction(
  dataRoot: string,
  transaction: string,
  durability: DurabilityController,
): Promise<void> {
  const cleanup = await publishRestoreCleanup(dataRoot, transaction, durability);
  await removeRestoreGarbage(dataRoot, cleanup, 'cleanup', durability);
}

export async function recoverInterruptedPortableRestore(
  dataDirectory: string,
  durabilityOptions?: PortableBackupDurability,
): Promise<void> {
  const dataRoot = realpathSync(dataDirectory);
  const durability = createDurabilityController(durabilityOptions);
  const names = readdirSync(dataRoot).sort();
  const preparing = names.filter((name) => RESTORE_PREPARING_DIRECTORY_PATTERN.test(name));
  const cleanup = names.filter((name) => RESTORE_CLEANUP_DIRECTORY_PATTERN.test(name));
  const active = names.filter((name) => RESTORE_DIRECTORY_PATTERN.test(name));
  try {
    for (const name of preparing) {
      await removeRestoreGarbage(dataRoot, join(dataRoot, name), 'preparing', durability);
    }
    for (const name of cleanup) {
      await removeRestoreGarbage(dataRoot, join(dataRoot, name), 'cleanup', durability);
    }
    for (const name of active) {
      const transaction = join(dataRoot, name);
      await validateRestoreTransaction(dataRoot, transaction, 'active', durability, true);
      const plan = await readRestorePlan(dataRoot, transaction, 'active');
      const markerExists = pathMetadata(join(transaction, RESTORE_COMMITTED_FILENAME)) !== undefined;
      if (markerExists && await hasValidRestoreCommitMarker(dataRoot, transaction, plan.backupId)) {
        await retireRestoreTransaction(dataRoot, transaction, durability);
        continue;
      }
      if (markerExists) await invalidateRestoreCommitMarker(dataRoot, transaction, durability);
      await rollbackRestoreTransaction(dataRoot, transaction, plan, durability);
      await retireRestoreTransaction(dataRoot, transaction, durability);
    }
  } catch {
    throw new PortableRestoreIncompleteError();
  }
}

export function createStorageOperationGate(): StorageOperationGate {
  let tail = Promise.resolve();
  return {
    run<T>(operation: () => Promise<T>): Promise<T> {
      const result = tail.then(operation);
      tail = result.then(() => undefined, () => undefined);
      return result;
    },
  };
}

export function createPortableBackupOperations(options: PortableBackupOptions): PortableBackupOperations {
  const dataRoot = realpathSync(options.dataDirectory);
  const mediaRoot = ensureContainedDirectory(join(dataRoot, 'media'), dataRoot);
  const backupsRoot = ensureContainedDirectory(options.backupsDirectory ?? join(dataRoot, 'backups'), dataRoot);
  const databasePath = join(dataRoot, DATABASE_FILENAME);
  const now = options.now ?? (() => new Date());
  const makeRandomId = options.randomId ?? randomUUID;
  const durability = createDurabilityController(options.durability);
  let operationTail = Promise.resolve();

  function serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = operationTail.then(operation);
    operationTail = result.then(() => undefined, () => undefined);
    return result;
  }

  async function createInternal(prefix: 'portable' | 'recovery-before-restore'): Promise<BackupSummary> {
    const identifier = makeRandomId();
    const createdAt = now().toISOString();
    const backupId = `${prefix}-${filenameTimestamp(new Date(createdAt))}-${identifier}`;
    if (!BACKUP_ID_PATTERN.test(backupId)) throw new PortableBackupCreateError();
    const operationId = randomUUID();
    const snapshotPath = join(backupsRoot, `.${backupId}.${operationId}.sqlite3`);
    const temporaryArchivePath = join(backupsRoot, `.${backupId}.${operationId}.tar.tmp`);
    const archivePath = join(backupsRoot, `${backupId}.tar`);
    try {
      assertCanonicalDirectory(backupsRoot, dataRoot);
      if (existsSync(archivePath)) throw new PortableBackupCreateError();
      options.currentDatabase().connection.prepare('VACUUM main INTO ?').run(snapshotPath);
      const state = readDatabaseState(snapshotPath);
      const sources = await sourceFilesForSnapshot(dataRoot, mediaRoot, snapshotPath, state);
      const manifest: PortableBackupManifest = {
        formatVersion: 1,
        schemaVersion: state.schemaVersion,
        createdAt,
        directoryRevision: state.directoryRevision,
        tripRevisions: state.tripRevisions,
        files: sources.map((source) => ({
          path: source.archivePath,
          byteCount: source.byteCount,
          sha256: source.sha256,
        })),
      };
      parseManifest(manifest);
      await createArchive(temporaryArchivePath, manifest, sources);
      await durability.phase('archive-ready');
      await validateArchiveFile(dataRoot, temporaryArchivePath);
      await publishArchive(temporaryArchivePath, archivePath, backupsRoot, durability);
      return backupSummary(backupId, manifest);
    } catch (error) {
      await rm(temporaryArchivePath, { force: true }).catch(() => undefined);
      if (error instanceof PortableBackupCreateError) throw error;
      throw new PortableBackupCreateError();
    } finally {
      await rm(snapshotPath, { force: true }).catch(() => undefined);
      await rm(`${snapshotPath}-wal`, { force: true }).catch(() => undefined);
      await rm(`${snapshotPath}-shm`, { force: true }).catch(() => undefined);
    }
  }

  async function inspectInternal(backupId: string): Promise<BackupManifest> {
    const extracted = await inspectArchive(dataRoot, backupsRoot, backupId);
    try {
      return { ...backupSummary(backupId, extracted.manifest), files: extracted.manifest.files };
    } finally {
      await rm(extracted.stageDirectory, { recursive: true, force: true });
    }
  }

  return {
    create() {
      return serialized(() => createInternal('portable'));
    },

    list() {
      return serialized(async () => {
        assertCanonicalDirectory(backupsRoot, dataRoot);
        const backupIds = readdirSync(backupsRoot, { withFileTypes: true })
          .filter((entry) => entry.isFile() && entry.name.endsWith('.tar'))
          .map((entry) => entry.name.slice(0, -4))
          .filter((backupId) => BACKUP_ID_PATTERN.test(backupId))
          .sort();
        const summaries: BackupSummary[] = [];
        for (const backupId of backupIds) {
          const inspected = await inspectInternal(backupId);
          summaries.push(backupSummary(backupId, {
            formatVersion: 1,
            schemaVersion: inspected.schemaVersion,
            createdAt: inspected.createdAt,
            directoryRevision: inspected.directoryRevision,
            tripRevisions: inspected.tripRevisions,
            files: inspected.files,
          }));
        }
        return summaries.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
      });
    },

    inspect(backupId) {
      return serialized(() => inspectInternal(backupId));
    },

    restore(backupId, request) {
      return serialized(async () => {
        assertBackupId(backupId);
        if (request.confirmation !== `RESTORE ${backupId}`) throw new PortableRestoreConfirmationError();
        const stageId = makeRandomId();
        let extracted: ExtractedArchive | undefined;
        let recovery: BackupSummary | undefined;
        let plan: RestorePlan | undefined;
        let transactionKind: 'preparing' | 'active' = 'preparing';
        let storageClosed = false;
        let restoredRuntimeOpen = false;
        let promotionStarted = false;
        let markerMayExist = false;
        let commitDurable = false;
        try {
          extracted = await inspectArchive(dataRoot, backupsRoot, backupId, stageId);
          await validateRestoreTransaction(
            dataRoot,
            extracted.stageDirectory,
            'preparing',
            durability,
          );
          recovery = await createInternal('recovery-before-restore');
          await durability.phase('recovery-archive-durable');
          const rollbackRoot = join(extracted.stageDirectory, 'rollback');
          await mkdir(rollbackRoot, { mode: 0o700 });
          assertPrivateInternalDirectory(rollbackRoot, extracted.stageDirectory);
          await options.closeStorage();
          storageClosed = true;
          await durability.phase('storage-quiesced');
          const originalWal = assertOptionalStoredObject(`${databasePath}-wal`, 'file', dataRoot);
          const originalShm = assertOptionalStoredObject(`${databasePath}-shm`, 'file', dataRoot);
          plan = restorePlan(stageId, backupId, originalWal, originalShm);
          await validateRestoreTransaction(
            dataRoot,
            extracted.stageDirectory,
            'preparing',
            durability,
          );
          await writeSyncedControlFile(join(extracted.stageDirectory, RESTORE_PLAN_FILENAME), plan);
          await durability.syncDirectories(
            [extracted.stageDirectory],
            'restore-rollback-created',
          );
          await validateRestoreTransaction(
            dataRoot,
            extracted.stageDirectory,
            'preparing',
            durability,
          );
          const activeStage = join(dataRoot, `.portable-restore-${stageId}`);
          if (pathMetadata(activeStage)) throw new PortableBackupInvalidError();
          await rename(extracted.stageDirectory, activeStage);
          extracted.stageDirectory = activeStage;
          extracted.payloadDirectory = join(activeStage, 'payload');
          transactionKind = 'active';
          await durability.syncDirectories([dataRoot], 'restore-transaction-created');
          await validateRestoreTransaction(
            dataRoot,
            extracted.stageDirectory,
            'active',
            durability,
            true,
          );
          const activeRollbackRoot = join(extracted.stageDirectory, 'rollback');
          assertPrivateInternalDirectory(activeRollbackRoot, extracted.stageDirectory);
          assertPrivateInternalDirectory(extracted.payloadDirectory, extracted.stageDirectory);
          promotionStarted = true;
          await rename(databasePath, join(activeRollbackRoot, DATABASE_FILENAME));
          await validateRestoreTransaction(dataRoot, extracted.stageDirectory, 'active', durability);
          if (await renameIfExists(
            `${databasePath}-wal`,
            join(activeRollbackRoot, `${DATABASE_FILENAME}-wal`),
          ) !== plan.originalWal) throw new PortableBackupInvalidError();
          await validateRestoreTransaction(dataRoot, extracted.stageDirectory, 'active', durability);
          if (await renameIfExists(
            `${databasePath}-shm`,
            join(activeRollbackRoot, `${DATABASE_FILENAME}-shm`),
          ) !== plan.originalShm) throw new PortableBackupInvalidError();
          await validateRestoreTransaction(dataRoot, extracted.stageDirectory, 'active', durability);
          await rename(mediaRoot, join(activeRollbackRoot, 'media'));
          await durability.syncDirectories([dataRoot, activeRollbackRoot], 'restore-originals-moved');
          await validateRestoreTransaction(dataRoot, extracted.stageDirectory, 'active', durability);
          await durability.phase('originals-durable');
          if (!existsSync(join(extracted.payloadDirectory, 'media'))) {
            await mkdir(join(extracted.payloadDirectory, 'media'), { mode: 0o700 });
          }
          assertPrivateInternalDirectory(
            dirname(join(extracted.payloadDirectory, DATABASE_ARCHIVE_PATH)),
            extracted.stageDirectory,
          );
          assertPrivateInternalDirectory(join(extracted.payloadDirectory, 'media'), extracted.stageDirectory);
          await validateRestoreTransaction(dataRoot, extracted.stageDirectory, 'active', durability);
          await rename(join(extracted.payloadDirectory, DATABASE_ARCHIVE_PATH), databasePath);
          await validateRestoreTransaction(dataRoot, extracted.stageDirectory, 'active', durability);
          await rename(join(extracted.payloadDirectory, 'media'), mediaRoot);
          await durability.syncDirectories([
            dataRoot,
            dirname(join(extracted.payloadDirectory, DATABASE_ARCHIVE_PATH)),
            extracted.payloadDirectory,
          ], 'restore-promoted');
          await validateRestoreTransaction(dataRoot, extracted.stageDirectory, 'active', durability);
          await durability.phase('promotion-durable');
          await options.openStorage();
          storageClosed = false;
          restoredRuntimeOpen = true;
          await validateRestoreTransaction(dataRoot, extracted.stageDirectory, 'active', durability);
          markerMayExist = true;
          await writeSyncedControlFile(
            join(extracted.stageDirectory, RESTORE_COMMITTED_FILENAME),
            restoreCommitMarker(stageId, backupId),
          );
          await durability.syncDirectories(
            [extracted.stageDirectory],
            'restore-marker-published',
          );
          commitDurable = true;
          await validateRestoreTransaction(dataRoot, extracted.stageDirectory, 'active', durability);
        } catch (error) {
          if (extracted === undefined) throw error;
          if (commitDurable) {
            if (storageClosed) {
              try {
                await options.openStorage();
                storageClosed = false;
              } catch {
                // The stable incomplete error below also gates failed readiness.
              }
            }
            throw new PortableRestoreIncompleteError();
          }
          if (transactionKind === 'preparing') {
            if (storageClosed) {
              try {
                await options.openStorage();
                storageClosed = false;
              } catch {
                throw new PortableRestoreIncompleteError();
              }
            }
            await removeRestoreGarbage(
              dataRoot,
              extracted.stageDirectory,
              'preparing',
              durability,
            ).catch(() => undefined);
            throw error;
          }
          if (!promotionStarted) {
            if (storageClosed) {
              try {
                await options.openStorage();
                storageClosed = false;
              } catch {
                throw new PortableRestoreIncompleteError();
              }
            }
            await retireRestoreTransaction(dataRoot, extracted.stageDirectory, durability)
              .catch(() => undefined);
            throw error;
          }
          if (
            markerMayExist
            || pathMetadata(join(extracted.stageDirectory, RESTORE_COMMITTED_FILENAME)) !== undefined
          ) {
            try {
              await invalidateRestoreCommitMarker(dataRoot, extracted.stageDirectory, durability);
              markerMayExist = false;
            } catch {
              if (!storageClosed) {
                try {
                  await options.closeStorage();
                } catch {
                  // closeStorage must revoke readiness before physical close;
                  // ambiguity remains gated by the stable error below.
                }
              }
              throw new PortableRestoreIncompleteError();
            }
          }
          try {
            if (restoredRuntimeOpen) {
              await options.closeStorage();
              storageClosed = true;
            }
            plan ??= await readRestorePlan(dataRoot, extracted.stageDirectory, 'active');
            await rollbackRestoreTransaction(dataRoot, extracted.stageDirectory, plan, durability);
            if (storageClosed) {
              await options.openStorage();
              storageClosed = false;
            }
            await retireRestoreTransaction(dataRoot, extracted.stageDirectory, durability)
              .catch(() => undefined);
          } catch {
            throw new PortableRestoreIncompleteError();
          }
          throw new PortableRestoreRecoveredError();
        }
        if (!commitDurable || !extracted || !recovery) throw new PortableRestoreIncompleteError();
        const restored = backupSummary(backupId, extracted.manifest);
        await durability.phase('commit-marker-durable').catch(() => undefined);
        try {
          options.publishRestoreReset({
            epoch: stageId,
            tripIds: [...new Set([
              ...Object.keys(restored.tripRevisions),
              ...Object.keys(recovery.tripRevisions),
            ])],
          });
        } catch {
          // Durable canonical state is authoritative; reconnect reconciliation
          // supplies the same reset if an in-process subscriber throws.
        }
        await retireRestoreTransaction(dataRoot, extracted.stageDirectory, durability)
          .catch(() => undefined);
        return restored;
      });
    },
  };
}
