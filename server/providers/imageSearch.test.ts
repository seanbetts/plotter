import { describe, expect, it, vi } from 'vitest';
import type { ProviderBoundaryDependencies } from './linkPreview';
import { createImageSearchProvider } from './imageSearch';

const PUBLIC_IPV4 = { address: '151.101.1.91', family: 4 as const };

function dependencies(
  fetch: ProviderBoundaryDependencies['fetch'],
  overrides: Partial<ProviderBoundaryDependencies> = {},
): ProviderBoundaryDependencies {
  return {
    resolve: vi.fn(async () => [PUBLIC_IPV4]),
    fetch,
    scheduleTimeout: setTimeout,
    clearScheduledTimeout: clearTimeout,
    ...overrides,
  };
}

describe('searchWebImages', () => {
  it('builds the bounded SerpApi Light request and normalizes the app result contract', async () => {
    const deps = dependencies(vi.fn(async () => Response.json({
      images_results: [
        {
          position: 4,
          title: ' Paris mural ',
          source: ' Example ',
          link: 'https://example.com/page',
          thumbnail: 'https://example.com/thumb.jpg',
          original: 'https://example.com/original.jpg',
          original_width: 1800,
          original_height: 1200,
          provider_only_field: 'do not expose',
        },
      ],
      provider_metadata: { account_id: 'private' },
    })));

    const results = await createImageSearchProvider(deps)(
      { query: '  street   art Paris France  ' },
      'secret-key',
      new AbortController().signal,
    );

    expect(results).toEqual([{
      id: 'serpapi-4',
      title: 'Paris mural',
      sourceName: 'Example',
      sourceUrl: 'https://example.com/page',
      thumbnailUrl: 'https://example.com/thumb.jpg',
      imageUrl: 'https://example.com/original.jpg',
      width: 1800,
      height: 1200,
    }]);
    const [url, init, addresses] = vi.mocked(deps.fetch).mock.calls[0]!;
    expect(url.origin).toBe('https://serpapi.com');
    expect(url.pathname).toBe('/search.json');
    expect(url.searchParams.get('engine')).toBe('google_images_light');
    expect(url.searchParams.get('q')).toBe('street art Paris France');
    expect(url.searchParams.get('api_key')).toBe('secret-key');
    expect(url.searchParams.get('hl')).toBe('en');
    expect(url.searchParams.get('gl')).toBe('us');
    expect(url.searchParams.get('device')).toBe('desktop');
    expect(url.searchParams.get('imgsz')).toBe('l');
    expect(url.searchParams.get('image_type')).toBe('photo');
    expect(init).toMatchObject({ redirect: 'manual', signal: expect.any(AbortSignal) });
    expect(addresses).toEqual([PUBLIC_IPV4]);
  });

  it('filters low-resolution results but retains results with unknown dimensions', async () => {
    const result = (position: number, width?: number, height?: number) => ({
      position,
      title: `Image ${position}`,
      source: 'Example',
      link: `https://example.com/page-${position}`,
      thumbnail: `https://example.com/thumb-${position}.jpg`,
      original: `https://example.com/image-${position}.jpg`,
      ...(width === undefined ? {} : { original_width: width }),
      ...(height === undefined ? {} : { original_height: height }),
    });
    const deps = dependencies(vi.fn(async () => Response.json({
      images_results: [result(1, 640, 480), result(2, 1800, 1200), result(3)],
    })));

    const results = await createImageSearchProvider(deps)(
      { query: 'mural' },
      'secret-key',
      new AbortController().signal,
    );

    expect(results.map(({ id }) => id)).toEqual(['serpapi-2', 'serpapi-3']);
  });

  it('drops malformed provider entries instead of leaking raw payload shape', async () => {
    const deps = dependencies(vi.fn(async () => Response.json({
      images_results: [
        null,
        { title: 'Missing URLs', source: 'Provider' },
        {
          title: 'Fallback source',
          link: 'https://www.example.com/page',
          thumbnail: 'https://example.com/thumb.jpg',
          original: 'https://example.com/image.jpg',
        },
      ],
    })));

    await expect(createImageSearchProvider(deps)(
      { query: 'mural' },
      'secret-key',
      new AbortController().signal,
    )).resolves.toEqual([expect.objectContaining({
      title: 'Fallback source',
      sourceName: 'example.com',
    })]);
  });

  it('returns no results for a blank query without contacting the provider', async () => {
    const deps = dependencies(vi.fn());

    await expect(createImageSearchProvider(deps)(
      { query: '   ' },
      'secret-key',
      new AbortController().signal,
    )).resolves.toEqual([]);
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it('returns the stable missing-key error without contacting the provider', async () => {
    const deps = dependencies(vi.fn());

    await expect(createImageSearchProvider(deps)(
      { query: 'mural' },
      '   ',
      new AbortController().signal,
    )).rejects.toThrow('Set SERPAPI_API_KEY before searching web images.');
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it.each([
    new Response('<html>private body</html>', { status: 429, headers: { 'content-type': 'text/html' } }),
    Response.json({ error: 'invalid secret-key for private account' }),
    new Response('not json', { headers: { 'content-type': 'application/json' } }),
  ])('redacts provider failures and payloads', async (response) => {
    const deps = dependencies(vi.fn(async () => response));

    const error = await createImageSearchProvider(deps)(
      { query: 'mural' },
      'secret-key',
      new AbortController().signal,
    ).catch((caught: unknown) => caught);

    expect(error).toEqual(new Error('Unable to search web images.'));
    if (!(error instanceof Error)) throw new Error('Expected an Error.');
    expect(error.message).not.toContain('secret-key');
    expect(error.message).not.toContain('private');
  });

  it('rejects and cancels JSON responses larger than 1,000,000 bytes', async () => {
    let canceled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(500_001));
      },
      cancel() {
        canceled = true;
      },
    });
    const deps = dependencies(vi.fn(async () => new Response(body, {
      headers: { 'content-type': 'application/json' },
    })));

    await expect(createImageSearchProvider(deps)(
      { query: 'mural' },
      'secret-key',
      new AbortController().signal,
    )).rejects.toThrow('Unable to search web images.');
    expect(canceled).toBe(true);
  });

  it('aborts at the five-second boundary and exposes no request URL or key', async () => {
    let scheduledDelay = 0;
    const deps = dependencies(
      vi.fn(async (_url, init) => new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error(
          'https://serpapi.com/search.json?api_key=secret-key&private=body',
        )), { once: true });
      })),
      {
        scheduleTimeout(callback, delay) {
          scheduledDelay = delay;
          return setTimeout(callback, 0);
        },
      },
    );

    const error = await createImageSearchProvider(deps)(
      { query: 'mural' },
      'secret-key',
      new AbortController().signal,
    ).catch((caught: unknown) => caught);

    expect(scheduledDelay).toBe(5_000);
    expect(error).toEqual(new Error('Unable to search web images.'));
    if (!(error instanceof Error)) throw new Error('Expected an Error.');
    expect(error.message).not.toContain('secret-key');
  });
});
