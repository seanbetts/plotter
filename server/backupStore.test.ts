import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { openPlotterDatabase } from './database';
import { createBackupStore } from './backupStore';

const temporaryDirectories: string[] = [];

function createFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'plotter-backup-'));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, 'plotter.sqlite3');
  const database = openPlotterDatabase(databasePath);
  return {
    backupDirectory: join(directory, 'backups'),
    database,
    databasePath,
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('createBackupStore', () => {
  it('creates a validated online backup containing committed WAL data', async () => {
    const fixture = createFixture();
    fixture.database.connection.prepare(`
      INSERT INTO trips (
        id, owner_user_id, name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?)
    `).run('trip-aurora', 'source-user', 'Aurora', '2026-08-17T10:00:00.000Z', '2026-08-17T10:00:00.000Z');

    const backupPath = await createBackupStore(fixture.backupDirectory)
      .createAutomaticBackup(fixture.database.connection, 7);

    expect(basename(backupPath)).toMatch(/^automatic-7-.*\.sqlite3$/);
    expect(existsSync(backupPath)).toBe(true);
    const copy = new DatabaseSync(backupPath, { readOnly: true });
    expect(copy.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    expect(copy.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(copy.prepare('SELECT id, name FROM trips').all()).toEqual([
      { id: 'trip-aurora', name: 'Aurora' },
    ]);
    copy.close();
    fixture.database.close();

    expect(readFileSync(fixture.databasePath).byteLength).toBeGreaterThan(0);
  });

  it('retains only the five newest automatic backups and never rotates named backups', async () => {
    const fixture = createFixture();
    mkdirSync(fixture.backupDirectory);
    const automaticNames = Array.from({ length: 6 }, (_, index) => `automatic-old-${index}.sqlite3`);
    for (const [index, name] of automaticNames.entries()) {
      const path = join(fixture.backupDirectory, name);
      writeFileSync(path, `old-${index}`);
      const timestamp = new Date(`2026-08-17T10:0${index}:00.000Z`);
      utimesSync(path, timestamp, timestamp);
    }
    for (const name of ['pre-import-source.sqlite3', 'recovery-before-restore.sqlite3']) {
      writeFileSync(join(fixture.backupDirectory, name), name);
    }

    const createdPath = await createBackupStore(fixture.backupDirectory)
      .createAutomaticBackup(fixture.database.connection, 3);

    const remaining = readdirSync(fixture.backupDirectory).sort();
    expect(remaining.filter((name) => name.startsWith('automatic-'))).toHaveLength(5);
    expect(remaining).toContain(basename(createdPath));
    expect(remaining).not.toContain('automatic-old-0.sqlite3');
    expect(remaining).not.toContain('automatic-old-1.sqlite3');
    expect(remaining).toContain('automatic-old-5.sqlite3');
    expect(remaining).toContain('pre-import-source.sqlite3');
    expect(remaining).toContain('recovery-before-restore.sqlite3');
    fixture.database.close();
  });

  it('rejects an invalid backup before rotation and removes its temporary file', async () => {
    const fixture = createFixture();
    mkdirSync(fixture.backupDirectory);
    for (let index = 0; index < 6; index += 1) {
      writeFileSync(join(fixture.backupDirectory, `automatic-existing-${index}.sqlite3`), `${index}`);
    }
    const before = readdirSync(fixture.backupDirectory).sort();
    fixture.database.connection.exec('PRAGMA foreign_keys = OFF');
    fixture.database.connection.prepare(
      'INSERT INTO trip_revisions (trip_id, revision) VALUES (?, ?)',
    ).run('missing-trip', 0);

    await expect(
      createBackupStore(fixture.backupDirectory)
        .createAutomaticBackup(fixture.database.connection, 0),
    ).rejects.toThrow('Automatic database backup failed.');

    expect(readdirSync(fixture.backupDirectory).sort()).toEqual(before);
    fixture.database.close();
  });

  it('removes the new backup when post-rename rotation fails', async () => {
    const fixture = createFixture();
    mkdirSync(fixture.backupDirectory);
    const automaticNames = Array.from({ length: 5 }, (_, index) => `automatic-retained-${index}.sqlite3`);
    for (const [index, name] of automaticNames.entries()) {
      const path = join(fixture.backupDirectory, name);
      writeFileSync(path, `retained-${index}`);
      const timestamp = new Date(`2026-08-17T10:0${index}:00.000Z`);
      utimesSync(path, timestamp, timestamp);
    }
    writeFileSync(join(fixture.backupDirectory, 'pre-operation.sqlite3'), 'named');
    const before = readdirSync(fixture.backupDirectory).sort();

    await expect(createBackupStore(fixture.backupDirectory, {
      removeAutomaticBackup(path) {
        if (basename(path) === 'automatic-retained-0.sqlite3') {
          throw new Error(`cannot remove ${path}`);
        }
        rmSync(path);
      },
    }).createAutomaticBackup(fixture.database.connection, 5))
      .rejects.toThrow('Automatic database backup failed.');

    expect(readdirSync(fixture.backupDirectory).sort()).toEqual(before);
    fixture.database.close();
  });

  it('restores every prior backup when a later rotation removal fails', async () => {
    const fixture = createFixture();
    mkdirSync(fixture.backupDirectory);
    const automaticNames = Array.from({ length: 6 }, (_, index) => `automatic-retained-${index}.sqlite3`);
    for (const [index, name] of automaticNames.entries()) {
      const path = join(fixture.backupDirectory, name);
      writeFileSync(path, `retained-${index}`);
      const timestamp = new Date(`2026-08-17T10:0${index}:00.000Z`);
      utimesSync(path, timestamp, timestamp);
    }
    const before = readdirSync(fixture.backupDirectory).sort();
    let removals = 0;

    await expect(createBackupStore(fixture.backupDirectory, {
      removeAutomaticBackup(path) {
        removals += 1;
        if (removals === 2) throw new Error('forced second rotation failure');
        rmSync(path);
      },
    }).createAutomaticBackup(fixture.database.connection, 6))
      .rejects.toThrow('Automatic database backup failed.');

    expect(removals).toBe(2);
    expect(readdirSync(fixture.backupDirectory).sort()).toEqual(before);
    fixture.database.close();
  });

  it('restores the prior backup set when rotation directory sync fails', async () => {
    const fixture = createFixture();
    mkdirSync(fixture.backupDirectory);
    const automaticNames = Array.from({ length: 5 }, (_, index) => `automatic-retained-${index}.sqlite3`);
    for (const [index, name] of automaticNames.entries()) {
      const path = join(fixture.backupDirectory, name);
      writeFileSync(path, `retained-${index}`);
      const timestamp = new Date(`2026-08-17T10:0${index}:00.000Z`);
      utimesSync(path, timestamp, timestamp);
    }
    const before = readdirSync(fixture.backupDirectory).sort();

    await expect(createBackupStore(fixture.backupDirectory, {
      async syncDirectory(_path, phase) {
        if (phase === 'backup-rotated') throw new Error('forced rotation sync failure');
      },
    }).createAutomaticBackup(fixture.database.connection, 5))
      .rejects.toThrow('Automatic database backup failed.');

    expect(readdirSync(fixture.backupDirectory).sort()).toEqual(before);
    fixture.database.close();
  });

  it('reports filesystem failures without exposing a path', async () => {
    const fixture = createFixture();
    writeFileSync(fixture.backupDirectory, 'not a directory');

    const error = await createBackupStore(fixture.backupDirectory)
      .createAutomaticBackup(fixture.database.connection, 0)
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Automatic database backup failed.');
    expect((error as Error).message).not.toContain(fixture.backupDirectory);
    fixture.database.close();
  });

  it('syncs the backup directory after canonical publication before reporting success', async () => {
    const fixture = createFixture();
    const phases: string[] = [];

    const backupPath = await createBackupStore(fixture.backupDirectory, {
      async syncDirectory(path, phase) {
        if (phase === 'backup-published') {
          expect(path).toBe(fixture.backupDirectory);
          expect(readdirSync(path).some((name) => /^automatic-.*\.sqlite3$/.test(name)))
            .toBe(true);
        }
        phases.push(phase);
      },
    }).createAutomaticBackup(fixture.database.connection, 0);

    expect(existsSync(backupPath)).toBe(true);
    expect(phases).toContain('backup-published');
    fixture.database.close();
  });

  it('rolls back a canonical backup whose parent-directory sync fails', async () => {
    const fixture = createFixture();
    mkdirSync(fixture.backupDirectory);
    writeFileSync(join(fixture.backupDirectory, 'pre-operation.sqlite3'), 'named');

    await expect(createBackupStore(fixture.backupDirectory, {
      async syncDirectory(_path, phase) {
        if (phase === 'backup-published') throw new Error('forced directory sync failure');
      },
    }).createAutomaticBackup(fixture.database.connection, 0)).rejects.toThrow(
      'Automatic database backup failed.',
    );

    expect(readdirSync(fixture.backupDirectory)).toEqual(['pre-operation.sqlite3']);
    fixture.database.close();
  });
});
