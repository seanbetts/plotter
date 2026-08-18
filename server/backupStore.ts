import { randomUUID } from 'node:crypto';
import { constants, existsSync, linkSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { assertDatabaseIntegrity } from './database';

const AUTOMATIC_BACKUP_ERROR_MESSAGE = 'Automatic database backup failed.';
const AUTOMATIC_BACKUP_RETENTION = 5;

export class AutomaticBackupError extends Error {
  constructor() {
    super(AUTOMATIC_BACKUP_ERROR_MESSAGE);
    this.name = 'AutomaticBackupError';
  }
}

export type BackupStore = {
  createAutomaticBackup(connection: DatabaseSync, revision: number): Promise<string>;
};

export type BackupStoreOptions = {
  removeAutomaticBackup?: (path: string) => void;
  syncDirectory?: (
    path: string,
    phase: AutomaticBackupSyncPhase,
  ) => Promise<void> | void;
};

export type AutomaticBackupSyncPhase =
  | 'backup-directory-created'
  | 'backup-published'
  | 'backup-rotation-staged'
  | 'backup-rotated'
  | 'backup-rotation-rolled-back'
  | 'backup-rotation-cleaned'
  | 'backup-rolled-back';

function filenameTimestamp(date: Date): string {
  return date.toISOString().replaceAll(/[-:.]/g, '');
}

function removeBackupArtifacts(path: string): void {
  for (const candidate of [path, `${path}-shm`, `${path}-wal`]) {
    try {
      rmSync(candidate, { force: true });
    } catch {
      // Cleanup is best effort; callers still receive the stable backup error.
    }
  }
}

function automaticBackupsPastRetention(
  backupsDirectory: string,
): Array<{ name: string; path: string }> {
  const automaticBackups = readdirSync(backupsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^automatic-.*\.sqlite3$/.test(entry.name))
    .map((entry) => {
      const path = join(backupsDirectory, entry.name);
      return { name: entry.name, path, modifiedAt: statSync(path).mtimeMs };
    })
    .sort((left, right) => right.modifiedAt - left.modifiedAt || right.name.localeCompare(left.name));

  return automaticBackups.slice(AUTOMATIC_BACKUP_RETENTION);
}

async function syncDirectory(path: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    if (!(await handle.stat()).isDirectory()) throw new Error('Backup directory is invalid.');
    await handle.sync();
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export function createBackupStore(
  backupsDirectory: string,
  options: BackupStoreOptions = {},
): BackupStore {
  const removeAutomaticBackup = options.removeAutomaticBackup ?? ((path: string) => rmSync(path));
  const syncBackupDirectory = options.syncDirectory ?? (async (path: string) => syncDirectory(path));

  async function rotateAutomaticBackups(backupsDirectory: string, operationId: string): Promise<void> {
    const expiredBackups = automaticBackupsPastRetention(backupsDirectory);
    if (expiredBackups.length === 0) return;
    const safeguards = expiredBackups.map((expired, index) => ({
      ...expired,
      safeguardPath: join(backupsDirectory, `.rotation-${operationId}-${index}.sqlite3`),
    }));
    try {
      for (const item of safeguards) linkSync(item.path, item.safeguardPath);
      await syncBackupDirectory(backupsDirectory, 'backup-rotation-staged');
      for (const item of safeguards) removeAutomaticBackup(item.path);
      await syncBackupDirectory(backupsDirectory, 'backup-rotated');
    } catch (error) {
      try {
        for (const item of safeguards) {
          if (!existsSync(item.path) && existsSync(item.safeguardPath)) {
            linkSync(item.safeguardPath, item.path);
          }
        }
        for (const item of safeguards) rmSync(item.safeguardPath, { force: true });
        await syncBackupDirectory(backupsDirectory, 'backup-rotation-rolled-back');
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          'Automatic backup rotation failed and could not be rolled back.',
          { cause: rollbackError },
        );
      }
      throw error;
    }
    try {
      for (const item of safeguards) rmSync(item.safeguardPath, { force: true });
      await syncBackupDirectory(backupsDirectory, 'backup-rotation-cleaned');
    } catch {
      // Public backup names and the new backup are already durable. A hidden
      // safeguard may remain as conservative redundant evidence.
    }
  }

  return {
    async createAutomaticBackup(connection, revision) {
      const identifier = randomUUID();
      const stem = `automatic-${revision}-${filenameTimestamp(new Date())}-${identifier}`;
      const temporaryPath = join(backupsDirectory, `.${stem}.tmp`);
      const finalPath = join(backupsDirectory, `${stem}.sqlite3`);
      let validationConnection: DatabaseSync | undefined;
      let finalCreated = false;

      try {
        const backupDirectoryExisted = existsSync(backupsDirectory);
        mkdirSync(backupsDirectory, { recursive: true });
        if (!backupDirectoryExisted) {
          await syncBackupDirectory(dirname(backupsDirectory), 'backup-directory-created');
        }
        await backup(connection, temporaryPath);
        validationConnection = new DatabaseSync(temporaryPath, { readOnly: true });
        assertDatabaseIntegrity(validationConnection);
        validationConnection.close();
        validationConnection = undefined;
        rmSync(`${temporaryPath}-shm`, { force: true });
        rmSync(`${temporaryPath}-wal`, { force: true });
        renameSync(temporaryPath, finalPath);
        finalCreated = true;
        await syncBackupDirectory(backupsDirectory, 'backup-published');
        await rotateAutomaticBackups(backupsDirectory, identifier);
        return finalPath;
      } catch {
        try {
          validationConnection?.close();
        } catch {
          // Preserve the stable backup error.
        }
        if (finalCreated) {
          removeBackupArtifacts(finalPath);
          await Promise.resolve(
            syncBackupDirectory(backupsDirectory, 'backup-rolled-back'),
          ).catch(() => undefined);
        }
        removeBackupArtifacts(temporaryPath);
        throw new AutomaticBackupError();
      }
    },
  };
}
