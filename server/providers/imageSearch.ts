import type { WebImageSearchResult } from '../../src/services/webImageSearchClient';
import {
  cancelResponse,
  createBoundarySignal,
  defaultProviderBoundaryDependencies,
  type ProviderBoundaryDependencies,
  validatePublicHttpUrl,
} from './network';

const MAX_PROVIDER_BYTES = 1_000_000;
const PROVIDER_TIMEOUT_MS = 5_000;
const PROVIDER_ERROR = 'Unable to search web images.';
const MISSING_KEY_ERROR = 'Set SERPAPI_API_KEY before searching web images.';
const MIN_LONG_EDGE = 1_200;
const MIN_SHORT_EDGE = 700;

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function httpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function dimension(primary: unknown, fallback: unknown): number | undefined {
  const value = primary ?? fallback;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function buildProviderUrl(query: string, apiKey: string): URL {
  const url = new URL('https://serpapi.com/search.json');
  url.searchParams.set('engine', 'google_images_light');
  url.searchParams.set('q', query.trim().replace(/\s+/g, ' '));
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('hl', 'en');
  url.searchParams.set('gl', 'us');
  url.searchParams.set('device', 'desktop');
  url.searchParams.set('imgsz', 'l');
  url.searchParams.set('image_type', 'photo');
  return url;
}

async function readProviderJson(response: Response): Promise<unknown> {
  const contentType = (response.headers.get('content-type') ?? '').split(';', 1)[0]!.trim().toLowerCase();
  if (contentType !== 'application/json' && !/^application\/[a-z0-9.+-]+\+json$/.test(contentType)) {
    await cancelResponse(response);
    throw new Error(PROVIDER_ERROR);
  }
  const declaredLength = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PROVIDER_BYTES) {
    await cancelResponse(response);
    throw new Error(PROVIDER_ERROR);
  }
  if (!response.body) throw new Error(PROVIDER_ERROR);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteCount = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteCount += value.byteLength;
      if (byteCount > MAX_PROVIDER_BYTES) {
        await reader.cancel();
        throw new Error(PROVIDER_ERROR);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(byteCount);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error(PROVIDER_ERROR);
  }
}

function normalizeResults(body: unknown): WebImageSearchResult[] {
  if (!isRecord(body) || typeof body.error === 'string') throw new Error(PROVIDER_ERROR);
  if (body.images_results === undefined) return [];
  if (!Array.isArray(body.images_results)) throw new Error(PROVIDER_ERROR);

  const normalized = body.images_results.flatMap((value, index): WebImageSearchResult[] => {
    if (!isRecord(value)) return [];
    const sourceUrl = httpUrl(value.link);
    const thumbnailUrl = httpUrl(value.thumbnail);
    const imageUrl = httpUrl(value.original);
    if (!sourceUrl || !thumbnailUrl || !imageUrl) return [];
    const sourceName = clean(value.source) || new URL(sourceUrl).hostname.replace(/^www\./i, '');
    if (!sourceName) return [];
    const width = dimension(value.original_width, value.width);
    const height = dimension(value.original_height, value.height);
    const position = typeof value.position === 'number' && Number.isFinite(value.position)
      ? value.position
      : index + 1;
    return [{
      id: `serpapi-${position}`,
      title: clean(value.title) || 'Web image',
      sourceName,
      sourceUrl,
      thumbnailUrl,
      imageUrl,
      ...(width === undefined ? {} : { width }),
      ...(height === undefined ? {} : { height }),
    }];
  });

  return normalized.filter(({ width, height }) => {
    if (width === undefined || height === undefined) return true;
    return Math.max(width, height) >= MIN_LONG_EDGE && Math.min(width, height) >= MIN_SHORT_EDGE;
  });
}

export function createImageSearchProvider(
  dependencies: ProviderBoundaryDependencies = defaultProviderBoundaryDependencies,
): (
  input: { query: string },
  apiKey: string,
  signal: AbortSignal,
) => Promise<WebImageSearchResult[]> {
  return async ({ query }, apiKey, externalSignal) => {
    if (!apiKey.trim()) throw new Error(MISSING_KEY_ERROR);
    if (!query.trim()) return [];
    const boundarySignal = createBoundarySignal(externalSignal, dependencies, PROVIDER_TIMEOUT_MS);
    try {
      const providerUrl = buildProviderUrl(query, apiKey);
      const validated = await validatePublicHttpUrl(providerUrl.toString(), dependencies, {
        invalid: PROVIDER_ERROR,
        protocol: PROVIDER_ERROR,
        nonPublic: PROVIDER_ERROR,
        unresolved: PROVIDER_ERROR,
      }, boundarySignal.signal);
      let response: Response;
      try {
        response = await dependencies.fetch(validated.url, {
          method: 'GET',
          headers: {
            accept: 'application/json',
            'user-agent': 'PlotterImageSearch/1.0',
          },
          redirect: 'manual',
          signal: boundarySignal.signal,
        }, validated.addresses);
      } catch {
        throw new Error(PROVIDER_ERROR);
      }
      if (!response.ok) {
        await cancelResponse(response);
        throw new Error(PROVIDER_ERROR);
      }
      const body = await readProviderJson(response);
      return normalizeResults(body);
    } catch {
      throw new Error(PROVIDER_ERROR);
    } finally {
      boundarySignal.cleanup();
    }
  };
}

export function searchWebImages(
  input: { query: string },
  apiKey: string,
  signal: AbortSignal,
): Promise<WebImageSearchResult[]> {
  return createImageSearchProvider()(input, apiKey, signal);
}
