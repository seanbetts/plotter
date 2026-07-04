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
        placeTypes: ['place'],
        context: [
          { id: 'county.1', text: 'West Sussex' },
          { id: 'country.1', text: 'United Kingdom', shortCode: 'gb' },
        ],
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

  it('uses macro stop result types without countries or landforms', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ features: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await searchMapTilerPlaces('Sagres', { apiKey: 'test-key', profile: 'stop' });

    const requestedUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(requestedUrl.searchParams.get('limit')).toBe('8');
    expect(requestedUrl.searchParams.get('types')).toBe(
      [
        'place',
        'locality',
        'municipality',
        'municipal_district',
        'joint_municipality',
        'joint_submunicipality',
        'county',
        'subregion',
        'region',
      ].join(','),
    );
    expect(requestedUrl.searchParams.get('types')).not.toContain('country');
    expect(requestedUrl.searchParams.get('types')).not.toContain('major_landform');
  });

  it('uses micro activity result types and proximity bias', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ features: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await searchMapTilerPlaces('Louvre', {
      apiKey: 'test-key',
      profile: 'activity',
      proximity: { lat: 48.8566, lng: 2.3522 },
    });

    const requestedUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(requestedUrl.searchParams.get('limit')).toBe('10');
    expect(requestedUrl.searchParams.get('types')).toBe(
      ['poi', 'address', 'road', 'neighbourhood', 'place', 'locality'].join(','),
    );
    expect(requestedUrl.searchParams.get('proximity')).toBe('2.3522,48.8566');
  });

  it('preserves MapTiler metadata and computes distance from proximity', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          features: [
            {
              id: 'poi.123',
              text: 'Louvre Museum',
              place_name: 'Louvre Museum, Rue de Rivoli, 75001 Paris, France',
              matching_text: 'Musee du Louvre',
              matching_place_name: 'Musee du Louvre, Paris, France',
              center: [2.3364, 48.8606],
              bbox: [2.333, 48.858, 2.34, 48.863],
              relevance: 0.98,
              place_type: ['poi'],
              place_type_name: ['Museum'],
              address: 'Rue de Rivoli',
              properties: { country_code: 'fr' },
              context: [
                { id: 'place.1', text: 'Paris' },
                { id: 'region.1', text: 'Ile-de-France' },
                { id: 'country.1', text: 'France', short_code: 'fr' },
              ],
            },
          ],
        }),
      }),
    );

    const [result] = await searchMapTilerPlaces('Louvre', {
      apiKey: 'test-key',
      profile: 'activity',
      proximity: { lat: 48.8566, lng: 2.3522 },
    });

    expect(result).toMatchObject({
      kind: 'place',
      id: 'poi.123',
      label: 'Louvre Museum, Rue de Rivoli, 75001 Paris, France',
      placeTypes: ['poi'],
      placeTypeNames: ['Museum'],
      address: 'Rue de Rivoli',
      bbox: [2.333, 48.858, 2.34, 48.863],
      relevance: 0.98,
      matchingText: 'Musee du Louvre',
      matchingPlaceName: 'Musee du Louvre, Paris, France',
      location: {
        placeName: 'Louvre Museum',
        regionName: 'Ile-de-France',
        countryName: 'France',
        countryCode: 'fr',
      },
    });
    expect(result.kind === 'place' ? result.context : []).toEqual([
      { id: 'place.1', text: 'Paris' },
      { id: 'region.1', text: 'Ile-de-France' },
      { id: 'country.1', text: 'France', shortCode: 'fr' },
    ]);
    expect(result.kind === 'place' ? result.distanceFromProximityKm : undefined).toBeCloseTo(1.3, 1);
  });

  it('maps municipal district results such as Sagres, Portugal', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          features: [
            {
              id: 'municipal_district.123',
              text: 'Sagres',
              place_name: 'Sagres, Portugal',
              center: [-8.9419, 37.0078],
              place_type: ['municipal_district'],
              place_type_name: ['Civil parish'],
              context: [
                { id: 'municipality.1', text: 'Vila do Bispo' },
                { id: 'county.1', text: 'Faro' },
                { id: 'country.1', text: 'Portugal', short_code: 'pt' },
              ],
            },
          ],
        }),
      }),
    );

    const [result] = await searchMapTilerPlaces('Sagres', {
      apiKey: 'test-key',
      profile: 'stop',
    });

    expect(result).toMatchObject({
      kind: 'place',
      id: 'municipal_district.123',
      label: 'Sagres, Portugal',
      coordinates: { lat: 37.0078, lng: -8.9419 },
      placeTypes: ['municipal_district'],
      placeTypeNames: ['Civil parish'],
      location: {
        placeName: 'Sagres',
        regionName: 'Faro',
        countryName: 'Portugal',
      },
    });
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
