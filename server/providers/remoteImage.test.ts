import { describe, expect, it, vi } from 'vitest';
import type { ProviderBoundaryDependencies } from './linkPreview';
import { createRemoteImageProvider } from './remoteImage';

const PUBLIC_IPV4 = { address: '93.184.216.34', family: 4 as const };

function dependencies(
  overrides: Partial<ProviderBoundaryDependencies> = {},
): ProviderBoundaryDependencies {
  return {
    resolve: vi.fn(async () => [PUBLIC_IPV4]),
    fetch: vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), {
      headers: { 'content-type': 'image/jpeg' },
    })),
    scheduleTimeout: setTimeout,
    clearScheduledTimeout: clearTimeout,
    ...overrides,
  };
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let byteCount = 0;
  for await (const chunk of stream) {
    chunks.push(chunk);
    byteCount += chunk.byteLength;
  }
  const bytes = new Uint8Array(byteCount);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

describe('fetchRemoteImage', () => {
  it('returns only a validated image stream and normalized content type', async () => {
    const deps = dependencies();

    const image = await createRemoteImageProvider(deps)(
      { url: 'https://example.com/image.jpg' },
      new AbortController().signal,
    );

    expect(image.contentType).toBe('image/jpeg');
    await expect(readAll(image.bytes)).resolves.toEqual(new Uint8Array([1, 2, 3]));
    expect(deps.fetch).toHaveBeenCalledWith(
      new URL('https://example.com/image.jpg'),
      expect.objectContaining({ redirect: 'manual', signal: expect.any(AbortSignal) }),
      [PUBLIC_IPV4],
    );
  });

  it.each([
    'ftp://example.com/file.jpg',
    'http://localhost/image.jpg',
    'http://127.0.0.1/image.jpg',
    'http://10.0.0.1/image.jpg',
    'http://169.254.169.254/latest/meta-data',
    'http://192.168.0.1/image.jpg',
    'http://[::1]/image.jpg',
    'http://[fd00::1]/image.jpg',
    'http://[fe80::1]/image.jpg',
    'http://[ff02::1]/image.jpg',
    'http://[2001:db8::1]/image.jpg',
    'http://[::ffff:192.168.0.1]/image.jpg',
  ])('rejects the non-public target %s before requesting it', async (url) => {
    const deps = dependencies();

    await expect(createRemoteImageProvider(deps)({ url }, new AbortController().signal))
      .rejects.toThrow(/public image URL|http or https/);
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it('resolves and validates every redirect target before requesting the next hop', async () => {
    const events: string[] = [];
    const deps = dependencies({
      resolve: vi.fn(async (hostname) => {
        events.push(`resolve:${hostname}`);
        return hostname === 'private.example'
          ? [{ address: '172.16.0.1', family: 4 as const }]
          : [PUBLIC_IPV4];
      }),
      fetch: vi.fn(async (url) => {
        events.push(`fetch:${url.toString()}`);
        return new Response(null, {
          status: 302,
          headers: { location: 'http://private.example/image.jpg' },
        });
      }),
    });

    await expect(createRemoteImageProvider(deps)(
      { url: 'https://example.com/start.jpg' },
      new AbortController().signal,
    )).rejects.toThrow('Enter a public image URL.');
    expect(events).toEqual([
      'resolve:example.com',
      'fetch:https://example.com/start.jpg',
      'resolve:private.example',
    ]);
  });

  it('follows at most three safe redirects with automatic following disabled', async () => {
    const deps = dependencies({
      fetch: vi.fn(async () => new Response(null, {
        status: 302,
        headers: { location: '/loop.jpg' },
      })),
    });

    await expect(createRemoteImageProvider(deps)(
      { url: 'https://example.com/loop.jpg' },
      new AbortController().signal,
    )).rejects.toThrow('Too many redirects while fetching image.');
    expect(deps.fetch).toHaveBeenCalledTimes(4);
    for (const [, init] of vi.mocked(deps.fetch).mock.calls) {
      expect(init.redirect).toBe('manual');
    }
  });

  it('rejects unsupported response types and cancels their bodies', async () => {
    let canceled = false;
    const deps = dependencies({
      fetch: vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array([1]));
        },
        cancel() {
          canceled = true;
        },
      }), { headers: { 'content-type': 'text/html' } })),
    });

    await expect(createRemoteImageProvider(deps)(
      { url: 'https://example.com/not-image' },
      new AbortController().signal,
    )).rejects.toThrow('Selected result did not return a supported image.');
    expect(canceled).toBe(true);
  });

  it('rejects declared bodies over 50 MiB before returning and cancels the stream', async () => {
    let canceled = false;
    const deps = dependencies({
      fetch: vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array([1]));
        },
        cancel() {
          canceled = true;
        },
      }), {
        headers: {
          'content-type': 'image/png',
          'content-length': `${50 * 1024 * 1024 + 1}`,
        },
      })),
    });

    await expect(createRemoteImageProvider(deps)(
      { url: 'https://example.com/large.png' },
      new AbortController().signal,
    )).rejects.toThrow('Selected image is too large.');
    expect(canceled).toBe(true);
  });

  it('errors and cancels a returned stream as soon as it crosses 50 MiB', async () => {
    let pulls = 0;
    let canceled = false;
    const deps = dependencies({
      fetch: vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls += 1;
          controller.enqueue(new Uint8Array(1024 * 1024));
        },
        cancel() {
          canceled = true;
        },
      }), { headers: { 'content-type': 'image/webp' } })),
    });
    const image = await createRemoteImageProvider(deps)(
      { url: 'https://example.com/large.webp' },
      new AbortController().signal,
    );

    await expect(readAll(image.bytes)).rejects.toThrow('Selected image is too large.');
    expect(pulls).toBeLessThanOrEqual(52);
    expect(canceled).toBe(true);
  });

  it('rejects empty image bodies', async () => {
    const deps = dependencies({
      fetch: vi.fn(async () => new Response(new Uint8Array(), {
        headers: { 'content-type': 'image/gif' },
      })),
    });

    await expect(createRemoteImageProvider(deps)(
      { url: 'https://example.com/empty.gif' },
      new AbortController().signal,
    )).rejects.toThrow('Selected image was empty.');
  });

  it('propagates consumer cancellation to the provider body', async () => {
    let canceled = false;
    const deps = dependencies({
      fetch: vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array([1]));
        },
        cancel() {
          canceled = true;
        },
      }), { headers: { 'content-type': 'image/png' } })),
    });
    const image = await createRemoteImageProvider(deps)(
      { url: 'https://example.com/image.png' },
      new AbortController().signal,
    );

    await image.bytes.cancel('no longer needed');
    expect(canceled).toBe(true);
  });

  it('keeps the timeout active until the returned stream finishes', async () => {
    let timeout: (() => void) | undefined;
    let sourceCanceled = false;
    const deps = dependencies({
      scheduleTimeout(callback) {
        timeout = callback;
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
      clearScheduledTimeout: vi.fn(),
      fetch: vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1]));
        },
        pull() {
          return new Promise(() => undefined);
        },
        cancel() {
          sourceCanceled = true;
        },
      }), { headers: { 'content-type': 'image/png' } })),
    });
    const image = await createRemoteImageProvider(deps)(
      { url: 'https://example.com/stream.png' },
      new AbortController().signal,
    );
    const reader = image.bytes.getReader();
    await expect(reader.read()).resolves.toEqual({ done: false, value: new Uint8Array([1]) });
    const next = reader.read();

    timeout?.();

    await expect(next).rejects.toThrow('Unable to fetch image.');
    expect(sourceCanceled).toBe(true);
    expect(deps.clearScheduledTimeout).toHaveBeenCalled();
  });

  it('aborts a slow response at five seconds and redacts failures', async () => {
    let scheduledDelay = 0;
    const deps = dependencies({
      scheduleTimeout(callback, delay) {
        scheduledDelay = delay;
        return setTimeout(callback, 0);
      },
      fetch: vi.fn(async (_url, init) => new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error(
          'private provider body at 10.0.0.8/internal/image.jpg',
        )), { once: true });
      })),
    });

    const error = await createRemoteImageProvider(deps)(
      { url: 'https://example.com/slow.jpg' },
      new AbortController().signal,
    ).catch((caught: unknown) => caught);

    expect(scheduledDelay).toBe(5_000);
    expect(error).toEqual(new Error('Unable to fetch image.'));
    if (!(error instanceof Error)) throw new Error('Expected an Error.');
    expect(error.message).not.toContain('10.0.0.8');
    expect(error.message).not.toContain('/internal');
  });
});
