import { describe, expect, it, vi } from 'vitest';
import { TripStorageConflictError } from '../storage/revision';
import { createPlotterApiClient, PlotterApiError } from './client';

type FetchCall = { input: RequestInfo | URL; init?: RequestInit };

function response(body: unknown, status = 200) {
  return new Response(body === undefined ? undefined : JSON.stringify(body), {
    status,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
  });
}

function fetchReturning(value: Response) {
  const calls: FetchCall[] = [];
  return {
    calls,
    fetcher: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return value;
    }),
  };
}

describe('Plotter API client', () => {
  it.each([
    ['/', '/api/v1/trips'],
    ['/plotter/', '/plotter/api/v1/trips'],
    ['http://127.0.0.1:5175', 'http://127.0.0.1:5175/api/v1/trips'],
  ])('joins the %s base with an API path without dropping segments', async (baseUrl, expectedUrl) => {
    const harness = fetchReturning(response({ trips: [] }));
    const client = createPlotterApiClient({ baseUrl, fetcher: harness.fetcher });

    await expect(client.request<{ trips: unknown[] }>('/api/v1/trips')).resolves.toEqual({ trips: [] });

    expect(String(harness.calls[0]?.input)).toBe(expectedUrl);
  });

  it('sends JSON writes with the service write header and caller abort signal', async () => {
    const harness = fetchReturning(response({ revision: 3 }));
    const controller = new AbortController();
    const client = createPlotterApiClient({ baseUrl: '/plotter/', fetcher: harness.fetcher });

    await client.request('/api/v1/trips', {
      method: 'POST',
      body: JSON.stringify({ expectedRevision: 2, name: 'Alps' }),
      signal: controller.signal,
    });

    const init = harness.calls[0]?.init;
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
    expect(new Headers(init?.headers).get('x-plotter-write')).toBe('1');
    expect(init?.signal).toBe(controller.signal);
  });

  it('returns undefined for successful empty responses', async () => {
    const harness = fetchReturning(new Response(undefined, { status: 204 }));
    const client = createPlotterApiClient({ fetcher: harness.fetcher });

    await expect(client.request<void>('/api/v1/trips/trip-1', { method: 'DELETE' })).resolves.toBeUndefined();
  });

  it('uploads multipart bytes with the expected revision without forcing a content type', async () => {
    const harness = fetchReturning(response({ revision: 5 }));
    const form = new FormData();
    form.set('file', new File(['image'], 'alps.png', { type: 'image/png' }));
    const client = createPlotterApiClient({ fetcher: harness.fetcher });

    await client.upload('/api/v1/trips/trip-1/destinations/stop-1/media', form, 4);

    const init = harness.calls[0]?.init;
    expect(init?.body).toBe(form);
    expect(new Headers(init?.headers).get('content-type')).toBeNull();
    expect(new Headers(init?.headers).get('x-plotter-write')).toBe('1');
    expect(form.get('expectedRevision')).toBe('4');
  });

  it('exposes safe structured service errors', async () => {
    const harness = fetchReturning(response({
      status: 503,
      error: { code: 'storage-unavailable', message: 'Plotter storage is unavailable.' },
    }, 503));
    const client = createPlotterApiClient({ fetcher: harness.fetcher });

    await expect(client.request('/api/v1/trips')).rejects.toMatchObject({
      name: 'PlotterApiError',
      status: 503,
      code: 'storage-unavailable',
      message: 'Plotter storage is unavailable.',
    } satisfies Partial<PlotterApiError>);
  });

  it('maps a structured conflict to the repository conflict error', async () => {
    const harness = fetchReturning(response({
      status: 409,
      error: { code: 'conflict', message: 'Another device changed this data.', currentRevision: 8 },
    }, 409));
    const client = createPlotterApiClient({ fetcher: harness.fetcher });

    let caught: unknown;
    try {
      await client.request('/api/v1/trips');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TripStorageConflictError);
    expect(caught).toMatchObject({ name: 'TripStorageConflictError', currentRevision: 8 });
  });

  it.each([
    [500, 'not-found'],
    [409, 'storage-unavailable'],
  ] as const)('redacts the malformed %i/%s status-code pair', async (status, code) => {
    const harness = fetchReturning(response({
      status,
      error: { code, message: '/private/plotter.sqlite3' },
    }, status));
    const client = createPlotterApiClient({ fetcher: harness.fetcher });

    await expect(client.request('/api/v1/trips')).rejects.toMatchObject({
      name: 'PlotterApiError',
      message: 'Plotter service request failed.',
    });
  });

  it('redacts malformed and unstructured failures', async () => {
    const malformed = fetchReturning(response({ error: { message: '/private/plotter.sqlite3' } }, 500));
    const client = createPlotterApiClient({ fetcher: malformed.fetcher });

    await expect(client.request('/api/v1/trips')).rejects.toMatchObject({
      name: 'PlotterApiError',
      message: 'Plotter service request failed.',
    });
  });

  it('preserves an abort raised while parsing a response body', async () => {
    const aborted = new DOMException('The operation was aborted.', 'AbortError');
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.error(aborted); },
    });
    const harness = fetchReturning(new Response(body, { headers: { 'content-type': 'application/json' } }));
    const client = createPlotterApiClient({ fetcher: harness.fetcher });

    await expect(client.request('/api/v1/trips')).rejects.toBe(aborted);
  });
});
