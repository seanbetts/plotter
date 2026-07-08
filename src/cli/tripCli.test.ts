import { describe, expect, it, vi } from 'vitest';
import { parseTripCliArgs, runTripCli, runTripProgram } from './trip';

type MockService = Record<string, ReturnType<typeof vi.fn>>;

function createMockService(): MockService {
  return {
    listTrips: vi.fn(async () => ({ ok: true, summary: 'listed', trips: [] })),
    getTrip: vi.fn(async () => ({ ok: true, summary: 'loaded', trip: { id: 'trip-1' } })),
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
      },
    });
    expect(write.mock.calls[0]?.[0]).not.toContain('coordinates');
    expect(writeError).not.toHaveBeenCalled();
  });

  it('routes every supported command to the matching service method with parsed inputs', async () => {
    const { service, readFile, write, writeError } = createCliHarness();
    readFile
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

  it('writes structured JSON and returns non-zero when startup fails', async () => {
    const write = vi.fn();
    const writeError = vi.fn();

    const exitCode = await runTripProgram({
      argv: ['list'],
      createService: vi.fn(() => {
        throw new Error('No Supabase.');
      }),
      ensureSession: vi.fn(),
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
        message: 'No Supabase.',
      },
    });
  });
});
