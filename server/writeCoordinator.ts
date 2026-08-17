import type { DatabaseSync } from 'node:sqlite';
import { TripStorageConflictError, type RevisionChange } from '../src/storage/revision';
import type { BackupStore } from './backupStore';
import type { PlotterDatabase } from './database';
import type { RevisionEventBus } from './events';

export type WriteScope =
  | { kind: 'directory'; expectedRevision: number }
  | { kind: 'trip'; tripId: string; expectedRevision: number };

export type WriteCoordinator = {
  run<T>(
    scope: WriteScope,
    mutate: (connection: DatabaseSync) => T,
  ): Promise<{ value: T; revision: number }>;
};

function readRevision(connection: DatabaseSync, scope: WriteScope): number {
  if (scope.kind === 'directory') {
    const row = connection.prepare(`
      SELECT directory_revision
      FROM store_metadata
      WHERE singleton = 1
    `).get() as { directory_revision?: unknown } | undefined;
    if (typeof row?.directory_revision !== 'number') {
      throw new Error('Directory revision is unavailable.');
    }
    return row.directory_revision;
  }

  const row = connection.prepare(`
    SELECT revision
    FROM trip_revisions
    WHERE trip_id = ?
  `).get(scope.tripId) as { revision?: unknown } | undefined;
  if (typeof row?.revision !== 'number') {
    throw new Error('Trip revision is unavailable.');
  }
  return row.revision;
}

function incrementRevision(connection: DatabaseSync, scope: WriteScope, revision: number): void {
  const result = scope.kind === 'directory'
    ? connection.prepare(`
        UPDATE store_metadata
        SET directory_revision = ?
        WHERE singleton = 1
      `).run(revision)
    : connection.prepare(`
        UPDATE trip_revisions
        SET revision = ?
        WHERE trip_id = ?
      `).run(revision, scope.tripId);

  if (result.changes !== 1) {
    throw new Error(scope.kind === 'directory'
      ? 'Directory revision is unavailable.'
      : 'Trip revision is unavailable.');
  }
}

function revisionEvent(scope: WriteScope, revision: number): RevisionChange {
  return scope.kind === 'directory'
    ? { scope: 'directory', revision }
    : { scope: 'trip', tripId: scope.tripId, revision };
}

export function createWriteCoordinator(
  database: PlotterDatabase,
  backups: BackupStore,
  events: RevisionEventBus,
): WriteCoordinator {
  const connection = database.connection;
  let writeTail = Promise.resolve();

  async function execute<T>(
    scope: WriteScope,
    mutate: (transactionConnection: DatabaseSync) => T,
  ): Promise<{ value: T; revision: number }> {
    const backupRevision = readRevision(connection, scope);
    await backups.createAutomaticBackup(connection, backupRevision);

    let transactionOpen = false;
    try {
      connection.exec('BEGIN IMMEDIATE');
      transactionOpen = true;
      const currentRevision = readRevision(connection, scope);
      if (currentRevision !== scope.expectedRevision) {
        throw new TripStorageConflictError(currentRevision);
      }

      const value = mutate(connection);
      const revision = currentRevision + 1;
      incrementRevision(connection, scope, revision);
      connection.exec('COMMIT');
      transactionOpen = false;
      events.publish(revisionEvent(scope, revision));
      return { value, revision };
    } catch (error) {
      if (transactionOpen) {
        try {
          connection.exec('ROLLBACK');
        } catch {
          // Preserve the mutation, conflict, or commit failure.
        }
      }
      throw error;
    }
  }

  return {
    run<T>(scope: WriteScope, mutate: (connection: DatabaseSync) => T) {
      const result = writeTail.then(() => execute(scope, mutate));
      writeTail = result.then(() => undefined, () => undefined);
      return result;
    },
  };
}
