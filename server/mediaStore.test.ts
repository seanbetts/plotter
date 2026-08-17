import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDestination } from '../src/domain/destinations';
import type { RevisionEvent } from '../src/storage/revision';
import { openPlotterDatabase, type PlotterDatabase } from './database';
import { createSqliteDirectoryRepository } from './directoryRepository';
import { createRevisionEventBus } from './events';
import {
  MAX_MEDIA_BYTES,
  createMediaStore,
  type StoredMediaObject,
} from './mediaStore';
import { createSqliteTripRepository } from './tripRepository';
import { createWriteCoordinator } from './writeCoordinator';

const temporaryDirectories: string[] = [];
const openDatabases: PlotterDatabase[] = [];

function createHarness() {
  const directory = mkdtempSync(join(tmpdir(), 'plotter-media-store-'));
  temporaryDirectories.push(directory);
  return {
    directory,
    media: createMediaStore(directory),
  };
}

function createRepositoryHarness() {
  const directory = mkdtempSync(join(tmpdir(), 'plotter-media-repository-'));
  temporaryDirectories.push(directory);
  const database = openPlotterDatabase(join(directory, 'plotter.sqlite3'));
  openDatabases.push(database);
  const events: RevisionEvent[] = [];
  const eventBus = createRevisionEventBus();
  eventBus.subscribe((event) => events.push(event));
  const writes = createWriteCoordinator(
    database,
    { async createAutomaticBackup() { return join(directory, 'backup.sqlite3'); } },
    eventBus,
  );
  const media = createMediaStore(directory);
  const tripDirectory = createSqliteDirectoryRepository(database, writes, media);

  return {
    database,
    dataDirectory: directory,
    directory: tripDirectory,
    events,
    media,
    trip(tripId: string) {
      return createSqliteTripRepository(database, writes, tripId, media);
    },
  };
}

async function createTripWithDestination(harness: ReturnType<typeof createRepositoryHarness>) {
  const created = await harness.directory.create(0, { expectedRevision: 0, name: 'Atlas' });
  const trip = created.trip!;
  const destination = createDestination({
    name: 'Kyoto',
    coordinates: { lat: 35.0116, lng: 135.7681 },
  });
  const repository = harness.trip(trip.id);
  await repository.mutate(0, { type: 'save-destination', destination });
  return { destination, repository, trip };
}

function imageStream(value: string) {
  return bytesStream(new TextEncoder().encode(value));
}

function bytesStream(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

function failingStream(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.error(new Error('upload interrupted'));
    },
  });
}

afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('atomic media store', () => {
  it('opens committed bytes only through their contained metadata-derived relative path', async () => {
    const harness = createHarness();
    const staged = await harness.media.stage(imageStream('served image'), 'image/png');
    const committed = await harness.media.commit(staged, 'media-open');

    const opened = await harness.media.open(committed.relativePath);
    const chunks: Buffer[] = [];
    for await (const chunk of opened.bytes) chunks.push(Buffer.from(chunk));

    expect(opened.contentLength).toBe(12);
    expect(Buffer.concat(chunks).toString('utf8')).toBe('served image');
    await expect(harness.media.open('../outside.png')).rejects.toThrow(
      'Media path escapes its storage boundary.',
    );
  });

  it('rejects an existing media-root symlink before writing through it', () => {
    const directory = mkdtempSync(join(tmpdir(), 'plotter-media-root-link-'));
    const outside = mkdtempSync(join(tmpdir(), 'plotter-media-root-outside-'));
    temporaryDirectories.push(directory, outside);
    symlinkSync(outside, join(directory, 'media'));

    expect(() => createMediaStore(directory)).toThrow(
      'Media path escapes its storage boundary.',
    );
    expect(readdirSync(outside)).toEqual([]);
  });

  it('rejects a staging-root symlink swapped in after construction before opening a file', async () => {
    const harness = createHarness();
    const outside = mkdtempSync(join(tmpdir(), 'plotter-media-staging-outside-'));
    temporaryDirectories.push(outside);
    rmSync(join(harness.directory, 'media', '.staging'), { recursive: true });
    symlinkSync(outside, join(harness.directory, 'media', '.staging'));

    await expect(harness.media.stage(imageStream('escape'), 'image/png')).rejects.toThrow(
      'Media path escapes its storage boundary.',
    );
    expect(readdirSync(outside)).toEqual([]);
  });

  it.each(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])(
    'stages allowed %s bytes with their exact size and SHA-256',
    async (contentType) => {
      const harness = createHarness();
      const bytes = new TextEncoder().encode('immutable image bytes');

      const staged = await harness.media.stage(bytesStream(bytes), contentType);

      expect(staged).toMatchObject({
        byteCount: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        contentType,
      });
      expect(staged.relativePath).toMatch(/^media\/.staging\/[0-9a-f-]+\.tmp$/);
      expect(readFileSync(join(harness.directory, staged.relativePath))).toEqual(Buffer.from(bytes));
    },
  );

  it('rejects disallowed content types before creating a temporary file', async () => {
    const harness = createHarness();

    await expect(harness.media.stage(
      bytesStream(new Uint8Array([1])),
      'text/html',
    )).rejects.toThrow('Media content type is not allowed.');
    expect(readdirSync(join(harness.directory, 'media', '.staging'))).toEqual([]);
  });

  it('rejects an empty media stream and removes its temporary file', async () => {
    const harness = createHarness();

    await expect(harness.media.stage(bytesStream(), 'image/png')).rejects.toThrow(
      'Media must contain at least one byte.',
    );
    expect(readdirSync(join(harness.directory, 'media', '.staging'))).toEqual([]);
  });

  it('rejects a stream larger than 50 MiB and removes its partial temporary file', async () => {
    const harness = createHarness();
    const chunk = new Uint8Array(1024 * 1024);
    let chunks = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(chunk);
        chunks += 1;
        if (chunks > MAX_MEDIA_BYTES / chunk.byteLength) controller.close();
      },
    });

    await expect(harness.media.stage(stream, 'image/jpeg')).rejects.toThrow(
      'Media exceeds the 50 MiB size limit.',
    );
    expect(readdirSync(join(harness.directory, 'media', '.staging'))).toEqual([]);
  });

  it('removes a partial temporary file when its input stream fails', async () => {
    const harness = createHarness();

    await expect(harness.media.stage(failingStream(), 'image/png')).rejects.toThrow(
      'upload interrupted',
    );
    expect(readdirSync(join(harness.directory, 'media', '.staging'))).toEqual([]);
  });

  it('commits by media identity and content type without accepting a request filename', async () => {
    const harness = createHarness();
    const staged = await harness.media.stage(
      bytesStream(new TextEncoder().encode('photo')),
      'image/webp',
    );

    const committed = await harness.media.commit(staged, 'media-one');

    expect(committed.relativePath).toBe('media/media-one.webp');
    expect(readFileSync(join(harness.directory, committed.relativePath), 'utf8')).toBe('photo');
    expect(existsSync(join(harness.directory, staged.relativePath))).toBe(false);
    expect(lstatSync(join(harness.directory, committed.relativePath)).isFile()).toBe(true);
  });

  it('atomically rejects one of two concurrent commits for the same media identity', async () => {
    const harness = createHarness();
    const first = await harness.media.stage(imageStream('first contender'), 'image/png');
    const second = await harness.media.stage(imageStream('second contender'), 'image/png');

    const results = await Promise.allSettled([
      harness.media.commit(first, 'same-media'),
      harness.media.commit(second, 'same-media'),
    ]);

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    expect((results.find(({ status }) => status === 'rejected') as PromiseRejectedResult).reason)
      .toMatchObject({ message: 'Media identity already exists.' });
    expect(['first contender', 'second contender']).toContain(
      readFileSync(join(harness.directory, 'media', 'same-media.png'), 'utf8'),
    );
    expect(readdirSync(join(harness.directory, 'media', '.staging'))).toEqual([]);
  });

  it('rejects one of two concurrent cross-content-type commits for the same media identity', async () => {
    const harness = createHarness();
    const png = await harness.media.stage(imageStream('png contender'), 'image/png');
    const jpeg = await harness.media.stage(imageStream('jpeg contender'), 'image/jpeg');

    const results = await Promise.allSettled([
      harness.media.commit(png, 'cross-type-media'),
      harness.media.commit(jpeg, 'cross-type-media'),
    ]);

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    expect((results.find(({ status }) => status === 'rejected') as PromiseRejectedResult).reason)
      .toMatchObject({ message: 'Media identity already exists.' });
    const activeFiles = readdirSync(join(harness.directory, 'media'))
      .filter((name) => name.startsWith('cross-type-media.'));
    expect(activeFiles).toHaveLength(1);
    expect(['png contender', 'jpeg contender']).toContain(
      readFileSync(join(harness.directory, 'media', activeFiles[0]), 'utf8'),
    );
    expect(readdirSync(join(harness.directory, 'media', '.staging'))).toEqual([]);
  });

  it('rejects forged stage paths, media path traversal, and symlink escapes', async () => {
    const harness = createHarness();
    const staged = await harness.media.stage(bytesStream(new Uint8Array([1])), 'image/png');
    const outside = mkdtempSync(join(tmpdir(), 'plotter-media-outside-'));
    temporaryDirectories.push(outside);
    writeFileSync(join(outside, 'escape.tmp'), 'outside');
    symlinkSync(outside, join(harness.directory, 'media', '.staging', 'escape'));

    const forged: StoredMediaObject = {
      ...staged,
      relativePath: 'media/.staging/escape/escape.tmp',
      byteCount: 7,
    };

    await expect(harness.media.commit(staged, '../escape')).rejects.toThrow(
      'Media identity is invalid.',
    );
    await expect(harness.media.commit(forged, 'media-two')).rejects.toThrow(
      'Media path escapes its storage boundary.',
    );
    expect(readFileSync(join(outside, 'escape.tmp'), 'utf8')).toBe('outside');
  });

  it('rejects missing or changed staged bytes instead of publishing them', async () => {
    const harness = createHarness();
    const missing = await harness.media.stage(bytesStream(new Uint8Array([1])), 'image/png');
    rmSync(join(harness.directory, missing.relativePath));

    await expect(harness.media.commit(missing, 'missing-media')).rejects.toThrow(
      'Media bytes are missing.',
    );

    const changed = await harness.media.stage(bytesStream(new Uint8Array([2])), 'image/png');
    writeFileSync(join(harness.directory, changed.relativePath), new Uint8Array([3]));
    await expect(harness.media.commit(changed, 'changed-media')).rejects.toThrow(
      'Staged media does not match its validated digest.',
    );
    expect(existsSync(join(harness.directory, 'media', 'changed-media.png'))).toBe(false);
    expect(existsSync(join(harness.directory, changed.relativePath))).toBe(false);
  });

  it('moves active bytes to unique trash and can restore them after a failed metadata delete', async () => {
    const harness = createHarness();
    const staged = await harness.media.stage(bytesStream(new TextEncoder().encode('keep me')), 'image/jpeg');
    const committed = await harness.media.commit(staged, 'media-restore');

    const restore = await harness.media.moveToTrash(committed.relativePath, 'media-restore');

    expect(existsSync(join(harness.directory, committed.relativePath))).toBe(false);
    const trashEntries = readdirSync(join(harness.directory, 'trash'));
    expect(trashEntries).toHaveLength(1);
    expect(readFileSync(join(harness.directory, 'trash', trashEntries[0]), 'utf8')).toBe('keep me');

    await restore();
    expect(readFileSync(join(harness.directory, committed.relativePath), 'utf8')).toBe('keep me');
    expect(readdirSync(join(harness.directory, 'trash'))).toEqual([]);
  });

  it('atomically rejects one of two concurrent restores targeting the same active identity', async () => {
    const harness = createHarness();
    const original = await harness.media.commit(
      await harness.media.stage(imageStream('original'), 'image/jpeg'),
      'restore-collision',
    );
    const restoreOriginal = await harness.media.moveToTrash(
      original.relativePath,
      'restore-collision',
    );
    const replacement = await harness.media.commit(
      await harness.media.stage(imageStream('replacement'), 'image/jpeg'),
      'restore-collision',
    );
    const restoreReplacement = await harness.media.moveToTrash(
      replacement.relativePath,
      'restore-collision',
    );

    const results = await Promise.allSettled([restoreOriginal(), restoreReplacement()]);

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    expect((results.find(({ status }) => status === 'rejected') as PromiseRejectedResult).reason)
      .toMatchObject({ message: 'Media identity already exists.' });
    expect(['original', 'replacement']).toContain(
      readFileSync(join(harness.directory, original.relativePath), 'utf8'),
    );
    expect(readdirSync(join(harness.directory, 'trash'))).toHaveLength(1);
  });

  it('serializes a restore against a cross-content-type commit for the same media identity', async () => {
    const harness = createHarness();
    const original = await harness.media.commit(
      await harness.media.stage(imageStream('original jpeg'), 'image/jpeg'),
      'restore-commit-collision',
    );
    const restore = await harness.media.moveToTrash(
      original.relativePath,
      'restore-commit-collision',
    );
    const replacement = await harness.media.stage(imageStream('replacement png'), 'image/png');

    const results = await Promise.allSettled([
      restore(),
      harness.media.commit(replacement, 'restore-commit-collision'),
    ]);

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    expect((results.find(({ status }) => status === 'rejected') as PromiseRejectedResult).reason)
      .toMatchObject({ message: 'Media identity already exists.' });
    const activeFiles = readdirSync(join(harness.directory, 'media'))
      .filter((name) => name.startsWith('restore-commit-collision.'));
    expect(activeFiles).toHaveLength(1);
    const restoreWon = results[0].status === 'fulfilled';
    expect(readFileSync(join(harness.directory, 'media', activeFiles[0]), 'utf8'))
      .toBe(restoreWon ? 'original jpeg' : 'replacement png');
    expect(readdirSync(join(harness.directory, 'media', '.staging'))).toEqual([]);
    expect(readdirSync(join(harness.directory, 'trash'))).toHaveLength(restoreWon ? 0 : 1);
  });

  it('rejects missing active bytes and active-path symlink escapes', async () => {
    const harness = createHarness();
    const outside = mkdtempSync(join(tmpdir(), 'plotter-media-active-outside-'));
    temporaryDirectories.push(outside);
    writeFileSync(join(outside, 'outside.png'), 'outside');
    mkdirSync(join(harness.directory, 'media', 'linked'));
    rmSync(join(harness.directory, 'media', 'linked'), { recursive: true });
    symlinkSync(outside, join(harness.directory, 'media', 'linked'));

    await expect(harness.media.moveToTrash('media/missing.png', 'missing')).rejects.toThrow(
      'Media bytes are missing.',
    );
    await expect(harness.media.moveToTrash('media/linked/outside.png', 'outside')).rejects.toThrow(
      'Media path escapes its storage boundary.',
    );
    expect(readFileSync(join(outside, 'outside.png'), 'utf8')).toBe('outside');
  });
});

describe('revisioned media metadata and filesystem coordination', () => {
  it('creates destination and activity media with complete immutable metadata and one revision each', async () => {
    const harness = createRepositoryHarness();
    const { destination, repository, trip } = await createTripWithDestination(harness);
    const activity = (await repository.mutate(1, {
      type: 'create-activity',
      input: { destinationId: destination.id, title: 'Temple walk' },
    })).activity!;

    const destinationResult = await repository.createDestinationMedia(2, destination.id, {
      bytes: imageStream('destination image'),
      contentType: 'image/webp',
      caption: 'Golden Pavilion',
      credit: 'Kyoto archive',
      source: {
        bucketId: 'provider-images',
        objectPath: 'provider/kyoto/golden-pavilion.webp',
        uploadedBy: 'provider-import',
        createdAt: '2026-08-17T10:00:00.000Z',
        updatedAt: '2026-08-17T10:00:00.000Z',
      },
    });
    const activityResult = await repository.createActivityMedia(3, destination.id, activity.id, {
      bytes: imageStream('activity image'),
      contentType: 'image/jpeg',
      caption: 'Kiyomizu-dera',
      credit: 'Example photographer',
    });

    expect(destinationResult).toMatchObject({
      revision: 3,
      mediaItem: {
        id: expect.any(String),
        url: expect.stringMatching(/^\/api\/v1\/media\/.+\/content$/),
        caption: 'Golden Pavilion',
        credit: 'Kyoto archive',
        sortOrder: 0,
        bucketId: 'provider-images',
        objectPath: 'provider/kyoto/golden-pavilion.webp',
        contentType: 'image/webp',
        sizeBytes: 17,
        uploadedAt: '2026-08-17T10:00:00.000Z',
      },
    });
    expect(activityResult).toMatchObject({
      revision: 4,
      mediaItem: { caption: 'Kiyomizu-dera', credit: 'Example photographer', sortOrder: 0 },
    });
    await expect(repository.listDestinationMedia(destination.id)).resolves.toEqual([
      destinationResult.mediaItem,
    ]);
    await expect(repository.listActivityMedia(activity.id)).resolves.toEqual([
      activityResult.mediaItem,
    ]);

    const rows = harness.database.connection.prepare(`
      SELECT id, trip_id, destination_id, activity_id, bucket_id, object_path,
        caption, credit, sort_order, content_type, size_bytes, uploaded_by,
        relative_path, sha256, created_at, updated_at
      FROM media_assets ORDER BY created_at, id
    `).all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      trip_id: trip.id,
      destination_id: destination.id,
      activity_id: null,
      bucket_id: 'provider-images',
      object_path: 'provider/kyoto/golden-pavilion.webp',
      caption: 'Golden Pavilion',
      credit: 'Kyoto archive',
      sort_order: 0,
      content_type: 'image/webp',
      size_bytes: 17,
      uploaded_by: 'provider-import',
      relative_path: expect.stringMatching(/^media\/.+\.webp$/),
      sha256: createHash('sha256').update('destination image').digest('hex'),
      created_at: '2026-08-17T10:00:00.000Z',
      updated_at: '2026-08-17T10:00:00.000Z',
    });
    for (const row of rows) {
      expect(readFileSync(join(harness.dataDirectory, row.relative_path as string))).toBeTruthy();
    }
    expect(harness.events.slice(-2)).toEqual([
      { scope: 'trip', tripId: trip.id, revision: 3 },
      { scope: 'trip', tripId: trip.id, revision: 4 },
    ]);
  });

  it('removes newly committed active bytes and rolls metadata back when its SQLite insert fails', async () => {
    const harness = createRepositoryHarness();
    const { destination, repository } = await createTripWithDestination(harness);
    harness.database.connection.exec(`
      CREATE TRIGGER fail_media_insert
      BEFORE INSERT ON media_assets
      BEGIN
        SELECT RAISE(ABORT, 'forced media insert failure');
      END;
    `);

    await expect(repository.createDestinationMedia(1, destination.id, {
      bytes: imageStream('uncommitted image'),
      contentType: 'image/png',
    })).rejects.toThrow('forced media insert failure');

    expect(harness.database.connection.prepare('SELECT COUNT(*) AS count FROM media_assets').get())
      .toEqual({ count: 0 });
    expect(readdirSync(join(harness.dataDirectory, 'media')).filter((name) => name !== '.staging'))
      .toEqual([]);
    expect(readdirSync(join(harness.dataDirectory, 'media', '.staging'))).toEqual([]);
    expect(readdirSync(join(harness.dataDirectory, 'trash'))).toEqual([]);
    await expect(repository.load()).resolves.toMatchObject({ revision: 1 });
  });

  it('updates captions and credits and requires an exact media ID set when reordering', async () => {
    const harness = createRepositoryHarness();
    const { destination, repository } = await createTripWithDestination(harness);
    const first = (await repository.createDestinationMedia(1, destination.id, {
      bytes: imageStream('first'), contentType: 'image/png', caption: 'First',
    })).mediaItem!;
    const second = (await repository.createDestinationMedia(2, destination.id, {
      bytes: imageStream('second'), contentType: 'image/png', caption: 'Second',
    })).mediaItem!;

    const updated = await repository.updateDestinationMedia(3, first.id, {
      caption: 'Updated first',
      credit: 'Example photographer',
    });
    expect(updated).toMatchObject({
      revision: 4,
      mediaItem: { ...first, caption: 'Updated first', credit: 'Example photographer' },
    });

    await expect(repository.reorderDestinationMedia(4, destination.id, [second.id, second.id]))
      .rejects.toThrow('Media order must include each destination media item exactly once.');
    await expect(repository.load()).resolves.toMatchObject({ revision: 4 });

    const reordered = await repository.reorderDestinationMedia(4, destination.id, [second.id, first.id]);
    expect(reordered).toEqual({
      revision: 5,
      mediaItems: [
        { ...second, sortOrder: 0 },
        { ...first, caption: 'Updated first', credit: 'Example photographer', sortOrder: 1 },
      ],
    });
  });

  it('restores bytes and metadata when a media delete transaction fails', async () => {
    const harness = createRepositoryHarness();
    const { destination, repository } = await createTripWithDestination(harness);
    const created = await repository.createDestinationMedia(1, destination.id, {
      bytes: imageStream('restore after rollback'), contentType: 'image/jpeg',
    });
    const row = harness.database.connection.prepare(
      'SELECT relative_path FROM media_assets WHERE id = ?',
    ).get(created.mediaItem!.id) as { relative_path: string };
    harness.database.connection.exec(`
      CREATE TRIGGER fail_media_delete
      BEFORE DELETE ON media_assets
      BEGIN
        SELECT RAISE(ABORT, 'forced media delete failure');
      END;
    `);

    await expect(repository.deleteDestinationMedia(2, created.mediaItem!.id)).rejects.toThrow(
      'forced media delete failure',
    );

    expect(readFileSync(join(harness.dataDirectory, row.relative_path), 'utf8'))
      .toBe('restore after rollback');
    expect(readdirSync(join(harness.dataDirectory, 'trash'))).toEqual([]);
    await expect(repository.listDestinationMedia(destination.id)).resolves.toEqual([created.mediaItem]);
    await expect(repository.load()).resolves.toMatchObject({ revision: 2 });
  });

  it('moves every destination-owned byte to trash before cascading destination metadata', async () => {
    const harness = createRepositoryHarness();
    const { destination, repository } = await createTripWithDestination(harness);
    const activity = (await repository.mutate(1, {
      type: 'create-activity', input: { destinationId: destination.id, title: 'Walk' },
    })).activity!;
    await repository.createDestinationMedia(2, destination.id, {
      bytes: imageStream('destination'), contentType: 'image/png',
    });
    await repository.createActivityMedia(3, destination.id, activity.id, {
      bytes: imageStream('activity'), contentType: 'image/png',
    });

    await expect(repository.mutate(4, {
      type: 'delete-destination', destinationId: destination.id,
    })).resolves.toEqual({ revision: 5 });

    expect(harness.database.connection.prepare('SELECT COUNT(*) AS count FROM media_assets').get())
      .toEqual({ count: 0 });
    expect(readdirSync(join(harness.dataDirectory, 'media')).filter((name) => name !== '.staging'))
      .toEqual([]);
    expect(readdirSync(join(harness.dataDirectory, 'trash'))).toHaveLength(2);
  });

  it('moves every trip-owned byte to trash before cascading whole-trip metadata', async () => {
    const harness = createRepositoryHarness();
    const { destination, repository, trip } = await createTripWithDestination(harness);
    await repository.createDestinationMedia(1, destination.id, {
      bytes: imageStream('whole trip'), contentType: 'image/webp',
    });

    await expect(harness.directory.delete(1, trip.id)).resolves.toEqual({ revision: 2 });

    expect(harness.database.connection.prepare('SELECT COUNT(*) AS count FROM media_assets').get())
      .toEqual({ count: 0 });
    expect(readdirSync(join(harness.dataDirectory, 'media')).filter((name) => name !== '.staging'))
      .toEqual([]);
    expect(readdirSync(join(harness.dataDirectory, 'trash'))).toHaveLength(1);
  });
});
