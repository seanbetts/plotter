import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  existsSync,
  fstatSync,
  fsyncSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { get } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test } from 'vitest';
import type { E2eService } from './start-service';

type StartOptions = {
  temporaryRoot: string;
  port: number;
  lockOperations?: {
    write(fileDescriptor: number, contents: string, lockPath: string): void;
    sync(fileDescriptor: number): void;
    identify(fileDescriptor: number): { device: number; inode: number };
  };
};

type SignalTarget = {
  on(signal: NodeJS.Signals, listener: () => void): unknown;
  removeListener(signal: NodeJS.Signals, listener: () => void): unknown;
};

type Stoppable = { stop(): Promise<void> };

type HarnessModule = {
  createE2eServiceLifecycle(
    startOwner: () => Promise<Stoppable>,
    options: {
      signalTarget: SignalTarget;
      replaySignal(signal: NodeJS.Signals): void;
    },
  ): {
    started: Promise<Stoppable>;
    teardown(): Promise<void>;
    handleSignal(signal: NodeJS.Signals): Promise<void>;
  };
  createE2eViteEnvironment(parent: NodeJS.ProcessEnv, serviceBaseUrl: string): NodeJS.ProcessEnv;
  startE2eService(options?: StartOptions): Promise<E2eService>;
};

const roots: string[] = [];
const services: E2eService[] = [];
const children: ChildProcess[] = [];
const testDirectory = dirname(fileURLToPath(import.meta.url));

async function loadHarness(): Promise<HarnessModule> {
  return import('./start-service') as unknown as Promise<HarnessModule>;
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'plotter-e2e-harness-'));
  roots.push(root);
  return root;
}

function expectMissing(path: string): void {
  expect(existsSync(path)).toBe(false);
}

function requestStatus(baseUrl: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = get(new URL('api/v1/trips', baseUrl), (response) => {
      response.resume();
      response.once('end', () => resolve(response.statusCode ?? 0));
    });
    request.once('error', reject);
  });
}

async function expectTripsAvailable(baseUrl: string): Promise<void> {
  expect(await requestStatus(baseUrl)).toBe(200);
}

afterEach(async () => {
  for (const child of children.splice(0).reverse()) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  }
  for (const service of services.splice(0).reverse()) {
    await service.stop().catch(() => undefined);
  }
  for (const root of roots.splice(0).reverse()) {
    rmSync(root, { recursive: true, force: true });
  }
});

async function independentContender(root: string): Promise<{
  begin(): void;
  result: Promise<{ status: 'rejected' | 'started'; message?: string }>;
}> {
  const child = spawn(process.execPath, [
    '--import', 'tsx', join(testDirectory, 'e2e-service-contender.ts'), root,
  ], { stdio: ['pipe', 'pipe', 'pipe'] });
  children.push(child);
  const lines = createInterface({ input: child.stdout! });
  const nextLine = () => new Promise<string>((resolve) => lines.once('line', resolve));
  expect(await nextLine()).toBe('ready');
  return {
    begin() { child.stdin!.end('begin\n'); },
    result: nextLine().then((line) => JSON.parse(line) as {
      status: 'rejected' | 'started'; message?: string;
    }),
  };
}

describe.sequential('disposable E2E service ownership', () => {
  test('rejects a second in-process owner and releases the first owner cleanly', async () => {
    const { startE2eService } = await loadHarness();
    const root = await temporaryRoot();
    const first = await startE2eService({ temporaryRoot: root, port: 0 });
    services.push(first);
    const firstOwnerSentinel = join(first.dataDir, 'first-owner.txt');
    writeFileSync(firstOwnerSentinel, 'first owner remains active');

    let secondError: unknown;
    try {
      await startE2eService({ temporaryRoot: root, port: 0 });
    } catch (error) {
      secondError = error;
    }
    expect(secondError).toBeInstanceOf(Error);
    expect((secondError as Error).message).toContain('already owned');
    expect(readFileSync(firstOwnerSentinel, 'utf8')).toBe('first owner remains active');
    await expectTripsAvailable(first.baseUrl);

    await first.stop();
    services.pop();
    expectMissing(join(root, '.e2e-user-data.lock'));
    expectMissing(first.dataDir);
  });

  test('an active file lock rejects before existing bytes can be removed', async () => {
    const { startE2eService } = await loadHarness();
    const root = await temporaryRoot();
    const dataDir = join(root, 'e2e-user-data');
    mkdirSync(dataDir);
    const sentinel = join(dataDir, 'active-owner.txt');
    writeFileSync(sentinel, 'active owner');
    const lockPath = join(root, '.e2e-user-data.lock');
    const lockContents = JSON.stringify({
      version: 1,
      pid: process.pid,
      nonce: '00000000-0000-4000-8000-000000000002',
    });
    writeFileSync(lockPath, lockContents);

    await expect(startE2eService({ temporaryRoot: root, port: 0 }))
      .rejects.toThrow('already owned');

    expect(readFileSync(sentinel, 'utf8')).toBe('active owner');
    expect(readFileSync(lockPath, 'utf8')).toBe(lockContents);
  });

  test('two independent ephemeral-port contenders fail closed on one pre-existing lock', async () => {
    const root = await temporaryRoot();
    const dataDir = join(root, 'e2e-user-data');
    mkdirSync(dataDir);
    const sentinel = join(dataDir, 'prior-owner.txt');
    writeFileSync(sentinel, 'prior bytes stay intact');
    const lockPath = join(root, '.e2e-user-data.lock');
    const staleContents = JSON.stringify({
      version: 1,
      pid: 123,
      nonce: '00000000-0000-4000-8000-000000000001',
    });
    writeFileSync(lockPath, staleContents);

    const [first, second] = await Promise.all([
      independentContender(root), independentContender(root),
    ]);
    first.begin();
    second.begin();
    const outcomes = await Promise.all([first.result, second.result]);

    expect(outcomes.map((outcome) => outcome.status)).toEqual(['rejected', 'rejected']);
    expect(outcomes.every((outcome) => outcome.message?.includes('confirm no Plotter E2E process or listener')))
      .toBe(true);
    expect(readFileSync(lockPath, 'utf8')).toBe(staleContents);
    expect(readFileSync(sentinel, 'utf8')).toBe('prior bytes stay intact');
  });

  test('a port collision cleans only the failed owner and leaves the listening owner intact', async () => {
    const { startE2eService } = await loadHarness();
    const firstRoot = await temporaryRoot();
    const failedRoot = await temporaryRoot();
    const failedData = join(failedRoot, 'e2e-user-data');
    mkdirSync(failedData);
    const unrelatedSentinel = join(failedData, 'unrelated-owner.txt');
    writeFileSync(unrelatedSentinel, 'unrelated owner');
    const failedLock = join(failedRoot, '.e2e-user-data.lock');
    const failedLockContents = JSON.stringify({
      version: 1,
      pid: process.pid,
      nonce: '00000000-0000-4000-8000-000000000004',
    });
    writeFileSync(failedLock, failedLockContents);
    const first = await startE2eService({ temporaryRoot: firstRoot, port: 0 });
    services.push(first);
    const occupiedPort = Number(new URL(first.baseUrl).port);

    await expect(startE2eService({ temporaryRoot: failedRoot, port: occupiedPort }))
      .rejects.toMatchObject({ code: 'EADDRINUSE' });

    await expectTripsAvailable(first.baseUrl);
    expect(readFileSync(unrelatedSentinel, 'utf8')).toBe('unrelated owner');
    expect(readFileSync(failedLock, 'utf8')).toBe(failedLockContents);
  });

  test.each(['write', 'sync', 'identify'] as const)(
    'removes only its exact partial lock when the %s phase fails',
    async (failurePhase) => {
      const { startE2eService } = await loadHarness();
      const root = await temporaryRoot();
      const dataDir = join(root, 'e2e-user-data');
      mkdirSync(dataDir);
      const sentinel = join(dataDir, 'pre-lock-failure.txt');
      writeFileSync(sentinel, 'not reset');
      let started: E2eService | undefined;
      let startupError: unknown;
      try {
        started = await startE2eService({
          temporaryRoot: root,
          port: 0,
          lockOperations: {
            write(fileDescriptor, contents) {
              if (failurePhase === 'write') throw new Error('injected write failure');
              writeFileSync(fileDescriptor, contents);
            },
            sync(fileDescriptor) {
              if (failurePhase === 'sync') throw new Error('injected sync failure');
              fsyncSync(fileDescriptor);
            },
            identify(fileDescriptor) {
              if (failurePhase === 'identify') throw new Error('injected identify failure');
              const stats = fstatSync(fileDescriptor);
              return { device: stats.dev, inode: stats.ino };
            },
          },
        });
      } catch (error) {
        startupError = error;
      }
      if (started) services.push(started);

      expect(started).toBeUndefined();
      expect(startupError).toBeInstanceOf(Error);
      expect((startupError as Error).message).toContain(`injected ${failurePhase} failure`);
      expectMissing(join(root, '.e2e-user-data.lock'));
      expect(readFileSync(sentinel, 'utf8')).toBe('not reset');
    },
  );

  test('partial-lock cleanup refuses to unlink a replacement path inode', async () => {
    const { startE2eService } = await loadHarness();
    const root = await temporaryRoot();
    const lockPath = join(root, '.e2e-user-data.lock');
    const replacementContents = 'replacement lock must remain';

    await expect(startE2eService({
      temporaryRoot: root,
      port: 0,
      lockOperations: {
        write(fileDescriptor, contents, path) {
          writeFileSync(fileDescriptor, contents);
          renameSync(path, join(root, 'owned-partial-lock'));
          writeFileSync(path, replacementContents);
          throw new Error('injected replacement race');
        },
        sync: fsyncSync,
        identify(fileDescriptor) {
          const stats = fstatSync(fileDescriptor);
          return { device: stats.dev, inode: stats.ino };
        },
      },
    })).rejects.toThrow('partial ownership lock because its path was replaced');

    expect(readFileSync(lockPath, 'utf8')).toBe(replacementContents);
  });

  test('teardown refuses to delete a replacement data-directory inode', async () => {
    const { startE2eService } = await loadHarness();
    const root = await temporaryRoot();
    const service = await startE2eService({ temporaryRoot: root, port: 0 });
    services.push(service);
    const originalData = join(root, 'original-e2e-user-data');
    renameSync(service.dataDir, originalData);
    mkdirSync(service.dataDir);
    const replacementSentinel = join(service.dataDir, 'replacement.txt');
    writeFileSync(replacementSentinel, 'do not delete');

    await expect(service.stop()).rejects.toThrow('replaced');
    services.pop();

    expect(readFileSync(replacementSentinel, 'utf8')).toBe('do not delete');
    expectMissing(join(root, '.e2e-user-data.lock'));
    await expect(requestStatus(service.baseUrl)).rejects.toThrow();
  });

  test('teardown refuses to remove a replacement ownership lock', async () => {
    const { startE2eService } = await loadHarness();
    const root = await temporaryRoot();
    const service = await startE2eService({ temporaryRoot: root, port: 0 });
    services.push(service);
    const lockPath = join(root, '.e2e-user-data.lock');
    rmSync(lockPath);
    const replacementLock = JSON.stringify({
      version: 1,
      pid: process.pid,
      nonce: '00000000-0000-4000-8000-000000000003',
    });
    writeFileSync(lockPath, replacementLock);

    await expect(service.stop()).rejects.toThrow('replaced Plotter E2E ownership lock');
    services.pop();

    expect(readFileSync(lockPath, 'utf8')).toBe(replacementLock);
    expectMissing(service.dataDir);
  });

  test('teardown refuses to remove a replaced temporary-root inode', async () => {
    const { startE2eService } = await loadHarness();
    const root = await temporaryRoot();
    const service = await startE2eService({ temporaryRoot: root, port: 0 });
    services.push(service);
    const movedOwnedRoot = `${root}-owned-original`;
    roots.push(movedOwnedRoot);
    renameSync(root, movedOwnedRoot);
    mkdirSync(root);
    const replacementSentinel = join(root, 'replacement-root.txt');
    writeFileSync(replacementSentinel, 'do not delete');

    await expect(service.stop()).rejects.toThrow('replaced Plotter E2E temporary directory');
    services.pop();

    expect(readFileSync(replacementSentinel, 'utf8')).toBe('do not delete');
    expect(readFileSync(join(movedOwnedRoot, '.e2e-user-data.lock'), 'utf8')).toContain('"version":1');
  });
});

describe.sequential('E2E process lifecycle', () => {
  function signalTarget() {
    const emitter = new EventEmitter();
    return {
      emitter,
      target: {
        on: emitter.on.bind(emitter),
        removeListener: emitter.removeListener.bind(emitter),
      } as SignalTarget,
    };
  }

  test('normal and repeated teardown stop once and remove every signal handler', async () => {
    const module = await loadHarness();
    expect(typeof module.createE2eServiceLifecycle).toBe('function');
    const { emitter, target } = signalTarget();
    let stops = 0;
    const lifecycle = module.createE2eServiceLifecycle(async () => ({
      async stop() { stops += 1; },
    }), {
      signalTarget: target,
      replaySignal() { throw new Error('normal teardown must not replay a signal'); },
    });

    await lifecycle.started;
    await Promise.all([lifecycle.teardown(), lifecycle.teardown()]);

    expect(stops).toBe(1);
    expect(emitter.eventNames()).toEqual([]);
  });

  test('signals emitted during deferred startup join one cleanup and replay only the first', async () => {
    const { createE2eServiceLifecycle } = await loadHarness();
    const { emitter, target } = signalTarget();
    const events: string[] = [];
    let resolveStartup!: (owner: Stoppable) => void;
    const deferredStartup = new Promise<Stoppable>((resolve) => { resolveStartup = resolve; });
    const lifecycle = createE2eServiceLifecycle(() => deferredStartup, {
      signalTarget: target,
      replaySignal(signal) { events.push(`replayed:${signal}`); },
    });

    expect(emitter.emit('SIGTERM')).toBe(true);
    expect(emitter.emit('SIGHUP')).toBe(true);
    expect(emitter.listenerCount('SIGTERM')).toBe(1);
    expect(emitter.listenerCount('SIGHUP')).toBe(1);
    resolveStartup({ async stop() { events.push('stopped'); } });
    await lifecycle.handleSignal('SIGTERM');

    expect(events).toEqual(['stopped', 'replayed:SIGTERM']);
    expect(emitter.eventNames()).toEqual([]);
  });

  test('repeated emitted signals stay intercepted throughout a deferred stop', async () => {
    const { createE2eServiceLifecycle } = await loadHarness();
    const { emitter, target } = signalTarget();
    const events: string[] = [];
    let resolveStop!: () => void;
    let markStopStarted!: () => void;
    const stopStarted = new Promise<void>((resolve) => { markStopStarted = resolve; });
    const lifecycle = createE2eServiceLifecycle(async () => ({
      stop() {
        events.push('stop-started');
        markStopStarted();
        return new Promise<void>((resolve) => { resolveStop = resolve; });
      },
    }), {
      signalTarget: target,
      replaySignal(signal) { events.push(`replayed:${signal}`); },
    });
    await lifecycle.started;

    expect(emitter.emit('SIGINT')).toBe(true);
    await stopStarted;
    expect(emitter.emit('SIGINT')).toBe(true);
    expect(emitter.emit('SIGHUP')).toBe(true);
    expect(emitter.listenerCount('SIGINT')).toBe(1);
    resolveStop();
    await lifecycle.handleSignal('SIGINT');

    expect(events).toEqual(['stop-started', 'replayed:SIGINT']);
    expect(emitter.eventNames()).toEqual([]);
  });

  test('a cleanup error still removes handlers and replays expected signal semantics once', async () => {
    const { createE2eServiceLifecycle } = await loadHarness();
    const { emitter, target } = signalTarget();
    const replayed: NodeJS.Signals[] = [];
    let stops = 0;
    const lifecycle = createE2eServiceLifecycle(async () => ({
      async stop() {
        stops += 1;
        throw new Error('cleanup failed');
      },
    }), {
      signalTarget: target,
      replaySignal(signal) { replayed.push(signal); },
    });

    await lifecycle.started;
    expect(emitter.emit('SIGINT')).toBe(true);
    await expect(lifecycle.handleSignal('SIGINT')).rejects.toThrow('cleanup failed');
    await expect(lifecycle.teardown()).rejects.toThrow('cleanup failed');

    expect(stops).toBe(1);
    expect(replayed).toEqual(['SIGINT']);
    expect(emitter.eventNames()).toEqual([]);
  });
});

test('E2E Vite environment removes inherited browser provider secrets', async () => {
  const module = await loadHarness();
  expect(typeof module.createE2eViteEnvironment).toBe('function');
  const environment = module.createE2eViteEnvironment({
    PATH: '/bin',
    VITE_MAPTILER_API_KEY: 'parent-maptiler-secret',
    VITE_OPENROUTESERVICE_API_KEY: 'parent-routing-secret',
    VITE_SUPABASE_URL: 'https://live.example.test',
    VITE_SUPABASE_PUBLISHABLE_KEY: 'parent-supabase-secret',
  }, 'http://127.0.0.1:43210/');

  expect(environment).toMatchObject({
    PATH: '/bin',
    VITE_TRIP_STORAGE: 'e2e-service',
    VITE_PUBLIC_BASE_PATH: '/plotter/',
    VITE_E2E_SERVICE_URL: 'http://127.0.0.1:43210/',
    VITE_MAPTILER_API_KEY: '',
    VITE_OPENROUTESERVICE_API_KEY: 'e2e-test-key',
    VITE_SUPABASE_URL: '',
    VITE_SUPABASE_PUBLISHABLE_KEY: '',
  });
  expect(Object.values(environment)).not.toContain('parent-maptiler-secret');
  expect(Object.values(environment)).not.toContain('parent-routing-secret');
  expect(Object.values(environment)).not.toContain('parent-supabase-secret');
});
