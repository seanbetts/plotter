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
  runPrepared<P, T>(
    scope: WriteScope,
    prepare: (connection: DatabaseSync) => Promise<WritePreparation<P>>,
    mutate: (connection: DatabaseSync, prepared: P) => T,
  ): Promise<{ value: T; revision: number }>;
};

export type WritePreparation<T> = {
  value: T;
  rollback?(): Promise<void> | void;
  finalize?(): Promise<void> | void;
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

  function assertExpectedRevision(scope: WriteScope): number {
    const revision = readRevision(connection, scope);
    if (revision !== scope.expectedRevision) {
      throw new TripStorageConflictError(revision);
    }
    return revision;
  }

  async function execute<P, T>(
    scope: WriteScope,
    prepare: ((connection: DatabaseSync) => Promise<WritePreparation<P>>) | undefined,
    mutate: (transactionConnection: DatabaseSync, prepared: P | undefined) => T,
  ): Promise<{ value: T; revision: number }> {
    const acceptedRevision = assertExpectedRevision(scope);
    await backups.createAutomaticBackup(connection, acceptedRevision);
    assertExpectedRevision(scope);

    let transactionOpen = false;
    let committed = false;
    let preparation: WritePreparation<P> | undefined;
    try {
      preparation = await prepare?.(connection);
      connection.exec('BEGIN IMMEDIATE');
      transactionOpen = true;
      const currentRevision = assertExpectedRevision(scope);

      const value = mutate(connection, preparation?.value);
      const revision = currentRevision + 1;
      incrementRevision(connection, scope, revision);
      connection.exec('COMMIT');
      transactionOpen = false;
      committed = true;
      try {
        await preparation?.finalize?.();
      } catch {
        // The database and filesystem mutation already committed. A retained
        // durable preparation record is reconciled on the next startup.
      }
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
      if (!committed && preparation?.rollback) {
        try {
          await preparation.rollback();
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            'The write failed and its prepared filesystem changes could not be rolled back.',
            { cause: rollbackError },
          );
        }
      }
      throw error;
    }
  }

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = writeTail.then(operation);
    writeTail = result.then(() => undefined, () => undefined);
    return result;
  }

  return {
    run<T>(scope: WriteScope, mutate: (connection: DatabaseSync) => T) {
      return enqueue(() => execute<never, T>(scope, undefined, (transactionConnection) => (
        mutate(transactionConnection)
      )));
    },
    runPrepared<P, T>(
      scope: WriteScope,
      prepare: (connection: DatabaseSync) => Promise<WritePreparation<P>>,
      mutate: (connection: DatabaseSync, prepared: P) => T,
    ) {
      return enqueue(() => execute(scope, prepare, (transactionConnection, prepared) => (
        mutate(transactionConnection, prepared as P)
      )));
    },
  };
}
