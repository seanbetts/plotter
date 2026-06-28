import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchNominatimPlaces } from './geocoding';

describe('geocoding adapter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
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
});
