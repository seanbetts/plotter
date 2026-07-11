import type { LineString } from 'geojson';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RouteWaypoint } from '../domain/types';
import { resolveVehiclePreset } from '../domain/vehiclePresets';
import {
  calculateOpenRouteServiceRoute,
  calculateOpenRouteServiceRouteOptions,
} from './openRouteService';

describe('OpenRouteService adapter', () => {
  const origin = { lat: 51.5072, lng: -0.1276 };
  const target = { lat: 57.5948, lng: 9.9796 };
  const hirtshals: RouteWaypoint = {
    id: 'hirtshals',
    order: 0,
    name: 'Hirtshals',
    coordinates: { lat: 57.5948, lng: 9.9796 },
    location: {
      placeName: 'Hirtshals',
      regionName: 'North Jutland',
      countryName: 'Denmark',
      countryCode: 'DK',
      sourceLabel: 'Hirtshals, Denmark',
      sourceProvider: 'legacy',
    },
    notes: '',
    links: [],
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts coordinates to the driving GeoJSON directions endpoint', async () => {
    const geometry: LineString = {
      type: 'LineString',
      coordinates: [
        [-0.1276, 51.5072],
        [2.3522, 48.8566],
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry,
            properties: {
              summary: {
                distance: 458_250,
                duration: 18_000,
              },
            },
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const route = await calculateOpenRouteServiceRoute({
      apiKey: 'ors-key',
      origin: { lat: 51.5072, lng: -0.1276 },
      target: { lat: 48.8566, lng: 2.3522 },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openrouteservice.org/v2/directions/driving-car/geojson',
      {
        method: 'POST',
        headers: {
          Authorization: 'ors-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          coordinates: [
            [-0.1276, 51.5072],
            [2.3522, 48.8566],
          ],
          extra_info: ['waycategory'],
        }),
      },
    );
    expect(route).toEqual({
      distanceKm: 458.25,
      travelTimeHours: 5,
      geometry,
      provider: 'openrouteservice',
      profile: 'driving-car',
      sections: [{ kind: 'road', startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 458.25 }],
    });
  });

  it('sends HGV restrictions, ordered coordinates and waycategory', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [[-0.1276, 51.5072], [9.9796, 57.5948], [10.7522, 59.9139]],
          },
          properties: { summary: { distance: 1_200_000, duration: 72_000 } },
        }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await calculateOpenRouteServiceRoute({
      apiKey: 'key',
      origin,
      target: { lat: 59.9139, lng: 10.7522 },
      routingVehicle: resolveVehiclePreset('expedition-truck'),
      ferryPolicy: 'require',
      waypoints: [hirtshals],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openrouteservice.org/v2/directions/driving-hgv/geojson',
      expect.objectContaining({
        body: JSON.stringify({
          coordinates: [
            [-0.1276, 51.5072],
            [9.9796, 57.5948],
            [10.7522, 59.9139],
          ],
          extra_info: ['waycategory'],
          options: {
            vehicle_type: 'hgv',
            profile_params: {
              restrictions: { length: 9, width: 2.55, height: 3.8, weight: 15, axleload: 7.5 },
            },
          },
        }),
      }),
    );
  });

  it('includes endpoint radiuses only when requested', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [[-0.1276, 51.5072], [9.9796, 57.5948]],
          },
          properties: { summary: { distance: 1_200_000, duration: 72_000 } },
        }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await calculateOpenRouteServiceRoute({
      apiKey: 'key',
      origin,
      target,
      radiuses: [2000, 2000],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openrouteservice.org/v2/directions/driving-car/geojson',
      expect.objectContaining({
        body: JSON.stringify({
          coordinates: [
            [-0.1276, 51.5072],
            [9.9796, 57.5948],
          ],
          radiuses: [2000, 2000],
          extra_info: ['waycategory'],
        }),
      }),
    );
  });

  it('maps waycategory 8 to a ferry section and fills road ranges', async () => {
    const geometry: LineString = {
      type: 'LineString',
      coordinates: Array.from({ length: 12 }, (_, index) => [index * 0.242997, 0]),
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry,
          properties: {
            summary: { distance: 297_220, duration: 18_000 },
            extras: { waycategory: { values: [[0, 4, 1], [4, 9, 8], [9, 11, 1]] } },
          },
        }],
      }),
    }));

    const route = await calculateOpenRouteServiceRoute({ apiKey: 'key', origin, target });

    expect(route.sections).toEqual([
      { kind: 'road', startGeometryIndex: 0, endGeometryIndex: 4, distanceKm: 108.1 },
      { kind: 'ferry', startGeometryIndex: 4, endGeometryIndex: 9, distanceKm: 135.1 },
      { kind: 'road', startGeometryIndex: 9, endGeometryIndex: 11, distanceKm: 54 },
    ]);
  });

  it('maps waycategory values containing the ferry bit to ferry sections', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [[0, 0], [1, 0], [2, 0]] },
          properties: {
            summary: { distance: 222_390, duration: 7_200 },
            extras: { waycategory: { values: [[0, 1, 1], [1, 2, 72]] } },
          },
        }],
      }),
    }));

    const route = await calculateOpenRouteServiceRoute({ apiKey: 'key', origin, target });

    expect(route.sections).toContainEqual({
      kind: 'ferry',
      startGeometryIndex: 1,
      endGeometryIndex: 2,
      distanceKm: 111.2,
    });
  });

  it('maps missing waycategory metadata to one full road section', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [[0, 0], [1, 0]] },
          properties: { summary: { distance: 111_195, duration: 3_600 } },
        }],
      }),
    }));

    const route = await calculateOpenRouteServiceRoute({ apiKey: 'key', origin, target });

    expect(route.sections).toEqual([
      { kind: 'road', startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 111.195 },
    ]);
  });

  it('rejects malformed waycategory ranges safely', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [[0, 0], [1, 0]] },
          properties: {
            summary: { distance: 111_195, duration: 3_600 },
            extras: { waycategory: { values: [[0, 4, 8]] } },
          },
        }],
      }),
    }));

    await expect(
      calculateOpenRouteServiceRoute({ apiKey: 'key', origin, target }),
    ).rejects.toThrow('OpenRouteService returned an invalid route');
  });

  it('rejects overlapping waycategory ranges', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [[0, 0], [1, 0], [2, 0], [3, 0]] },
          properties: {
            summary: { distance: 333_585, duration: 10_800 },
            extras: { waycategory: { values: [[0, 2, 1], [1, 3, 8]] } },
          },
        }],
      }),
    }));

    await expect(
      calculateOpenRouteServiceRoute({ apiKey: 'key', origin, target }),
    ).rejects.toThrow('OpenRouteService returned an invalid route');
  });

  it('requires an API key before making a request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      calculateOpenRouteServiceRoute({
        apiKey: '',
        origin: { lat: 51.5072, lng: -0.1276 },
        target: { lat: 48.8566, lng: 2.3522 },
      }),
    ).rejects.toThrow('OpenRouteService API key is required');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves structured provider errors for unroutable coordinates', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      error: {
        code: 2010,
        message: 'Could not find routable point within a radius of 350.0 meters of specified coordinate 1: 23.2 70.0.',
      },
    }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      calculateOpenRouteServiceRoute({ apiKey: 'key', origin, target }),
    ).rejects.toMatchObject({
      name: 'OpenRouteServiceError',
      status: 404,
      code: 2010,
      coordinateIndex: 1,
      profile: 'driving-car',
      providerMessage: 'Could not find routable point within a radius of 350.0 meters of specified coordinate 1: 23.2 70.0.',
    });
  });

  it('preserves retry-after details for rate-limited responses', async () => {
    const rateLimitedResponse = new Response(JSON.stringify({
      error: {
        code: 3099,
        message: 'Rate limit exceeded.',
      },
    }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': '2',
      },
    });
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(rateLimitedResponse.clone())
      .mockResolvedValueOnce(rateLimitedResponse.clone()));

    await expect(
      calculateOpenRouteServiceRoute({ apiKey: 'key', origin, target }),
    ).rejects.toMatchObject({
      name: 'OpenRouteServiceError',
      status: 429,
      code: 3099,
      retryAfterMs: 2_000,
      profile: 'driving-car',
    });
  });

  it('keeps malformed provider bodies readable in route calculation failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('<html>Provider unavailable</html>', {
      status: 503,
      headers: { 'Content-Type': 'text/html' },
    })));

    await expect(
      calculateOpenRouteServiceRoute({ apiKey: 'key', origin, target }),
    ).rejects.toMatchObject({
      name: 'OpenRouteServiceError',
      status: 503,
      providerMessage: '<html>Provider unavailable</html>',
      profile: 'driving-car',
    });
  });

  it('rejects malformed GeoJSON route responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          type: 'FeatureCollection',
          features: [],
        }),
      }),
    );

    await expect(
      calculateOpenRouteServiceRoute({
        apiKey: 'ors-key',
        origin: { lat: 51.5072, lng: -0.1276 },
        target: { lat: 48.8566, lng: 2.3522 },
      }),
    ).rejects.toThrow('OpenRouteService returned an invalid route');
  });

  it('requests provider alternatives and normalizes returned route options', async () => {
    const recommendedGeometry: LineString = {
      type: 'LineString',
      coordinates: [
        [-0.1276, 51.5072],
        [2.3522, 48.8566],
      ],
    };
    const alternativeGeometry: LineString = {
      type: 'LineString',
      coordinates: [
        [-0.1276, 51.5072],
        [0.1, 50.9],
        [2.3522, 48.8566],
      ],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: recommendedGeometry,
              properties: { summary: { distance: 458_250, duration: 18_000 } },
            },
            {
              type: 'Feature',
              geometry: alternativeGeometry,
              properties: { summary: { distance: 492_000, duration: 20_700 } },
            },
          ],
        }),
      })
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          type: 'FeatureCollection',
          features: [],
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const options = await calculateOpenRouteServiceRouteOptions({
      apiKey: 'ors-key',
      origin: { lat: 51.5072, lng: -0.1276 },
      target: { lat: 48.8566, lng: 2.3522 },
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.openrouteservice.org/v2/directions/driving-car/geojson',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          coordinates: [
            [-0.1276, 51.5072],
            [2.3522, 48.8566],
          ],
          alternative_routes: {
            target_count: 3,
            share_factor: 0.6,
            weight_factor: 2,
          },
          extra_info: ['waycategory'],
        }),
      }),
    );
    expect(options).toMatchObject([
      {
        id: 'recommended',
        label: 'Recommended',
        source: 'recommended',
        distanceKm: 458.25,
        travelTimeHours: 5,
        geometry: recommendedGeometry,
      },
      {
        id: 'alternative-1',
        label: 'Alternative 1',
        source: 'provider-alternative',
        distanceKm: 492,
        travelTimeHours: 5.75,
        geometry: alternativeGeometry,
      },
    ]);
  });

  it('supplements with supported avoid-feature routes and hides failed supplemental requests', async () => {
    const recommendedGeometry: LineString = {
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
        [0.6, 50.6],
        [2.3522, 48.8566],
      ],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: recommendedGeometry,
              properties: { summary: { distance: 458_250, duration: 18_000 } },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: avoidHighwaysGeometry,
              properties: { summary: { distance: 520_000, duration: 23_040 } },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          type: 'FeatureCollection',
          features: [],
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const options = await calculateOpenRouteServiceRouteOptions({
      apiKey: 'ors-key',
      origin: { lat: 51.5072, lng: -0.1276 },
      target: { lat: 48.8566, lng: 2.3522 },
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.openrouteservice.org/v2/directions/driving-car/geojson',
      expect.objectContaining({
        body: JSON.stringify({
          coordinates: [
            [-0.1276, 51.5072],
            [2.3522, 48.8566],
          ],
          options: {
            avoid_features: ['highways'],
          },
          extra_info: ['waycategory'],
        }),
      }),
    );
    expect(options.map((option) => option.label)).toEqual(['Recommended', 'Avoid highways']);
  });

  it('rethrows persistent quota failures from provider alternatives without attempting supplementals', async () => {
    const rateLimitedResponse = new Response(JSON.stringify({
      error: {
        code: 3099,
        message: 'Rate limit exceeded.',
      },
    }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': '0',
      },
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(rateLimitedResponse.clone())
      .mockResolvedValueOnce(rateLimitedResponse.clone());
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      calculateOpenRouteServiceRouteOptions({
        apiKey: 'ors-key',
        origin: { lat: 51.5072, lng: -0.1276 },
        target: { lat: 48.8566, lng: 2.3522 },
      }),
    ).rejects.toMatchObject({
      name: 'OpenRouteServiceError',
      status: 429,
      code: 3099,
      retryAfterMs: 0,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects auth failures from route options requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({}),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      calculateOpenRouteServiceRouteOptions({
        apiKey: 'ors-key',
        origin: { lat: 51.5072, lng: -0.1276 },
        target: { lat: 48.8566, lng: 2.3522 },
      }),
    ).rejects.toThrow('OpenRouteService route calculation failed');
  });

  it('supplements route options when provider alternatives dedupe below the maximum', async () => {
    const recommendedGeometry: LineString = {
      type: 'LineString',
      coordinates: [
        [-0.1276, 51.5072],
        [2.3522, 48.8566],
      ],
    };
    const alternativeGeometry: LineString = {
      type: 'LineString',
      coordinates: [
        [-0.1276, 51.5072],
        [0.1, 50.9],
        [2.3522, 48.8566],
      ],
    };
    const avoidHighwaysGeometry: LineString = {
      type: 'LineString',
      coordinates: [
        [-0.1276, 51.5072],
        [0.6, 50.6],
        [2.3522, 48.8566],
      ],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: recommendedGeometry,
              properties: { summary: { distance: 458_250, duration: 18_000 } },
            },
            {
              type: 'Feature',
              geometry: alternativeGeometry,
              properties: { summary: { distance: 492_000, duration: 20_700 } },
            },
            {
              type: 'Feature',
              geometry: alternativeGeometry,
              properties: { summary: { distance: 492_000, duration: 20_700 } },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: avoidHighwaysGeometry,
              properties: { summary: { distance: 520_000, duration: 23_040 } },
            },
          ],
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const options = await calculateOpenRouteServiceRouteOptions({
      apiKey: 'ors-key',
      origin: { lat: 51.5072, lng: -0.1276 },
      target: { lat: 48.8566, lng: 2.3522 },
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.openrouteservice.org/v2/directions/driving-car/geojson',
      expect.objectContaining({
        body: JSON.stringify({
          coordinates: [
            [-0.1276, 51.5072],
            [2.3522, 48.8566],
          ],
          options: {
            avoid_features: ['highways'],
          },
          extra_info: ['waycategory'],
        }),
      }),
    );
    expect(options.map((option) => option.label)).toEqual([
      'Recommended',
      'Alternative 1',
      'Avoid highways',
    ]);
  });

  it('requires an API key before route options requests', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      calculateOpenRouteServiceRouteOptions({
        apiKey: '',
        origin: { lat: 51.5072, lng: -0.1276 },
        target: { lat: 48.8566, lng: 2.3522 },
      }),
    ).rejects.toThrow('OpenRouteService API key is required');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('makes route options inherit HGV, waypoint and required-ferry intent', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: [[-0.1276, 51.5072], [9.9796, 57.5948], [10.7522, 59.9139]],
            },
            properties: {
              summary: { distance: 1_200_000, duration: 72_000 },
              extras: { waycategory: { values: [[0, 1, 1], [1, 2, 8]] } },
            },
          }],
        }),
      })
      .mockResolvedValue({ ok: true, json: async () => ({ type: 'FeatureCollection', features: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    const options = await calculateOpenRouteServiceRouteOptions({
      apiKey: 'key',
      origin,
      target: { lat: 59.9139, lng: 10.7522 },
      routingVehicle: resolveVehiclePreset('expedition-truck'),
      ferryPolicy: 'require',
      waypoints: [hirtshals],
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.openrouteservice.org/v2/directions/driving-hgv/geojson',
      expect.objectContaining({
        body: expect.stringContaining('"coordinates":[[-0.1276,51.5072],[9.9796,57.5948],[10.7522,59.9139]]'),
      }),
    );
    expect(fetchMock.mock.calls.map(([, request]) => request.body)).not.toContainEqual(
      expect.stringContaining('"avoid_features":["ferries"]'),
    );
    expect(options[0]?.sections).toContainEqual(expect.objectContaining({ kind: 'ferry' }));
  });
});
