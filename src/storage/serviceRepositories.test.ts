import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createPlotterApiClient, type PlotterApiClient } from '../api/client';
import { createDestination } from '../domain/destinations';
import { resolveVehiclePreset } from '../domain/vehiclePresets';
import type { TripSummary } from './tripDirectoryRepository';
import { openPlotterDatabase, type PlotterDatabase } from '../../server/database';
import { createSqliteDirectoryRepository } from '../../server/directoryRepository';
import { createRevisionEventBus } from '../../server/events';
import { createPlotterHttpHandler, type PlotterHttpDependencies } from '../../server/http';
import { createMediaStore } from '../../server/mediaStore';
import { createSqliteTripRepository } from '../../server/tripRepository';
import { createWriteCoordinator } from '../../server/writeCoordinator';
import { createServiceRepositories } from './serviceRepositories';

const directories: string[] = [];
const databases: PlotterDatabase[] = [];
const servers: Server[] = [];

function trip(id = 'trip-1'): TripSummary {
  return {
    id,
    name: 'Alps',
    description: '',
    routingVehicle: resolveVehiclePreset('standard'),
    createdAt: '2026-08-17T10:00:00.000Z',
    updatedAt: '2026-08-17T10:00:00.000Z',
  };
}

function recordingClient() {
  const calls: Array<{ path: string; init?: RequestInit; form?: FormData; expectedRevision?: number }> = [];
  const responses: unknown[] = [];
  const client: PlotterApiClient = {
    async request<T>(path: string, init?: RequestInit) {
      calls.push({ path, init });
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next as T;
    },
    async upload<T>(path: string, form: FormData, expectedRevision: number) {
      calls.push({ path, form, expectedRevision });
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next as T;
    },
  };
  return { client, calls, responses };
}

function responseBody(call: { init?: RequestInit }) {
  if (typeof call.init?.body !== 'string') throw new Error('Expected a JSON request body.');
  return JSON.parse(call.init.body) as Record<string, unknown>;
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const database of databases.splice(0)) database.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('service repositories', () => {
  it('does not let malformed directory or trip reads prime a mutation revision', async () => {
    const directoryHarness = recordingClient();
    const directory = createServiceRepositories(directoryHarness.client).directory;
    directoryHarness.responses.push({ revision: 4, trips: 'not-an-array' });
    await expect(directory.listTrips()).rejects.toThrow('Plotter service returned an invalid directory snapshot.');
    await expect(directory.createTrip({ name: 'Alps' })).rejects.toThrow('Load the latest Plotter data before making changes.');
    expect(directoryHarness.calls).toHaveLength(1);

    const tripHarness = recordingClient();
    const repository = createServiceRepositories(tripHarness.client).createTripRepository('trip-1');
    tripHarness.responses.push({ revision: 7, destinations: [], routeLegs: [] });
    await expect(repository.listDestinations()).rejects.toThrow('Plotter service returned an invalid trip snapshot.');
    await expect(repository.deleteDestination('destination-1')).rejects.toThrow('Load the latest Plotter data before making changes.');
    expect(tripHarness.calls).toHaveLength(1);
  });

  it('requires a successful directory read before mutations and replaces only the read revision after success', async () => {
    const harness = recordingClient();
    const repository = createServiceRepositories(harness.client).directory;

    await expect(repository.createTrip({ name: 'Alps' })).rejects.toThrow('Load the latest Plotter data before making changes.');

    harness.responses.push({ revision: 4, trips: [trip()] });
    await expect(repository.listTrips()).resolves.toEqual([trip()]);
    harness.responses.push({ revision: 5, trip: trip('trip-2') });
    await expect(repository.createTrip({ name: 'Dolomites' })).resolves.toEqual(trip('trip-2'));
    expect(responseBody(harness.calls[1]!)).toEqual({ expectedRevision: 4, name: 'Dolomites' });

    harness.responses.push(new Error('request failed'));
    await expect(repository.updateTrip('trip-2', { name: 'Stale' })).rejects.toThrow('request failed');
    harness.responses.push({ revision: 6 });
    await repository.deleteTrip('trip-2');
    expect(responseBody(harness.calls[3]!)).toEqual({ expectedRevision: 5 });
  });

  it('requires each trip adapter to read a coherent snapshot before mutations and advances only on successful writes', async () => {
    const harness = recordingClient();
    const repository = createServiceRepositories(harness.client).createTripRepository('trip one');
    const destination = createDestination({ name: 'Aosta', coordinates: { lat: 45.737, lng: 7.32 } });

    await expect(repository.saveDestination(destination)).rejects.toThrow('Load the latest Plotter data before making changes.');
    harness.responses.push({ revision: 7, destinations: [destination], routeLegs: [], activities: [] });
    await expect(repository.listDestinations()).resolves.toEqual([destination]);
    harness.responses.push({ revision: 8 });
    await repository.saveDestination(destination);
    expect(responseBody(harness.calls[1]!)).toEqual({
      expectedRevision: 7,
      mutation: { type: 'save-destination', destination },
    });

    harness.responses.push(new Error('offline'));
    await expect(repository.deleteDestination(destination.id)).rejects.toThrow('offline');
    harness.responses.push({ revision: 9 });
    await repository.deleteDestination(destination.id);
    expect(responseBody(harness.calls[3]!)).toEqual({
      expectedRevision: 8,
      mutation: { type: 'delete-destination', destinationId: destination.id },
    });
  });

  it('uses bounded media routes, carries revisions through multipart upload, and retains service-relative media URLs', async () => {
    const harness = recordingClient();
    const repository = createServiceRepositories(harness.client).createTripRepository('trip-1');
    const serviceMedia = { id: 'media-1', url: '/api/v1/media/media-1/content', caption: '', credit: '', sortOrder: 0, bucketId: 'local-media', objectPath: 'media/media-1.png', uploadedAt: '2026-08-17T10:00:00.000Z' };
    const media = { ...serviceMedia, url: 'api/v1/media/media-1/content' };

    harness.responses.push({ revision: 2, destinations: [], routeLegs: [], activities: [] });
    await repository.loadSnapshot?.();
    harness.responses.push({ revision: 3, mediaItem: serviceMedia });
    await expect(repository.uploadDestinationMedia({
      destinationId: 'destination-1', file: new File(['image'], 'alps.png', { type: 'image/png' }), caption: 'Alps',
    })).resolves.toEqual(media);

    expect(harness.calls[1]).toMatchObject({
      path: '/api/v1/trips/trip-1/destinations/destination-1/media',
      expectedRevision: 2,
    });
    expect(harness.calls[1]?.form?.get('caption')).toBe('Alps');
    expect(media.url).toBe('api/v1/media/media-1/content');
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
});
