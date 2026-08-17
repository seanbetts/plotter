import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createPlotterApiClient } from '../src/api/client';
import { createDestination } from '../src/domain/destinations';
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
