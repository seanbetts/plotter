import { join } from 'node:path';
import { createBackupStore } from './backupStore';
import { openPlotterDatabase, type PlotterDatabase } from './database';
import { createSqliteDirectoryRepository, type RevisionedDirectoryStore } from './directoryRepository';
import { createRevisionEventBus } from './events';
import type {
  MediaContentReader,
  PlotterBackupOperations,
  PlotterHttpDependencies,
} from './http';
import { createMediaStore, type MediaStore } from './mediaStore';
import {
  createPortableBackupOperations,
  createStorageOperationGate,
  recoverInterruptedPortableRestore,
  type PortableBackupDurability,
  type StorageOperationGate,
} from './portableBackup';
import { createSqliteTripRepository, type RevisionedTripStore } from './tripRepository';
import { createWriteCoordinator } from './writeCoordinator';

type StorageRuntime = {
  database: PlotterDatabase;
  directory: RevisionedDirectoryStore;
  tripRepository(tripId: string): RevisionedTripStore;
  media: MediaStore;
  mediaContent: MediaContentReader;
};

export type PlotterStorageRuntime = Pick<
  PlotterHttpDependencies,
  'directory' | 'tripRepository' | 'media' | 'mediaContent' | 'events' | 'readiness' | 'backups'
> & {
  operations: StorageOperationGate;
  close(): void;
};

export type CreatePlotterStorageRuntimeOptions = {
  dataDirectory: string;
  backupDurability?: PortableBackupDurability;
};

function createMediaContentReader(database: PlotterDatabase, media: MediaStore): MediaContentReader {
  const readMetadata = database.connection.prepare(`
    SELECT content_type, size_bytes, relative_path
    FROM media_assets
    WHERE id = ?
  `);
  const extensions: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
  };

  return {
    async open(mediaId) {
      const row = readMetadata.get(mediaId) as {
        content_type?: unknown;
        size_bytes?: unknown;
        relative_path?: unknown;
      } | undefined;
      if (!row) throw new Error('Media item not found.');
      if (
        typeof row.content_type !== 'string'
        || typeof row.size_bytes !== 'number'
        || !Number.isSafeInteger(row.size_bytes)
        || row.size_bytes <= 0
        || typeof row.relative_path !== 'string'
        || extensions[row.content_type] === undefined
      ) {
        throw new Error('Stored media metadata is invalid.');
      }
      const opened = await media.open(row.relative_path);
      if (opened.contentLength !== row.size_bytes) throw new Error('Stored media bytes are invalid.');
      return {
        contentType: row.content_type,
        contentLength: opened.contentLength,
        filename: `${mediaId}.${extensions[row.content_type]}`,
        bytes: opened.bytes,
      };
    },
  };
}

function unavailableDependency<T>(): T {
  return new Proxy<Record<string, never>>({}, {
    get() {
      return async () => { throw new Error('Plotter storage is unavailable.'); };
    },
  }) as T;
}

export async function createPlotterStorageRuntime(
  options: CreatePlotterStorageRuntimeOptions,
): Promise<PlotterStorageRuntime> {
  let runtime: StorageRuntime | undefined;
  let ready = false;
  const events = createRevisionEventBus();
  const operations = createStorageOperationGate();
  let backupOperations: PlotterBackupOperations = unavailableDependency<PlotterBackupOperations>();

  function requireRuntime(): StorageRuntime {
    if (!runtime) throw new Error('Plotter storage is unavailable.');
    return runtime;
  }

  function openStorageRuntime(): void {
    let database: PlotterDatabase | undefined;
    try {
      database = openPlotterDatabase(join(options.dataDirectory, 'plotter.sqlite3'));
      const media = createMediaStore(options.dataDirectory);
      const writes = createWriteCoordinator(
        database,
        createBackupStore(join(options.dataDirectory, 'backups')),
        events,
      );
      runtime = {
        database,
        directory: createSqliteDirectoryRepository(database, writes, media),
        tripRepository: (tripId) => createSqliteTripRepository(database!, writes, tripId, media),
        media,
        mediaContent: createMediaContentReader(database, media),
      };
      ready = true;
    } catch (error) {
      try { database?.close(); } catch { /* Preserve the stable readiness failure. */ }
      runtime = undefined;
      ready = false;
      throw error;
    }
  }

  function closeStorageRuntime(): void {
    ready = false;
    const closing = runtime;
    runtime = undefined;
    closing?.database.close();
  }

  try {
    await recoverInterruptedPortableRestore(options.dataDirectory, options.backupDurability);
    openStorageRuntime();
    backupOperations = createPortableBackupOperations({
      dataDirectory: options.dataDirectory,
      currentDatabase: () => requireRuntime().database,
      closeStorage: closeStorageRuntime,
      openStorage: openStorageRuntime,
      publishRestoreReset: (input) => events.restoreReset(input),
      durability: options.backupDurability,
    });
  } catch {
    try { closeStorageRuntime(); } catch { /* Readiness remains false. */ }
  }

  const directory: RevisionedDirectoryStore = {
    load: (...arguments_) => requireRuntime().directory.load(...arguments_),
    create: (...arguments_) => requireRuntime().directory.create(...arguments_),
    update: (...arguments_) => requireRuntime().directory.update(...arguments_),
    delete: (...arguments_) => requireRuntime().directory.delete(...arguments_),
  };
  const tripRepository = (tripId: string): RevisionedTripStore => ({
    load: async (...arguments_) => requireRuntime().tripRepository(tripId).load(...arguments_),
    mutate: async (...arguments_) => requireRuntime().tripRepository(tripId).mutate(...arguments_),
    listDestinationMedia: async (...arguments_) => requireRuntime().tripRepository(tripId)
      .listDestinationMedia(...arguments_),
    listActivityMedia: async (...arguments_) => requireRuntime().tripRepository(tripId)
      .listActivityMedia(...arguments_),
    createDestinationMedia: async (...arguments_) => requireRuntime().tripRepository(tripId)
      .createDestinationMedia(...arguments_),
    createActivityMedia: async (...arguments_) => requireRuntime().tripRepository(tripId)
      .createActivityMedia(...arguments_),
    updateDestinationMedia: async (...arguments_) => requireRuntime().tripRepository(tripId)
      .updateDestinationMedia(...arguments_),
    updateActivityMedia: async (...arguments_) => requireRuntime().tripRepository(tripId)
      .updateActivityMedia(...arguments_),
    deleteDestinationMedia: async (...arguments_) => requireRuntime().tripRepository(tripId)
      .deleteDestinationMedia(...arguments_),
    deleteActivityMedia: async (...arguments_) => requireRuntime().tripRepository(tripId)
      .deleteActivityMedia(...arguments_),
    reorderDestinationMedia: async (...arguments_) => requireRuntime().tripRepository(tripId)
      .reorderDestinationMedia(...arguments_),
    reorderActivityMedia: async (...arguments_) => requireRuntime().tripRepository(tripId)
      .reorderActivityMedia(...arguments_),
  });
  const media: MediaStore = {
    stage: (...arguments_) => requireRuntime().media.stage(...arguments_),
    commit: (...arguments_) => requireRuntime().media.commit(...arguments_),
    moveToTrash: (...arguments_) => requireRuntime().media.moveToTrash(...arguments_),
    open: (...arguments_) => requireRuntime().media.open(...arguments_),
  };
  const mediaContent: MediaContentReader = {
    open: (...arguments_) => requireRuntime().mediaContent.open(...arguments_),
  };
  const backups: PlotterBackupOperations = {
    create: async () => {
      requireRuntime();
      return backupOperations.create();
    },
    list: async () => {
      requireRuntime();
      return backupOperations.list();
    },
    inspect: async (backupId) => {
      requireRuntime();
      return backupOperations.inspect(backupId);
    },
    restore: async (backupId, request) => {
      requireRuntime();
      return backupOperations.restore(backupId, request);
    },
  };

  return {
    directory,
    tripRepository,
    media,
    mediaContent,
    events,
    readiness: () => ({ ready }),
    backups,
    operations,
    close: closeStorageRuntime,
  };
}
