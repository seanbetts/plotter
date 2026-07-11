import { describe, expect, it } from 'vitest';
import { createDestination } from '../domain/destinations';
import { createRouteLeg } from '../domain/routeLegs';
import { buildRenderableRouteFeatures, routeGeometryForLeg, tripMapBounds } from './tripRouteFeatures';

const origin = createDestination({ name: 'Origin', countryRegion: 'A', coordinates: { lat: 10, lng: 20 } });
const target = createDestination({ name: 'Target', countryRegion: 'B', coordinates: { lat: 30, lng: 40 } });

describe('tripRouteFeatures', () => {
  it('uses ready driving geometry and its furthest waypoint in bounds', () => {
    const leg = {
      ...createRouteLeg({
        originDestinationId: origin.id,
        targetDestinationId: target.id,
        type: 'driving-auto',
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
      type: 'shipping-manual',
    });
    const failed = {
      ...createRouteLeg({
        originDestinationId: origin.id,
        targetDestinationId: target.id,
        type: 'driving-auto',
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
      type: 'driving-auto',
    });
    expect(buildRenderableRouteFeatures([origin, target], [pending]).features).toEqual([]);
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
        type: 'driving-auto',
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
