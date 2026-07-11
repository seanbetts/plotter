import { describe, expect, it, vi } from 'vitest';
import { createDestination } from '../domain/destinations';
import { createRouteKey, createRouteLeg } from '../domain/routeLegs';
import { resolveVehiclePreset } from '../domain/vehiclePresets';
import type { RouteLeg } from '../domain/types';
import {
  calculateAutomaticRouteLegs,
  recalculateAutomaticRouteLegsForVehicle,
  reconcileAndSaveRouteLegs,
  type CalculateRoute,
} from './routeOrchestration';

if (false) {
  // @ts-expect-error normalized route calculations require section metadata
  const missingSectionsCalculator: CalculateRoute = async () => ({
    distanceKm: 100,
    travelTimeHours: 2,
    geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
    provider: 'test',
    profile: 'driving-car',
  });
  void missingSectionsCalculator;
}

function createRepository(routeLegs: RouteLeg[] = []) {
  return {
    saveRouteLeg: vi.fn(async (routeLeg: RouteLeg) => {
      const index = routeLegs.findIndex((existing) => existing.id === routeLeg.id);
      if (index === -1) routeLegs.push(routeLeg);
      else routeLegs[index] = routeLeg;
    }),
    deleteRouteLeg: vi.fn(async (routeLegId: string) => {
      const index = routeLegs.findIndex((routeLeg) => routeLeg.id === routeLegId);
      if (index !== -1) routeLegs.splice(index, 1);
    }),
  };
}

describe('route orchestration', () => {
  it('creates and calculates adjacent driving route legs', async () => {
    const origin = createDestination({
      name: 'Boroughbridge',
      coordinates: { lat: 54.0903, lng: -1.4144 },
    });
    const target = createDestination({
      name: 'Alnwick',
      coordinates: { lat: 55.426423, lng: -1.60645 },
    });
    const repository = createRepository();
    const calculateRoute = vi.fn(async () => ({
      distanceKm: 170,
      travelTimeHours: 2,
      geometry: {
        type: 'LineString' as const,
        coordinates: [
          [origin.coordinates.lng, origin.coordinates.lat],
          [target.coordinates.lng, target.coordinates.lat],
        ],
      },
      provider: 'test',
      profile: 'driving-car' as const,
      sections: [{ kind: 'road' as const, startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 170 }],
    }));

    const routeLegs = await reconcileAndSaveRouteLegs({
      destinations: [origin, target],
      currentRouteLegs: [],
      repository,
      calculateRoute,
    });

    expect(routeLegs).toHaveLength(1);
    expect(routeLegs[0]).toMatchObject({
      originDestinationId: origin.id,
      targetDestinationId: target.id,
      status: 'ready',
      distanceKm: 170,
      travelTimeHours: 2,
      provider: 'test',
      profile: 'driving-car',
    });
    expect(repository.saveRouteLeg).toHaveBeenCalledTimes(1);
  });

  it('preserves ready route legs that still match the same endpoints', async () => {
    const origin = createDestination({
      name: 'Tongue',
      coordinates: { lat: 58.492089, lng: -4.427364 },
    });
    const target = createDestination({
      name: 'Shore',
      coordinates: { lat: 58.168971, lng: -5.307577 },
    });
    const readyLeg = createRouteLeg({
      originDestinationId: origin.id,
      targetDestinationId: target.id,
      type: 'driving-auto',
      status: 'ready',
      distanceKm: 96,
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
      routeKey: createRouteKey({ origin: origin.coordinates, target: target.coordinates }),
      calculatedAt: new Date().toISOString(),
    });
    const repository = createRepository([readyLeg]);
    const calculateRoute = vi.fn();

    const routeLegs = await reconcileAndSaveRouteLegs({
      destinations: [origin, target],
      currentRouteLegs: [readyLeg],
      repository,
      calculateRoute,
    });

    expect(routeLegs[0]).toBe(readyLeg);
    expect(calculateRoute).not.toHaveBeenCalled();
  });

  it('does not retry failed route legs during ordinary reconciliation', async () => {
    const origin = createDestination({
      name: 'Ghent',
      coordinates: { lat: 51.0538, lng: 3.725 },
    });
    const middle = createDestination({
      name: 'Hamburg',
      coordinates: { lat: 53.5502, lng: 10.0013 },
    });
    const target = createDestination({
      name: 'Copenhagen',
      coordinates: { lat: 55.6761, lng: 12.5683 },
    });
    const failedLeg = createRouteLeg({
      originDestinationId: origin.id,
      targetDestinationId: middle.id,
      type: 'driving-auto',
      status: 'failed',
      error: 'Load failed',
      routeKey: createRouteKey({ origin: origin.coordinates, target: middle.coordinates }),
    });
    const repository = createRepository([failedLeg]);
    const calculateRoute = vi.fn(async ({ origin: routeOrigin, target: routeTarget }) => ({
      distanceKm: 330,
      travelTimeHours: 4.5,
      geometry: {
        type: 'LineString' as const,
        coordinates: [
          [routeOrigin.lng, routeOrigin.lat],
          [routeTarget.lng, routeTarget.lat],
        ],
      },
      provider: 'test',
      profile: 'driving-car' as const,
      sections: [{ kind: 'road' as const, startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 330 }],
    }));

    const routeLegs = await reconcileAndSaveRouteLegs({
      destinations: [origin, middle, target],
      currentRouteLegs: [failedLeg],
      repository,
      calculateRoute,
    });

    expect(calculateRoute).toHaveBeenCalledTimes(1);
    expect(calculateRoute).toHaveBeenCalledWith({
      origin: middle.coordinates,
      target: target.coordinates,
      profile: 'driving-car',
      routingVehicle: resolveVehiclePreset('standard'),
      waypoints: [],
      ferryPolicy: 'allow',
    });
    expect(routeLegs[0]).toBe(failedLeg);
    expect(routeLegs[0]).toMatchObject({ status: 'failed', error: 'Load failed' });
    expect(routeLegs[1]).toMatchObject({ status: 'ready' });
  });

  it('passes ordered waypoints, ferry intent, and the trip vehicle to the provider', async () => {
    const origin = createDestination({ name: 'Bremen', coordinates: { lat: 53.0793, lng: 8.8017 } });
    const target = createDestination({ name: 'Hirtshals', coordinates: { lat: 57.5881, lng: 9.9598 } });
    const waypoint = {
      id: 'waypoint-1',
      order: 0,
      name: 'Hamburg',
      coordinates: { lat: 53.5502, lng: 10.0013 },
      location: origin.location,
      notes: '',
      links: [],
    };
    const routingVehicle = resolveVehiclePreset('large-camper');
    const calculateRoute = vi.fn(async () => ({
      distanceKm: 700,
      travelTimeHours: 9,
      geometry: { type: 'LineString' as const, coordinates: [[8.8017, 53.0793], [9.9598, 57.5881]] },
      provider: 'test',
      profile: 'driving-hgv' as const,
      sections: [{ kind: 'ferry' as const, startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 200 }],
    }));

    await calculateAutomaticRouteLegs({
      destinations: [origin, target],
      routeLegs: [createRouteLeg({
        originDestinationId: origin.id,
        targetDestinationId: target.id,
        type: 'driving-auto',
        ferryPolicy: 'require',
        waypoints: [waypoint],
      })],
      routingVehicle,
      calculateRoute,
    });

    expect(calculateRoute).toHaveBeenCalledWith({
      origin: origin.coordinates,
      target: target.coordinates,
      profile: 'driving-hgv',
      routingVehicle,
      waypoints: [waypoint],
      ferryPolicy: 'require',
    });
  });

  it.each([
    ['require' as const, [{ kind: 'road' as const, startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 500 }], 'FERRY_REQUIRED_NOT_FOUND'],
    ['avoid' as const, [{ kind: 'ferry' as const, startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 200 }], 'FERRY_AVOIDED_BUT_FOUND'],
  ])('fails %s when returned ferry sections contradict intent', async (ferryPolicy, sections, warningCode) => {
    const origin = createDestination({ name: 'Bremen', coordinates: { lat: 53.0793, lng: 8.8017 } });
    const target = createDestination({ name: 'Hirtshals', coordinates: { lat: 57.5881, lng: 9.9598 } });
    const [result] = await calculateAutomaticRouteLegs({
      destinations: [origin, target],
      routeLegs: [createRouteLeg({
        originDestinationId: origin.id,
        targetDestinationId: target.id,
        type: 'driving-auto',
        ferryPolicy,
      })],
      routingVehicle: resolveVehiclePreset('standard'),
      calculateRoute: async () => ({
        distanceKm: 800,
        travelTimeHours: 10,
        geometry: { type: 'LineString', coordinates: [[8.8017, 53.0793], [9.9598, 57.5881]] },
        provider: 'test',
        profile: 'driving-car',
        sections,
      }),
    });

    expect(result).toMatchObject({
      status: 'failed',
      distanceKm: undefined,
      travelTimeHours: undefined,
      geometry: undefined,
      provider: undefined,
      calculatedAt: undefined,
      sections: [],
      warnings: [expect.objectContaining({ code: warningCode })],
    });
  });

  it('marks the Bremen to Hirtshals defect for review while excluding its metrics', async () => {
    const bremen = createDestination({ name: 'Bremen', coordinates: { lat: 53.0793, lng: 8.8017 } });
    const hirtshals = createDestination({ name: 'Hirtshals', coordinates: { lat: 57.5881, lng: 9.9598 } });
    const candidateGeometry = {
      type: 'LineString' as const,
      coordinates: [[bremen.coordinates.lng, bremen.coordinates.lat], [hirtshals.coordinates.lng, hirtshals.coordinates.lat]],
    };
    const [result] = await calculateAutomaticRouteLegs({
      destinations: [bremen, hirtshals],
      routeLegs: [createRouteLeg({
        originDestinationId: bremen.id,
        targetDestinationId: hirtshals.id,
        type: 'driving-auto',
      })],
      routingVehicle: resolveVehiclePreset('standard'),
      calculateRoute: async () => ({
        distanceKm: 1372.6,
        travelTimeHours: 18,
        geometry: candidateGeometry,
        provider: 'test',
        profile: 'driving-car',
        sections: [{ kind: 'road', startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 1372.6 }],
      }),
    });

    expect(result).toMatchObject({
      status: 'review-required',
      distanceKm: undefined,
      travelTimeHours: undefined,
      geometry: candidateGeometry,
      provider: 'test',
      sections: [{ kind: 'road', startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 1372.6 }],
      warnings: [expect.objectContaining({ code: 'SUSPICIOUS_DETOUR' })],
    });
    const warningMessage = result.warnings?.[0]?.message ?? '';
    expect(warningMessage).toContain('Bremen to Hirtshals');
    expect(warningMessage).toContain('1373 km');
    expect(warningMessage).toContain('507 km direct');
    expect(warningMessage).toContain('2.7x');
    expect(warningMessage).toContain('866 km excess');
  });

  it('keeps every ambiguous split sibling review-required until intent is explicitly resolved', async () => {
    const origin = createDestination({ name: 'Origin', coordinates: { lat: 0, lng: 0 } });
    const middle = createDestination({ name: 'Middle', coordinates: { lat: 0, lng: 5 } });
    const target = createDestination({ name: 'Target', coordinates: { lat: 0, lng: 10 } });
    const unresolvedIntent = {
      movement: 'drive' as const,
      calculation: 'automatic' as const,
      ferryPolicy: 'require' as const,
      waypoints: [],
      notes: '',
    };
    const warning = {
      code: 'ROUTE_INTENT_REASSIGNMENT_REQUIRED' as const,
      message: 'Resolve intent.',
      context: { sourceRouteLegId: 'source-leg', unresolvedIntent },
    };
    const siblings = [
      createRouteLeg({ originDestinationId: origin.id, targetDestinationId: middle.id, type: 'driving-auto', status: 'review-required', warnings: [warning] }),
      createRouteLeg({ originDestinationId: middle.id, targetDestinationId: target.id, type: 'driving-auto', status: 'review-required', warnings: [] }),
    ];
    const calculateRoute: CalculateRoute = async ({ origin: routeOrigin, target: routeTarget }) => ({
      distanceKm: 5,
      travelTimeHours: 1,
      geometry: { type: 'LineString' as const, coordinates: [[routeOrigin.lng, routeOrigin.lat], [routeTarget.lng, routeTarget.lat]] },
      provider: 'test',
      profile: 'driving-car' as const,
      sections: [{ kind: 'road' as const, startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 5 }],
    });

    const calculated = await calculateAutomaticRouteLegs({
      destinations: [origin, middle, target],
      routeLegs: siblings,
      routingVehicle: resolveVehiclePreset('standard'),
      calculateRoute,
    });

    expect(calculated.map((leg) => leg.status)).toEqual(['review-required', 'review-required']);
    expect(calculated.flatMap((leg) => leg.warnings ?? [])).toEqual([warning]);

    const resolved = await calculateAutomaticRouteLegs({
      destinations: [origin, middle, target],
      routeLegs: calculated.map((leg) => ({ ...leg, status: 'pending' as const, warnings: [] })),
      routingVehicle: resolveVehiclePreset('standard'),
      calculateRoute,
    });
    expect(resolved.map((leg) => leg.status)).toEqual(['ready', 'ready']);
  });

  it('fails incomplete provider output instead of silently accepting missing sections', async () => {
    const origin = createDestination({ name: 'Calais', coordinates: { lat: 50.9513, lng: 1.8587 } });
    const target = createDestination({ name: 'Dover', coordinates: { lat: 51.1279, lng: 1.3134 } });
    const calculateWithoutSections = (async () => ({
      distanceKm: 80,
      travelTimeHours: 2,
      geometry: { type: 'LineString' as const, coordinates: [[1.8587, 50.9513], [1.3134, 51.1279]] },
      provider: 'untyped-provider',
      profile: 'driving-car' as const,
    })) as unknown as CalculateRoute;

    const [result] = await calculateAutomaticRouteLegs({
      destinations: [origin, target],
      routeLegs: [createRouteLeg({
        originDestinationId: origin.id,
        targetDestinationId: target.id,
        type: 'driving-auto',
      })],
      routingVehicle: resolveVehiclePreset('standard'),
      calculateRoute: calculateWithoutSections,
    });

    expect(result).toMatchObject({
      status: 'failed',
      geometry: undefined,
      sections: [],
      error: 'Route calculation returned incomplete section metadata',
    });
  });

  it('clears stale calculated data when a failed leg is retried', async () => {
    const origin = createDestination({ name: 'Ghent', coordinates: { lat: 51.0538, lng: 3.725 } });
    const target = createDestination({ name: 'Hamburg', coordinates: { lat: 53.5502, lng: 10.0013 } });
    const staleLeg = createRouteLeg({
      originDestinationId: origin.id,
      targetDestinationId: target.id,
      type: 'driving-auto',
      status: 'failed',
      distanceKm: 999,
      travelTimeHours: 99,
      geometry: { type: 'LineString', coordinates: [[3.725, 51.0538], [10.0013, 53.5502]] },
      provider: 'stale',
      sections: [{ kind: 'ferry', startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 999 }],
      warnings: [{ code: 'SUSPICIOUS_DETOUR', message: 'stale' }],
      calculatedAt: new Date().toISOString(),
      error: 'stale failure',
    });

    const [result] = await calculateAutomaticRouteLegs({
      destinations: [origin, target],
      routeLegs: [staleLeg],
      routingVehicle: resolveVehiclePreset('standard'),
      retryFailed: true,
      calculateRoute: async () => { throw new Error('retry failed'); },
    });

    expect(result).toMatchObject({
      status: 'failed',
      distanceKm: undefined,
      travelTimeHours: undefined,
      geometry: undefined,
      provider: undefined,
      sections: [],
      warnings: [],
      calculatedAt: undefined,
      error: 'retry failed',
    });
  });

  it('invalidates every automatic leg for a vehicle change and preserves manual shipping', () => {
    const origin = createDestination({ name: 'Cartagena', coordinates: { lat: 10.391, lng: -75.4794 } });
    const target = createDestination({ name: 'Colón', coordinates: { lat: 9.3592, lng: -79.9014 } });
    const automatic = createRouteLeg({
      originDestinationId: origin.id,
      targetDestinationId: target.id,
      type: 'driving-auto',
      status: 'ready',
      distanceKm: 600,
      travelTimeHours: 8,
      geometry: { type: 'LineString', coordinates: [[-75.4794, 10.391], [-79.9014, 9.3592]] },
      provider: 'test',
      sections: [{ kind: 'road', startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 600 }],
      routeKey: 'old-key',
      calculatedAt: new Date().toISOString(),
    });
    const manual = createRouteLeg({
      originDestinationId: target.id,
      targetDestinationId: origin.id,
      type: 'shipping-manual',
      status: 'manual',
      geometry: { type: 'LineString', coordinates: [[-79.9014, 9.3592], [-75.4794, 10.391]] },
    });
    const vehicle = resolveVehiclePreset('expedition-truck');

    const [recalculated, preserved] = recalculateAutomaticRouteLegsForVehicle({
      destinations: [origin, target],
      routeLegs: [automatic, manual],
      routingVehicle: vehicle,
    });

    expect(recalculated).toMatchObject({
      status: 'pending',
      profile: 'driving-hgv',
      distanceKm: undefined,
      travelTimeHours: undefined,
      geometry: undefined,
      provider: undefined,
      sections: [],
      warnings: [],
      calculatedAt: undefined,
      error: undefined,
      routeKey: createRouteKey({
        origin: origin.coordinates,
        target: target.coordinates,
        routingVehicle: vehicle,
      }),
    });
    expect(preserved).toBe(manual);
  });
});
