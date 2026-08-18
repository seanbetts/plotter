import { createHash, randomUUID } from 'node:crypto';
import {
  constants,
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { link, open, realpath, rename, unlink } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { isCanonicalId } from '../src/api/identifiers';

export const MAX_MEDIA_BYTES = 52_428_800;

const CONTENT_TYPE_EXTENSIONS = new Map<string, string>([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
] as const);

const CONTENT_TYPE_ERROR = 'Media content type is not allowed.';
const CONTAINMENT_ERROR = 'Media path escapes its storage boundary.';
const MISSING_BYTES_ERROR = 'Media bytes are missing.';
const MEDIA_IDENTITY_ERROR = 'Media filesystem identity changed.';
const MEDIA_RECOVERY_ERROR = 'Pending media recovery is incomplete.';
const MEDIA_OPERATION_DIRECTORY = '.media-operations';
const MEDIA_OPERATION_PATTERN = /^media-operation-([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.json$/;
const MEDIA_OPERATION_PREPARING_PATTERN = /^\.media-operation-preparing-([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.tmp$/;
const MAX_MEDIA_OPERATION_BYTES = 4 * 1024 * 1024;
const mediaIdentityTails = new Map<string, Promise<void>>();

export type StoredMediaObject = {
  relativePath: string;
  byteCount: number;
  sha256: string;
  contentType: string;
};

export type MediaStore = {
  stage(input: ReadableStream<Uint8Array>, contentType: string): Promise<StoredMediaObject>;
  commit(staged: StoredMediaObject, mediaId: string): Promise<StoredMediaObject>;
  moveToTrash(relativePath: string, mediaId: string): Promise<() => Promise<void>>;
  open(relativePath: string): Promise<{
    contentLength: number;
    bytes: AsyncIterable<Uint8Array>;
  }>;
};

export type AtomicMediaStore = MediaStore & {
  /** Removes bytes created by an operation whose metadata never committed. */
  discard(relativePath: string): Promise<void>;
  prepareCommit(
    staged: StoredMediaObject,
    mediaId: string,
  ): Promise<PreparedMediaOperation<StoredMediaObject>>;
  prepareMoveToTrash(
    objects: Array<{ mediaId: string; relativePath: string }>,
  ): Promise<PreparedMediaOperation<void>>;
  recoverPendingOperations(connection: DatabaseSync): Promise<void>;
};

export type PreparedMediaOperation<T> = {
  value: T;
  rollback(): Promise<void>;
  finalize(): Promise<void>;
};

export type MediaStorePhase =
  | 'intent-durable'
  | 'filesystem-durable'
  | 'intent-clear-start'
  | 'intent-cleared'
  | 'recovery-complete';

export type MediaStoreSyncPhase =
  | 'media-directory-created'
  | 'media-published'
  | 'media-publish-rolled-back'
  | 'media-trashed'
  | 'media-restored'
  | 'media-discarded'
  | 'intent-published'
  | 'intent-preparing-cleaned'
  | 'intent-cleared'
  | 'recovery-applied';

export type MediaStoreOptions = {
  randomId?(): string;
  onPhase?(phase: MediaStorePhase): Promise<void> | void;
  syncDirectory?(path: string, phase: MediaStoreSyncPhase): Promise<void> | void;
};

type MediaCreateIntent = {
  version: 1;
  kind: 'create';
  operationId: string;
  mediaId: string;
  stagedPath: string;
  activePath: string;
};

type MediaDeleteIntentItem = {
  mediaId: string;
  activePath: string;
  trashPath: string;
};

type MediaDeleteIntent = {
  version: 1;
  kind: 'delete';
  operationId: string;
  items: MediaDeleteIntentItem[];
};

type MediaOperationIntent = MediaCreateIntent | MediaDeleteIntent;

type PublishedIntent = {
  path: string;
  device: number;
  inode: number;
  value: MediaOperationIntent;
};

type FileIdentity = { device: number; inode: number };

function isContained(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}${sep}`);
}

function assertContained(path: string, root: string): void {
  if (!isContained(path, root)) throw new Error(CONTAINMENT_ERROR);
}

function pathExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function ensureContainedDirectory(path: string, parentRoot: string): string {
  if (!pathExists(path)) mkdirSync(path);
  let canonical: string;
  try {
    canonical = realpathSync(path);
  } catch (error) {
    throw new Error(CONTAINMENT_ERROR, { cause: error });
  }
  assertContained(canonical, parentRoot);
  if (!statSync(canonical).isDirectory()) throw new Error(CONTAINMENT_ERROR);
  return canonical;
}

async function assertCanonicalDirectory(path: string, parentRoot: string): Promise<void> {
  let canonical: string;
  try {
    canonical = await realpath(path);
  } catch (error) {
    throw new Error(CONTAINMENT_ERROR, { cause: error });
  }
  if (canonical !== path) throw new Error(CONTAINMENT_ERROR);
  assertContained(canonical, parentRoot);
}

function extensionFor(contentType: string): string {
  const extension = CONTENT_TYPE_EXTENSIONS.get(contentType);
  if (!extension) throw new Error(CONTENT_TYPE_ERROR);
  return extension;
}

function assertMediaId(mediaId: string): void {
  if (!isCanonicalId(mediaId)) throw new Error('Media identity is invalid.');
}

async function resolveExistingContainedPath(
  path: string,
  root: string,
): Promise<string> {
  try {
    const metadata = lstatSync(path);
    if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error(CONTAINMENT_ERROR);
    const canonical = await realpath(path);
    if (canonical !== path) throw new Error(CONTAINMENT_ERROR);
    assertContained(canonical, root);
    return canonical;
  } catch (error) {
    if (error instanceof Error && error.message === CONTAINMENT_ERROR) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(MISSING_BYTES_ERROR, { cause: error });
    }
    throw error;
  }
}

async function digestFile(path: string): Promise<{ byteCount: number; sha256: string }> {
  const hash = createHash('sha256');
  let byteCount = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
    byteCount += chunk.byteLength;
  }
  return { byteCount, sha256: hash.digest('hex') };
}

async function withMediaIdentityLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = mediaIdentityTails.get(key) ?? Promise.resolve();
  const result = previous.then(operation);
  const tail = result.then(() => undefined, () => undefined);
  mediaIdentityTails.set(key, tail);
  try {
    return await result;
  } finally {
    if (mediaIdentityTails.get(key) === tail) mediaIdentityTails.delete(key);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

function assertDirectMediaPath(value: unknown, mediaId: string): asserts value is string {
  if (
    typeof value !== 'string'
    || dirname(value) !== 'media'
    || !['.jpg', '.png', '.webp', '.gif'].includes(extname(value))
    || basename(value, extname(value)) !== mediaId
  ) throw new Error(MEDIA_RECOVERY_ERROR);
}

function assertStagedPath(value: unknown): asserts value is string {
  if (typeof value !== 'string') throw new Error(MEDIA_RECOVERY_ERROR);
  const match = /^media\/\.staging\/([^/]+)\.tmp$/.exec(value);
  if (!match || !isUuid(match[1])) throw new Error(MEDIA_RECOVERY_ERROR);
}

function assertTrashPath(value: unknown, mediaId: string): asserts value is string {
  if (typeof value !== 'string' || dirname(value) !== 'trash') {
    throw new Error(MEDIA_RECOVERY_ERROR);
  }
  const extension = extname(value);
  if (!['.jpg', '.png', '.webp', '.gif'].includes(extension)) {
    throw new Error(MEDIA_RECOVERY_ERROR);
  }
  const prefix = `${mediaId}-`;
  const stem = basename(value, extension);
  if (!stem.startsWith(prefix) || !isUuid(stem.slice(prefix.length))) {
    throw new Error(MEDIA_RECOVERY_ERROR);
  }
}

function parseMediaOperation(value: unknown): MediaOperationIntent {
  if (!isRecord(value) || value.version !== 1 || typeof value.kind !== 'string') {
    throw new Error(MEDIA_RECOVERY_ERROR);
  }
  if (value.kind === 'create') {
    if (!hasExactKeys(value, [
      'version', 'kind', 'operationId', 'mediaId', 'stagedPath', 'activePath',
    ])) throw new Error(MEDIA_RECOVERY_ERROR);
    if (
      typeof value.operationId !== 'string'
      || !isUuid(value.operationId)
      || typeof value.mediaId !== 'string'
      || !isCanonicalId(value.mediaId)
    ) throw new Error(MEDIA_RECOVERY_ERROR);
    assertStagedPath(value.stagedPath);
    assertDirectMediaPath(value.activePath, value.mediaId);
    return value as MediaCreateIntent;
  }
  if (value.kind !== 'delete' || !hasExactKeys(value, [
    'version', 'kind', 'operationId', 'items',
  ])) throw new Error(MEDIA_RECOVERY_ERROR);
  if (
    typeof value.operationId !== 'string'
    || !isUuid(value.operationId)
    || !Array.isArray(value.items)
    || value.items.length === 0
    || value.items.length > 10_000
  ) throw new Error(MEDIA_RECOVERY_ERROR);
  const seen = new Set<string>();
  const items = value.items.map((item) => {
    if (!isRecord(item) || !hasExactKeys(item, ['mediaId', 'activePath', 'trashPath'])) {
      throw new Error(MEDIA_RECOVERY_ERROR);
    }
    if (
      typeof item.mediaId !== 'string'
      || !isCanonicalId(item.mediaId)
      || seen.has(item.mediaId)
    ) throw new Error(MEDIA_RECOVERY_ERROR);
    seen.add(item.mediaId);
    assertDirectMediaPath(item.activePath, item.mediaId);
    assertTrashPath(item.trashPath, item.mediaId);
    return item as MediaDeleteIntentItem;
  });
  return {
    version: 1,
    kind: 'delete',
    operationId: value.operationId,
    items,
  };
}

type RecoveryMediaMetadata = {
  relativePath: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
};

function parseRecoveryMediaMetadata(
  value: unknown,
  mediaId: string,
  expectedPath: string,
): RecoveryMediaMetadata | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error(MEDIA_RECOVERY_ERROR);
  const relativePath = value.relative_path;
  const contentType = value.content_type;
  const sizeBytes = value.size_bytes;
  const sha256 = value.sha256;
  if (
    typeof relativePath !== 'string'
    || relativePath !== expectedPath
    || typeof contentType !== 'string'
    || !CONTENT_TYPE_EXTENSIONS.has(contentType)
    || typeof sizeBytes !== 'number'
    || !Number.isSafeInteger(sizeBytes)
    || sizeBytes <= 0
    || typeof sha256 !== 'string'
    || !/^[0-9a-f]{64}$/.test(sha256)
  ) throw new Error(MEDIA_RECOVERY_ERROR);
  assertDirectMediaPath(relativePath, mediaId);
  if (extname(relativePath) !== `.${CONTENT_TYPE_EXTENSIONS.get(contentType)}`) {
    throw new Error(MEDIA_RECOVERY_ERROR);
  }
  return { relativePath, contentType, sizeBytes, sha256 };
}

async function defaultSyncDirectory(path: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    if (!(await handle.stat()).isDirectory()) throw new Error(MEDIA_RECOVERY_ERROR);
    await handle.sync();
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export function createMediaStore(
  dataDirectory: string,
  options: MediaStoreOptions = {},
): AtomicMediaStore {
  if (!existsSync(dataDirectory)) mkdirSync(dataDirectory, { recursive: true });
  const dataRoot = realpathSync(dataDirectory);
  const dataRootMetadata = lstatSync(dataRoot);
  const mediaPath = join(dataRoot, 'media');
  const mediaDirectoryExisted = existsSync(mediaPath);
  const mediaRoot = ensureContainedDirectory(mediaPath, dataRoot);
  const stagingPath = join(mediaRoot, '.staging');
  const stagingDirectoryExisted = existsSync(stagingPath);
  const stagingRoot = ensureContainedDirectory(stagingPath, mediaRoot);
  const trashPath = join(dataRoot, 'trash');
  const trashDirectoryExisted = existsSync(trashPath);
  const trashRoot = ensureContainedDirectory(trashPath, dataRoot);
  const operationPath = join(dataRoot, MEDIA_OPERATION_DIRECTORY);
  const operationDirectoryExisted = existsSync(operationPath);
  if (!operationDirectoryExisted) mkdirSync(operationPath, { mode: 0o700 });
  const operationRoot = ensureContainedDirectory(operationPath, dataRoot);
  const operationRootMetadata = lstatSync(operationRoot);
  if (
    operationRootMetadata.isSymbolicLink()
    || !operationRootMetadata.isDirectory()
    || (operationRootMetadata.mode & 0o777) !== 0o700
    || operationRootMetadata.uid !== dataRootMetadata.uid
    || operationRootMetadata.gid !== dataRootMetadata.gid
  ) throw new Error(MEDIA_RECOVERY_ERROR);
  const operationRootIdentity = {
    device: operationRootMetadata.dev,
    inode: operationRootMetadata.ino,
  };
  const makeRandomId = options.randomId ?? randomUUID;
  const syncDirectory = options.syncDirectory
    ?? (async (path: string) => defaultSyncDirectory(path));
  let infrastructureNeedsSync = !mediaDirectoryExisted
    || !stagingDirectoryExisted
    || !trashDirectoryExisted
    || !operationDirectoryExisted;

  async function ensureInfrastructureDurable(): Promise<void> {
    if (!infrastructureNeedsSync) return;
    await syncDirectories([dataRoot, mediaRoot], 'media-directory-created');
    infrastructureNeedsSync = false;
  }

  async function announce(phase: MediaStorePhase): Promise<void> {
    await options.onPhase?.(phase);
  }

  async function syncDirectories(paths: string[], phase: MediaStoreSyncPhase): Promise<void> {
    for (const path of [...new Set(paths)]) await syncDirectory(path, phase);
  }

  function assertOperationRoot(): void {
    try {
      const metadata = lstatSync(operationRoot);
      if (
        metadata.isSymbolicLink()
        || !metadata.isDirectory()
        || metadata.dev !== operationRootIdentity.device
        || metadata.ino !== operationRootIdentity.inode
        || (metadata.mode & 0o777) !== 0o700
        || metadata.uid !== dataRootMetadata.uid
        || metadata.gid !== dataRootMetadata.gid
        || realpathSync(operationRoot) !== operationRoot
        || !isContained(operationRoot, dataRoot)
      ) throw new Error(MEDIA_RECOVERY_ERROR);
    } catch (error) {
      if (error instanceof Error && error.message === MEDIA_RECOVERY_ERROR) throw error;
      throw new Error(MEDIA_RECOVERY_ERROR, { cause: error });
    }
  }

  function assertOwnedFile(path: string, identity: { device: number; inode: number }): void {
    try {
      const metadata = lstatSync(path);
      if (
        metadata.isSymbolicLink()
        || !metadata.isFile()
        || metadata.dev !== identity.device
        || metadata.ino !== identity.inode
        || (metadata.mode & 0o777) !== 0o600
        || metadata.uid !== dataRootMetadata.uid
        || metadata.gid !== dataRootMetadata.gid
        || dirname(path) !== operationRoot
      ) throw new Error(MEDIA_RECOVERY_ERROR);
    } catch (error) {
      if (error instanceof Error && error.message === MEDIA_RECOVERY_ERROR) throw error;
      throw new Error(MEDIA_RECOVERY_ERROR, { cause: error });
    }
  }

  async function removeOwnedFile(
    path: string,
    identity: { device: number; inode: number },
  ): Promise<void> {
    assertOperationRoot();
    assertOwnedFile(path, identity);
    await unlink(path);
  }

  async function publishIntent(value: MediaOperationIntent): Promise<PublishedIntent> {
    assertOperationRoot();
    const parsedValue = parseMediaOperation(value);
    const temporaryPath = join(
      operationRoot,
      `.media-operation-preparing-${parsedValue.operationId}.tmp`,
    );
    const finalPath = join(operationRoot, `media-operation-${parsedValue.operationId}.json`);
    const bytes = Buffer.from(`${JSON.stringify(parsedValue)}\n`, 'utf8');
    if (bytes.byteLength > MAX_MEDIA_OPERATION_BYTES) throw new Error(MEDIA_RECOVERY_ERROR);
    const handle = await open(
      temporaryPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_WRONLY,
      0o600,
    );
    const identity = await handle.stat();
    let finalCreated = false;
    let directorySynced = false;
    try {
      let offset = 0;
      if (
        !identity.isFile()
        || (identity.mode & 0o777) !== 0o600
        || identity.uid !== dataRootMetadata.uid
        || identity.gid !== dataRootMetadata.gid
      ) throw new Error(MEDIA_RECOVERY_ERROR);
      while (offset < bytes.byteLength) {
        const result = await handle.write(bytes, offset, bytes.byteLength - offset, offset);
        if (result.bytesWritten <= 0) throw new Error(MEDIA_RECOVERY_ERROR);
        offset += result.bytesWritten;
      }
      await handle.sync();
      await handle.close();
      assertOperationRoot();
      assertOwnedFile(temporaryPath, { device: identity.dev, inode: identity.ino });
      await link(temporaryPath, finalPath);
      finalCreated = true;
      assertOwnedFile(finalPath, { device: identity.dev, inode: identity.ino });
      await removeOwnedFile(temporaryPath, { device: identity.dev, inode: identity.ino });
      await syncDirectories([operationRoot], 'intent-published');
      directorySynced = true;
      await announce('intent-durable');
      return {
        path: finalPath,
        device: identity.dev,
        inode: identity.ino,
        value: parsedValue,
      };
    } catch (error) {
      await handle.close().catch(() => undefined);
      if (!directorySynced) {
        try {
          if (finalCreated && pathExists(finalPath)) {
            await removeOwnedFile(finalPath, { device: identity.dev, inode: identity.ino });
          }
          if (pathExists(temporaryPath)) {
            await removeOwnedFile(temporaryPath, { device: identity.dev, inode: identity.ino });
          }
          await syncDirectories([operationRoot], 'intent-preparing-cleaned');
        } catch {
          // Retain the primary publication failure; no canonical media changed.
        }
      }
      throw error;
    }
  }

  async function clearIntent(intent: PublishedIntent): Promise<void> {
    await announce('intent-clear-start');
    await removeOwnedFile(intent.path, { device: intent.device, inode: intent.inode });
    await syncDirectories([operationRoot], 'intent-cleared');
    await announce('intent-cleared');
  }

  function absoluteMetadataPath(relativePath: string): string {
    if (isAbsolute(relativePath)) throw new Error(CONTAINMENT_ERROR);
    const absolute = resolve(dataRoot, relativePath);
    assertContained(absolute, dataRoot);
    return absolute;
  }

  async function assertRecoveryBytes(
    path: string,
    root: string,
    metadata: RecoveryMediaMetadata,
  ): Promise<void> {
    try {
      const canonicalPath = await resolveExistingContainedPath(path, root);
      if (dirname(canonicalPath) !== root) throw new Error(MEDIA_RECOVERY_ERROR);
      const digest = await digestFile(canonicalPath);
      if (digest.byteCount !== metadata.sizeBytes || digest.sha256 !== metadata.sha256) {
        throw new Error(MEDIA_RECOVERY_ERROR);
      }
    } catch (error) {
      if (error instanceof Error && error.message === MEDIA_RECOVERY_ERROR) throw error;
      throw new Error(MEDIA_RECOVERY_ERROR, { cause: error });
    }
  }

  async function resolveActivePath(relativePath: string): Promise<string> {
    const activePath = absoluteMetadataPath(relativePath);
    const canonicalActivePath = await resolveExistingContainedPath(activePath, mediaRoot);
    if (dirname(canonicalActivePath) !== mediaRoot || basename(canonicalActivePath).startsWith('.')) {
      throw new Error(CONTAINMENT_ERROR);
    }
    return canonicalActivePath;
  }

  function activeIdentityExists(mediaId: string): boolean {
    return [...CONTENT_TYPE_EXTENSIONS.values()]
      .some((extension) => pathExists(join(mediaRoot, `${mediaId}.${extension}`)));
  }

  async function publishIdentity(
    sourcePath: string,
    targetPath: string,
    mediaId: string,
    discardSourceOnCollision: boolean,
  ): Promise<void> {
    await withMediaIdentityLock(join(mediaRoot, mediaId), async () => {
      if (activeIdentityExists(mediaId)) {
        if (discardSourceOnCollision) {
          await unlink(sourcePath);
          await syncDirectories([dirname(sourcePath)], 'media-discarded');
        }
        throw new Error('Media identity already exists.');
      }
      let renamed = false;
      try {
        await rename(sourcePath, targetPath);
        renamed = true;
        await syncDirectories([dirname(sourcePath), dirname(targetPath)], 'media-published');
      } catch (error) {
        if (renamed) {
          try {
            await rename(targetPath, sourcePath);
            await syncDirectories(
              [dirname(sourcePath), dirname(targetPath)],
              'media-publish-rolled-back',
            );
          } catch (rollbackError) {
            throw new AggregateError(
              [error, rollbackError],
              'Media publication failed and its filesystem rename could not be rolled back.',
              { cause: rollbackError },
            );
          }
        }
        throw error;
      }
    });
  }

  async function unlinkDurably(path: string): Promise<void> {
    await unlink(path);
    await syncDirectories([dirname(path)], 'media-discarded');
  }

  async function readFileIdentity(path: string, root: string): Promise<FileIdentity> {
    const canonicalPath = await resolveExistingContainedPath(path, root);
    if (canonicalPath !== path) throw new Error(MEDIA_IDENTITY_ERROR);
    const metadata = lstatSync(path);
    if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error(MEDIA_IDENTITY_ERROR);
    return { device: metadata.dev, inode: metadata.ino };
  }

  async function assertFileIdentity(
    path: string,
    root: string,
    identity: FileIdentity,
  ): Promise<void> {
    try {
      const current = await readFileIdentity(path, root);
      if (current.device !== identity.device || current.inode !== identity.inode) {
        throw new Error(MEDIA_IDENTITY_ERROR);
      }
    } catch (error) {
      if (error instanceof Error && error.message === MEDIA_IDENTITY_ERROR) throw error;
      throw new Error(MEDIA_IDENTITY_ERROR, { cause: error });
    }
  }

  async function hasFileIdentity(
    path: string,
    root: string,
    identity: FileIdentity,
  ): Promise<boolean> {
    try {
      await assertFileIdentity(path, root, identity);
      return true;
    } catch {
      return false;
    }
  }

  async function validateStagedObject(
    staged: StoredMediaObject,
    mediaId: string,
  ): Promise<{ canonicalStagedPath: string; activePath: string; stored: StoredMediaObject }> {
    assertMediaId(mediaId);
    const extension = extensionFor(staged.contentType);
    const stagedPath = absoluteMetadataPath(staged.relativePath);
    const canonicalStagedPath = await resolveExistingContainedPath(stagedPath, stagingRoot);
    if (dirname(canonicalStagedPath) !== stagingRoot || extname(canonicalStagedPath) !== '.tmp') {
      throw new Error(CONTAINMENT_ERROR);
    }
    const digest = await digestFile(canonicalStagedPath);
    if (digest.byteCount !== staged.byteCount || digest.sha256 !== staged.sha256) {
      await unlinkDurably(canonicalStagedPath);
      throw new Error('Staged media does not match its validated digest.');
    }
    const activePath = join(mediaRoot, `${mediaId}.${extension}`);
    assertContained(await realpath(dirname(activePath)), mediaRoot);
    return {
      canonicalStagedPath,
      activePath,
      stored: { ...staged, relativePath: relative(dataRoot, activePath) },
    };
  }

  async function removeIfPresent(path: string, root: string): Promise<boolean> {
    if (!pathExists(path)) return false;
    const canonical = await resolveExistingContainedPath(path, root);
    await unlinkDurably(canonical);
    return true;
  }

  async function rollbackCreateIntent(intent: PublishedIntent): Promise<void> {
    if (intent.value.kind !== 'create') throw new Error(MEDIA_RECOVERY_ERROR);
    const activePath = absoluteMetadataPath(intent.value.activePath);
    const stagedPath = absoluteMetadataPath(intent.value.stagedPath);
    await removeIfPresent(activePath, mediaRoot);
    await removeIfPresent(stagedPath, stagingRoot);
    await clearIntent(intent);
  }

  async function moveToUnoccupiedTrash(
    sourcePath: string,
    targetPath: string,
  ): Promise<void> {
    if (pathExists(targetPath)) throw new Error('Media trash target already exists.');
    const sourceIdentity = await readFileIdentity(sourcePath, mediaRoot);
    let targetLinked = false;
    let sourceRemoved = false;
    try {
      await link(sourcePath, targetPath);
      targetLinked = true;
      await syncDirectories([dirname(targetPath)], 'media-trashed');
      await assertFileIdentity(sourcePath, mediaRoot, sourceIdentity);
      await assertFileIdentity(targetPath, trashRoot, sourceIdentity);
      await unlink(sourcePath);
      sourceRemoved = true;
      await syncDirectories([dirname(sourcePath)], 'media-trashed');
      await assertFileIdentity(targetPath, trashRoot, sourceIdentity);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST' && !targetLinked) {
        throw new Error('Media trash target already exists.', { cause: error });
      }
      try {
        if (sourceRemoved) {
          await assertFileIdentity(targetPath, trashRoot, sourceIdentity);
          if (pathExists(sourcePath)) throw new Error(MEDIA_IDENTITY_ERROR, { cause: error });
          await link(targetPath, sourcePath);
          await syncDirectories([dirname(sourcePath)], 'media-restored');
          await assertFileIdentity(sourcePath, mediaRoot, sourceIdentity);
          await assertFileIdentity(targetPath, trashRoot, sourceIdentity);
        }
        if (
          targetLinked
          && await hasFileIdentity(sourcePath, mediaRoot, sourceIdentity)
          && await hasFileIdentity(targetPath, trashRoot, sourceIdentity)
        ) {
          await unlink(targetPath);
          await syncDirectories([dirname(targetPath)], 'media-restored');
        }
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          'Media trashing failed and its filesystem link could not be rolled back.',
          { cause: rollbackError },
        );
      }
      throw error;
    }
  }

  async function moveTrashItem(
    item: MediaDeleteIntentItem,
  ): Promise<void> {
    const canonicalActivePath = await resolveActivePath(item.activePath);
    const trashedPath = absoluteMetadataPath(item.trashPath);
    await assertCanonicalDirectory(trashRoot, dataRoot);
    await withMediaIdentityLock(join(mediaRoot, item.mediaId), async () => {
      await moveToUnoccupiedTrash(canonicalActivePath, trashedPath);
    });
  }

  async function restoreDeleteItems(items: MediaDeleteIntentItem[]): Promise<void> {
    for (const item of [...items].reverse()) {
      const activePath = absoluteMetadataPath(item.activePath);
      const trashedPath = absoluteMetadataPath(item.trashPath);
      const activeExists = pathExists(activePath);
      const trashExists = pathExists(trashedPath);
      if (activeExists && !trashExists) continue;
      if (!activeExists && trashExists) {
        const canonicalTrashPath = await resolveExistingContainedPath(trashedPath, trashRoot);
        await publishIdentity(
          canonicalTrashPath,
          activePath,
          item.mediaId,
          false,
        );
        continue;
      }
      throw new Error(MEDIA_RECOVERY_ERROR);
    }
  }

  async function rollbackDeleteIntent(intent: PublishedIntent): Promise<void> {
    if (intent.value.kind !== 'delete') throw new Error(MEDIA_RECOVERY_ERROR);
    await restoreDeleteItems(intent.value.items);
    await clearIntent(intent);
  }

  async function readPublishedIntent(path: string): Promise<PublishedIntent> {
    assertOperationRoot();
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      const before = await handle.stat();
      if (
        !before.isFile()
        || before.size <= 0
        || before.size > MAX_MEDIA_OPERATION_BYTES
        || (before.mode & 0o777) !== 0o600
        || before.uid !== dataRootMetadata.uid
        || before.gid !== dataRootMetadata.gid
      ) {
        throw new Error(MEDIA_RECOVERY_ERROR);
      }
      const bytes = await handle.readFile();
      const after = await handle.stat();
      if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size) {
        throw new Error(MEDIA_RECOVERY_ERROR);
      }
      const parsed = parseMediaOperation(JSON.parse(bytes.toString('utf8')) as unknown);
      if (`media-operation-${parsed.operationId}.json` !== basename(path)) {
        throw new Error(MEDIA_RECOVERY_ERROR);
      }
      return { path, device: before.dev, inode: before.ino, value: parsed };
    } catch (error) {
      if (error instanceof Error && error.message === MEDIA_RECOVERY_ERROR) throw error;
      throw new Error(MEDIA_RECOVERY_ERROR, { cause: error });
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  return {
    async open(relativePath) {
      const path = await resolveActivePath(relativePath);
      return {
        contentLength: statSync(path).size,
        bytes: createReadStream(path),
      };
    },

    async stage(input, contentType) {
      await ensureInfrastructureDurable();
      extensionFor(contentType);
      await assertCanonicalDirectory(stagingRoot, mediaRoot);
      const temporaryName = `${randomUUID()}.tmp`;
      const temporaryPath = join(stagingRoot, temporaryName);
      const relativePath = relative(dataRoot, temporaryPath);
      const handle = await open(
        temporaryPath,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
        0o600,
      );
      const reader = input.getReader();
      const hash = createHash('sha256');
      let byteCount = 0;
      let result: StoredMediaObject | undefined;
      let failure: unknown;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!(value instanceof Uint8Array)) throw new Error('Media stream is invalid.');
          byteCount += value.byteLength;
          if (byteCount > MAX_MEDIA_BYTES) {
            throw new Error('Media exceeds the 50 MiB size limit.');
          }
          hash.update(value);
          let offset = 0;
          while (offset < value.byteLength) {
            const { bytesWritten } = await handle.write(
              value,
              offset,
              value.byteLength - offset,
            );
            offset += bytesWritten;
          }
        }
        if (byteCount === 0) throw new Error('Media must contain at least one byte.');
        await handle.sync();
        result = {
          relativePath,
          byteCount,
          sha256: hash.digest('hex'),
          contentType,
        };
      } catch (error) {
        failure = error;
        try {
          await reader.cancel(error);
        } catch {
          // Preserve the stream, validation, or filesystem failure.
        }
      }
      try {
        await handle.close();
      } catch (error) {
        failure = failure === undefined
          ? error
          : new AggregateError([failure, error], 'Media staging and file close both failed.');
      }
      try {
        reader.releaseLock();
      } catch (error) {
        failure = failure === undefined
          ? error
          : new AggregateError([failure, error], 'Media staging and stream release both failed.');
      }
      if (failure !== undefined || result === undefined) {
        try {
          if (pathExists(temporaryPath)) await unlinkDurably(temporaryPath);
        } catch (cleanupError) {
          throw new AggregateError(
            failure === undefined ? [cleanupError] : [failure, cleanupError],
            'Media staging failed and its partial file could not be removed durably.',
            { cause: cleanupError },
          );
        }
        throw failure ?? new Error('Media staging failed.');
      }
      return result;
    },

    async commit(staged, mediaId) {
      await ensureInfrastructureDurable();
      const validated = await validateStagedObject(staged, mediaId);
      try {
        await publishIdentity(
          validated.canonicalStagedPath,
          validated.activePath,
          mediaId,
          true,
        );
        return validated.stored;
      } catch (error) {
        await removeIfPresent(validated.canonicalStagedPath, stagingRoot).catch(() => undefined);
        throw error;
      }
    },

    async moveToTrash(relativePath, mediaId) {
      await ensureInfrastructureDurable();
      assertMediaId(mediaId);
      const canonicalActivePath = await resolveActivePath(relativePath);
      const extension = extname(canonicalActivePath);
      const item: MediaDeleteIntentItem = {
        mediaId,
        activePath: relativePath,
        trashPath: relative(
          dataRoot,
          join(trashRoot, `${mediaId}-${makeRandomId()}${extension}`),
        ),
      };
      await moveTrashItem(item);
      let restored = false;

      return async () => {
        if (restored) return;
        await restoreDeleteItems([item]);
        restored = true;
      };
    },

    async discard(relativePath) {
      await ensureInfrastructureDurable();
      const absolutePath = absoluteMetadataPath(relativePath);
      if (relativePath.startsWith('media/.staging/')) {
        const stagedPath = await resolveExistingContainedPath(absolutePath, stagingRoot);
        if (dirname(stagedPath) !== stagingRoot || extname(stagedPath) !== '.tmp') {
          throw new Error(CONTAINMENT_ERROR);
        }
        await unlinkDurably(stagedPath);
        return;
      }
      await unlinkDurably(await resolveActivePath(relativePath));
    },

    async prepareCommit(staged, mediaId) {
      await ensureInfrastructureDurable();
      const validated = await validateStagedObject(staged, mediaId);
      const value: MediaCreateIntent = {
        version: 1,
        kind: 'create',
        operationId: makeRandomId(),
        mediaId,
        stagedPath: staged.relativePath,
        activePath: validated.stored.relativePath,
      };
      let intent: PublishedIntent;
      try {
        intent = await publishIntent(value);
      } catch (error) {
        const retainedIntent = join(operationRoot, `media-operation-${value.operationId}.json`);
        if (!pathExists(retainedIntent)) {
          await removeIfPresent(validated.canonicalStagedPath, stagingRoot).catch(() => undefined);
        }
        throw error;
      }
      try {
        await publishIdentity(
          validated.canonicalStagedPath,
          validated.activePath,
          mediaId,
          true,
        );
      } catch (error) {
        await rollbackCreateIntent(intent).catch(() => undefined);
        throw error;
      }
      await announce('filesystem-durable');
      return {
        value: validated.stored,
        rollback: () => rollbackCreateIntent(intent),
        finalize: () => clearIntent(intent),
      };
    },

    async prepareMoveToTrash(objects) {
      await ensureInfrastructureDurable();
      const seen = new Set<string>();
      const items: MediaDeleteIntentItem[] = [];
      for (const object of objects) {
        assertMediaId(object.mediaId);
        if (seen.has(object.mediaId)) throw new Error('Media identities must be unique.');
        seen.add(object.mediaId);
        const canonicalActivePath = await resolveActivePath(object.relativePath);
        const generatedTrashPath = join(
          trashRoot,
          `${object.mediaId}-${makeRandomId()}${extname(canonicalActivePath)}`,
        );
        if (pathExists(generatedTrashPath)) {
          throw new Error('Media trash target already exists.');
        }
        items.push({
          mediaId: object.mediaId,
          activePath: object.relativePath,
          trashPath: relative(dataRoot, generatedTrashPath),
        });
      }
      if (items.length === 0) {
        return { value: undefined, async rollback() {}, async finalize() {} };
      }
      const intent = await publishIntent({
        version: 1,
        kind: 'delete',
        operationId: makeRandomId(),
        items,
      });
      try {
        for (const item of items) await moveTrashItem(item);
      } catch (error) {
        try {
          await rollbackDeleteIntent(intent);
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            'Media trashing failed and its durable operation could not be rolled back.',
            { cause: rollbackError },
          );
        }
        throw error;
      }
      await announce('filesystem-durable');
      return {
        value: undefined,
        rollback: () => rollbackDeleteIntent(intent),
        finalize: () => clearIntent(intent),
      };
    },

    async recoverPendingOperations(connection) {
      await ensureInfrastructureDurable();
      assertOperationRoot();
      const entries = readdirSync(operationRoot, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name));
      const pending: PublishedIntent[] = [];
      for (const entry of entries) {
        const path = join(operationRoot, entry.name);
        if (!entry.isFile() || entry.isSymbolicLink()) throw new Error(MEDIA_RECOVERY_ERROR);
        if (MEDIA_OPERATION_PREPARING_PATTERN.test(entry.name)) {
          const metadata = lstatSync(path);
          await removeOwnedFile(path, { device: metadata.dev, inode: metadata.ino });
          await syncDirectories([operationRoot], 'intent-preparing-cleaned');
          continue;
        }
        if (!MEDIA_OPERATION_PATTERN.test(entry.name)) throw new Error(MEDIA_RECOVERY_ERROR);
        pending.push(await readPublishedIntent(path));
      }

      const readMedia = connection.prepare(`
        SELECT relative_path, content_type, size_bytes, sha256
        FROM media_assets
        WHERE id = ?
      `);
      try {
        for (const intent of pending) {
          if (intent.value.kind === 'create') {
            const row = parseRecoveryMediaMetadata(
              readMedia.get(intent.value.mediaId),
              intent.value.mediaId,
              intent.value.activePath,
            );
            const activePath = absoluteMetadataPath(intent.value.activePath);
            const stagedPath = absoluteMetadataPath(intent.value.stagedPath);
            const activeExists = pathExists(activePath);
            const stagedExists = pathExists(stagedPath);
            if (row) {
              if (!activeExists && stagedExists) {
                await assertRecoveryBytes(stagedPath, stagingRoot, row);
                await publishIdentity(stagedPath, activePath, intent.value.mediaId, false);
                await assertRecoveryBytes(activePath, mediaRoot, row);
              } else if (activeExists && !stagedExists) {
                await assertRecoveryBytes(activePath, mediaRoot, row);
              } else {
                throw new Error(MEDIA_RECOVERY_ERROR);
              }
            } else {
              await removeIfPresent(activePath, mediaRoot);
              await removeIfPresent(stagedPath, stagingRoot);
            }
          } else {
            for (const item of intent.value.items) {
              const row = parseRecoveryMediaMetadata(
                readMedia.get(item.mediaId),
                item.mediaId,
                item.activePath,
              );
              const activePath = absoluteMetadataPath(item.activePath);
              const trashPath = absoluteMetadataPath(item.trashPath);
              const activeExists = pathExists(activePath);
              const trashExists = pathExists(trashPath);
              if (row) {
                if (extname(item.trashPath) !== extname(row.relativePath)) {
                  throw new Error(MEDIA_RECOVERY_ERROR);
                }
                if (!activeExists && trashExists) {
                  await assertRecoveryBytes(trashPath, trashRoot, row);
                  await restoreDeleteItems([item]);
                  await assertRecoveryBytes(activePath, mediaRoot, row);
                } else if (activeExists && !trashExists) {
                  await assertRecoveryBytes(activePath, mediaRoot, row);
                } else {
                  throw new Error(MEDIA_RECOVERY_ERROR);
                }
              } else if (activeExists && !trashExists) {
                await moveTrashItem(item);
              } else if (activeExists || !trashExists) {
                throw new Error(MEDIA_RECOVERY_ERROR);
              }
            }
          }
          await syncDirectories([mediaRoot, stagingRoot, trashRoot], 'recovery-applied');
          await clearIntent(intent);
        }
        await announce('recovery-complete');
      } catch (error) {
        if (error instanceof Error && error.message === MEDIA_RECOVERY_ERROR) throw error;
        throw new Error(MEDIA_RECOVERY_ERROR, { cause: error });
      }
    },
  };
}
