import { describe, expect, it } from 'vitest';
import { createDestination } from './destinations';
import { createRouteLeg } from './routeLegs';
import { parseTripSnapshot, serializeTripSnapshot } from './snapshots';

describe('trip snapshots', () => {
  it('serializes and parses destinations and route legs', () => {
    const origin = createDestination({
      name: 'Meteora',
      coordinates: { lat: 39.7217, lng: 21.6306 },
    });
    const target = createDestination({
      name: 'Cappadocia',
      coordinates: { lat: 38.6431, lng: 34.8289 },
    });
    const leg = createRouteLeg({
      originDestinationId: origin.id,
      targetDestinationId: target.id,
      type: 'driving',
    });

    const json = serializeTripSnapshot({
      destinations: [origin, target],
      routeLegs: [leg],
    });
    const parsed = parseTripSnapshot(json);

    expect(parsed.destinations.map((destination) => destination.name)).toEqual([
      'Meteora',
      'Cappadocia',
    ]);
    expect(parsed.routeLegs[0].type).toBe('driving');
  });

  it('rejects invalid snapshot JSON', () => {
    expect(() => parseTripSnapshot('{"destinations":[]}')).toThrow(
      'Trip snapshot must include destinations and routeLegs arrays',
    );
  });
});
