import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { TripStorageConflictError, type RevisionEvent } from '../src/storage/revision';
import type { BackupStore } from './backupStore';
import { openPlotterDatabase, type PlotterDatabase } from './database';
import { createRevisionEventBus } from './events';
import { createWriteCoordinator } from './writeCoordinator';

const temporaryDirectories: string[] = [];
const openDatabases: PlotterDatabase[] = [];

function createDatabase(): PlotterDatabase {
  const directory = mkdtempSync(join(tmpdir(), 'plotter-writes-'));
  temporaryDirectories.push(directory);
  const database = openPlotterDatabase(join(directory, 'plotter.sqlite3'));
  openDatabases.push(database);
  return database;
}

function seedTrip(connection: DatabaseSync, tripId: string, revision: number): void {
  connection.prepare(`
    INSERT INTO trips (
      id, owner_user_id, name, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?)
  `).run(tripId, 'source-user', 'Aurora', '2026-08-17T10:00:00.000Z', '2026-08-17T10:00:00.000Z');
  connection.prepare('INSERT INTO trip_revisions (trip_id, revision) VALUES (?, ?)')
    .run(tripId, revision);
}

function successfulBackup(onBackup?: (revision: number) => void): BackupStore {
  return {
    async createAutomaticBackup(_connection, revision) {
      onBackup?.(revision);
      return '/disposable/automatic.sqlite3';
    },
  };
}

afterEach(() => {
  for (const database of openDatabases.splice(0)) {
    database.close();
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('createWriteCoordinator', () => {
  it('serializes backup, mutation, commit, and publication in process order', async () => {
    const database = createDatabase();
    const order: string[] = [];
    let releaseFirstBackup: (() => void) | undefined;
    const firstBackupGate = new Promise<void>((resolve) => {
      releaseFirstBackup = resolve;
    });
    let backupNumber = 0;
    const backups: BackupStore = {
      async createAutomaticBackup(_connection, revision) {
        backupNumber += 1;
        const number = backupNumber;
        order.push(`backup-start:${number}:revision-${revision}`);
        if (number === 1) await firstBackupGate;
        order.push(`backup-end:${number}`);
        return `/disposable/automatic-${number}.sqlite3`;
      },
    };
    const events = createRevisionEventBus();
    events.subscribe((event) => {
      if (event.kind === 'revision') order.push(`event:${event.revision}`);
    });
    const writes = createWriteCoordinator(database, backups, events);

    const first = writes.run({ kind: 'directory', expectedRevision: 0 }, () => {
      order.push('mutation:1');
      return 'first';
    });
    const second = writes.run({ kind: 'directory', expectedRevision: 1 }, () => {
      order.push('mutation:2');
      return 'second';
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(order).toEqual(['backup-start:1:revision-0']);
    releaseFirstBackup?.();
    await expect(Promise.all([first, second])).resolves.toEqual([
      { value: 'first', revision: 1 },
      { value: 'second', revision: 2 },
    ]);
    expect(order).toEqual([
      'backup-start:1:revision-0',
      'backup-end:1',
      'mutation:1',
      'event:1',
      'backup-start:2:revision-1',
      'backup-end:2',
      'mutation:2',
      'event:2',
    ]);
  });

  it('does not begin mutation when the backup fails', async () => {
    const database = createDatabase();
    let mutated = false;
    const events: RevisionEvent[] = [];
    const bus = createRevisionEventBus({ initialEpoch: '00000000-0000-4000-8000-000000000001' });
    bus.subscribe((event) => events.push(event));
    const writes = createWriteCoordinator(database, {
      async createAutomaticBackup() {
        throw new Error('backup unavailable');
      },
    }, bus);

    await expect(writes.run({ kind: 'directory', expectedRevision: 0 }, () => {
      mutated = true;
    })).rejects.toThrow('backup unavailable');

    expect(mutated).toBe(false);
    expect(database.connection.prepare(
      'SELECT directory_revision FROM store_metadata WHERE singleton = 1',
    ).get()).toEqual({ directory_revision: 0 });
    expect(events).toEqual([]);
  });

  it('throws the current revision for a stale write without mutation, increment, or event', async () => {
    const database = createDatabase();
    database.connection.prepare(
      'UPDATE store_metadata SET directory_revision = 2 WHERE singleton = 1',
    ).run();
    const backedUpRevisions: number[] = [];
    const events: RevisionEvent[] = [];
    const bus = createRevisionEventBus();
    bus.subscribe((event) => events.push(event));
    const writes = createWriteCoordinator(database, successfulBackup((revision) => {
      backedUpRevisions.push(revision);
    }), bus);
    let mutated = false;

    const error = await writes.run({ kind: 'directory', expectedRevision: 1 }, () => {
      mutated = true;
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(TripStorageConflictError);
    expect((error as TripStorageConflictError).currentRevision).toBe(2);
    expect(backedUpRevisions).toEqual([2]);
    expect(mutated).toBe(false);
    expect(database.connection.prepare(
      'SELECT directory_revision FROM store_metadata WHERE singleton = 1',
    ).get()).toEqual({ directory_revision: 2 });
    expect(events).toEqual([]);
  });

  it('increments the scoped revision exactly once and emits only after commit', async () => {
    const database = createDatabase();
    seedTrip(database.connection, 'trip-aurora', 4);
    const observed: Array<{ event: RevisionEvent; committedRevision: number }> = [];
    const bus = createRevisionEventBus({ initialEpoch: '00000000-0000-4000-8000-000000000001' });
    bus.subscribe((event) => {
      const committedRevision = event.scope === 'directory'
        ? (database.connection.prepare(
            'SELECT directory_revision FROM store_metadata WHERE singleton = 1',
          ).get() as { directory_revision: number }).directory_revision
        : (database.connection.prepare(
            'SELECT revision FROM trip_revisions WHERE trip_id = ?',
          ).get(event.tripId) as { revision: number }).revision;
      observed.push({ event, committedRevision });
    });
    const writes = createWriteCoordinator(database, successfulBackup(), bus);

    await expect(writes.run({ kind: 'directory', expectedRevision: 0 }, () => 'directory'))
      .resolves.toEqual({ value: 'directory', revision: 1 });
    await expect(writes.run({ kind: 'trip', tripId: 'trip-aurora', expectedRevision: 4 }, () => 'trip'))
      .resolves.toEqual({ value: 'trip', revision: 5 });

    expect(observed).toEqual([
      {
        event: {
          kind: 'revision', epoch: '00000000-0000-4000-8000-000000000001',
          scope: 'directory', revision: 1,
        },
        committedRevision: 1,
      },
      {
        event: {
          kind: 'revision', epoch: '00000000-0000-4000-8000-000000000001',
          scope: 'trip', tripId: 'trip-aurora', revision: 5,
        },
        committedRevision: 5,
      },
    ]);
  });

  it('rolls back callback mutations and retains the revision without publishing', async () => {
    const database = createDatabase();
    const events: RevisionEvent[] = [];
    const bus = createRevisionEventBus();
    bus.subscribe((event) => events.push(event));
    const writes = createWriteCoordinator(database, successfulBackup(), bus);

    await expect(writes.run({ kind: 'directory', expectedRevision: 0 }, (connection) => {
      connection.prepare(`
        INSERT INTO trips (id, owner_user_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('trip-rollback', 'source-user', 'Rollback', '2026-08-17T10:00:00.000Z', '2026-08-17T10:00:00.000Z');
      throw new Error('mutation failed');
    })).rejects.toThrow('mutation failed');

    expect(database.connection.prepare('SELECT COUNT(*) AS count FROM trips').get()).toEqual({ count: 0 });
    expect(database.connection.prepare(
      'SELECT directory_revision FROM store_metadata WHERE singleton = 1',
    ).get()).toEqual({ directory_revision: 0 });
    expect(events).toEqual([]);
  });

  it('rolls back a failed commit and emits nothing', async () => {
    const database = createDatabase();
    const events: RevisionEvent[] = [];
    const bus = createRevisionEventBus();
    bus.subscribe((event) => events.push(event));
    const writes = createWriteCoordinator(database, successfulBackup(), bus);

    await expect(writes.run({ kind: 'directory', expectedRevision: 0 }, (connection) => {
      connection.exec('PRAGMA defer_foreign_keys = ON');
      connection.prepare(
        'UPDATE store_metadata SET accepted_import_id = ? WHERE singleton = 1',
      ).run('missing-import');
    })).rejects.toThrow();

    expect(database.connection.prepare(
      'SELECT directory_revision, accepted_import_id FROM store_metadata WHERE singleton = 1',
    ).get()).toEqual({ directory_revision: 0, accepted_import_id: null });
    expect(events).toEqual([]);
  });
});
