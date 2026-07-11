import type { LineString } from 'geojson';
import { describe, expect, it } from 'vitest';
import { createRouteLeg } from './routeLegs';
import type { RouteSection } from './types';
import { resolveVehiclePreset } from './vehiclePresets';
import {
  createRouteOptionKey,
  dedupeRouteOptions,
  routeLegPatchFromRouteOption,
  routeOptionFromCalculation,
} from './routeOptions';

describe('route option helpers', () => {
  const origin = { lat: 51.5072, lng: -0.1276 };
  const target = { lat: 48.8566, lng: 2.3522 };
  const directGeometry: LineString = {
    type: 'LineString',
    coordinates: [
      [-0.1276, 51.5072],
      [2.3522, 48.8566],
    ],
  };
  const avoidHighwaysGeometry: LineString = {
    type: 'LineString',
    coordinates: [
      [-0.1276, 51.5072],
      [0.4, 50.8],
      [2.3522, 48.8566],
    ],
  };
  const sections: RouteSection[] = [
    { kind: 'road', startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 220 },
    { kind: 'ferry', startGeometryIndex: 1, endGeometryIndex: 2, distanceKm: 238.25 },
  ];

  it('creates canonical route option keys from the complete calculation contract', () => {
    const routingVehicle = resolveVehiclePreset('expedition-truck');
    expect(
      createRouteOptionKey({
        origin,
        target,
        routingVehicle,
        waypoints: [{ lat: 50, lng: 1 }],
        ferryPolicy: 'require',
        providerOptions: { alternativeRoutes: { targetCount: 3, shareFactor: 0.6, weightFactor: 2 } },
        variant: 'avoid:highways',
      }),
    ).toBe(createRouteOptionKey({
      target,
      origin,
      routingVehicle: {
        restrictions: { axleLoad: 7.5, weight: 15, height: 3.8, width: 2.55, length: 9 },
        vehicleType: 'hgv', profile: 'driving-hgv', preset: 'expedition-truck',
      },
      waypoints: [{ lng: 1, lat: 50 }],
      ferryPolicy: 'require',
      providerOptions: { alternativeRoutes: { weightFactor: 2, shareFactor: 0.6, targetCount: 3 } },
      variant: 'avoid:highways',
    }));
    expect(createRouteOptionKey({ origin, target, routingVehicle, variant: 'recommended' }))
      .not.toBe(createRouteOptionKey({
        origin, target, routingVehicle, variant: 'recommended', ferryPolicy: 'avoid',
      }));
  });

  it('normalizes calculated route options with labels and provider metadata', () => {
    const option = routeOptionFromCalculation({
      id: 'recommended',
      label: 'Recommended',
      source: 'recommended',
      origin,
      target,
      distanceKm: 458.25,
      travelTimeHours: 5,
      geometry: directGeometry,
      sections,
      provider: 'openrouteservice',
      profile: 'driving-car',
      variant: 'recommended',
    });

    expect(option).toEqual({
      id: 'recommended',
      label: 'Recommended',
      source: 'recommended',
      distanceKm: 458.25,
      travelTimeHours: 5,
      geometry: directGeometry,
      sections,
      provider: 'openrouteservice',
      profile: 'driving-car',
      routeKey: createRouteOptionKey({ origin, target, profile: 'driving-car', variant: 'recommended' }),
    });
  });

  it('deduplicates options with the same geometry while preserving order', () => {
    const recommended = routeOptionFromCalculation({
      id: 'recommended',
      label: 'Recommended',
      source: 'recommended',
      origin,
      target,
      distanceKm: 458.25,
      travelTimeHours: 5,
      geometry: directGeometry,
      sections,
      provider: 'openrouteservice',
      profile: 'driving-car',
      variant: 'recommended',
    });
    const duplicate = routeOptionFromCalculation({
      id: 'alternative-1',
      label: 'Alternative 1',
      source: 'provider-alternative',
      origin,
      target,
      distanceKm: 458.26,
      travelTimeHours: 5.01,
      geometry: directGeometry,
      sections,
      provider: 'openrouteservice',
      profile: 'driving-car',
      variant: 'alternative-1',
    });
    const avoidHighways = routeOptionFromCalculation({
      id: 'avoid-highways',
      label: 'Avoid highways',
      source: 'avoid-feature',
      origin,
      target,
      distanceKm: 520,
      travelTimeHours: 6.4,
      geometry: avoidHighwaysGeometry,
      sections,
      provider: 'openrouteservice',
      profile: 'driving-car',
      variant: 'avoid:highways',
    });

    expect(dedupeRouteOptions([recommended, duplicate, avoidHighways])).toEqual([
      recommended,
      avoidHighways,
    ]);
  });

  it('deduplicates options with the same route key while preserving the first option', () => {
    const recommended = routeOptionFromCalculation({
      id: 'recommended',
      label: 'Recommended',
      source: 'recommended',
      origin,
      target,
      distanceKm: 458.25,
      travelTimeHours: 5,
      geometry: directGeometry,
      sections,
      provider: 'openrouteservice',
      profile: 'driving-car',
      variant: 'recommended',
    });
    const duplicateRouteKey = routeOptionFromCalculation({
      id: 'recommended-recalculated',
      label: 'Recommended recalculated',
      source: 'provider-alternative',
      origin,
      target,
      distanceKm: 459,
      travelTimeHours: 5.1,
      geometry: avoidHighwaysGeometry,
      sections,
      provider: 'openrouteservice',
      profile: 'driving-car',
      variant: 'recommended',
    });

    expect(dedupeRouteOptions([recommended, duplicateRouteKey])).toEqual([recommended]);
    expect(duplicateRouteKey.geometry).not.toEqual(recommended.geometry);
    expect(duplicateRouteKey.routeKey).toBe(recommended.routeKey);
  });

  it('creates a route-leg patch from the selected option', () => {
    const routeLeg = createRouteLeg({
      originDestinationId: 'origin-id',
      targetDestinationId: 'target-id',
      movement: 'drive', calculation: 'automatic',
      status: 'ready',
      distanceKm: 458.25,
      travelTimeHours: 5,
      geometry: directGeometry,
      sections,
      provider: 'openrouteservice',
      profile: 'driving-car',
      routeKey: 'old-key',
    });
    const option = routeOptionFromCalculation({
      id: 'avoid-highways',
      label: 'Avoid highways',
      source: 'avoid-feature',
      origin,
      target,
      distanceKm: 520,
      travelTimeHours: 6.4,
      geometry: avoidHighwaysGeometry,
      sections,
      provider: 'openrouteservice',
      profile: 'driving-car',
      variant: 'avoid:highways',
    });

    expect(routeLegPatchFromRouteOption(option, '2026-07-04T12:00:00.000Z')).toEqual({
      movement: 'drive', calculation: 'automatic',
      status: 'ready',
      distanceKm: 520,
      travelTimeHours: 6.4,
      geometry: avoidHighwaysGeometry,
      sections,
      provider: 'openrouteservice',
      profile: 'driving-car',
      routeKey: option.routeKey,
      calculatedAt: '2026-07-04T12:00:00.000Z',
      error: undefined,
    });
    expect(routeLeg).not.toHaveProperty('type');
  });

  it('rejects applying an option whose section metadata is missing', () => {
    const malformedOption = {
      id: 'missing-sections',
      label: 'Missing sections',
      source: 'recommended',
      distanceKm: 458.25,
      travelTimeHours: 5,
      geometry: directGeometry,
      provider: 'openrouteservice',
      profile: 'driving-car',
      routeKey: 'missing-sections',
      sections: undefined,
    } as unknown as Parameters<typeof routeLegPatchFromRouteOption>[0];

    expect(() => routeLegPatchFromRouteOption(malformedOption)).toThrow(
      'Route option sections are required',
    );
  });
});
