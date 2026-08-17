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
  lockOperations?: E2eLockOperations;
};

type SignalTarget = {
  on(signal: NodeJS.Signals, listener: () => void): unknown;
  removeListener(signal: NodeJS.Signals, listener: () => void): unknown;
};

type E2eLifecycleOptions = {
  signalTarget?: SignalTarget;
  replaySignal?(signal: NodeJS.Signals): void;
};

type Stoppable = { stop(): Promise<void> };

export type E2eLockOperations = {
  write(fileDescriptor: number, contents: string, lockPath: string): void;
  sync(fileDescriptor: number): void;
  identify(fileDescriptor: number): { device: number; inode: number };
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

export function createE2eServiceLifecycle<Owner extends Stoppable>(
  startOwner: () => Owner | Promise<Owner>,
  options: E2eLifecycleOptions = {},
) {
  const signalTarget = options.signalTarget ?? process;
  const replaySignal = options.replaySignal ?? ((signal: NodeJS.Signals) => {
    process.kill(process.pid, signal);
  });
  const handlers = new Map<NodeJS.Signals, () => void>();
  let owner: Owner | undefined;
  let ownerStopPromise: Promise<void> | undefined;
  let cleanupPromise: Promise<void> | undefined;
  let teardownPromise: Promise<void> | undefined;
  let signalPromise: Promise<void> | undefined;
  let cleanupRequested = false;

  const started = Promise.resolve().then(startOwner).then(async (startedOwner) => {
    owner = startedOwner;
    if (cleanupRequested) await stopOwner();
    return startedOwner;
  });

  function removeSignalHandlers(): void {
    for (const [signal, handler] of handlers) signalTarget.removeListener(signal, handler);
    handlers.clear();
  }

  function stopOwner(): Promise<void> {
    if (!owner) return Promise.resolve();
    ownerStopPromise ??= Promise.resolve().then(() => owner!.stop());
    return ownerStopPromise;
  }

  function cleanup(): Promise<void> {
    cleanupRequested = true;
    cleanupPromise ??= (async () => {
      await started;
      await stopOwner();
    })();
    return cleanupPromise;
  }

  function teardown(): Promise<void> {
    teardownPromise ??= cleanup().finally(removeSignalHandlers);
    return teardownPromise;
  }

  function handleSignal(signal: NodeJS.Signals): Promise<void> {
    signalPromise ??= (async () => {
      let cleanupError: unknown;
      try {
        await cleanup();
      } catch (error) {
        cleanupError = error;
      }
      removeSignalHandlers();
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
    signalTarget.on(signal, handler);
  }

  return { started, teardown, handleSignal };
}

export async function startE2eServiceLifecycle<Owner extends Stoppable>(
  startOwner: () => Owner | Promise<Owner>,
  options: E2eLifecycleOptions = {},
) {
  const lifecycle = createE2eServiceLifecycle(startOwner, options);
  try {
    const owner = await lifecycle.started;
    return { owner, teardown: lifecycle.teardown, handleSignal: lifecycle.handleSignal };
  } catch (startupError) {
    await lifecycle.teardown().catch(() => undefined);
    throw startupError;
  }
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

function descriptorIdentity(fileDescriptor: number): { device: number; inode: number } {
  const stats = fstatSync(fileDescriptor);
  if (!stats.isFile()) throw new Error('The Plotter E2E ownership lock is not a regular file.');
  return { device: stats.dev, inode: stats.ino };
}

const defaultLockOperations: E2eLockOperations = {
  write(fileDescriptor, contents) {
    writeFileSync(fileDescriptor, contents, 'utf8');
  },
  sync(fileDescriptor) {
    fsyncSync(fileDescriptor);
  },
  identify: descriptorIdentity,
};

function syncDirectory(path: string): void {
  const fileDescriptor = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    fsyncSync(fileDescriptor);
  } finally {
    closeSync(fileDescriptor);
  }
}

function removeExactPartialLock(
  temporaryRootIdentity: DirectoryIdentity,
  lockPath: string,
  createdIdentity: { device: number; inode: number },
): void {
  assertDirectoryIdentity(temporaryRootIdentity, 'Plotter E2E temporary directory');
  let current;
  try {
    current = lstatSync(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  if (
    !current.isFile()
    || current.isSymbolicLink()
    || current.dev !== createdIdentity.device
    || current.ino !== createdIdentity.inode
  ) {
    throw new Error('Refusing to remove a partial ownership lock because its path was replaced.');
  }
  unlinkSync(lockPath);
  syncDirectory(temporaryRootIdentity.path);
}

function acquireOwnershipLock(
  temporaryRootIdentity: DirectoryIdentity,
  operations: E2eLockOperations,
): LockIdentity {
  const lockPath = resolve(temporaryRootIdentity.path, lockFileName);
  assertDirectoryIdentity(temporaryRootIdentity, 'Plotter E2E temporary directory');
  const nonce = randomUUID();
  const contents = JSON.stringify({ version: 1, pid: process.pid, nonce } satisfies LockContents);
  let fileDescriptor: number | undefined;
  let createdIdentity: { device: number; inode: number } | undefined;
  try {
    fileDescriptor = openSync(
      lockPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    );
    createdIdentity = descriptorIdentity(fileDescriptor);
    operations.write(fileDescriptor, contents, lockPath);
    operations.sync(fileDescriptor);
    const verifiedIdentity = operations.identify(fileDescriptor);
    if (
      verifiedIdentity.device !== createdIdentity.device
      || verifiedIdentity.inode !== createdIdentity.inode
    ) {
      throw new Error('The Plotter E2E ownership lock identity changed during creation.');
    }
    syncDirectory(temporaryRootIdentity.path);
    closeSync(fileDescriptor);
    fileDescriptor = undefined;
    return {
      path: lockPath,
      contents,
      device: createdIdentity.device,
      inode: createdIdentity.inode,
      nonce,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(
        `Plotter E2E storage is already owned or its ownership lock remains at ${lockPath}. Another harness may be active; after an abnormal hard kill, confirm no Plotter E2E process or listener is active before removing that exact lock.`,
        { cause: error },
      );
    }
    const cleanupErrors: unknown[] = [];
    if (fileDescriptor !== undefined) {
      if (!createdIdentity) {
        try {
          createdIdentity = descriptorIdentity(fileDescriptor);
        } catch (identityError) {
          cleanupErrors.push(identityError);
        }
      }
      try {
        closeSync(fileDescriptor);
      } catch (closeError) {
        cleanupErrors.push(closeError);
      }
      if (createdIdentity) {
        try {
          removeExactPartialLock(temporaryRootIdentity, lockPath, createdIdentity);
        } catch (removeError) {
          cleanupErrors.push(removeError);
        }
      }
    }
    if (cleanupErrors.length > 0) {
      const messages = cleanupErrors.map((cleanupError) =>
        cleanupError instanceof Error ? cleanupError.message : String(cleanupError));
      throw new AggregateError(
        [error, ...cleanupErrors],
        `Plotter E2E ownership lock creation failed: ${error instanceof Error ? error.message : String(error)} ${messages.join(' ')}`,
        { cause: error },
      );
    }
    throw error;
  }
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
  syncDirectory(temporaryRootIdentity.path);
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
  const sockets = new Set<Socket>();
  let requestHandler: ReturnType<typeof createPlotterHttpHandler> | undefined;
  let server: Server | undefined;
  let baseUrl: string | undefined;
  let temporaryRootIdentity: DirectoryIdentity | undefined;
  let ownedLock: LockIdentity | undefined;
  let dataIdentity: DirectoryIdentity | undefined;
  let storage: PlotterStorageRuntime | undefined;
  try {
    server = createServer((request, response) => {
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
    baseUrl = await listen(server, options.port ?? defaultServicePort);
    mkdirSync(temporaryRoot, { recursive: true });
    temporaryRootIdentity = captureDirectoryIdentity(temporaryRoot, 'Plotter E2E temporary directory');
    ownedLock = acquireOwnershipLock(
      temporaryRootIdentity,
      options.lockOperations ?? defaultLockOperations,
    );
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
    if (!requestHandler) throw new Error('The disposable Plotter service handler did not become ready.');
  } catch (error) {
    const startupError = error;
    await runCleanupSteps([
      ...(server ? [() => closeServer(server, sockets)] : []),
      () => storage?.close(),
      ...(temporaryRootIdentity && dataIdentity
        ? [() => deleteOwnedDataDirectory(temporaryRootIdentity, dataIdentity)] : []),
      ...(temporaryRootIdentity && ownedLock
        ? [() => releaseOwnershipLock(temporaryRootIdentity, ownedLock)] : []),
      releaseProcessOwnership,
    ]).catch((cleanupError) => {
      throw new AggregateError([startupError, cleanupError], 'Plotter E2E startup and cleanup failed.');
    });
    throw startupError;
  }

  if (!server || !baseUrl || !temporaryRootIdentity || !ownedLock || !dataIdentity || !storage) {
    throw new Error('The disposable Plotter service did not finish startup.');
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
  const lifecycle = await startE2eServiceLifecycle(async () => {
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
    return {
      vite,
      async stop() {
        if (vite.exitCode === null && vite.signalCode === null) vite.kill('SIGTERM');
        await service.stop();
      },
    };
  });
  try {
    process.exitCode = await waitForChild(lifecycle.owner.vite);
  } finally {
    await lifecycle.teardown();
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  await runE2eDevelopmentServer();
}
