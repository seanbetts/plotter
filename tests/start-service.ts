import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { Socket } from 'node:net';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveVehiclePreset } from '../src/domain/vehiclePresets';
import { tripSummaryToPersistedRow } from '../src/storage/persistedRows';
import { openPlotterDatabase } from '../server/database';
import { createPlotterHttpHandler } from '../server/http';
import { createPlotterStorageRuntime, type PlotterStorageRuntime } from '../server/storageRuntime';

export type E2eService = {
  baseUrl: string;
  dataDir: string;
  stop(): Promise<void>;
};

export type StartE2eServiceOptions = {
  temporaryRoot?: string;
  port?: number;
  isProcessAlive?: (pid: number) => boolean;
};

type SignalTarget = {
  once(signal: NodeJS.Signals, listener: () => void): unknown;
  removeListener(signal: NodeJS.Signals, listener: () => void): unknown;
};

type E2eLifecycleOptions = {
  signalTarget?: SignalTarget;
  replaySignal?(signal: NodeJS.Signals): void;
};

type DirectoryIdentity = {
  path: string;
  realPath: string;
  device: number;
  inode: number;
};

type LockIdentity = {
  path: string;
  contents: string;
  device: number;
  inode: number;
  nonce: string;
};

type LockContents = {
  version: 1;
  pid: number;
  nonce: string;
};

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultTemporaryRoot = resolve(repositoryRoot, 'tests', '.tmp');
const serviceHost = '127.0.0.1';
const defaultServicePort = 5175;
const dataDirectoryName = 'e2e-user-data';
const lockFileName = '.e2e-user-data.lock';
const fakeImagePath = '/api/v1/e2e-provider/image.png';
const lifecycleSignals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];
const fakeImageBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const processOwnedTemporaryRoots = new Map<string, string>();

export function createE2eViteEnvironment(
  parentEnvironment: NodeJS.ProcessEnv,
  serviceBaseUrl: string,
): NodeJS.ProcessEnv {
  return {
    ...parentEnvironment,
    VITE_TRIP_STORAGE: 'e2e-service',
    VITE_PUBLIC_BASE_PATH: '/plotter/',
    VITE_E2E_SERVICE_URL: serviceBaseUrl,
    VITE_MAPTILER_API_KEY: '',
    VITE_OPENROUTESERVICE_API_KEY: 'e2e-test-key',
    VITE_SUPABASE_URL: '',
    VITE_SUPABASE_PUBLISHABLE_KEY: '',
  };
}

export function createE2eServiceLifecycle(
  owner: Pick<E2eService, 'stop'>,
  options: E2eLifecycleOptions = {},
) {
  const signalTarget = options.signalTarget ?? process;
  const replaySignal = options.replaySignal ?? ((signal: NodeJS.Signals) => {
    process.kill(process.pid, signal);
  });
  const handlers = new Map<NodeJS.Signals, () => void>();
  let teardownPromise: Promise<void> | undefined;
  let signalPromise: Promise<void> | undefined;

  function removeSignalHandlers(): void {
    for (const [signal, handler] of handlers) signalTarget.removeListener(signal, handler);
    handlers.clear();
  }

  function teardown(): Promise<void> {
    if (!teardownPromise) {
      removeSignalHandlers();
      teardownPromise = Promise.resolve().then(() => owner.stop());
    }
    return teardownPromise;
  }

  function handleSignal(signal: NodeJS.Signals): Promise<void> {
    signalPromise ??= (async () => {
      let cleanupError: unknown;
      try {
        await teardown();
      } catch (error) {
        cleanupError = error;
      }
      try {
        replaySignal(signal);
      } catch (error) {
        cleanupError ??= error;
      }
      if (cleanupError) throw cleanupError;
    })();
    return signalPromise;
  }

  for (const signal of lifecycleSignals) {
    const handler = () => { void handleSignal(signal).catch(() => undefined); };
    handlers.set(signal, handler);
    signalTarget.once(signal, handler);
  }

  return { teardown, handleSignal };
}

function validateContainedDataPath(temporaryRoot: string, dataDir: string): void {
  const expected = resolve(temporaryRoot, dataDirectoryName);
  if (
    dataDir !== expected
    || dirname(dataDir) !== temporaryRoot
    || basename(dataDir) !== dataDirectoryName
    || relative(temporaryRoot, dataDir) !== dataDirectoryName
  ) {
    throw new Error('Refusing to use an invalid Plotter E2E data directory.');
  }
}

function captureDirectoryIdentity(path: string, label: string): DirectoryIdentity {
  const stats = lstatSync(path);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`Refusing to use an invalid ${label}.`);
  }
  return {
    path,
    realPath: realpathSync(path),
    device: stats.dev,
    inode: stats.ino,
  };
}

function assertDirectoryIdentity(identity: DirectoryIdentity, label: string): void {
  let current: DirectoryIdentity;
  try {
    current = captureDirectoryIdentity(identity.path, label);
  } catch (error) {
    throw new Error(`Refusing to remove a removed or replaced ${label}.`, { cause: error });
  }
  if (
    current.realPath !== identity.realPath
    || current.device !== identity.device
    || current.inode !== identity.inode
  ) {
    throw new Error(`Refusing to remove a replaced ${label}.`);
  }
}

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    return true;
  }
}

function parseLockContents(contents: string): LockContents {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    throw new Error('The Plotter E2E ownership lock is invalid; refusing stale-lock cleanup.', { cause: error });
  }
  if (
    typeof parsed !== 'object'
    || parsed === null
    || Object.keys(parsed).sort().join(',') !== 'nonce,pid,version'
    || (parsed as { version?: unknown }).version !== 1
    || !Number.isSafeInteger((parsed as { pid?: unknown }).pid)
    || (parsed as { pid: number }).pid <= 0
    || typeof (parsed as { nonce?: unknown }).nonce !== 'string'
    || !/^[0-9a-f-]{36}$/.test((parsed as { nonce: string }).nonce)
  ) {
    throw new Error('The Plotter E2E ownership lock is invalid; refusing stale-lock cleanup.');
  }
  return parsed as LockContents;
}

function readLockSnapshot(lockPath: string): LockIdentity & { owner: LockContents } {
  const stats = lstatSync(lockPath);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size <= 0 || stats.size > 512) {
    throw new Error('The Plotter E2E ownership lock is invalid; refusing stale-lock cleanup.');
  }
  const contents = readFileSync(lockPath, 'utf8');
  const owner = parseLockContents(contents);
  return {
    path: lockPath,
    contents,
    device: stats.dev,
    inode: stats.ino,
    nonce: owner.nonce,
    owner,
  };
}

function sameLock(left: LockIdentity, right: LockIdentity): boolean {
  return left.device === right.device
    && left.inode === right.inode
    && left.contents === right.contents
    && left.nonce === right.nonce;
}

function acquireOwnershipLock(
  temporaryRootIdentity: DirectoryIdentity,
  isProcessAlive: (pid: number) => boolean,
): LockIdentity {
  const lockPath = resolve(temporaryRootIdentity.path, lockFileName);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    assertDirectoryIdentity(temporaryRootIdentity, 'Plotter E2E temporary directory');
    const nonce = randomUUID();
    const contents = JSON.stringify({ version: 1, pid: process.pid, nonce } satisfies LockContents);
    let fileDescriptor: number | undefined;
    try {
      fileDescriptor = openSync(
        lockPath,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        0o600,
      );
      writeFileSync(fileDescriptor, contents, 'utf8');
      fsyncSync(fileDescriptor);
      const stats = fstatSync(fileDescriptor);
      if (!stats.isFile()) throw new Error('The Plotter E2E ownership lock is not a regular file.');
      return { path: lockPath, contents, device: stats.dev, inode: stats.ino, nonce };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const staleCandidate = readLockSnapshot(lockPath);
      if (isProcessAlive(staleCandidate.owner.pid)) {
        throw new Error(`Plotter E2E storage is already owned by process ${staleCandidate.owner.pid}.`, {
          cause: error,
        });
      }
      assertDirectoryIdentity(temporaryRootIdentity, 'Plotter E2E temporary directory');
      const beforeUnlink = readLockSnapshot(lockPath);
      if (!sameLock(staleCandidate, beforeUnlink)) continue;
      unlinkSync(lockPath);
    } finally {
      if (fileDescriptor !== undefined) closeSync(fileDescriptor);
    }
  }
  throw new Error('Unable to acquire the Plotter E2E ownership lock safely.');
}

function releaseOwnershipLock(
  temporaryRootIdentity: DirectoryIdentity,
  ownedLock: LockIdentity,
): void {
  assertDirectoryIdentity(temporaryRootIdentity, 'Plotter E2E temporary directory');
  const current = readLockSnapshot(ownedLock.path);
  if (!sameLock(ownedLock, current)) {
    throw new Error('Refusing to release a replaced Plotter E2E ownership lock.');
  }
  unlinkSync(ownedLock.path);
}

function prepareDataDirectory(
  temporaryRootIdentity: DirectoryIdentity,
  dataDir: string,
): DirectoryIdentity {
  assertDirectoryIdentity(temporaryRootIdentity, 'Plotter E2E temporary directory');
  try {
    const existing = captureDirectoryIdentity(dataDir, 'Plotter E2E data directory');
    assertDirectoryIdentity(existing, 'Plotter E2E data directory');
    rmSync(dataDir, { recursive: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  mkdirSync(dataDir);
  return captureDirectoryIdentity(dataDir, 'Plotter E2E data directory');
}

function deleteOwnedDataDirectory(
  temporaryRootIdentity: DirectoryIdentity,
  dataIdentity: DirectoryIdentity,
): void {
  assertDirectoryIdentity(temporaryRootIdentity, 'Plotter E2E temporary directory');
  assertDirectoryIdentity(dataIdentity, 'Plotter E2E data directory');
  rmSync(dataIdentity.path, { recursive: true });
}

function seedInitialTrip(dataDir: string): void {
  const database = openPlotterDatabase(join(dataDir, 'plotter.sqlite3'));
  const timestamp = new Date().toISOString();
  const trip = tripSummaryToPersistedRow({
    id: randomUUID(),
    name: 'Untitled trip',
    description: '',
    routingVehicle: resolveVehiclePreset('standard'),
    createdAt: timestamp,
    updatedAt: timestamp,
  }, 'local');
  try {
    database.connection.exec('BEGIN IMMEDIATE');
    database.connection.prepare(`
      INSERT INTO trips (
        id, owner_user_id, name, description, vehicle_preset, vehicle_profile,
        vehicle_type, vehicle_restrictions, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      trip.id,
      trip.owner_user_id,
      trip.name,
      trip.description,
      trip.vehicle_preset ?? null,
      trip.vehicle_profile ?? null,
      trip.vehicle_type ?? null,
      trip.vehicle_restrictions === undefined ? null : JSON.stringify(trip.vehicle_restrictions),
      trip.created_at,
      trip.updated_at,
    );
    database.connection.prepare('INSERT INTO trip_revisions (trip_id, revision) VALUES (?, 0)').run(trip.id);
    database.connection.prepare(`
      UPDATE store_metadata SET directory_revision = 1
      WHERE singleton = 1 AND directory_revision = 0
    `).run();
    database.connection.exec('COMMIT');
  } catch (error) {
    try { database.connection.exec('ROLLBACK'); } catch { /* Preserve the seed failure. */ }
    throw error;
  } finally {
    database.close();
  }
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

async function listen(server: Server, port: number): Promise<string> {
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
    server.listen(port, serviceHost);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('The disposable Plotter service has no TCP address.');
  return `http://${serviceHost}:${address.port}/`;
}

async function closeServer(server: Server, sockets: Set<Socket>): Promise<void> {
  for (const socket of sockets) socket.destroy();
  if (!server.listening) return;
  await new Promise<void>((resolvePromise, reject) => {
    server.close((error) => error ? reject(error) : resolvePromise());
  });
}

async function runCleanupSteps(steps: Array<() => void | Promise<void>>): Promise<void> {
  const errors: unknown[] = [];
  for (const step of steps) {
    try {
      await step();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    const messages = errors.map((error) => error instanceof Error ? error.message : String(error));
    throw new AggregateError(errors, `Plotter E2E cleanup failed: ${messages.join(' ')}`);
  }
}

export async function startE2eService(options: StartE2eServiceOptions = {}): Promise<E2eService> {
  const temporaryRoot = resolve(options.temporaryRoot ?? defaultTemporaryRoot);
  const dataDir = resolve(temporaryRoot, dataDirectoryName);
  validateContainedDataPath(temporaryRoot, dataDir);
  const processOwnershipNonce = randomUUID();
  if (processOwnedTemporaryRoots.has(temporaryRoot)) {
    throw new Error(`Plotter E2E storage is already owned by process ${process.pid}.`);
  }
  processOwnedTemporaryRoots.set(temporaryRoot, processOwnershipNonce);
  const releaseProcessOwnership = () => {
    if (processOwnedTemporaryRoots.get(temporaryRoot) === processOwnershipNonce) {
      processOwnedTemporaryRoots.delete(temporaryRoot);
    }
  };
  let temporaryRootIdentity: DirectoryIdentity;
  let ownedLock: LockIdentity;
  try {
    mkdirSync(temporaryRoot, { recursive: true });
    temporaryRootIdentity = captureDirectoryIdentity(temporaryRoot, 'Plotter E2E temporary directory');
    ownedLock = acquireOwnershipLock(
      temporaryRootIdentity,
      options.isProcessAlive ?? defaultIsProcessAlive,
    );
  } catch (error) {
    releaseProcessOwnership();
    throw error;
  }

  const sockets = new Set<Socket>();
  let requestHandler: ReturnType<typeof createPlotterHttpHandler> | undefined;
  const server = createServer((request, response) => {
    if (!requestHandler) {
      response.writeHead(503, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ status: 503, error: { code: 'starting', message: 'Plotter E2E service is starting.' } }));
      return;
    }
    if (request.method === 'GET' && request.url === fakeImagePath) {
      response.writeHead(200, {
        'content-type': 'image/png',
        'content-length': fakeImageBytes.byteLength,
        'cache-control': 'no-store',
      });
      response.end(fakeImageBytes);
      return;
    }
    void requestHandler(request, response);
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });

  let baseUrl: string | undefined;
  let dataIdentity: DirectoryIdentity | undefined;
  let storage: PlotterStorageRuntime | undefined;
  try {
    baseUrl = await listen(server, options.port ?? defaultServicePort);
    dataIdentity = prepareDataDirectory(temporaryRootIdentity, dataDir);
    seedInitialTrip(dataDir);
    storage = await createPlotterStorageRuntime({ dataDirectory: dataDir });
    if (!storage.readiness().ready) {
      throw new Error('The disposable Plotter service storage did not become ready.');
    }
    const serviceBaseUrl = baseUrl;
    requestHandler = createPlotterHttpHandler({
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
          return { url: normalized.toString(), title: domain, domain };
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
  } catch (error) {
    const startupError = error;
    await runCleanupSteps([
      () => closeServer(server, sockets),
      () => storage?.close(),
      ...(dataIdentity ? [() => deleteOwnedDataDirectory(temporaryRootIdentity, dataIdentity)] : []),
      () => releaseOwnershipLock(temporaryRootIdentity, ownedLock),
      releaseProcessOwnership,
    ]).catch((cleanupError) => {
      throw new AggregateError([startupError, cleanupError], 'Plotter E2E startup and cleanup failed.');
    });
    throw startupError;
  }

  const ownedDataIdentity = dataIdentity;
  const ownedStorage = storage;
  const ownedBaseUrl = baseUrl;
  let stopPromise: Promise<void> | undefined;
  return {
    baseUrl: ownedBaseUrl,
    dataDir,
    stop() {
      stopPromise ??= runCleanupSteps([
        () => closeServer(server, sockets),
        () => ownedStorage.close(),
        () => deleteOwnedDataDirectory(temporaryRootIdentity, ownedDataIdentity),
        () => releaseOwnershipLock(temporaryRootIdentity, ownedLock),
        releaseProcessOwnership,
      ]);
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
    env: createE2eViteEnvironment(process.env, service.baseUrl),
    stdio: 'inherit',
  });

  const lifecycle = createE2eServiceLifecycle({
    async stop() {
      if (vite.exitCode === null && vite.signalCode === null) vite.kill('SIGTERM');
      await service.stop();
    },
  });
  try {
    process.exitCode = await waitForChild(vite);
  } finally {
    await lifecycle.teardown();
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  await runE2eDevelopmentServer();
}
