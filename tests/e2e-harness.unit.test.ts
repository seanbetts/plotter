import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { get } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import type { E2eService } from './start-service';

type StartOptions = {
  temporaryRoot: string;
  port: number;
  isProcessAlive?: (pid: number) => boolean;
};

type SignalTarget = {
  once(signal: NodeJS.Signals, listener: () => void): unknown;
  removeListener(signal: NodeJS.Signals, listener: () => void): unknown;
};

type HarnessModule = {
  createE2eServiceLifecycle(
    owner: Pick<E2eService, 'stop'>,
    options: {
      signalTarget: SignalTarget;
      replaySignal(signal: NodeJS.Signals): void;
    },
  ): {
    teardown(): Promise<void>;
    handleSignal(signal: NodeJS.Signals): Promise<void>;
  };
  createE2eViteEnvironment(parent: NodeJS.ProcessEnv, serviceBaseUrl: string): NodeJS.ProcessEnv;
  startE2eService(options?: StartOptions): Promise<E2eService>;
};

const roots: string[] = [];
const services: E2eService[] = [];

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
  for (const service of services.splice(0).reverse()) {
    await service.stop().catch(() => undefined);
  }
  for (const root of roots.splice(0).reverse()) {
    rmSync(root, { recursive: true, force: true });
  }
});

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

  test('recovers a stale lock and releases only the newly owned lock', async () => {
    const { startE2eService } = await loadHarness();
    const root = await temporaryRoot();
    const lockPath = join(root, '.e2e-user-data.lock');
    writeFileSync(lockPath, JSON.stringify({
      version: 1,
      pid: 123,
      nonce: '00000000-0000-4000-8000-000000000001',
    }));

    const service = await startE2eService({
      temporaryRoot: root,
      port: 0,
      isProcessAlive: () => false,
    });
    services.push(service);
    await expectTripsAvailable(service.baseUrl);

    await service.stop();
    services.pop();
    expectMissing(lockPath);
    expectMissing(service.dataDir);
  });

  test('a port collision cleans only the failed owner and leaves the listening owner intact', async () => {
    const { startE2eService } = await loadHarness();
    const firstRoot = await temporaryRoot();
    const failedRoot = await temporaryRoot();
    const failedData = join(failedRoot, 'e2e-user-data');
    mkdirSync(failedData);
    const unrelatedSentinel = join(failedData, 'unrelated-owner.txt');
    writeFileSync(unrelatedSentinel, 'unrelated owner');
    const first = await startE2eService({ temporaryRoot: firstRoot, port: 0 });
    services.push(first);
    const occupiedPort = Number(new URL(first.baseUrl).port);

    await expect(startE2eService({ temporaryRoot: failedRoot, port: occupiedPort }))
      .rejects.toMatchObject({ code: 'EADDRINUSE' });

    await expectTripsAvailable(first.baseUrl);
    expect(readFileSync(unrelatedSentinel, 'utf8')).toBe('unrelated owner');
    expectMissing(join(failedRoot, '.e2e-user-data.lock'));
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
        once: emitter.once.bind(emitter),
        removeListener: emitter.removeListener.bind(emitter),
      } as SignalTarget,
    };
  }

  test('normal and repeated teardown stop once and remove every signal handler', async () => {
    const module = await loadHarness();
    expect(typeof module.createE2eServiceLifecycle).toBe('function');
    const { emitter, target } = signalTarget();
    let stops = 0;
    const lifecycle = module.createE2eServiceLifecycle({
      async stop() { stops += 1; },
    }, {
      signalTarget: target,
      replaySignal() { throw new Error('normal teardown must not replay a signal'); },
    });

    await Promise.all([lifecycle.teardown(), lifecycle.teardown()]);

    expect(stops).toBe(1);
    expect(emitter.eventNames()).toEqual([]);
  });

  test('signal cleanup is idempotent and replays the first signal after closing', async () => {
    const { createE2eServiceLifecycle } = await loadHarness();
    const { emitter, target } = signalTarget();
    const events: string[] = [];
    const lifecycle = createE2eServiceLifecycle({
      async stop() { events.push('stopped'); },
    }, {
      signalTarget: target,
      replaySignal(signal) { events.push(`replayed:${signal}`); },
    });

    await Promise.all([
      lifecycle.handleSignal('SIGTERM'),
      lifecycle.handleSignal('SIGHUP'),
      lifecycle.teardown(),
    ]);

    expect(events).toEqual(['stopped', 'replayed:SIGTERM']);
    expect(emitter.eventNames()).toEqual([]);
  });

  test('a cleanup error still removes handlers and replays expected signal semantics once', async () => {
    const { createE2eServiceLifecycle } = await loadHarness();
    const { emitter, target } = signalTarget();
    const replayed: NodeJS.Signals[] = [];
    let stops = 0;
    const lifecycle = createE2eServiceLifecycle({
      async stop() {
        stops += 1;
        throw new Error('cleanup failed');
      },
    }, {
      signalTarget: target,
      replaySignal(signal) { replayed.push(signal); },
    });

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
