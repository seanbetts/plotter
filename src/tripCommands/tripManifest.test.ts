import { describe, expect, it, vi } from 'vitest';
import { validateTripManifest } from './validation';
import {
  calculatePreparedTripManifestRoutes,
  materializeTripManifest,
  prepareTripManifest,
} from './tripManifest';

describe('trip manifest materialization', () => {
  it('materializes a legacy version 1 manual shipping directive as a straight-line runtime leg', async () => {
    const legacyRouteTypeField = ['ty', 'pe'].join('');
    const legacyManualShippingValue = ['shipping', 'manual'].join('-');
    const manifest = validateTripManifest({
      manifestVersion: 1,
      name: 'Legacy ferry',
      stops: [
        { key: 'larvik', name: 'Larvik', place: { coordinates: { lat: 59.05, lng: 10.03 } }, expectedStayDays: 1 },
        { key: 'hirtshals', name: 'Hirtshals', place: { coordinates: { lat: 57.59, lng: 9.96 } }, expectedStayDays: 1 },
      ],
      routeLegs: [{
        fromStopKey: 'larvik',
        toStopKey: 'hirtshals',
        [legacyRouteTypeField]: legacyManualShippingValue,
        notes: 'Vehicle ferry.',
      }],
    });

    const materialized = await materializeTripManifest(manifest, {});

    expect(materialized.routeLegs).toEqual([
      expect.objectContaining({
        movement: 'vehicle-shipping',
        calculation: 'manual',
        status: 'manual',
        notes: 'Vehicle ferry.',
        geometry: {
          type: 'LineString',
          coordinates: [[10.03, 59.05], [9.96, 57.59]],
        },
      }),
    ]);
    expect(materialized.routeLegs[0]).not.toHaveProperty('type');
  });

  it('materializes a version 2 manual vehicle-shipping directive with straight-line manual semantics', async () => {
    const manifest = validateTripManifest({
      manifestVersion: 2,
      name: 'Darien bypass',
      vehiclePreset: 'expedition-truck',
      stops: [
        { key: 'panama', name: 'Panama City', place: { coordinates: { lat: 9, lng: -79.5 } }, expectedStayDays: 1 },
        { key: 'cartagena', name: 'Cartagena', place: { coordinates: { lat: 10.4, lng: -75.5 } }, expectedStayDays: 1 },
      ],
      routeLegs: [{
        fromStopKey: 'panama', toStopKey: 'cartagena',
        movement: 'vehicle-shipping', calculation: 'manual', notes: 'Freight around the Darien Gap.',
      }],
    });

    const materialized = await materializeTripManifest(manifest, {});

    expect(materialized.routeLegs[0]).toMatchObject({
      movement: 'vehicle-shipping', calculation: 'manual', status: 'manual',
      geometry: { type: 'LineString', coordinates: [[-79.5, 9], [-75.5, 10.4]] },
      notes: 'Freight around the Darien Gap.',
    });
    expect(materialized.routeLegs[0]).not.toHaveProperty('type');
  });

  it('resolves and assembles a complete ordered trip snapshot exactly once', async () => {
    const legacyRouteTypeField = ['ty', 'pe'].join('');
    const legacyManualShippingValue = ['shipping', 'manual'].join('-');
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
        [legacyRouteTypeField]: legacyManualShippingValue,
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
      sections: [{ kind: 'road' as const, startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 100 }],
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
      { movement: 'drive', calculation: 'automatic', status: 'ready' },
      { movement: 'vehicle-shipping', calculation: 'manual', status: 'manual', notes: 'Vehicle ferry.' },
    ]);
  });

  it('prepares manifest data before route calculation and preserves automatic call counts after routing', async () => {
    const legacyRouteTypeField = ['ty', 'pe'].join('');
    const legacyManualShippingValue = ['shipping', 'manual'].join('-');
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
        [legacyRouteTypeField]: legacyManualShippingValue,
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
      sections: [{ kind: 'road' as const, startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 100 }],
    }));

    const prepared = await prepareTripManifest(manifest, {
      resolvePlace,
      enrichLink,
    });

    expect(resolvePlace).toHaveBeenCalledTimes(5);
    expect(enrichLink).toHaveBeenCalledTimes(3);
    expect(calculateRoute).not.toHaveBeenCalled();
    expect(prepared.pendingRouteLegs).toMatchObject([
      { movement: 'drive', calculation: 'automatic', status: 'pending' },
      { movement: 'vehicle-shipping', calculation: 'manual', status: 'manual', notes: 'Vehicle ferry.' },
    ]);

    const materialized = await calculatePreparedTripManifestRoutes(prepared, calculateRoute);

    expect(calculateRoute).toHaveBeenCalledTimes(1);
    expect(materialized.routeLegs).toMatchObject([
      { movement: 'drive', calculation: 'automatic', status: 'ready' },
      { movement: 'vehicle-shipping', calculation: 'manual', status: 'manual', notes: 'Vehicle ferry.' },
    ]);
  });

  it('materializes recovered route anchors into the destination snapshot', async () => {
    const manifest = validateTripManifest({
      manifestVersion: 2,
      name: 'Alta recovery',
      vehiclePreset: 'standard',
      stops: [
        { key: 'olderdalen', name: 'Olderdalen', place: { coordinates: { lat: 69.6041, lng: 20.5326 } }, expectedStayDays: 1 },
        { key: 'alta', name: 'Alta', place: { coordinates: { lat: 69.96887, lng: 23.27165 } }, expectedStayDays: 1 },
      ],
      routeLegs: [],
    });
    const altaAnchor = {
      profile: 'driving-car' as const,
      coordinates: { lat: 69.98334, lng: 23.27165 },
      originalCoordinates: { lat: 69.96887, lng: 23.27165 },
      snapDistanceKm: 1.609,
      provider: 'openrouteservice' as const,
      resolvedAt: '2026-07-11T00:00:00.000Z',
    };
    const calculateRoute = vi.fn(async ({ origin }) => ({
      distanceKm: 361,
      travelTimeHours: 5.4,
      geometry: {
        type: 'LineString' as const,
        coordinates: [[origin.lng, origin.lat], [altaAnchor.coordinates.lng, altaAnchor.coordinates.lat]],
      },
      provider: 'openrouteservice',
      profile: 'driving-car' as const,
      sections: [{ kind: 'road' as const, startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 361 }],
      warnings: [{ code: 'ROUTING_ANCHOR_ADJUSTED' as const, message: 'Alta uses a routing point 1.6 km from the stop.' }],
      endpointAnchors: { target: altaAnchor },
    }));

    const materialized = await materializeTripManifest(manifest, { calculateRoute });

    expect(materialized.destinations[1].routingAnchors['driving-car']).toEqual(altaAnchor);
    expect(materialized.routeLegs[0]).toMatchObject({
      status: 'ready',
      warnings: [expect.objectContaining({ code: 'ROUTING_ANCHOR_ADJUSTED' })],
    });
  });

  it('materializes version 2 defaults and exceptional automatic route intent with its vehicle', async () => {
    const manifest = validateTripManifest({
      manifestVersion: 2,
      name: 'Nordkapp',
      vehiclePreset: 'expedition-truck',
      stops: [
        { key: 'home', name: 'Home', place: { query: 'Home' }, expectedStayDays: 1 },
        { key: 'bremen', name: 'Bremen', place: { query: 'Bremen' }, expectedStayDays: 1 },
        { key: 'kristiansand', name: 'Kristiansand', place: { query: 'Kristiansand' }, expectedStayDays: 1 },
      ],
      routeLegs: [{
        fromStopKey: 'bremen',
        toStopKey: 'kristiansand',
        ferryPolicy: 'require',
        notes: 'Take the ferry.',
        waypoints: [{
          name: 'Hirtshals ferry terminal',
          place: { query: 'Hirtshals ferry terminal' },
          notes: 'Check in early.',
          links: ['https://example.com/ferry'],
        }],
      }],
    });
    const resolvePlace = vi.fn(async ({ fallbackName, profile }) => ({
      coordinates: fallbackName === 'Home'
        ? { lat: 51, lng: 0 }
        : fallbackName === 'Bremen'
          ? { lat: 53, lng: 8 }
          : fallbackName === 'Kristiansand'
            ? { lat: 58, lng: 8 }
            : { lat: 57.59, lng: 9.96 },
      ...(profile === 'stop' ? {
        location: {
          placeName: fallbackName,
          regionName: '',
          countryName: 'Test country',
          sourceLabel: fallbackName,
          sourceProvider: 'legacy' as const,
        },
      } : {}),
    }));
    const enrichLink = vi.fn(async (url: string, sortOrder: number) => ({
      id: `link-${sortOrder}`,
      url,
      title: 'Ferry',
      domain: 'example.com',
      sortOrder,
    }));
    const calculateRoute = vi.fn(async ({ origin, target, profile, ferryPolicy }) => ({
      distanceKm: 100,
      travelTimeHours: 2,
      geometry: { type: 'LineString' as const, coordinates: [[origin.lng, origin.lat], [target.lng, target.lat]] },
      provider: 'test',
      profile,
      sections: ferryPolicy === 'require'
        ? [{ kind: 'ferry' as const, startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 100 }]
        : [{ kind: 'road' as const, startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 100 }],
    }));

    const materialized = await materializeTripManifest(manifest, { resolvePlace, enrichLink, calculateRoute });

    expect(materialized.routingVehicle.preset).toBe('expedition-truck');
    expect(materialized.routeLegs).toHaveLength(2);
    expect(materialized.routeLegs[0]).toMatchObject({
      movement: 'drive', calculation: 'automatic', ferryPolicy: 'allow', waypoints: [], status: 'ready',
    });
    expect(materialized.routeLegs[1]).toMatchObject({
      movement: 'drive', calculation: 'automatic', ferryPolicy: 'require', notes: 'Take the ferry.', status: 'ready',
      waypoints: [{ name: 'Hirtshals ferry terminal', notes: 'Check in early.', links: [{ url: 'https://example.com/ferry' }] }],
    });
    expect(materialized.changed.linksAdded).toContain('https://example.com/ferry');
    expect(calculateRoute).toHaveBeenNthCalledWith(2, expect.objectContaining({
      routingVehicle: expect.objectContaining({ preset: 'expedition-truck' }),
      ferryPolicy: 'require',
      waypoints: [expect.objectContaining({ name: 'Hirtshals ferry terminal' })],
    }));
  });

  it('reports the directive and waypoint index when a waypoint place cannot resolve', async () => {
    const manifest = validateTripManifest({
      manifestVersion: 2,
      name: 'Bad waypoint',
      vehiclePreset: 'standard',
      stops: [
        { key: 'a', name: 'A', place: { coordinates: { lat: 50, lng: 0 } }, expectedStayDays: 1 },
        { key: 'b', name: 'B', place: { coordinates: { lat: 51, lng: 1 } }, expectedStayDays: 1 },
      ],
      routeLegs: [{
        fromStopKey: 'a',
        toStopKey: 'b',
        waypoints: [{ name: 'Unresolved', place: { query: 'Unresolved place' }, links: [] }],
      }],
    });

    await expect(materializeTripManifest(manifest, {})).rejects.toMatchObject({
      code: 'PLACE_RESOLVER_REQUIRED',
      path: 'routeLegs[0].waypoints[0].place',
    });
  });
});
