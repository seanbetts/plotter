import { describe, expect, it, vi } from 'vitest';
import {
  createLinkPreviewProvider,
  type ProviderBoundaryDependencies,
} from './linkPreview';

const PUBLIC_IPV4 = { address: '93.184.216.34', family: 4 as const };

function dependencies(
  overrides: Partial<ProviderBoundaryDependencies> = {},
): ProviderBoundaryDependencies {
  return {
    resolve: vi.fn(async () => [PUBLIC_IPV4]),
    fetch: vi.fn(async () => new Response('<title>Example</title>', {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })),
    scheduleTimeout: setTimeout,
    clearScheduledTimeout: clearTimeout,
    ...overrides,
  };
}

describe('fetchLinkPreview', () => {
  it('normalizes an omitted scheme and preserves Open Graph metadata precedence', async () => {
    const deps = dependencies({
      fetch: vi.fn(async () => new Response(`
        <title>Document title</title>
        <meta name="twitter:title" content="Twitter title">
        <meta property="og:image" content="/og.jpg">
        <meta property="og:title" content="OG &amp; title">
      `, { headers: { 'content-type': 'text/html' } })),
    });

    const preview = await createLinkPreviewProvider(deps)(
      { url: ' example.com/menu ' },
      new AbortController().signal,
    );

    expect(preview).toEqual({
      url: 'https://example.com/menu',
      title: 'OG & title',
      domain: 'example.com',
      imageUrl: 'https://example.com/og.jpg',
    });
    expect(deps.fetch).toHaveBeenCalledWith(
      new URL('https://example.com/menu'),
      expect.objectContaining({
        redirect: 'manual',
        signal: expect.any(AbortSignal),
      }),
      [PUBLIC_IPV4],
    );
  });

  it('falls back from Twitter metadata to the document title and then domain', async () => {
    const responses = [
      '<meta name="twitter:title" content=" Twitter title ">',
      '<title> Document\n title </title>',
      '<html><body>No metadata</body></html>',
    ];
    const deps = dependencies({
      fetch: vi.fn(async () => new Response(responses.shift(), {
        headers: { 'content-type': 'application/xhtml+xml' },
      })),
    });
    const provider = createLinkPreviewProvider(deps);

    await expect(provider({ url: 'https://www.example.com/twitter' }, new AbortController().signal))
      .resolves.toMatchObject({ title: 'Twitter title', domain: 'example.com' });
    await expect(provider({ url: 'https://www.example.com/title' }, new AbortController().signal))
      .resolves.toMatchObject({ title: 'Document title', domain: 'example.com' });
    await expect(provider({ url: 'https://www.example.com/fallback' }, new AbortController().signal))
      .resolves.toMatchObject({ title: 'example.com', domain: 'example.com' });
  });

  it.each([
    'ftp://example.com/file',
    'http://localhost/admin',
    'http://127.0.0.1/admin',
    'http://169.254.1.2/',
    'http://192.168.1.10/',
    'http://100.64.0.1/',
    'http://192.0.2.1/',
    'http://198.18.0.1/',
    'http://224.0.0.1/',
    'http://255.255.255.255/',
    'http://[::]/',
    'http://[::1]/',
    'http://[fc00::1]/',
    'http://[fe80::1]/',
    'http://[fec0::1]/',
    'http://[ff00::1]/',
    'http://[100::1]/',
    'http://[2001::1]/',
    'http://[2001:2::1]/',
    'http://[2001:10::1]/',
    'http://[2001:20::1]/',
    'http://[2001:db8::1]/',
    'http://[2002:7f00:1::]/',
    'http://[3fff::1]/',
    'http://[4000::1]/',
    'http://[5f00::1]/',
    'http://[fe00::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:93.184.216.34]/',
    'http://[::93.184.216.34]/',
  ])('rejects non-public target %s before requesting it', async (url) => {
    const deps = dependencies();

    await expect(createLinkPreviewProvider(deps)({ url }, new AbortController().signal))
      .rejects.toThrow(/public URL|http or https/);
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it.each([
    'http://[2606:2800:220:1:248:1893:25c8:1946]/',
    'http://[64:ff9b::5db8:d822]/',
  ])('allows the explicitly global IPv6 target %s', async (url) => {
    const deps = dependencies();

    await expect(createLinkPreviewProvider(deps)({ url }, new AbortController().signal))
      .resolves.toMatchObject({ title: 'Example' });
    expect(deps.fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects a hostname when any resolved address is non-public', async () => {
    const deps = dependencies({
      resolve: vi.fn(async () => [
        PUBLIC_IPV4,
        { address: 'fd00::1', family: 6 as const },
      ]),
    });

    await expect(createLinkPreviewProvider(deps)(
      { url: 'https://example.com/private' },
      new AbortController().signal,
    )).rejects.toThrow('Enter a public URL.');
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it.each(['4000::1', 'fe00::1'])(
    'rejects the non-global IPv6 DNS answer %s',
    async (address) => {
      const deps = dependencies({
        resolve: vi.fn(async () => [{ address, family: 6 as const }]),
      });

      await expect(createLinkPreviewProvider(deps)(
        { url: 'https://example.com/non-global' },
        new AbortController().signal,
      )).rejects.toThrow('Enter a public URL.');
      expect(deps.fetch).not.toHaveBeenCalled();
    },
  );

  it('disables automatic redirects and validates DNS again before each hop', async () => {
    const events: string[] = [];
    const deps = dependencies({
      resolve: vi.fn(async (hostname) => {
        events.push(`resolve:${hostname}`);
        return [PUBLIC_IPV4];
      }),
      fetch: vi.fn(async (url, init) => {
        events.push(`fetch:${url.toString()}:${init.redirect}`);
        if (url.hostname === 'example.com') {
          return new Response(null, {
            status: 302,
            headers: { location: 'https://cdn.example.net/page' },
          });
        }
        return new Response('<title>Redirected</title>', {
          headers: { 'content-type': 'text/html' },
        });
      }),
    });

    await expect(createLinkPreviewProvider(deps)(
      { url: 'https://example.com/start' },
      new AbortController().signal,
    )).resolves.toMatchObject({
      url: 'https://cdn.example.net/page',
      title: 'Redirected',
    });
    expect(events).toEqual([
      'resolve:example.com',
      'fetch:https://example.com/start:manual',
      'resolve:cdn.example.net',
      'fetch:https://cdn.example.net/page:manual',
    ]);
  });

  it('rejects a redirect whose hostname resolves privately before the second request', async () => {
    const deps = dependencies({
      resolve: vi.fn(async (hostname) => hostname === 'private.example'
        ? [{ address: '10.0.0.4', family: 4 as const }]
        : [PUBLIC_IPV4]),
      fetch: vi.fn(async () => new Response(null, {
        status: 302,
        headers: { location: 'http://private.example/admin' },
      })),
    });

    await expect(createLinkPreviewProvider(deps)(
      { url: 'https://example.com/start' },
      new AbortController().signal,
    )).rejects.toThrow('Enter a public URL.');
    expect(deps.fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects non-HTML responses and cancels their bodies', async () => {
    let canceled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array([1]));
      },
      cancel() {
        canceled = true;
      },
    });
    const deps = dependencies({
      fetch: vi.fn(async () => new Response(body, {
        headers: { 'content-type': 'application/json' },
      })),
    });

    await expect(createLinkPreviewProvider(deps)(
      { url: 'https://example.com/data' },
      new AbortController().signal,
    )).rejects.toThrow('URL returned a non-HTML response.');
    expect(canceled).toBe(true);
  });

  it('rejects and cancels HTML streams larger than 512,000 bytes', async () => {
    let canceled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(256_001));
      },
      cancel() {
        canceled = true;
      },
    });
    const deps = dependencies({
      fetch: vi.fn(async () => new Response(body, {
        headers: { 'content-type': 'text/html' },
      })),
    });

    await expect(createLinkPreviewProvider(deps)(
      { url: 'https://example.com/large' },
      new AbortController().signal,
    )).rejects.toThrow('Link preview response is too large.');
    expect(canceled).toBe(true);
  });

  it('aborts slow requests at the five-second boundary and redacts boundary failures', async () => {
    let scheduledDelay = 0;
    const deps = dependencies({
      scheduleTimeout(callback, delay) {
        scheduledDelay = delay;
        return setTimeout(callback, 0);
      },
      fetch: vi.fn(async (_url, init) => new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new Error('secret upstream path /admin at 10.0.0.8'));
        }, { once: true });
      })),
    });

    const error = await createLinkPreviewProvider(deps)(
      { url: 'https://example.com/slow' },
      new AbortController().signal,
    ).catch((caught: unknown) => caught);

    expect(scheduledDelay).toBe(5_000);
    expect(error).toEqual(new Error('Unable to fetch link preview.'));
    if (!(error instanceof Error)) throw new Error('Expected an Error.');
    expect(error.message).not.toContain('10.0.0.8');
    expect(error.message).not.toContain('/admin');
  });

  it('bounds DNS resolution with the same five-second deadline', async () => {
    const deps = dependencies({
      resolve: vi.fn(async () => new Promise<never>(() => undefined)),
      scheduleTimeout(callback) {
        return setTimeout(callback, 0);
      },
    });
    const providerResult = createLinkPreviewProvider(deps)(
      { url: 'https://example.com/dns' },
      new AbortController().signal,
    ).then(
      () => 'unexpected success',
      (error: unknown) => error,
    );

    const result = await Promise.race([
      providerResult,
      new Promise<string>((resolve) => setTimeout(() => resolve('dns remained pending'), 100)),
    ]);

    expect(result).toEqual(new Error('Unable to resolve URL host.'));
    expect(deps.fetch).not.toHaveBeenCalled();
  });
});
