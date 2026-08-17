import { TripStorageConflictError } from '../storage/revision';
import type { ApiErrorCode } from './contracts';

const REDACTED_ERROR_MESSAGE = 'Plotter service request failed.';

export type PlotterApiClient = {
  request<T>(path: string, init?: RequestInit): Promise<T>;
  upload<T>(path: string, form: FormData, expectedRevision: number): Promise<T>;
};

export type PlotterApiClientOptions = {
  baseUrl?: string;
  fetcher?: typeof fetch;
};

export class PlotterApiError extends Error {
  public readonly status?: number;
  public readonly code?: Exclude<ApiErrorCode, 'conflict'>;

  constructor(message = REDACTED_ERROR_MESSAGE, details: {
    status?: number;
    code?: Exclude<ApiErrorCode, 'conflict'>;
  } = {}) {
    super(message);
    this.name = 'PlotterApiError';
    this.status = details.status;
    this.code = details.code;
  }
}

function joinServiceUrl(baseUrl: string, path: string): string {
  const relativePath = path.replace(/^\/+/, '');
  if (!relativePath) throw new PlotterApiError();

  try {
    const absolute = new URL(baseUrl);
    if (absolute.search || absolute.hash) throw new Error('unsafe base');
    absolute.pathname = `${absolute.pathname.replace(/\/+$/, '')}/${relativePath}`.replace(/^([^/])/, '/$1');
    return absolute.toString();
  } catch {
    if (!baseUrl.startsWith('/')) throw new PlotterApiError();
    const basePath = baseUrl === '/' ? '' : baseUrl.replace(/\/+$/, '');
    return `${basePath}/${relativePath}`;
  }
}

function hasFormDataBody(body: BodyInit | null | undefined): boolean {
  return typeof FormData !== 'undefined' && body instanceof FormData;
}

function isWrite(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD';
}

function requestHeaders(init: RequestInit): Headers {
  const headers = new Headers(init.headers);
  const method = (init.method ?? 'GET').toUpperCase();
  if (isWrite(method)) headers.set('x-plotter-write', '1');
  if (init.body !== undefined && init.body !== null && !hasFormDataBody(init.body) && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  return headers;
}

function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return value === 'invalid-request'
    || value === 'not-found'
    || value === 'conflict'
    || value === 'storage-unavailable'
    || value === 'internal-error';
}

function structuredError(value: unknown, status: number): {
  code: ApiErrorCode;
  message: string;
  currentRevision?: number;
} | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const body = value as Record<string, unknown>;
  if (body.status !== status || !body.error || typeof body.error !== 'object' || Array.isArray(body.error)) return undefined;
  const error = body.error as Record<string, unknown>;
  if (!isApiErrorCode(error.code) || typeof error.message !== 'string' || !error.message.trim()) return undefined;
  if (error.code === 'conflict') {
    if (!Number.isSafeInteger(error.currentRevision) || (error.currentRevision as number) < 0) return undefined;
    return { code: error.code, message: error.message, currentRevision: error.currentRevision as number };
  }
  if ('currentRevision' in error) return undefined;
  return { code: error.code, message: error.message };
}

function isAbortError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'name' in error && error.name === 'AbortError');
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new PlotterApiError();
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await readJson(response);
    const error = structuredError(body, response.status);
    if (!error) throw new PlotterApiError();
    if (error.code === 'conflict') throw new TripStorageConflictError(error.currentRevision!);
    throw new PlotterApiError(error.message, { status: response.status, code: error.code });
  }
  if (response.status === 204 || response.headers.get('content-length') === '0') return undefined as T;
  return await readJson(response) as T;
}

export function createPlotterApiClient(options: PlotterApiClientOptions = {}): PlotterApiClient {
  const baseUrl = options.baseUrl ?? '/';
  const fetcher = options.fetcher ?? globalThis.fetch;
  if (typeof fetcher !== 'function') throw new PlotterApiError();

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetcher(joinServiceUrl(baseUrl, path), {
        ...init,
        headers: requestHeaders(init),
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw new PlotterApiError();
    }
    return parseResponse<T>(response);
  }

  return {
    request,
    upload<T>(path: string, form: FormData, expectedRevision: number) {
      form.set('expectedRevision', String(expectedRevision));
      return request<T>(path, { method: 'POST', body: form });
    },
  };
}
