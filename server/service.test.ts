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

it('reports ready after opening the canonical database and service stores', async () => {
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
    status: 200,
    body: { ready: true },
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
    status: 200,
    body: { ready: true },
  });
});

it('stays reachable with redacted readiness when the canonical database is invalid', async () => {
  const testDataParent = resolve(repositoryRoot, 'tests', '.tmp');
  mkdirSync(testDataParent, { recursive: true });
  const dataDirectory = mkdtempSync(resolve(testDataParent, 'service-invalid-'));
  temporaryDirectories.push(dataDirectory);
  writeFileSync(resolve(dataDirectory, 'plotter.sqlite3'), 'not a sqlite database');
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
    body: {
      status: 503,
      error: { code: 'storage-unavailable', message: 'Plotter storage is unavailable.' },
    },
  });
});

it('creates, lists, and explicitly restores portable backups while recovering service readiness', async () => {
  const testDataParent = resolve(repositoryRoot, 'tests', '.tmp');
  mkdirSync(testDataParent, { recursive: true });
  const dataDirectory = mkdtempSync(resolve(testDataParent, 'service-backup-'));
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
    try { return (await fetch(`http://127.0.0.1:${port}/healthz`)).status; } catch { return 0; }
  }, { interval: 50, timeout: 3_000 }).toBe(200);
  const headers = { 'content-type': 'application/json', 'x-plotter-write': '1' };
  const created = await fetch(`http://127.0.0.1:${port}/api/v1/trips`, {
    method: 'POST', headers, body: JSON.stringify({ expectedRevision: 0, name: 'Before backup' }),
  });
  const createdBody = await created.json() as { trip: { id: string } };
  const backupResponse = await fetch(`http://127.0.0.1:${port}/api/v1/backups`, {
    method: 'POST', headers,
  });
  expect(backupResponse.status).toBe(201);
  const backupBody = await backupResponse.json() as { backup: { id: string } };
  const changed = await fetch(`http://127.0.0.1:${port}/api/v1/trips/${createdBody.trip.id}`, {
    method: 'PATCH', headers,
    body: JSON.stringify({ expectedRevision: 1, patch: { name: 'After backup' } }),
  });
  expect(changed.status).toBe(200);

  const wrongConfirmation = await fetch(
    `http://127.0.0.1:${port}/api/v1/backups/${backupBody.backup.id}/restore`,
    { method: 'POST', headers, body: JSON.stringify({ confirmation: 'RESTORE wrong' }) },
  );
  expect(wrongConfirmation.status).toBe(400);
  const restored = await fetch(
    `http://127.0.0.1:${port}/api/v1/backups/${backupBody.backup.id}/restore`,
    { method: 'POST', headers, body: JSON.stringify({ confirmation: `RESTORE ${backupBody.backup.id}` }) },
  );
  expect(restored.status).toBe(200);
  await expect((await fetch(`http://127.0.0.1:${port}/healthz`)).json()).resolves.toEqual({ ready: true });
  await expect((await fetch(`http://127.0.0.1:${port}/api/v1/trips`)).json()).resolves.toMatchObject({
    revision: 1,
    trips: [{ id: createdBody.trip.id, name: 'Before backup' }],
  });
  const listed = await (await fetch(`http://127.0.0.1:${port}/api/v1/backups`)).json() as {
    backups: Array<{ id: string }>;
  };
  expect(listed.backups.some((backup) => backup.id.startsWith('recovery-before-restore-'))).toBe(true);
});

it('composes revisioned SQLite writes, atomic media, and ID-only content reads over HTTP', async () => {
  const testDataParent = resolve(repositoryRoot, 'tests', '.tmp');
  mkdirSync(testDataParent, { recursive: true });
  const dataDirectory = mkdtempSync(resolve(testDataParent, 'service-wiring-'));
  temporaryDirectories.push(dataDirectory);
  const port = await reservePort();
  const baseUrl = `http://127.0.0.1:${port}`;
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
    try { return (await fetch(`${baseUrl}/healthz`)).status; } catch { return 0; }
  }, { interval: 50, timeout: 3_000 }).toBe(200);

  const writeHeaders = { 'content-type': 'application/json', 'x-plotter-write': '1' };
  const createdResponse = await fetch(`${baseUrl}/api/v1/trips`, {
    method: 'POST', headers: writeHeaders, body: JSON.stringify({ expectedRevision: 0, name: 'Wiring' }),
  });
  expect(createdResponse.status).toBe(201);
  const created = await createdResponse.json() as { trip: { id: string } };
  const destination = {
    id: 'destination-1', name: 'Oslo', countryRegion: 'Norway', coordinates: { lat: 59.9, lng: 10.7 },
    routingAnchors: {}, location: { placeName: 'Oslo', regionName: 'Oslo', countryName: 'Norway', countryCode: 'NO', sourceLabel: 'Oslo', sourceProvider: 'maptiler' },
    order: 0, status: 'planned', priority: 'high', timing: { idealMonths: ['March'], expectedStayDays: 2, provisionalStartDate: '', provisionalEndDate: '' },
    why: { summary: '', highlights: '', personalRationale: '' }, media: [], research: { notes: '', links: [], bookReferences: [] },
    activities: { items: [] }, routeContext: { previousNextNotes: '', drivingNotes: '', borderShippingNotes: '', notes: '' }, tags: [],
    createdAt: '2026-08-17T00:00:00.000Z', updatedAt: '2026-08-17T00:00:00.000Z',
  };
  const mutation = await fetch(`${baseUrl}/api/v1/trips/${created.trip.id}/mutations`, {
    method: 'POST', headers: writeHeaders,
    body: JSON.stringify({ expectedRevision: 0, mutation: { type: 'save-destination', destination } }),
  });
  expect(mutation.status).toBe(200);

  const form = new FormData();
  form.set('expectedRevision', '1');
  form.set('file', new File([new TextEncoder().encode('service image')], 'ignored.png', { type: 'image/png' }));
  const uploadedResponse = await fetch(`${baseUrl}/api/v1/trips/${created.trip.id}/destinations/${destination.id}/media`, {
    method: 'POST', headers: { 'x-plotter-write': '1' }, body: form,
  });
  expect(uploadedResponse.status).toBe(200);
  const uploaded = await uploadedResponse.json() as { mediaItem: { id: string } };
  const content = await fetch(`${baseUrl}/api/v1/media/${uploaded.mediaItem.id}/content`);
  expect(content.status).toBe(200);
  expect(content.headers.get('content-type')).toBe('image/png');
  expect(await content.text()).toBe('service image');
});
