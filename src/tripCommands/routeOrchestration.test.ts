import { describe, expect, it, vi } from 'vitest';
import { OpenRouteServiceError } from '../adapters/openRouteService';
import { createDestination } from '../domain/destinations';
import { createRouteKey, createRouteLeg } from '../domain/routeLegs';
import { resolveVehiclePreset } from '../domain/vehiclePresets';
import type { RouteLeg } from '../domain/types';
import {
  applyCalculatedRouteResult,
  calculateAutomaticRouteLegs,
  finalizeRouteLeg,
  recalculateAutomaticRouteLegsForVehicle,
  reconcileAndSaveRouteLegs,
  type CalculateRoute,
} from './routeOrchestration';

const assertCalculateRouteContract = () => {
  // @ts-expect-error normalized route calculations require section metadata
  const missingSectionsCalculator: CalculateRoute = async () => ({
    distanceKm: 100,
    travelTimeHours: 2,
    geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
    provider: 'test',
    profile: 'driving-car',
  });
  void missingSectionsCalculator;
};
void assertCalculateRouteContract;

function createRepository(routeLegs: RouteLeg[] = []) {
  return {
    saveDestination: vi.fn(async () => {}),
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
  it('returns recovered route legs and destination anchor updates as one batch', async () => {
    const origin = createDestination({ name: 'Olderdalen', coordinates: { lat: 69.6041, lng: 20.5326 } });
    const alta = createDestination({ name: 'Alta', coordinates: { lat: 69.96887, lng: 23.27165 } });
    const altaAnchor = {
      profile: 'driving-car' as const,
      coordinates: { lat: 69.98334, lng: 23.27165 },
      originalCoordinates: alta.coordinates,
      snapDistanceKm: 1.609,
      provider: 'openrouteservice' as const,
      resolvedAt: '2026-07-11T00:00:00.000Z',
    };
    const routeLeg = createRouteLeg({
      originDestinationId: origin.id,
      targetDestinationId: alta.id,
      movement: 'drive',
      calculation: 'automatic',
    });
    const calculateRoute = vi.fn(async () => ({
      distanceKm: 361,
      travelTimeHours: 5.4,
      geometry: {
        type: 'LineString' as const,
        coordinates: [
          [origin.coordinates.lng, origin.coordinates.lat],
          [altaAnchor.coordinates.lng, altaAnchor.coordinates.lat],
        ],
      },
      provider: 'openrouteservice',
      profile: 'driving-car' as const,
      sections: [{ kind: 'road' as const, startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 361 }],
      warnings: [{
        code: 'ROUTING_ANCHOR_ADJUSTED' as const,
        message: 'Alta uses a routing point 1.6 km from the stop.',
      }],
      endpointAnchors: { target: altaAnchor },
    }));

    const result = await calculateAutomaticRouteLegs({
      destinations: [origin, alta],
      routeLegs: [routeLeg],
      routingVehicle: resolveVehiclePreset('standard'),
      calculateRoute,
    });

    expect(result.routeLegs[0]).toMatchObject({
      status: 'ready',
      distanceKm: 361,
      travelTimeHours: 5.4,
      warnings: [expect.objectContaining({ code: 'ROUTING_ANCHOR_ADJUSTED' })],
    });
    expect(result.routeLegs[0]).not.toHaveProperty('endpointAnchors');
    expect(result.destinations[0]).toBe(origin);
    expect(result.destinations[1].routingAnchors['driving-car']).toEqual(altaAnchor);
    expect(result.destinations[1]).toMatchObject({
      id: alta.id,
      name: alta.name,
      coordinates: alta.coordinates,
      routingAnchors: { 'driving-car': altaAnchor },
    });
    expect(result.destinations[1].updatedAt >= alta.updatedAt).toBe(true);
  });

  it('recovers Alta at 1.609 km and reuses its anchor on the outbound leg', async () => {
    const olderdalen = createDestination({ name: 'Olderdalen', coordinates: { lat: 69.6041, lng: 20.5326 } });
    const alta = createDestination({ name: 'Alta', coordinates: { lat: 69.96887, lng: 23.27165 } });
    const kautokeino = createDestination({ name: 'Kautokeino', coordinates: { lat: 69.0125, lng: 23.0412 } });
    const altaAnchorCoordinates = { lat: 69.98334, lng: 23.27165 };
    const routeLegs = [
      createRouteLeg({
        originDestinationId: olderdalen.id,
        targetDestinationId: alta.id,
        movement: 'drive',
        calculation: 'automatic',
      }),
      createRouteLeg({
        originDestinationId: alta.id,
        targetDestinationId: kautokeino.id,
        movement: 'drive',
        calculation: 'automatic',
      }),
    ];
    let attempt = 0;
    const calculateRoute: CalculateRoute = vi.fn(async (request) => {
      attempt += 1;
      if (attempt === 1) {
        throw new OpenRouteServiceError({
          status: 404,
          code: 2010,
          coordinateIndex: 1,
          profile: 'driving-car',
          providerMessage: 'Could not find routable point within a radius of 350.0 meters of specified coordinate 1.',
        });
      }
      const target = attempt === 2 ? altaAnchorCoordinates : request.target;
      return {
        distanceKm: attempt === 2 ? 361 : 132,
        travelTimeHours: attempt === 2 ? 5.4 : 2.1,
        geometry: {
          type: 'LineString' as const,
          coordinates: [[request.origin.lng, request.origin.lat], [target.lng, target.lat]],
        },
        provider: 'openrouteservice',
        profile: 'driving-car' as const,
        sections: [{
          kind: 'road' as const,
          startGeometryIndex: 0,
          endGeometryIndex: 1,
          distanceKm: attempt === 2 ? 361 : 132,
        }],
      };
    });

    const result = await calculateAutomaticRouteLegs({
      destinations: [olderdalen, alta, kautokeino],
      routeLegs,
      routingVehicle: resolveVehiclePreset('standard'),
      calculateRoute,
    });

    expect(calculateRoute).toHaveBeenCalledTimes(3);
    expect(calculateRoute).toHaveBeenNthCalledWith(2, expect.objectContaining({
      target: alta.coordinates,
      radiuses: [350, 2000],
    }));
    expect(calculateRoute).toHaveBeenNthCalledWith(3, expect.objectContaining({
      origin: altaAnchorCoordinates,
      target: kautokeino.coordinates,
    }));
    expect(vi.mocked(calculateRoute).mock.calls[2][0]).not.toHaveProperty('radiuses');
    expect(result.destinations[1].routingAnchors['driving-car']).toMatchObject({
      coordinates: altaAnchorCoordinates,
      originalCoordinates: alta.coordinates,
    });
    expect(result.destinations[1].routingAnchors['driving-car']?.snapDistanceKm).toBeCloseTo(1.609, 3);
    expect(result.routeLegs).toMatchObject([
      { status: 'ready', warnings: [{ code: 'ROUTING_ANCHOR_ADJUSTED' }] },
      { status: 'ready', warnings: [{ code: 'ROUTING_ANCHOR_ADJUSTED' }] },
    ]);
  });

  it.each([
    {
      name: 'required ferry missing',
      ferryPolicy: 'require' as const,
      sections: [{ kind: 'road' as const, startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 800 }],
      distanceKm: 800,
      status: 'failed',
      warningCode: 'FERRY_REQUIRED_NOT_FOUND',
      retainsGeometry: false,
    },
    {
      name: 'avoided ferry returned',
      ferryPolicy: 'avoid' as const,
      sections: [{ kind: 'ferry' as const, startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 800 }],
      distanceKm: 800,
      status: 'failed',
      warningCode: 'FERRY_AVOIDED_BUT_FOUND',
      retainsGeometry: false,
    },
    {
      name: 'suspicious detour',
      ferryPolicy: 'allow' as const,
      sections: [{ kind: 'road' as const, startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 1372.6 }],
      distanceKm: 1372.6,
      status: 'review-required',
      warningCode: 'SUSPICIOUS_DETOUR',
      retainsGeometry: true,
    },
  ])('validates an applied route result when $name', ({
    ferryPolicy,
    sections,
    distanceKm,
    status,
    warningCode,
    retainsGeometry,
  }) => {
    const origin = createDestination({ name: 'Bremen', coordinates: { lat: 53.0793, lng: 8.8017 } });
    const target = createDestination({ name: 'Hirtshals', coordinates: { lat: 57.5881, lng: 9.9598 } });
    const geometry = { type: 'LineString' as const, coordinates: [[8.8017, 53.0793], [9.9598, 57.5881]] };
    const routeLeg = createRouteLeg({
      originDestinationId: origin.id,
      targetDestinationId: target.id,
      movement: 'drive', calculation: 'automatic',
      status: 'review-required',
      ferryPolicy,
      warnings: [{ code: 'SUSPICIOUS_DETOUR', message: 'stale warning' }],
      notes: 'Preserve these notes.',
    });

    const result = applyCalculatedRouteResult({
      routeLeg,
      origin,
      target,
      routeKey: 'selected-option',
      route: {
        distanceKm,
        travelTimeHours: 18,
        geometry,
        provider: 'test',
        profile: 'driving-car',
        sections,
      },
    });

    expect(result).toMatchObject({
      status,
      distanceKm: undefined,
      travelTimeHours: undefined,
      geometry: retainsGeometry ? geometry : undefined,
      warnings: [expect.objectContaining({ code: warningCode })],
      movement: routeLeg.movement,
      calculation: routeLeg.calculation,
      ferryPolicy,
      waypoints: routeLeg.waypoints,
      notes: 'Preserve these notes.',
    });
  });

  it('marks a valid applied option ready and clears stale calculated warnings', () => {
    const origin = createDestination({ name: 'Bremen', coordinates: { lat: 53.0793, lng: 8.8017 } });
    const target = createDestination({ name: 'Hamburg', coordinates: { lat: 53.5502, lng: 10.0013 } });
    const routeLeg = createRouteLeg({
      originDestinationId: origin.id,
      targetDestinationId: target.id,
      movement: 'drive', calculation: 'automatic',
      status: 'review-required',
      warnings: [{ code: 'SUSPICIOUS_DETOUR', message: 'stale warning' }],
    });
    const geometry = { type: 'LineString' as const, coordinates: [[8.8017, 53.0793], [10.0013, 53.5502]] };

    const result = applyCalculatedRouteResult({
      routeLeg,
      origin,
      target,
      routeKey: 'valid-option',
      route: {
        distanceKm: 125,
        travelTimeHours: 2,
        geometry,
        provider: 'test',
        profile: 'driving-car',
        sections: [{ kind: 'road', startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 125 }],
      },
    });

    expect(result).toMatchObject({
      status: 'ready',
      distanceKm: 125,
      travelTimeHours: 2,
      geometry,
      warnings: [],
      error: undefined,
    });
  });

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
      movement: 'drive', calculation: 'automatic',
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
      movement: 'drive', calculation: 'automatic',
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
      profile: 'driving-car' as const,
      sections: [{ kind: 'ferry' as const, startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 200 }],
    }));

    await calculateAutomaticRouteLegs({
      destinations: [origin, target],
      routeLegs: [createRouteLeg({
        originDestinationId: origin.id,
        targetDestinationId: target.id,
        movement: 'drive', calculation: 'automatic',
        ferryPolicy: 'require',
        waypoints: [waypoint],
      })],
      routingVehicle,
      calculateRoute,
    });

    expect(calculateRoute).toHaveBeenCalledWith({
      origin: origin.coordinates,
      target: target.coordinates,
      profile: 'driving-car',
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
    const calculation = await calculateAutomaticRouteLegs({
      destinations: [origin, target],
      routeLegs: [createRouteLeg({
        originDestinationId: origin.id,
        targetDestinationId: target.id,
        movement: 'drive', calculation: 'automatic',
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
    const [result] = calculation.routeLegs;

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
    const calculation = await calculateAutomaticRouteLegs({
      destinations: [bremen, hirtshals],
      routeLegs: [createRouteLeg({
        originDestinationId: bremen.id,
        targetDestinationId: hirtshals.id,
        movement: 'drive', calculation: 'automatic',
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
    const [result] = calculation.routeLegs;

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
      createRouteLeg({ originDestinationId: origin.id, targetDestinationId: middle.id, movement: 'drive', calculation: 'automatic', status: 'review-required', warnings: [warning] }),
      createRouteLeg({ originDestinationId: middle.id, targetDestinationId: target.id, movement: 'drive', calculation: 'automatic', status: 'review-required', warnings: [] }),
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

    expect(calculated.routeLegs.map((leg) => leg.status)).toEqual(['review-required', 'review-required']);
    expect(calculated.routeLegs.flatMap((leg) => leg.warnings ?? [])).toEqual([warning]);

    const resolved = await calculateAutomaticRouteLegs({
      destinations: [origin, middle, target],
      routeLegs: calculated.routeLegs.map((leg) => ({ ...leg, status: 'pending' as const, warnings: [] })),
      routingVehicle: resolveVehiclePreset('standard'),
      calculateRoute,
    });
    expect(resolved.routeLegs.map((leg) => leg.status)).toEqual(['ready', 'ready']);
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

    const calculation = await calculateAutomaticRouteLegs({
      destinations: [origin, target],
      routeLegs: [createRouteLeg({
        originDestinationId: origin.id,
        targetDestinationId: target.id,
        movement: 'drive', calculation: 'automatic',
      })],
      routingVehicle: resolveVehiclePreset('standard'),
      calculateRoute: calculateWithoutSections,
    });
    const [result] = calculation.routeLegs;

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
      movement: 'drive', calculation: 'automatic',
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

    const calculation = await calculateAutomaticRouteLegs({
      destinations: [origin, target],
      routeLegs: [staleLeg],
      routingVehicle: resolveVehiclePreset('standard'),
      retryFailed: true,
      calculateRoute: async () => { throw new Error('retry failed'); },
    });
    const [result] = calculation.routeLegs;

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
      movement: 'drive', calculation: 'automatic',
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
      movement: 'vehicle-shipping', calculation: 'manual',
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

  it('finalizes a manual-to-automatic toggle with the expedition truck snapshot', async () => {
    const origin = createDestination({ name: 'Panama City', coordinates: { lat: 9, lng: -79.5 } });
    const target = createDestination({ name: 'Cartagena', coordinates: { lat: 10.4, lng: -75.5 } });
    const routingVehicle = resolveVehiclePreset('expedition-truck');
    const calculateRoute = vi.fn(async ({ origin: routeOrigin, target: routeTarget }) => ({
      distanceKm: 500, travelTimeHours: 8,
      geometry: { type: 'LineString' as const, coordinates: [[routeOrigin.lng, routeOrigin.lat], [routeTarget.lng, routeTarget.lat]] },
      provider: 'test', profile: 'driving-hgv' as const,
      sections: [{ kind: 'road' as const, startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 500 }],
    }));

    await finalizeRouteLeg({
      routeLeg: createRouteLeg({
        originDestinationId: origin.id, targetDestinationId: target.id,
        movement: 'drive', calculation: 'automatic', status: 'pending',
      }),
      destinations: [origin, target], routingVehicle, calculateRoute,
    });

    expect(calculateRoute).toHaveBeenCalledWith(expect.objectContaining({
      profile: 'driving-hgv', routingVehicle,
    }));
  });
});
