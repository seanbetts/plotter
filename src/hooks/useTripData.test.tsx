import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createActivity as createActivityModel } from '../domain/activities';
import { createDestination } from '../domain/destinations';
import { createRouteKey, createRouteLeg } from '../domain/routeLegs';
import type { Destination, RouteLeg } from '../domain/types';
import { resolveVehiclePreset, standardRoutingVehicle } from '../domain/vehiclePresets';
import { createTripDb } from '../storage/tripDb';
import { createTripRepository } from '../storage/tripRepository';
import { createRouteResultFingerprint } from '../tripCommands/routeOrchestration';
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
    const name = `plotter-hook-test-${crypto.randomUUID()}`;
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
        movement: 'drive', calculation: 'automatic',
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
        movement: 'drive', calculation: 'automatic',
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
        movement: 'drive', calculation: 'automatic',
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
      movement: 'drive', calculation: 'automatic',
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
        movement: 'drive', calculation: 'automatic',
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
      movement: 'drive', calculation: 'automatic',
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
      movement: 'drive', calculation: 'automatic',
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
        movement: 'drive', calculation: 'automatic',
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
        movement: 'drive', calculation: 'automatic',
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
      movement: 'drive', calculation: 'automatic',
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
        movement: 'drive', calculation: 'automatic',
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
      movement: 'drive', calculation: 'automatic',
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
        movement: 'drive', calculation: 'automatic',
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
      movement: 'drive', calculation: 'automatic',
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
        movement: 'drive', calculation: 'automatic',
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
      movement: 'drive', calculation: 'automatic',
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
      movement: 'drive', calculation: 'automatic',
    });
    const secondToThird = createRouteLeg({
      originDestinationId: second.id,
      targetDestinationId: third.id,
      movement: 'drive', calculation: 'automatic',
    });
    const staleFirstToThird = createRouteLeg({
      originDestinationId: first.id,
      targetDestinationId: third.id,
      movement: 'drive', calculation: 'automatic',
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

  it('rejects splitting manual vehicle shipping before saving', async () => {
    const origin = createDestination({ name: 'Singapore', coordinates: { lat: 1, lng: 1 }, order: 0 });
    const target = createDestination({ name: 'Perth', coordinates: { lat: 1, lng: 9 }, order: 1 });
    const shipping = createRouteLeg({ originDestinationId: origin.id, targetDestinationId: target.id, movement: 'vehicle-shipping', calculation: 'manual' });
    const saveDestination = vi.fn(async () => {});
    const repository = createMemoryRepository(Promise.resolve([origin, target]), {
      listRouteLegs: async () => [shipping],
      saveDestination,
    });
    const { result } = renderHook(() => useTripData(repository));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await expect(result.current.addDestination({ name: 'Colombo', coordinates: { lat: 1, lng: 5 } }))
      .rejects.toThrow('Resolve vehicle shipping before inserting a stop');
    expect(saveDestination).not.toHaveBeenCalled();
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
        movement: 'drive', calculation: 'automatic',
        status: 'pending',
      },
      {
        originDestinationId: first.id,
        targetDestinationId: second.id,
        movement: 'drive', calculation: 'automatic',
        status: 'pending',
      },
    ]);

    await act(async () => {
      saveDestination.resolve();
      await reorderPromise;
    });
  });

  it('rejects a reorder that splits manual shipping before publishing UI or repository changes', async () => {
    const origin = createDestination({ name: 'Origin', coordinates: { lat: 0, lng: 0 }, order: 0 });
    const target = createDestination({ name: 'Target', coordinates: { lat: 0, lng: 10 }, order: 1 });
    const inserted = createDestination({ name: 'Inserted', coordinates: { lat: 0, lng: 5 }, order: 2 });
    const shipping = createRouteLeg({
      originDestinationId: origin.id,
      targetDestinationId: target.id,
      movement: 'vehicle-shipping', calculation: 'manual',
    });
    const saveDestination = vi.fn(async () => {});
    const repository = createMemoryRepository(Promise.resolve([origin, target, inserted]), {
      listRouteLegs: async () => [shipping],
      saveDestination,
    });
    const { result } = renderHook(() => useTripData(repository));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await expect(result.current.reorderDestinations([origin.id, inserted.id, target.id]))
        .rejects.toThrow('Resolve vehicle shipping before inserting a stop');
    });

    expect(saveDestination).not.toHaveBeenCalled();
    expect(result.current.destinations.map((destination) => destination.name)).toEqual(['Origin', 'Target', 'Inserted']);
    expect(result.current.routeLegs).toEqual([shipping]);
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
        movement: 'vehicle-shipping', calculation: 'manual',
        notes: 'Ship around the Darien Gap.',
      });
    });

    expect(result.current.routeLegs[0]).toMatchObject({
      id: routeLeg.id,
      movement: 'vehicle-shipping', calculation: 'manual',
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

  it('recalculates automatic route legs once for an explicitly saved vehicle', async () => {
    const origin = createDestination({
      name: 'Origin',
      coordinates: { lat: 50, lng: 1 },
      order: 0,
    });
    const target = createDestination({
      name: 'Target',
      coordinates: { lat: 51, lng: 2 },
      order: 1,
    });
    const readyLeg = {
      ...createRouteLeg({
        originDestinationId: origin.id,
        targetDestinationId: target.id,
        movement: 'drive', calculation: 'automatic',
      }),
      status: 'ready' as const,
      distanceKm: 150,
      travelTimeHours: 2,
      geometry: { type: 'LineString' as const, coordinates: [[1, 50], [2, 51]] },
      provider: 'openrouteservice',
      profile: 'driving-car' as const,
      routeKey: 'old-car-key',
      calculatedAt: '2026-07-01T10:00:00.000Z',
    };
    const saveRouteLeg = vi.fn(async () => undefined);
    const repository = createMemoryRepository(Promise.resolve([origin, target]), {
      listRouteLegs: async () => [readyLeg],
      saveRouteLeg,
    });
    const calculateRoute = vi.fn(async () => ({
      distanceKm: 170,
      travelTimeHours: 2.5,
      geometry: { type: 'LineString' as const, coordinates: [[1, 50], [2, 51]] },
      provider: 'openrouteservice',
      profile: 'driving-hgv' as const,
      sections: [{ kind: 'road' as const, startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 170 }],
    }));
    const { result } = renderHook(() => useTripData(repository, {
      calculateRoute,
      routingVehicle: standardRoutingVehicle,
    }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.recalculateForVehicle(resolveVehiclePreset('expedition-truck'));
    });

    expect(calculateRoute).toHaveBeenCalledTimes(1);
    expect(calculateRoute).toHaveBeenCalledWith(expect.objectContaining({
      profile: 'driving-hgv',
      routingVehicle: resolveVehiclePreset('expedition-truck'),
    }));
    expect(saveRouteLeg).toHaveBeenCalledTimes(1);
    expect(result.current.routeLegs[0]).toMatchObject({
      status: 'ready',
      profile: 'driving-hgv',
      distanceKm: 170,
    });
  });

  it('restores every prior route leg after a partial vehicle-route storage failure', async () => {
    const first = createDestination({ name: 'First', coordinates: { lat: 50, lng: 1 }, order: 0 });
    const second = createDestination({ name: 'Second', coordinates: { lat: 51, lng: 2 }, order: 1 });
    const third = createDestination({ name: 'Third', coordinates: { lat: 52, lng: 3 }, order: 2 });
    const priorRouteLegs = [
      createRouteLeg({ originDestinationId: first.id, targetDestinationId: second.id, movement: 'drive', calculation: 'automatic' }),
      createRouteLeg({ originDestinationId: second.id, targetDestinationId: third.id, movement: 'vehicle-shipping', calculation: 'manual' }),
    ];
    let saveCall = 0;
    const saveRouteLeg = vi.fn(async (routeLeg: RouteLeg) => {
      void routeLeg;
      saveCall += 1;
      if (saveCall === 2) throw new Error('second route write failed');
    });
    const repository = createMemoryRepository(Promise.resolve([first, second, third]), {
      listRouteLegs: async () => priorRouteLegs,
      saveRouteLeg,
    });
    const { result } = renderHook(() => useTripData(repository, {
      calculateRoute: vi.fn(async () => ({
        distanceKm: 100,
        travelTimeHours: 2,
        geometry: { type: 'LineString' as const, coordinates: [[1, 50], [2, 51]] },
        provider: 'openrouteservice',
        profile: 'driving-hgv' as const,
        sections: [{ kind: 'road' as const, startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 100 }],
      })),
    }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await expect(result.current.recalculateForVehicle(resolveVehiclePreset('large-camper')))
        .rejects.toThrow('second route write failed');
    });

    expect(saveRouteLeg).toHaveBeenCalledTimes(4);
    expect(saveRouteLeg.mock.calls.slice(-2).map(([routeLeg]) => routeLeg)).toEqual(priorRouteLegs);
    expect(result.current.routeLegs).toEqual(priorRouteLegs);
  });

  it('reports primary and route rollback storage failures together', async () => {
    const first = createDestination({ name: 'First', coordinates: { lat: 50, lng: 1 }, order: 0 });
    const second = createDestination({ name: 'Second', coordinates: { lat: 51, lng: 2 }, order: 1 });
    const third = createDestination({ name: 'Third', coordinates: { lat: 52, lng: 3 }, order: 2 });
    const priorRouteLegs = [
      createRouteLeg({ originDestinationId: first.id, targetDestinationId: second.id, movement: 'drive', calculation: 'automatic' }),
      createRouteLeg({ originDestinationId: second.id, targetDestinationId: third.id, movement: 'drive', calculation: 'automatic' }),
    ];
    let saveCall = 0;
    const saveRouteLeg = vi.fn(async (routeLeg: RouteLeg) => {
      void routeLeg;
      saveCall += 1;
      if (saveCall === 2) throw new Error('new route write failed');
      if (saveCall === 3) throw new Error('old route restore failed');
    });
    const repository = createMemoryRepository(Promise.resolve([first, second, third]), {
      listRouteLegs: async () => priorRouteLegs,
      saveRouteLeg,
    });
    const { result } = renderHook(() => useTripData(repository));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await expect(result.current.recalculateForVehicle(resolveVehiclePreset('expedition-truck')))
        .rejects.toThrow(/new route write failed.*old route restore failed/);
    });

    expect(saveRouteLeg).toHaveBeenCalledTimes(4);
  });

  it('uses the active trip vehicle for ordinary destination reconciliation', async () => {
    const calculateRoute = vi.fn(async () => ({
      distanceKm: 10,
      travelTimeHours: 1,
      geometry: { type: 'LineString' as const, coordinates: [[1, 1], [2, 2]] },
      provider: 'openrouteservice',
      profile: 'driving-car' as const,
      sections: [{ kind: 'road' as const, startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 10 }],
    }));
    const vehicle = resolveVehiclePreset('large-camper');
    const repository = createTestRepository();
    const { result } = renderHook(() => useTripData(repository, {
      calculateRoute,
      routingVehicle: vehicle,
    }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.addDestination({ name: 'One', coordinates: { lat: 1, lng: 1 } });
      await result.current.addDestination({ name: 'Two', coordinates: { lat: 2, lng: 2 } });
    });

    expect(calculateRoute).toHaveBeenCalledWith(expect.objectContaining({
      profile: 'driving-car',
      routingVehicle: vehicle,
    }));
  });

  it('uses the expedition-truck HGV snapshot when the UI toggles manual shipping to automatic', async () => {
    const origin = createDestination({ name: 'Panama City', coordinates: { lat: 9, lng: -79.5 }, order: 0 });
    const target = createDestination({ name: 'Cartagena', coordinates: { lat: 10.4, lng: -75.5 }, order: 1 });
    const manual = createRouteLeg({
      originDestinationId: origin.id, targetDestinationId: target.id,
      movement: 'vehicle-shipping', calculation: 'manual', status: 'manual',
      geometry: { type: 'LineString', coordinates: [[-79.5, 9], [-75.5, 10.4]] },
    });
    const vehicle = resolveVehiclePreset('expedition-truck');
    let stored = manual;
    const repository = createMemoryRepository(Promise.resolve([origin, target]), {
      listRouteLegs: async () => [stored],
      saveRouteLeg: async (routeLeg) => { stored = routeLeg; },
    });
    const calculateRoute = vi.fn(async ({ origin: routeOrigin, target: routeTarget }) => ({
      distanceKm: 500, travelTimeHours: 8,
      geometry: { type: 'LineString' as const, coordinates: [[routeOrigin.lng, routeOrigin.lat], [routeTarget.lng, routeTarget.lat]] },
      provider: 'openrouteservice', profile: 'driving-hgv' as const,
      sections: [{ kind: 'road' as const, startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 500 }],
    }));
    const { result } = renderHook(() => useTripData(repository, { routingVehicle: vehicle, calculateRoute }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.updateRouteLeg(manual.id, { movement: 'drive', calculation: 'automatic' });
    });

    expect(calculateRoute).toHaveBeenCalledWith(expect.objectContaining({
      profile: 'driving-hgv', routingVehicle: vehicle,
    }));
    expect(stored).toMatchObject({ movement: 'drive', calculation: 'automatic', profile: 'driving-hgv' });
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
      movement: 'drive', calculation: 'automatic',
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
      retryPromise = result.current.updateRouteLeg(failedLeg.id, { movement: 'drive', calculation: 'automatic' });
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

  it('rejects a validated result when intent changed before the action runs', async () => {
    const origin = createDestination({ name: 'Bremen', coordinates: { lat: 53.0793, lng: 8.8017 }, order: 0 });
    const target = createDestination({ name: 'Hamburg', coordinates: { lat: 53.5502, lng: 10.0013 }, order: 1 });
    const routeLeg = createReadyRouteLeg(origin, target);
    const saveRouteLeg = vi.fn(async () => undefined);
    const repository = createMemoryRepository(Promise.resolve([origin, target]), {
      listRouteLegs: async () => [routeLeg],
      saveRouteLeg,
    });
    const { result } = renderHook(() => useTripData(repository));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const expectedFingerprint = createRouteResultFingerprint(routeLeg, standardRoutingVehicle);
    const validatedRouteLeg = createSelectedRouteResult(routeLeg);

    await act(async () => {
      await result.current.updateRouteLeg(routeLeg.id, { notes: 'Newer intent notes.' });
    });
    saveRouteLeg.mockClear();

    let applied = true;
    await act(async () => {
      applied = await result.current.applyValidatedRouteLegResult({
        routeLegId: routeLeg.id,
        expectedFingerprint,
        validatedRouteLeg,
      });
    });

    expect(applied).toBe(false);
    expect(saveRouteLeg).not.toHaveBeenCalled();
    expect(result.current.routeLegs[0].notes).toBe('Newer intent notes.');
  });

  it('serializes an intent edit queued during an async validated-result save so the edit wins', async () => {
    const origin = createDestination({ name: 'Bremen', coordinates: { lat: 53.0793, lng: 8.8017 }, order: 0 });
    const target = createDestination({ name: 'Hamburg', coordinates: { lat: 53.5502, lng: 10.0013 }, order: 1 });
    const routeLeg = createReadyRouteLeg(origin, target);
    const releaseFirstSave = createDeferred(undefined);
    let storedRouteLeg = routeLeg;
    let saveCount = 0;
    const saveRouteLeg = vi.fn(async (nextRouteLeg: RouteLeg) => {
      saveCount += 1;
      if (saveCount === 1) await releaseFirstSave.promise;
      storedRouteLeg = nextRouteLeg;
    });
    const repository = createMemoryRepository(Promise.resolve([origin, target]), {
      listRouteLegs: async () => [storedRouteLeg],
      saveRouteLeg,
    });
    const { result } = renderHook(() => useTripData(repository));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let applyPromise!: Promise<boolean>;
    let editPromise!: Promise<void>;
    await act(async () => {
      applyPromise = result.current.applyValidatedRouteLegResult({
        routeLegId: routeLeg.id,
        expectedFingerprint: createRouteResultFingerprint(routeLeg, standardRoutingVehicle),
        validatedRouteLeg: createSelectedRouteResult(routeLeg),
      });
      await waitFor(() => expect(saveRouteLeg).toHaveBeenCalledTimes(1));
      editPromise = result.current.updateRouteLeg(routeLeg.id, { notes: 'Newer queued intent.' });
      await Promise.resolve();
    });

    expect(saveRouteLeg).toHaveBeenCalledTimes(1);

    await act(async () => {
      releaseFirstSave.resolve();
      await Promise.all([applyPromise, editPromise]);
    });

    expect(storedRouteLeg.notes).toBe('Newer queued intent.');
    expect(result.current.routeLegs[0].notes).toBe('Newer queued intent.');
    expect(result.current.routeLegs[0].routeKey).toBe('selected-route');
  });

  it('rejects a validated result when the current trip vehicle changed', async () => {
    const origin = createDestination({ name: 'Bremen', coordinates: { lat: 53.0793, lng: 8.8017 }, order: 0 });
    const target = createDestination({ name: 'Hamburg', coordinates: { lat: 53.5502, lng: 10.0013 }, order: 1 });
    const routeLeg = createReadyRouteLeg(origin, target);
    const saveRouteLeg = vi.fn(async () => undefined);
    const repository = createMemoryRepository(Promise.resolve([origin, target]), {
      listRouteLegs: async () => [routeLeg],
      saveRouteLeg,
    });
    const { result, rerender } = renderHook(
      ({ routingVehicle }) => useTripData(repository, { routingVehicle }),
      { initialProps: { routingVehicle: standardRoutingVehicle } },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const expectedFingerprint = createRouteResultFingerprint(routeLeg, standardRoutingVehicle);

    rerender({ routingVehicle: resolveVehiclePreset('expedition-truck') });

    let applied = true;
    await act(async () => {
      applied = await result.current.applyValidatedRouteLegResult({
        routeLegId: routeLeg.id,
        expectedFingerprint,
        validatedRouteLeg: createSelectedRouteResult(routeLeg),
      });
    });

    expect(applied).toBe(false);
    expect(saveRouteLeg).not.toHaveBeenCalled();
    expect(result.current.routeLegs[0].routeKey).toBe(routeLeg.routeKey);
  });

  it('lets a vehicle recalculation started during a blocked alternative save win', async () => {
    const origin = createDestination({ name: 'Bremen', coordinates: { lat: 53.0793, lng: 8.8017 }, order: 0 });
    const target = createDestination({ name: 'Hamburg', coordinates: { lat: 53.5502, lng: 10.0013 }, order: 1 });
    const routeLeg = createReadyRouteLeg(origin, target);
    const releaseFirstSave = createDeferred(undefined);
    let storedRouteLeg = routeLeg;
    let saveCount = 0;
    const saveRouteLeg = vi.fn(async (nextRouteLeg: RouteLeg) => {
      saveCount += 1;
      if (saveCount === 1) await releaseFirstSave.promise;
      storedRouteLeg = nextRouteLeg;
    });
    const repository = createMemoryRepository(Promise.resolve([origin, target]), {
      listRouteLegs: async () => [storedRouteLeg],
      saveRouteLeg,
    });
    const calculateRoute = vi.fn(async () => ({
      distanceKm: 150,
      travelTimeHours: 2.5,
      geometry: routeLeg.geometry!,
      provider: 'openrouteservice',
      profile: 'driving-hgv' as const,
      sections: [{ kind: 'road' as const, startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 150 }],
    }));
    const { result } = renderHook(() => useTripData(repository, { calculateRoute }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let applyPromise!: Promise<boolean>;
    let recalculatePromise!: Promise<void>;
    await act(async () => {
      applyPromise = result.current.applyValidatedRouteLegResult({
        routeLegId: routeLeg.id,
        expectedFingerprint: createRouteResultFingerprint(routeLeg, standardRoutingVehicle),
        validatedRouteLeg: createSelectedRouteResult(routeLeg),
      });
      await waitFor(() => expect(saveRouteLeg).toHaveBeenCalledTimes(1));
      recalculatePromise = result.current.recalculateForVehicle(resolveVehiclePreset('expedition-truck'));
      await Promise.resolve();
    });

    expect(saveRouteLeg).toHaveBeenCalledTimes(1);
    await act(async () => {
      releaseFirstSave.resolve();
      await Promise.all([applyPromise, recalculatePromise]);
    });

    expect(storedRouteLeg).toMatchObject({ profile: 'driving-hgv', distanceKm: 150 });
    expect(result.current.routeLegs[0]).toMatchObject({ profile: 'driving-hgv', distanceKm: 150 });
  });

  it('lets direct deletion started during a blocked alternative save win', async () => {
    const origin = createDestination({ name: 'Bremen', coordinates: { lat: 53.0793, lng: 8.8017 }, order: 0 });
    const target = createDestination({ name: 'Hamburg', coordinates: { lat: 53.5502, lng: 10.0013 }, order: 1 });
    const routeLeg = createReadyRouteLeg(origin, target);
    const releaseFirstSave = createDeferred(undefined);
    let storedRouteLeg: RouteLeg | undefined = routeLeg;
    const saveRouteLeg = vi.fn(async (nextRouteLeg: RouteLeg) => {
      await releaseFirstSave.promise;
      storedRouteLeg = nextRouteLeg;
    });
    const deleteRouteLeg = vi.fn(async () => { storedRouteLeg = undefined; });
    const repository = createMemoryRepository(Promise.resolve([origin, target]), {
      listRouteLegs: async () => storedRouteLeg ? [storedRouteLeg] : [],
      saveRouteLeg,
      deleteRouteLeg,
    });
    const { result } = renderHook(() => useTripData(repository));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let applyPromise!: Promise<boolean>;
    let deletePromise!: Promise<void>;
    await act(async () => {
      applyPromise = result.current.applyValidatedRouteLegResult({
        routeLegId: routeLeg.id,
        expectedFingerprint: createRouteResultFingerprint(routeLeg, standardRoutingVehicle),
        validatedRouteLeg: createSelectedRouteResult(routeLeg),
      });
      await waitFor(() => expect(saveRouteLeg).toHaveBeenCalledTimes(1));
      deletePromise = result.current.deleteRouteLeg(routeLeg.id);
      await Promise.resolve();
    });

    expect(deleteRouteLeg).not.toHaveBeenCalled();
    await act(async () => {
      releaseFirstSave.resolve();
      await Promise.all([applyPromise, deletePromise]);
    });

    expect(storedRouteLeg).toBeUndefined();
    expect(result.current.routeLegs).toEqual([]);
  });

  it('lets destination reconciliation started during a blocked alternative save win', async () => {
    const origin = createDestination({ name: 'Bremen', coordinates: { lat: 53.0793, lng: 8.8017 }, order: 0 });
    const target = createDestination({ name: 'Hamburg', coordinates: { lat: 53.5502, lng: 10.0013 }, order: 1 });
    const routeLeg = createReadyRouteLeg(origin, target);
    const releaseFirstSave = createDeferred(undefined);
    let storedRouteLeg = routeLeg;
    let saveCount = 0;
    const saveRouteLeg = vi.fn(async (nextRouteLeg: RouteLeg) => {
      saveCount += 1;
      if (saveCount === 1) await releaseFirstSave.promise;
      storedRouteLeg = nextRouteLeg;
    });
    const repository = createMemoryRepository(Promise.resolve([origin, target]), {
      listRouteLegs: async () => [storedRouteLeg],
      saveRouteLeg,
      saveDestination: vi.fn(async () => undefined),
    });
    const calculateRoute = vi.fn(async () => ({
      distanceKm: 175,
      travelTimeHours: 3,
      geometry: routeLeg.geometry!,
      provider: 'openrouteservice',
      profile: 'driving-car' as const,
      sections: [{ kind: 'road' as const, startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 175 }],
    }));
    const { result } = renderHook(() => useTripData(repository, { calculateRoute }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let applyPromise!: Promise<boolean>;
    let reconcilePromise!: Promise<void>;
    await act(async () => {
      applyPromise = result.current.applyValidatedRouteLegResult({
        routeLegId: routeLeg.id,
        expectedFingerprint: createRouteResultFingerprint(routeLeg, standardRoutingVehicle),
        validatedRouteLeg: createSelectedRouteResult(routeLeg),
      });
      await waitFor(() => expect(saveRouteLeg).toHaveBeenCalledTimes(1));
      reconcilePromise = result.current.updateDestination(origin.id, {
        coordinates: { lat: origin.coordinates.lat + 0.1, lng: origin.coordinates.lng },
      });
      await Promise.resolve();
    });

    expect(saveRouteLeg).toHaveBeenCalledTimes(1);
    await act(async () => {
      releaseFirstSave.resolve();
      await Promise.all([applyPromise, reconcilePromise]);
    });

    expect(storedRouteLeg.distanceKm).toBe(175);
    expect(result.current.routeLegs[0].distanceKm).toBe(175);
  });

  it('does not poison a leg mutation queue after a rejected save', async () => {
    const origin = createDestination({ name: 'Bremen', coordinates: { lat: 53.0793, lng: 8.8017 }, order: 0 });
    const target = createDestination({ name: 'Hamburg', coordinates: { lat: 53.5502, lng: 10.0013 }, order: 1 });
    const routeLeg = createReadyRouteLeg(origin, target);
    let saveCount = 0;
    let storedRouteLeg = routeLeg;
    const saveRouteLeg = vi.fn(async (nextRouteLeg: RouteLeg) => {
      saveCount += 1;
      if (saveCount === 1) throw new Error('First save failed');
      storedRouteLeg = nextRouteLeg;
    });
    const repository = createMemoryRepository(Promise.resolve([origin, target]), {
      listRouteLegs: async () => [storedRouteLeg],
      saveRouteLeg,
    });
    const { result } = renderHook(() => useTripData(repository));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await expect(result.current.applyValidatedRouteLegResult({
        routeLegId: routeLeg.id,
        expectedFingerprint: createRouteResultFingerprint(routeLeg, standardRoutingVehicle),
        validatedRouteLeg: createSelectedRouteResult(routeLeg),
      })).rejects.toThrow('First save failed');
      await result.current.updateRouteLeg(routeLeg.id, { notes: 'Later mutation succeeded.' });
    });

    expect(storedRouteLeg.notes).toBe('Later mutation succeeded.');
    expect(result.current.routeLegs[0].notes).toBe('Later mutation succeeded.');
  });

  it('serializes a constrained intent edit started while reconciliation is blocked so the edit wins', async () => {
    const origin = createDestination({ name: 'Bremen', coordinates: { lat: 53, lng: 8 }, order: 0 });
    const target = createDestination({ name: 'Hamburg', coordinates: { lat: 54, lng: 9 }, order: 1 });
    const pending = createRouteLeg({ originDestinationId: origin.id, targetDestinationId: target.id });
    const provider = createDeferred({
      distanceKm: 100, travelTimeHours: 2,
      geometry: { type: 'LineString' as const, coordinates: [[8, 53], [9, 54]] },
      provider: 'openrouteservice', profile: 'driving-car' as const,
      sections: [{ kind: 'road' as const, startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 100 }],
    });
    let stored = pending;
    const repository = createMemoryRepository(Promise.resolve([origin, target]), {
      listRouteLegs: async () => [stored],
      saveRouteLeg: async (leg) => { stored = leg; },
    });
    const { result } = renderHook(() => useTripData(repository, { calculateRoute: () => provider.promise }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let reconcilePromise!: Promise<void>;
    let editPromise!: Promise<void>;
    await act(async () => {
      reconcilePromise = result.current.reorderDestinations([origin.id, target.id]);
      await Promise.resolve();
      editPromise = result.current.updateRouteLeg(pending.id, { ferryPolicy: 'avoid', notes: 'New constrained intent.' });
      await Promise.resolve();
    });
    expect(stored.ferryPolicy).toBe('allow');

    await act(async () => {
      provider.resolve();
      await Promise.all([reconcilePromise, editPromise]);
    });

    expect(stored).toMatchObject({ ferryPolicy: 'avoid', notes: 'New constrained intent.' });
    expect(result.current.routeLegs[0]).toMatchObject({ ferryPolicy: 'avoid', notes: 'New constrained intent.' });
  });

  it('restores destination and route snapshots when a route write fails after destination persistence', async () => {
    const origin = createDestination({ name: 'Bremen', coordinates: { lat: 53, lng: 8 }, order: 0 });
    const target = createDestination({ name: 'Hamburg', coordinates: { lat: 54, lng: 9 }, order: 1 });
    const priorLeg = createRouteLeg({ originDestinationId: origin.id, targetDestinationId: target.id });
    let storedDestinations = [origin, target];
    let storedRoutes = [priorLeg];
    let failNextRouteSave = true;
    const repository = createMemoryRepository(Promise.resolve(storedDestinations), {
      listDestinations: async () => structuredClone([...storedDestinations].sort((left, right) => left.order - right.order)),
      listRouteLegs: async () => structuredClone(storedRoutes),
      saveDestination: async (destination) => {
        const index = storedDestinations.findIndex(({ id }) => id === destination.id);
        if (index === -1) storedDestinations.push(destination); else storedDestinations[index] = destination;
      },
      deleteDestination: async (id) => { storedDestinations = storedDestinations.filter((item) => item.id !== id); },
      saveRouteLeg: async (leg) => {
        if (failNextRouteSave) { failNextRouteSave = false; throw new Error('route write failed'); }
        const index = storedRoutes.findIndex(({ id }) => id === leg.id);
        if (index === -1) storedRoutes.push(leg); else storedRoutes[index] = leg;
      },
      deleteRouteLeg: async (id) => { storedRoutes = storedRoutes.filter((item) => item.id !== id); },
    });
    const { result } = renderHook(() => useTripData(repository));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await expect(result.current.addDestination({ name: 'Hanover', coordinates: { lat: 53.5, lng: 8.5 } }))
        .rejects.toThrow(/route write failed.*Previous destination and route snapshots were restored/);
    });

    expect(storedDestinations).toEqual([origin, target]);
    expect(storedRoutes).toEqual([priorLeg]);
    expect(result.current.destinations).toEqual([origin, target]);
    expect(result.current.routeLegs).toEqual([priorLeg]);
  });

  it('keeps UI state and reports destination rollback failures after a destination write rejection', async () => {
    const origin = createDestination({ name: 'Bremen', coordinates: { lat: 53, lng: 8 }, order: 0 });
    const target = createDestination({ name: 'Hamburg', coordinates: { lat: 54, lng: 9 }, order: 1 });
    const priorLeg = createRouteLeg({ originDestinationId: origin.id, targetDestinationId: target.id });
    let saveCount = 0;
    const repository = createMemoryRepository(Promise.resolve([origin, target]), {
      listDestinations: async () => structuredClone([origin, target]),
      listRouteLegs: async () => structuredClone([priorLeg]),
      saveDestination: async () => {
        saveCount += 1;
        if (saveCount === 2) throw new Error('destination write failed');
        if (saveCount === 3) throw new Error('destination rollback failed');
      },
    });
    const { result } = renderHook(() => useTripData(repository));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await expect(result.current.updateDestination(origin.id, { name: 'Updated Bremen' }))
        .rejects.toThrow(/destination write failed.*Rollback consistency failures.*destination rollback failed/);
    });

    expect(result.current.destinations).toEqual([origin, target]);
    expect(result.current.routeLegs).toEqual([priorLeg]);
  });

  it('retains two concurrent inserts by applying each queued recipe to the fresh snapshot', async () => {
    const origin = createDestination({ name: 'Origin', coordinates: { lat: 0, lng: 0 }, order: 0 });
    const target = createDestination({ name: 'Target', coordinates: { lat: 0, lng: 10 }, order: 1 });
    const storedDestinations = [origin, target];
    let storedRoutes: RouteLeg[] = [];
    const firstProvider = createDeferred({
      distanceKm: 5, travelTimeHours: 1,
      geometry: { type: 'LineString' as const, coordinates: [[0, 0], [5, 0]] },
      provider: 'test', profile: 'driving-car' as const,
      sections: [{ kind: 'road' as const, startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 5 }],
    });
    let calculationCount = 0;
    const repository = createMemoryRepository(Promise.resolve(storedDestinations), {
      listDestinations: async () => structuredClone([...storedDestinations].sort((left, right) => left.order - right.order)),
      listRouteLegs: async () => structuredClone(storedRoutes),
      saveDestination: async (destination) => {
        const index = storedDestinations.findIndex(({ id }) => id === destination.id);
        if (index === -1) storedDestinations.push(destination); else storedDestinations[index] = destination;
      },
      saveRouteLeg: async (routeLeg) => {
        const index = storedRoutes.findIndex(({ id }) => id === routeLeg.id);
        if (index === -1) storedRoutes.push(routeLeg); else storedRoutes[index] = routeLeg;
      },
      deleteRouteLeg: async (id) => { storedRoutes = storedRoutes.filter((routeLeg) => routeLeg.id !== id); },
    });
    const calculateRoute = vi.fn(async ({ origin: routeOrigin, target: routeTarget }) => {
      calculationCount += 1;
      if (calculationCount === 1) return firstProvider.promise;
      return {
        distanceKm: 5, travelTimeHours: 1,
        geometry: { type: 'LineString' as const, coordinates: [[routeOrigin.lng, routeOrigin.lat], [routeTarget.lng, routeTarget.lat]] },
        provider: 'test', profile: 'driving-car' as const,
        sections: [{ kind: 'road' as const, startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 5 }],
      };
    });
    const { result } = renderHook(() => useTripData(repository, { calculateRoute }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let first!: Promise<Destination>;
    let second!: Promise<Destination>;
    await act(async () => {
      first = result.current.addDestination({ name: 'First insert', coordinates: { lat: 0, lng: 4 } });
      await waitFor(() => expect(calculateRoute).toHaveBeenCalledTimes(1));
      second = result.current.addDestination({ name: 'Second insert', coordinates: { lat: 0, lng: 6 } });
      firstProvider.resolve();
      await Promise.all([first, second]);
    });

    expect([...storedDestinations].sort((left, right) => left.order - right.order).map(({ name }) => name))
      .toEqual(['Origin', 'First insert', 'Second insert', 'Target']);
    expect(result.current.destinations.map(({ name }) => name)).toEqual(['Origin', 'First insert', 'Second insert', 'Target']);
  });

  it('does not run destructive destination cascade when replacement route persistence fails', async () => {
    const origin = createDestination({ name: 'Origin', coordinates: { lat: 0, lng: 0 }, order: 0 });
    const removed = createDestination({ name: 'Removed', coordinates: { lat: 0, lng: 5 }, order: 1 });
    const target = createDestination({ name: 'Target', coordinates: { lat: 0, lng: 10 }, order: 2 });
    const routes = [
      createRouteLeg({ originDestinationId: origin.id, targetDestinationId: removed.id }),
      createRouteLeg({ originDestinationId: removed.id, targetDestinationId: target.id }),
    ];
    const dependentRecords = { activities: ['activity-1'], activityMedia: ['media-1'] };
    const deleteDestination = vi.fn(async () => {
      dependentRecords.activities = [];
      dependentRecords.activityMedia = [];
    });
    const repository = createMemoryRepository(Promise.resolve([origin, removed, target]), {
      listDestinations: async () => [origin, removed, target],
      listRouteLegs: async () => routes,
      saveRouteLeg: async () => { throw new Error('replacement route failed'); },
      deleteDestination,
    });
    const { result } = renderHook(() => useTripData(repository));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await expect(result.current.deleteDestination(removed.id)).rejects.toThrow('replacement route failed');
    });

    expect(deleteDestination).not.toHaveBeenCalled();
    expect(dependentRecords).toEqual({ activities: ['activity-1'], activityMedia: ['media-1'] });
  });

  it('compensates prior topology and routes when prepared destination commit rejects', async () => {
    const origin = createDestination({ name: 'Origin', coordinates: { lat: 0, lng: 0 }, order: 0 });
    const removed = createDestination({ name: 'Removed', coordinates: { lat: 0, lng: 5 }, order: 1 });
    const target = createDestination({ name: 'Target', coordinates: { lat: 0, lng: 10 }, order: 2 });
    const priorDestinations = [origin, removed, target];
    const priorRoutes = [
      createRouteLeg({ originDestinationId: origin.id, targetDestinationId: removed.id }),
      createRouteLeg({ originDestinationId: removed.id, targetDestinationId: target.id }),
    ];
    const storedDestinations = structuredClone(priorDestinations);
    let storedRoutes = structuredClone(priorRoutes);
    const repository = createMemoryRepository(Promise.resolve(priorDestinations), {
      listDestinations: async () => structuredClone([...storedDestinations].sort((left, right) => left.order - right.order)),
      listRouteLegs: async () => structuredClone(storedRoutes),
      saveDestination: async (destination) => {
        const index = storedDestinations.findIndex(({ id }) => id === destination.id);
        if (index === -1) storedDestinations.push(destination); else storedDestinations[index] = destination;
      },
      saveRouteLeg: async (routeLeg) => {
        const index = storedRoutes.findIndex(({ id }) => id === routeLeg.id);
        if (index === -1) storedRoutes.push(routeLeg); else storedRoutes[index] = routeLeg;
      },
      deleteRouteLeg: async (id) => { storedRoutes = storedRoutes.filter((routeLeg) => routeLeg.id !== id); },
      prepareDestinationDeletion: async () => async () => { throw new Error('destination commit failed'); },
    });
    const { result } = renderHook(() => useTripData(repository));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await expect(result.current.deleteDestination(removed.id))
        .rejects.toThrow(/destination commit failed.*Previous destination and route snapshots were restored/);
    });

    expect([...storedDestinations].sort((left, right) => left.order - right.order)).toEqual(priorDestinations);
    expect(storedRoutes).toEqual(priorRoutes);
    expect(result.current.destinations).toEqual(priorDestinations);
    expect(result.current.routeLegs).toEqual(priorRoutes);
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

function createReadyRouteLeg(
  origin: ReturnType<typeof createDestination>,
  target: ReturnType<typeof createDestination>,
) {
  return createRouteLeg({
    originDestinationId: origin.id,
    targetDestinationId: target.id,
    movement: 'drive', calculation: 'automatic',
    status: 'ready',
    distanceKm: 125,
    travelTimeHours: 2,
    geometry: {
      type: 'LineString',
      coordinates: [
        [origin.coordinates.lng, origin.coordinates.lat],
        [target.coordinates.lng, target.coordinates.lat],
      ],
    },
    provider: 'openrouteservice',
    profile: 'driving-car',
    routeKey: 'original-route',
    calculatedAt: '2026-07-01T10:00:00.000Z',
  });
}

function createSelectedRouteResult(routeLeg: RouteLeg): RouteLeg {
  return {
    ...routeLeg,
    status: 'ready',
    distanceKm: 140,
    travelTimeHours: 2.25,
    routeKey: 'selected-route',
    sections: [{ kind: 'road', startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 140 }],
    warnings: [],
    calculatedAt: '2026-07-02T10:00:00.000Z',
    error: undefined,
  };
}

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
