import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createDestination } from '../src/domain/destinations';
import type { RevisionEvent } from '../src/storage/revision';
import { openPlotterDatabase, type PlotterDatabase } from './database';
import { createSqliteDirectoryRepository } from './directoryRepository';
import { createRevisionEventBus } from './events';
import { createMediaStore } from './mediaStore';
import {
  PortableBackupCreateError,
  createPortableBackupOperations,
  recoverInterruptedPortableRestore,
  type PortableBackupDurability,
  type PortableBackupManifest,
} from './portableBackup';
import { createSqliteTripRepository } from './tripRepository';
import { createWriteCoordinator } from './writeCoordinator';

const temporaryDirectories: string[] = [];

function stream(value: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(value));
      controller.close();
    },
  });
}

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

type TarEntry = { path: string; bytes: Buffer; type?: string };

function tarNumber(value: number, width: number): Buffer {
  return Buffer.from(`${value.toString(8).padStart(width - 1, '0')}\0`, 'ascii');
}

function tarHeader(entry: TarEntry): Buffer {
  const header = Buffer.alloc(512);
  header.write(entry.path, 0, 100, 'utf8');
  tarNumber(0o600, 8).copy(header, 100);
  tarNumber(0, 8).copy(header, 108);
  tarNumber(0, 8).copy(header, 116);
  tarNumber(entry.bytes.byteLength, 12).copy(header, 124);
  tarNumber(0, 12).copy(header, 136);
  header.fill(0x20, 148, 156);
  header.write(entry.type ?? '0', 156, 1, 'ascii');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  tarNumber([...header].reduce((total, byte) => total + byte, 0), 8).copy(header, 148);
  return header;
}

function writeTar(path: string, entries: TarEntry[]): void {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    chunks.push(tarHeader(entry), entry.bytes);
    const padding = (512 - (entry.bytes.byteLength % 512)) % 512;
    if (padding) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(1024));
  writeFileSync(path, Buffer.concat(chunks));
}

function readTar(path: string): TarEntry[] {
  const archive = readFileSync(path);
  const entries: TarEntry[] = [];
  let offset = 0;
  while (offset + 512 <= archive.byteLength) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
    const size = Number.parseInt(header.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim() || '0', 8);
    const type = header.subarray(156, 157).toString('ascii') || '0';
    offset += 512;
    entries.push({
      path: prefix ? `${prefix}/${name}` : name,
      bytes: Buffer.from(archive.subarray(offset, offset + size)),
      type,
    });
    offset += size + ((512 - (size % 512)) % 512);
  }
  return entries;
}

function writeSelfConsistentMediaVariant(
  harness: ReturnType<typeof createHarness>,
  sourceBackupId: string,
  targetBackupId: string,
  input: { contentType: string; relativePath(mediaId: string): string },
): void {
  const entries = readTar(join(harness.dataDirectory, 'backups', `${sourceBackupId}.tar`));
  const manifest = JSON.parse(entries[0]!.bytes.toString('utf8')) as PortableBackupManifest;
  const databaseEntry = entries.find((entry) => entry.path === 'database/plotter.sqlite3')!;
  const mediaEntry = entries.find((entry) => entry.path.startsWith('media/'))!;
  const mediaId = mediaEntry.path.slice('media/'.length).replace(/\.[^.]+$/, '');
  const relativePath = input.relativePath(mediaId);
  const databasePath = join(harness.dataDirectory, `${targetBackupId}.sqlite3`);
  writeFileSync(databasePath, databaseEntry.bytes);
  const database = new DatabaseSync(databasePath);
  database.prepare(`
    UPDATE media_assets
    SET content_type = ?, relative_path = ?
    WHERE id = ?
  `).run(input.contentType, relativePath, mediaId);
  database.close();
  const databaseBytes = readFileSync(databasePath);
  const files = manifest.files.map((file) => {
    if (file.path === 'database/plotter.sqlite3') {
      return {
        path: file.path,
        byteCount: databaseBytes.byteLength,
        sha256: sha256(databaseBytes),
      };
    }
    return { ...file, path: relativePath };
  }).sort((left, right) => left.path.localeCompare(right.path));
  writeTar(join(harness.dataDirectory, 'backups', `${targetBackupId}.tar`), [
    { path: 'manifest.json', bytes: Buffer.from(JSON.stringify({ ...manifest, files })) },
    { path: 'database/plotter.sqlite3', bytes: databaseBytes },
    { ...mediaEntry, path: relativePath },
  ]);
}

function createHarness(input: {
  ids?: string[];
  durability?: PortableBackupDurability;
} = {}) {
  const dataDirectory = mkdtempSync(join(tmpdir(), 'plotter-portable-backup-'));
  temporaryDirectories.push(dataDirectory);
  const databasePath = join(dataDirectory, 'plotter.sqlite3');
  let database: PlotterDatabase | undefined = openPlotterDatabase(databasePath);
  let closeCount = 0;
  let openCount = 0;
  let failNextOpen = false;
  const emitted: RevisionEvent[] = [];
  const bus = createRevisionEventBus();
  bus.subscribe((event) => emitted.push(event));

  function repositories() {
    if (!database) throw new Error('Database is closed.');
    const media = createMediaStore(dataDirectory);
    const writes = createWriteCoordinator(database, {
      async createAutomaticBackup() { return join(dataDirectory, 'disposable-automatic.sqlite3'); },
    }, bus);
    return {
      directory: createSqliteDirectoryRepository(database, writes, media),
      media,
      trip(tripId: string) {
        if (!database) throw new Error('Database is closed.');
        return createSqliteTripRepository(database, writes, tripId, media);
      },
    };
  }

  const ids = input.ids ?? [
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000003',
  ];
  const operations = createPortableBackupOperations({
    dataDirectory,
    currentDatabase() {
      if (!database) throw new Error('Database is closed.');
      return database;
    },
    async closeStorage() {
      closeCount += 1;
      database?.close();
      database = undefined;
    },
    async openStorage() {
      openCount += 1;
      if (failNextOpen) {
        failNextOpen = false;
        throw new Error('controlled reopen failure');
      }
      database = openPlotterDatabase(databasePath);
    },
    publishRestoreReset(input) { bus.restoreReset(input); },
    durability: input.durability,
    now: () => new Date('2026-08-17T12:00:00.000Z'),
    randomId: () => ids.shift() ?? '00000000-0000-4000-8000-000000000099',
  });

  return {
    dataDirectory,
    databasePath,
    operations,
    emitted,
    repositories,
    database: () => database,
    closeCount: () => closeCount,
    openCount: () => openCount,
    failNextOpen() { failNextOpen = true; },
    close() { database?.close(); database = undefined; },
  };
}

async function seedTrip(harness: ReturnType<typeof createHarness>) {
  const repositories = harness.repositories();
  const created = await repositories.directory.create(0, { expectedRevision: 0, name: 'Original' });
  const trip = created.trip!;
  const destination = createDestination({
    name: 'Kyoto',
    coordinates: { lat: 35.0116, lng: 135.7681 },
  });
  const tripRepository = repositories.trip(trip.id);
  await tripRepository.mutate(0, { type: 'save-destination', destination });
  const media = await tripRepository.createDestinationMedia(1, destination.id, {
    bytes: stream('original image bytes'),
    contentType: 'image/png',
    caption: 'Original',
  });
  return { destination, directory: repositories.directory, media: media.mediaItem!, trip, tripRepository };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('portable backup creation and inspection', () => {
  it('streams one validated online database copy and only active media into a deterministic manifest', async () => {
    const harness = createHarness();
    const seeded = await seedTrip(harness);
    writeFileSync(join(harness.dataDirectory, '.env'), 'SECRET=do-not-copy');
    writeFileSync(join(harness.dataDirectory, 'credentials.json'), '{"token":"do-not-copy"}');
    writeFileSync(join(harness.dataDirectory, 'trash', 'deleted.png'), 'deleted');
    writeFileSync(join(harness.dataDirectory, 'disposable-automatic.sqlite3'), 'automatic');

    const summary = await harness.operations.create();
    const manifest = await harness.operations.inspect(summary.id);
    const archivePath = join(harness.dataDirectory, 'backups', `${summary.id}.tar`);
    const entries = readTar(archivePath);

    expect(summary).toEqual({
      id: 'portable-20260817T120000000Z-00000000-0000-4000-8000-000000000001',
      createdAt: '2026-08-17T12:00:00.000Z',
      schemaVersion: 1,
      directoryRevision: 1,
      tripRevisions: { [seeded.trip.id]: 2 },
    });
    expect(manifest.files.map((file) => file.path)).toEqual([
      'database/plotter.sqlite3',
      expect.stringMatching(/^media\/.+\.png$/),
    ]);
    expect([...manifest.files].sort((left, right) => left.path.localeCompare(right.path)))
      .toEqual(manifest.files);
    expect(entries.map((entry) => entry.path)).toEqual([
      'manifest.json',
      ...manifest.files.map((file) => file.path),
    ]);
    expect(entries.map((entry) => entry.path).join('\n')).not.toMatch(/trash|\.env|credentials|automatic|imports/);
    const manifestBytes = entries[0]!.bytes;
    const { id: _backupId, ...manifestWithoutId } = manifest;
    expect(_backupId).toBe(summary.id);
    expect(JSON.parse(manifestBytes.toString('utf8'))).toEqual({ formatVersion: 1, ...manifestWithoutId });
    for (const file of manifest.files) {
      const entry = entries.find((candidate) => candidate.path === file.path)!;
      expect(entry.bytes.byteLength).toBe(file.byteCount);
      expect(sha256(entry.bytes)).toBe(file.sha256);
    }
    const databaseEntry = entries.find((entry) => entry.path === 'database/plotter.sqlite3')!;
    const extractedDatabase = join(harness.dataDirectory, 'inspect.sqlite3');
    writeFileSync(extractedDatabase, databaseEntry.bytes);
    const copy = new DatabaseSync(extractedDatabase, { readOnly: true });
    expect(copy.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    expect(copy.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(copy.prepare('SELECT id, name FROM trips').all()).toEqual([{ id: seeded.trip.id, name: 'Original' }]);
    copy.close();
    harness.close();
  });

  it.each([
    ['missing', (entries: TarEntry[]) => entries.filter((entry) => !entry.path.startsWith('media/'))],
    ['extra', (entries: TarEntry[]) => [...entries, { path: '.env', bytes: Buffer.from('secret') }]],
    ['changed', (entries: TarEntry[]) => entries.map((entry) => entry.path.startsWith('media/') ? { ...entry, bytes: Buffer.from('changed') } : entry)],
    ['traversing', (entries: TarEntry[]) => [...entries, { path: '../outside', bytes: Buffer.from('escape') }]],
    ['absolute', (entries: TarEntry[]) => [...entries, { path: '/tmp/outside', bytes: Buffer.from('escape') }]],
    ['duplicate', (entries: TarEntry[]) => [...entries, { ...entries[1]! }]],
    ['link-like', (entries: TarEntry[]) => [...entries, { path: 'media/link.png', bytes: Buffer.alloc(0), type: '2' }]],
  ])('rejects %s archive content before exposing or promoting it', async (_name, mutate) => {
    const harness = createHarness();
    await seedTrip(harness);
    const valid = await harness.operations.create();
    const validPath = join(harness.dataDirectory, 'backups', `${valid.id}.tar`);
    const invalidId = 'portable-20260817T120000000Z-00000000-0000-4000-8000-000000000099';
    const invalidPath = join(harness.dataDirectory, 'backups', `${invalidId}.tar`);
    writeTar(invalidPath, mutate(readTar(validPath)));

    await expect(harness.operations.inspect(invalidId)).rejects.toThrow('Portable backup is invalid.');
    expect(existsSync(join(harness.dataDirectory, 'outside'))).toBe(false);
    expect(readdirSync(join(harness.dataDirectory, 'backups')).some((name) => name.startsWith('.inspect-'))).toBe(false);
    harness.close();
  });

  it('rejects an empty database that would become valid only through automatic migration', async () => {
    const harness = createHarness();
    const emptyPath = join(harness.dataDirectory, 'empty.sqlite3');
    new DatabaseSync(emptyPath).close();
    const databaseBytes = readFileSync(emptyPath);
    const invalidId = 'portable-20260817T120000000Z-00000000-0000-4000-8000-000000000098';
    const manifest: PortableBackupManifest = {
      formatVersion: 1,
      schemaVersion: 1,
      createdAt: '2026-08-17T12:00:00.000Z',
      directoryRevision: 0,
      tripRevisions: {},
      files: [{
        path: 'database/plotter.sqlite3',
        byteCount: databaseBytes.byteLength,
        sha256: sha256(databaseBytes),
      }],
    };
    writeTar(join(harness.dataDirectory, 'backups', `${invalidId}.tar`), [
      { path: 'manifest.json', bytes: Buffer.from(JSON.stringify(manifest)) },
      { path: 'database/plotter.sqlite3', bytes: databaseBytes },
    ]);

    await expect(harness.operations.inspect(invalidId)).rejects.toThrow('Portable backup is invalid.');
    harness.close();
  });

  it('rejects a manifest-declared restore control marker before it can enter transaction state', async () => {
    const harness = createHarness();
    await seedTrip(harness);
    const valid = await harness.operations.create();
    const entries = readTar(join(harness.dataDirectory, 'backups', `${valid.id}.tar`));
    const markerBytes = Buffer.from(JSON.stringify({ committed: true }));
    const manifest = JSON.parse(entries[0]!.bytes.toString('utf8')) as PortableBackupManifest;
    const invalidId = 'portable-20260817T120000000Z-00000000-0000-4000-8000-000000000097';
    const files = [...manifest.files, {
      path: 'restore-committed',
      byteCount: markerBytes.byteLength,
      sha256: sha256(markerBytes),
    }].sort((left, right) => left.path.localeCompare(right.path));
    writeTar(join(harness.dataDirectory, 'backups', `${invalidId}.tar`), [
      { path: 'manifest.json', bytes: Buffer.from(JSON.stringify({ ...manifest, files })) },
      ...entries.slice(1),
      { path: 'restore-committed', bytes: markerBytes },
    ]);

    await expect(harness.operations.inspect(invalidId)).rejects.toThrow('Portable backup is invalid.');
    await expect(harness.operations.restore(invalidId, { confirmation: `RESTORE ${invalidId}` }))
      .rejects.toThrow('Portable backup is invalid.');
    expect(harness.closeCount()).toBe(0);
    harness.close();
  });

  it.each([
    ['unsupported content type', 'application/pdf', (mediaId: string) => `media/${mediaId}.pdf`],
    ['nested staging path', 'image/png', (mediaId: string) => `media/.staging/${mediaId}.png`],
    ['wrong extension', 'image/png', (mediaId: string) => `media/${mediaId}.jpg`],
  ])('rejects a self-consistent active-media archive with %s', async (_label, contentType, relativePath) => {
    const harness = createHarness();
    await seedTrip(harness);
    const valid = await harness.operations.create();
    const invalidId = `portable-20260817T120000000Z-00000000-0000-4000-8000-${
      contentType === 'application/pdf' ? '000000000094'
        : relativePath('id').includes('.staging') ? '000000000095'
          : '000000000096'
    }`;
    writeSelfConsistentMediaVariant(harness, valid.id, invalidId, { contentType, relativePath });

    await expect(harness.operations.inspect(invalidId)).rejects.toThrow('Portable backup is invalid.');
    harness.close();
  });

  it('refuses to create a backup if its validated directory is replaced by a symlink', async () => {
    const harness = createHarness();
    await seedTrip(harness);
    const outsideDirectory = mkdtempSync(join(tmpdir(), 'plotter-portable-backup-outside-'));
    temporaryDirectories.push(outsideDirectory);
    renameSync(
      join(harness.dataDirectory, 'backups'),
      join(harness.dataDirectory, 'backups-replaced'),
    );
    symlinkSync(outsideDirectory, join(harness.dataDirectory, 'backups'), 'dir');

    await expect(harness.operations.create()).rejects.toBeInstanceOf(PortableBackupCreateError);
    expect(readdirSync(outsideDirectory)).toEqual([]);
    harness.close();
  });

  it('never deletes or replaces the first archive when a backup ID repeats', async () => {
    const repeatedId = '00000000-0000-4000-8000-000000000001';
    const harness = createHarness({ ids: [repeatedId, repeatedId] });
    await seedTrip(harness);
    const first = await harness.operations.create();
    const archivePath = join(harness.dataDirectory, 'backups', `${first.id}.tar`);
    const originalBytes = readFileSync(archivePath);

    await expect(harness.operations.create()).rejects.toBeInstanceOf(PortableBackupCreateError);

    expect(readFileSync(archivePath)).toEqual(originalBytes);
    await expect(harness.operations.inspect(first.id)).resolves.toMatchObject({ id: first.id });
    harness.close();
  });

  it('atomically refuses a target created after its unique temporary archive is ready', async () => {
    const identifier = '00000000-0000-4000-8000-000000000001';
    let finalPath = '';
    const raceBytes = Buffer.from('race-created archive');
    const harness = createHarness({
      ids: [identifier],
      durability: {
        async onPhase(phase) {
          if (phase === 'archive-ready') writeFileSync(finalPath, raceBytes);
        },
        async syncDirectory() {},
      },
    });
    await seedTrip(harness);
    finalPath = join(
      harness.dataDirectory,
      'backups',
      `portable-20260817T120000000Z-${identifier}.tar`,
    );

    await expect(harness.operations.create()).rejects.toBeInstanceOf(PortableBackupCreateError);

    expect(readFileSync(finalPath)).toEqual(raceBytes);
    expect(readdirSync(join(harness.dataDirectory, 'backups')).filter((name) => name.endsWith('.tmp')))
      .toEqual([]);
    harness.close();
  });
});

describe('portable restore', () => {
  it('restores a valid backup whose active media tree is empty', async () => {
    const harness = createHarness();
    const repositories = harness.repositories();
    const created = await repositories.directory.create(0, { expectedRevision: 0, name: 'Empty media' });
    const backup = await harness.operations.create();
    await repositories.directory.update(1, created.trip!.id, {
      expectedRevision: 1,
      patch: { name: 'Changed' },
    });

    await expect(harness.operations.restore(backup.id, { confirmation: `RESTORE ${backup.id}` }))
      .resolves.toEqual(backup);
    expect((harness.database()!.connection.prepare('SELECT name FROM trips').get() as { name: string }).name)
      .toBe('Empty media');
    expect(readdirSync(join(harness.dataDirectory, 'media')).filter((name) => name !== '.staging'))
      .toEqual([]);
    harness.close();
  });

  it('requires the exact selected ID token, preserves current state under a recovery name, and invalidates restored revisions', async () => {
    const harness = createHarness();
    const seeded = await seedTrip(harness);
    const original = await harness.operations.create();
    await seeded.directory.update(1, seeded.trip.id, { expectedRevision: 1, patch: { name: 'Current' } });
    const currentMedia = await seeded.tripRepository.createDestinationMedia(2, seeded.destination.id, {
      bytes: stream('current-only image'), contentType: 'image/jpeg', caption: 'Current only',
    });
    const currentOnlyTrip = (await seeded.directory.create(2, {
      expectedRevision: 2,
      name: 'Current only trip',
    })).trip!;

    await expect(harness.operations.restore(original.id, { confirmation: `RESTORE ${original.id}-wrong` }))
      .rejects.toThrow('Portable restore confirmation is invalid.');
    expect((harness.database()!.connection.prepare('SELECT name FROM trips WHERE id = ?').get(seeded.trip.id) as { name: string }).name)
      .toBe('Current');

    await expect(harness.operations.restore(original.id, { confirmation: `RESTORE ${original.id}` }))
      .resolves.toEqual(original);

    expect(harness.closeCount()).toBe(1);
    expect(harness.openCount()).toBe(1);
    expect((harness.database()!.connection.prepare('SELECT name FROM trips WHERE id = ?').get(seeded.trip.id) as { name: string }).name)
      .toBe('Original');
    expect(existsSync(join(harness.dataDirectory, 'media', currentMedia.mediaItem!.id + '.jpg'))).toBe(false);
    expect(readFileSync(join(harness.dataDirectory, seeded.media.url.replace('/api/v1/media/', 'media/').replace('/content', '.png')), 'utf8'))
      .toBe('original image bytes');
    const restoreInvalidations = harness.emitted.slice(-3);
    expect(restoreInvalidations[0]).toEqual({
      kind: 'restore-reset', epoch: '00000000-0000-4000-8000-000000000002',
      scope: 'directory',
    });
    expect(restoreInvalidations.slice(1)).toEqual(expect.arrayContaining([
      {
        kind: 'restore-reset', epoch: '00000000-0000-4000-8000-000000000002',
        scope: 'trip', tripId: currentOnlyTrip.id,
      },
      {
        kind: 'restore-reset', epoch: '00000000-0000-4000-8000-000000000002',
        scope: 'trip', tripId: seeded.trip.id,
      },
    ]));

    const backups = await harness.operations.list();
    const recovery = backups.find((backup) => backup.id.startsWith('recovery-before-restore-'));
    expect(recovery).toMatchObject({
      directoryRevision: 3,
      tripRevisions: { [seeded.trip.id]: 3, [currentOnlyTrip.id]: 0 },
    });
    const recoveryManifest = await harness.operations.inspect(recovery!.id);
    expect(recoveryManifest.files.filter((file) => file.path.startsWith('media/'))).toHaveLength(2);
    harness.close();
  });

  it('does not quiesce or mutate canonical state when the required recovery backup cannot be created', async () => {
    const harness = createHarness();
    await seedTrip(harness);
    const selected = await harness.operations.create();
    const collidingRecoveryId = 'recovery-before-restore-20260817T120000000Z-00000000-0000-4000-8000-000000000003';
    writeFileSync(join(harness.dataDirectory, 'backups', `${collidingRecoveryId}.tar`), 'collision');

    await expect(harness.operations.restore(selected.id, { confirmation: `RESTORE ${selected.id}` }))
      .rejects.toBeInstanceOf(PortableBackupCreateError);
    expect(harness.closeCount()).toBe(0);
    expect((harness.database()!.connection.prepare('SELECT name FROM trips').get() as { name: string }).name)
      .toBe('Original');
    harness.close();
  });

  it('rolls canonical state back and reopens readiness when post-promotion validation fails', async () => {
    const harness = createHarness();
    const seeded = await seedTrip(harness);
    const original = await harness.operations.create();
    await seeded.directory.update(1, seeded.trip.id, { expectedRevision: 1, patch: { name: 'Keep current' } });
    harness.failNextOpen();

    await expect(harness.operations.restore(original.id, { confirmation: `RESTORE ${original.id}` }))
      .rejects.toThrow('Portable restore failed; canonical state was recovered.');

    expect(harness.closeCount()).toBe(1);
    expect(harness.openCount()).toBe(2);
    expect((harness.database()!.connection.prepare('SELECT name FROM trips WHERE id = ?').get(seeded.trip.id) as { name: string }).name)
      .toBe('Keep current');
    expect(readdirSync(harness.dataDirectory).some((name) => name.startsWith('.portable-restore-'))).toBe(false);
    harness.close();
  });

  it('durably orders recovery, rollback, promotion, marker, and cleanup phases', async () => {
    const observed: string[] = [];
    const durability: PortableBackupDurability = {
      async onPhase(phase) { observed.push(`phase:${phase}`); },
      async syncDirectory(path, phase) {
        observed.push(`sync:${phase}:${path.split('/').at(-1)}`);
      },
    };
    const harness = createHarness({ durability });
    const seeded = await seedTrip(harness);
    const backup = await harness.operations.create();
    await seeded.directory.update(1, seeded.trip.id, {
      expectedRevision: 1, patch: { name: 'Current' },
    });
    observed.length = 0;

    await harness.operations.restore(backup.id, { confirmation: `RESTORE ${backup.id}` });

    expect(observed).toEqual(expect.arrayContaining([
      'phase:recovery-archive-durable',
      'phase:storage-quiesced',
      'phase:originals-durable',
      'phase:promotion-durable',
      'phase:commit-marker-durable',
      'phase:transaction-cleaned',
    ]));
    const ordered = [
      'phase:recovery-archive-durable',
      'phase:storage-quiesced',
      'phase:originals-durable',
      'phase:promotion-durable',
      'phase:commit-marker-durable',
      'phase:transaction-cleaned',
    ].map((phase) => observed.indexOf(phase));
    expect(ordered.every((index, position) => index >= 0 && (position === 0 || index > ordered[position - 1]!)))
      .toBe(true);
    expect(observed.filter((entry) => entry.startsWith('sync:restore-originals-moved:')))
      .toHaveLength(2);
    expect(observed.filter((entry) => entry.startsWith('sync:restore-promoted:')))
      .toHaveLength(3);
    expect(observed.some((entry) => entry.startsWith('sync:restore-marker-published:'))).toBe(true);
    harness.close();
  });

  it('durably rolls back and reopens when promotion directory sync fails', async () => {
    let failPromotionSync = true;
    const phases: string[] = [];
    const harness = createHarness({
      durability: {
        async onPhase(phase) { phases.push(phase); },
        async syncDirectory(_path, phase) {
          if (phase === 'restore-promoted' && failPromotionSync) {
            failPromotionSync = false;
            throw new Error('controlled promotion sync failure');
          }
        },
      },
    });
    const seeded = await seedTrip(harness);
    const backup = await harness.operations.create();
    await seeded.directory.update(1, seeded.trip.id, {
      expectedRevision: 1, patch: { name: 'Keep current' },
    });

    await expect(harness.operations.restore(backup.id, { confirmation: `RESTORE ${backup.id}` }))
      .rejects.toThrow('Portable restore failed; canonical state was recovered.');

    expect((harness.database()!.connection.prepare('SELECT name FROM trips').get() as { name: string }).name)
      .toBe('Keep current');
    expect(phases).toContain('rollback-durable');
    expect(phases).not.toContain('commit-marker-durable');
    expect(harness.openCount()).toBe(1);
    harness.close();
  });

  it('does not quiesce storage when the recovery archive directory cannot be synced', async () => {
    let archivePublishCount = 0;
    const harness = createHarness({
      durability: {
        async syncDirectory(_path, phase) {
          if (phase === 'archive-published' && ++archivePublishCount === 2) {
            throw new Error('controlled recovery archive sync failure');
          }
        },
      },
    });
    const seeded = await seedTrip(harness);
    const backup = await harness.operations.create();
    await seeded.directory.update(1, seeded.trip.id, {
      expectedRevision: 1, patch: { name: 'Keep current' },
    });

    await expect(harness.operations.restore(backup.id, { confirmation: `RESTORE ${backup.id}` }))
      .rejects.toBeInstanceOf(PortableBackupCreateError);

    expect(harness.closeCount()).toBe(0);
    expect((harness.database()!.connection.prepare('SELECT name FROM trips').get() as { name: string }).name)
      .toBe('Keep current');
    harness.close();
  });

  it('rolls back when the exact commit marker name cannot be made durable', async () => {
    let failMarkerSync = true;
    const phases: string[] = [];
    const harness = createHarness({
      durability: {
        async onPhase(phase) { phases.push(phase); },
        async syncDirectory(_path, phase) {
          if (phase === 'restore-marker-published' && failMarkerSync) {
            failMarkerSync = false;
            throw new Error('controlled marker directory sync failure');
          }
        },
      },
    });
    const seeded = await seedTrip(harness);
    const backup = await harness.operations.create();
    await seeded.directory.update(1, seeded.trip.id, {
      expectedRevision: 1, patch: { name: 'Keep current' },
    });

    await expect(harness.operations.restore(backup.id, { confirmation: `RESTORE ${backup.id}` }))
      .rejects.toThrow('Portable restore failed; canonical state was recovered.');

    expect((harness.database()!.connection.prepare('SELECT name FROM trips').get() as { name: string }).name)
      .toBe('Keep current');
    expect(phases).toContain('rollback-durable');
    expect(phases).not.toContain('commit-marker-durable');
    harness.close();
  });
});

describe('interrupted portable restore recovery', () => {
  function interruptedTransaction(committed: boolean) {
    const dataDirectory = mkdtempSync(join(tmpdir(), 'plotter-portable-recovery-'));
    temporaryDirectories.push(dataDirectory);
    writeFileSync(join(dataDirectory, 'plotter.sqlite3'), 'promoted database');
    mkdirSync(join(dataDirectory, 'media'));
    writeFileSync(join(dataDirectory, 'media', 'promoted.png'), 'promoted media');
    const transactionId = '00000000-0000-4000-8000-000000000001';
    const transaction = join(dataDirectory, `.portable-restore-${transactionId}`);
    mkdirSync(join(transaction, 'rollback', 'media'), { recursive: true });
    writeFileSync(join(transaction, 'rollback', 'plotter.sqlite3'), 'canonical database');
    writeFileSync(join(transaction, 'rollback', 'media', 'canonical.png'), 'canonical media');
    if (committed) {
      writeFileSync(join(transaction, 'restore-committed'), JSON.stringify({
        formatVersion: 1,
        transactionId,
        backupId: 'portable-20260817T120000000Z-00000000-0000-4000-8000-000000000009',
        restoreEpoch: transactionId,
      }));
    }
    return { dataDirectory, transaction };
  }

  it('rolls back an uncommitted promotion before service startup', async () => {
    const { dataDirectory, transaction } = interruptedTransaction(false);

    await recoverInterruptedPortableRestore(dataDirectory);

    expect(readFileSync(join(dataDirectory, 'plotter.sqlite3'), 'utf8')).toBe('canonical database');
    expect(readdirSync(join(dataDirectory, 'media'))).toEqual(['canonical.png']);
    expect(existsSync(transaction)).toBe(false);
  });

  it('keeps a committed promotion and removes its completed transaction', async () => {
    const { dataDirectory, transaction } = interruptedTransaction(true);

    await recoverInterruptedPortableRestore(dataDirectory);

    expect(readFileSync(join(dataDirectory, 'plotter.sqlite3'), 'utf8')).toBe('promoted database');
    expect(readdirSync(join(dataDirectory, 'media'))).toEqual(['promoted.png']);
    expect(existsSync(transaction)).toBe(false);
  });

  it('rolls back when a present commit marker does not identify the transaction', async () => {
    const { dataDirectory, transaction } = interruptedTransaction(false);
    writeFileSync(join(transaction, 'restore-committed'), JSON.stringify({
      formatVersion: 1,
      transactionId: '00000000-0000-4000-8000-000000000099',
      backupId: 'portable-20260817T120000000Z-00000000-0000-4000-8000-000000000009',
      restoreEpoch: '00000000-0000-4000-8000-000000000099',
    }));

    await recoverInterruptedPortableRestore(dataDirectory);

    expect(readFileSync(join(dataDirectory, 'plotter.sqlite3'), 'utf8')).toBe('canonical database');
    expect(readdirSync(join(dataDirectory, 'media'))).toEqual(['canonical.png']);
    expect(existsSync(transaction)).toBe(false);
  });
});
