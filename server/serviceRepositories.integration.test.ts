import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createPlotterApiClient } from '../src/api/client';
import { createDestination } from '../src/domain/destinations';
import { createRouteLeg } from '../src/domain/routeLegs';
import type { Activity } from '../src/domain/types';
import { resolveVehiclePreset } from '../src/domain/vehiclePresets';
import { createServiceRepositories } from '../src/storage/serviceRepositories';
import { openPlotterDatabase, type PlotterDatabase } from './database';
import { createSqliteDirectoryRepository } from './directoryRepository';
import { createRevisionEventBus } from './events';
import { createPlotterHttpHandler, type PlotterHttpDependencies } from './http';
import { createMediaStore } from './mediaStore';
import { createSqliteTripRepository } from './tripRepository';
import { createWriteCoordinator } from './writeCoordinator';

const directories: string[] = [];
const databases: PlotterDatabase[] = [];
const servers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const database of databases.splice(0)) database.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

it('matches a normalized SQLite snapshot through the real disposable HTTP service', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'plotter-service-repositories-'));
  directories.push(directory);
  writeFileSync(join(directory, 'index.html'), '<!doctype html>');
  const database = openPlotterDatabase(join(directory, 'plotter.sqlite3'));
  databases.push(database);
  const events = createRevisionEventBus();
  const writes = createWriteCoordinator(database, { async createAutomaticBackup() { return join(directory, 'backup.sqlite3'); } }, events);
  const tripDirectory = createSqliteDirectoryRepository(database, writes, createMediaStore(directory));
  const created = await tripDirectory.create(0, { expectedRevision: 0, name: 'Alps' });
  if (!created.trip) throw new Error('Expected a trip.');
  const destination = createDestination({ name: 'Chamonix', coordinates: { lat: 45.9237, lng: 6.8694 } });
  const sqliteRepository = createSqliteTripRepository(database, writes, created.trip.id, createMediaStore(directory));
  await sqliteRepository.mutate(0, { type: 'save-destination', destination });
  const dependencies: PlotterHttpDependencies = {
    directory: tripDirectory,
    tripRepository: (tripId) => createSqliteTripRepository(database, writes, tripId, createMediaStore(directory)),
    media: createMediaStore(directory),
    mediaContent: { async open() { throw new Error('unused'); } },
    events,
    readiness: () => ({ ready: true }),
    providers: {
      async linkPreview() { throw new Error('unused'); },
      async imageSearch() { throw new Error('unused'); },
      async remoteImage() { throw new Error('unused'); },
    },
    backups: {
      async create() { throw new Error('unused'); }, async list() { return []; },
      async inspect() { throw new Error('unused'); }, async restore() { throw new Error('unused'); },
    },
    publicRoot: directory,
  };
  const server = createServer((request, response) => { void createPlotterHttpHandler(dependencies)(request, response); });
  servers.push(server);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Server did not bind.');

  const service = createServiceRepositories(createPlotterApiClient({ baseUrl: `http://127.0.0.1:${address.port}` }));
  await expect(service.createTripRepository(created.trip.id).loadSnapshot?.()).resolves.toEqual(
    await sqliteRepository.load(),
  );
});

it('reads one coherent context snapshot and strips media, geometry, diagnostics, and host-private state', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'plotter-context-snapshot-'));
  directories.push(directory);
  writeFileSync(join(directory, 'index.html'), '<!doctype html>');
  const database = openPlotterDatabase(join(directory, 'plotter.sqlite3'));
  databases.push(database);
  const events = createRevisionEventBus();
  const media = createMediaStore(directory);
  const writes = createWriteCoordinator(database, {
    async createAutomaticBackup() { return join(directory, 'backup.sqlite3'); },
  }, events);
  const tripDirectory = createSqliteDirectoryRepository(database, writes, media);
  const created = await tripDirectory.create(0, {
    expectedRevision: 0,
    name: 'Northern loop',
    routingVehicle: resolveVehiclePreset('large-camper'),
  });
  if (!created.trip) throw new Error('Expected a trip.');
  const updated = await tripDirectory.update(1, created.trip.id, {
    expectedRevision: 1,
    patch: { description: 'Follow winter light and ferry crossings.' },
  });
  if (!updated.trip) throw new Error('Expected the updated trip.');

  const origin = {
    ...createDestination({
      name: 'Tromso',
      coordinates: { lat: 69.6492, lng: 18.9553 },
      order: 0,
    }),
    media: [{
      id: 'legacy-media',
      url: 'https://private-media.invalid/full.jpg',
      thumbnailUrl: 'https://private-media.invalid/thumb.jpg',
      caption: 'Private caption',
      credit: 'Private credit',
      bucketId: 'private-bucket',
      objectPath: 'private/object.jpg',
    }],
    research: {
      notes: 'Check the official winter timetable.',
      links: [{
        id: 'ferry-link',
        title: 'Ferry timetable',
        url: 'https://research.example/ferry',
        domain: 'research.example',
        imageUrl: 'https://private-media.invalid/preview.jpg',
        sortOrder: 0,
        previewFetchedAt: '2026-08-20T09:00:00.000Z',
      }],
      bookReferences: [],
    },
  };
  const target = createDestination({
    name: 'Alta',
    coordinates: { lat: 69.9689, lng: 23.2716 },
    order: 1,
  });
  const activity: Activity = {
    id: crypto.randomUUID(),
    destinationId: origin.id,
    order: 0,
    title: 'Fjellheisen',
    description: 'Cable car viewpoint',
    category: 'outdoors',
    status: 'booked',
    priority: 'high',
    location: {
      name: 'Fjellheisen',
      address: 'Sollivegen 12',
      coordinates: { lat: 69.6389, lng: 18.9675 },
    },
    links: [{
      id: 'activity-link',
      title: 'Official tickets',
      url: 'https://research.example/tickets',
      domain: 'research.example',
      imageUrl: 'https://private-media.invalid/activity.jpg',
      sortOrder: 0,
    }],
    notes: 'Book the sunset slot.',
    tags: ['viewpoint'],
    createdAt: '2026-08-20T10:00:00.000Z',
    updatedAt: '2026-08-20T10:00:00.000Z',
  };
  const routeLeg = createRouteLeg({
    originDestinationId: origin.id,
    targetDestinationId: target.id,
    ferryPolicy: 'require',
    status: 'review-required',
    distanceKm: 305,
    travelTimeHours: 5.5,
    geometry: {
      type: 'LineString',
      coordinates: [[18.9553, 69.6492], [23.2716, 69.9689]],
    },
    provider: 'openrouteservice',
    profile: 'driving-car',
    routeKey: 'provider-request-secret',
    error: '/Users/example/private/provider-error.json',
    providerDiagnostic: {
      provider: 'openrouteservice',
      httpStatus: 400,
      providerMessage: 'private provider response',
    },
    warnings: [{ code: 'FERRY_REQUIRED_NOT_FOUND', message: 'Review ferry availability.' }],
    notes: 'Confirm the winter ferry.',
  });
  const sqliteRepository = createSqliteTripRepository(database, writes, created.trip.id, media);
  await sqliteRepository.mutate(0, {
    type: 'replace-trip-data',
    snapshot: { destinations: [origin, target], routeLegs: [routeLeg], activities: [activity] },
  });
  const dependencies: PlotterHttpDependencies = {
    directory: tripDirectory,
    tripRepository: (tripId) => createSqliteTripRepository(database, writes, tripId, media),
    media,
    mediaContent: { async open() { throw new Error('unused'); } },
    events,
    readiness: () => ({ ready: true }),
    providers: {
      linkPreview: vi.fn(async () => { throw new Error('must not run'); }),
      imageSearch: vi.fn(async () => { throw new Error('must not run'); }),
      remoteImage: vi.fn(async () => { throw new Error('must not run'); }),
    },
    backups: {
      async create() { throw new Error('unused'); }, async list() { return []; },
      async inspect() { throw new Error('unused'); }, async restore() { throw new Error('unused'); },
    },
    publicRoot: directory,
  };
  const server = createServer((request, response) => {
    void createPlotterHttpHandler(dependencies)(request, response);
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Server did not bind.');

  const response = await fetch(
    `http://127.0.0.1:${address.port}/api/v1/trips/${created.trip.id}/context`,
  );
  const snapshot = await response.json();

  expect(response.status).toBe(200);
  expect(snapshot).toMatchObject({
    directoryRevision: 2,
    tripRevision: 1,
    trip: updated.trip,
    destinations: [
      expect.objectContaining({ id: origin.id, name: 'Tromso', research: {
        notes: 'Check the official winter timetable.',
        links: [expect.objectContaining({
          title: 'Ferry timetable',
          url: 'https://research.example/ferry',
          domain: 'research.example',
          sortOrder: 0,
          previewFetchedAt: '2026-08-20T09:00:00.000Z',
        })],
        bookReferences: [],
      } }),
      expect.objectContaining({ id: target.id, name: 'Alta' }),
    ],
    routeLegs: [expect.objectContaining({
      id: routeLeg.id,
      status: 'review-required',
      warnings: [{ code: 'FERRY_REQUIRED_NOT_FOUND', message: 'Review ferry availability.' }],
      notes: 'Confirm the winter ferry.',
    })],
    activities: [expect.objectContaining({
      id: activity.id,
      destinationId: origin.id,
      status: 'booked',
      notes: 'Book the sunset slot.',
    })],
  });
  const serialized = JSON.stringify(snapshot);
  expect(serialized).not.toMatch(/private-media|private-bucket|private\/object|\.jpg/i);
  expect(serialized).not.toContain('provider-request-secret');
  expect(serialized).not.toContain('private provider response');
  expect(serialized).not.toContain('/Users/example/private');
  expect(serialized).not.toContain('LineString');
  expect(dependencies.providers.linkPreview).not.toHaveBeenCalled();
  expect(dependencies.providers.imageSearch).not.toHaveBeenCalled();
  expect(dependencies.providers.remoteImage).not.toHaveBeenCalled();
});
