import { createServer } from 'node:http';
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseServiceArguments } from './args';
import { createBackupStore } from './backupStore';
import { openPlotterDatabase, type PlotterDatabase } from './database';
import { createSqliteDirectoryRepository, type RevisionedDirectoryStore } from './directoryRepository';
import { createRevisionEventBus } from './events';
import {
  createPlotterHttpHandler,
  type MediaContentReader,
  type PlotterBackupOperations,
} from './http';
import { createMediaStore, type MediaStore } from './mediaStore';
import { searchWebImages } from './providers/imageSearch';
import { fetchLinkPreview } from './providers/linkPreview';
import { fetchRemoteImage } from './providers/remoteImage';
import {
  createPortableBackupOperations,
  createStorageOperationGate,
  recoverInterruptedPortableRestore,
} from './portableBackup';
import { createSqliteTripRepository, type RevisionedTripStore } from './tripRepository';
import { createWriteCoordinator } from './writeCoordinator';

const repositoryRoot = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const serviceArguments = parseServiceArguments(process.argv.slice(2), repositoryRoot);

if (!existsSync(serviceArguments.dataDir)) {
  const initialDataDirectory = resolve(repositoryRoot, 'user-data');
  if (serviceArguments.dataDir !== initialDataDirectory) {
    throw new Error('The service data directory must exist or be the repository user-data directory.');
  }
  mkdirSync(initialDataDirectory);
}

if (serviceArguments.envFile !== undefined) {
  try {
    process.loadEnvFile(serviceArguments.envFile);
  } catch {
    throw new Error('The service env file could not be loaded.');
  }
}

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

type StorageRuntime = {
  database: PlotterDatabase;
  directory: RevisionedDirectoryStore;
  tripRepository(tripId: string): RevisionedTripStore;
  media: MediaStore;
  mediaContent: MediaContentReader;
};

let runtime: StorageRuntime | undefined;
let ready = false;
const events = createRevisionEventBus();
const operations = createStorageOperationGate();
let backups: PlotterBackupOperations = unavailableDependency<PlotterBackupOperations>();

function requireRuntime(): StorageRuntime {
  if (!runtime) throw new Error('Plotter storage is unavailable.');
  return runtime;
}

function openStorageRuntime(): void {
  let database: PlotterDatabase | undefined;
  try {
    database = openPlotterDatabase(join(serviceArguments.dataDir, 'plotter.sqlite3'));
    const media = createMediaStore(serviceArguments.dataDir);
    const writes = createWriteCoordinator(
      database,
      createBackupStore(join(serviceArguments.dataDir, 'backups')),
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
  await recoverInterruptedPortableRestore(serviceArguments.dataDir);
  openStorageRuntime();
  backups = createPortableBackupOperations({
    dataDirectory: serviceArguments.dataDir,
    currentDatabase: () => requireRuntime().database,
    closeStorage: closeStorageRuntime,
    openStorage: openStorageRuntime,
    publishRestoreReset: (input) => events.restoreReset(input),
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
const tripRepository = (tripId: string) => requireRuntime().tripRepository(tripId);
const media: MediaStore = {
  stage: (...arguments_) => requireRuntime().media.stage(...arguments_),
  commit: (...arguments_) => requireRuntime().media.commit(...arguments_),
  moveToTrash: (...arguments_) => requireRuntime().media.moveToTrash(...arguments_),
  open: (...arguments_) => requireRuntime().media.open(...arguments_),
};
const mediaContent: MediaContentReader = {
  open: (...arguments_) => requireRuntime().mediaContent.open(...arguments_),
};

const handler = createPlotterHttpHandler({
  directory,
  tripRepository,
  media,
  mediaContent,
  events,
  readiness: () => ({ ready }),
  providers: {
    linkPreview: fetchLinkPreview,
    imageSearch: searchWebImages,
    remoteImage: fetchRemoteImage,
    imageSearchApiKey: process.env.SERPAPI_API_KEY,
  },
  backups,
  operations,
  publicRoot: resolve(repositoryRoot, 'dist'),
});

const server = createServer((request, response) => {
  void handler(request, response);
});

function closeService(): void {
  server.close(() => {
    closeStorageRuntime();
  });
}

process.once('SIGINT', closeService);
process.once('SIGTERM', closeService);
server.listen(serviceArguments.port, '127.0.0.1');
