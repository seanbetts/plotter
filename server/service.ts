import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseServiceArguments, resolveServiceRepositoryRoot } from './args';
import { createPlotterHttpHandler } from './http';
import { searchWebImages } from './providers/imageSearch';
import { fetchLinkPreview } from './providers/linkPreview';
import { fetchRemoteImage } from './providers/remoteImage';
import { acquireDataDirectoryOwnership } from './maintenanceLock';
import { createPlotterStorageRuntime } from './storageRuntime';

const moduleDirectory = realpathSync(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = resolveServiceRepositoryRoot(process.argv.slice(2), moduleDirectory);
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
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      // The manifest always supplies the repository .env path, but provider keys are optional.
    } else {
      throw new Error('The service env file could not be loaded.', { cause: error });
    }
  }
}

const dataDirectoryOwnership = acquireDataDirectoryOwnership(serviceArguments.dataDir, 'service');
let storage: Awaited<ReturnType<typeof createPlotterStorageRuntime>>;
try {
  storage = await createPlotterStorageRuntime({ dataDirectory: serviceArguments.dataDir });
} catch (error) {
  dataDirectoryOwnership.release();
  throw error;
}
const handler = createPlotterHttpHandler({
  directory: storage.directory,
  tripRepository: storage.tripRepository,
  media: storage.media,
  mediaContent: storage.mediaContent,
  events: storage.events,
  readiness: storage.readiness,
  providers: {
    linkPreview: fetchLinkPreview,
    imageSearch: searchWebImages,
    remoteImage: fetchRemoteImage,
    imageSearchApiKey: process.env.SERPAPI_API_KEY,
  },
  backups: storage.backups,
  operations: storage.operations,
  publicRoot: resolve(repositoryRoot, 'public'),
});

const server = createServer((request, response) => {
  void handler(request, response);
});

function closeService(): void {
  server.close(() => {
    try { storage.close(); } catch { /* Readiness was revoked before physical close. */ }
    try { dataDirectoryOwnership.release(); } catch { /* A retained lock fails closed. */ }
  });
}

process.once('exit', () => {
  try { dataDirectoryOwnership.release(); } catch { /* A retained lock fails closed. */ }
});

process.once('SIGINT', closeService);
process.once('SIGTERM', closeService);
server.listen(serviceArguments.port, '127.0.0.1');
