import { describe, expect, it, vi, type Mock } from 'vitest';
import { createTripDataService } from './tripDataService';
import type { LinkEnricher } from './types';
import type { Activity, Destination, RouteLeg } from '../domain/types';
import type { TripSummary } from '../storage/tripDirectoryRepository';
import type { TripRepository } from '../storage/tripRepository';
import { createDestination } from '../domain/destinations';
import { createRouteKey, createRouteLeg } from '../domain/routeLegs';
import { standardRoutingVehicle } from '../domain/vehiclePresets';

function createHarness(overrides?: { enrichLink?: LinkEnricher }) {
  const trips: TripSummary[] = [];
  const repositories = new Map<string, {
    destinations: Destination[];
    routeLegs: RouteLeg[];
    activities: import('../domain/types').Activity[];
    reorderActivities: Mock<TripRepository['reorderActivities']>;
  }>();

  const createTripRepository = (tripId: string): TripRepository => {
    const data = repositories.get(tripId) ?? (() => {
      const repoData = {
        destinations: [] as Destination[],
        routeLegs: [] as RouteLeg[],
        activities: [] as import('../domain/types').Activity[],
        reorderActivities: vi.fn(async (destinationId: string, orderedActivityIds: string[]) => {
          const requestedIds = new Set(orderedActivityIds);
          const activitiesById = new Map(repoData.activities.map((activity) => [activity.id, activity]));
          const ordered = [
            ...orderedActivityIds
              .map((id) => activitiesById.get(id))
              .filter((activity): activity is Activity => Boolean(activity)),
            ...repoData.activities.filter((activity) => activity.destinationId === destinationId && !requestedIds.has(activity.id)),
          ].map((activity, order) => ({ ...activity, order }));
          repoData.activities = [
            ...repoData.activities.filter((activity) => activity.destinationId !== destinationId),
            ...ordered,
          ];
          return ordered;
        }),
      };
      repositories.set(tripId, repoData);
      return repoData;
    })();

    return {
      async listDestinations() {
        return [...data.destinations].sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
      },
      async saveDestination(destination) {
        const index = data.destinations.findIndex((existing) => existing.id === destination.id);
        if (index === -1) data.destinations.push(destination);
        else data.destinations[index] = destination;
      },
      async deleteDestination(destinationId) {
        data.destinations = data.destinations.filter((destination) => destination.id !== destinationId);
        data.routeLegs = data.routeLegs.filter(
          (leg) => leg.originDestinationId !== destinationId && leg.targetDestinationId !== destinationId,
        );
      },
      async listRouteLegs() {
        return [...data.routeLegs];
      },
      async saveRouteLeg(routeLeg) {
        const index = data.routeLegs.findIndex((existing) => existing.id === routeLeg.id);
        if (index === -1) data.routeLegs.push(routeLeg);
        else data.routeLegs[index] = routeLeg;
      },
      async deleteRouteLeg(routeLegId) {
        data.routeLegs = data.routeLegs.filter((routeLeg) => routeLeg.id !== routeLegId);
      },
      async listActivities(destinationId) {
        return data.activities.filter((activity) => activity.destinationId === destinationId);
      },
      async createActivity(input) {
        const timestamp = new Date().toISOString();
        const activity = {
          id: crypto.randomUUID(),
          destinationId: input.destinationId,
          order: input.order ?? data.activities.filter((activity) => activity.destinationId === input.destinationId).length,
          title: input.title,
          description: '',
          category: 'other' as const,
          status: 'idea' as const,
          priority: 'medium' as const,
          location: input.location,
          links: [],
          notes: '',
          tags: [],
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        data.activities.push(activity);
        return activity;
      },
      async updateActivity(activityId, patch) {
        const activity = data.activities.find((candidate) => candidate.id === activityId);
        if (!activity) throw new Error('Activity not found.');
        Object.assign(activity, patch, { updatedAt: new Date().toISOString() });
        return activity;
      },
      async deleteActivity(activityId) {
        data.activities = data.activities.filter((activity) => activity.id !== activityId);
      },
      reorderActivities: data.reorderActivities,
      async listDestinationMedia() {
        return [];
      },
      async uploadDestinationMedia() {
        throw new Error('Not needed in this test.');
      },
      async importDestinationMediaFromSearch() {
        throw new Error('Not needed in this test.');
      },
      async updateDestinationMedia() {
        throw new Error('Not needed in this test.');
      },
      async deleteDestinationMedia() {
        throw new Error('Not needed in this test.');
      },
      async reorderDestinationMedia() {
        return [];
      },
      async listDestinationMediaRollup() {
        return [];
      },
      async listActivityMedia() {
        return [];
      },
      async uploadActivityMedia() {
        throw new Error('Not needed in this test.');
      },
      async importActivityMediaFromSearch() {
        throw new Error('Not needed in this test.');
      },
      async updateActivityMedia() {
        throw new Error('Not needed in this test.');
      },
      async deleteActivityMedia() {
        throw new Error('Not needed in this test.');
      },
      async reorderActivityMedia() {
        return [];
      },
      async replaceTripData() {
        throw new Error('Not needed in this test.');
      },
    };
  };

  const resolvePlace = vi.fn(async ({
    place,
    fallbackName,
    profile,
  }: {
    place: { coordinates?: { lat: number; lng: number } };
    fallbackName: string;
    profile: 'stop' | 'activity';
  }) => ({
    coordinates: place.coordinates ?? { lat: 58.492089, lng: -4.427364 },
    ...(profile === 'activity'
      ? {
          activityLocation: {
            name: fallbackName,
            address: `${fallbackName}, Scotland`,
            coordinates: place.coordinates ?? { lat: 58.492089, lng: -4.427364 },
            sourceProvider: 'manual' as const,
          },
        }
      : {
          location: {
            placeName: fallbackName,
            regionName: '',
            countryName: 'Scotland',
            sourceLabel: `${fallbackName}, Scotland`,
            sourceProvider: 'legacy' as const,
          },
        }),
  }));
  const calculateRoute = vi.fn(async ({ origin, target }: { origin: { lat: number; lng: number }; target: { lat: number; lng: number } }) => ({
    distanceKm: 10,
    travelTimeHours: 1,
    geometry: {
      type: 'LineString' as const,
      coordinates: [[origin.lng, origin.lat], [target.lng, target.lat]],
    },
    provider: 'test',
    profile: 'driving-car' as const,
  }));

  const service = createTripDataService({
    directory: {
      async listTrips() {
        return trips;
      },
      async createTrip(input) {
        const timestamp = new Date().toISOString();
        const trip = {
          id: crypto.randomUUID(),
          name: input.name,
          description: '',
          routingVehicle: input.routingVehicle ?? standardRoutingVehicle,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        trips.push(trip);
        return trip;
      },
      async updateTrip(tripId, patch) {
        const trip = trips.find((candidate) => candidate.id === tripId);
        if (!trip) throw new Error('Trip not found.');
        Object.assign(trip, patch, { updatedAt: new Date().toISOString() });
        return trip;
      },
      async deleteTrip(tripId) {
        const index = trips.findIndex((candidate) => candidate.id === tripId);
        if (index !== -1) trips.splice(index, 1);
        repositories.delete(tripId);
      },
    },
    createTripRepository,
    resolvePlace,
    calculateRoute,
    enrichLink: overrides?.enrichLink,
  });

  return { service, trips, repositories, resolvePlace, calculateRoute };
}

describe('TripDataService trips and stops', () => {
  function createBulkManifestHarness(options?: { replaceError?: Error }) {
    const replaceTripData = vi.fn(async () => {
      if (options?.replaceError) throw options.replaceError;
    });
    const createActivity = vi.fn();
    const updateActivity = vi.fn();
    const repository = {
      replaceTripData,
      createActivity,
      updateActivity,
    } as unknown as TripRepository;
    const createTrip = vi.fn(async ({ name }: { name: string }) => ({
      id: 'bulk-trip-id',
      name,
      description: '',
      routingVehicle: standardRoutingVehicle,
      createdAt: '2026-07-10T12:00:00.000Z',
      updatedAt: '2026-07-10T12:00:00.000Z',
    }));
    const deleteTrip = vi.fn(async () => undefined);
    const resolvePlace = vi.fn(async ({ place, fallbackName, profile }) => ({
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
    }));
    const enrichLink = vi.fn(async (url: string, sortOrder: number) => ({
      id: `${url}-${sortOrder}`,
      url,
      title: url,
      domain: 'example.com',
      sortOrder,
    }));
    const calculateRoute = vi.fn(async ({ origin, target }) => ({
      distanceKm: 50,
      travelTimeHours: 1,
      geometry: {
        type: 'LineString' as const,
        coordinates: [[origin.lng, origin.lat], [target.lng, target.lat]],
      },
      provider: 'test',
      profile: 'driving-car' as const,
    }));
    const service = createTripDataService({
      directory: {
        listTrips: vi.fn(async () => []),
        createTrip,
        updateTrip: vi.fn(),
        deleteTrip,
      },
      createTripRepository: vi.fn(() => repository),
      resolvePlace,
      enrichLink,
      calculateRoute,
    });
    const stops = Array.from({ length: 26 }, (_, index) => ({
      key: `stop-${index}`,
      name: `Stop ${index}`,
      place: { coordinates: { lat: 40 + index * 0.1, lng: -5 + index * 0.1 } },
      expectedStayDays: 1,
      ...(index < 3 ? { links: [`https://example.com/stop-${index}`] } : {}),
      ...(index < 15
        ? {
            activities: [{
              title: `Activity ${index}`,
              place: { coordinates: { lat: 40 + index * 0.1, lng: -4.99 + index * 0.1 } },
              links: [`https://example.com/activity-${index}`],
            }],
          }
        : {}),
    }));
    const manifest = {
      manifestVersion: 1 as const,
      name: 'Large overland trip',
      stops,
      routeLegs: [
        { fromStopKey: 'stop-4', toStopKey: 'stop-5', type: 'shipping-manual' as const },
        { fromStopKey: 'stop-15', toStopKey: 'stop-16', type: 'shipping-manual' as const },
      ],
    };

    return {
      service,
      manifest,
      repository,
      replaceTripData,
      createActivity,
      updateActivity,
      createTrip,
      deleteTrip,
      resolvePlace,
      enrichLink,
      calculateRoute,
    };
  }

  it('creates a complete manifest with one bulk persistence call', async () => {
    const harness = createBulkManifestHarness();

    const result = await harness.service.createTrip(harness.manifest);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(harness.resolvePlace).toHaveBeenCalledTimes(41);
    expect(harness.enrichLink).toHaveBeenCalledTimes(18);
    expect(harness.calculateRoute).toHaveBeenCalledTimes(23);
    expect(harness.replaceTripData).toHaveBeenCalledTimes(1);
    expect(harness.createActivity).not.toHaveBeenCalled();
    expect(harness.updateActivity).not.toHaveBeenCalled();
    expect(harness.createTrip).toHaveBeenCalledTimes(1);
    expect(result.stops).toHaveLength(26);
    expect(result.activities).toHaveLength(15);
    expect(result.changed.linksAdded).toHaveLength(18);
    expect(result.routeLegs.filter((leg) => leg.status === 'ready')).toHaveLength(23);
    expect(result.routeLegs.filter((leg) => leg.status === 'manual')).toHaveLength(2);
  });

  it('materializes a complete manifest dry-run without creating or persisting a trip', async () => {
    const harness = createBulkManifestHarness();

    const result = await harness.service.createTrip(harness.manifest, { dryRun: true });

    expect(result.ok).toBe(true);
    expect(harness.createTrip).not.toHaveBeenCalled();
    expect(harness.replaceTripData).not.toHaveBeenCalled();
    expect(harness.resolvePlace).toHaveBeenCalledTimes(41);
    expect(harness.enrichLink).toHaveBeenCalledTimes(18);
    expect(harness.calculateRoute).toHaveBeenCalledTimes(23);
  });

  it('deletes a newly created trip when bulk persistence fails', async () => {
    const harness = createBulkManifestHarness({ replaceError: new Error('Bulk write failed.') });

    const result = await harness.service.createTrip(harness.manifest);

    expect(result).toEqual({
      ok: false,
      error: { code: 'COMMAND_FAILED', message: 'Bulk write failed.' },
    });
    expect(harness.deleteTrip).toHaveBeenCalledWith('bulk-trip-id');
  });

  it('blocks a manifest with semantic errors before creating a trip', async () => {
    const harness = createBulkManifestHarness();
    harness.manifest.stops[0].activities![0].place = {
      coordinates: { lat: -34.6037, lng: -58.3816 },
    };

    const result = await harness.service.createTrip(harness.manifest);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({
      code: 'TRIP_AUDIT_FAILED',
      message: 'Trip manifest has semantic audit errors.',
      path: 'manifest',
      details: {
        audit: {
          errors: 1,
          issues: [expect.objectContaining({
            code: 'ACTIVITY_DISTANCE_OUTLIER',
            severity: 'error',
            destination: {
              id: expect.any(String),
              name: 'Stop 0',
              coordinates: { lat: 40, lng: -5 },
              resolvedLabel: 'Stop 0',
              sourceProvider: 'legacy',
            },
            activity: {
              id: expect.any(String),
              name: 'Activity 0',
              coordinates: { lat: -34.6037, lng: -58.3816 },
              resolvedLabel: 'Activity 0 address',
              sourceProvider: 'manual',
            },
          })],
        },
      },
    });
    expect(harness.createTrip).not.toHaveBeenCalled();
    expect(harness.replaceTripData).not.toHaveBeenCalled();
  });

  it('audits persisted trip activities with the same semantic rules', async () => {
    const { service } = createHarness();
    const created = await service.createTrip({
      name: 'Audit trip',
      stops: [{
        name: 'Larvik',
        place: { coordinates: { lat: 59.0533, lng: 10.0352 } },
      }],
    });
    if (!created.ok) throw new Error('Expected trip creation to pass.');

    const clean = await service.auditTrip({ tripId: created.trip.id });
    expect(clean.ok && clean.audit).toEqual({ errors: 0, warnings: 0, issues: [] });

    await service.createActivity({
      tripId: created.trip.id,
      stopId: created.stops[0].id,
      activity: {
        title: 'Drive to A in Lofoten',
        place: { coordinates: { lat: 67.8804, lng: 12.9826 } },
      },
    });
    await service.createActivity({
      tripId: created.trip.id,
      stopId: created.stops[0].id,
      activity: {
        title: 'Stop at Sohlbergplassen',
        place: { coordinates: { lat: 61.7797, lng: 10.1546 } },
      },
    });

    const audited = await service.auditTrip({ tripId: created.trip.id });
    expect(audited.ok).toBe(true);
    if (!audited.ok) return;
    expect(audited.audit.errors).toBe(2);
    expect(audited.audit.issues.map((issue) => issue.code)).toEqual([
      'ACTIVITY_DISTANCE_OUTLIER',
      'ACTIVITY_DISTANCE_OUTLIER',
    ]);
  });

  it('recalculates and saves only failed route legs', async () => {
    const destinations = ['Home', 'Hamburg', 'Copenhagen', 'Stockholm'].map((name, order) => (
      createDestination({
        name,
        coordinates: { lat: 50 + order, lng: order },
        order,
      })
    ));
    const ready = createRouteLeg({
      originDestinationId: destinations[0].id,
      targetDestinationId: destinations[1].id,
      type: 'driving-auto',
      status: 'ready',
      distanceKm: 100,
      travelTimeHours: 2,
      geometry: {
        type: 'LineString',
        coordinates: [[0, 50], [1, 51]],
      },
      provider: 'test',
      profile: 'driving-car',
      routeKey: createRouteKey({
        origin: destinations[0].coordinates,
        target: destinations[1].coordinates,
      }),
      calculatedAt: '2026-07-10T12:00:00.000Z',
    });
    const failed = [
      createRouteLeg({
        originDestinationId: destinations[1].id,
        targetDestinationId: destinations[2].id,
        type: 'driving-auto',
        status: 'failed',
        error: 'OpenRouteService route calculation failed (HTTP 429)',
      }),
      createRouteLeg({
        originDestinationId: destinations[2].id,
        targetDestinationId: destinations[3].id,
        type: 'driving-auto',
        status: 'failed',
        error: 'OpenRouteService route calculation failed (HTTP 429)',
      }),
    ];
    const staleNonAdjacentLeg = createRouteLeg({
      originDestinationId: destinations[0].id,
      targetDestinationId: destinations[3].id,
      type: 'driving-auto',
      status: 'ready',
    });
    const saveRouteLeg = vi.fn(async (routeLeg: RouteLeg) => {
      void routeLeg;
    });
    const deleteRouteLeg = vi.fn(async () => {});
    const calculateRoute = vi.fn(async ({ origin, target }) => ({
      distanceKm: 120,
      travelTimeHours: 2.5,
      geometry: {
        type: 'LineString' as const,
        coordinates: [[origin.lng, origin.lat], [target.lng, target.lat]],
      },
      provider: 'test',
      profile: 'driving-car' as const,
    }));
    const repository = {
      listDestinations: vi.fn(async () => destinations),
      listRouteLegs: vi.fn(async () => [ready, ...failed, staleNonAdjacentLeg]),
      saveRouteLeg,
      deleteRouteLeg,
    } as unknown as TripRepository;
    const service = createTripDataService({
      directory: {
        listTrips: vi.fn(async () => [{
          id: 'trip-1',
          name: 'Nordkapp',
          description: '',
          routingVehicle: standardRoutingVehicle,
          createdAt: '',
          updatedAt: '',
        }]),
        createTrip: vi.fn(),
        updateTrip: vi.fn(),
        deleteTrip: vi.fn(),
      },
      createTripRepository: vi.fn(() => repository),
      calculateRoute,
    });

    const result = await service.recalculateFailedRoutes({ tripId: 'trip-1' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(calculateRoute).toHaveBeenCalledTimes(2);
    expect(saveRouteLeg).toHaveBeenCalledTimes(2);
    expect(saveRouteLeg.mock.calls.map(([leg]) => leg.id)).toEqual(failed.map((leg) => leg.id));
    expect(deleteRouteLeg).toHaveBeenCalledWith(staleNonAdjacentLeg.id);
    expect(result.routeLegs).toHaveLength(3);
    expect(result.routeLegs[0]).toBe(ready);
    expect(result.failedRoutesBefore).toBe(2);
    expect(result.failedRoutesAfter).toBe(0);
    expect(result.recalculatedRoutes).toMatchObject([
      { originName: 'Hamburg', targetName: 'Copenhagen', status: 'ready' },
      { originName: 'Copenhagen', targetName: 'Stockholm', status: 'ready' },
    ]);
    expect(result.changed.routesRecalculated).toBe(2);
  });

  it('rejects malformed createTrip stops input with a validation error', async () => {
    const { service, trips } = createHarness();

    const result = await service.createTrip({
      name: 'NC500',
      stops: {} as never,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_STOPS');
    expect(result.error.message).toBe('stops must be an array.');
    expect(trips).toHaveLength(0);
  });

  it('creates a trip with ordered overnight stops and derived route legs', async () => {
    const { service, calculateRoute } = createHarness();

    const result = await service.createTrip({
      name: 'North Coast 500 Trip',
      stops: [
        {
          name: 'Boroughbridge Camping',
          place: { coordinates: { lat: 54.0903, lng: -1.4144 } },
          notes: 'Booked.',
          expectedStayDays: 2,
          tags: ['camping'],
        },
        {
          name: 'Coast And Castles Camping',
          place: { coordinates: { lat: 55.426423, lng: -1.60645 } },
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trip.name).toBe('North Coast 500 Trip');
    expect(result.stops.map((stop) => stop.name)).toEqual([
      'Boroughbridge Camping',
      'Coast And Castles Camping',
    ]);
    expect(result.stops[0].timing.expectedStayDays).toBe(2);
    expect(result.stops[0].research.notes).toBe('Booked.');
    expect(result.stops[0].tags).toEqual(['camping']);
    expect(result.routeLegs).toHaveLength(1);
    expect(result.changed.tripsCreated).toEqual(['North Coast 500 Trip']);
    expect(result.changed.stopsAdded).toEqual([
      'Boroughbridge Camping',
      'Coast And Castles Camping',
    ]);
    expect(result.changed.routesRecalculated).toBe(1);
    expect(calculateRoute).toHaveBeenCalledTimes(1);
  });

  it('lists trips with stop counts from each repository', async () => {
    const { service } = createHarness();

    await service.createTrip({
      name: 'NC500',
      stops: [{ name: 'Tongue', place: { coordinates: { lat: 58.492089, lng: -4.427364 } } }],
    });
    await service.createTrip({
      name: 'Skye',
      stops: [
        { name: 'Broadford', place: { coordinates: { lat: 57.2417, lng: -5.9086 } } },
        { name: 'Dunvegan', place: { coordinates: { lat: 57.4493, lng: -6.5879 } } },
      ],
    });

    const result = await service.listTrips();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trips.map((trip) => ({ name: trip.name, stopCount: trip.stopCount }))).toEqual([
      { name: 'NC500', stopCount: 1 },
      { name: 'Skye', stopCount: 2 },
    ]);
  });

  it('gets one trip with ordered stops and route legs', async () => {
    const { service } = createHarness();

    const created = await service.createTrip({
      name: 'NC500',
      stops: [
        { name: 'Durness', place: { coordinates: { lat: 58.5689, lng: -4.7454 } } },
        { name: 'Ullapool', place: { coordinates: { lat: 57.8996, lng: -5.1589 } } },
      ],
    });
    if (!created.ok) throw new Error('Expected trip creation to pass.');

    const result = await service.getTrip({ tripId: created.trip.id });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trip.trip.name).toBe('NC500');
    expect(result.trip.stops.map((stop) => stop.name)).toEqual(['Durness', 'Ullapool']);
    expect(result.trip.routeLegs).toHaveLength(1);
    expect(result.trip.activitiesByStopId).toBeUndefined();
  });

  it('dry-runs destructive stop replacement without saving', async () => {
    const { service } = createHarness();

    const created = await service.createTrip({
      name: 'NC500',
      stops: [{ name: 'Tongue', place: { coordinates: { lat: 58.492089, lng: -4.427364 } } }],
    });
    if (!created.ok) throw new Error('Expected trip creation to pass.');

    const result = await service.replaceStops(
      {
        tripId: created.trip.id,
        stops: [{ name: 'Ullapool', place: { coordinates: { lat: 57.934707, lng: -5.196483 } } }],
      },
      { dryRun: true },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary).toContain('Would replace');
    expect(result.changed.stopsAdded).toEqual(['Ullapool']);
    expect(result.changed.stopsDeleted).toEqual(['Tongue']);

    const after = await service.getTrip({ tripId: created.trip.id });
    expect(after.ok && after.trip.stops.map((stop) => stop.name)).toEqual(['Tongue']);
  });

  it('renames and deletes trips with confirmation safeguards', async () => {
    const { service } = createHarness();

    const created = await service.createTrip({ name: 'NC500' });
    if (!created.ok) throw new Error('Expected trip creation to pass.');

    const renamed = await service.renameTrip(
      { tripId: created.trip.id, name: 'North Coast 500' },
      { dryRun: true },
    );
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;
    expect(renamed.summary).toContain('Would rename');

    const afterDryRun = await service.getTrip({ tripId: created.trip.id });
    expect(afterDryRun.ok && afterDryRun.trip.trip.name).toBe('NC500');

    const appliedRename = await service.renameTrip({ tripId: created.trip.id, name: 'North Coast 500' });
    expect(appliedRename.ok).toBe(true);
    if (!appliedRename.ok) return;
    expect(appliedRename.trip.name).toBe('North Coast 500');

    const blockedDelete = await service.deleteTrip({ tripId: created.trip.id });
    expect(blockedDelete).toEqual({
      ok: false,
      error: {
        code: 'CONFIRMATION_REQUIRED',
        message: 'Deleting trip North Coast 500 requires --yes or --dry-run.',
      },
    });

    const deleted = await service.deleteTrip({ tripId: created.trip.id }, { yes: true });
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) return;
    expect(deleted.changed.tripsDeleted).toEqual(['North Coast 500']);

    const listed = await service.listTrips();
    expect(listed.ok && listed.trips).toEqual([]);
  });

  it('inserts a stop between adjacent stops and recalculates route legs', async () => {
    const { service, calculateRoute } = createHarness();

    const created = await service.createTrip({
      name: 'NC500',
      stops: [
        { name: 'Inverness', place: { coordinates: { lat: 57.4778, lng: -4.2247 } } },
        { name: 'Ullapool', place: { coordinates: { lat: 57.8996, lng: -5.1589 } } },
      ],
    });
    if (!created.ok) throw new Error('Expected trip creation to pass.');
    calculateRoute.mockClear();

    const result = await service.insertStop({
      tripId: created.trip.id,
      afterStopId: created.stops[0].id,
      beforeStopId: created.stops[1].id,
      stop: { name: 'Garve', place: { coordinates: { lat: 57.613, lng: -4.6883 } } },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stops.map((stop) => stop.name)).toEqual(['Inverness', 'Garve', 'Ullapool']);
    expect(result.routeLegs).toHaveLength(2);
    expect(result.changed.stopsAdded).toEqual(['Garve']);
    expect(result.changed.routesRecalculated).toBe(2);
    expect(calculateRoute).toHaveBeenCalledTimes(2);
  });

  it('updates one stop fields and adjacent routes when coordinates change', async () => {
    const { service, calculateRoute } = createHarness();

    const created = await service.createTrip({
      name: 'NC500',
      stops: [
        { name: 'Inverness', place: { coordinates: { lat: 57.4778, lng: -4.2247 } } },
        { name: 'Tongue', place: { coordinates: { lat: 58.492089, lng: -4.427364 } } },
        { name: 'Durness', place: { coordinates: { lat: 58.5689, lng: -4.7454 } } },
      ],
    });
    if (!created.ok) throw new Error('Expected trip creation to pass.');
    calculateRoute.mockClear();

    const result = await service.updateStop({
      tripId: created.trip.id,
      stopId: created.stops[1].id,
      patch: {
        name: 'Tongue Bay',
        place: { coordinates: { lat: 58.4903, lng: -4.4301 } },
        expectedStayDays: 4,
        notes: 'Switch campsite.',
        tags: ['camping', 'viewpoint'],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stop.name).toBe('Tongue Bay');
    expect(result.stop.timing.expectedStayDays).toBe(4);
    expect(result.stop.research.notes).toBe('Switch campsite.');
    expect(result.stop.tags).toEqual(['camping', 'viewpoint']);
    expect(result.changed.stopsUpdated).toEqual(['Tongue Bay']);
    expect(result.changed.routesRecalculated).toBe(2);
    expect(calculateRoute).toHaveBeenCalledTimes(2);
  });

  it('deletes a stop, bridges the gap, and reorders the remaining stops', async () => {
    const { service, calculateRoute } = createHarness();

    const created = await service.createTrip({
      name: 'NC500',
      stops: [
        { name: 'Inverness', place: { coordinates: { lat: 57.4778, lng: -4.2247 } } },
        { name: 'Tongue', place: { coordinates: { lat: 58.492089, lng: -4.427364 } } },
        { name: 'Durness', place: { coordinates: { lat: 58.5689, lng: -4.7454 } } },
      ],
    });
    if (!created.ok) throw new Error('Expected trip creation to pass.');
    calculateRoute.mockClear();

    const dryRun = await service.deleteStop(
      { tripId: created.trip.id, stopId: created.stops[1].id },
      { dryRun: true },
    );
    expect(dryRun.ok).toBe(true);
    if (!dryRun.ok) return;
    expect(dryRun.summary).toContain('Would delete');
    calculateRoute.mockClear();

    const result = await service.deleteStop(
      { tripId: created.trip.id, stopId: created.stops[1].id },
      { yes: true },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed.stopsDeleted).toEqual(['Tongue']);
    expect(result.changed.routesRecalculated).toBe(1);
    expect(calculateRoute).toHaveBeenCalledTimes(1);

    const trip = await service.getTrip({ tripId: created.trip.id });
    expect(trip.ok).toBe(true);
    if (!trip.ok) return;
    expect(trip.trip.stops.map((stop) => ({ name: stop.name, order: stop.order }))).toEqual([
      { name: 'Inverness', order: 0 },
      { name: 'Durness', order: 1 },
    ]);
    expect(trip.trip.routeLegs).toHaveLength(1);
  });

  it('reorders stops and keeps omitted stops at the end unless strict', async () => {
    const { service, calculateRoute } = createHarness();

    const created = await service.createTrip({
      name: 'NC500',
      stops: [
        { name: 'A', place: { coordinates: { lat: 57.0, lng: -4.0 } } },
        { name: 'B', place: { coordinates: { lat: 57.5, lng: -4.2 } } },
        { name: 'C', place: { coordinates: { lat: 58.0, lng: -4.4 } } },
      ],
    });
    if (!created.ok) throw new Error('Expected trip creation to pass.');
    calculateRoute.mockClear();

    const result = await service.reorderStops({
      tripId: created.trip.id,
      stopIds: [created.stops[2].id, created.stops[0].id],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stops.map((stop) => stop.name)).toEqual(['C', 'A', 'B']);
    expect(result.changed.stopsUpdated).toEqual(['C', 'A', 'B']);
    expect(result.changed.routesRecalculated).toBe(1);

    const strictFailure = await service.reorderStops({
      tripId: created.trip.id,
      stopIds: [created.stops[0].id, created.stops[1].id],
      strict: true,
    });
    expect(strictFailure).toEqual({
      ok: false,
      error: {
        code: 'STOP_ID_MISMATCH',
        message: 'Strict reorder must include every stop exactly once.',
      },
    });
  });
});

describe('TripDataService links and activities', () => {
  it('adds stop links using the link enricher', async () => {
    const enrichLink = vi.fn(async (url: string, sortOrder: number) => ({
      id: `link-${sortOrder}`,
      title: 'Alnwick Castle',
      url,
      domain: new URL(url).hostname,
      sortOrder,
    }));
    const { service } = createHarness({ enrichLink });
    const created = await service.createTrip({
      name: 'NC500',
      stops: [{ name: 'Alnwick', place: { coordinates: { lat: 55.426423, lng: -1.60645 } } }],
    });
    if (!created.ok) throw new Error('Expected trip creation to pass.');

    const result = await service.addStopLink({
      tripId: created.trip.id,
      stopId: created.stops[0].id,
      url: 'https://www.alnwickcastle.com/',
    });

    expect(result.ok).toBe(true);
    expect(enrichLink).toHaveBeenCalledWith('https://www.alnwickcastle.com/', 0);
    const trip = await service.getTrip({ tripId: created.trip.id, includeLinks: true });
    expect(trip.ok && trip.trip.stops[0].research.links[0]).toMatchObject({
      id: 'link-0',
      title: 'Alnwick Castle',
      url: 'https://www.alnwickcastle.com/',
      sortOrder: 0,
    });
  });

  it('does not add duplicate stop links after enrichment canonicalizes the URL', async () => {
    const enrichLink = vi.fn(async (_url: string, sortOrder: number) => ({
      id: `link-${sortOrder}`,
      title: 'Apple Maps',
      url: 'https://maps.apple.com/place?coordinate=55.415557%2C-1.705992&name=Alnwick%20Castle',
      domain: 'maps.apple.com',
      sortOrder,
    }));
    const { service } = createHarness({ enrichLink });
    const created = await service.createTrip({
      name: 'NC500',
      stops: [{ name: 'Alnwick', place: { coordinates: { lat: 55.426423, lng: -1.60645 } } }],
    });
    if (!created.ok) throw new Error('Expected trip creation to pass.');

    await service.addStopLink({
      tripId: created.trip.id,
      stopId: created.stops[0].id,
      url: 'https://maps.apple.com/?q=Alnwick%20Castle',
    });
    const duplicate = await service.addStopLink({
      tripId: created.trip.id,
      stopId: created.stops[0].id,
      url: 'https://maps.apple.com/?q=Alnwick%20Castle',
    });

    expect(duplicate.ok).toBe(true);
    expect(duplicate.ok && duplicate.summary).toContain('already exists');
    expect(duplicate.ok && duplicate.changed.linksAdded).toEqual([]);
    const trip = await service.getTrip({ tripId: created.trip.id, includeLinks: true });
    expect(trip.ok && trip.trip.stops[0].research.links).toHaveLength(1);
  });

  it('omits stop and activity links from getTrip unless includeLinks is true', async () => {
    const { service } = createHarness();
    const created = await service.createTrip({
      name: 'NC500',
      stops: [{ name: 'Durness', place: { coordinates: { lat: 58.5689, lng: -4.7454 } } }],
    });
    if (!created.ok) throw new Error('Expected trip creation to pass.');

    const activity = await service.createActivity({
      tripId: created.trip.id,
      stopId: created.stops[0].id,
      activity: { title: 'Smoo Cave' },
    });
    if (!activity.ok) throw new Error('Expected activity creation to pass.');

    await service.addStopLink({
      tripId: created.trip.id,
      stopId: created.stops[0].id,
      url: 'https://www.visitscotland.com/places-to-go/north-coast-500',
    });
    await service.addActivityLink({
      tripId: created.trip.id,
      activityId: activity.activity.id,
      url: 'https://www.visitscotland.com/info/see-do/smoo-cave-p245811',
    });

    const withoutLinks = await service.getTrip({
      tripId: created.trip.id,
      includeActivities: true,
    });
    expect(withoutLinks.ok).toBe(true);
    if (!withoutLinks.ok) return;
    expect(withoutLinks.trip.stops[0].research.links).toEqual([]);
    expect(withoutLinks.trip.activitiesByStopId?.[created.stops[0].id]?.[0]?.links).toEqual([]);

    const withLinks = await service.getTrip({
      tripId: created.trip.id,
      includeActivities: true,
      includeLinks: true,
    });
    expect(withLinks.ok).toBe(true);
    if (!withLinks.ok) return;
    expect(withLinks.trip.stops[0].research.links).toHaveLength(1);
    expect(withLinks.trip.activitiesByStopId?.[created.stops[0].id]?.[0]?.links).toHaveLength(1);
  });

  it('deletes stop links and re-densifies the remaining sort order', async () => {
    const { service } = createHarness();
    const created = await service.createTrip({
      name: 'NC500',
      stops: [{ name: 'Alnwick', place: { coordinates: { lat: 55.426423, lng: -1.60645 } } }],
    });
    if (!created.ok) throw new Error('Expected trip creation to pass.');

    await service.addStopLink({
      tripId: created.trip.id,
      stopId: created.stops[0].id,
      url: 'https://www.alnwickcastle.com/',
    });
    await service.addStopLink({
      tripId: created.trip.id,
      stopId: created.stops[0].id,
      url: 'https://www.visitalnwick.org.uk/',
    });

    const beforeDelete = await service.getTrip({ tripId: created.trip.id, includeLinks: true });
    if (!beforeDelete.ok) throw new Error('Expected trip load to pass.');

    const result = await service.deleteStopLink({
      tripId: created.trip.id,
      stopId: created.stops[0].id,
      linkId: beforeDelete.trip.stops[0].research.links[0].id,
    });

    expect(result.ok).toBe(true);
    const afterDelete = await service.getTrip({ tripId: created.trip.id, includeLinks: true });
    expect(afterDelete.ok && afterDelete.trip.stops[0].research.links).toMatchObject([
      {
        url: 'https://www.visitalnwick.org.uk/',
        sortOrder: 0,
      },
    ]);
  });

  it('creates and updates an activity with visible details', async () => {
    const { service } = createHarness();
    const created = await service.createTrip({
      name: 'NC500',
      stops: [{ name: 'Durness', place: { coordinates: { lat: 58.5689, lng: -4.7454 } } }],
    });
    if (!created.ok) throw new Error('Expected trip creation to pass.');

    const activityResult = await service.createActivity({
      tripId: created.trip.id,
      stopId: created.stops[0].id,
      activity: { title: 'Smoo Cave', place: { coordinates: { lat: 58.5634, lng: -4.7212 } } },
    });

    expect(activityResult.ok).toBe(true);
    if (!activityResult.ok) return;
    const updateResult = await service.updateActivity({
      tripId: created.trip.id,
      activityId: activityResult.activity.id,
      patch: {
        description: 'Sea cave near Durness.',
        notes: 'Visit before driving to Shore.',
        tags: ['outdoors'],
      },
    });

    expect(updateResult.ok).toBe(true);
    if (!updateResult.ok) return;
    expect(updateResult.activity).toMatchObject({
      title: 'Smoo Cave',
      description: 'Sea cave near Durness.',
      notes: 'Visit before driving to Shore.',
      tags: ['outdoors'],
    });
  });

  it('lists, reorders, and deletes activities under one stop', async () => {
    const { service } = createHarness();
    const created = await service.createTrip({
      name: 'NC500',
      stops: [{ name: 'Durness', place: { coordinates: { lat: 58.5689, lng: -4.7454 } } }],
    });
    if (!created.ok) throw new Error('Expected trip creation to pass.');

    const first = await service.createActivity({
      tripId: created.trip.id,
      stopId: created.stops[0].id,
      activity: { title: 'Smoo Cave' },
    });
    const second = await service.createActivity({
      tripId: created.trip.id,
      stopId: created.stops[0].id,
      activity: { title: 'Balnakeil Beach' },
    });
    if (!first.ok || !second.ok) throw new Error('Expected activity creation to pass.');

    const listed = await service.listActivities({
      tripId: created.trip.id,
      stopId: created.stops[0].id,
    });
    expect(listed.ok && listed.activities.map((activity) => activity.title)).toEqual([
      'Smoo Cave',
      'Balnakeil Beach',
    ]);

    const reordered = await service.reorderActivities({
      tripId: created.trip.id,
      stopId: created.stops[0].id,
      activityIds: [second.activity.id, first.activity.id],
    });
    expect(reordered.ok && reordered.activities.map((activity) => activity.title)).toEqual([
      'Balnakeil Beach',
      'Smoo Cave',
    ]);
    expect(reordered.ok && reordered.activities.map((activity) => activity.order)).toEqual([0, 1]);

    const deleted = await service.deleteActivity(
      { tripId: created.trip.id, activityId: first.activity.id },
      { yes: true },
    );
    expect(deleted.ok).toBe(true);

    const afterDelete = await service.listActivities({
      tripId: created.trip.id,
      stopId: created.stops[0].id,
    });
    expect(afterDelete.ok && afterDelete.activities.map((activity) => activity.title)).toEqual([
      'Balnakeil Beach',
    ]);
  });

  it('rejects duplicate activity ids when reordering activities', async () => {
    const { service, repositories } = createHarness();
    const created = await service.createTrip({
      name: 'NC500',
      stops: [{ name: 'Durness', place: { coordinates: { lat: 58.5689, lng: -4.7454 } } }],
    });
    if (!created.ok) throw new Error('Expected trip creation to pass.');

    const first = await service.createActivity({
      tripId: created.trip.id,
      stopId: created.stops[0].id,
      activity: { title: 'Smoo Cave' },
    });
    const second = await service.createActivity({
      tripId: created.trip.id,
      stopId: created.stops[0].id,
      activity: { title: 'Balnakeil Beach' },
    });
    if (!first.ok || !second.ok) throw new Error('Expected activity creation to pass.');

    const repoState = repositories.get(created.trip.id);
    if (!repoState) throw new Error('Expected repository to exist.');
    repoState.reorderActivities.mockClear();

    const result = await service.reorderActivities({
      tripId: created.trip.id,
      stopId: created.stops[0].id,
      activityIds: [first.activity.id, second.activity.id, first.activity.id],
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'DUPLICATE_ACTIVITY_ID',
        message: `Duplicate activity id '${first.activity.id}'.`,
        path: 'activityIds[2]',
      },
    });
    expect(repoState.reorderActivities).not.toHaveBeenCalled();

    const after = await service.listActivities({
      tripId: created.trip.id,
      stopId: created.stops[0].id,
    });
    expect(after.ok && after.activities.map((activity) => activity.title)).toEqual([
      'Smoo Cave',
      'Balnakeil Beach',
    ]);
  });

  it('rejects malformed activity ids input with a validation error', async () => {
    const { service, repositories } = createHarness();
    const created = await service.createTrip({
      name: 'NC500',
      stops: [{ name: 'Durness', place: { coordinates: { lat: 58.5689, lng: -4.7454 } } }],
    });
    if (!created.ok) throw new Error('Expected trip creation to pass.');

    const activity = await service.createActivity({
      tripId: created.trip.id,
      stopId: created.stops[0].id,
      activity: { title: 'Smoo Cave' },
    });
    if (!activity.ok) throw new Error('Expected activity creation to pass.');

    const repoState = repositories.get(created.trip.id);
    if (!repoState) throw new Error('Expected repository to exist.');
    repoState.reorderActivities.mockClear();

    const result = await service.reorderActivities({
      tripId: created.trip.id,
      stopId: created.stops[0].id,
      activityIds: 'abc' as never,
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'ACTIVITY_IDS_REQUIRED',
        message: 'Provide at least one activity id.',
        path: 'activityIds',
      },
    });
    expect(repoState.reorderActivities).not.toHaveBeenCalled();
  });

  it('adds and deletes activity links with stable ordering', async () => {
    const { service } = createHarness();
    const created = await service.createTrip({
      name: 'NC500',
      stops: [{ name: 'Durness', place: { coordinates: { lat: 58.5689, lng: -4.7454 } } }],
    });
    if (!created.ok) throw new Error('Expected trip creation to pass.');

    const activity = await service.createActivity({
      tripId: created.trip.id,
      stopId: created.stops[0].id,
      activity: { title: 'Smoo Cave' },
    });
    if (!activity.ok) throw new Error('Expected activity creation to pass.');

    const firstLink = await service.addActivityLink({
      tripId: created.trip.id,
      activityId: activity.activity.id,
      url: 'https://www.visitscotland.com/info/see-do/smoo-cave-p245811',
    });
    const secondLink = await service.addActivityLink({
      tripId: created.trip.id,
      activityId: activity.activity.id,
      url: 'https://en.wikipedia.org/wiki/Smoo_Cave',
    });

    expect(firstLink.ok).toBe(true);
    expect(secondLink.ok).toBe(true);

    const tripWithActivities = await service.getTrip({
      tripId: created.trip.id,
      includeActivities: true,
      includeLinks: true,
    });
    if (!tripWithActivities.ok) throw new Error('Expected trip load to pass.');
    const links = tripWithActivities.trip.activitiesByStopId?.[created.stops[0].id]?.[0]?.links ?? [];

    const deleted = await service.deleteActivityLink({
      tripId: created.trip.id,
      activityId: activity.activity.id,
      linkId: links[0].id,
    });

    expect(deleted.ok).toBe(true);
    const afterDelete = await service.getTrip({
      tripId: created.trip.id,
      includeActivities: true,
      includeLinks: true,
    });
    expect(afterDelete.ok && afterDelete.trip.activitiesByStopId?.[created.stops[0].id]?.[0]?.links).toMatchObject([
      {
        url: 'https://en.wikipedia.org/wiki/Smoo_Cave',
        sortOrder: 0,
      },
    ]);
  });

  it('does not add duplicate activity links after enrichment canonicalizes the URL', async () => {
    const enrichLink = vi.fn(async (_url: string, sortOrder: number) => ({
      id: `link-${sortOrder}`,
      title: 'Smoo Cave',
      url: 'https://maps.apple.com/place?coordinate=58.5634%2C-4.7212&name=Smoo%20Cave',
      domain: 'maps.apple.com',
      sortOrder,
    }));
    const { service } = createHarness({ enrichLink });
    const created = await service.createTrip({
      name: 'NC500',
      stops: [{ name: 'Durness', place: { coordinates: { lat: 58.5689, lng: -4.7454 } } }],
    });
    if (!created.ok) throw new Error('Expected trip creation to pass.');

    const activity = await service.createActivity({
      tripId: created.trip.id,
      stopId: created.stops[0].id,
      activity: { title: 'Smoo Cave' },
    });
    if (!activity.ok) throw new Error('Expected activity creation to pass.');

    await service.addActivityLink({
      tripId: created.trip.id,
      activityId: activity.activity.id,
      url: 'https://maps.apple.com/?q=Smoo%20Cave',
    });
    const duplicate = await service.addActivityLink({
      tripId: created.trip.id,
      activityId: activity.activity.id,
      url: 'https://maps.apple.com/?q=Smoo%20Cave',
    });

    expect(duplicate.ok).toBe(true);
    expect(duplicate.ok && duplicate.summary).toContain('already exists');
    expect(duplicate.ok && duplicate.changed.linksAdded).toEqual([]);
    const trip = await service.getTrip({
      tripId: created.trip.id,
      includeActivities: true,
      includeLinks: true,
    });
    expect(trip.ok && trip.trip.activitiesByStopId?.[created.stops[0].id]?.[0]?.links).toHaveLength(1);
  });
});
