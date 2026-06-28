import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchNominatimPlaces } from './geocoding';

describe('geocoding adapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps Nominatim results into place search results', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            place_id: 1,
            display_name: 'Istanbul, Turkey',
            lat: '41.0082',
            lon: '28.9784',
          },
        ],
      }),
    );

    const results = await searchNominatimPlaces('Istanbul');

    expect(results).toEqual([
      {
        id: '1',
        label: 'Istanbul, Turkey',
        coordinates: { lat: 41.0082, lng: 28.9784 },
        countryRegion: 'Turkey',
      },
    ]);
  });

  it('returns no results and skips fetch for a blank query', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const results = await searchNominatimPlaces('   ');

    expect(results).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects when Nominatim returns a non-OK response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
      }),
    );

    await expect(searchNominatimPlaces('Istanbul')).rejects.toThrow('Place search failed');
  });
});
