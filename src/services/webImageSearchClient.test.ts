import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildWebImageProviderQuery,
  createHttpWebImageSearchClient,
  createLocalWebImageSearchClient,
  normalizeWebImageSearchResults,
} from './webImageSearchClient';
import type { PlotterApiClient } from '../api/client';
import type { WebImageSearchResult, WebImageSearchStopContext } from './webImageSearchClient';

const parisContext: WebImageSearchStopContext = {
  stopName: 'Paris',
  regionName: 'Ile-de-France',
  countryName: 'France',
  countryCode: 'FR',
};

describe('webImageSearchClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('expands a visible query with stop and country context', () => {
    expect(buildWebImageProviderQuery(' street art ', parisContext)).toBe('street art Paris France');
  });

  it('uses region when country is unavailable and avoids duplicated names', () => {
    expect(buildWebImageProviderQuery('Paris street art', {
      stopName: 'Paris',
      regionName: 'Ile-de-France',
      countryName: '',
    })).toBe('Paris street art Ile-de-France');
  });

  it('adds activity address locality without duplicating the typed activity name', () => {
    expect(buildWebImageProviderQuery('volume 1 climbing', {
      stopName: 'Volume 1 Climbing',
      locationName: 'Volume 1 Climbing',
      address: 'Unit 3, Kingstanding Way, Tunbridge Wells TN2 3UP, United Kingdom',
      latitude: 51.1426,
      longitude: 0.2639,
      countryName: 'United Kingdom',
      countryCode: 'GB',
    })).toBe('volume 1 climbing Kingstanding Way Tunbridge Wells United Kingdom');
  });

  it('keeps locality when an activity address starts with the venue name', () => {
    expect(buildWebImageProviderQuery('volume 1 climbing', {
      stopName: 'Volume 1 Climbing',
      locationName: 'Volume 1 Climbing',
      address: 'Volume 1 Climbing, Unit 12 Hills Road, East Grinstead RH19 1XZ, United Kingdom',
      latitude: 51.13552738990131,
      longitude: -0.0390885158662968,
      countryName: 'United Kingdom',
      countryCode: 'GB',
    })).toBe('volume 1 climbing Hills Road East Grinstead United Kingdom');
  });

  it('normalizes function result fields and filters invalid rows', () => {
    expect(normalizeWebImageSearchResults([
      {
        id: '1',
        title: 'Street art in Paris',
        sourceName: 'Example',
        sourceUrl: 'https://example.com/page',
        thumbnailUrl: 'https://example.com/thumb.jpg',
        imageUrl: 'https://example.com/image.jpg',
        width: 1800,
        height: 1200,
      },
      {
        id: '',
        title: '',
        sourceName: '',
        sourceUrl: 'ftp://example.com',
        thumbnailUrl: '',
        imageUrl: '',
      },
    ])).toEqual<WebImageSearchResult[]>([
      {
        id: '1',
        title: 'Street art in Paris',
        sourceName: 'Example',
        sourceUrl: 'https://example.com/page',
        thumbnailUrl: 'https://example.com/thumb.jpg',
        imageUrl: 'https://example.com/image.jpg',
        width: 1800,
        height: 1200,
      },
    ]);
  });

  it('keeps valid results with unknown dimensions', () => {
    expect(normalizeWebImageSearchResults([
      {
        id: '1',
        title: 'Street art in Paris',
        sourceName: 'Example',
        sourceUrl: 'https://example.com/page',
        thumbnailUrl: 'https://example.com/thumb.jpg',
        imageUrl: 'https://example.com/image.jpg',
      },
    ])).toEqual<WebImageSearchResult[]>([
      {
        id: '1',
        title: 'Street art in Paris',
        sourceName: 'Example',
        sourceUrl: 'https://example.com/page',
        thumbnailUrl: 'https://example.com/thumb.jpg',
        imageUrl: 'https://example.com/image.jpg',
      },
    ]);
  });

  it('omits invalid dimensions without dropping otherwise valid results', () => {
    expect(normalizeWebImageSearchResults([
      {
        id: '1',
        title: 'Street art in Paris',
        sourceName: 'Example',
        sourceUrl: 'https://example.com/page',
        thumbnailUrl: 'https://example.com/thumb.jpg',
        imageUrl: 'https://example.com/image.jpg',
        width: Infinity,
        height: 1200,
      },
      {
        id: '2',
        title: 'Paris mural',
        sourceName: 'Example',
        sourceUrl: 'https://example.com/mural',
        thumbnailUrl: 'https://example.com/mural-thumb.jpg',
        imageUrl: 'https://example.com/mural.jpg',
        width: '1600',
        height: Number.NaN,
      },
    ])).toEqual<WebImageSearchResult[]>([
      {
        id: '1',
        title: 'Street art in Paris',
        sourceName: 'Example',
        sourceUrl: 'https://example.com/page',
        thumbnailUrl: 'https://example.com/thumb.jpg',
        imageUrl: 'https://example.com/image.jpg',
        height: 1200,
      },
      {
        id: '2',
        title: 'Paris mural',
        sourceName: 'Example',
        sourceUrl: 'https://example.com/mural',
        thumbnailUrl: 'https://example.com/mural-thumb.jpg',
        imageUrl: 'https://example.com/mural.jpg',
      },
    ]);
  });

  it('posts image searches to the shared service route with visible query and context', async () => {
    const request = vi.fn(async () => ({
      results: [
          {
            id: 'paris-1',
            title: 'Paris mural',
            sourceName: 'Example',
            sourceUrl: 'https://example.com/page',
            thumbnailUrl: 'https://example.com/thumb.jpg',
            imageUrl: 'https://example.com/image.jpg',
            width: 1600,
            height: 1000,
          },
      ],
    }));
    const client = createHttpWebImageSearchClient({ request } as Pick<PlotterApiClient, 'request'>);

    await expect(client.searchImages('mural', parisContext)).resolves.toHaveLength(1);
    expect(request).toHaveBeenCalledWith('/api/v1/image-search', {
      method: 'POST',
      body: JSON.stringify({
        query: 'mural',
        context: parisContext,
      }),
    });
  });

  it('preserves the shared API client error', async () => {
    const client = createHttpWebImageSearchClient({
      request: vi.fn().mockRejectedValue(new Error('Provider failed')),
    } as Pick<PlotterApiClient, 'request'>);

    await expect(client.searchImages('mural', parisContext)).rejects.toThrow('Provider failed');
  });

  it('returns deterministic local results for e2e-local mode', async () => {
    const client = createLocalWebImageSearchClient();

    await expect(client.searchImages('mural', parisContext)).resolves.toEqual([
      expect.objectContaining({
        id: 'local-web-image-mural-paris-france',
        title: 'mural in Paris',
        sourceName: 'Local image search',
      }),
    ]);
  });
});
