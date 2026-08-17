import { spawn, type ChildProcess } from 'node:child_process';
import { lstat, mkdir, realpath, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { Socket } from 'node:net';
import { basename, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPlotterHttpHandler } from '../server/http';
import { createPlotterStorageRuntime } from '../server/storageRuntime';

export type E2eService = {
  baseUrl: string;
  dataDir: string;
  stop(): Promise<void>;
};

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const testTemporaryRoot = resolve(repositoryRoot, 'tests', '.tmp');
const e2eDataDirectory = resolve(testTemporaryRoot, 'e2e-user-data');
const serviceHost = '127.0.0.1';
const servicePort = 5175;
const serviceBaseUrl = `http://${serviceHost}:${servicePort}/`;
const fakeImagePath = '/api/v1/e2e-provider/image.png';
const fakeImageBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

function validateDeletionTarget(): string {
  const expected = resolve(repositoryRoot, 'tests', '.tmp', 'e2e-user-data');
  const contained = relative(testTemporaryRoot, e2eDataDirectory);
  if (
    e2eDataDirectory !== expected
    || dirname(e2eDataDirectory) !== testTemporaryRoot
    || basename(e2eDataDirectory) !== 'e2e-user-data'
    || contained !== 'e2e-user-data'
  ) {
    throw new Error('Refusing to clean an invalid Plotter E2E data directory.');
  }
  return e2eDataDirectory;
}

async function validateTemporaryRoot(): Promise<void> {
  const temporaryRoot = await lstat(testTemporaryRoot);
  if (!temporaryRoot.isDirectory() || temporaryRoot.isSymbolicLink()) {
    throw new Error('Refusing to use an invalid Plotter E2E temporary directory.');
  }
  const canonicalTemporaryRoot = await realpath(testTemporaryRoot);
  if (canonicalTemporaryRoot !== testTemporaryRoot) {
    throw new Error('Refusing to use a symlinked Plotter E2E temporary directory.');
  }
}

async function prepareDataDirectory(): Promise<string> {
  const dataDir = validateDeletionTarget();
  await mkdir(testTemporaryRoot, { recursive: true });
  await validateTemporaryRoot();
  try {
    const existing = await lstat(dataDir);
    if (existing.isSymbolicLink()) {
      throw new Error('Refusing to clean a symlinked Plotter E2E data directory.');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await rm(dataDir, { recursive: true, force: true });
  await mkdir(dataDir);
  return dataDir;
}

async function deleteDataDirectory(): Promise<void> {
  const dataDir = validateDeletionTarget();
  try {
    await validateTemporaryRoot();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  try {
    const existing = await lstat(dataDir);
    if (existing.isSymbolicLink()) {
      throw new Error('Refusing to delete a symlinked Plotter E2E data directory.');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  await rm(dataDir, { recursive: true });
}

function fakeImageSearchTitle(query: string): string {
  const normalized = query.trim().replace(/\s+/g, ' ');
  const visibleQuery = normalized.split(' ')[0] || 'Image';
  if (/\bMorning Louvre\b/i.test(normalized)) return `${visibleQuery} in Morning Louvre`;
  if (/\bParis\b/i.test(normalized)) return `${visibleQuery} in Paris`;
  return `${visibleQuery} in Plotter`;
}

function fakeImageStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(fakeImageBytes);
      controller.close();
    },
  });
}

export async function startE2eService(): Promise<E2eService> {
  const dataDir = await prepareDataDirectory();
  const storage = await createPlotterStorageRuntime({ dataDirectory: dataDir });
  if (!storage.readiness().ready) {
    storage.close();
    await deleteDataDirectory();
    throw new Error('The disposable Plotter service storage did not become ready.');
  }
  try {
    const initialDirectory = await storage.directory.load();
    if (initialDirectory.trips.length === 0) {
      await storage.directory.create(initialDirectory.revision, {
        expectedRevision: initialDirectory.revision,
        name: 'Untitled trip',
      });
    }
  } catch (error) {
    storage.close();
    await deleteDataDirectory();
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
      async linkPreview({ url }) {
        const normalized = new URL(/^[a-z][a-z\d+.-]*:/i.test(url) ? url : `https://${url}`);
        const domain = normalized.hostname.replace(/^www\./i, '');
        return {
          url: normalized.toString(),
          title: domain,
          domain,
        };
      },
      async imageSearch({ query }) {
        const title = fakeImageSearchTitle(query);
        const imageUrl = new URL(fakeImagePath, serviceBaseUrl).toString();
        return [{
          id: `e2e-${query.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'image'}`,
          title,
          sourceName: 'Local image search',
          sourceUrl: 'https://example.com/local-image-search',
          thumbnailUrl: imageUrl,
          imageUrl,
          width: 1600,
          height: 1000,
        }];
      },
      async remoteImage() {
        return { bytes: fakeImageStream(), contentType: 'image/png' };
      },
      imageSearchApiKey: 'e2e-provider-key',
    },
    backups: storage.backups,
    operations: storage.operations,
    publicRoot: resolve(repositoryRoot, 'dist'),
  });
  const sockets = new Set<Socket>();
  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === fakeImagePath) {
      response.writeHead(200, {
        'content-type': 'image/png',
        'content-length': fakeImageBytes.byteLength,
        'cache-control': 'no-store',
      });
      response.end(fakeImageBytes);
      return;
    }
    void handler(request, response);
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });

  try {
    await new Promise<void>((resolvePromise, reject) => {
      const onError = (error: Error) => {
        server.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        resolvePromise();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(servicePort, serviceHost);
    });
  } catch (error) {
    storage.close();
    await deleteDataDirectory();
    throw error;
  }

  let stopPromise: Promise<void> | undefined;
  return {
    baseUrl: serviceBaseUrl,
    dataDir,
    stop() {
      stopPromise ??= (async () => {
        const closed = new Promise<void>((resolvePromise) => {
          server.close(() => resolvePromise());
        });
        for (const socket of sockets) socket.destroy();
        await closed;
        storage.close();
        await deleteDataDirectory();
      })();
      return stopPromise;
    },
  };
}

function waitForChild(child: ChildProcess): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) resolvePromise(1);
      else resolvePromise(code ?? 1);
    });
  });
}

async function runE2eDevelopmentServer(): Promise<void> {
  const service = await startE2eService();
  const vite = spawn(resolve(repositoryRoot, 'node_modules', '.bin', 'vite'), [
    '--host', '127.0.0.1',
    '--port', '5174',
    '--strictPort',
  ], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      VITE_TRIP_STORAGE: 'e2e-service',
      VITE_PUBLIC_BASE_PATH: '/plotter/',
      VITE_E2E_SERVICE_URL: service.baseUrl,
    },
    stdio: 'inherit',
  });

  let shutdownPromise: Promise<void> | undefined;
  const stop = (signal: NodeJS.Signals = 'SIGTERM') => {
    shutdownPromise ??= (async () => {
      if (vite.exitCode === null && vite.signalCode === null) vite.kill(signal);
      await service.stop();
    })();
    return shutdownPromise;
  };
  process.once('SIGINT', () => { void stop('SIGINT'); });
  process.once('SIGTERM', () => { void stop('SIGTERM'); });
  process.once('SIGHUP', () => { void stop('SIGHUP'); });

  try {
    process.exitCode = await waitForChild(vite);
  } finally {
    await stop();
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  await runE2eDevelopmentServer();
}
