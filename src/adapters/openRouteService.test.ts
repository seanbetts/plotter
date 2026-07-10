import type { LineString } from 'geojson';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  calculateOpenRouteServiceRoute,
  calculateOpenRouteServiceRouteOptions,
} from './openRouteService';

describe('OpenRouteService adapter', () => {
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
        }),
      },
    );
    expect(route).toEqual({
      distanceKm: 458.25,
      travelTimeHours: 5,
      geometry,
      provider: 'openrouteservice',
      profile: 'driving-car',
    });
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

  it('rejects non-OK responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => 'Forbidden',
      }),
    );

    await expect(
      calculateOpenRouteServiceRoute({
        apiKey: 'ors-key',
        origin: { lat: 51.5072, lng: -0.1276 },
        target: { lat: 48.8566, lng: 2.3522 },
      }),
    ).rejects.toThrow('OpenRouteService route calculation failed');
  });

  it('includes the HTTP status in route calculation failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
      }),
    );

    await expect(
      calculateOpenRouteServiceRoute({
        apiKey: 'ors-key',
        origin: { lat: 51.5072, lng: -0.1276 },
        target: { lat: 48.8566, lng: 2.3522 },
      }),
    ).rejects.toThrow('OpenRouteService route calculation failed (HTTP 429)');
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
        }),
      }),
    );
    expect(options.map((option) => option.label)).toEqual(['Recommended', 'Avoid highways']);
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
});
