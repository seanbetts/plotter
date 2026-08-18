import { createServer, type Server } from 'node:http';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createDestination } from '../src/domain/destinations';
import { createPlotterHttpHandler, type PlotterHttpDependencies } from './http';
import { createPlotterStorageRuntime, type PlotterStorageRuntime } from './storageRuntime';

const directories: string[] = [];
const servers: Server[] = [];
const runtimes: PlotterStorageRuntime[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const runtime of runtimes.splice(0)) {
    try { runtime.close(); } catch { /* Test cleanup keeps the original failure. */ }
  }
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function dependencies(runtime: PlotterStorageRuntime, publicRoot: string): PlotterHttpDependencies {
  return {
    ...runtime,
    providers: {
      async linkPreview() { throw new Error('unused'); },
      async imageSearch() { throw new Error('unused'); },
      async remoteImage() { throw new Error('unused'); },
    },
    publicRoot,
  };
}

async function start(runtime: PlotterStorageRuntime, publicRoot: string): Promise<string> {
  const handler = createPlotterHttpHandler(dependencies(runtime, publicRoot));
  const server = createServer((request, response) => { void handler(request, response); });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('HTTP server did not bind.');
  return `http://127.0.0.1:${address.port}`;
}

const writeHeaders = { 'content-type': 'application/json', 'x-plotter-write': '1' };

async function expectUnavailable(response: Response): Promise<void> {
  expect(response.status).toBe(503);
  await expect(response.json()).resolves.toEqual({
    status: 503,
    error: { code: 'storage-unavailable', message: 'Plotter storage is unavailable.' },
  });
}

function imageStream(value: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(value));
      controller.close();
    },
  });
}

it('keeps the real gated service unavailable after ambiguous marker invalidation until restart recovery', async () => {
  const dataDirectory = mkdtempSync(join(tmpdir(), 'plotter-storage-runtime-'));
  directories.push(dataDirectory);
  const publicRoot = join(dataDirectory, 'public');
  mkdirSync(publicRoot);
  writeFileSync(join(publicRoot, 'index.html'), '<!doctype html>');
  let failMarkerPublication = true;
  let reportInvalidationStarted: (() => void) | undefined;
  let releaseInvalidationFailure: (() => void) | undefined;
  const invalidationStarted = new Promise<void>((resolve) => { reportInvalidationStarted = resolve; });
  const invalidationRelease = new Promise<void>((resolve) => { releaseInvalidationFailure = resolve; });
  const runtime = await createPlotterStorageRuntime({
    dataDirectory,
    backupDurability: {
      async syncDirectory(_path, phase) {
        if (phase === 'restore-marker-published' && failMarkerPublication) {
          failMarkerPublication = false;
          throw new Error('controlled marker publication sync failure');
        }
        if (phase === 'restore-marker-invalidated') {
          reportInvalidationStarted?.();
          await invalidationRelease;
          throw new Error('controlled marker invalidation sync failure');
        }
      },
    },
  });
  runtimes.push(runtime);
  const baseUrl = await start(runtime, publicRoot);

  const createdResponse = await fetch(`${baseUrl}/api/v1/trips`, {
    method: 'POST', headers: writeHeaders,
    body: JSON.stringify({ expectedRevision: 0, name: 'Acknowledged before backup' }),
  });
  expect(createdResponse.status).toBe(201);
  const created = await createdResponse.json() as { trip: { id: string } };
  const capturedTripRepository = runtime.tripRepository(created.trip.id);
  const backupResponse = await fetch(`${baseUrl}/api/v1/backups`, {
    method: 'POST', headers: writeHeaders,
  });
  expect(backupResponse.status).toBe(201);
  const backup = await backupResponse.json() as { backup: { id: string } };
  const changedResponse = await fetch(`${baseUrl}/api/v1/trips/${created.trip.id}`, {
    method: 'PATCH', headers: writeHeaders,
    body: JSON.stringify({ expectedRevision: 1, patch: { name: 'Acknowledged current state' } }),
  });
  expect(changedResponse.status).toBe(200);

  const restoreRequest = fetch(
    `${baseUrl}/api/v1/backups/${backup.backup.id}/restore`,
    {
      method: 'POST', headers: writeHeaders,
      body: JSON.stringify({ confirmation: `RESTORE ${backup.backup.id}` }),
    },
  );
  await invalidationStarted;
  let queuedWriteSettled = false;
  const queuedWrite = fetch(`${baseUrl}/api/v1/trips`, {
    method: 'POST', headers: writeHeaders,
    body: JSON.stringify({ expectedRevision: 1, name: 'Must not be queued into restored state' }),
  }).finally(() => { queuedWriteSettled = true; });
  await Promise.resolve();
  expect(queuedWriteSettled).toBe(false);
  releaseInvalidationFailure?.();

  await expectUnavailable(await restoreRequest);
  await expectUnavailable(await queuedWrite);

  await expectUnavailable(await fetch(`${baseUrl}/healthz`));
  await expectUnavailable(await fetch(`${baseUrl}/api/v1/trips`));
  await expectUnavailable(await fetch(`${baseUrl}/api/v1/trips`, {
    method: 'POST', headers: writeHeaders,
    body: JSON.stringify({ expectedRevision: 2, name: 'Must not be written' }),
  }));
  await expectUnavailable(await fetch(`${baseUrl}/api/v1/trips/${created.trip.id}`, {
    method: 'PATCH', headers: writeHeaders,
    body: JSON.stringify({ expectedRevision: 2, patch: { name: 'Must not replace current state' } }),
  }));
  await expect(capturedTripRepository.load()).rejects.toThrow('Plotter storage is unavailable.');
  await expect(runtime.backups.list()).rejects.toThrow('Plotter storage is unavailable.');

  const activeTransaction = readdirSync(dataDirectory)
    .find((name) => /^\.portable-restore-[0-9a-f-]+$/.test(name));
  expect(activeTransaction).toBeDefined();
  expect(readdirSync(join(dataDirectory, activeTransaction!))).not.toContain('restore-committed');

  runtime.close();
  runtimes.splice(runtimes.indexOf(runtime), 1);
  const restarted = await createPlotterStorageRuntime({ dataDirectory });
  runtimes.push(restarted);

  expect(restarted.readiness()).toEqual({ ready: true });
  await expect(restarted.directory.load()).resolves.toMatchObject({
    revision: 2,
    trips: [{ id: created.trip.id, name: 'Acknowledged current state' }],
  });
  expect(readdirSync(dataDirectory).some((name) => name.startsWith('.portable-restore-')))
    .toBe(false);
});

it('fails readiness without deleting an invalid durable media operation', async () => {
  const dataDirectory = mkdtempSync(join(tmpdir(), 'plotter-storage-runtime-media-intent-'));
  directories.push(dataDirectory);
  const operationDirectory = join(dataDirectory, '.media-operations');
  mkdirSync(operationDirectory, { mode: 0o700 });
  const operationPath = join(
    operationDirectory,
    'media-operation-00000000-0000-4000-8000-000000000001.json',
  );
  writeFileSync(operationPath, '{"version":1,"kind":"unknown"}\n', { mode: 0o600 });

  const runtime = await createPlotterStorageRuntime({ dataDirectory });
  runtimes.push(runtime);

  expect(runtime.readiness()).toEqual({ ready: false });
  expect(() => runtime.directory.load()).toThrow('Plotter storage is unavailable.');
  expect(readdirSync(operationDirectory)).toEqual([
    'media-operation-00000000-0000-4000-8000-000000000001.json',
  ]);
});

it('reconciles a committed media journal before restoring an older paired database and media tree', async () => {
  const dataDirectory = mkdtempSync(join(tmpdir(), 'plotter-storage-runtime-journal-restore-'));
  directories.push(dataDirectory);
  let failNextIntentClear = false;
  const runtime = await createPlotterStorageRuntime({
    dataDirectory,
    mediaDurability: {
      async onPhase(phase) {
        if (failNextIntentClear && phase === 'intent-clear-start') {
          failNextIntentClear = false;
          throw new Error('interrupt:intent-clear-start');
        }
      },
    },
  });
  runtimes.push(runtime);
  const createdTrip = await runtime.directory.create(0, {
    expectedRevision: 0,
    name: 'Journal restore',
  });
  const trip = createdTrip.trip!;
  const destination = createDestination({
    name: 'Reykjavik', coordinates: { lat: 64.1466, lng: -21.9426 },
  });
  const repository = runtime.tripRepository(trip.id);
  await repository.mutate(0, { type: 'save-destination', destination });
  const createdMedia = await repository.createDestinationMedia(1, destination.id, {
    bytes: imageStream('restored media bytes'), contentType: 'image/png',
  });
  const backup = await runtime.backups.create();

  failNextIntentClear = true;
  await expect(repository.deleteDestinationMedia(2, createdMedia.mediaItem!.id))
    .resolves.toEqual({ revision: 3 });
  expect(readdirSync(join(dataDirectory, '.media-operations'))).toHaveLength(1);
  expect(readdirSync(join(dataDirectory, 'trash'))).toHaveLength(1);

  await expect(runtime.backups.restore(backup.id, { confirmation: `RESTORE ${backup.id}` }))
    .resolves.toMatchObject({ id: backup.id });

  expect(runtime.readiness()).toEqual({ ready: true });
  expect(readdirSync(join(dataDirectory, '.media-operations'))).toEqual([]);
  await expect(runtime.tripRepository(trip.id).listDestinationMedia(destination.id))
    .resolves.toEqual([expect.objectContaining({ id: createdMedia.mediaItem!.id })]);
  const opened = await runtime.mediaContent.open(createdMedia.mediaItem!.id);
  const chunks: Uint8Array[] = [];
  for await (const chunk of opened.bytes) chunks.push(chunk);
  expect(Buffer.concat(chunks).toString('utf8')).toBe('restored media bytes');
});
