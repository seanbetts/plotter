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
}) {
  return new OpenRouteServiceError({
    status: input.status,
    code: input.code,
    profile: input.profile,
    providerMessage: input.code === 2010
      ? 'Could not find routable point within a radius of 350.0 meters of specified coordinate 1.'
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
      if (!request.radiuses) throw orsError({ status: 404, code: 2010, profile: 'driving-car' });
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
      radiuses: [2000, 2000],
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
      if (!request.radiuses) throw orsError({ status: 404, code: 2010, profile: 'driving-car' });
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
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: 'VEHICLE_PROFILE_FALLBACK' }),
    ]);
  });

  it('tries HGV endpoint recovery before car fallback and car endpoint recovery for HGV 2010', async () => {
    const calculate: CalculateProviderRoute = vi.fn(async (request: ProviderRouteRequest) => {
      if (request.profile === 'driving-hgv') throw orsError({ status: 404, code: 2010, profile: 'driving-hgv' });
      if (!request.radiuses) throw orsError({ status: 404, code: 2010, profile: 'driving-car' });
      return routeFor({ origin: request.origin, target: altaAnchorCoordinates, profile: request.profile });
    });

    const result = await calculateRouteWithRecovery(expeditionInput, calculate);

    expect(calculate).toHaveBeenNthCalledWith(1, expect.objectContaining({ profile: 'driving-hgv' }));
    expect(vi.mocked(calculate).mock.calls[0][0]).not.toHaveProperty('radiuses');
    expect(calculate).toHaveBeenNthCalledWith(2, expect.objectContaining({ profile: 'driving-hgv', radiuses: [2000, 2000] }));
    expect(calculate).toHaveBeenNthCalledWith(3, expect.objectContaining({ profile: 'driving-car' }));
    expect(vi.mocked(calculate).mock.calls[2][0]).not.toHaveProperty('radiuses');
    expect(calculate).toHaveBeenNthCalledWith(4, expect.objectContaining({ profile: 'driving-car', radiuses: [2000, 2000] }));
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      'VEHICLE_PROFILE_FALLBACK',
      'ROUTING_ANCHOR_ADJUSTED',
    ]);
    expect(result.endpointAnchors.target).toMatchObject({ profile: 'driving-car' });
  });

  it('uses only saved anchors matching the requested profile and avoids rediscovery', async () => {
    const carOriginAnchor = savedAnchor('driving-car', balcombe, { lat: 51.06, lng: -0.13 });
    const hgvTargetAnchor = savedAnchor('driving-hgv', alta, altaAnchorCoordinates);
    const calculate: CalculateProviderRoute = vi.fn(async (request: ProviderRouteRequest) => (
      routeFor({ origin: request.origin, target: request.target, profile: request.profile })
    ));

    const result = await calculateRouteWithRecovery({
      ...expeditionInput,
      originAnchor: carOriginAnchor,
      targetAnchor: hgvTargetAnchor,
    }, calculate);

    expect(calculate).toHaveBeenCalledTimes(1);
    expect(calculate).toHaveBeenCalledWith(expect.objectContaining({
      origin: balcombe,
      target: hgvTargetAnchor.coordinates,
    }));
    expect(vi.mocked(calculate).mock.calls[0][0]).not.toHaveProperty('radiuses');
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
