import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDestination } from '../src/domain/destinations';
import { TripStorageConflictError, type RevisionEvent } from '../src/storage/revision';
import { openPlotterDatabase, type PlotterDatabase } from './database';
import { createSqliteDirectoryRepository } from './directoryRepository';
import { createRevisionEventBus } from './events';
import {
  MAX_MEDIA_BYTES,
  createMediaStore,
  type MediaStoreOptions,
  type StoredMediaObject,
} from './mediaStore';
import { createSqliteTripRepository } from './tripRepository';
import { createWriteCoordinator } from './writeCoordinator';

const temporaryDirectories: string[] = [];
const openDatabases: PlotterDatabase[] = [];

function createHarness(options: MediaStoreOptions = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'plotter-media-store-'));
  temporaryDirectories.push(directory);
  return {
    directory,
    media: createMediaStore(directory, options),
  };
}

function createRepositoryHarness(options: {
  media?: MediaStoreOptions;
  onBackup?(revision: number): void;
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'plotter-media-repository-'));
  temporaryDirectories.push(directory);
  const database = openPlotterDatabase(join(directory, 'plotter.sqlite3'));
  openDatabases.push(database);
  const events: RevisionEvent[] = [];
  const eventBus = createRevisionEventBus({
    initialEpoch: '00000000-0000-4000-8000-000000000001',
  });
  eventBus.subscribe((event) => events.push(event));
  const writes = createWriteCoordinator(
    database,
    {
      async createAutomaticBackup(_connection, revision) {
        options.onBackup?.(revision);
        return join(directory, 'backup.sqlite3');
      },
    },
    eventBus,
  );
  const media = createMediaStore(directory, options.media);
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

async function createInterruptedDeleteLinkState(value = 'durable trash link') {
  let interruptDelete = false;
  const harness = createRepositoryHarness({
    media: {
      async onPhase(phase) {
        if (interruptDelete && phase === 'trash-link-durable') {
          throw new Error('interrupt:trash-link-durable');
        }
      },
    },
  });
  const { destination, repository } = await createTripWithDestination(harness);
  const created = await repository.createDestinationMedia(1, destination.id, {
    bytes: imageStream(value), contentType: 'image/png',
  });
  const row = harness.database.connection.prepare(
    'SELECT relative_path FROM media_assets WHERE id = ?',
  ).get(created.mediaItem!.id) as { relative_path: string };
  const activePath = join(harness.dataDirectory, row.relative_path);
  interruptDelete = true;
  const interruption = await repository.deleteDestinationMedia(2, created.mediaItem!.id)
    .catch((error: unknown) => error);
  if (!(interruption instanceof Error) || interruption.message !== 'interrupt:trash-link-durable') {
    throw new Error('Delete did not stop at the durable trash-link phase.');
  }
  const operationDirectory = join(harness.dataDirectory, '.media-operations');
  const trashDirectory = join(harness.dataDirectory, 'trash');
  const trashPath = join(trashDirectory, readdirSync(trashDirectory)[0]);
  return {
    activePath,
    created,
    harness,
    operationDirectory,
    trashDirectory,
    trashPath,
    value,
  };
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

  it('removes and directory-syncs a partial temporary file when its input stream fails', async () => {
    const syncs: Array<{ path: string; phase: string }> = [];
    const harness = createHarness({
      async syncDirectory(path, phase) { syncs.push({ path, phase }); },
    });

    await expect(harness.media.stage(failingStream(), 'image/png')).rejects.toThrow(
      'upload interrupted',
    );
    expect(readdirSync(join(harness.directory, 'media', '.staging'))).toEqual([]);
    expect(syncs).toContainEqual({
      path: realpathSync(join(harness.directory, 'media', '.staging')),
      phase: 'media-discarded',
    });
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

  it.each(['_media', '-media', `a${'b'.repeat(128)}`])(
    'rejects non-canonical media identity %s before publishing bytes',
    async (mediaId) => {
      const harness = createHarness();
      const staged = await harness.media.stage(imageStream('invalid identity'), 'image/png');

      await expect(harness.media.commit(staged, mediaId)).rejects.toThrow(
        'Media identity is invalid.',
      );

      expect(readdirSync(join(harness.directory, 'media')).filter((name) => name !== '.staging'))
        .toEqual([]);
    },
  );

  it.each(['a', `a${'b'.repeat(127)}`])(
    'accepts canonical media identity boundary %s',
    async (mediaId) => {
      const harness = createHarness();
      const staged = await harness.media.stage(imageStream('boundary identity'), 'image/png');

      await expect(harness.media.commit(staged, mediaId)).resolves.toMatchObject({
        relativePath: `media/${mediaId}.png`,
      });
    },
  );

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

  it('rejects an occupied generated trash path without replacing either file', async () => {
    const trashId = '00000000-0000-4000-8000-000000000041';
    const harness = createHarness({ randomId: () => trashId });
    const committed = await harness.media.commit(
      await harness.media.stage(imageStream('active bytes'), 'image/jpeg'),
      'media-collision',
    );
    const collisionPath = join(
      harness.directory,
      'trash',
      `media-collision-${trashId}.jpg`,
    );
    writeFileSync(collisionPath, 'existing recovery bytes');

    await expect(harness.media.moveToTrash(committed.relativePath, 'media-collision'))
      .rejects.toThrow('Media trash target already exists.');

    expect(readFileSync(join(harness.directory, committed.relativePath), 'utf8'))
      .toBe('active bytes');
    expect(readFileSync(collisionPath, 'utf8')).toBe('existing recovery bytes');
  });

  it.each([1, 2])(
    'restores active bytes when trash directory sync step %i fails',
    async (failedSync) => {
      let armed = false;
      let trashSyncs = 0;
      const harness = createHarness({
        async syncDirectory(_path, phase) {
          if (armed && phase === 'media-trashed') {
            trashSyncs += 1;
            if (trashSyncs === failedSync) throw new Error('forced trash sync failure');
          }
        },
      });
      const committed = await harness.media.commit(
        await harness.media.stage(imageStream('restore after sync failure'), 'image/png'),
        `trash-sync-${failedSync}`,
      );
      armed = true;

      await expect(harness.media.moveToTrash(committed.relativePath, `trash-sync-${failedSync}`))
        .rejects.toThrow('forced trash sync failure');

      expect(readFileSync(join(harness.directory, committed.relativePath), 'utf8'))
        .toBe('restore after sync failure');
      expect(readdirSync(join(harness.directory, 'trash'))).toEqual([]);
    },
  );

  it('does not unlink active bytes when a trash target is swapped at the durability boundary', async () => {
    let armed = false;
    let swapped = false;
    const harness = createHarness({
      async syncDirectory(path, phase) {
        if (!armed || swapped || phase !== 'media-trashed') return;
        const target = join(path, readdirSync(path)[0]);
        rmSync(target);
        writeFileSync(target, 'replacement bytes');
        swapped = true;
      },
    });
    const committed = await harness.media.commit(
      await harness.media.stage(imageStream('owned active bytes'), 'image/png'),
      'trash-swap',
    );
    armed = true;

    await expect(harness.media.moveToTrash(committed.relativePath, 'trash-swap'))
      .rejects.toThrow('Media filesystem identity changed.');

    expect(readFileSync(join(harness.directory, committed.relativePath), 'utf8'))
      .toBe('owned active bytes');
    const trashEntry = readdirSync(join(harness.directory, 'trash'))[0];
    expect(readFileSync(join(harness.directory, 'trash', trashEntry), 'utf8'))
      .toBe('replacement bytes');
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

  it('syncs both rename parents before a canonical media publication succeeds', async () => {
    const syncs: Array<{ path: string; phase: string }> = [];
    const harness = createHarness({
      async syncDirectory(path, phase) {
        syncs.push({ path, phase });
      },
    });
    const staged = await harness.media.stage(imageStream('durable media'), 'image/png');

    const committed = await harness.media.commit(staged, 'durable-media');

    const published = syncs.filter(({ phase }) => phase === 'media-published');
    const canonicalDirectory = realpathSync(harness.directory);
    expect(published.map(({ path }) => path).sort()).toEqual([
      join(canonicalDirectory, 'media'),
      join(canonicalDirectory, 'media', '.staging'),
    ].sort());
    expect(readFileSync(join(harness.directory, committed.relativePath), 'utf8'))
      .toBe('durable media');
  });

  it('restores staged bytes when canonical media publication cannot be synced', async () => {
    let failed = false;
    const harness = createHarness({
      async syncDirectory(_path, phase) {
        if (phase === 'media-published' && !failed) {
          failed = true;
          throw new Error('forced media directory sync failure');
        }
      },
    });
    const staged = await harness.media.stage(imageStream('not durable'), 'image/png');

    await expect(harness.media.commit(staged, 'not-durable')).rejects.toThrow(
      'forced media directory sync failure',
    );

    expect(readdirSync(join(harness.directory, 'media')).filter((name) => name !== '.staging'))
      .toEqual([]);
    expect(readdirSync(join(harness.directory, 'media', '.staging'))).toEqual([]);
  });
});

describe('durable media operation recovery', () => {
  it('recovers a delete interrupted after the trash link is durable but before active unlink', async () => {
    const {
      activePath,
      created,
      harness,
      operationDirectory,
      trashDirectory,
      trashPath,
    } = await createInterruptedDeleteLinkState();
    const activeIdentity = lstatSync(activePath);
    const trashIdentity = lstatSync(trashPath);
    expect({ device: trashIdentity.dev, inode: trashIdentity.ino }).toEqual({
      device: activeIdentity.dev,
      inode: activeIdentity.ino,
    });
    expect(readFileSync(activePath, 'utf8')).toBe('durable trash link');
    expect(readFileSync(trashPath, 'utf8')).toBe('durable trash link');
    expect(readdirSync(operationDirectory)).toHaveLength(1);
    expect(harness.database.connection.prepare(
      'SELECT COUNT(*) AS count FROM media_assets WHERE id = ?',
    ).get(created.mediaItem!.id)).toEqual({ count: 1 });

    const recoverySyncs: Array<{ path: string; phase: string }> = [];
    const restarted = createMediaStore(harness.dataDirectory, {
      async syncDirectory(path, phase) {
        recoverySyncs.push({ path, phase });
      },
    });
    await restarted.recoverPendingOperations(harness.database.connection);

    expect(readFileSync(activePath, 'utf8')).toBe('durable trash link');
    expect(readdirSync(trashDirectory)).toEqual([]);
    expect(readdirSync(operationDirectory)).toEqual([]);
    expect(recoverySyncs).toContainEqual({
      path: realpathSync(trashDirectory),
      phase: 'recovery-applied',
    });
    const trashCleanupSync = recoverySyncs.findIndex(({ path, phase }) => (
      path === realpathSync(trashDirectory) && phase === 'recovery-applied'
    ));
    const intentClearSync = recoverySyncs.findIndex(({ path, phase }) => (
      path === realpathSync(operationDirectory) && phase === 'intent-cleared'
    ));
    expect(trashCleanupSync).toBeGreaterThanOrEqual(0);
    expect(intentClearSync).toBeGreaterThan(trashCleanupSync);
  });

  it('rejects separate active and trash inodes even when both files match metadata', async () => {
    const state = await createInterruptedDeleteLinkState('separate canonical copies');
    rmSync(state.trashPath);
    writeFileSync(state.trashPath, state.value, { mode: 0o600 });
    const activeIdentity = lstatSync(state.activePath);
    const trashIdentity = lstatSync(state.trashPath);
    expect({ device: trashIdentity.dev, inode: trashIdentity.ino }).not.toEqual({
      device: activeIdentity.dev,
      inode: activeIdentity.ino,
    });

    await expect(createMediaStore(state.harness.dataDirectory)
      .recoverPendingOperations(state.harness.database.connection))
      .rejects.toThrow('Pending media recovery is incomplete.');

    expect(readFileSync(state.activePath, 'utf8')).toBe(state.value);
    expect(readFileSync(state.trashPath, 'utf8')).toBe(state.value);
    expect(readdirSync(state.operationDirectory)).toHaveLength(1);
  });

  it.each([
    {
      name: 'different bytes',
      mutate({ trashPath }: Awaited<ReturnType<typeof createInterruptedDeleteLinkState>>) {
        rmSync(trashPath);
        writeFileSync(trashPath, 'different bytes', { mode: 0o600 });
      },
    },
    {
      name: 'non-private mode',
      mutate({ trashPath, value }: Awaited<ReturnType<typeof createInterruptedDeleteLinkState>>) {
        rmSync(trashPath);
        writeFileSync(trashPath, value, { mode: 0o600 });
        chmodSync(trashPath, 0o640);
      },
    },
    {
      name: 'symlink',
      mutate({ activePath, trashPath }: Awaited<ReturnType<typeof createInterruptedDeleteLinkState>>) {
        rmSync(trashPath);
        symlinkSync(activePath, trashPath);
      },
    },
    {
      name: 'different active bytes',
      mutate({ activePath }: Awaited<ReturnType<typeof createInterruptedDeleteLinkState>>) {
        rmSync(activePath);
        writeFileSync(activePath, 'different active bytes', { mode: 0o600 });
      },
    },
    {
      name: 'non-private active mode',
      mutate({ activePath, value }: Awaited<ReturnType<typeof createInterruptedDeleteLinkState>>) {
        rmSync(activePath);
        writeFileSync(activePath, value, { mode: 0o600 });
        chmodSync(activePath, 0o640);
      },
    },
    {
      name: 'active symlink',
      mutate({ activePath, trashPath }: Awaited<ReturnType<typeof createInterruptedDeleteLinkState>>) {
        rmSync(activePath);
        symlinkSync(trashPath, activePath);
      },
    },
  ])('retains both paths and the journal when redundant trash has $name', async ({ mutate }) => {
    const state = await createInterruptedDeleteLinkState();
    mutate(state);

    await expect(createMediaStore(state.harness.dataDirectory)
      .recoverPendingOperations(state.harness.database.connection))
      .rejects.toThrow('Pending media recovery is incomplete.');

    expect(existsSync(state.trashPath)).toBe(true);
    expect(existsSync(state.activePath)).toBe(true);
    expect(readdirSync(state.operationDirectory)).toHaveLength(1);
  });

  it('rejects a redundant trash path whose identity changes after validation', async () => {
    const state = await createInterruptedDeleteLinkState('stable recovery identity');
    let swapped = false;
    const restarted = createMediaStore(state.harness.dataDirectory, {
      async onPhase(phase) {
        if (!swapped && phase === 'recovery-delete-validated') {
          rmSync(state.trashPath);
          writeFileSync(state.trashPath, state.value, { mode: 0o600 });
          swapped = true;
        }
      },
    });

    await expect(restarted.recoverPendingOperations(state.harness.database.connection))
      .rejects.toThrow('Pending media recovery is incomplete.');

    expect(swapped).toBe(true);
    expect(readFileSync(state.activePath, 'utf8')).toBe(state.value);
    expect(readFileSync(state.trashPath, 'utf8')).toBe(state.value);
    expect(readdirSync(state.operationDirectory)).toHaveLength(1);
  });

  it.each(['active', 'trash'] as const)(
    'retains both hard links when %s bytes change in place after validation',
    async (changedPath) => {
      const state = await createInterruptedDeleteLinkState('AAAAAAAAAAAAAAAA');
      const initialActiveIdentity = lstatSync(state.activePath);
      const initialTrashIdentity = lstatSync(state.trashPath);
      expect({ device: initialTrashIdentity.dev, inode: initialTrashIdentity.ino }).toEqual({
        device: initialActiveIdentity.dev,
        inode: initialActiveIdentity.ino,
      });
      let changed = false;
      const restarted = createMediaStore(state.harness.dataDirectory, {
        async onPhase(phase) {
          if (!changed && phase === 'recovery-delete-validated') {
            writeFileSync(
              changedPath === 'active' ? state.activePath : state.trashPath,
              'BBBBBBBBBBBBBBBB',
            );
            changed = true;
          }
        },
      });

      await expect(restarted.recoverPendingOperations(state.harness.database.connection))
        .rejects.toThrow('Pending media recovery is incomplete.');

      expect(changed).toBe(true);
      expect(existsSync(state.activePath)).toBe(true);
      expect(existsSync(state.trashPath)).toBe(true);
      expect(readdirSync(state.operationDirectory)).toHaveLength(1);
    },
  );

  it('revalidates active bytes after redundant trash cleanup is synced', async () => {
    const state = await createInterruptedDeleteLinkState('validate after trash cleanup');
    let changed = false;
    const restarted = createMediaStore(state.harness.dataDirectory, {
      async syncDirectory(path, phase) {
        if (
          !changed
          && path === realpathSync(state.trashDirectory)
          && phase === 'recovery-applied'
        ) {
          writeFileSync(state.activePath, 'changed after trash cleanup');
          changed = true;
        }
      },
    });

    await expect(restarted.recoverPendingOperations(state.harness.database.connection))
      .rejects.toThrow('Pending media recovery is incomplete.');

    expect(changed).toBe(true);
    expect(readFileSync(state.activePath, 'utf8')).toBe('changed after trash cleanup');
    expect(existsSync(state.trashPath)).toBe(false);
    expect(readdirSync(state.operationDirectory)).toHaveLength(1);
  });

  it('requires the private operation directory to remain exactly owner-only executable', async () => {
    const harness = createRepositoryHarness();
    const operationDirectory = join(harness.dataDirectory, '.media-operations');
    chmodSync(operationDirectory, 0o500);

    await expect(harness.media.recoverPendingOperations(harness.database.connection))
      .rejects.toThrow('Pending media recovery is incomplete.');
  });

  it('rejects non-canonical generated operation paths before publishing a journal', async () => {
    const harness = createRepositoryHarness({
      media: { randomId: () => 'not-a-uuid' },
    });
    const { destination, repository } = await createTripWithDestination(harness);

    await expect(repository.createDestinationMedia(1, destination.id, {
      bytes: imageStream('invalid operation identity'),
      contentType: 'image/png',
    })).rejects.toThrow('Pending media recovery is incomplete.');

    expect(readdirSync(join(harness.dataDirectory, '.media-operations'))).toEqual([]);
    expect(readdirSync(join(harness.dataDirectory, 'media', '.staging'))).toEqual([]);
  });

  it('removes an unpublished intent and staged bytes when intent-directory sync fails', async () => {
    let failed = false;
    const harness = createRepositoryHarness({
      media: {
        async syncDirectory(_path, phase) {
          if (phase === 'intent-published' && !failed) {
            failed = true;
            throw new Error('forced intent sync failure');
          }
        },
      },
    });
    const { destination, repository } = await createTripWithDestination(harness);

    await expect(repository.createDestinationMedia(1, destination.id, {
      bytes: imageStream('intent sync failure'),
      contentType: 'image/png',
    })).rejects.toThrow('forced intent sync failure');

    expect(readdirSync(join(harness.dataDirectory, '.media-operations'))).toEqual([]);
    expect(readdirSync(join(harness.dataDirectory, 'media')).filter((name) => name !== '.staging'))
      .toEqual([]);
    expect(readdirSync(join(harness.dataDirectory, 'media', '.staging'))).toEqual([]);
    await expect(repository.load()).resolves.toMatchObject({ revision: 1 });
  });

  it.each(['intent-durable', 'filesystem-durable'] as const)(
    'recovers an interrupted uncommitted create after %s',
    async (interruptedPhase) => {
      const harness = createRepositoryHarness({
        media: {
          async onPhase(phase) {
            if (phase === interruptedPhase) throw new Error(`interrupt:${phase}`);
          },
        },
      });
      const { destination, repository } = await createTripWithDestination(harness);

      await expect(repository.createDestinationMedia(1, destination.id, {
        bytes: imageStream('interrupted create'),
        contentType: 'image/png',
      })).rejects.toThrow(`interrupt:${interruptedPhase}`);

      const restarted = createMediaStore(harness.dataDirectory);
      await restarted.recoverPendingOperations(harness.database.connection);
      expect(harness.database.connection.prepare('SELECT COUNT(*) AS count FROM media_assets').get())
        .toEqual({ count: 0 });
      expect(readdirSync(join(harness.dataDirectory, 'media')).filter((name) => name !== '.staging'))
        .toEqual([]);
      expect(readdirSync(join(harness.dataDirectory, 'media', '.staging'))).toEqual([]);
      expect(readdirSync(join(harness.dataDirectory, '.media-operations'))).toEqual([]);
    },
  );

  it('retains a committed create and clears its leftover intent on restart', async () => {
    const harness = createRepositoryHarness({
      media: {
        async onPhase(phase) {
          if (phase === 'intent-clear-start') throw new Error('interrupt:intent-clear-start');
        },
      },
    });
    const { destination, repository } = await createTripWithDestination(harness);

    const created = await repository.createDestinationMedia(1, destination.id, {
      bytes: imageStream('committed create'),
      contentType: 'image/png',
    });

    expect(readdirSync(join(harness.dataDirectory, '.media-operations'))).toHaveLength(1);
    const row = harness.database.connection.prepare(
      'SELECT relative_path FROM media_assets WHERE id = ?',
    ).get(created.mediaItem!.id) as { relative_path: string };
    const restarted = createMediaStore(harness.dataDirectory);
    await restarted.recoverPendingOperations(harness.database.connection);
    expect(readFileSync(join(harness.dataDirectory, row.relative_path), 'utf8'))
      .toBe('committed create');
    expect(readdirSync(join(harness.dataDirectory, '.media-operations'))).toEqual([]);
  });

  it('rejects a journal whose private file mode changed and retains it', async () => {
    const harness = createRepositoryHarness({
      media: {
        async onPhase(phase) {
          if (phase === 'intent-clear-start') throw new Error('interrupt:intent-clear-start');
        },
      },
    });
    const { destination, repository } = await createTripWithDestination(harness);
    await repository.createDestinationMedia(1, destination.id, {
      bytes: imageStream('private journal'), contentType: 'image/png',
    });
    const operationDirectory = join(harness.dataDirectory, '.media-operations');
    const journalPath = join(operationDirectory, readdirSync(operationDirectory)[0]);
    chmodSync(journalPath, 0o644);

    await expect(createMediaStore(harness.dataDirectory)
      .recoverPendingOperations(harness.database.connection))
      .rejects.toThrow('Pending media recovery is incomplete.');
    expect(readdirSync(operationDirectory)).toHaveLength(1);
  });

  it('rejects an in-root active-path symlink without blessing or deleting its target', async () => {
    let retainIntent = false;
    const harness = createRepositoryHarness({
      media: {
        async onPhase(phase) {
          if (retainIntent && phase === 'intent-clear-start') {
            throw new Error('interrupt:intent-clear-start');
          }
        },
      },
    });
    const { destination, repository } = await createTripWithDestination(harness);
    retainIntent = true;
    const created = await repository.createDestinationMedia(1, destination.id, {
      bytes: imageStream('symlink target bytes'), contentType: 'image/png',
    });
    const row = harness.database.connection.prepare(
      'SELECT relative_path FROM media_assets WHERE id = ?',
    ).get(created.mediaItem!.id) as { relative_path: string };
    const activePath = join(harness.dataDirectory, row.relative_path);
    const otherPath = join(harness.dataDirectory, 'media', 'other.png');
    renameSync(activePath, otherPath);
    symlinkSync('other.png', activePath);

    await expect(createMediaStore(harness.dataDirectory)
      .recoverPendingOperations(harness.database.connection))
      .rejects.toThrow('Pending media recovery is incomplete.');

    expect(lstatSync(activePath).isSymbolicLink()).toBe(true);
    expect(readFileSync(otherPath, 'utf8')).toBe('symlink target bytes');
    expect(readdirSync(join(harness.dataDirectory, '.media-operations'))).toHaveLength(1);
  });

  it('fails recovery without clearing evidence when committed create bytes no longer match metadata', async () => {
    const harness = createRepositoryHarness({
      media: {
        async onPhase(phase) {
          if (phase === 'intent-clear-start') throw new Error('interrupt:intent-clear-start');
        },
      },
    });
    const { destination, repository } = await createTripWithDestination(harness);
    const created = await repository.createDestinationMedia(1, destination.id, {
      bytes: imageStream('committed create'),
      contentType: 'image/png',
    });
    const row = harness.database.connection.prepare(
      'SELECT relative_path FROM media_assets WHERE id = ?',
    ).get(created.mediaItem!.id) as { relative_path: string };
    writeFileSync(join(harness.dataDirectory, row.relative_path), 'changed bytes');

    const restarted = createMediaStore(harness.dataDirectory);
    await expect(restarted.recoverPendingOperations(harness.database.connection)).rejects.toThrow(
      'Pending media recovery is incomplete.',
    );

    expect(readFileSync(join(harness.dataDirectory, row.relative_path), 'utf8'))
      .toBe('changed bytes');
    expect(readdirSync(join(harness.dataDirectory, '.media-operations'))).toHaveLength(1);
  });

  it('restores an interrupted delete while metadata exists and completes it after metadata commit', async () => {
    const harness = createRepositoryHarness();
    const { destination, repository } = await createTripWithDestination(harness);
    const created = await repository.createDestinationMedia(1, destination.id, {
      bytes: imageStream('delete recovery'), contentType: 'image/jpeg',
    });
    const row = harness.database.connection.prepare(
      'SELECT relative_path FROM media_assets WHERE id = ?',
    ).get(created.mediaItem!.id) as { relative_path: string };

    await harness.media.prepareMoveToTrash([
      { mediaId: created.mediaItem!.id, relativePath: row.relative_path },
    ]);
    await createMediaStore(harness.dataDirectory)
      .recoverPendingOperations(harness.database.connection);
    expect(readFileSync(join(harness.dataDirectory, row.relative_path), 'utf8'))
      .toBe('delete recovery');
    expect(readdirSync(join(harness.dataDirectory, 'trash'))).toEqual([]);

    const prepared = await harness.media.prepareMoveToTrash([
      { mediaId: created.mediaItem!.id, relativePath: row.relative_path },
    ]);
    harness.database.connection.prepare('DELETE FROM media_assets WHERE id = ?')
      .run(created.mediaItem!.id);
    void prepared;
    await createMediaStore(harness.dataDirectory)
      .recoverPendingOperations(harness.database.connection);
    expect(existsSync(join(harness.dataDirectory, row.relative_path))).toBe(false);
    expect(readdirSync(join(harness.dataDirectory, 'trash'))).toHaveLength(1);
    expect(readdirSync(join(harness.dataDirectory, '.media-operations'))).toEqual([]);
  });

  it('fails recovery without moving changed trash bytes back into an existing metadata row', async () => {
    const harness = createRepositoryHarness();
    const { destination, repository } = await createTripWithDestination(harness);
    const created = await repository.createDestinationMedia(1, destination.id, {
      bytes: imageStream('original delete bytes'), contentType: 'image/jpeg',
    });
    const row = harness.database.connection.prepare(
      'SELECT relative_path FROM media_assets WHERE id = ?',
    ).get(created.mediaItem!.id) as { relative_path: string };
    await harness.media.prepareMoveToTrash([
      { mediaId: created.mediaItem!.id, relativePath: row.relative_path },
    ]);
    const trashPath = join(
      harness.dataDirectory,
      'trash',
      readdirSync(join(harness.dataDirectory, 'trash'))[0],
    );
    writeFileSync(trashPath, 'changed trash bytes');

    const restarted = createMediaStore(harness.dataDirectory);
    await expect(restarted.recoverPendingOperations(harness.database.connection)).rejects.toThrow(
      'Pending media recovery is incomplete.',
    );

    expect(existsSync(join(harness.dataDirectory, row.relative_path))).toBe(false);
    expect(readFileSync(trashPath, 'utf8')).toBe('changed trash bytes');
    expect(readdirSync(join(harness.dataDirectory, '.media-operations'))).toHaveLength(1);
  });
});

describe('revisioned media metadata and filesystem coordination', () => {
  it('rejects a journaled trash collision before publishing intent and remains restartable', async () => {
    const ids = [
      '00000000-0000-4000-8000-000000000051',
      '00000000-0000-4000-8000-000000000052',
    ];
    const harness = createRepositoryHarness({
      media: { randomId: () => ids.shift()! },
    });
    const { destination, repository } = await createTripWithDestination(harness);
    const created = await repository.createDestinationMedia(1, destination.id, {
      bytes: imageStream('journal collision active'), contentType: 'image/jpeg',
    });
    const row = harness.database.connection.prepare(
      'SELECT relative_path FROM media_assets WHERE id = ?',
    ).get(created.mediaItem!.id) as { relative_path: string };
    const collisionPath = join(
      harness.dataDirectory,
      'trash',
      `${created.mediaItem!.id}-00000000-0000-4000-8000-000000000052.jpg`,
    );
    writeFileSync(collisionPath, 'pre-existing trash evidence');

    await expect(repository.deleteDestinationMedia(2, created.mediaItem!.id))
      .rejects.toThrow('Media trash target already exists.');

    expect(readFileSync(join(harness.dataDirectory, row.relative_path), 'utf8'))
      .toBe('journal collision active');
    expect(readFileSync(collisionPath, 'utf8')).toBe('pre-existing trash evidence');
    expect(readdirSync(join(harness.dataDirectory, '.media-operations'))).toEqual([]);
    await expect(createMediaStore(harness.dataDirectory)
      .recoverPendingOperations(harness.database.connection)).resolves.toBeUndefined();
    await expect(repository.load()).resolves.toMatchObject({ revision: 2 });
  });

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
      {
        kind: 'revision', epoch: '00000000-0000-4000-8000-000000000001',
        scope: 'trip', tripId: trip.id, revision: 3,
      },
      {
        kind: 'revision', epoch: '00000000-0000-4000-8000-000000000001',
        scope: 'trip', tripId: trip.id, revision: 4,
      },
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

  it('rejects an empty media reorder for a nonexistent owner without advancing revision', async () => {
    const harness = createRepositoryHarness();
    const { repository } = await createTripWithDestination(harness);

    await expect(repository.reorderDestinationMedia(1, 'missing-destination', []))
      .rejects.toThrow('Destination not found.');
    await expect(repository.reorderActivityMedia(1, 'missing-activity', []))
      .rejects.toThrow('Activity not found.');
    await expect(repository.load()).resolves.toMatchObject({ revision: 1 });
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

  it('serializes media creation before a concurrent cross-scope whole-trip delete', async () => {
    let releasePublication: (() => void) | undefined;
    const publicationGate = new Promise<void>((resolve) => { releasePublication = resolve; });
    let publicationReached: (() => void) | undefined;
    const reached = new Promise<void>((resolve) => { publicationReached = resolve; });
    let blockPublication = false;
    const harness = createRepositoryHarness({
      media: {
        async onPhase(phase) {
          if (blockPublication && phase === 'filesystem-durable') {
            publicationReached?.();
            await publicationGate;
          }
        },
      },
    });
    const { destination, repository, trip } = await createTripWithDestination(harness);
    blockPublication = true;

    const create = repository.createDestinationMedia(1, destination.id, {
      bytes: imageStream('create before trip delete'), contentType: 'image/png',
    });
    await reached;
    let deleteSettled = false;
    const tripDelete = harness.directory.delete(1, trip.id)
      .finally(() => { deleteSettled = true; });
    await Promise.resolve();
    expect(deleteSettled).toBe(false);

    releasePublication?.();
    await expect(create).resolves.toMatchObject({ revision: 2 });
    await expect(tripDelete).resolves.toEqual({ revision: 2 });
    expect(harness.database.connection.prepare('SELECT COUNT(*) AS count FROM trips').get())
      .toEqual({ count: 0 });
    expect(harness.database.connection.prepare('SELECT COUNT(*) AS count FROM media_assets').get())
      .toEqual({ count: 0 });
    expect(readdirSync(join(harness.dataDirectory, 'media')).filter((name) => name !== '.staging'))
      .toEqual([]);
    expect(readdirSync(join(harness.dataDirectory, 'trash'))).toHaveLength(1);
    expect(readdirSync(join(harness.dataDirectory, '.media-operations'))).toEqual([]);
  });

  it('keeps a media-bearing cascade in the global queue before another directory write', async () => {
    let releaseTrash: (() => void) | undefined;
    const trashGate = new Promise<void>((resolve) => { releaseTrash = resolve; });
    let trashReached: (() => void) | undefined;
    const reached = new Promise<void>((resolve) => { trashReached = resolve; });
    let blockTrash = false;
    const harness = createRepositoryHarness({
      media: {
        async onPhase(phase) {
          if (blockTrash && phase === 'filesystem-durable') {
            trashReached?.();
            await trashGate;
          }
        },
      },
    });
    const { destination, repository } = await createTripWithDestination(harness);
    await repository.createDestinationMedia(1, destination.id, {
      bytes: imageStream('cascade media'), contentType: 'image/webp',
    });
    blockTrash = true;

    const cascade = repository.mutate(2, {
      type: 'delete-destination', destinationId: destination.id,
    });
    await reached;
    let createSettled = false;
    const secondTrip = harness.directory.create(1, { expectedRevision: 1, name: 'Second' })
      .finally(() => { createSettled = true; });
    await Promise.resolve();
    expect(createSettled).toBe(false);

    releaseTrash?.();
    await expect(cascade).resolves.toEqual({ revision: 3 });
    await expect(secondTrip).resolves.toMatchObject({ revision: 2 });
    expect(harness.database.connection.prepare('SELECT COUNT(*) AS count FROM media_assets').get())
      .toEqual({ count: 0 });
    expect(readdirSync(join(harness.dataDirectory, 'trash'))).toHaveLength(1);
  });

  it('returns a stale conflict before backup or missing-content access after another delete wins', async () => {
    const backedUpRevisions: number[] = [];
    const harness = createRepositoryHarness({
      onBackup(revision) { backedUpRevisions.push(revision); },
    });
    const { destination, repository, trip } = await createTripWithDestination(harness);
    const created = await repository.createDestinationMedia(1, destination.id, {
      bytes: imageStream('one delete wins'), contentType: 'image/jpeg',
    });
    const staleRepository = harness.trip(trip.id);
    await repository.deleteDestinationMedia(2, created.mediaItem!.id);
    backedUpRevisions.splice(0);

    const error = await staleRepository.deleteDestinationMedia(2, created.mediaItem!.id)
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(TripStorageConflictError);
    expect((error as TripStorageConflictError).currentRevision).toBe(3);
    expect(backedUpRevisions).toEqual([]);
    expect(readdirSync(join(harness.dataDirectory, 'trash'))).toHaveLength(1);
    expect(readdirSync(join(harness.dataDirectory, '.media-operations'))).toEqual([]);
  });
});
