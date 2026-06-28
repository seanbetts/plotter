import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  parseCoordinateQuery,
  resolveMapTilerCoordinates,
  searchMapTilerPlaces,
} from './geocoding';

describe('geocoding adapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps MapTiler place results into the app taxonomy', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        features: [
          {
            id: 'place.123',
            text: 'Balcombe',
            place_name: 'Balcombe, West Sussex, England, United Kingdom',
            center: [-0.1342, 51.0576],
            place_type: ['place'],
            properties: { country_code: 'gb' },
            context: [
              { id: 'county.1', text: 'West Sussex' },
              { id: 'country.1', text: 'United Kingdom', short_code: 'gb' },
            ],
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const results = await searchMapTilerPlaces('Balcombe', { apiKey: 'test-key' });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('https://api.maptiler.com/geocoding/Balcombe.json'),
      expect.any(Object),
    );
    expect(results).toEqual([
      {
        kind: 'place',
        id: 'place.123',
        label: 'Balcombe, West Sussex, England, United Kingdom',
        coordinates: { lat: 51.0576, lng: -0.1342 },
        location: {
          placeName: 'Balcombe',
          regionName: 'West Sussex',
          countryName: 'United Kingdom',
          countryCode: 'gb',
          sourceLabel: 'Balcombe, West Sussex, England, United Kingdom',
          sourceProvider: 'maptiler',
          sourceFeatureId: 'place.123',
        },
      },
    ]);
  });

  it('returns a local coordinate result without fetching while typing coordinates', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const results = await searchMapTilerPlaces('51.0576, -0.1342', { apiKey: 'test-key' });

    expect(results).toEqual([
      {
        kind: 'coordinates',
        id: 'coordinates:51.0576,-0.1342',
        label: 'Use coordinates 51.0576, -0.1342',
        coordinates: { lat: 51.0576, lng: -0.1342 },
      },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('parses common lat/lng formats', () => {
    expect(parseCoordinateQuery('51.0576, -0.1342')).toEqual({ lat: 51.0576, lng: -0.1342 });
    expect(parseCoordinateQuery('51.0576 -0.1342')).toEqual({ lat: 51.0576, lng: -0.1342 });
    expect(parseCoordinateQuery('91, 0')).toBeNull();
    expect(parseCoordinateQuery('0, 181')).toBeNull();
    expect(parseCoordinateQuery('Paris')).toBeNull();
  });

  it('reverse geocodes selected coordinates into the app taxonomy', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          features: [
            {
              id: 'reverse.123',
              text: 'Balcombe',
              place_name: 'Balcombe, West Sussex, England, United Kingdom',
              center: [-0.1342, 51.0576],
              place_type: ['place'],
              properties: { country_code: 'gb' },
              context: [
                { id: 'county.1', text: 'West Sussex' },
                { id: 'country.1', text: 'United Kingdom', short_code: 'gb' },
              ],
            },
          ],
        }),
      }),
    );

    const result = await resolveMapTilerCoordinates(
      { lat: 51.0576, lng: -0.1342 },
      { apiKey: 'test-key' },
    );

    expect(result.location.placeName).toBe('Balcombe');
    expect(result.location.regionName).toBe('West Sussex');
    expect(result.location.countryName).toBe('United Kingdom');
  });

  it('returns no results and skips fetch for a blank query', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const results = await searchMapTilerPlaces('   ', { apiKey: 'test-key' });

    expect(results).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects when MapTiler returns a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

    await expect(searchMapTilerPlaces('Istanbul', { apiKey: 'test-key' })).rejects.toThrow(
      'Place search failed',
    );
  });
});
