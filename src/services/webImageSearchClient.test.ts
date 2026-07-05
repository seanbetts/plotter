import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildWebImageProviderQuery,
  createLocalWebImageSearchClient,
  createSupabaseWebImageSearchClient,
  normalizeWebImageSearchResults,
} from './webImageSearchClient';
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

  it('invokes the Supabase image-search function with visible query and context', async () => {
    const invoke = vi.fn(async () => ({
      data: {
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
      },
      error: null,
    }));
    const client = createSupabaseWebImageSearchClient({ functions: { invoke } });

    await expect(client.searchImages('mural', parisContext)).resolves.toHaveLength(1);
    expect(invoke).toHaveBeenCalledWith('image-search', {
      body: {
        query: 'mural',
        context: parisContext,
      },
    });
  });

  it('rejects with the Supabase function error message', async () => {
    const invoke = vi.fn(async () => ({
      data: null,
      error: { message: 'Provider failed' },
    }));
    const client = createSupabaseWebImageSearchClient({ functions: { invoke } });

    await expect(client.searchImages('mural', parisContext)).rejects.toThrow('Provider failed');
  });

  it.each(['context', 'response'] as const)(
    'rejects with an error message from a JSON %s response body',
    async (errorResponseKey) => {
      const invoke = vi.fn(async () => ({
        data: null,
        error: {
          message: 'Function failed',
          [errorResponseKey]: new Response(JSON.stringify({ error: 'Quota exceeded' }), {
            headers: { 'content-type': 'application/json' },
          }),
        },
      }));
      const client = createSupabaseWebImageSearchClient({ functions: { invoke } });

      await expect(client.searchImages('mural', parisContext)).rejects.toThrow('Quota exceeded');
    },
  );

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
