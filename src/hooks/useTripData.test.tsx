import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createActivity as createActivityModel } from '../domain/activities';
import { createDestination } from '../domain/destinations';
import { createRouteKey, createRouteLeg } from '../domain/routeLegs';
import { standardRoutingVehicle } from '../domain/vehiclePresets';
import { createTripDb } from '../storage/tripDb';
import { createTripRepository } from '../storage/tripRepository';
import { useTripData } from './useTripData';

type TripRepository = ReturnType<typeof createTripRepository>;

describe('useTripData', () => {
  const testDatabases: Array<{ db: ReturnType<typeof createTripDb>; name: string }> = [];

  afterEach(async () => {
    for (const { db, name } of testDatabases) {
      db.close();
      await Dexie.delete(name);
    }
    testDatabases.length = 0;
  });

  function createTestRepository() {
    const name = `world-tour-hook-test-${crypto.randomUUID()}`;
    const db = createTripDb(name);
    testDatabases.push({ db, name });
    return createTripRepository(db);
  }

  it('adds, updates, and deletes a destination', async () => {
    const repository = createTestRepository();
    const { result } = renderHook(() => useTripData(repository));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.addDestination({
        name: 'Durmitor',
        countryRegion: 'Montenegro',
        coordinates: { lat: 43.1306, lng: 19.0342 },
      });
    });

    expect(result.current.destinations[0].name).toBe('Durmitor');

    await act(async () => {
      await result.current.updateDestination(result.current.destinations[0].id, {
        tags: ['mountains'],
      });
    });

    expect(result.current.destinations[0].tags).toEqual(['mountains']);

    await act(async () => {
      await result.current.deleteDestination(result.current.destinations[0].id);
    });

    expect(result.current.destinations).toEqual([]);
  });

  it('loads activities for loaded destinations', async () => {
    const repository = createTestRepository();
    const destination = createDestination({
      name: 'Paris',
      coordinates: { lat: 48.8566, lng: 2.3522 },
    });

    await repository.saveDestination(destination);
    await repository.createActivity({
      destinationId: destination.id,
      title: 'Louvre',
    });

    const { result } = renderHook(() => useTripData(repository));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.activitiesByDestinationId[destination.id].map((activity) => activity.title)).toEqual([
      'Louvre',
    ]);
  });

  it('adds, updates, reorders, and deletes activities through hook actions', async () => {
    const repository = createTestRepository();
    const { result } = renderHook(() => useTripData(repository));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let destinationId = '';
    await act(async () => {
      const destination = await result.current.addDestination({
        name: 'Paris',
        countryRegion: 'France',
        coordinates: { lat: 48.8566, lng: 2.3522 },
      });
      destinationId = destination.id;
    });

    let louvreId = '';
    let bakeryId = '';
    await act(async () => {
      const louvre = await result.current.createActivity({
        destinationId,
        title: 'Louvre',
      });
      const bakery = await result.current.createActivity({
        destinationId,
        title: 'Bakery crawl',
      });
      louvreId = louvre.id;
      bakeryId = bakery.id;
    });

    await act(async () => {
      await result.current.updateActivity(louvreId, { title: 'Morning Louvre' });
      await result.current.reorderActivities(destinationId, [bakeryId, louvreId]);
    });

    expect(result.current.activitiesByDestinationId[destinationId].map((activity) => activity.title)).toEqual([
      'Bakery crawl',
      'Morning Louvre',
    ]);

    expect((await repository.listActivities(destinationId)).map((activity) => activity.title)).toEqual([
      'Bakery crawl',
      'Morning Louvre',
    ]);

    await act(async () => {
      await result.current.deleteActivity(bakeryId);
    });

    expect(result.current.activitiesByDestinationId[destinationId].map((activity) => activity.title)).toEqual([
      'Morning Louvre',
    ]);
    expect((await repository.listActivities(destinationId)).map((activity) => activity.title)).toEqual([
      'Morning Louvre',
    ]);
  });

  it('forwards activity location details when creating activities through hook actions', async () => {
    const destination = createDestination({
      name: 'Paris',
      coordinates: { lat: 48.8566, lng: 2.3522 },
    });
    const location = {
      name: 'Louvre Museum',
      address: 'Rue de Rivoli',
      coordinates: { lat: 48.8606, lng: 2.3364 },
      sourceProvider: 'maptiler' as const,
      sourceFeatureId: 'poi.123',
    };
    const createActivity = vi.fn(async (input: Parameters<TripRepository['createActivity']>[0]) =>
      createActivityModel({
        destinationId: input.destinationId,
        title: input.title,
        order: input.order,
        location: input.location,
      }),
    );
    const repository = createMemoryRepository(Promise.resolve([destination]), {
      createActivity,
    });
    const { result } = renderHook(() => useTripData(repository));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.createActivity({
        destinationId: destination.id,
        title: 'Louvre',
        location,
      });
    });

    expect(createActivity).toHaveBeenCalledWith({
      destinationId: destination.id,
      title: 'Louvre',
      location,
    });
  });

  it('clears activity state when deleting a destination', async () => {
    const repository = createTestRepository();
    const { result } = renderHook(() => useTripData(repository));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let destinationId = '';
    await act(async () => {
      const destination = await result.current.addDestination({
        name: 'Paris',
        countryRegion: 'France',
        coordinates: { lat: 48.8566, lng: 2.3522 },
      });
      destinationId = destination.id;
      await result.current.createActivity({
        destinationId,
        title: 'Louvre',
      });
    });

    expect(result.current.activitiesByDestinationId[destinationId]).toHaveLength(1);

    await act(async () => {
      await result.current.deleteDestination(destinationId);
    });

    expect(result.current.activitiesByDestinationId).not.toHaveProperty(destinationId);
  });

  it('updates a destination through an action object captured before the destination was added', async () => {
    const repository = createTestRepository();
    const { result } = renderHook(() => useTripData(repository));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const capturedActions = result.current;
    let addedDestinationId = '';

    await act(async () => {
      const added = await capturedActions.addDestination({
        name: 'Kotor',
        countryRegion: 'Montenegro',
        coordinates: { lat: 42.4247, lng: 18.7712 },
      });
      addedDestinationId = added.id;
      await capturedActions.updateDestination(added.id, {
        tags: ['bay'],
      });
    });

    expect(result.current.destinations[0].id).toBe(addedDestinationId);
    expect(result.current.destinations[0].tags).toEqual(['bay']);
  });

  it('adds and deletes an automatic route leg', async () => {
    const repository = createTestRepository();
    const { result } = renderHook(() => useTripData(repository));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let originDestinationId = '';
    let targetDestinationId = '';

    await act(async () => {
      const origin = await result.current.addDestination({
        name: 'Durmitor',
        countryRegion: 'Montenegro',
        coordinates: { lat: 43.1306, lng: 19.0342 },
      });
      const target = await result.current.addDestination({
        name: 'Kotor',
        countryRegion: 'Montenegro',
        coordinates: { lat: 42.4247, lng: 18.7712 },
      });
      originDestinationId = origin.id;
      targetDestinationId = target.id;
    });

    const [routeLeg] = result.current.routeLegs;

    expect(result.current.routeLegs).toMatchObject([
      {
        id: routeLeg.id,
        originDestinationId,
        targetDestinationId,
        type: 'driving-auto',
        status: 'pending',
      },
    ]);

    await act(async () => {
      await result.current.deleteRouteLeg(routeLeg.id);
    });

    expect(result.current.routeLegs).toEqual([]);
  });

  it('automatically creates and calculates a driving route leg between adjacent destinations', async () => {
    const repository = createTestRepository();
    const calculateRoute = vi.fn().mockResolvedValue({
      distanceKm: 123.4,
      travelTimeHours: 2.5,
      geometry: {
        type: 'LineString',
        coordinates: [
          [19.0342, 43.1306],
          [18.7712, 42.4247],
        ],
      },
      provider: 'openrouteservice',
      profile: 'driving-car',
      sections: [{ kind: 'road', startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 123.4 }],
    });
    const { result } = renderHook(() => useTripData(repository, { calculateRoute }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.addDestination({
        name: 'Durmitor',
        countryRegion: 'Montenegro',
        coordinates: { lat: 43.1306, lng: 19.0342 },
      });
      await result.current.addDestination({
        name: 'Kotor',
        countryRegion: 'Montenegro',
        coordinates: { lat: 42.4247, lng: 18.7712 },
      });
    });

    expect(calculateRoute).toHaveBeenCalledWith({
      origin: { lat: 43.1306, lng: 19.0342 },
      target: { lat: 42.4247, lng: 18.7712 },
      profile: 'driving-car',
      routingVehicle: standardRoutingVehicle,
      waypoints: [],
      ferryPolicy: 'allow',
    });
    expect(result.current.routeLegs).toMatchObject([
      {
        type: 'driving-auto',
        status: 'ready',
        distanceKm: 123.4,
        travelTimeHours: 2.5,
        provider: 'openrouteservice',
        profile: 'driving-car',
      },
    ]);
  });

  it('saves selected ready route geometry without recalculating it', async () => {
    const repository = createTestRepository();
    const calculateRoute = vi.fn().mockResolvedValue({
      distanceKm: 123.4,
      travelTimeHours: 2.5,
      geometry: {
        type: 'LineString',
        coordinates: [
          [19.0342, 43.1306],
          [18.7712, 42.4247],
        ],
      },
      provider: 'openrouteservice',
      profile: 'driving-car',
      sections: [{ kind: 'road', startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 123.4 }],
    });
    const selectedGeometry = {
      type: 'LineString' as const,
      coordinates: [
        [19.0342, 43.1306],
        [18.9, 42.9],
        [18.7712, 42.4247],
      ],
    };
    const selectedCalculatedAt = '2026-07-04T12:00:00.000Z';
    const { result } = renderHook(() => useTripData(repository, { calculateRoute }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.addDestination({
        name: 'Durmitor',
        countryRegion: 'Montenegro',
        coordinates: { lat: 43.1306, lng: 19.0342 },
      });
      await result.current.addDestination({
        name: 'Kotor',
        countryRegion: 'Montenegro',
        coordinates: { lat: 42.4247, lng: 18.7712 },
      });
    });

    const [routeLeg] = result.current.routeLegs;
    calculateRoute.mockClear();

    await act(async () => {
      await result.current.updateRouteLeg(routeLeg.id, {
        type: 'driving-auto',
        status: 'ready',
        distanceKm: 140,
        travelTimeHours: 3.1,
        geometry: selectedGeometry,
        provider: 'openrouteservice',
        profile: 'driving-car',
        sections: [{ kind: 'road', startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 123.4 }],
        routeKey: 'selected-alternative-key',
        calculatedAt: selectedCalculatedAt,
        error: undefined,
      });
    });

    expect(calculateRoute).not.toHaveBeenCalled();
    expect(result.current.routeLegs[0]).toMatchObject({
      id: routeLeg.id,
      type: 'driving-auto',
      status: 'ready',
      distanceKm: 140,
      travelTimeHours: 3.1,
      geometry: selectedGeometry,
      provider: 'openrouteservice',
      profile: 'driving-car',
      routeKey: 'selected-alternative-key',
      calculatedAt: selectedCalculatedAt,
      error: undefined,
    });
  });

  it('recalculates incomplete ready route legs without calculatedAt', async () => {
    const repository = createTestRepository();
    const calculateRoute = vi
      .fn()
      .mockResolvedValueOnce({
        distanceKm: 123.4,
        travelTimeHours: 2.5,
        geometry: {
          type: 'LineString',
          coordinates: [
            [19.0342, 43.1306],
            [18.7712, 42.4247],
          ],
        },
        provider: 'openrouteservice',
        profile: 'driving-car',
        sections: [{ kind: 'road', startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 123.4 }],
      })
      .mockResolvedValueOnce({
        distanceKm: 141.2,
        travelTimeHours: 3.2,
        geometry: {
          type: 'LineString',
          coordinates: [
            [19.0342, 43.1306],
            [18.8, 42.8],
            [18.7712, 42.4247],
          ],
        },
        provider: 'openrouteservice',
        profile: 'driving-car',
        sections: [{ kind: 'road', startGeometryIndex: 0, endGeometryIndex: 2, distanceKm: 141.2 }],
      });
    const selectedGeometry = {
      type: 'LineString' as const,
      coordinates: [
        [19.0342, 43.1306],
        [18.9, 42.9],
        [18.7712, 42.4247],
      ],
    };
    const { result } = renderHook(() => useTripData(repository, { calculateRoute }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.addDestination({
        name: 'Durmitor',
        countryRegion: 'Montenegro',
        coordinates: { lat: 43.1306, lng: 19.0342 },
      });
      await result.current.addDestination({
        name: 'Kotor',
        countryRegion: 'Montenegro',
        coordinates: { lat: 42.4247, lng: 18.7712 },
      });
    });

    const [routeLeg] = result.current.routeLegs;
    calculateRoute.mockClear();

    await act(async () => {
      await result.current.updateRouteLeg(routeLeg.id, {
        type: 'driving-auto',
        status: 'ready',
        distanceKm: 140,
        travelTimeHours: 3.1,
        geometry: selectedGeometry,
        provider: 'openrouteservice',
        profile: 'driving-car',
        routeKey: 'selected-alternative-key',
        calculatedAt: undefined,
        error: undefined,
      });
    });

    expect(calculateRoute).toHaveBeenCalledTimes(1);
    expect(result.current.routeLegs[0]).toMatchObject({
      id: routeLeg.id,
      type: 'driving-auto',
      status: 'ready',
      distanceKm: 141.2,
      travelTimeHours: 3.2,
      geometry: {
        type: 'LineString',
        coordinates: [
          [19.0342, 43.1306],
          [18.8, 42.8],
          [18.7712, 42.4247],
        ],
      },
      provider: 'openrouteservice',
      profile: 'driving-car',
      sections: [{ kind: 'road', startGeometryIndex: 0, endGeometryIndex: 2, distanceKm: 141.2 }],
    });
  });

  it('recalculates ready route legs with errors during route reconciliation', async () => {
    const repository = createTestRepository();
    const origin = createDestination({
      name: 'Durmitor',
      countryRegion: 'Montenegro',
      coordinates: { lat: 43.1306, lng: 19.0342 },
      order: 0,
    });
    const target = createDestination({
      name: 'Kotor',
      countryRegion: 'Montenegro',
      coordinates: { lat: 42.4247, lng: 18.7712 },
      order: 1,
    });
    const routeLeg = createRouteLeg({
      originDestinationId: origin.id,
      targetDestinationId: target.id,
      type: 'driving-auto',
      status: 'ready',
      distanceKm: 123.4,
      travelTimeHours: 2.5,
      geometry: {
        type: 'LineString',
        coordinates: [
          [19.0342, 43.1306],
          [18.7712, 42.4247],
        ],
      },
      provider: 'openrouteservice',
      profile: 'driving-car',
      sections: [{ kind: 'road', startGeometryIndex: 0, endGeometryIndex: 2, distanceKm: 142.6 }],
      routeKey: createRouteKey({
        origin: origin.coordinates,
        target: target.coordinates,
        profile: 'driving-car',
      }),
      calculatedAt: '2026-07-04T12:00:00.000Z',
      error: 'Route option failed after selection.',
    });
    await repository.saveDestination(origin);
    await repository.saveDestination(target);
    await repository.saveRouteLeg(routeLeg);
    const calculateRoute = vi.fn().mockResolvedValue({
      distanceKm: 142.6,
      travelTimeHours: 3.3,
      geometry: {
        type: 'LineString',
        coordinates: [
          [19.0342, 43.1306],
          [18.7, 42.7],
          [18.7712, 42.4247],
        ],
      },
      provider: 'openrouteservice',
      profile: 'driving-car',
      sections: [{ kind: 'road', startGeometryIndex: 0, endGeometryIndex: 2, distanceKm: 142.6 }],
    });
    const { result } = renderHook(() => useTripData(repository, { calculateRoute }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.reorderDestinations([origin.id, target.id]);
    });

    expect(calculateRoute).toHaveBeenCalledTimes(1);
    expect(result.current.routeLegs[0]).toMatchObject({
      status: 'ready',
      distanceKm: 142.6,
      travelTimeHours: 3.3,
      geometry: {
        type: 'LineString',
        coordinates: [
          [19.0342, 43.1306],
          [18.7, 42.7],
          [18.7712, 42.4247],
        ],
      },
      provider: 'openrouteservice',
      profile: 'driving-car',
      error: undefined,
    });
  });

  it('recalculates selected ready route patches that omit required route data', async () => {
    const repository = createTestRepository();
    const calculateRoute = vi
      .fn()
      .mockResolvedValueOnce({
        distanceKm: 123.4,
        travelTimeHours: 2.5,
        geometry: {
          type: 'LineString',
          coordinates: [
            [19.0342, 43.1306],
            [18.7712, 42.4247],
          ],
        },
        provider: 'openrouteservice',
        profile: 'driving-car',
        sections: [{ kind: 'road', startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 123.4 }],
      })
      .mockResolvedValueOnce({
        distanceKm: 143.7,
        travelTimeHours: 3.4,
        geometry: {
          type: 'LineString',
          coordinates: [
            [19.0342, 43.1306],
            [18.6, 42.6],
            [18.7712, 42.4247],
          ],
        },
        provider: 'openrouteservice',
        profile: 'driving-car',
        sections: [{ kind: 'road', startGeometryIndex: 0, endGeometryIndex: 2, distanceKm: 143.7 }],
      });
    const selectedGeometry = {
      type: 'LineString' as const,
      coordinates: [
        [19.0342, 43.1306],
        [18.9, 42.9],
        [18.7712, 42.4247],
      ],
    };
    const { result } = renderHook(() => useTripData(repository, { calculateRoute }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.addDestination({
        name: 'Durmitor',
        countryRegion: 'Montenegro',
        coordinates: { lat: 43.1306, lng: 19.0342 },
      });
      await result.current.addDestination({
        name: 'Kotor',
        countryRegion: 'Montenegro',
        coordinates: { lat: 42.4247, lng: 18.7712 },
      });
    });

    const [routeLeg] = result.current.routeLegs;

    await act(async () => {
      await result.current.updateRouteLeg(routeLeg.id, {
        type: 'driving-auto',
        status: 'ready',
        distanceKm: 140,
        travelTimeHours: 3.1,
        geometry: selectedGeometry,
        provider: 'openrouteservice',
        profile: 'driving-car',
        routeKey: 'selected-alternative-key',
        calculatedAt: '2026-07-04T12:00:00.000Z',
        error: undefined,
      });
    });

    calculateRoute.mockClear();

    await act(async () => {
      await result.current.updateRouteLeg(routeLeg.id, {
        type: 'driving-auto',
        status: 'ready',
        distanceKm: 144,
        travelTimeHours: 3.5,
        provider: 'openrouteservice',
        profile: 'driving-car',
        routeKey: 'incomplete-selected-alternative-key',
        calculatedAt: '2026-07-04T13:00:00.000Z',
        error: undefined,
      });
    });

    expect(calculateRoute).toHaveBeenCalledTimes(1);
    expect(result.current.routeLegs[0]).toMatchObject({
      id: routeLeg.id,
      type: 'driving-auto',
      status: 'ready',
      distanceKm: 143.7,
      travelTimeHours: 3.4,
      geometry: {
        type: 'LineString',
        coordinates: [
          [19.0342, 43.1306],
          [18.6, 42.6],
          [18.7712, 42.4247],
        ],
      },
      provider: 'openrouteservice',
      profile: 'driving-car',
      routeKey: createRouteKey({
        origin: { lat: 43.1306, lng: 19.0342 },
        target: { lat: 42.4247, lng: 18.7712 },
      }),
    });
  });

  it('recalculates status-ready route patches without type that omit required route data', async () => {
    const repository = createTestRepository();
    const calculateRoute = vi
      .fn()
      .mockResolvedValueOnce({
        distanceKm: 123.4,
        travelTimeHours: 2.5,
        geometry: {
          type: 'LineString',
          coordinates: [
            [19.0342, 43.1306],
            [18.7712, 42.4247],
          ],
        },
        provider: 'openrouteservice',
        profile: 'driving-car',
        sections: [{ kind: 'road', startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 123.4 }],
      })
      .mockResolvedValueOnce({
        distanceKm: 146.9,
        travelTimeHours: 3.7,
        geometry: {
          type: 'LineString',
          coordinates: [
            [19.0342, 43.1306],
            [18.4, 42.4],
            [18.7712, 42.4247],
          ],
        },
        provider: 'openrouteservice',
        profile: 'driving-car',
        sections: [{ kind: 'road', startGeometryIndex: 0, endGeometryIndex: 2, distanceKm: 146.9 }],
      });
    const selectedGeometry = {
      type: 'LineString' as const,
      coordinates: [
        [19.0342, 43.1306],
        [18.9, 42.9],
        [18.7712, 42.4247],
      ],
    };
    const { result } = renderHook(() => useTripData(repository, { calculateRoute }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.addDestination({
        name: 'Durmitor',
        countryRegion: 'Montenegro',
        coordinates: { lat: 43.1306, lng: 19.0342 },
      });
      await result.current.addDestination({
        name: 'Kotor',
        countryRegion: 'Montenegro',
        coordinates: { lat: 42.4247, lng: 18.7712 },
      });
    });

    const [routeLeg] = result.current.routeLegs;

    await act(async () => {
      await result.current.updateRouteLeg(routeLeg.id, {
        type: 'driving-auto',
        status: 'ready',
        distanceKm: 140,
        travelTimeHours: 3.1,
        geometry: selectedGeometry,
        provider: 'openrouteservice',
        profile: 'driving-car',
        routeKey: 'selected-alternative-key',
        calculatedAt: '2026-07-04T12:00:00.000Z',
        error: undefined,
      });
    });

    calculateRoute.mockClear();

    await act(async () => {
      await result.current.updateRouteLeg(routeLeg.id, {
        status: 'ready',
        distanceKm: 146,
        travelTimeHours: 3.7,
        provider: 'openrouteservice',
        profile: 'driving-car',
        routeKey: 'incomplete-selected-alternative-without-type-key',
        calculatedAt: '2026-07-04T13:00:00.000Z',
        error: undefined,
      });
    });

    expect(calculateRoute).toHaveBeenCalledTimes(1);
    expect(result.current.routeLegs[0]).toMatchObject({
      id: routeLeg.id,
      type: 'driving-auto',
      status: 'ready',
      distanceKm: 146.9,
      travelTimeHours: 3.7,
      geometry: {
        type: 'LineString',
        coordinates: [
          [19.0342, 43.1306],
          [18.4, 42.4],
          [18.7712, 42.4247],
        ],
      },
      provider: 'openrouteservice',
      profile: 'driving-car',
      routeKey: createRouteKey({
        origin: { lat: 43.1306, lng: 19.0342 },
        target: { lat: 42.4247, lng: 18.7712 },
      }),
    });
  });

  it('recalculates selected ready route patches with non-driving profiles', async () => {
    const repository = createTestRepository();
    const calculateRoute = vi
      .fn()
      .mockResolvedValueOnce({
        distanceKm: 123.4,
        travelTimeHours: 2.5,
        geometry: {
          type: 'LineString',
          coordinates: [
            [19.0342, 43.1306],
            [18.7712, 42.4247],
          ],
        },
        provider: 'openrouteservice',
        profile: 'driving-car',
        sections: [{ kind: 'road', startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 123.4 }],
      })
      .mockResolvedValueOnce({
        distanceKm: 145.8,
        travelTimeHours: 3.6,
        geometry: {
          type: 'LineString',
          coordinates: [
            [19.0342, 43.1306],
            [18.5, 42.5],
            [18.7712, 42.4247],
          ],
        },
        provider: 'openrouteservice',
        profile: 'driving-car',
        sections: [{ kind: 'road', startGeometryIndex: 0, endGeometryIndex: 2, distanceKm: 145.8 }],
      });
    const selectedGeometry = {
      type: 'LineString' as const,
      coordinates: [
        [19.0342, 43.1306],
        [18.9, 42.9],
        [18.7712, 42.4247],
      ],
    };
    const { result } = renderHook(() => useTripData(repository, { calculateRoute }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.addDestination({
        name: 'Durmitor',
        countryRegion: 'Montenegro',
        coordinates: { lat: 43.1306, lng: 19.0342 },
      });
      await result.current.addDestination({
        name: 'Kotor',
        countryRegion: 'Montenegro',
        coordinates: { lat: 42.4247, lng: 18.7712 },
      });
    });

    const [routeLeg] = result.current.routeLegs;
    calculateRoute.mockClear();

    await act(async () => {
      await result.current.updateRouteLeg(routeLeg.id, {
        type: 'driving-auto',
        status: 'ready',
        distanceKm: 140,
        travelTimeHours: 3.1,
        geometry: selectedGeometry,
        provider: 'openrouteservice',
        profile: 'cycling-regular',
        routeKey: 'selected-cycling-alternative-key',
        calculatedAt: '2026-07-04T12:00:00.000Z',
        error: undefined,
      });
    });

    expect(calculateRoute).toHaveBeenCalledTimes(1);
    expect(result.current.routeLegs[0]).toMatchObject({
      id: routeLeg.id,
      type: 'driving-auto',
      status: 'ready',
      distanceKm: 145.8,
      travelTimeHours: 3.6,
      geometry: {
        type: 'LineString',
        coordinates: [
          [19.0342, 43.1306],
          [18.5, 42.5],
          [18.7712, 42.4247],
        ],
      },
      provider: 'openrouteservice',
      profile: 'driving-car',
      routeKey: createRouteKey({
        origin: { lat: 43.1306, lng: 19.0342 },
        target: { lat: 42.4247, lng: 18.7712 },
      }),
    });
  });

  it('clears invalid selected route data when recalculation fails', async () => {
    const repository = createTestRepository();
    const calculateRoute = vi
      .fn()
      .mockResolvedValueOnce({
        distanceKm: 123.4,
        travelTimeHours: 2.5,
        geometry: {
          type: 'LineString',
          coordinates: [
            [19.0342, 43.1306],
            [18.7712, 42.4247],
          ],
        },
        provider: 'openrouteservice',
        profile: 'driving-car',
        sections: [{ kind: 'road', startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 123.4 }],
      })
      .mockRejectedValueOnce(new Error('Route calculation failed'));
    const selectedGeometry = {
      type: 'LineString' as const,
      coordinates: [
        [19.0342, 43.1306],
        [18.9, 42.9],
        [18.7712, 42.4247],
      ],
    };
    const { result } = renderHook(() => useTripData(repository, { calculateRoute }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.addDestination({
        name: 'Durmitor',
        countryRegion: 'Montenegro',
        coordinates: { lat: 43.1306, lng: 19.0342 },
      });
      await result.current.addDestination({
        name: 'Kotor',
        countryRegion: 'Montenegro',
        coordinates: { lat: 42.4247, lng: 18.7712 },
      });
    });

    const [routeLeg] = result.current.routeLegs;
    calculateRoute.mockClear();

    await act(async () => {
      await result.current.updateRouteLeg(routeLeg.id, {
        type: 'driving-auto',
        status: 'ready',
        distanceKm: 140,
        travelTimeHours: 3.1,
        geometry: selectedGeometry,
        provider: 'openrouteservice',
        profile: 'cycling-regular',
        routeKey: 'selected-cycling-alternative-key',
        calculatedAt: '2026-07-04T12:00:00.000Z',
        error: undefined,
      });
    });

    expect(calculateRoute).toHaveBeenCalledTimes(1);
    expect(result.current.routeLegs[0]).toMatchObject({
      id: routeLeg.id,
      type: 'driving-auto',
      status: 'failed',
      distanceKm: undefined,
      travelTimeHours: undefined,
      geometry: undefined,
      provider: undefined,
      profile: 'driving-car',
      routeKey: createRouteKey({
        origin: { lat: 43.1306, lng: 19.0342 },
        target: { lat: 42.4247, lng: 18.7712 },
      }),
      calculatedAt: undefined,
      error: 'Route calculation failed',
    });
  });

  it('recalculates affected driving route legs after destination coordinates change', async () => {
    const repository = createTestRepository();
    const calculateRoute = vi
      .fn()
      .mockResolvedValueOnce({
        distanceKm: 123.4,
        travelTimeHours: 2.5,
        geometry: {
          type: 'LineString',
          coordinates: [
            [19.0342, 43.1306],
            [18.7712, 42.4247],
          ],
        },
        provider: 'openrouteservice',
        profile: 'driving-car',
        sections: [{ kind: 'road', startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 123.4 }],
      })
      .mockResolvedValueOnce({
        distanceKm: 125.6,
        travelTimeHours: 2.7,
        geometry: {
          type: 'LineString',
          coordinates: [
            [19.045, 43.14],
            [18.7712, 42.4247],
          ],
        },
        provider: 'openrouteservice',
        profile: 'driving-car',
        sections: [{ kind: 'road', startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 125.6 }],
      });
    const { result } = renderHook(() => useTripData(repository, { calculateRoute }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.addDestination({
        name: 'Durmitor',
        countryRegion: 'Montenegro',
        coordinates: { lat: 43.1306, lng: 19.0342 },
      });
      await result.current.addDestination({
        name: 'Kotor',
        countryRegion: 'Montenegro',
        coordinates: { lat: 42.4247, lng: 18.7712 },
      });
    });

    const [origin] = result.current.destinations;

    await act(async () => {
      await result.current.updateDestination(origin.id, {
        coordinates: { lat: 43.14, lng: 19.045 },
      });
    });

    expect(calculateRoute).toHaveBeenLastCalledWith({
      origin: { lat: 43.14, lng: 19.045 },
      target: { lat: 42.4247, lng: 18.7712 },
      profile: 'driving-car',
      routingVehicle: standardRoutingVehicle,
      waypoints: [],
      ferryPolicy: 'allow',
    });
    expect(result.current.routeLegs[0]).toMatchObject({
      status: 'ready',
      distanceKm: 125.6,
      travelTimeHours: 2.7,
      geometry: {
        type: 'LineString',
        coordinates: [
          [19.045, 43.14],
          [18.7712, 42.4247],
        ],
      },
    });
  });

  it('reorders destinations and recalculates adjacent route legs', async () => {
    const repository = createTestRepository();
    const { result } = renderHook(() => useTripData(repository));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.addDestination({
        name: 'First',
        coordinates: { lat: 1, lng: 1 },
      });
      await result.current.addDestination({
        name: 'Second',
        coordinates: { lat: 2, lng: 2 },
      });
      await result.current.addDestination({
        name: 'Third',
        coordinates: { lat: 3, lng: 3 },
      });
    });

    const [first, second, third] = result.current.destinations;

    await act(async () => {
      await result.current.reorderDestinations([third.id, first.id, second.id]);
    });

    expect(result.current.destinations.map((destination) => destination.name)).toEqual([
      'Third',
      'First',
      'Second',
    ]);
    expect(result.current.destinations.map((destination) => destination.order)).toEqual([0, 1, 2]);
    expect(result.current.routeLegs.map((leg) => [leg.originDestinationId, leg.targetDestinationId])).toEqual([
      [third.id, first.id],
      [first.id, second.id],
    ]);
  });

  it('deletes route legs that no longer match adjacent destinations after reorder', async () => {
    const repository = createTestRepository();
    const { result } = renderHook(() => useTripData(repository));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.addDestination({
        name: 'First',
        coordinates: { lat: 1, lng: 1 },
      });
      await result.current.addDestination({
        name: 'Second',
        coordinates: { lat: 2, lng: 2 },
      });
      await result.current.addDestination({
        name: 'Third',
        coordinates: { lat: 3, lng: 3 },
      });
    });

    const [first, second, third] = result.current.destinations;

    await act(async () => {
      await result.current.reorderDestinations([third.id, first.id, second.id]);
    });

    const persistedRoutePairs = (await repository.listRouteLegs())
      .map((leg) => `${leg.originDestinationId}:${leg.targetDestinationId}`)
      .sort();
    expect(persistedRoutePairs).toEqual([
      `${first.id}:${second.id}`,
      `${third.id}:${first.id}`,
    ].sort());
  });

  it('removes persisted non-adjacent route legs missing from local state', async () => {
    const first = createDestination({ name: 'First', coordinates: { lat: 1, lng: 1 }, order: 0 });
    const second = createDestination({ name: 'Second', coordinates: { lat: 2, lng: 2 }, order: 1 });
    const third = createDestination({ name: 'Third', coordinates: { lat: 3, lng: 3 }, order: 2 });
    const firstToSecond = createRouteLeg({
      originDestinationId: first.id,
      targetDestinationId: second.id,
      type: 'driving-auto',
    });
    const secondToThird = createRouteLeg({
      originDestinationId: second.id,
      targetDestinationId: third.id,
      type: 'driving-auto',
    });
    const staleFirstToThird = createRouteLeg({
      originDestinationId: first.id,
      targetDestinationId: third.id,
      type: 'driving-auto',
    });
    const listRouteLegs = vi
      .fn()
      .mockResolvedValueOnce([firstToSecond, secondToThird])
      .mockResolvedValue([firstToSecond, secondToThird, staleFirstToThird]);
    const deleteRouteLeg = vi.fn(async () => {});
    const repository = createMemoryRepository(Promise.resolve([first, second, third]), {
      listRouteLegs,
      deleteRouteLeg,
    });
    const { result } = renderHook(() => useTripData(repository));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.reorderDestinations([first.id, second.id, third.id]);
    });

    expect(listRouteLegs).toHaveBeenCalledTimes(2);
    expect(deleteRouteLeg).toHaveBeenCalledWith(staleFirstToThird.id);
  });

  it('inserts new destinations at the best route position after the first stop', async () => {
    const repository = createTestRepository();
    const { result } = renderHook(() => useTripData(repository));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.addDestination({
        name: 'Balcombe',
        coordinates: { lat: 51.0576, lng: -0.1342 },
      });
      await result.current.addDestination({
        name: 'Liseleje',
        coordinates: { lat: 56.0111, lng: 11.9656 },
      });
      await result.current.addDestination({
        name: 'Paris',
        coordinates: { lat: 48.8566, lng: 2.3522 },
      });
    });

    const [balcombe, paris, liseleje] = result.current.destinations;

    expect(result.current.destinations.map((destination) => destination.name)).toEqual([
      'Balcombe',
      'Paris',
      'Liseleje',
    ]);
    expect(result.current.destinations.map((destination) => destination.order)).toEqual([0, 1, 2]);
    expect(result.current.routeLegs.map((leg) => [leg.originDestinationId, leg.targetDestinationId])).toEqual([
      [balcombe.id, paris.id],
      [paris.id, liseleje.id],
    ]);

    expect((await repository.listDestinations()).map((destination) => destination.name)).toEqual([
      'Balcombe',
      'Paris',
      'Liseleje',
    ]);
  });

  it('places Norway stops into the expected route order while keeping Oslo first', async () => {
    const repository = createTestRepository();
    const { result } = renderHook(() => useTripData(repository));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.addDestination({
        name: 'Oslo',
        coordinates: { lat: 59.9139, lng: 10.7522 },
      });
      await result.current.addDestination({
        name: 'Bodo',
        coordinates: { lat: 67.2804, lng: 14.4049 },
      });
      await result.current.addDestination({
        name: 'Trondheim',
        coordinates: { lat: 63.4305, lng: 10.3951 },
      });
      await result.current.addDestination({
        name: 'Bergen',
        coordinates: { lat: 60.3913, lng: 5.3221 },
      });
    });

    const [oslo, bergen, trondheim, bodo] = result.current.destinations;

    expect(result.current.destinations.map((destination) => destination.name)).toEqual([
      'Oslo',
      'Bergen',
      'Trondheim',
      'Bodo',
    ]);
    expect(result.current.destinations.map((destination) => destination.order)).toEqual([0, 1, 2, 3]);
    expect(result.current.routeLegs.map((leg) => [leg.originDestinationId, leg.targetDestinationId])).toEqual([
      [oslo.id, bergen.id],
      [bergen.id, trondheim.id],
      [trondheim.id, bodo.id],
    ]);
  });

  it('optimistically reorders destinations and shows pending route legs while persistence is in flight', async () => {
    const first = createDestination({
      name: 'First',
      coordinates: { lat: 1, lng: 1 },
      order: 0,
    });
    const second = createDestination({
      name: 'Second',
      coordinates: { lat: 2, lng: 2 },
      order: 1,
    });
    const third = createDestination({
      name: 'Third',
      coordinates: { lat: 3, lng: 3 },
      order: 2,
    });
    const saveDestination = createDeferred<void>(undefined);
    const repository = createMemoryRepository(Promise.resolve([first, second, third]), {
      saveDestination: () => saveDestination.promise,
    });
    const { result } = renderHook(() => useTripData(repository));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let reorderPromise: Promise<void>;

    await act(async () => {
      reorderPromise = result.current.reorderDestinations([third.id, first.id, second.id]);
      await Promise.resolve();
    });

    expect(result.current.destinations.map((destination) => destination.name)).toEqual([
      'Third',
      'First',
      'Second',
    ]);
    expect(result.current.routeLegs).toMatchObject([
      {
        originDestinationId: third.id,
        targetDestinationId: first.id,
        type: 'driving-auto',
        status: 'pending',
      },
      {
        originDestinationId: first.id,
        targetDestinationId: second.id,
        type: 'driving-auto',
        status: 'pending',
      },
    ]);

    await act(async () => {
      saveDestination.resolve();
      await reorderPromise;
    });
  });

  it('marks an automatic route leg as a manual shipping leg', async () => {
    const repository = createTestRepository();
    const { result } = renderHook(() => useTripData(repository));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.addDestination({
        name: 'Panama City',
        coordinates: { lat: 8.9824, lng: -79.5199 },
      });
      await result.current.addDestination({
        name: 'Cartagena',
        coordinates: { lat: 10.391, lng: -75.4794 },
      });
    });

    const [routeLeg] = result.current.routeLegs;

    await act(async () => {
      await result.current.updateRouteLeg(routeLeg.id, {
        type: 'shipping-manual',
        notes: 'Ship around the Darien Gap.',
      });
    });

    expect(result.current.routeLegs[0]).toMatchObject({
      id: routeLeg.id,
      type: 'shipping-manual',
      status: 'manual',
      notes: 'Ship around the Darien Gap.',
      geometry: {
        type: 'LineString',
        coordinates: [
          [-79.5199, 8.9824],
          [-75.4794, 10.391],
        ],
      },
    });
  });

  it('shows a failed route leg as pending while an explicit retry is in flight', async () => {
    const origin = createDestination({
      name: 'Ghent',
      coordinates: { lat: 51.0538, lng: 3.725 },
      order: 0,
    });
    const target = createDestination({
      name: 'Hamburg',
      coordinates: { lat: 53.5502, lng: 10.0013 },
      order: 1,
    });
    const failedLeg = createRouteLeg({
      originDestinationId: origin.id,
      targetDestinationId: target.id,
      type: 'driving-auto',
      status: 'failed',
      error: 'Load failed',
    });
    const routeCalculation = createDeferred({
      distanceKm: 610,
      travelTimeHours: 6.5,
      geometry: {
        type: 'LineString' as const,
        coordinates: [
          [origin.coordinates.lng, origin.coordinates.lat],
          [target.coordinates.lng, target.coordinates.lat],
        ],
      },
      provider: 'openrouteservice',
      profile: 'driving-car' as const,
      sections: [{ kind: 'road' as const, startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 610 }],
    });
    const repository = createMemoryRepository(Promise.resolve([origin, target]), {
      listRouteLegs: async () => [failedLeg],
    });
    const calculateRoute = vi.fn(() => routeCalculation.promise);
    const { result } = renderHook(() => useTripData(repository, { calculateRoute }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let retryPromise!: Promise<void>;
    await act(async () => {
      retryPromise = result.current.updateRouteLeg(failedLeg.id, { type: 'driving-auto' });
      await Promise.resolve();
    });

    expect(result.current.routeLegs[0]).toMatchObject({
      id: failedLeg.id,
      status: 'pending',
      error: undefined,
    });

    await act(async () => {
      routeCalculation.resolve();
      await retryPromise;
    });

    expect(result.current.routeLegs[0]).toMatchObject({
      id: failedLeg.id,
      status: 'ready',
      distanceKm: 610,
    });
  });

  it('removes attached route legs from state when deleting a destination', async () => {
    const repository = createTestRepository();
    const { result } = renderHook(() => useTripData(repository));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let originDestinationId = '';
    let targetDestinationId = '';

    await act(async () => {
      const origin = await result.current.addDestination({
        name: 'Durmitor',
        countryRegion: 'Montenegro',
        coordinates: { lat: 43.1306, lng: 19.0342 },
      });
      const target = await result.current.addDestination({
        name: 'Kotor',
        countryRegion: 'Montenegro',
        coordinates: { lat: 42.4247, lng: 18.7712 },
      });
      originDestinationId = origin.id;
      targetDestinationId = target.id;

    });

    expect(result.current.routeLegs).toHaveLength(1);

    await act(async () => {
      await result.current.deleteDestination(originDestinationId);
    });

    expect(result.current.destinations.map((destination) => destination.id)).toEqual([
      targetDestinationId,
    ]);
    expect(result.current.routeLegs).toEqual([]);
  });

  it('ignores stale reload results after the repository changes', async () => {
    const slowDestination = createDestination({
      name: 'Slow',
      coordinates: { lat: 1, lng: 1 },
    });
    const currentDestination = createDestination({
      name: 'Current',
      coordinates: { lat: 2, lng: 2 },
    });
    const slowDestinations = createDeferred([slowDestination]);
    const currentDestinations = createDeferred([currentDestination]);
    const slowRepository = createMemoryRepository(slowDestinations.promise);
    const currentRepository = createMemoryRepository(currentDestinations.promise);

    const { result, rerender } = renderHook(
      ({ repository }) => useTripData(repository),
      { initialProps: { repository: slowRepository } },
    );

    await waitFor(() => expect(slowRepository.destinationListCalls).toBe(1));

    rerender({ repository: currentRepository });

    await waitFor(() => expect(currentRepository.destinationListCalls).toBe(1));

    await act(async () => {
      currentDestinations.resolve();
    });

    await waitFor(() => expect(result.current.destinations[0].name).toBe('Current'));

    await act(async () => {
      slowDestinations.resolve();
    });

    expect(result.current.destinations[0].name).toBe('Current');
  });

  it('does not start the queued initial reload after fast unmount', async () => {
    const repository = createMemoryRepository(Promise.resolve([]));
    const { unmount } = renderHook(() => useTripData(repository));

    unmount();

    await act(async () => {
      await Promise.resolve();
    });

    expect(repository.destinationListCalls).toBe(0);
  });

  it('does not apply stale add destination results after the repository changes', async () => {
    const oldSave = createDeferred<void>(undefined);
    const oldRepository = createMemoryRepository(Promise.resolve([]), {
      saveDestination: () => oldSave.promise,
    });
    const newRepository = createMemoryRepository(Promise.resolve([]));
    const { result, rerender } = renderHook(
      ({ repository }) => useTripData(repository),
      { initialProps: { repository: oldRepository } },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const capturedActions = result.current;
    const addDestinationPromise = capturedActions.addDestination({
      name: 'Old repository destination',
      coordinates: { lat: 3, lng: 3 },
    });

    rerender({ repository: newRepository });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      oldSave.resolve();
      await addDestinationPromise;
    });

    expect(result.current.destinations).toEqual([]);
  });

  it('does not write stale activity actions after the repository changes', async () => {
    const destination = createDestination({
      name: 'Paris',
      coordinates: { lat: 48.8566, lng: 2.3522 },
    });
    const activity = createActivityModel({
      destinationId: destination.id,
      title: 'Louvre',
      order: 0,
    });
    const createActivity = vi.fn(async () =>
      createActivityModel({
        destinationId: destination.id,
        title: 'Bakery crawl',
        order: 1,
      }),
    );
    const updateActivity = vi.fn(async () => ({
      ...activity,
      title: 'Morning Louvre',
    }));
    const deleteActivity = vi.fn(async () => {});
    const reorderActivities = vi.fn(async () => [activity]);
    const oldRepository = createMemoryRepository(Promise.resolve([destination]), {
      listActivities: async () => [activity],
      createActivity,
      updateActivity,
      deleteActivity,
      reorderActivities,
    });
    const newRepository = createMemoryRepository(Promise.resolve([]));
    const { result, rerender } = renderHook(
      ({ repository }) => useTripData(repository),
      { initialProps: { repository: oldRepository } },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const capturedActions = result.current;

    rerender({ repository: newRepository });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await capturedActions.createActivity({
        destinationId: destination.id,
        title: 'Bakery crawl',
      });
      await capturedActions.updateActivity(activity.id, { title: 'Morning Louvre' });
      await capturedActions.deleteActivity(activity.id);
      await capturedActions.reorderActivities(destination.id, [activity.id]);
    });

    expect(createActivity).not.toHaveBeenCalled();
    expect(updateActivity).not.toHaveBeenCalled();
    expect(deleteActivity).not.toHaveBeenCalled();
    expect(reorderActivities).not.toHaveBeenCalled();
  });
});

function createDeferred<T>(value: T) {
  let resolve!: () => void;
  const promise = new Promise<T>((done) => {
    resolve = () => done(value);
  });

  return { promise, resolve };
}

function createMemoryRepository(
  destinations: Promise<ReturnType<typeof createDestination>[]>,
  overrides: Partial<TripRepository> = {},
): TripRepository & { destinationListCalls: number } {
  const repository = {
    destinationListCalls: 0,

    async listDestinations() {
      this.destinationListCalls += 1;
      return destinations;
    },

    async saveDestination() {},

    async deleteDestination() {},

    async listActivities() {
      return [];
    },

    async createActivity() {
      throw new Error('Activities are not supported by this test repository.');
    },

    async updateActivity() {
      throw new Error('Activity updates are not supported by this test repository.');
    },

    async deleteActivity() {
      throw new Error('Activity deletes are not supported by this test repository.');
    },

    async reorderActivities() {
      throw new Error('Activity reordering is not supported by this test repository.');
    },

    async listDestinationMedia() {
      return [];
    },

    async uploadDestinationMedia() {
      throw new Error('Media uploads are not supported by this test repository.');
    },

    async importDestinationMediaFromSearch() {
      throw new Error('Media imports are not supported by this test repository.');
    },

    async updateDestinationMedia() {
      throw new Error('Media updates are not supported by this test repository.');
    },

    async deleteDestinationMedia() {
      throw new Error('Media deletes are not supported by this test repository.');
    },

    async reorderDestinationMedia() {
      throw new Error('Media reordering is not supported by this test repository.');
    },

    async listDestinationMediaRollup() {
      return [];
    },

    async listActivityMedia() {
      return [];
    },

    async uploadActivityMedia() {
      throw new Error('Activity media uploads are not supported by this test repository.');
    },

    async importActivityMediaFromSearch() {
      throw new Error('Activity media imports are not supported by this test repository.');
    },

    async updateActivityMedia() {
      throw new Error('Activity media updates are not supported by this test repository.');
    },

    async deleteActivityMedia() {
      throw new Error('Activity media deletes are not supported by this test repository.');
    },

    async reorderActivityMedia() {
      throw new Error('Activity media reordering is not supported by this test repository.');
    },

    async listRouteLegs() {
      return [];
    },

    async saveRouteLeg() {},

    async deleteRouteLeg() {},

    async replaceTripData() {},
  } satisfies TripRepository & { destinationListCalls: number };

  return Object.assign(repository, overrides);
}
