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
      type: 'driving-auto',
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
    expect(parsed.routeLegs[0].type).toBe('driving-auto');
  });

  it('normalizes legacy destinations without structured location data', () => {
    const legacyDestination = {
      ...createDestination({
        name: 'Legacy stop',
        countryRegion: 'Turkey',
        coordinates: { lat: 38.6431, lng: 34.8289 },
      }),
      location: undefined,
    };

    const parsed = parseTripSnapshot(
      JSON.stringify({
        version: 1,
        exportedAt: '2026-06-28T00:00:00.000Z',
        destinations: [legacyDestination],
        routeLegs: [],
      }),
    );

    expect(parsed.destinations[0].location).toEqual({
      placeName: 'Legacy stop',
      regionName: '',
      countryName: 'Turkey',
      sourceLabel: 'Legacy stop, Turkey',
      sourceProvider: 'legacy',
    });
  });

  it('rejects invalid snapshot JSON', () => {
    expect(() => parseTripSnapshot('{"destinations":[]}')).toThrow(
      'Trip snapshot must include destinations and routeLegs arrays',
    );
    expect(() => parseTripSnapshot('null')).toThrow(
      'Trip snapshot must include destinations and routeLegs arrays',
    );
    expect(() => parseTripSnapshot('"not an object"')).toThrow(
      'Trip snapshot must include destinations and routeLegs arrays',
    );
  });
});
