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
  BackupOperationsUnavailableError,
  createPlotterHttpHandler,
  type MediaContentReader,
  type PlotterBackupOperations,
} from './http';
import { createMediaStore, type MediaStore } from './mediaStore';
import { searchWebImages } from './providers/imageSearch';
import { fetchLinkPreview } from './providers/linkPreview';
import { fetchRemoteImage } from './providers/remoteImage';
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
        || row.size_bytes < 0
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

const unavailableBackups: PlotterBackupOperations = {
  async create() { throw new BackupOperationsUnavailableError(); },
  async list() { throw new BackupOperationsUnavailableError(); },
  async inspect() { throw new BackupOperationsUnavailableError(); },
  async restore() { throw new BackupOperationsUnavailableError(); },
};

function unavailableDependency<T>(): T {
  return new Proxy<Record<string, never>>({}, {
    get() {
      return async () => { throw new Error('Plotter storage is unavailable.'); };
    },
  }) as T;
}

let database: PlotterDatabase | undefined;
let ready = false;
const events = createRevisionEventBus();
let directory: RevisionedDirectoryStore;
let tripRepository: (tripId: string) => RevisionedTripStore;
let media: MediaStore;
let mediaContent: MediaContentReader;

try {
  database = openPlotterDatabase(join(serviceArguments.dataDir, 'plotter.sqlite3'));
  media = createMediaStore(serviceArguments.dataDir);
  const writes = createWriteCoordinator(
    database,
    createBackupStore(join(serviceArguments.dataDir, 'backups')),
    events,
  );
  directory = createSqliteDirectoryRepository(database, writes, media);
  tripRepository = (tripId) => createSqliteTripRepository(database!, writes, tripId, media);
  mediaContent = createMediaContentReader(database, media);
  ready = true;
} catch {
  directory = unavailableDependency<RevisionedDirectoryStore>();
  tripRepository = () => unavailableDependency<RevisionedTripStore>();
  media = unavailableDependency<MediaStore>();
  mediaContent = unavailableDependency<MediaContentReader>();
}

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
  backups: unavailableBackups,
  publicRoot: resolve(repositoryRoot, 'dist'),
});

const server = createServer((request, response) => {
  void handler(request, response);
});

function closeService(): void {
  server.close(() => {
    database?.close();
  });
}

process.once('SIGINT', closeService);
process.once('SIGTERM', closeService);
server.listen(serviceArguments.port, '127.0.0.1');
