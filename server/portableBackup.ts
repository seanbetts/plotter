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
  mkdtemp,
  open,
  readFile,
  realpath,
  rename,
  rm,
} from 'node:fs/promises';
import {
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
import type { RevisionEvent } from '../src/storage/revision';
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
const RESTORE_DIRECTORY_PATTERN = /^\.portable-restore-[0-9a-f-]{36}$/;
const RESTORE_COMMITTED_FILENAME = 'restore-committed';
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

export type PortableBackupOptions = {
  dataDirectory: string;
  backupsDirectory?: string;
  currentDatabase(): PlotterDatabase;
  closeStorage(): Promise<void> | void;
  openStorage(): Promise<void> | void;
  publish(event: RevisionEvent): void;
  now?: () => Date;
  randomId?: () => string;
};

type SourceFile = {
  archivePath: string;
  sourcePath: string;
  byteCount: number;
  sha256: string;
};

type ExtractedArchive = {
  stageDirectory: string;
  manifest: PortableBackupManifest;
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

function validNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
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
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(tripId) || !validNonNegativeInteger(revision)) {
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
        || !validNonNegativeInteger(row.size_bytes)
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
    const extension = expectedMediaExtension(media.contentType);
    const expectedRelativePath = extension === undefined ? '' : `media/${media.id}.${extension}`;
    if (media.relativePath !== expectedRelativePath) throw new PortableBackupInvalidError();
    assertArchivePath(media.relativePath);
    if (seen.has(media.relativePath)) throw new PortableBackupInvalidError();
    seen.add(media.relativePath);
    const lexical = resolve(dataRoot, media.relativePath);
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
    sources.push({ archivePath: media.relativePath, sourcePath: canonical, ...digest });
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

function tarHeader(path: string, byteCount: number): Buffer {
  const { name, prefix } = tarPathParts(path);
  const header = Buffer.alloc(ARCHIVE_BLOCK_BYTES);
  header.write(name, 0, 100, 'utf8');
  writeTarNumber(header, 100, 8, 0o600);
  writeTarNumber(header, 108, 8, 0);
  writeTarNumber(header, 116, 8, 0);
  writeTarNumber(header, 124, 12, byteCount);
  writeTarNumber(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header.write('0', 156, 1, 'ascii');
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
): Promise<void> {
  await writeAll(handle, tarHeader(path, bytes.byteLength));
  await writeAll(handle, bytes);
  const padding = (ARCHIVE_BLOCK_BYTES - (bytes.byteLength % ARCHIVE_BLOCK_BYTES)) % ARCHIVE_BLOCK_BYTES;
  if (padding > 0) await writeAll(handle, Buffer.alloc(padding));
}

async function writeTarFile(
  handle: Awaited<ReturnType<typeof open>>,
  source: SourceFile,
): Promise<void> {
  await writeAll(handle, tarHeader(source.archivePath, source.byteCount));
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
  archivePath: string,
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
    await rename(temporaryPath, archivePath);
  } catch (error) {
    try { await handle?.close(); } catch { /* Preserve the stable backup failure. */ }
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    if (error instanceof PortableBackupCreateError) throw error;
    throw new PortableBackupCreateError();
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
      if (
        header.subarray(257, 263).toString('ascii') !== 'ustar\0'
        || header.subarray(263, 265).toString('ascii') !== '00'
        || !['0', '\0'].includes(header.subarray(156, 157).toString('ascii'))
      ) throw new PortableBackupInvalidError();
      const archiveEntryPath = tarEntryPath(header);
      if (seen.has(archiveEntryPath)) throw new PortableBackupInvalidError();
      const byteCount = parseTarNumber(header.subarray(124, 136));
      if (byteCount > maximumEntryBytes(archiveEntryPath)) throw new PortableBackupInvalidError();
      totalBytes += byteCount;
      if (totalBytes > MAX_ARCHIVE_BYTES) throw new PortableBackupInvalidError();
      const paddedBytes = byteCount + ((ARCHIVE_BLOCK_BYTES - (byteCount % ARCHIVE_BLOCK_BYTES)) % ARCHIVE_BLOCK_BYTES);
      if (position + paddedBytes > archiveMetadata.size) throw new PortableBackupInvalidError();

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
  if (!foundEnd) throw new PortableBackupInvalidError();
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
    if (
      file?.path !== media.relativePath
      || file.byteCount !== media.byteCount
      || file.sha256 !== media.sha256
    ) throw new PortableBackupInvalidError();
  }
  return manifest;
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
    : join(dataRoot, `.portable-restore-${restoreStageId}`);
  if (restoreStageId !== undefined) await mkdir(stageDirectory, { mode: 0o700 });
  try {
    const canonicalStage = await realpath(stageDirectory);
    if (!isContained(canonicalStage, dataRoot) || canonicalStage !== stageDirectory) {
      throw new PortableBackupInvalidError();
    }
      const entries = await extractArchive(canonicalArchive, canonicalStage);
      const manifest = await validateExtractedArchive(canonicalStage, entries);
    return { stageDirectory: canonicalStage, manifest };
  } catch (error) {
    await rm(stageDirectory, { recursive: true, force: true }).catch(() => undefined);
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

async function moveAsideAndRestore(current: string, original: string, failed: string): Promise<void> {
  if (!existsSync(original)) return;
  const currentMoved = await renameIfExists(current, failed);
  try {
    await rename(original, current);
  } catch (error) {
    if (currentMoved) await rename(failed, current).catch(() => undefined);
    throw error;
  }
}

async function rollbackRestoreTransaction(dataRoot: string, stageDirectory: string): Promise<void> {
  const rollbackRoot = join(stageDirectory, 'rollback');
  const failedRoot = join(stageDirectory, 'failed');
  await rm(failedRoot, { recursive: true, force: true });
  await mkdir(failedRoot, { recursive: true, mode: 0o700 });
  const databasePath = join(dataRoot, DATABASE_FILENAME);
  await moveAsideAndRestore(databasePath, join(rollbackRoot, DATABASE_FILENAME), join(failedRoot, DATABASE_FILENAME));
  await moveAsideAndRestore(`${databasePath}-wal`, join(rollbackRoot, `${DATABASE_FILENAME}-wal`), join(failedRoot, `${DATABASE_FILENAME}-wal`));
  await moveAsideAndRestore(`${databasePath}-shm`, join(rollbackRoot, `${DATABASE_FILENAME}-shm`), join(failedRoot, `${DATABASE_FILENAME}-shm`));
  await moveAsideAndRestore(join(dataRoot, 'media'), join(rollbackRoot, 'media'), join(failedRoot, 'media'));
}

export async function recoverInterruptedPortableRestore(dataDirectory: string): Promise<void> {
  const dataRoot = realpathSync(dataDirectory);
  const transactions = readdirSync(dataRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && RESTORE_DIRECTORY_PATTERN.test(entry.name))
    .map((entry) => join(dataRoot, entry.name))
    .sort();
  for (const transaction of transactions) {
    try {
      if (!existsSync(join(transaction, RESTORE_COMMITTED_FILENAME))) {
        await rollbackRestoreTransaction(dataRoot, transaction);
      }
      await rm(transaction, { recursive: true, force: true });
    } catch {
      throw new PortableRestoreIncompleteError();
    }
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
    const snapshotPath = join(backupsRoot, `.${backupId}.sqlite3`);
    const temporaryArchivePath = join(backupsRoot, `.${backupId}.tar.tmp`);
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
      await createArchive(archivePath, temporaryArchivePath, manifest, sources);
      return backupSummary(backupId, manifest);
    } catch (error) {
      await rm(temporaryArchivePath, { force: true }).catch(() => undefined);
      await rm(archivePath, { force: true }).catch(() => undefined);
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
        let storageClosed = false;
        let restoredRuntimeOpen = false;
        let promotionStarted = false;
        try {
          extracted = await inspectArchive(dataRoot, backupsRoot, backupId, stageId);
          const recovery = await createInternal('recovery-before-restore');
          const rollbackRoot = join(extracted.stageDirectory, 'rollback');
          await mkdir(rollbackRoot, { mode: 0o700 });
          await options.closeStorage();
          storageClosed = true;
          promotionStarted = true;
          await rename(databasePath, join(rollbackRoot, DATABASE_FILENAME));
          await renameIfExists(`${databasePath}-wal`, join(rollbackRoot, `${DATABASE_FILENAME}-wal`));
          await renameIfExists(`${databasePath}-shm`, join(rollbackRoot, `${DATABASE_FILENAME}-shm`));
          await rename(mediaRoot, join(rollbackRoot, 'media'));
          if (!existsSync(join(extracted.stageDirectory, 'media'))) {
            await mkdir(join(extracted.stageDirectory, 'media'), { mode: 0o700 });
          }
          await rename(join(extracted.stageDirectory, DATABASE_ARCHIVE_PATH), databasePath);
          await rename(join(extracted.stageDirectory, 'media'), mediaRoot);
          await options.openStorage();
          storageClosed = false;
          restoredRuntimeOpen = true;
          const committedMarker = await open(
            join(extracted.stageDirectory, RESTORE_COMMITTED_FILENAME),
            constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
            0o600,
          );
          await committedMarker.sync();
          await committedMarker.close();
          const restored = backupSummary(backupId, extracted.manifest);
          options.publish({ scope: 'directory', revision: restored.directoryRevision });
          for (const [tripId, revision] of Object.entries(restored.tripRevisions)) {
            options.publish({ scope: 'trip', tripId, revision });
          }
          for (const [tripId, revision] of Object.entries(recovery.tripRevisions)) {
            if (!(tripId in restored.tripRevisions)) {
              options.publish({ scope: 'trip', tripId, revision });
            }
          }
          await rm(extracted.stageDirectory, { recursive: true, force: true }).catch(() => undefined);
          return restored;
        } catch (error) {
          if (!storageClosed && extracted === undefined) throw error;
          if (extracted === undefined) throw error;
          if (!promotionStarted) {
            await rm(extracted.stageDirectory, { recursive: true, force: true }).catch(() => undefined);
            throw error;
          }
          try {
            if (restoredRuntimeOpen) {
              await options.closeStorage();
              storageClosed = true;
            }
            await rollbackRestoreTransaction(dataRoot, extracted.stageDirectory);
            if (storageClosed) {
              await options.openStorage();
              storageClosed = false;
            }
            await rm(extracted.stageDirectory, { recursive: true, force: true });
          } catch {
            throw new PortableRestoreIncompleteError();
          }
          throw new PortableRestoreRecoveredError();
        }
      });
    },
  };
}
