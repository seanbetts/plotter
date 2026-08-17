import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { afterEach, expect, it } from 'vitest';

const repositoryRoot = realpathSync(resolve(import.meta.dirname, '..'));
const processes: ChildProcess[] = [];
const temporaryDirectories: string[] = [];

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Could not reserve a loopback port for the service test.');
  }
  await new Promise<void>((resolvePromise, reject) => {
    server.close((error) => error ? reject(error) : resolvePromise());
  });
  return address.port;
}

afterEach(() => {
  for (const process of processes.splice(0)) {
    process.kill();
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

it('reports initializing from the loopback health endpoint', async () => {
  const testDataParent = resolve(repositoryRoot, 'tests', '.tmp');
  mkdirSync(testDataParent, { recursive: true });
  const dataDirectory = mkdtempSync(resolve(testDataParent, 'service-health-'));
  temporaryDirectories.push(dataDirectory);
  const port = await reservePort();
  const child = spawn(process.execPath, [
    resolve(repositoryRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    'server/service.ts',
    '--port', String(port),
    '--data-dir', dataDirectory,
  ], {
    cwd: repositoryRoot,
    stdio: 'ignore',
  });
  processes.push(child);

  await expect.poll(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`);
      return { status: response.status, body: await response.json() };
    } catch {
      return null;
    }
  }, { interval: 50, timeout: 3_000 }).toEqual({
    status: 503,
    body: { status: 'initializing' },
  });
});

it('starts the bundled service with an existing env file without exposing its contents', async () => {
  const testDataParent = resolve(repositoryRoot, 'tests', '.tmp');
  mkdirSync(testDataParent, { recursive: true });
  const dataDirectory = mkdtempSync(resolve(testDataParent, 'service-bundle-'));
  temporaryDirectories.push(dataDirectory);
  const envFile = resolve(dataDirectory, '.service.env');
  writeFileSync(envFile, 'PLOTTER_SERVICE_BUNDLE_TEST=not-for-output\n');
  const port = await reservePort();
  execFileSync(resolve(repositoryRoot, 'node_modules', '.bin', 'esbuild'), [
    'server/service.ts',
    '--bundle',
    '--platform=node',
    '--format=esm',
    '--outfile=server-dist/service.mjs',
  ], { cwd: repositoryRoot, stdio: 'ignore' });
  const child = spawn(process.execPath, [
    'server-dist/service.mjs',
    '--port', String(port),
    '--data-dir', dataDirectory,
    '--env-file', envFile,
  ], {
    cwd: repositoryRoot,
    stdio: 'ignore',
  });
  processes.push(child);

  await expect.poll(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`);
      return { status: response.status, body: await response.json() };
    } catch {
      return null;
    }
  }, { interval: 50, timeout: 3_000 }).toEqual({
    status: 503,
    body: { status: 'initializing' },
  });
});
