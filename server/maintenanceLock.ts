import { randomUUID } from 'node:crypto';
import {
  constants,
  closeSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  realpathSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';

export const DATA_DIRECTORY_LOCK_FILENAME = '.plotter-storage-owner.lock';
const OWNED_MESSAGE = 'Plotter data directory is already owned by another process.';
const INVALID_MESSAGE = 'Plotter data directory ownership lock is invalid.';

export type DataDirectoryOwner = 'service' | 'supabase-migration';

export type DataDirectoryOwnership = {
  path: string;
  release(): void;
};

function syncDirectory(path: string): void {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

export function acquireDataDirectoryOwnership(
  dataDirectory: string,
  owner: DataDirectoryOwner,
): DataDirectoryOwnership {
  const root = realpathSync(dataDirectory);
  const rootMetadata = lstatSync(root);
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) throw new Error(INVALID_MESSAGE);
  const path = join(root, DATA_DIRECTORY_LOCK_FILENAME);
  let descriptor: number;
  try {
    descriptor = openSync(
      path,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(OWNED_MESSAGE, { cause: error });
    }
    throw new Error(INVALID_MESSAGE, { cause: error });
  }
  const token = randomUUID();
  try {
    writeSync(descriptor, JSON.stringify({ formatVersion: 1, owner, pid: process.pid, token }));
    fsyncSync(descriptor);
    syncDirectory(root);
  } catch {
    try { closeSync(descriptor); } catch { /* Keep the original lock error. */ }
    try { unlinkSync(path); } catch { /* A retained lock fails closed. */ }
    throw new Error(INVALID_MESSAGE);
  }
  const identity = fstatSync(descriptor);
  let released = false;
  return {
    path,
    release() {
      if (released) return;
      const current = lstatSync(path);
      if (
        current.isSymbolicLink()
        || !current.isFile()
        || current.dev !== identity.dev
        || current.ino !== identity.ino
      ) throw new Error(INVALID_MESSAGE);
      closeSync(descriptor);
      unlinkSync(path);
      syncDirectory(root);
      released = true;
    },
  };
}
