import { createServer, get as httpGet, type Server } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TripMutationRequest } from '../src/api/contracts';
import type { RevisionEvent } from '../src/storage/revision';
import { TripStorageConflictError } from '../src/storage/revision';
import type { RevisionedDirectoryStore } from './directoryRepository';
import type { RevisionEventSource } from './http';
import { createPlotterHttpHandler, type PlotterHttpDependencies } from './http';
import type { MediaStore } from './mediaStore';
import {
  PortableBackupCreateError,
  PortableBackupInvalidError,
  PortableRestoreConfirmationError,
  PortableRestoreRecoveredError,
} from './portableBackup';
import type { RevisionedTripStore } from './tripRepository';

const temporaryDirectories: string[] = [];
const servers: Server[] = [];

function publicRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'plotter-http-public-'));
  temporaryDirectories.push(root);
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>Plotter</title>');
  writeFileSync(join(root, 'app.js'), 'globalThis.plotter = true;');
  return root;
}

function stream(value: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(value));
      controller.close();
    },
  });
}

function dependencies() {
  let revisionListener: ((event: RevisionEvent) => void) | undefined;
  const mutations: TripMutationRequest[] = [];
  const directory: RevisionedDirectoryStore = {
    async load() { return { revision: 2, trips: [] }; },
    async create() { return { revision: 3, trip: undefined }; },
    async update() { return { revision: 3, trip: undefined }; },
    async delete() { return { revision: 3 }; },
  };
  const trip: RevisionedTripStore = {
    async load() { return { revision: 4, destinations: [], routeLegs: [], activities: [] }; },
    async loadContext() {
      return {
        directoryRevision: 2,
        tripRevision: 4,
        trip: {
          id: 'trip-1',
          name: 'North',
          description: '',
          createdAt: '2026-08-17T10:00:00.000Z',
          updatedAt: '2026-08-17T10:00:00.000Z',
          routingVehicle: { preset: 'standard', profile: 'driving-car', restrictions: {} },
        },
        destinations: [],
        routeLegs: [],
        activities: [],
      };
    },
    async mutate(_expectedRevision, mutation) {
      mutations.push(mutation);
      return { revision: 5 };
    },
    async listDestinationMedia() { return []; },
    async listActivityMedia() { return []; },
    async createDestinationMedia() { return { revision: 5 }; },
    async createActivityMedia() { return { revision: 5 }; },
    async updateDestinationMedia() { return { revision: 5 }; },
    async updateActivityMedia() { return { revision: 5 }; },
    async deleteDestinationMedia() { return { revision: 5 }; },
    async deleteActivityMedia() { return { revision: 5 }; },
    async reorderDestinationMedia() { return { revision: 5 }; },
    async reorderActivityMedia() { return { revision: 5 }; },
  };
  const media: MediaStore = {
    async stage() { throw new Error('unused'); },
    async commit() { throw new Error('unused'); },
    async moveToTrash() { throw new Error('unused'); },
    async open() { throw new Error('unused'); },
  };
  const events: RevisionEventSource = {
    subscribe(listener) {
      revisionListener = listener;
      return () => { revisionListener = undefined; };
    },
  };
  const values: PlotterHttpDependencies = {
      directory,
      tripRepository: () => trip,
      media,
      mediaContent: {
        async open() {
          return {
            contentType: 'image/png',
            contentLength: 5,
            filename: 'image.png',
            bytes: (async function* () { yield new TextEncoder().encode('image'); })(),
          };
        },
      },
      events,
      readiness: () => ({ ready: true }),
      providers: {
        async linkPreview() {
          return { url: 'https://example.com/', title: 'Example', domain: 'example.com' };
        },
        async imageSearch({ query }: { query: string }) {
          return [{
            id: 'result-1',
            title: query,
            sourceName: 'Example',
            sourceUrl: 'https://example.com/page',
            thumbnailUrl: 'https://example.com/thumb.jpg',
            imageUrl: 'https://example.com/image.jpg',
          }];
        },
        async remoteImage() { return { bytes: stream('remote'), contentType: 'image/jpeg' }; },
      },
      backups: {
        async create() {
          return { id: 'backup-1', createdAt: '2026-08-17T12:00:00.000Z', schemaVersion: 1, directoryRevision: 2, tripRevisions: {} };
        },
        async list() { return []; },
        async inspect() {
          return { id: 'backup-1', createdAt: '2026-08-17T12:00:00.000Z', schemaVersion: 1, directoryRevision: 2, tripRevisions: {}, files: [] };
        },
        async restore() {
          return { id: 'backup-1', createdAt: '2026-08-17T12:00:00.000Z', schemaVersion: 1, directoryRevision: 2, tripRevisions: {} };
        },
      },
      publicRoot: publicRoot(),
  };
  return {
    values,
    mutations,
    publish(event: RevisionEvent) { revisionListener?.(event); },
    subscribed() { return revisionListener !== undefined; },
  };
}

async function start(values: ReturnType<typeof dependencies>['values']) {
  const server = createServer((request, response) => {
    void createPlotterHttpHandler(values)(request, response);
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('HTTP test server did not bind.');
  return `http://127.0.0.1:${address.port}`;
}

async function startObserved(values: ReturnType<typeof dependencies>['values']) {
  let settled = false;
  const handler = createPlotterHttpHandler(values);
  const server = createServer((request, response) => {
    void handler(request, response).finally(() => { settled = true; });
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('HTTP test server did not bind.');
  return { base: `http://127.0.0.1:${address.port}`, settled: () => settled };
}

async function jsonRequest(url: string, method: string, body?: unknown, write = false) {
  return fetch(url, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(write ? { 'x-plotter-write': '1' } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('Plotter HTTP state routes', () => {
  it('reports ready health and unavailable readiness without exposing its raw reason', async () => {
    const ready = dependencies();
    const readyBase = await start(ready.values);
    const readyResponse = await fetch(`${readyBase}/healthz`);
    expect(readyResponse.status).toBe(200);
    expect(readyResponse.headers.get('cache-control')).toBe('no-store');
    await expect(readyResponse.json()).resolves.toEqual({ ready: true });

    const readyHeadResponse = await fetch(`${readyBase}/healthz`, { method: 'HEAD' });
    expect(readyHeadResponse.status).toBe(200);
    expect(readyHeadResponse.headers.get('cache-control')).toBe('no-store');
    await expect(readyHeadResponse.text()).resolves.toBe('');

    const unavailable = dependencies();
    unavailable.values.readiness = () => ({ ready: false, reason: '/private/path sqlite exploded' });
    const unavailableBase = await start(unavailable.values);
    const unavailableResponse = await fetch(`${unavailableBase}/healthz`);
    expect(unavailableResponse.status).toBe(503);
    await expect(unavailableResponse.json()).resolves.toEqual({
      status: 503,
      error: { code: 'storage-unavailable', message: 'Plotter storage is unavailable.' },
    });

    const unavailableHeadResponse = await fetch(`${unavailableBase}/healthz`, { method: 'HEAD' });
    expect(unavailableHeadResponse.status).toBe(503);
    expect(unavailableHeadResponse.headers.get('cache-control')).toBe('no-store');
    await expect(unavailableHeadResponse.text()).resolves.toBe('');
  });

  it('routes directory CRUD and coherent trip snapshots through revisioned stores', async () => {
    const harness = dependencies();
    const create = vi.spyOn(harness.values.directory, 'create');
    const update = vi.spyOn(harness.values.directory, 'update');
    const remove = vi.spyOn(harness.values.directory, 'delete');
    const base = await start(harness.values);

    const listResponse = await fetch(`${base}/api/v1/trips`);
    expect(await listResponse.json()).toEqual({ revision: 2, trips: [] });
    const createResponse = await jsonRequest(`${base}/api/v1/trips`, 'POST', {
      expectedRevision: 2,
      name: 'Aurora',
    }, true);
    expect(createResponse.status).toBe(201);
    expect(create).toHaveBeenCalledWith(2, { expectedRevision: 2, name: 'Aurora' });

    const tripResponse = await fetch(`${base}/api/v1/trips/trip-1`);
    await expect(tripResponse.json()).resolves.toEqual({
      revision: 4,
      destinations: [],
      routeLegs: [],
      activities: [],
    });
    await jsonRequest(`${base}/api/v1/trips/trip-1`, 'PATCH', {
      expectedRevision: 2,
      patch: { name: 'North', description: 'Winter' },
    }, true);
    expect(update).toHaveBeenCalledWith(2, 'trip-1', {
      expectedRevision: 2,
      patch: { name: 'North', description: 'Winter' },
    });
    await jsonRequest(`${base}/api/v1/trips/trip-1`, 'DELETE', { expectedRevision: 3 }, true);
    expect(remove).toHaveBeenCalledWith(3, 'trip-1');
  });

  it('returns one active-trip context snapshot without invoking external providers', async () => {
    const harness = dependencies();
    const contextSnapshot = {
      directoryRevision: 2,
      tripRevision: 4,
      trip: {
        id: 'trip-1',
        name: 'North',
        description: 'Winter route',
        createdAt: '2026-08-17T10:00:00.000Z',
        updatedAt: '2026-08-17T11:00:00.000Z',
        routingVehicle: {
          preset: 'large-camper' as const,
          profile: 'driving-car' as const,
          restrictions: { height: 3.2 },
        },
      },
      destinations: [],
      routeLegs: [],
      activities: [],
    };
    const loadContext = vi.fn(async () => contextSnapshot);
    Object.assign(harness.values.tripRepository('trip-1'), { loadContext });
    const linkPreview = vi.spyOn(harness.values.providers, 'linkPreview');
    const imageSearch = vi.spyOn(harness.values.providers, 'imageSearch');
    const remoteImage = vi.spyOn(harness.values.providers, 'remoteImage');
    const base = await start(harness.values);

    const response = await fetch(`${base}/api/v1/trips/trip-1/context`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(contextSnapshot);
    expect(loadContext).toHaveBeenCalledOnce();
    expect(linkPreview).not.toHaveBeenCalled();
    expect(imageSearch).not.toHaveBeenCalled();
    expect(remoteImage).not.toHaveBeenCalled();
  });

  it.each<[string, TripMutationRequest]>([
    ['save-destination', { type: 'save-destination', destination: {
      id: 'destination-1', name: 'Oslo', countryRegion: 'Norway', coordinates: { lat: 59.9, lng: 10.7 },
      routingAnchors: {}, location: { placeName: 'Oslo', regionName: 'Oslo', countryName: 'Norway', countryCode: 'NO', sourceLabel: 'Oslo', sourceProvider: 'maptiler' },
      order: 0, status: 'planned', priority: 'high', timing: { idealMonths: ['March'], expectedStayDays: 2, provisionalStartDate: '', provisionalEndDate: '' },
      why: { summary: '', highlights: '', personalRationale: '' }, media: [], research: { notes: '', links: [], bookReferences: [] },
      activities: { items: [] }, routeContext: { previousNextNotes: '', drivingNotes: '', borderShippingNotes: '', notes: '' }, tags: [],
      createdAt: '2026-08-17T00:00:00.000Z', updatedAt: '2026-08-17T00:00:00.000Z',
    } }],
    ['delete-destination', { type: 'delete-destination', destinationId: 'destination-1' }],
    ['delete-destinations', { type: 'delete-destinations', destinationIds: ['destination-1'] }],
    ['save-route-leg', { type: 'save-route-leg', routeLeg: {
      id: 'leg-1', originDestinationId: 'destination-1', targetDestinationId: 'destination-2', movement: 'drive', calculation: 'automatic',
      status: 'pending', notes: '', createdAt: '2026-08-17T00:00:00.000Z', updatedAt: '2026-08-17T00:00:00.000Z',
    } }],
    ['delete-route-leg', { type: 'delete-route-leg', routeLegId: 'leg-1' }],
    ['apply-trip-mutation', { type: 'apply-trip-mutation', delta: { destinationsToUpsert: [], destinationIdsToDelete: [], routeLegsToUpsert: [], routeLegIdsToDelete: [] } }],
    ['replace-trip-data', { type: 'replace-trip-data', snapshot: { destinations: [], routeLegs: [], activities: [] } }],
    ['create-activity', { type: 'create-activity', input: { destinationId: 'destination-1', title: 'Museum', order: 0 } }],
    ['update-activity', { type: 'update-activity', activityId: 'activity-1', patch: { title: 'Gallery', notes: 'Visit' } }],
    ['delete-activity', { type: 'delete-activity', activityId: 'activity-1' }],
    ['reorder-activities', { type: 'reorder-activities', destinationId: 'destination-1', orderedActivityIds: ['activity-1'] }],
  ])('accepts the bounded %s mutation', async (_name, mutation) => {
    const harness = dependencies();
    const base = await start(harness.values);
    const response = await jsonRequest(`${base}/api/v1/trips/trip-1/mutations`, 'POST', {
      expectedRevision: 4,
      mutation,
    }, true);
    expect(response.status).toBe(200);
    expect(harness.mutations).toEqual([mutation]);
  });
});

describe('Plotter HTTP media and provider routes', () => {
  it('accepts multipart uploads, imports remote images, and cancels unconsumed remote streams', async () => {
    const harness = dependencies();
    const upload = vi.spyOn(harness.values.tripRepository('trip-1'), 'createDestinationMedia');
    const base = await start(harness.values);
    const form = new FormData();
    form.set('expectedRevision', '4');
    form.set('caption', 'Harbour');
    form.set('file', new File([new Uint8Array([1, 2, 3])], 'unsafe-name.png', { type: 'image/png' }));
    const uploadResponse = await fetch(`${base}/api/v1/trips/trip-1/destinations/destination-1/media`, {
      method: 'POST',
      headers: { 'x-plotter-write': '1' },
      body: form,
    });
    expect(uploadResponse.status).toBe(200);
    expect(upload).toHaveBeenCalledOnce();

    let cancelled = false;
    harness.values.providers.remoteImage = async () => ({
      contentType: 'image/jpeg',
      bytes: new ReadableStream({ cancel() { cancelled = true; } }),
    });
    harness.values.tripRepository('trip-1').createDestinationMedia = async () => {
      throw new Error('database failed at /private/plotter.sqlite3');
    };
    const importResponse = await jsonRequest(`${base}/api/v1/trips/trip-1/destinations/destination-1/media/import`, 'POST', {
      expectedRevision: 4,
      result: {
        id: 'result-1', title: 'Harbour', sourceName: 'Example', sourceUrl: 'https://example.com/page',
        thumbnailUrl: 'https://example.com/thumb.jpg', imageUrl: 'https://example.com/image.jpg',
      },
    }, true);
    expect(importResponse.status).toBe(500);
    expect(cancelled).toBe(true);
    expect(await importResponse.text()).not.toContain('/private/plotter.sqlite3');
  });

  it('serves media with safe immutable headers and routes list/update/delete/reorder/rollup', async () => {
    const harness = dependencies();
    const base = await start(harness.values);
    const content = await fetch(`${base}/api/v1/media/media-1/content`);
    expect(content.status).toBe(200);
    expect(content.headers.get('content-type')).toBe('image/png');
    expect(content.headers.get('content-length')).toBe('5');
    expect(content.headers.get('content-disposition')).toBe('inline; filename="image.png"');
    expect(content.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await content.text()).toBe('image');

    expect((await fetch(`${base}/api/v1/trips/trip-1/destinations/destination-1/media`)).status).toBe(200);
    expect((await fetch(`${base}/api/v1/trips/trip-1/activities/activity-1/media`)).status).toBe(200);
    expect((await fetch(`${base}/api/v1/trips/trip-1/destinations/destination-1/media-rollup`)).status).toBe(200);
    expect((await jsonRequest(`${base}/api/v1/trips/trip-1/destination-media/media-1`, 'PATCH', { expectedRevision: 4, patch: { caption: 'New' } }, true)).status).toBe(200);
    expect((await jsonRequest(`${base}/api/v1/trips/trip-1/destination-media/media-1`, 'DELETE', { expectedRevision: 4 }, true)).status).toBe(200);
    expect((await jsonRequest(`${base}/api/v1/trips/trip-1/activity-media/media-1`, 'PATCH', { expectedRevision: 4, patch: { credit: 'Example photographer' } }, true)).status).toBe(200);
    expect((await jsonRequest(`${base}/api/v1/trips/trip-1/activity-media/media-1`, 'DELETE', { expectedRevision: 4 }, true)).status).toBe(200);
    expect((await jsonRequest(`${base}/api/v1/trips/trip-1/destinations/destination-1/media/reorder`, 'POST', { expectedRevision: 4, orderedMediaIds: [] }, true)).status).toBe(200);
    expect((await jsonRequest(`${base}/api/v1/trips/trip-1/activities/activity-1/media/reorder`, 'POST', { expectedRevision: 4, orderedMediaIds: [] }, true)).status).toBe(200);
  });

  it('closes the media iterator and settles the handler when a backpressured client disconnects', async () => {
    const harness = dependencies();
    let returned = false;
    let nextCount = 0;
    const iterator: AsyncIterator<Uint8Array> = {
      async next() {
        if (nextCount++ === 0) {
          return { done: false, value: new Uint8Array(8 * 1024 * 1024) };
        }
        return new Promise<IteratorResult<Uint8Array>>(() => undefined);
      },
      async return() {
        returned = true;
        return { done: true, value: undefined };
      },
    };
    harness.values.mediaContent.open = async () => ({
      contentType: 'image/png',
      contentLength: 8 * 1024 * 1024,
      bytes: { [Symbol.asyncIterator]: () => iterator },
    });
    const observed = await startObserved(harness.values);

    await new Promise<void>((resolve, reject) => {
      const request = httpGet(`${observed.base}/api/v1/media/media-1/content`, (response) => {
        response.once('data', () => {
          response.destroy();
          request.destroy();
          resolve();
        });
        response.once('error', resolve);
      });
      request.once('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'ECONNRESET') resolve();
        else reject(error);
      });
    });

    await expect.poll(() => returned, { timeout: 1_000 }).toBe(true);
    await expect.poll(observed.settled, { timeout: 1_000 }).toBe(true);
  });

  it('supports activity multipart upload and remote import through the same bounded media pipeline', async () => {
    const harness = dependencies();
    const trip = harness.values.tripRepository('trip-1');
    const activityUpload = vi.spyOn(trip, 'createActivityMedia');
    const base = await start(harness.values);
    const form = new FormData();
    form.set('expectedRevision', '4');
    form.set('file', new File([new Uint8Array([1, 2])], 'activity.webp', { type: 'image/webp' }));
    const upload = await fetch(`${base}/api/v1/trips/trip-1/destinations/destination-1/activities/activity-1/media`, {
      method: 'POST', headers: { 'x-plotter-write': '1' }, body: form,
    });
    expect(upload.status).toBe(200);
    expect(activityUpload).toHaveBeenCalledOnce();

    trip.createActivityMedia = async (_revision, _destinationId, _activityId, input) => {
      const reader = input.bytes.getReader();
      while (!(await reader.read()).done) { /* consume the provider stream */ }
      reader.releaseLock();
      return { revision: 5 };
    };
    const imported = await jsonRequest(`${base}/api/v1/trips/trip-1/destinations/destination-1/activities/activity-1/media/import`, 'POST', {
      expectedRevision: 4,
      result: {
        id: 'result-1', title: 'Activity', sourceName: 'Example', sourceUrl: 'https://example.com/page',
        thumbnailUrl: 'https://example.com/thumb.jpg', imageUrl: 'https://example.com/image.jpg',
      },
    }, true);
    expect(imported.status).toBe(200);
  });

  it('routes link preview and context-enriched image search without exposing the key', async () => {
    const harness = dependencies();
    const imageSearch = vi.spyOn(harness.values.providers, 'imageSearch');
    harness.values.providers.imageSearchApiKey = 'server-secret';
    const base = await start(harness.values);
    const preview = await jsonRequest(`${base}/api/v1/link-preview`, 'POST', { url: 'https://example.com' });
    expect(preview.status).toBe(200);
    await expect(preview.json()).resolves.toMatchObject({ preview: { title: 'Example' } });
    const search = await jsonRequest(`${base}/api/v1/image-search`, 'POST', {
      query: 'street art',
      context: { stopName: 'Berlin', countryName: 'Germany' },
    });
    expect(search.status).toBe(200);
    expect(imageSearch).toHaveBeenCalledWith(
      { query: 'street art Berlin Germany' },
      'server-secret',
      expect.any(AbortSignal),
    );
    expect(await search.text()).not.toContain('server-secret');
  });
});

describe('Plotter HTTP transport and safety', () => {
  it('routes typed backup operations and leaves production mechanics injectable', async () => {
    const harness = dependencies();
    const restore = vi.spyOn(harness.values.backups, 'restore');
    const base = await start(harness.values);
    expect((await jsonRequest(`${base}/api/v1/backups`, 'POST', undefined, true)).status).toBe(201);
    expect((await fetch(`${base}/api/v1/backups`)).status).toBe(200);
    expect((await fetch(`${base}/api/v1/backups/backup-1`)).status).toBe(200);
    expect((await jsonRequest(`${base}/api/v1/backups/backup-1/restore`, 'POST', { confirmation: 'RESTORE backup-1' }, true)).status).toBe(200);
    expect(restore).toHaveBeenCalledWith('backup-1', { confirmation: 'RESTORE backup-1' });
  });

  it('quiesces state, media, and backup handlers behind the injected storage operation gate', async () => {
    const harness = dependencies();
    const order: string[] = [];
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    harness.values.operations = {
      async run(operation) {
        order.push('gate');
        await blocked;
        return operation();
      },
    };
    harness.values.directory.load = async () => {
      order.push('load');
      return { revision: 2, trips: [] };
    };
    const base = await start(harness.values);
    const response = fetch(`${base}/api/v1/trips`);
    await expect.poll(() => order).toEqual(['gate']);

    release?.();
    await expect(response.then((value) => value.status)).resolves.toBe(200);
    expect(order).toEqual(['gate', 'load']);
  });

  it('maps bounded portable-backup failures without exposing archive or recovery details', async () => {
    for (const error of [new PortableBackupInvalidError(), new PortableRestoreConfirmationError()]) {
      const harness = dependencies();
      harness.values.backups.restore = async () => { throw error; };
      const base = await start(harness.values);
      const response = await jsonRequest(`${base}/api/v1/backups/backup-1/restore`, 'POST', {
        confirmation: 'RESTORE backup-1',
      }, true);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        status: 400,
        error: { code: 'invalid-request', message: 'The request is invalid.' },
      });
    }

    for (const error of [new PortableBackupCreateError(), new PortableRestoreRecoveredError()]) {
      const harness = dependencies();
      harness.values.backups.create = async () => { throw error; };
      const base = await start(harness.values);
      const response = await jsonRequest(`${base}/api/v1/backups`, 'POST', undefined, true);
      expect(response.status).toBe(503);
      const text = await response.text();
      expect(text).toBe('{"status":503,"error":{"code":"storage-unavailable","message":"Plotter storage is unavailable."}}');
      expect(text).not.toContain(error.message);
    }
  });

  it('streams invalidation-only SSE events and unsubscribes on disconnect', async () => {
    const harness = dependencies();
    const base = await start(harness.values);
    const controller = new AbortController();
    const response = await fetch(`${base}/api/v1/events`, { signal: controller.signal });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(harness.subscribed()).toBe(true);
    const reader = response.body!.getReader();
    const initial = await reader.read();
    expect(new TextDecoder().decode(initial.value)).toContain(': heartbeat');
    harness.publish({
      kind: 'revision', epoch: '00000000-0000-4000-8000-000000000001',
      scope: 'trip', tripId: 'trip-1', revision: 5,
    });
    const event = await reader.read();
    expect(new TextDecoder().decode(event.value)).toContain(
      'data: {"kind":"revision","epoch":"00000000-0000-4000-8000-000000000001","scope":"trip","tripId":"trip-1","revision":5}',
    );
    harness.publish({
      kind: 'restore-reset', epoch: '00000000-0000-4000-8000-000000000002',
      scope: 'trip', tripId: 'trip-1',
    });
    const reset = await reader.read();
    expect(new TextDecoder().decode(reset.value)).toContain(
      'id: restore-reset:00000000-0000-4000-8000-000000000002:trip:trip-1\nevent: revision\ndata: {"kind":"restore-reset","epoch":"00000000-0000-4000-8000-000000000002","scope":"trip","tripId":"trip-1"}',
    );
    controller.abort();
    await expect.poll(() => harness.subscribed()).toBe(false);
  });

  it.each([
    ['missing write marker', (base: string) => jsonRequest(`${base}/api/v1/trips`, 'POST', { expectedRevision: 0, name: 'No' })],
    ['invalid JSON', (base: string) => fetch(`${base}/api/v1/trips`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-plotter-write': '1' }, body: '{' })],
    ['unknown property', (base: string) => jsonRequest(`${base}/api/v1/trips`, 'POST', { expectedRevision: 0, name: 'No', sql: 'DROP TABLE trips' }, true)],
    ['invalid ID', (base: string) => fetch(`${base}/api/v1/trips/%2Fetc%2Fpasswd`)],
    ['unknown mutation', (base: string) => jsonRequest(`${base}/api/v1/trips/trip-1/mutations`, 'POST', { expectedRevision: 4, mutation: { type: 'execute-sql', sql: 'SELECT 1' } }, true)],
  ])('returns structured 400 for %s', async (_name, request) => {
    const harness = dependencies();
    const base = await start(harness.values);
    const response = await request(base);
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      status: 400,
      error: { code: 'invalid-request', message: 'The request is invalid.' },
    });
  });

  it('rejects oversized JSON before parsing', async () => {
    const harness = dependencies();
    const base = await start(harness.values);
    const response = await fetch(`${base}/api/v1/trips`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-plotter-write': '1' },
      body: JSON.stringify({ expectedRevision: 0, name: 'x'.repeat(1_048_576) }),
    });
    expect(response.status).toBe(400);
  });

  it('accepts only application/json with an optional single UTF-8 charset', async () => {
    const harness = dependencies();
    const base = await start(harness.values);
    for (const contentType of [
      'application/problem+json',
      'application/json; invalid-parameter',
      'application/json;',
      'application/json; charset=iso-8859-1',
      'application/json; charset=utf-8; charset=utf-8',
      'application/json; charset=utf-8; profile=private',
    ]) {
      const response = await fetch(`${base}/api/v1/trips`, {
        method: 'POST',
        headers: { 'content-type': contentType, 'x-plotter-write': '1' },
        body: JSON.stringify({ expectedRevision: 0, name: 'Strict JSON' }),
      });
      expect(response.status, contentType).toBe(400);
      expect(response.headers.get('content-type')).toContain('application/json');
    }

    const accepted = await fetch(`${base}/api/v1/trips`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=UTF-8', 'x-plotter-write': '1' },
      body: JSON.stringify({ expectedRevision: 0, name: 'UTF-8 JSON' }),
    });
    expect(accepted.status).toBe(201);
  });

  it('rejects malformed and oversized multipart media before repository writes', async () => {
    const harness = dependencies();
    const create = vi.spyOn(harness.values.tripRepository('trip-1'), 'createDestinationMedia');
    const base = await start(harness.values);
    const malformed = await fetch(`${base}/api/v1/trips/trip-1/destinations/destination-1/media`, {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=missing', 'x-plotter-write': '1' },
      body: 'not multipart',
    });
    expect(malformed.status).toBe(400);

    const unsupportedForm = new FormData();
    unsupportedForm.set('expectedRevision', '4');
    unsupportedForm.set('file', new File([new Uint8Array([1])], 'notes.txt', { type: 'text/plain' }));
    const unsupportedType = await fetch(`${base}/api/v1/trips/trip-1/destinations/destination-1/media`, {
      method: 'POST', headers: { 'x-plotter-write': '1' }, body: unsupportedForm,
    });
    expect(unsupportedType.status).toBe(400);

    const form = new FormData();
    form.set('expectedRevision', '4');
    form.set('file', new File([new Uint8Array(52_428_801)], 'too-large.png', { type: 'image/png' }));
    const oversized = await fetch(`${base}/api/v1/trips/trip-1/destinations/destination-1/media`, {
      method: 'POST', headers: { 'x-plotter-write': '1' }, body: form,
    });
    expect(oversized.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects unknown nested properties and unsupported API methods', async () => {
    const harness = dependencies();
    const base = await start(harness.values);
    const nested = await jsonRequest(`${base}/api/v1/trips/trip-1`, 'PATCH', {
      expectedRevision: 2,
      patch: {
        routingVehicle: {
          preset: 'standard', profile: 'driving-car', restrictions: {}, apiKey: 'must-not-pass',
        },
      },
    }, true);
    expect(nested.status).toBe(400);
    const routeLeg = await jsonRequest(`${base}/api/v1/trips/trip-1/mutations`, 'POST', {
      expectedRevision: 4,
      mutation: {
        type: 'save-route-leg',
        routeLeg: {
          id: 'leg-1', originDestinationId: 'destination-1', targetDestinationId: 'destination-2', movement: 'drive', calculation: 'automatic', status: 'pending', notes: '',
          waypoints: [{
            id: 'waypoint-1', order: 0, name: 'Stop', coordinates: { lat: 1, lng: 2 },
            location: { placeName: 'Stop', regionName: '', countryName: '', sourceLabel: 'Stop', sourceProvider: 'legacy' },
            notes: '', links: [], sql: 'must-not-pass',
          }],
          createdAt: '2026-08-17T00:00:00.000Z', updatedAt: '2026-08-17T00:00:00.000Z',
        },
      },
    }, true);
    expect(routeLeg.status).toBe(400);
    const unsupported = await jsonRequest(`${base}/api/v1/trips`, 'PUT', {});
    expect(unsupported.status).toBe(404);
    await expect(unsupported.json()).resolves.toMatchObject({ error: { code: 'not-found' } });
    expect((await fetch(`${base}/api/v1/trips?sql=SELECT+1`)).status).toBe(400);
  });

  it('maps bounded domain validation and provider-input failures to structured 400 responses', async () => {
    const harness = dependencies();
    harness.values.tripRepository('trip-1').reorderDestinationMedia = async () => {
      throw new Error('Media order must include each destination media item exactly once.');
    };
    harness.values.providers.linkPreview = async () => { throw new Error('Enter a valid URL.'); };
    const base = await start(harness.values);
    const domain = await jsonRequest(`${base}/api/v1/trips/trip-1/destinations/destination-1/media/reorder`, 'POST', {
      expectedRevision: 4, orderedMediaIds: ['media-1', 'media-1'],
    }, true);
    expect(domain.status).toBe(400);
    const provider = await jsonRequest(`${base}/api/v1/link-preview`, 'POST', { url: 'http://127.0.0.1' });
    expect(provider.status).toBe(400);
    expect(await provider.text()).not.toContain('127.0.0.1');
  });

  it('maps conflict, not-found, unavailable, unknown routes, and redacted internal failures', async () => {
    const conflict = dependencies();
    conflict.values.directory.create = async () => { throw new TripStorageConflictError(9); };
    const conflictBase = await start(conflict.values);
    const conflictResponse = await jsonRequest(`${conflictBase}/api/v1/trips`, 'POST', { expectedRevision: 2, name: 'Conflict' }, true);
    expect(conflictResponse.status).toBe(409);
    await expect(conflictResponse.json()).resolves.toMatchObject({ error: { code: 'conflict', currentRevision: 9 } });

    const missing = dependencies();
    missing.values.tripRepository('trip-1').load = async () => { throw new Error('Trip not found.'); };
    const missingBase = await start(missing.values);
    expect((await fetch(`${missingBase}/api/v1/trips/trip-1`)).status).toBe(404);

    const unavailable = dependencies();
    unavailable.values.readiness = () => ({ ready: false });
    const unavailableBase = await start(unavailable.values);
    expect((await jsonRequest(`${unavailableBase}/api/v1/trips`, 'POST', { expectedRevision: 0, name: 'No' }, true)).status).toBe(503);

    const failing = dependencies();
    failing.values.directory.load = async () => { throw new Error('SQL failed in /private/user-data/plotter.sqlite3'); };
    const failingBase = await start(failing.values);
    const failed = await fetch(`${failingBase}/api/v1/trips`);
    expect(failed.status).toBe(500);
    expect(await failed.text()).toBe('{"status":500,"error":{"code":"internal-error","message":"Plotter could not complete the request."}}');
    expect((await fetch(`${failingBase}/api/v1/nope`)).status).toBe(404);
    expect((await fetch(`${failingBase}/api/v2/trips`)).headers.get('content-type')).toContain('application/json');
  });

  it('serves only contained frontend files for non-API GET and HEAD fallbacks', async () => {
    const harness = dependencies();
    const base = await start(harness.values);
    const asset = await fetch(`${base}/app.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('cache-control')).toContain('immutable');
    expect(await asset.text()).toContain('plotter');
    const fallback = await fetch(`${base}/trip/trip-1`);
    expect(await fallback.text()).toContain('<title>Plotter</title>');
    const head = await fetch(`${base}/trip/trip-1`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    expect((await fetch(`${base}/..%2F..%2Fetc%2Fpasswd`)).status).toBe(400);
    expect((await fetch(`${base}/trip/trip-1`, { method: 'POST' })).status).toBe(404);
  });

  it('never serves frontend HTML for the exact API namespace root', async () => {
    const harness = dependencies();
    const base = await start(harness.values);
    const miss = await fetch(`${base}/api`);
    expect(miss.status).toBe(404);
    expect(miss.headers.get('content-type')).toContain('application/json');
    expect(await miss.text()).not.toContain('<title>Plotter</title>');

    const queried = await fetch(`${base}/api?fallback=html`);
    expect(queried.status).toBe(400);
    expect(queried.headers.get('content-type')).toContain('application/json');
    expect(await queried.text()).not.toContain('<title>Plotter</title>');
  });
});
