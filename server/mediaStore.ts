import { createHash, randomUUID } from 'node:crypto';
import {
  constants,
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { open, realpath, rename, unlink } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

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
};

export type AtomicMediaStore = MediaStore & {
  /** Removes bytes created by an operation whose metadata never committed. */
  discard(relativePath: string): Promise<void>;
};

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
  if (!/^[A-Za-z0-9_-]+$/.test(mediaId)) throw new Error('Media identity is invalid.');
}

async function resolveExistingContainedPath(
  path: string,
  root: string,
): Promise<string> {
  try {
    const canonical = await realpath(path);
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

export function createMediaStore(dataDirectory: string): AtomicMediaStore {
  if (!existsSync(dataDirectory)) mkdirSync(dataDirectory, { recursive: true });
  const dataRoot = realpathSync(dataDirectory);
  const mediaPath = join(dataRoot, 'media');
  const mediaRoot = ensureContainedDirectory(mediaPath, dataRoot);
  const stagingRoot = ensureContainedDirectory(join(mediaRoot, '.staging'), mediaRoot);
  const trashRoot = ensureContainedDirectory(join(dataRoot, 'trash'), dataRoot);

  function absoluteMetadataPath(relativePath: string): string {
    if (isAbsolute(relativePath)) throw new Error(CONTAINMENT_ERROR);
    const absolute = resolve(dataRoot, relativePath);
    assertContained(absolute, dataRoot);
    return absolute;
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
        if (discardSourceOnCollision) await unlink(sourcePath);
        throw new Error('Media identity already exists.');
      }
      await rename(sourcePath, targetPath);
    });
  }

  return {
    async stage(input, contentType) {
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
      let complete = false;

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
        complete = true;
        return {
          relativePath,
          byteCount,
          sha256: hash.digest('hex'),
          contentType,
        };
      } catch (error) {
        try {
          await reader.cancel(error);
        } catch {
          // Preserve the stream, validation, or filesystem failure.
        }
        throw error;
      } finally {
        await handle.close();
        reader.releaseLock();
        if (!complete) await unlink(temporaryPath).catch(() => undefined);
      }
    },

    async commit(staged, mediaId) {
      assertMediaId(mediaId);
      const extension = extensionFor(staged.contentType);
      const stagedPath = absoluteMetadataPath(staged.relativePath);
      const canonicalStagedPath = await resolveExistingContainedPath(stagedPath, stagingRoot);
      if (dirname(canonicalStagedPath) !== stagingRoot || extname(canonicalStagedPath) !== '.tmp') {
        throw new Error(CONTAINMENT_ERROR);
      }
      const digest = await digestFile(canonicalStagedPath);
      if (digest.byteCount !== staged.byteCount || digest.sha256 !== staged.sha256) {
        await unlink(canonicalStagedPath);
        throw new Error('Staged media does not match its validated digest.');
      }

      const activePath = join(mediaRoot, `${mediaId}.${extension}`);
      assertContained(await realpath(dirname(activePath)), mediaRoot);
      await publishIdentity(canonicalStagedPath, activePath, mediaId, true);
      return { ...staged, relativePath: relative(dataRoot, activePath) };
    },

    async moveToTrash(relativePath, mediaId) {
      assertMediaId(mediaId);
      const activePath = absoluteMetadataPath(relativePath);
      const canonicalActivePath = await resolveActivePath(relativePath);
      const extension = extname(canonicalActivePath);
      const trashedPath = join(trashRoot, `${mediaId}-${randomUUID()}${extension}`);
      await assertCanonicalDirectory(trashRoot, dataRoot);
      await rename(canonicalActivePath, trashedPath);
      let restored = false;

      return async () => {
        if (restored) return;
        const canonicalTrashPath = await resolveExistingContainedPath(trashedPath, trashRoot);
        assertContained(await realpath(dirname(activePath)), mediaRoot);
        await publishIdentity(canonicalTrashPath, activePath, mediaId, false);
        restored = true;
      };
    },

    async discard(relativePath) {
      await unlink(await resolveActivePath(relativePath));
    },
  };
}
