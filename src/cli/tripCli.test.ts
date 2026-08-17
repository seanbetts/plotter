import { describe, expect, it, vi } from 'vitest';
import type { PlotterApiClient } from '../api/client';
import type { Activity, Destination, RouteLeg } from '../domain/types';
import { standardRoutingVehicle } from '../domain/vehiclePresets';
import type { TripSummary } from '../storage/tripDirectoryRepository';
import { TripStorageConflictError } from '../storage/revision';
import { createServiceRepositories } from '../storage/serviceRepositories';
import type { TripRepository } from '../storage/tripRepository';
import { createTripDataService } from '../tripCommands/tripDataService';
import { parseTripCliArgs, resolvePlotterBaseUrl, runTripCli, runTripProgram } from './trip';

type MockService = Record<string, ReturnType<typeof vi.fn>>;

function createMockService(): MockService {
  return {
    listTrips: vi.fn(async () => ({ ok: true, summary: 'listed', trips: [] })),
    getTrip: vi.fn(async () => ({ ok: true, summary: 'loaded', trip: { id: 'trip-1' } })),
    auditTrip: vi.fn(async () => ({ ok: true, summary: 'audited', audit: { errors: 0, warnings: 0, issues: [] } })),
    recalculateFailedRoutes: vi.fn(async () => ({
      ok: true,
      summary: 'recalculated',
      routeLegs: [],
      changed: {},
    })),
    setVehicle: vi.fn(async () => ({ ok: true, summary: 'set vehicle', changed: {}, routeLegs: [] })),
    updateRouteLeg: vi.fn(async () => ({ ok: true, summary: 'updated route leg', changed: {}, routeLeg: {} })),
    createTrip: vi.fn(async () => ({ ok: true, summary: 'created', trip: { id: 'trip-1' } })),
    deleteTrip: vi.fn(async () => ({ ok: true, summary: 'deleted', changed: {} })),
    renameTrip: vi.fn(async () => ({ ok: true, summary: 'renamed', trip: { id: 'trip-1' }, changed: {} })),
    replaceStops: vi.fn(async () => ({ ok: true, summary: 'replaced', stops: [], routeLegs: [], changed: {} })),
    insertStop: vi.fn(async () => ({ ok: true, summary: 'inserted', stop: { id: 'stop-1' }, stops: [], routeLegs: [], changed: {} })),
    updateStop: vi.fn(async () => ({ ok: true, summary: 'updated', stop: { id: 'stop-1' }, routeLegs: [], changed: {} })),
    deleteStop: vi.fn(async () => ({ ok: true, summary: 'deleted stop', changed: {} })),
    reorderStops: vi.fn(async () => ({ ok: true, summary: 'reordered', stops: [], routeLegs: [], changed: {} })),
    addStopLink: vi.fn(async () => ({ ok: true, summary: 'added stop link', changed: {} })),
    deleteStopLink: vi.fn(async () => ({ ok: true, summary: 'deleted stop link', changed: {} })),
    listActivities: vi.fn(async () => ({ ok: true, summary: 'listed activities', activities: [] })),
    createActivity: vi.fn(async () => ({ ok: true, summary: 'created activity', activity: { id: 'activity-1' }, changed: {} })),
    updateActivity: vi.fn(async () => ({ ok: true, summary: 'updated activity', activity: { id: 'activity-1' }, changed: {} })),
    deleteActivity: vi.fn(async () => ({ ok: true, summary: 'deleted activity', changed: {} })),
    reorderActivities: vi.fn(async () => ({ ok: true, summary: 'reordered activities', activities: [], changed: {} })),
    addActivityLink: vi.fn(async () => ({ ok: true, summary: 'added activity link', changed: {} })),
    deleteActivityLink: vi.fn(async () => ({ ok: true, summary: 'deleted activity link', changed: {} })),
  };
}

function createCliHarness(serviceOverrides?: Partial<MockService>) {
  const service = {
    ...createMockService(),
    ...serviceOverrides,
  };
  const readFile = vi.fn(async () => '{"name":"NC500"}');
  const write = vi.fn();
  const writeError = vi.fn();

  return { service, readFile, write, writeError };
}

function createFreshHttpServiceHarness() {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const responses: unknown[] = [];
  const client: PlotterApiClient = {
    async request<T>(path: string, init?: RequestInit) {
      calls.push({ path, init });
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return response as T;
    },
    async upload() {
      throw new Error('Uploads are not part of trip creation.');
    },
  };
  const repositories = createServiceRepositories(client);
  return {
    calls,
    responses,
    service: createTripDataService(repositories),
  };
}

function createdTrip(id: string, name: string): TripSummary {
  return {
    id,
    name,
    description: '',
    routingVehicle: standardRoutingVehicle,
    createdAt: '2026-08-17T10:00:00.000Z',
    updatedAt: '2026-08-17T10:00:00.000Z',
  };
}

function requestBody(call: { init?: RequestInit }) {
  if (typeof call.init?.body !== 'string') throw new Error('Expected JSON request body.');
  return JSON.parse(call.init.body) as Record<string, unknown>;
}

describe('parseTripCliArgs', () => {
  it('parses command flags and boolean switches', () => {
    expect(
      parseTripCliArgs([
        'create',
        '--input',
        './trip.json',
        '--pretty',
        '--dry-run',
        '--yes',
      ]),
    ).toEqual({
      command: 'create',
      flags: {
        input: './trip.json',
        pretty: true,
        'dry-run': true,
        yes: true,
      },
    });
  });
});

describe('resolvePlotterBaseUrl', () => {
  it('uses the stable Plotter loopback route by default and accepts an explicit override', () => {
    expect(resolvePlotterBaseUrl({})).toEqual(new URL('http://127.0.0.1/plotter/'));
    expect(resolvePlotterBaseUrl({ PLOTTER_BASE_URL: 'http://localhost:9123/custom/' })).toEqual(
      new URL('http://localhost:9123/custom/'),
    );
  });

  it.each([
    'file:///tmp/plotter',
    'http://user:secret@127.0.0.1/plotter/',
    'http://127.0.0.1/plotter/?debug=true',
    'https://plotter.example/plotter/#section',
    'not a URL',
  ])('rejects unsafe base URL configuration %s', (value) => {
    expect(() => resolvePlotterBaseUrl({ PLOTTER_BASE_URL: value })).toThrow('Plotter CLI configuration is invalid.');
  });

  it.each(['http://127.0.0.1/custom', 'https://plotter.example/nested/path'])(
    'accepts http(s) overrides and normalizes their path for API joins',
    (value) => {
      const baseUrl = resolvePlotterBaseUrl({ PLOTTER_BASE_URL: value });
      expect(baseUrl.pathname).toMatch(/\/$/);
      expect(new URL('api/v1/trips', baseUrl).toString()).toBe(`${value}/api/v1/trips`);
    },
  );
});

describe('runTripCli', () => {
  it('prints compact JSON by default', async () => {
    const { service, readFile, write, writeError } = createCliHarness({
      listTrips: vi.fn(async () => ({
        ok: true,
        summary: 'Loaded 1 trip.',
        trips: [{ id: 'trip-id', name: 'NC500' }],
      })),
    });

    const exitCode = await runTripCli({
      argv: ['list'],
      service: service as never,
      readFile,
      write,
      writeError,
    });

    expect(exitCode).toBe(0);
    expect(write).toHaveBeenCalledWith('{"ok":true,"summary":"Loaded 1 trip.","trips":[{"id":"trip-id","name":"NC500"}]}\n');
    expect(writeError).not.toHaveBeenCalled();
  });

  it('prints pretty JSON when requested', async () => {
    const { service, readFile, write, writeError } = createCliHarness();

    const exitCode = await runTripCli({
      argv: ['list', '--pretty'],
      service: service as never,
      readFile,
      write,
      writeError,
    });

    expect(exitCode).toBe(0);
    expect(write.mock.calls[0]?.[0]).toContain('\n  "ok": true,\n');
    expect(writeError).not.toHaveBeenCalled();
  });

  it('prints compact command summaries without large route geometry when requested', async () => {
    const { service, readFile, write, writeError } = createCliHarness({
      replaceStops: vi.fn(async () => ({
        ok: true,
        summary: 'Would replace stops.',
        changed: { stopsAdded: ['Alnwick'], routesRecalculated: 1 },
        stops: [{ id: 'stop-1', name: 'Alnwick' }],
        routeLegs: [
          {
            id: 'leg-1',
            status: 'ready',
            geometry: {
              type: 'LineString',
              coordinates: [[-1.7, 55.4]],
            },
          },
        ],
      })),
    });
    readFile.mockResolvedValueOnce('[{"name":"Alnwick","place":{"coordinates":{"lat":55.4,"lng":-1.7}}}]');

    const exitCode = await runTripCli({
      argv: ['replace-stops', '--trip-id', 'trip-1', '--input', '/tmp/stops.json', '--dry-run', '--summary', '--pretty'],
      service: service as never,
      readFile,
      write,
      writeError,
    });

    expect(exitCode).toBe(0);
    const payload = JSON.parse(write.mock.calls[0]?.[0] ?? '{}');
    expect(payload).toEqual({
      ok: true,
      summary: 'Would replace stops.',
      changed: { stopsAdded: ['Alnwick'], routesRecalculated: 1 },
      counts: {
        stops: 1,
        routeLegs: 1,
        readyRouteLegs: 1,
        manualRouteLegs: 0,
        failedRouteLegs: 0,
        reviewRequiredRouteLegs: 0,
      },
    });
    expect(write.mock.calls[0]?.[0]).not.toContain('coordinates');
    expect(writeError).not.toHaveBeenCalled();
  });

  it('routes every supported command to the matching service method with parsed inputs', async () => {
    const { service, readFile, write, writeError } = createCliHarness();
    readFile
      .mockResolvedValueOnce('{"ferryPolicy":"require","notes":"Ferry crossing"}')
      .mockResolvedValueOnce('{"name":"Road trip"}')
      .mockResolvedValueOnce('[{"name":"Inverness","place":{"coordinates":{"lat":57.48,"lng":-4.22}}}]')
      .mockResolvedValueOnce('{"name":"Ullapool","place":{"coordinates":{"lat":57.9,"lng":-5.16}}}')
      .mockResolvedValueOnce('{"name":"Durness"}')
      .mockResolvedValueOnce('["stop-2","stop-1"]')
      .mockResolvedValueOnce('{"title":"Visit beach"}')
      .mockResolvedValueOnce('{"title":"Updated activity"}')
      .mockResolvedValueOnce('{"activityIds":["activity-2","activity-1"]}');

    const commands: string[][] = [
      ['list'],
      ['get', '--trip-id', 'trip-1', '--include-activities', '--include-links'],
      ['recalculate-failed-routes', '--trip-id', 'trip-1'],
      ['set-vehicle', '--trip-id', 'trip-1', '--preset', 'large-camper'],
      ['update-route-leg', '--trip-id', 'trip-1', '--route-leg-id', 'leg-1', '--input', '/tmp/route-intent.json', '--dry-run'],
      ['create', '--input', '/tmp/trip.json', '--dry-run', '--yes'],
      ['delete', '--trip-id', 'trip-1', '--dry-run', '--yes'],
      ['rename', '--trip-id', 'trip-1', '--name', 'Renamed Trip', '--dry-run', '--yes'],
      ['replace-stops', '--trip-id', 'trip-1', '--input', '/tmp/stops.json', '--dry-run', '--yes'],
      ['insert-stop', '--trip-id', 'trip-1', '--after-stop-id', 'stop-1', '--before-stop-id', 'stop-2', '--input', '/tmp/insert-stop.json', '--dry-run', '--yes'],
      ['update-stop', '--trip-id', 'trip-1', '--stop-id', 'stop-1', '--input', '/tmp/update-stop.json', '--dry-run', '--yes'],
      ['delete-stop', '--trip-id', 'trip-1', '--stop-id', 'stop-1', '--dry-run', '--yes'],
      ['reorder-stops', '--trip-id', 'trip-1', '--input', '/tmp/stop-ids.json', '--strict', '--dry-run', '--yes'],
      ['add-stop-link', '--trip-id', 'trip-1', '--stop-id', 'stop-1', '--url', 'https://example.com/stop', '--dry-run', '--yes'],
      ['delete-stop-link', '--trip-id', 'trip-1', '--stop-id', 'stop-1', '--link-id', 'link-1', '--dry-run', '--yes'],
      ['list-activities', '--trip-id', 'trip-1', '--stop-id', 'stop-1'],
      ['create-activity', '--trip-id', 'trip-1', '--stop-id', 'stop-1', '--input', '/tmp/create-activity.json', '--dry-run', '--yes'],
      ['update-activity', '--trip-id', 'trip-1', '--activity-id', 'activity-1', '--input', '/tmp/update-activity.json', '--dry-run', '--yes'],
      ['delete-activity', '--trip-id', 'trip-1', '--activity-id', 'activity-1', '--dry-run', '--yes'],
      ['reorder-activities', '--trip-id', 'trip-1', '--stop-id', 'stop-1', '--input', '/tmp/activity-ids.json', '--dry-run', '--yes'],
      ['add-activity-link', '--trip-id', 'trip-1', '--activity-id', 'activity-1', '--url', 'https://example.com/activity', '--dry-run', '--yes'],
      ['delete-activity-link', '--trip-id', 'trip-1', '--activity-id', 'activity-1', '--link-id', 'link-2', '--dry-run', '--yes'],
    ];

    for (const argv of commands) {
      const exitCode = await runTripCli({
        argv,
        service: service as never,
        readFile,
        write,
        writeError,
      });
      expect(exitCode).toBe(0);
    }

    expect(service.listTrips).toHaveBeenCalledWith();
    expect(service.getTrip).toHaveBeenCalledWith({
      tripId: 'trip-1',
      includeActivities: true,
      includeLinks: true,
    });
    expect(service.recalculateFailedRoutes).toHaveBeenCalledWith({ tripId: 'trip-1' });
    expect(service.setVehicle).toHaveBeenCalledWith(
      { tripId: 'trip-1', preset: 'large-camper' }, { dryRun: false, yes: false },
    );
    expect(service.updateRouteLeg).toHaveBeenCalledWith(
      { tripId: 'trip-1', routeLegId: 'leg-1', patch: { ferryPolicy: 'require', notes: 'Ferry crossing' } },
      { dryRun: true, yes: false },
    );
    expect(service.createTrip).toHaveBeenCalledWith({ name: 'Road trip' }, { dryRun: true, yes: true });
    expect(service.deleteTrip).toHaveBeenCalledWith({ tripId: 'trip-1' }, { dryRun: true, yes: true });
    expect(service.renameTrip).toHaveBeenCalledWith({ tripId: 'trip-1', name: 'Renamed Trip' }, { dryRun: true, yes: true });
    expect(service.replaceStops).toHaveBeenCalledWith({
      tripId: 'trip-1',
      stops: [{ name: 'Inverness', place: { coordinates: { lat: 57.48, lng: -4.22 } } }],
    }, { dryRun: true, yes: true });
    expect(service.insertStop).toHaveBeenCalledWith({
      tripId: 'trip-1',
      afterStopId: 'stop-1',
      beforeStopId: 'stop-2',
      stop: { name: 'Ullapool', place: { coordinates: { lat: 57.9, lng: -5.16 } } },
    }, { dryRun: true, yes: true });
    expect(service.updateStop).toHaveBeenCalledWith({
      tripId: 'trip-1',
      stopId: 'stop-1',
      patch: { name: 'Durness' },
    }, { dryRun: true, yes: true });
    expect(service.deleteStop).toHaveBeenCalledWith({ tripId: 'trip-1', stopId: 'stop-1' }, { dryRun: true, yes: true });
    expect(service.reorderStops).toHaveBeenCalledWith({
      tripId: 'trip-1',
      stopIds: ['stop-2', 'stop-1'],
      strict: true,
    }, { dryRun: true, yes: true });
    expect(service.addStopLink).toHaveBeenCalledWith({
      tripId: 'trip-1',
      stopId: 'stop-1',
      url: 'https://example.com/stop',
    }, { dryRun: true, yes: true });
    expect(service.deleteStopLink).toHaveBeenCalledWith({
      tripId: 'trip-1',
      stopId: 'stop-1',
      linkId: 'link-1',
    }, { dryRun: true, yes: true });
    expect(service.listActivities).toHaveBeenCalledWith({ tripId: 'trip-1', stopId: 'stop-1' });
    expect(service.createActivity).toHaveBeenCalledWith({
      tripId: 'trip-1',
      stopId: 'stop-1',
      activity: { title: 'Visit beach' },
    }, { dryRun: true, yes: true });
    expect(service.updateActivity).toHaveBeenCalledWith({
      tripId: 'trip-1',
      activityId: 'activity-1',
      patch: { title: 'Updated activity' },
    }, { dryRun: true, yes: true });
    expect(service.deleteActivity).toHaveBeenCalledWith({ tripId: 'trip-1', activityId: 'activity-1' }, { dryRun: true, yes: true });
    expect(service.reorderActivities).toHaveBeenCalledWith({
      tripId: 'trip-1',
      stopId: 'stop-1',
      activityIds: ['activity-2', 'activity-1'],
    }, { dryRun: true, yes: true });
    expect(service.addActivityLink).toHaveBeenCalledWith({
      tripId: 'trip-1',
      activityId: 'activity-1',
      url: 'https://example.com/activity',
    }, { dryRun: true, yes: true });
    expect(service.deleteActivityLink).toHaveBeenCalledWith({
      tripId: 'trip-1',
      activityId: 'activity-1',
      linkId: 'link-2',
    }, { dryRun: true, yes: true });
  });

  it('summarizes route readiness after failed-only recalculation', async () => {
    const { service, readFile, write, writeError } = createCliHarness({
      recalculateFailedRoutes: vi.fn(async () => ({
        ok: true,
        summary: 'Recalculated 2 failed routes.',
        changed: { routesRecalculated: 2 },
        routeLegs: [
          ...Array.from({ length: 23 }, (_, index) => ({ id: `ready-${index}`, status: 'ready' })),
          { id: 'manual-1', status: 'manual' },
          { id: 'manual-2', status: 'manual' },
          { id: 'review-1', status: 'review-required' },
        ],
      })),
    });

    const exitCode = await runTripCli({
      argv: ['recalculate-failed-routes', '--trip-id', 'trip-1', '--summary'],
      service: service as never,
      readFile,
      write,
      writeError,
    });

    expect(exitCode).toBe(0);
    expect(JSON.parse(write.mock.calls[0]?.[0] ?? '{}')).toEqual({
      ok: true,
      summary: 'Recalculated 2 failed routes.',
      changed: { routesRecalculated: 2 },
      counts: {
        routeLegs: 26,
        readyRouteLegs: 23,
        manualRouteLegs: 2,
        failedRouteLegs: 0,
        reviewRequiredRouteLegs: 1,
      },
    });
  });

  it('passes a full manifest through create and summarizes all persisted entity counts', async () => {
    const manifest = {
      manifestVersion: 1,
      name: 'Nordkapp',
      stops: [{
        key: 'home',
        name: 'Home',
        place: { coordinates: { lat: 51.0576, lng: -0.1342 } },
        expectedStayDays: 1,
      }],
    };
    const { service, readFile, write, writeError } = createCliHarness({
      createTrip: vi.fn(async () => ({
        ok: true,
        summary: 'Created trip Nordkapp.',
        trip: { id: 'trip-nordkapp', name: 'Nordkapp', routingVehicle: standardRoutingVehicle },
        changed: { linksAdded: Array.from({ length: 18 }, (_, index) => `https://example.com/${index}`) },
        stops: Array.from({ length: 26 }, (_, index) => ({ id: `stop-${index}` })),
        activities: Array.from({ length: 15 }, (_, index) => ({ id: `activity-${index}` })),
        routeLegs: [
          ...Array.from({ length: 23 }, (_, index) => ({
            id: `ready-${index}`,
            status: 'ready',
            geometry: { type: 'LineString', coordinates: [[index, index]] },
          })),
          { id: 'manual-1', status: 'manual' },
          { id: 'manual-2', status: 'manual' },
        ],
        audit: { errors: 0, warnings: 0, issues: [] },
      })),
    });
    readFile.mockResolvedValueOnce(JSON.stringify(manifest));

    const exitCode = await runTripCli({
      argv: ['create', '--input', '/tmp/trip-manifest.json', '--summary', '--pretty'],
      service: service as never,
      readFile,
      write,
      writeError,
    });

    expect(exitCode).toBe(0);
    expect(service.createTrip).toHaveBeenCalledWith(manifest, { dryRun: false, yes: false });
    const payload = JSON.parse(write.mock.calls[0]?.[0] ?? '{}');
    expect(payload.counts).toEqual({
      stops: 26,
      activities: 15,
      links: 18,
      routeLegs: 25,
      readyRouteLegs: 23,
      manualRouteLegs: 2,
      failedRouteLegs: 0,
      reviewRequiredRouteLegs: 0,
      auditErrors: 0,
      auditWarnings: 0,
    });
    expect(payload.audit).toEqual({ errors: 0, warnings: 0, issues: [] });
    expect(payload.trip).toEqual({ id: 'trip-nordkapp', name: 'Nordkapp', vehiclePreset: 'standard' });
    expect(write.mock.calls[0]?.[0]).not.toContain('coordinates');
  });

  it('creates a simple trip through fresh HTTP repositories with authoritative revisions', async () => {
    const harness = createFreshHttpServiceHarness();
    harness.responses.push(
      { revision: 4, trips: [] },
      { revision: 5, trip: createdTrip('trip-simple', 'Simple') },
      { revision: 0, destinations: [], routeLegs: [], activities: [] },
      { revision: 1 },
    );
    const write = vi.fn();

    const exitCode = await runTripCli({
      argv: ['create', '--input', '/tmp/simple.json'],
      service: harness.service,
      readFile: vi.fn(async () => JSON.stringify({ name: 'Simple' })),
      write,
      writeError: vi.fn(),
    });

    expect(exitCode).toBe(0);
    expect(JSON.parse(write.mock.calls[0]?.[0] ?? '{}')).toMatchObject({ ok: true, trip: { id: 'trip-simple' } });
    expect(harness.calls.map(({ path }) => path)).toEqual([
      '/api/v1/trips',
      '/api/v1/trips',
      '/api/v1/trips/trip-simple',
      '/api/v1/trips/trip-simple/mutations',
    ]);
    expect(requestBody(harness.calls[1]!)).toMatchObject({ expectedRevision: 4, name: 'Simple' });
    expect(requestBody(harness.calls[3]!)).toMatchObject({ expectedRevision: 0, mutation: { type: 'replace-trip-data' } });
  });

  it('creates a manifest-backed trip through fresh HTTP repositories with authoritative revisions', async () => {
    const harness = createFreshHttpServiceHarness();
    harness.responses.push(
      { revision: 8, trips: [] },
      { revision: 9, trip: createdTrip('trip-manifest', 'Manifest') },
      { revision: 0, destinations: [], routeLegs: [], activities: [] },
      { revision: 1 },
    );
    const write = vi.fn();

    const exitCode = await runTripCli({
      argv: ['create', '--input', '/tmp/manifest.json'],
      service: harness.service,
      readFile: vi.fn(async () => JSON.stringify({
        manifestVersion: 1,
        name: 'Manifest',
        stops: [{
          key: 'home',
          name: 'Home',
          place: { coordinates: { lat: 51.0576, lng: -0.1342 } },
          expectedStayDays: 1,
        }],
      })),
      write,
      writeError: vi.fn(),
    });

    expect(exitCode).toBe(0);
    expect(JSON.parse(write.mock.calls[0]?.[0] ?? '{}')).toMatchObject({ ok: true, trip: { id: 'trip-manifest' } });
    expect(harness.calls.map(({ path }) => path)).toEqual([
      '/api/v1/trips',
      '/api/v1/trips',
      '/api/v1/trips/trip-manifest',
      '/api/v1/trips/trip-manifest/mutations',
    ]);
    expect(requestBody(harness.calls[1]!)).toMatchObject({ expectedRevision: 8, name: 'Manifest' });
    expect(requestBody(harness.calls[3]!)).toMatchObject({ expectedRevision: 0, mutation: { type: 'replace-trip-data' } });
  });

  it('retains manifest cleanup when the newly created trip snapshot cannot be loaded', async () => {
    const harness = createFreshHttpServiceHarness();
    harness.responses.push(
      { revision: 4, trips: [] },
      { revision: 5, trip: createdTrip('trip-manifest', 'Manifest') },
      new Error('snapshot unavailable'),
      { revision: 6 },
    );

    const exitCode = await runTripCli({
      argv: ['create', '--input', '/tmp/manifest.json'],
      service: harness.service,
      readFile: vi.fn(async () => JSON.stringify({
        manifestVersion: 1,
        name: 'Manifest',
        stops: [{
          key: 'home',
          name: 'Home',
          place: { coordinates: { lat: 51.0576, lng: -0.1342 } },
          expectedStayDays: 1,
        }],
      })),
      write: vi.fn(),
      writeError: vi.fn(),
    });

    expect(exitCode).toBe(1);
    expect(harness.calls.map(({ path }) => path)).toEqual([
      '/api/v1/trips',
      '/api/v1/trips',
      '/api/v1/trips/trip-manifest',
      '/api/v1/trips/trip-manifest',
    ]);
    expect(requestBody(harness.calls[3]!)).toEqual({ expectedRevision: 5 });
  });

  it('does not bypass a directory revision conflict while creating through fresh HTTP repositories', async () => {
    const harness = createFreshHttpServiceHarness();
    harness.responses.push(
      { revision: 4, trips: [] },
      new TripStorageConflictError(5),
    );

    const exitCode = await runTripCli({
      argv: ['create', '--input', '/tmp/simple.json'],
      service: harness.service,
      readFile: vi.fn(async () => JSON.stringify({ name: 'Simple' })),
      write: vi.fn(),
      writeError: vi.fn(),
    });

    expect(exitCode).toBe(1);
    expect(harness.calls.map(({ path }) => path)).toEqual(['/api/v1/trips', '/api/v1/trips']);
    expect(requestBody(harness.calls[1]!)).toMatchObject({ expectedRevision: 4, name: 'Simple' });
  });

  it('routes audit and preserves its issues in summary output', async () => {
    const providerDiagnostic = {
      provider: 'openrouteservice',
      httpStatus: 429,
      code: 3099,
      providerMessage: 'Rate limit exceeded.',
      requestedProfile: 'driving-hgv',
      actualProfile: 'driving-car',
      retryAfterMs: 2_000,
      attempts: 2,
      retryAttempts: 1,
    };
    const audit = {
      errors: 1,
      warnings: 2,
      issues: [
        {
          severity: 'error',
          code: 'FAILED_ROUTE_LEG',
          message: 'Driving route Lillehammer to Oslo failed.',
          routeLegId: 'failed-leg',
          providerDiagnostic,
          origin: { id: 'lillehammer', name: 'Lillehammer' },
          target: { id: 'oslo', name: 'Oslo' },
        },
        {
          severity: 'warning',
          code: 'VEHICLE_PROFILE_FALLBACK',
          message: 'Truck dimensions were not validated.',
          routeLegId: 'fallback-leg',
          origin: { id: 'lillehammer', name: 'Lillehammer' },
          target: { id: 'oslo', name: 'Oslo' },
        },
        {
          severity: 'warning',
          code: 'ROUTING_ANCHOR_ADJUSTED',
          message: 'Route target uses a routing point 1.6 km from the stop.',
          routeLegId: 'fallback-leg',
          origin: { id: 'lillehammer', name: 'Lillehammer' },
          target: { id: 'oslo', name: 'Oslo' },
        },
      ],
    };
    const { service, readFile, write, writeError } = createCliHarness({
      auditTrip: vi.fn(async () => ({ ok: true, summary: 'Audited trip.', audit })),
    });

    const exitCode = await runTripCli({
      argv: ['audit', '--trip-id', 'trip-1', '--summary'],
      service: service as never,
      readFile,
      write,
      writeError,
    });

    expect(exitCode).toBe(0);
    expect(service.auditTrip).toHaveBeenCalledWith({ tripId: 'trip-1' });
    expect(JSON.parse(write.mock.calls[0]?.[0] ?? '{}')).toEqual({
      ok: true,
      summary: 'Audited trip.',
      audit,
      counts: { auditErrors: 1, auditWarnings: 2 },
    });
    expect(JSON.parse(write.mock.calls[0]?.[0] ?? '{}').audit.issues[0].providerDiagnostic)
      .toEqual(providerDiagnostic);
  });

  it('creates and audits a large manifest in two CLI calls with in-memory dependencies', async () => {
    const trips: TripSummary[] = [];
    const state = {
      destinations: [] as Destination[],
      activities: [] as Activity[],
      routeLegs: [] as RouteLeg[],
    };
    const replaceTripData = vi.fn(async (snapshot: {
      destinations: Destination[];
      activities?: Activity[];
      routeLegs: RouteLeg[];
    }) => {
      state.destinations = snapshot.destinations;
      state.activities = snapshot.activities ?? [];
      state.routeLegs = snapshot.routeLegs;
    });
    const granularCreateActivity = vi.fn(async () => {
      throw new Error('Granular activity creation must not be used.');
    });
    const repository = {
      replaceTripData,
      createActivity: granularCreateActivity,
      listDestinations: vi.fn(async () => state.destinations),
      listActivities: vi.fn(async (destinationId: string) => (
        state.activities.filter((activity) => activity.destinationId === destinationId)
      )),
      listRouteLegs: vi.fn(async () => state.routeLegs),
    } as unknown as TripRepository;
    const directoryCreateTrip = vi.fn(async ({ name }: { name: string }) => {
      const trip = {
        id: 'trip-in-memory',
        name,
        description: '',
        routingVehicle: standardRoutingVehicle,
        createdAt: '2026-07-10T12:00:00.000Z',
        updatedAt: '2026-07-10T12:00:00.000Z',
      };
      trips.push(trip);
      return trip;
    });
    const service = createTripDataService({
      directory: {
        listTrips: vi.fn(async () => trips),
        createTrip: directoryCreateTrip,
        updateTrip: vi.fn(),
        deleteTrip: vi.fn(),
      },
      createTripRepository: vi.fn(() => repository),
      resolvePlace: vi.fn(async ({ place, fallbackName, profile }) => ({
        coordinates: place.coordinates!,
        ...(profile === 'stop'
          ? {
              location: {
                placeName: fallbackName,
                regionName: '',
                countryName: 'Test country',
                sourceLabel: fallbackName,
                sourceProvider: 'legacy' as const,
              },
            }
          : {
              activityLocation: {
                name: fallbackName,
                address: `${fallbackName} address`,
                coordinates: place.coordinates,
                sourceProvider: 'manual' as const,
              },
            }),
      })),
      enrichLink: vi.fn(async (url, sortOrder) => ({
        id: `${url}-${sortOrder}`,
        url,
        title: url,
        domain: 'example.com',
        sortOrder,
      })),
      calculateRoute: vi.fn(async ({ origin, target }) => ({
        distanceKm: 20,
        travelTimeHours: 0.5,
        geometry: {
          type: 'LineString' as const,
          coordinates: [[origin.lng, origin.lat], [target.lng, target.lat]],
        },
        provider: 'in-memory',
        profile: 'driving-car' as const,
        sections: [{ kind: 'road' as const, startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 20 }],
      })),
    });
    const stops = Array.from({ length: 26 }, (_, index) => ({
      key: `stop-${index}`,
      name: `Stop ${index}`,
      place: { coordinates: { lat: 50 + index * 0.1, lng: index * 0.1 } },
      expectedStayDays: 1,
      ...(index < 3 ? { links: [`https://example.com/stop-${index}`] } : {}),
      ...(index < 15
        ? {
            activities: [{
              title: `Activity ${index}`,
              place: { coordinates: { lat: 50 + index * 0.1, lng: index * 0.1 } },
              links: [`https://example.com/activity-${index}`],
            }],
          }
        : {}),
    }));
    const manifest = {
      manifestVersion: 2,
      name: 'In-memory route',
      vehiclePreset: 'standard',
      stops,
      routeLegs: [
        { fromStopKey: 'stop-4', toStopKey: 'stop-5', movement: 'vehicle-shipping', calculation: 'manual' },
        { fromStopKey: 'stop-15', toStopKey: 'stop-16', movement: 'vehicle-shipping', calculation: 'manual' },
      ],
    };
    const write = vi.fn();
    const writeError = vi.fn();

    const createExitCode = await runTripCli({
      argv: ['create', '--input', '/tmp/manifest.json', '--summary'],
      service,
      readFile: vi.fn(async () => JSON.stringify(manifest)),
      write,
      writeError,
    });
    const auditExitCode = await runTripCli({
      argv: ['audit', '--trip-id', 'trip-in-memory', '--summary'],
      service,
      readFile: vi.fn(),
      write,
      writeError,
    });

    expect(createExitCode).toBe(0);
    expect(auditExitCode).toBe(0);
    expect(directoryCreateTrip).toHaveBeenCalledTimes(1);
    expect(replaceTripData).toHaveBeenCalledTimes(1);
    expect(granularCreateActivity).not.toHaveBeenCalled();
    expect(state.destinations).toHaveLength(26);
    expect(state.activities).toHaveLength(15);
    expect(state.routeLegs.filter((leg) => leg.status === 'manual')).toHaveLength(2);
    expect(state.activities.every((activity) => activity.location?.coordinates)).toBe(true);
    expect(JSON.parse(write.mock.calls[1]?.[0] ?? '{}')).toMatchObject({
      audit: { errors: 0 },
      counts: { auditErrors: 0 },
    });
    expect(writeError).not.toHaveBeenCalled();
  });

  it('accepts keyed id lists for reorder commands', async () => {
    const { service, readFile, write, writeError } = createCliHarness();
    readFile
      .mockResolvedValueOnce('{"stopIds":["stop-1","stop-2"]}')
      .mockResolvedValueOnce('{"activityIds":["activity-1","activity-2"]}');

    await runTripCli({
      argv: ['reorder-stops', '--trip-id', 'trip-1', '--input', '/tmp/stop-ids.json'],
      service: service as never,
      readFile,
      write,
      writeError,
    });
    await runTripCli({
      argv: ['reorder-activities', '--trip-id', 'trip-1', '--stop-id', 'stop-1', '--input', '/tmp/activity-ids.json'],
      service: service as never,
      readFile,
      write,
      writeError,
    });

    expect(service.reorderStops).toHaveBeenCalledWith({
      tripId: 'trip-1',
      stopIds: ['stop-1', 'stop-2'],
      strict: false,
    }, { dryRun: false, yes: false });
    expect(service.reorderActivities).toHaveBeenCalledWith({
      tripId: 'trip-1',
      stopId: 'stop-1',
      activityIds: ['activity-1', 'activity-2'],
    }, { dryRun: false, yes: false });
  });

  it('returns non-zero when the service returns a failed result', async () => {
    const { service, readFile, write, writeError } = createCliHarness({
      listTrips: vi.fn(async () => ({
        ok: false,
        error: { code: 'FAIL', message: 'Nope.' },
      })),
    });

    const exitCode = await runTripCli({
      argv: ['list'],
      service: service as never,
      readFile,
      write,
      writeError,
    });

    expect(exitCode).toBe(1);
    expect(JSON.parse(write.mock.calls[0]?.[0] ?? '{}')).toMatchObject({
      ok: false,
      error: { code: 'FAIL', message: 'Nope.' },
    });
  });

  it('writes structured JSON and returns non-zero when command execution throws', async () => {
    const { service, readFile, write, writeError } = createCliHarness({
      listTrips: vi.fn(async () => {
        throw new Error('Boom.');
      }),
    });

    const exitCode = await runTripCli({
      argv: ['list'],
      service: service as never,
      readFile,
      write,
      writeError,
    });

    expect(exitCode).toBe(1);
    expect(write).not.toHaveBeenCalled();
    expect(JSON.parse(writeError.mock.calls[0]?.[0] ?? '{}')).toMatchObject({
      ok: false,
      error: {
        code: 'COMMAND_FAILED',
        message: 'Boom.',
      },
    });
  });

  it('writes a concise service-unavailable error when startup fails', async () => {
    const write = vi.fn();
    const writeError = vi.fn();

    const exitCode = await runTripProgram({
      argv: ['list'],
      createService: vi.fn(() => {
        throw new Error('connect ECONNREFUSED 127.0.0.1:80');
      }),
      readFile: vi.fn(),
      write,
      writeError,
      setExitCode: vi.fn(),
    });

    expect(exitCode).toBe(1);
    expect(write).not.toHaveBeenCalled();
    expect(JSON.parse(writeError.mock.calls[0]?.[0] ?? '{}')).toMatchObject({
      ok: false,
      error: {
        code: 'COMMAND_FAILED',
        message: 'Plotter service is unavailable.',
      },
    });
  });

  it('keeps invalid base URL configuration distinct from service unavailability', async () => {
    const originalBaseUrl = process.env.PLOTTER_BASE_URL;
    process.env.PLOTTER_BASE_URL = 'file:///tmp/plotter';
    const write = vi.fn();
    const writeError = vi.fn();

    try {
      const exitCode = await runTripProgram({
        argv: ['list'],
        write,
        writeError,
        setExitCode: vi.fn(),
      });

      expect(exitCode).toBe(1);
      expect(write).not.toHaveBeenCalled();
      expect(JSON.parse(writeError.mock.calls[0]?.[0] ?? '{}')).toMatchObject({
        ok: false,
        error: { code: 'COMMAND_FAILED', message: 'Plotter CLI configuration is invalid.' },
      });
    } finally {
      if (originalBaseUrl === undefined) delete process.env.PLOTTER_BASE_URL;
      else process.env.PLOTTER_BASE_URL = originalBaseUrl;
    }
  });

  it('prints local help without creating a service connection', async () => {
    const write = vi.fn();
    const createService = vi.fn(() => {
      throw new Error('A service connection should not be needed for help.');
    });

    const exitCode = await runTripProgram({
      argv: ['help'],
      createService,
      write,
      writeError: vi.fn(),
      setExitCode: vi.fn(),
    });

    expect(exitCode).toBe(0);
    expect(createService).not.toHaveBeenCalled();
    expect(write.mock.calls[0]?.[0]).toContain('list');
  });
});
