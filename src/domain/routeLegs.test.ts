import { describe, expect, it } from 'vitest';
import {
  createManualRouteLeg,
  createRouteKey,
  createRouteLeg,
  createStraightLineGeometry,
} from './routeLegs';
import { resolveVehiclePreset, standardRoutingVehicle } from './vehiclePresets';

describe('route leg helpers', () => {
  it('creates a manual route leg between two destinations', () => {
    const leg = createRouteLeg({
      originDestinationId: 'origin-1',
      targetDestinationId: 'target-1',
      type: 'shipping-manual',
    });

    expect(leg.originDestinationId).toBe('origin-1');
    expect(leg.targetDestinationId).toBe('target-1');
    expect(leg.type).toBe('shipping-manual');
    expect(leg.status).toBe('manual');
    expect(leg.movement).toBe('vehicle-shipping');
    expect(leg.calculation).toBe('manual');
    expect(leg.ferryPolicy).toBe('allow');
    expect(leg.waypoints).toEqual([]);
    expect(leg.sections).toEqual([]);
    expect(leg.warnings).toEqual([]);
    expect(leg.notes).toBe('');
  });

  it('creates a pending driving route leg with cache metadata', () => {
    const leg = createRouteLeg({
      originDestinationId: 'origin-1',
      targetDestinationId: 'target-1',
      type: 'driving-auto',
      routeKey: 'driving-car:1,2:3,4',
    });

    expect(leg.type).toBe('driving-auto');
    expect(leg.status).toBe('pending');
    expect(leg.movement).toBe('drive');
    expect(leg.calculation).toBe('automatic');
    expect(leg.ferryPolicy).toBe('allow');
    expect(leg.waypoints).toEqual([]);
    expect(leg.sections).toEqual([]);
    expect(leg.warnings).toEqual([]);
    expect(leg.profile).toBe('driving-car');
    expect(leg.routeKey).toBe('driving-car:1,2:3,4');
  });

  it('creates stable route keys from coordinates and profile', () => {
    const input = {
      origin: { lat: 51.50724, lng: -0.12762 },
      target: { lat: 41.00822, lng: 28.97841 },
      profile: 'driving-car',
    };

    expect(createRouteKey(input)).toBe(createRouteKey(input));
  });

  it('keys vehicle, waypoint and ferry intent', () => {
    const base = {
      origin: { lat: 59.0502, lng: 10.0296 },
      target: { lat: 57.5948, lng: 9.9796 },
      routingVehicle: standardRoutingVehicle,
      waypoints: [],
      ferryPolicy: 'allow' as const,
    };

    expect(createRouteKey(base)).not.toBe(createRouteKey({
      ...base,
      routingVehicle: resolveVehiclePreset('expedition-truck'),
    }));
    expect(createRouteKey(base)).not.toBe(createRouteKey({
      ...base,
      waypoints: [{ lat: 57.5948, lng: 9.9796 }],
    }));
    expect(createRouteKey(base)).not.toBe(createRouteKey({ ...base, ferryPolicy: 'avoid' }));
  });

  it('keys optional route variants', () => {
    const base = {
      origin: { lat: 59.0502, lng: 10.0296 },
      target: { lat: 57.5948, lng: 9.9796 },
    };

    expect(createRouteKey(base)).not.toBe(createRouteKey({ ...base, variant: 'alternative-1' }));
  });

  it('creates GeoJSON line geometry in longitude latitude order', () => {
    const geometry = createStraightLineGeometry(
      { lat: 51.5072, lng: -0.1276 },
      { lat: 41.0082, lng: 28.9784 },
    );

    expect(geometry.type).toBe('LineString');
    expect(geometry.coordinates).toEqual([
      [-0.1276, 51.5072],
      [28.9784, 41.0082],
    ]);
  });

  it('creates a complete manual shipping leg with straight-line geometry', () => {
    const leg = createManualRouteLeg({
      origin: { lat: 59.05, lng: 10.03 },
      target: { lat: 57.59, lng: 9.96 },
      originDestinationId: 'larvik',
      targetDestinationId: 'hirtshals',
      notes: 'Vehicle ferry.',
    });

    expect(leg).toMatchObject({
      originDestinationId: 'larvik',
      targetDestinationId: 'hirtshals',
      type: 'shipping-manual',
      status: 'manual',
      movement: 'vehicle-shipping',
      calculation: 'manual',
      ferryPolicy: 'allow',
      waypoints: [],
      sections: [],
      warnings: [],
      notes: 'Vehicle ferry.',
      geometry: {
        type: 'LineString',
        coordinates: [[10.03, 59.05], [9.96, 57.59]],
      },
    });
    expect(leg.distanceKm).toBeUndefined();
    expect(leg.travelTimeHours).toBeUndefined();
    expect(leg.provider).toBeUndefined();
    expect(leg.profile).toBeUndefined();
    expect(leg.routeKey).toBeUndefined();
  });
});
