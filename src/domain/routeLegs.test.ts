import { describe, expect, it } from 'vitest';
import { createRouteLeg, createStraightLineGeometry } from './routeLegs';

describe('route leg helpers', () => {
  it('creates a manual route leg between two destinations', () => {
    const leg = createRouteLeg({
      originDestinationId: 'origin-1',
      targetDestinationId: 'target-1',
      type: 'uncertain',
    });

    expect(leg.originDestinationId).toBe('origin-1');
    expect(leg.targetDestinationId).toBe('target-1');
    expect(leg.type).toBe('uncertain');
    expect(leg.notes).toBe('');
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
