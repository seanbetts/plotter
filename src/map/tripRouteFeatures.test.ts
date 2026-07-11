import { describe, expect, it } from 'vitest';
import { createDestination } from '../domain/destinations';
import { createRouteLeg } from '../domain/routeLegs';
import type { RouteLeg } from '../domain/types';
import { buildRenderableRouteFeatures, buildRouteFeatures, routeGeometryForLeg, tripMapBounds } from './tripRouteFeatures';

const origin = createDestination({ name: 'Origin', countryRegion: 'A', coordinates: { lat: 10, lng: 20 } });
const target = createDestination({ name: 'Target', countryRegion: 'B', coordinates: { lat: 30, lng: 40 } });

describe('tripRouteFeatures', () => {
  it('uses ready driving geometry and its furthest waypoint in bounds', () => {
    const leg = {
      ...createRouteLeg({
        originDestinationId: origin.id,
        targetDestinationId: target.id,
        movement: 'drive', calculation: 'automatic',
      }),
      status: 'ready' as const,
      geometry: { type: 'LineString' as const, coordinates: [[20, 10], [55, -5], [40, 30]] },
    };

    expect(routeGeometryForLeg([origin, target], leg)).toEqual(leg.geometry);
    expect(tripMapBounds([origin, target], [leg])).toEqual([[20, -5], [55, 30]]);
  });

  it('uses endpoint fallback for shipping geometry and failed driving legs', () => {
    const shipping = createRouteLeg({
      originDestinationId: origin.id,
      targetDestinationId: target.id,
      movement: 'vehicle-shipping', calculation: 'manual',
    });
    const failed = {
      ...createRouteLeg({
        originDestinationId: origin.id,
        targetDestinationId: target.id,
        movement: 'drive', calculation: 'automatic',
      }),
      status: 'failed' as const,
    };
    expect(routeGeometryForLeg([origin, target], shipping)?.coordinates).toEqual([[20, 10], [40, 30]]);
    expect(buildRenderableRouteFeatures([origin, target], [failed]).features[0].properties.type).toBe('failed');
  });

  it('omits pending driving legs', () => {
    const pending = createRouteLeg({
      originDestinationId: origin.id,
      targetDestinationId: target.id,
      movement: 'drive', calculation: 'automatic',
    });
    expect(buildRenderableRouteFeatures([origin, target], [pending]).features).toEqual([]);
  });

  it.each([
    ['out-of-range', [{ kind: 'ferry' as const, startGeometryIndex: 1, endGeometryIndex: 6, distanceKm: 10 }]],
    ['reversed', [{ kind: 'ferry' as const, startGeometryIndex: 3, endGeometryIndex: 2, distanceKm: 10 }]],
    ['non-integer', [{ kind: 'ferry' as const, startGeometryIndex: 1.5, endGeometryIndex: 3, distanceKm: 10 }]],
    ['non-finite', [{ kind: 'ferry' as const, startGeometryIndex: 1, endGeometryIndex: Number.NaN, distanceKm: 10 }]],
    ['non-array', { kind: 'ferry', startGeometryIndex: 1, endGeometryIndex: 3, distanceKm: 10 }],
    ['null entry', [null]],
    ['unsupported kind', [{ kind: 'rail', startGeometryIndex: 1, endGeometryIndex: 3, distanceKm: 10 }]],
    ['non-finite distance', [{ kind: 'ferry', startGeometryIndex: 1, endGeometryIndex: 3, distanceKm: Number.NaN }]],
    ['negative distance', [{ kind: 'ferry', startGeometryIndex: 1, endGeometryIndex: 3, distanceKm: -1 }]],
    ['unsorted', [
      { kind: 'ferry' as const, startGeometryIndex: 2, endGeometryIndex: 4, distanceKm: 10 },
      { kind: 'road' as const, startGeometryIndex: 0, endGeometryIndex: 2, distanceKm: 10 },
    ]],
    ['overlapping', [
      { kind: 'road' as const, startGeometryIndex: 0, endGeometryIndex: 3, distanceKm: 10 },
      { kind: 'ferry' as const, startGeometryIndex: 2, endGeometryIndex: 4, distanceKm: 10 },
    ]],
  ])('falls back to one full road feature for %s section metadata', (_name, sections) => {
    const geometry = {
      type: 'LineString' as const,
      coordinates: [[20, 10], [25, 15], [30, 20], [35, 25], [40, 30]],
    };
    const leg = createRouteLeg({
      originDestinationId: origin.id,
      targetDestinationId: target.id,
      movement: 'drive', calculation: 'automatic',
      status: 'ready',
      geometry,
      sections: sections as unknown as RouteLeg['sections'],
    });

    expect(buildRouteFeatures([leg]).features).toEqual([
      expect.objectContaining({
        geometry,
        properties: expect.objectContaining({ kind: 'road' }),
      }),
    ]);
  });

  it('omits invalid route geometry instead of emitting invalid GeoJSON', () => {
    const leg = createRouteLeg({
      originDestinationId: origin.id,
      targetDestinationId: target.id,
      movement: 'drive', calculation: 'automatic',
      status: 'ready',
      geometry: { type: 'LineString', coordinates: [[20, 10], [Number.NaN, 30]] },
      sections: [],
    });

    expect(buildRouteFeatures([leg]).features).toEqual([]);
  });

  it('returns identical corners for one stop and null for no stops', () => {
    expect(tripMapBounds([origin], [])).toEqual([[20, 10], [20, 10]]);
    expect(tripMapBounds([], [])).toBeNull();
  });

  it('uses the smallest wrapped longitude interval for a dateline-crossing trip', () => {
    const fiji = createDestination({
      name: 'Fiji',
      countryRegion: 'Fiji',
      coordinates: { lat: -17.7, lng: 179 },
    });
    const samoa = createDestination({
      name: 'Samoa',
      countryRegion: 'Samoa',
      coordinates: { lat: -13.8, lng: -172 },
    });
    const leg = {
      ...createRouteLeg({
        originDestinationId: fiji.id,
        targetDestinationId: samoa.id,
        movement: 'drive', calculation: 'automatic',
      }),
      status: 'ready' as const,
      geometry: {
        type: 'LineString' as const,
        coordinates: [[179, -17.7], [-179, -16], [-172, -13.8]],
      },
    };

    expect(tripMapBounds([fiji, samoa], [leg])).toEqual([[179, -17.7], [188, -13.8]]);
  });

  it('keeps an ordinary European trip in its familiar longitude range', () => {
    const galway = createDestination({
      name: 'Galway',
      countryRegion: 'Ireland',
      coordinates: { lat: 53.27, lng: -9.06 },
    });
    const paris = createDestination({
      name: 'Paris',
      countryRegion: 'France',
      coordinates: { lat: 48.86, lng: 2.35 },
    });

    expect(tripMapBounds([galway, paris], [])).toEqual([[-9.06, 48.86], [2.35, 53.27]]);
  });
});
