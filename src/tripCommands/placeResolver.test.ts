import { describe, expect, it, vi } from 'vitest';
import { createPlaceResolver } from './placeResolver';

vi.mock('../adapters/geocoding', () => ({
  searchMapTilerPlaces: vi.fn(async () => [{
    kind: 'place',
    id: 'maptiler:lisbon',
    label: 'Lisbon, Portugal',
    coordinates: { lat: 38.7223, lng: -9.1393 },
    location: {
      placeName: 'Lisbon',
      regionName: 'Lisbon',
      countryName: 'Portugal',
      countryCode: 'PT',
      sourceLabel: 'Lisbon, Portugal',
      sourceProvider: 'maptiler',
      sourceFeatureId: 'maptiler:lisbon',
    },
  }]),
  resolveMapTilerCoordinates: vi.fn(async () => ({
    kind: 'place',
    id: 'maptiler:coords',
    label: 'Kyle of Tongue Hostel & Holiday Park, Scotland',
    coordinates: { lat: 58.492089, lng: -4.427364 },
    location: {
      placeName: 'Kyle of Tongue Hostel & Holiday Park',
      regionName: 'Highland',
      countryName: 'Scotland',
      countryCode: 'GB',
      sourceLabel: 'Kyle of Tongue Hostel & Holiday Park, Scotland',
      sourceProvider: 'maptiler',
      sourceFeatureId: 'maptiler:coords',
    },
  })),
}));

describe('createPlaceResolver', () => {
  it('resolves query-only stops through MapTiler', async () => {
    const resolver = createPlaceResolver({ apiKey: 'key' });
    await expect(resolver({
      place: { query: 'Lisbon, Portugal' },
      profile: 'stop',
      fallbackName: 'Lisbon',
    })).resolves.toMatchObject({
      coordinates: { lat: 38.7223, lng: -9.1393 },
      location: { countryName: 'Portugal' },
    });
  });

  it('uses coordinates as the route anchor and enriches them when possible', async () => {
    const resolver = createPlaceResolver({ apiKey: 'key' });
    await expect(resolver({
      place: { coordinates: { lat: 58.492089, lng: -4.427364 } },
      profile: 'stop',
      fallbackName: 'Tongue',
    })).resolves.toMatchObject({
      coordinates: { lat: 58.492089, lng: -4.427364 },
      location: { placeName: 'Kyle of Tongue Hostel & Holiday Park' },
    });
  });

  it('falls back to legacy destination location when coordinates are present and MapTiler is unavailable', async () => {
    const resolver = createPlaceResolver({});
    await expect(resolver({
      place: { coordinates: { lat: 58.492089, lng: -4.427364 } },
      profile: 'stop',
      fallbackName: 'Tongue',
    })).resolves.toEqual({
      coordinates: { lat: 58.492089, lng: -4.427364 },
      location: {
        placeName: 'Tongue',
        regionName: '',
        countryName: '',
        sourceLabel: 'Tongue',
        sourceProvider: 'legacy',
      },
    });
  });

  it('rejects query-only place input without a MapTiler API key', async () => {
    const resolver = createPlaceResolver({});
    await expect(resolver({
      place: { query: 'Lisbon, Portugal' },
      profile: 'stop',
      fallbackName: 'Lisbon',
    })).rejects.toThrow('MapTiler API key is required to resolve place queries.');
  });
});
