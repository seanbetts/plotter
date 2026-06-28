import { describe, expect, it } from 'vitest';
import { createRouteKey, createRouteLeg, createStraightLineGeometry } from './routeLegs';

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
    expect(leg.profile).toBe('driving-car');
    expect(leg.routeKey).toBe('driving-car:1,2:3,4');
  });

  it('creates stable route keys from coordinates and profile', () => {
    expect(
      createRouteKey({
        origin: { lat: 51.50724, lng: -0.12762 },
        target: { lat: 41.00822, lng: 28.97841 },
        profile: 'driving-car',
      }),
    ).toBe('driving-car:-0.12762,51.50724:28.97841,41.00822');
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
});
