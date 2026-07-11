import type { LineString } from 'geojson';
import { describe, expect, it } from 'vitest';
import { createRouteLeg } from './routeLegs';
import type { RouteSection, RoutingAnchor } from './types';
import { resolveVehiclePreset } from './vehiclePresets';
import {
  createRouteOptionKey,
  dedupeRouteOptions,
  ensureUniqueRouteOptionIds,
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
  const expeditionTruck = resolveVehiclePreset('expedition-truck');

  it('creates canonical route option keys from the complete calculation contract', () => {
    expect(
      createRouteOptionKey({
        origin,
        target,
        routingVehicle: expeditionTruck,
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
    expect(createRouteOptionKey({ origin, target, routingVehicle: expeditionTruck, variant: 'recommended' }))
      .not.toBe(createRouteOptionKey({
        origin, target, routingVehicle: expeditionTruck, variant: 'recommended', ferryPolicy: 'avoid',
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
      warnings: [],
      endpointAnchors: {},
    });
  });

  it('preserves recovery warnings, actual profile, and endpoint anchors in selected route patches', () => {
    const targetAnchor: RoutingAnchor = {
      profile: 'driving-car',
      coordinates: { lat: 48.858, lng: 2.35 },
      originalCoordinates: target,
      snapDistanceKm: 1.2,
      provider: 'openrouteservice',
      resolvedAt: '2026-07-11T00:00:00.000Z',
    };
    const fallback = routeOptionFromCalculation({
      id: 'profile-fallback',
      label: 'Car-profile fallback',
      source: 'profile-fallback',
      origin,
      target,
      distanceKm: 187,
      travelTimeHours: 3.27,
      geometry: directGeometry,
      sections: [{
        kind: 'road',
        startGeometryIndex: 0,
        endGeometryIndex: directGeometry.coordinates.length - 1,
        distanceKm: 187,
      }],
      provider: 'openrouteservice',
      profile: 'driving-car',
      routingVehicle: expeditionTruck,
      waypoints: [],
      ferryPolicy: 'allow',
      providerOptions: { fallbackFromProfile: 'driving-hgv' },
      variant: 'profile-fallback',
      warnings: [{
        code: 'VEHICLE_PROFILE_FALLBACK',
        message: 'Truck dimensions were not validated for this route.',
      }],
      endpointAnchors: { target: targetAnchor },
    });

    expect(fallback).toMatchObject({
      source: 'profile-fallback',
      warnings: [{
        code: 'VEHICLE_PROFILE_FALLBACK',
        message: 'Truck dimensions were not validated for this route.',
      }],
      endpointAnchors: { target: targetAnchor },
      profile: 'driving-car',
    });
    expect(routeLegPatchFromRouteOption(fallback)).toMatchObject({
      status: 'ready',
      warnings: fallback.warnings,
      profile: 'driving-car',
      distanceKm: fallback.distanceKm,
    });
    expect(fallback.routeKey).not.toBe(createRouteOptionKey({
      origin,
      target,
      profile: 'driving-hgv',
      routingVehicle: expeditionTruck,
      variant: 'recommended',
    }));
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

  it('deduplicates identical geometry without discarding recovery provenance for normal options', () => {
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
      profile: 'driving-hgv',
      routingVehicle: expeditionTruck,
      variant: 'recommended',
    });
    const adjustedEndpoint = routeOptionFromCalculation({
      id: 'adjusted-endpoint',
      label: 'Adjusted endpoint',
      source: 'adjusted-endpoint',
      origin,
      target,
      distanceKm: 458.25,
      travelTimeHours: 5,
      geometry: directGeometry,
      sections,
      provider: 'openrouteservice',
      profile: 'driving-hgv',
      routingVehicle: expeditionTruck,
      variant: 'adjusted-endpoint',
      warnings: [{
        code: 'ROUTING_ANCHOR_ADJUSTED',
        message: 'Route target uses a routing point 1.2 km from the stop.',
      }],
    });
    const profileFallback = routeOptionFromCalculation({
      id: 'profile-fallback',
      label: 'Car-profile fallback',
      source: 'profile-fallback',
      origin,
      target,
      distanceKm: 458.25,
      travelTimeHours: 5,
      geometry: directGeometry,
      sections,
      provider: 'openrouteservice',
      profile: 'driving-car',
      routingVehicle: expeditionTruck,
      providerOptions: { fallbackFromProfile: 'driving-hgv' },
      variant: 'profile-fallback',
      warnings: [{
        code: 'VEHICLE_PROFILE_FALLBACK',
        message: 'Truck dimensions were not validated for this route.',
      }],
    });

    expect(dedupeRouteOptions([recommended, adjustedEndpoint])).toEqual([adjustedEndpoint]);
    expect(dedupeRouteOptions([recommended, profileFallback])).toEqual([profileFallback]);
    expect(dedupeRouteOptions([recommended, adjustedEndpoint, profileFallback])).toEqual([profileFallback]);
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

  it('assigns stable unique ids only to route options whose ids collide', () => {
    const firstFallback = routeOptionFromCalculation({
      id: 'profile-fallback',
      label: 'Car-profile fallback',
      source: 'profile-fallback',
      origin,
      target,
      distanceKm: 458.25,
      travelTimeHours: 5,
      geometry: directGeometry,
      sections,
      provider: 'openrouteservice',
      profile: 'driving-car',
      routingVehicle: expeditionTruck,
      providerOptions: { fallbackFromProfile: 'driving-hgv' },
      variant: 'profile-fallback:current',
      warnings: [{
        code: 'VEHICLE_PROFILE_FALLBACK',
        message: 'Truck dimensions were not validated for this route.',
      }],
    });
    const secondFallback = routeOptionFromCalculation({
      id: 'profile-fallback',
      label: 'Car-profile fallback',
      source: 'profile-fallback',
      origin,
      target,
      distanceKm: 520,
      travelTimeHours: 6.2,
      geometry: avoidHighwaysGeometry,
      sections,
      provider: 'openrouteservice',
      profile: 'driving-car',
      routingVehicle: expeditionTruck,
      providerOptions: { fallbackFromProfile: 'driving-hgv' },
      variant: 'profile-fallback:recovered',
      warnings: [{
        code: 'VEHICLE_PROFILE_FALLBACK',
        message: 'Truck dimensions were not validated for this route.',
      }],
    });
    const recommended = routeOptionFromCalculation({
      id: 'recommended',
      label: 'Recommended',
      source: 'recommended',
      origin,
      target,
      distanceKm: 460,
      travelTimeHours: 5.1,
      geometry: {
        type: 'LineString',
        coordinates: [
          [-0.1276, 51.5072],
          [0.8, 50.1],
          [2.3522, 48.8566],
        ],
      },
      sections,
      provider: 'openrouteservice',
      profile: 'driving-hgv',
      routingVehicle: expeditionTruck,
      variant: 'recommended',
    });

    const normalized = ensureUniqueRouteOptionIds([firstFallback, secondFallback, recommended]);
    const repeated = ensureUniqueRouteOptionIds([firstFallback, secondFallback, recommended]);

    expect(new Set(normalized.map((option) => option.id)).size).toBe(3);
    expect(normalized[0].id).not.toBe(normalized[1].id);
    expect(normalized[0].id).toBe(repeated[0].id);
    expect(normalized[1].id).toBe(repeated[1].id);
    expect(normalized[2]).toBe(recommended);
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
      warnings: [],
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
