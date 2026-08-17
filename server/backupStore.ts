import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
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

function rotateAutomaticBackups(backupsDirectory: string): void {
  const automaticBackups = readdirSync(backupsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^automatic-.*\.sqlite3$/.test(entry.name))
    .map((entry) => {
      const path = join(backupsDirectory, entry.name);
      return { name: entry.name, path, modifiedAt: statSync(path).mtimeMs };
    })
    .sort((left, right) => right.modifiedAt - left.modifiedAt || right.name.localeCompare(left.name));

  for (const expired of automaticBackups.slice(AUTOMATIC_BACKUP_RETENTION)) {
    rmSync(expired.path);
  }
}

export function createBackupStore(backupsDirectory: string): BackupStore {
  return {
    async createAutomaticBackup(connection, revision) {
      const identifier = randomUUID();
      const stem = `automatic-${revision}-${filenameTimestamp(new Date())}-${identifier}`;
      const temporaryPath = join(backupsDirectory, `.${stem}.tmp`);
      const finalPath = join(backupsDirectory, `${stem}.sqlite3`);
      let validationConnection: DatabaseSync | undefined;

      try {
        mkdirSync(backupsDirectory, { recursive: true });
        await backup(connection, temporaryPath);
        validationConnection = new DatabaseSync(temporaryPath, { readOnly: true });
        assertDatabaseIntegrity(validationConnection);
        validationConnection.close();
        validationConnection = undefined;
        rmSync(`${temporaryPath}-shm`, { force: true });
        rmSync(`${temporaryPath}-wal`, { force: true });
        renameSync(temporaryPath, finalPath);
        rotateAutomaticBackups(backupsDirectory);
        return finalPath;
      } catch {
        try {
          validationConnection?.close();
        } catch {
          // Preserve the stable backup error.
        }
        removeBackupArtifacts(temporaryPath);
        throw new AutomaticBackupError();
      }
    },
  };
}
