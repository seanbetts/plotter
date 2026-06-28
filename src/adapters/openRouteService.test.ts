import type { LineString } from 'geojson';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { calculateOpenRouteServiceRoute } from './openRouteService';

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
});
