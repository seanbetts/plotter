import { describe, expect, it, vi } from 'vitest';
import { validateTripManifest } from './validation';
import { materializeTripManifest } from './tripManifest';

describe('trip manifest materialization', () => {
  it('resolves and assembles a complete ordered trip snapshot exactly once', async () => {
    const manifest = validateTripManifest({
      manifestVersion: 1,
      name: 'Ferry loop',
      stops: [
        {
          key: 'home',
          name: 'Home',
          place: { coordinates: { lat: 51, lng: 0 } },
          expectedStayDays: 1,
          links: ['https://example.com/home'],
          activities: [{
            title: 'Pack the car',
            place: { coordinates: { lat: 51.01, lng: 0.01 } },
            description: 'Load the camping kit.',
            notes: 'Put passports in the glovebox.',
            tags: ['practical-route'],
            links: ['https://example.com/packing'],
          }],
        },
        {
          key: 'larvik',
          name: 'Larvik',
          place: { coordinates: { lat: 59.05, lng: 10.03 } },
          expectedStayDays: 1,
          activities: [{
            title: 'Visit Larvik harbour',
            place: { coordinates: { lat: 59.04, lng: 10.04 } },
            tags: ['coast'],
          }],
        },
        {
          key: 'hirtshals',
          name: 'Hirtshals',
          place: { coordinates: { lat: 57.59, lng: 9.96 } },
          expectedStayDays: 2,
          notes: 'Post-ferry buffer.',
          tags: ['buffer-stop'],
          links: ['https://example.com/ferry'],
        },
      ],
      routeLegs: [{
        fromStopKey: 'larvik',
        toStopKey: 'hirtshals',
        type: 'shipping-manual',
        notes: 'Vehicle ferry.',
      }],
    });
    const resolvePlace = vi.fn(async ({ place, fallbackName, profile }) => ({
      coordinates: place.coordinates!,
      ...(profile === 'stop'
        ? {
            location: {
              placeName: fallbackName,
              regionName: '',
              countryName: 'Test country',
              sourceLabel: fallbackName,
              sourceProvider: 'legacy' as const,
            },
          }
        : {
            activityLocation: {
              name: fallbackName,
              address: `${fallbackName} address`,
              coordinates: place.coordinates,
              sourceProvider: 'manual' as const,
            },
          }),
    }));
    const enrichLink = vi.fn(async (url: string, sortOrder: number) => ({
      id: `link-${sortOrder}-${url}`,
      url,
      title: url,
      domain: 'example.com',
      sortOrder,
    }));
    const calculateRoute = vi.fn(async ({ origin, target }) => ({
      distanceKm: 100,
      travelTimeHours: 2,
      geometry: {
        type: 'LineString' as const,
        coordinates: [[origin.lng, origin.lat], [target.lng, target.lat]],
      },
      provider: 'test',
      profile: 'driving-car' as const,
    }));

    const materialized = await materializeTripManifest(manifest, {
      resolvePlace,
      enrichLink,
      calculateRoute,
    });

    expect(resolvePlace).toHaveBeenCalledTimes(5);
    expect(enrichLink).toHaveBeenCalledTimes(3);
    expect(calculateRoute).toHaveBeenCalledTimes(1);
    expect(materialized.destinations.map((stop) => stop.name)).toEqual(['Home', 'Larvik', 'Hirtshals']);
    expect(materialized.destinations[2]).toMatchObject({
      order: 2,
      timing: { expectedStayDays: 2 },
      research: { notes: 'Post-ferry buffer.' },
      tags: ['buffer-stop'],
    });
    expect(materialized.activities).toHaveLength(2);
    expect(materialized.activities[0]).toMatchObject({
      destinationId: materialized.destinations[0].id,
      order: 0,
      title: 'Pack the car',
      description: 'Load the camping kit.',
      notes: 'Put passports in the glovebox.',
      tags: ['practical-route'],
      links: [{ url: 'https://example.com/packing' }],
      location: { address: 'Pack the car address' },
    });
    expect(materialized.activities[1]).toMatchObject({
      destinationId: materialized.destinations[1].id,
      order: 0,
      title: 'Visit Larvik harbour',
    });
    expect(materialized.routeLegs).toMatchObject([
      { type: 'driving-auto', status: 'ready' },
      { type: 'shipping-manual', status: 'manual', notes: 'Vehicle ferry.' },
    ]);
  });
});
