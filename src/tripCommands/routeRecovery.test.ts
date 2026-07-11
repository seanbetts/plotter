import { describe, expect, it, vi } from 'vitest';
import type { Coordinates, FerryPolicy, RouteWaypoint, RoutingAnchor, TripRoutingVehicle } from '../domain/types';
import { resolveVehiclePreset } from '../domain/vehiclePresets';
import { OpenRouteServiceError } from '../adapters/openRouteService';
import {
  calculateRouteWithRecovery,
  type CalculateProviderRoute,
  type ProviderRouteRequest,
} from './routeRecovery';

const alta = { lat: 69.96887, lng: 23.27165 };
const altaAnchorCoordinates = { lat: 69.98334, lng: 23.27165 };
const balcombe = { lat: 51.0573, lng: -0.1349 };
const hirtshals = { lat: 57.5948, lng: 9.9796 };

const expeditionVehicle = resolveVehiclePreset('expedition-truck');
const carVehicle = resolveVehiclePreset('standard');
const waypoints: RouteWaypoint[] = [{
  id: 'hirtshals',
  order: 0,
  name: 'Hirtshals',
  coordinates: hirtshals,
  location: {
    placeName: 'Hirtshals',
    regionName: 'North Jutland',
    countryName: 'Denmark',
    sourceLabel: 'Hirtshals, Denmark',
    sourceProvider: 'legacy',
  },
  notes: '',
  links: [],
}];

const expeditionInput = {
  origin: balcombe,
  target: alta,
  profile: 'driving-hgv' as const,
  routingVehicle: expeditionVehicle,
  waypoints,
  ferryPolicy: 'require' as FerryPolicy,
};

function orsError(input: {
  status: number;
  code?: number;
  profile: TripRoutingVehicle['profile'];
  coordinateIndex?: number;
}) {
  return new OpenRouteServiceError({
    status: input.status,
    code: input.code,
    profile: input.profile,
    coordinateIndex: input.coordinateIndex,
    providerMessage: input.code === 2010
      ? `Could not find routable point within a radius of 350.0 meters of specified coordinate ${input.coordinateIndex ?? 1}.`
      : input.code === 2009
        ? 'Route could not be found between locations.'
        : 'Provider failure.',
  });
}

function routeFor(input: {
  origin: Coordinates;
  target: Coordinates;
  profile: TripRoutingVehicle['profile'];
}) {
  return {
    distanceKm: 361,
    travelTimeHours: 5.4,
    geometry: {
      type: 'LineString' as const,
      coordinates: [
        [input.origin.lng, input.origin.lat],
        [input.target.lng, input.target.lat],
      ],
    },
    provider: 'openrouteservice',
    profile: input.profile,
    sections: [{ kind: 'road' as const, startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 361 }],
  };
}

function savedAnchor(profile: TripRoutingVehicle['profile'], originalCoordinates: Coordinates, coordinates: Coordinates): RoutingAnchor {
  return {
    profile,
    coordinates,
    originalCoordinates,
    snapDistanceKm: 1.25,
    provider: 'openrouteservice',
    resolvedAt: '2026-07-11T00:00:00.000Z',
  };
}

describe('route recovery', () => {
  it.each([
    { status: 404, code: 3001 },
    { status: 401, code: undefined },
    { status: 403, code: undefined },
    { status: 429, code: 3099 },
    { status: 500, code: undefined },
  ])('does not change profile for $status failures', async ({ status, code }) => {
    const calculate = vi.fn().mockRejectedValue(
      orsError({ status, code, profile: 'driving-hgv' }),
    );
    await expect(calculateRouteWithRecovery(expeditionInput, calculate)).rejects.toMatchObject({ status });
    expect(calculate).toHaveBeenCalledTimes(1);
  });

  it('recovers a car endpoint with a 2 km radius and returns a target anchor warning', async () => {
    const calculate: CalculateProviderRoute = vi.fn(async (request: ProviderRouteRequest) => {
      if (!request.radiuses) throw orsError({ status: 404, code: 2010, profile: 'driving-car', coordinateIndex: 1 });
      return routeFor({ origin: request.origin, target: altaAnchorCoordinates, profile: request.profile });
    });

    const result = await calculateRouteWithRecovery({
      origin: balcombe,
      target: alta,
      profile: 'driving-car',
      routingVehicle: carVehicle,
      waypoints: [],
      ferryPolicy: 'allow',
    }, calculate);

    expect(calculate).toHaveBeenNthCalledWith(2, expect.objectContaining({
      profile: 'driving-car',
      radiuses: [350, 2000],
    }));
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: 'ROUTING_ANCHOR_ADJUSTED' }),
    ]);
    expect(result.endpointAnchors.target).toMatchObject({
      profile: 'driving-car',
      coordinates: altaAnchorCoordinates,
      originalCoordinates: alta,
      provider: 'openrouteservice',
    });
    expect(result.endpointAnchors.target?.snapDistanceKm).toBeCloseTo(1.61, 2);
  });

  it('rejects endpoint recovery when the provider snaps beyond the 2 km endpoint radius', async () => {
    const beyondRadius = { lat: 70.1, lng: 23.27165 };
    const calculate: CalculateProviderRoute = vi.fn(async (request: ProviderRouteRequest) => {
      if (!request.radiuses) throw orsError({ status: 404, code: 2010, profile: 'driving-car', coordinateIndex: 1 });
      return routeFor({ origin: request.origin, target: beyondRadius, profile: request.profile });
    });

    await expect(calculateRouteWithRecovery({
      origin: balcombe,
      target: alta,
      profile: 'driving-car',
      routingVehicle: carVehicle,
      waypoints: [],
      ferryPolicy: 'allow',
    }, calculate)).rejects.toThrow(/2 km endpoint radius/);
  });

  it('does not fall back from a car endpoint recovery failure', async () => {
    const calculate: CalculateProviderRoute = vi.fn(async (request: ProviderRouteRequest) => {
      if (!request.radiuses) {
        throw orsError({ status: 404, code: 2010, profile: 'driving-car', coordinateIndex: 1 });
      }
      throw orsError({ status: 404, code: 2010, profile: 'driving-car', coordinateIndex: 1 });
    });

    await expect(calculateRouteWithRecovery({
      origin: balcombe,
      target: alta,
      profile: 'driving-car',
      routingVehicle: carVehicle,
      waypoints: [],
      ferryPolicy: 'allow',
    }, calculate)).rejects.toMatchObject({ code: 2010, profile: 'driving-car' });
    expect(calculate).toHaveBeenCalledTimes(2);
    expect(calculate).toHaveBeenNthCalledWith(2, expect.objectContaining({
      profile: 'driving-car',
      radiuses: [350, 2000],
    }));
  });

  it('falls back from HGV 2009 to driving-car while preserving waypoints and ferry policy', async () => {
    const calculate: CalculateProviderRoute = vi.fn(async (request: ProviderRouteRequest) => {
      if (request.profile === 'driving-hgv') throw orsError({ status: 404, code: 2009, profile: 'driving-hgv' });
      return routeFor({ origin: request.origin, target: request.target, profile: request.profile });
    });

    const result = await calculateRouteWithRecovery(expeditionInput, calculate);

    expect(calculate).toHaveBeenNthCalledWith(2, expect.objectContaining({
      profile: 'driving-car',
      waypoints,
      ferryPolicy: 'require',
    }));
    expect(result.profile).toBe('driving-car');
    expect(result).toMatchObject({
      distanceKm: 361,
      travelTimeHours: 5.4,
      geometry: expect.objectContaining({ type: 'LineString' }),
    });
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: 'VEHICLE_PROFILE_FALLBACK' }),
    ]);
  });

  it('routes a large camper from Lillehammer to Oslo as a car without a fallback warning', async () => {
    const lillehammer = { lat: 61.1153, lng: 10.4662 };
    const oslo = { lat: 59.9139, lng: 10.7522 };
    const largeCamper = resolveVehiclePreset('large-camper');
    const calculate: CalculateProviderRoute = vi.fn(async (request: ProviderRouteRequest) => (
      routeFor({ origin: request.origin, target: request.target, profile: request.profile })
    ));

    const result = await calculateRouteWithRecovery({
      origin: lillehammer,
      target: oslo,
      profile: largeCamper.profile,
      routingVehicle: largeCamper,
      waypoints: [],
      ferryPolicy: 'allow',
    }, calculate);

    expect(calculate).toHaveBeenCalledTimes(1);
    expect(calculate).toHaveBeenCalledWith(expect.objectContaining({
      profile: 'driving-car',
      routingVehicle: largeCamper,
    }));
    expect(result.profile).toBe('driving-car');
    expect(result.warnings).toEqual([]);
  });

  it('tries HGV endpoint recovery before car fallback and car endpoint recovery for HGV 2010', async () => {
    const calculate: CalculateProviderRoute = vi.fn(async (request: ProviderRouteRequest) => {
      const targetIndex = request.waypoints.length + 1;
      if (request.profile === 'driving-hgv') throw orsError({ status: 404, code: 2010, profile: 'driving-hgv', coordinateIndex: targetIndex });
      if (!request.radiuses) throw orsError({ status: 404, code: 2010, profile: 'driving-car', coordinateIndex: targetIndex });
      return routeFor({ origin: request.origin, target: altaAnchorCoordinates, profile: request.profile });
    });

    const result = await calculateRouteWithRecovery(expeditionInput, calculate);

    expect(calculate).toHaveBeenNthCalledWith(1, expect.objectContaining({ profile: 'driving-hgv' }));
    expect(vi.mocked(calculate).mock.calls[0][0]).not.toHaveProperty('radiuses');
    expect(calculate).toHaveBeenNthCalledWith(2, expect.objectContaining({ profile: 'driving-hgv', radiuses: [350, 350, 2000] }));
    expect(calculate).toHaveBeenNthCalledWith(3, expect.objectContaining({ profile: 'driving-car' }));
    expect(vi.mocked(calculate).mock.calls[2][0]).not.toHaveProperty('radiuses');
    expect(calculate).toHaveBeenNthCalledWith(4, expect.objectContaining({ profile: 'driving-car', radiuses: [350, 350, 2000] }));
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      'VEHICLE_PROFILE_FALLBACK',
      'ROUTING_ANCHOR_ADJUSTED',
    ]);
    expect(result.endpointAnchors.target).toMatchObject({ profile: 'driving-car' });
  });

  it('falls back to car when HGV endpoint recovery snaps beyond the 2 km guard', async () => {
    const hgvBeyondRadius = { lat: 70.1, lng: 23.27165 };
    const calculate: CalculateProviderRoute = vi.fn(async (request: ProviderRouteRequest) => {
      const targetIndex = request.waypoints.length + 1;
      if (request.profile === 'driving-hgv' && !request.radiuses) {
        throw orsError({ status: 404, code: 2010, profile: 'driving-hgv', coordinateIndex: targetIndex });
      }
      if (request.profile === 'driving-hgv') {
        return routeFor({ origin: request.origin, target: hgvBeyondRadius, profile: request.profile });
      }
      if (!request.radiuses) {
        throw orsError({ status: 404, code: 2010, profile: 'driving-car', coordinateIndex: targetIndex });
      }
      return routeFor({ origin: request.origin, target: altaAnchorCoordinates, profile: request.profile });
    });

    const result = await calculateRouteWithRecovery(expeditionInput, calculate);

    expect(calculate).toHaveBeenCalledTimes(4);
    expect(calculate).toHaveBeenNthCalledWith(2, expect.objectContaining({
      profile: 'driving-hgv',
      radiuses: [350, 350, 2000],
    }));
    expect(calculate).toHaveBeenNthCalledWith(3, expect.objectContaining({
      profile: 'driving-car',
      waypoints,
      ferryPolicy: 'require',
    }));
    expect(vi.mocked(calculate).mock.calls[2][0]).not.toHaveProperty('radiuses');
    expect(calculate).toHaveBeenNthCalledWith(4, expect.objectContaining({
      profile: 'driving-car',
      radiuses: [350, 350, 2000],
    }));
    expect(result.profile).toBe('driving-car');
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      'VEHICLE_PROFILE_FALLBACK',
      'ROUTING_ANCHOR_ADJUSTED',
    ]);
    expect(result.endpointAnchors.target).toMatchObject({
      profile: 'driving-car',
      coordinates: altaAnchorCoordinates,
      originalCoordinates: alta,
    });
  });

  it('propagates unrelated local errors from HGV endpoint recovery', async () => {
    const calculate: CalculateProviderRoute = vi.fn(async (request: ProviderRouteRequest) => {
      const targetIndex = request.waypoints.length + 1;
      if (!request.radiuses) {
        throw orsError({ status: 404, code: 2010, profile: 'driving-hgv', coordinateIndex: targetIndex });
      }
      return {
        ...routeFor({ origin: request.origin, target: request.target, profile: request.profile }),
        geometry: { type: 'LineString' as const, coordinates: [] },
      };
    });

    await expect(calculateRouteWithRecovery(expeditionInput, calculate))
      .rejects.toThrow('Route calculation returned invalid endpoint geometry');
    expect(calculate).toHaveBeenCalledTimes(2);
  });

  it('does not fall back to driving-car when HGV endpoint recovery hits quota', async () => {
    const calculate: CalculateProviderRoute = vi.fn(async (request: ProviderRouteRequest) => {
      const targetIndex = request.waypoints.length + 1;
      if (!request.radiuses) {
        throw orsError({ status: 404, code: 2010, profile: 'driving-hgv', coordinateIndex: targetIndex });
      }
      throw orsError({ status: 429, code: 3099, profile: 'driving-hgv' });
    });

    await expect(calculateRouteWithRecovery(expeditionInput, calculate)).rejects.toMatchObject({ status: 429 });
    expect(calculate).toHaveBeenCalledTimes(2);
    expect(calculate).toHaveBeenNthCalledWith(2, expect.objectContaining({
      profile: 'driving-hgv',
      radiuses: [350, 350, 2000],
    }));
  });

  it.each([
    {
      name: 'origin',
      coordinateIndex: 0,
      expectedRadiuses: [2000, 350, 350],
      snappedOrigin: { lat: 51.0718, lng: -0.1349 },
      snappedTarget: alta,
    },
    {
      name: 'target',
      coordinateIndex: 2,
      expectedRadiuses: [350, 350, 2000],
      snappedOrigin: balcombe,
      snappedTarget: altaAnchorCoordinates,
    },
  ])('aligns endpoint recovery radiuses for a $name 2010 with waypoints', async ({
    coordinateIndex,
    expectedRadiuses,
    snappedOrigin,
    snappedTarget,
  }) => {
    const calculate: CalculateProviderRoute = vi.fn(async (request: ProviderRouteRequest) => {
      if (!request.radiuses) {
        throw orsError({ status: 404, code: 2010, profile: 'driving-car', coordinateIndex });
      }
      return routeFor({ origin: snappedOrigin, target: snappedTarget, profile: request.profile });
    });

    await calculateRouteWithRecovery({
      origin: balcombe,
      target: alta,
      profile: 'driving-car',
      routingVehicle: carVehicle,
      waypoints,
      ferryPolicy: 'require',
    }, calculate);

    expect(calculate).toHaveBeenNthCalledWith(2, expect.objectContaining({
      radiuses: expectedRadiuses,
      waypoints,
      ferryPolicy: 'require',
    }));
  });

  it('does not recover a waypoint-index 2010 as an endpoint failure', async () => {
    const calculate = vi.fn().mockRejectedValue(
      orsError({ status: 404, code: 2010, profile: 'driving-car', coordinateIndex: 1 }),
    );

    await expect(calculateRouteWithRecovery({
      origin: balcombe,
      target: alta,
      profile: 'driving-car',
      routingVehicle: carVehicle,
      waypoints,
      ferryPolicy: 'allow',
    }, calculate)).rejects.toMatchObject({ code: 2010, coordinateIndex: 1 });
    expect(calculate).toHaveBeenCalledTimes(1);
  });

  it('preserves the opposite saved anchor during endpoint recovery', async () => {
    const originAnchor = savedAnchor('driving-car', balcombe, { lat: 51.06, lng: -0.13 });
    const calculate: CalculateProviderRoute = vi.fn(async (request: ProviderRouteRequest) => {
      if (!request.radiuses) {
        throw orsError({ status: 404, code: 2010, profile: 'driving-car', coordinateIndex: 2 });
      }
      return routeFor({ origin: request.origin, target: altaAnchorCoordinates, profile: request.profile });
    });

    const result = await calculateRouteWithRecovery({
      origin: balcombe,
      target: alta,
      profile: 'driving-car',
      routingVehicle: carVehicle,
      waypoints,
      ferryPolicy: 'allow',
      originAnchors: { 'driving-car': originAnchor },
    }, calculate);

    expect(calculate).toHaveBeenNthCalledWith(2, expect.objectContaining({
      origin: originAnchor.coordinates,
      target: alta,
      radiuses: [350, 350, 2000],
    }));
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: 'ROUTING_ANCHOR_ADJUSTED', message: expect.stringContaining('origin') }),
      expect.objectContaining({ code: 'ROUTING_ANCHOR_ADJUSTED', message: expect.stringContaining('target') }),
    ]);
    expect(result.endpointAnchors).toEqual({
      target: expect.objectContaining({ profile: 'driving-car' }),
    });
  });

  it('reuses an existing car anchor after HGV falls back to driving-car', async () => {
    const carTargetAnchor = savedAnchor('driving-car', alta, altaAnchorCoordinates);
    const calculate: CalculateProviderRoute = vi.fn(async (request: ProviderRouteRequest) => {
      if (request.profile === 'driving-hgv') {
        throw orsError({ status: 404, code: 2009, profile: 'driving-hgv' });
      }
      return routeFor({ origin: request.origin, target: request.target, profile: request.profile });
    });

    const result = await calculateRouteWithRecovery({
      ...expeditionInput,
      targetAnchors: { 'driving-car': carTargetAnchor },
    }, calculate);

    expect(calculate).toHaveBeenNthCalledWith(2, expect.objectContaining({
      profile: 'driving-car',
      target: carTargetAnchor.coordinates,
    }));
    expect(vi.mocked(calculate).mock.calls[1][0]).not.toHaveProperty('radiuses');
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: 'VEHICLE_PROFILE_FALLBACK',
        message: expect.stringContaining('truck dimensions were not validated'),
      }),
      expect.objectContaining({ code: 'ROUTING_ANCHOR_ADJUSTED', message: expect.stringContaining('target') }),
    ]);
    expect(result.endpointAnchors).toEqual({});
  });

  it.each([
    { endpoints: 'origin', useOrigin: true, useTarget: false },
    { endpoints: 'target', useOrigin: false, useTarget: true },
    { endpoints: 'origin and target', useOrigin: true, useTarget: true },
  ])('warns when a successful request reuses saved $endpoints anchors without returning them for persistence', async ({ useOrigin, useTarget }) => {
    const originAnchor = savedAnchor('driving-car', balcombe, { lat: 51.06, lng: -0.13 });
    const targetAnchor = savedAnchor('driving-car', alta, altaAnchorCoordinates);
    const calculate: CalculateProviderRoute = vi.fn(async (request: ProviderRouteRequest) => (
      routeFor({ origin: request.origin, target: request.target, profile: request.profile })
    ));

    const result = await calculateRouteWithRecovery({
      origin: balcombe,
      target: alta,
      profile: 'driving-car',
      routingVehicle: carVehicle,
      waypoints: [],
      ferryPolicy: 'allow',
      originAnchors: useOrigin ? { 'driving-car': originAnchor } : undefined,
      targetAnchors: useTarget ? { 'driving-car': targetAnchor } : undefined,
    }, calculate);

    expect(calculate).toHaveBeenCalledTimes(1);
    expect(calculate).toHaveBeenCalledWith(expect.objectContaining({
      origin: useOrigin ? originAnchor.coordinates : balcombe,
      target: useTarget ? targetAnchor.coordinates : alta,
    }));
    expect(vi.mocked(calculate).mock.calls[0][0]).not.toHaveProperty('radiuses');
    expect(result.warnings).toEqual([
      ...(useOrigin ? [expect.objectContaining({ code: 'ROUTING_ANCHOR_ADJUSTED', message: expect.stringContaining('origin') })] : []),
      ...(useTarget ? [expect.objectContaining({ code: 'ROUTING_ANCHOR_ADJUSTED', message: expect.stringContaining('target') })] : []),
    ]);
    expect(result.endpointAnchors).toEqual({});
  });

  it('uses only saved anchors matching the requested profile', async () => {
    const carOriginAnchor = savedAnchor('driving-car', balcombe, { lat: 51.06, lng: -0.13 });
    const hgvTargetAnchor = savedAnchor('driving-hgv', alta, altaAnchorCoordinates);
    const calculate: CalculateProviderRoute = vi.fn(async (request: ProviderRouteRequest) => (
      routeFor({ origin: request.origin, target: request.target, profile: request.profile })
    ));

    const result = await calculateRouteWithRecovery({
      ...expeditionInput,
      originAnchors: { 'driving-car': carOriginAnchor },
      targetAnchors: { 'driving-hgv': hgvTargetAnchor },
    }, calculate);

    expect(calculate).toHaveBeenCalledWith(expect.objectContaining({
      origin: balcombe,
      target: hgvTargetAnchor.coordinates,
    }));
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: 'ROUTING_ANCHOR_ADJUSTED', message: expect.stringContaining('target') }),
    ]);
    expect(result.endpointAnchors).toEqual({});
  });

  it.each([
    {
      name: 'embedded profile mismatch',
      anchor: { ...savedAnchor('driving-hgv', alta, altaAnchorCoordinates), profile: 'driving-car' } as RoutingAnchor,
    },
    {
      name: 'stale original coordinates',
      anchor: savedAnchor('driving-hgv', { lat: alta.lat - 0.01, lng: alta.lng }, altaAnchorCoordinates),
    },
    {
      name: 'coordinates outside the recovery radius',
      anchor: { ...savedAnchor('driving-hgv', alta, { lat: alta.lat + 0.03, lng: alta.lng }), snapDistanceKm: 1.25 },
    },
    {
      name: 'reported snap distance outside the recovery radius',
      anchor: { ...savedAnchor('driving-hgv', alta, altaAnchorCoordinates), snapDistanceKm: 2.01 },
    },
    {
      name: 'nonfinite coordinates',
      anchor: { ...savedAnchor('driving-hgv', alta, altaAnchorCoordinates), coordinates: { lat: Number.NaN, lng: alta.lng } },
    },
    {
      name: 'nonfinite snap distance',
      anchor: { ...savedAnchor('driving-hgv', alta, altaAnchorCoordinates), snapDistanceKm: Number.POSITIVE_INFINITY },
    },
    {
      name: 'non-ORS provider',
      anchor: { ...savedAnchor('driving-hgv', alta, altaAnchorCoordinates), provider: 'other' } as unknown as RoutingAnchor,
    },
  ])('ignores a saved anchor with $name before the provider request', async ({ anchor }) => {
    const calculate: CalculateProviderRoute = vi.fn(async (request: ProviderRouteRequest) => (
      routeFor({ origin: request.origin, target: request.target, profile: request.profile })
    ));

    const result = await calculateRouteWithRecovery({
      ...expeditionInput,
      targetAnchors: { 'driving-hgv': anchor },
    }, calculate);

    expect(calculate).toHaveBeenCalledTimes(1);
    expect(calculate).toHaveBeenCalledWith(expect.objectContaining({
      profile: 'driving-hgv',
      target: alta,
    }));
    expect(result.warnings).toEqual([]);
    expect(result.endpointAnchors).toEqual({});
  });

  it('does not fall back from car failures to HGV', async () => {
    const calculate = vi.fn().mockRejectedValue(
      orsError({ status: 404, code: 2009, profile: 'driving-car' }),
    );

    await expect(calculateRouteWithRecovery({
      origin: balcombe,
      target: alta,
      profile: 'driving-car',
      routingVehicle: carVehicle,
      waypoints: [],
      ferryPolicy: 'allow',
    }, calculate)).rejects.toMatchObject({ code: 2009 });
    expect(calculate).toHaveBeenCalledTimes(1);
  });
});
