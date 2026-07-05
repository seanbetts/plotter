import { createBrowserSupabaseClient } from '../storage/supabaseClient';

export type WebImageSearchStopContext = {
  stopName: string;
  regionName?: string;
  countryName?: string;
  countryCode?: string;
};

export type WebImageSearchResult = {
  id: string;
  title: string;
  sourceName: string;
  sourceUrl: string;
  thumbnailUrl: string;
  imageUrl: string;
  width?: number;
  height?: number;
};

export type WebImageSearchClient = {
  searchImages(query: string, context: WebImageSearchStopContext): Promise<WebImageSearchResult[]>;
};

type ImageSearchFunctionData = {
  results?: unknown;
};

type ImageSearchFunctionError = {
  message?: string;
  context?: unknown;
  response?: unknown;
};

type ImageSearchFunctionResponse = {
  data?: ImageSearchFunctionData | null;
  error?: ImageSearchFunctionError | null;
};

type ImageSearchSupabaseClient = {
  functions: {
    invoke(
      functionName: 'image-search',
      options: { body: { query: string; context: WebImageSearchStopContext } },
    ): Promise<ImageSearchFunctionResponse>;
  };
};

const fallbackErrorMessage = 'Unable to search web images.';

function wordsForDeduplication(value: string) {
  return value
    .toLocaleLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter(Boolean);
}

function appendContextPart(parts: string[], seenWords: Set<string>, value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return;

  const words = wordsForDeduplication(trimmed);
  if (words.length > 0 && words.every((word) => seenWords.has(word))) return;

  parts.push(trimmed);
  for (const word of words) {
    seenWords.add(word);
  }
}

export function buildWebImageProviderQuery(query: string, context: WebImageSearchStopContext) {
  const trimmedQuery = query.trim().replace(/\s+/g, ' ');
  const parts = trimmedQuery ? [trimmedQuery] : [];
  const seenWords = new Set(wordsForDeduplication(trimmedQuery));

  appendContextPart(parts, seenWords, context.stopName);
  appendContextPart(parts, seenWords, context.countryName || context.regionName);

  return parts.join(' ');
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;

  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeOneResult(value: unknown): WebImageSearchResult | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
  const title = typeof candidate.title === 'string' ? candidate.title.trim() : '';
  const sourceName = typeof candidate.sourceName === 'string' ? candidate.sourceName.trim() : '';
  const width = typeof candidate.width === 'number' && Number.isFinite(candidate.width)
    ? candidate.width
    : undefined;
  const height = typeof candidate.height === 'number' && Number.isFinite(candidate.height)
    ? candidate.height
    : undefined;

  if (
    !id ||
    !title ||
    !sourceName ||
    !isHttpUrl(candidate.sourceUrl) ||
    !isHttpUrl(candidate.thumbnailUrl) ||
    !isHttpUrl(candidate.imageUrl)
  ) {
    return null;
  }

  return {
    id,
    title,
    sourceName,
    sourceUrl: candidate.sourceUrl,
    thumbnailUrl: candidate.thumbnailUrl,
    imageUrl: candidate.imageUrl,
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
  };
}

export function normalizeWebImageSearchResults(value: unknown): WebImageSearchResult[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((result) => {
    const normalized = normalizeOneResult(result);
    return normalized ? [normalized] : [];
  });
}

function getResponseFromErrorTarget(target: unknown): Response | undefined {
  return target instanceof Response ? target : undefined;
}

async function extractFunctionErrorMessage(error: ImageSearchFunctionError): Promise<string> {
  const response = getResponseFromErrorTarget(error.context) ?? getResponseFromErrorTarget(error.response);

  if (response) {
    try {
      const body = (await response.clone().json()) as { error?: unknown };
      if (typeof body.error === 'string' && body.error.trim()) {
        return body.error;
      }
    } catch {
      // Fall through to the Supabase error message when the body is not readable JSON.
    }
  }

  return error.message || fallbackErrorMessage;
}

export function createSupabaseWebImageSearchClient(supabase: ImageSearchSupabaseClient): WebImageSearchClient {
  return {
    async searchImages(query, context) {
      const response = await supabase.functions.invoke('image-search', {
        body: { query, context },
      });

      if (response.error) {
        throw new Error(await extractFunctionErrorMessage(response.error));
      }

      return normalizeWebImageSearchResults(response.data?.results);
    },
  };
}

export function createLocalWebImageSearchClient(): WebImageSearchClient {
  return {
    async searchImages(query, context) {
      const providerQuery = buildWebImageProviderQuery(query, context);
      const slug = providerQuery.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'image';
      const visibleQuery = query.trim() || 'Image';

      return [
        {
          id: `local-web-image-${slug}`,
          title: `${visibleQuery} in ${context.stopName}`,
          sourceName: 'Local image search',
          sourceUrl: 'https://example.com/local-image-search',
          thumbnailUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="320" height="220"%3E%3Crect width="320" height="220" fill="%239fb4ca"/%3E%3C/svg%3E',
          imageUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000"%3E%3Crect width="1600" height="1000" fill="%239fb4ca"/%3E%3C/svg%3E',
          width: 1600,
          height: 1000,
        },
      ];
    },
  };
}

export function createAppWebImageSearchClient(): WebImageSearchClient {
  if (import.meta.env.VITE_TRIP_STORAGE === 'e2e-local') {
    return createLocalWebImageSearchClient();
  }

  return createSupabaseWebImageSearchClient(createBrowserSupabaseClient());
}
