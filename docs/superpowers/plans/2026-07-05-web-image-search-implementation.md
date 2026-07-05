# Web Image Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add stop-panel web image search with a contextual search bar, image-grid popover, large-result filtering, and immediate import into existing stop media.

**Architecture:** Keep UI, provider search, and media import separate. Browser components use a source-agnostic `WebImageSearchClient`; Supabase Edge Functions own SerpApi calls and remote image fetching; `TripRepository` remains the only app-facing media mutation surface.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Testing Library, Playwright, Supabase Edge Functions, Supabase Storage, SerpApi Google Images API.

---

## File Structure

- Create `src/services/webImageSearchClient.ts`: app-facing image search types, stop-context query expansion, local fake client, Supabase function client.
- Create `src/services/webImageSearchClient.test.ts`: unit tests for query expansion, function response normalization, and local/e2e fallback.
- Modify `src/storage/tripRepository.ts`: add `importDestinationMediaFromSearch`.
- Modify `src/storage/supabaseTripRepository.ts`: invoke `import-image`, convert returned media row to signed `MediaItem`, share import types.
- Modify `src/storage/tripRepository.test.ts`: prove local repository appends imported images.
- Modify `src/storage/supabaseTripRepository.test.ts`: prove Supabase repository invokes import and returns signed URLs.
- Create `supabase/functions/image-search/metadata.ts`: SerpApi request construction, result normalization, quality filtering.
- Create `supabase/functions/image-search/index.ts`: Edge Function HTTP entrypoint.
- Create `supabase/functions/image-search/metadata.test.ts`: Deno unit tests.
- Create `supabase/functions/import-image/metadata.ts`: public URL safety, image fetch validation, object path creation, import payload normalization.
- Create `supabase/functions/import-image/index.ts`: Edge Function HTTP entrypoint that uploads and inserts destination-owned `media_assets`.
- Create `supabase/functions/import-image/metadata.test.ts`: Deno unit tests.
- Create `src/components/WebImageSearchField.tsx`: search input and image-grid popover.
- Create `src/components/WebImageSearchField.test.tsx`: component tests for popover, stale responses, import behavior, and errors.
- Modify `src/components/DestinationImageStrip.tsx`: render web image search above the hero preview.
- Modify `src/components/DestinationProfile.tsx`: pass stop context and import handlers into the image strip.
- Modify `src/App.tsx`: create `webImageSearchClient`, handle import, reload rollup.
- Modify `src/App.test.tsx`: integration coverage for contextual search/import.
- Modify `src/styles.css` and `src/styles.test.ts`: popover grid styling and fixed image tile dimensions.
- Modify `.env.example`: document `SERPAPI_API_KEY`.
- Modify `tests/world-tour.spec.ts`: e2e-local smoke test with mocked image search/import.

---

### Task 1: Web Image Search Client And Query Shaping

**Files:**
- Create: `src/services/webImageSearchClient.ts`
- Create: `src/services/webImageSearchClient.test.ts`
- Modify: `.env.example`

- [x] **Step 1: Write failing tests for query expansion and client behavior**

Create `src/services/webImageSearchClient.test.ts`:

```ts
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
```

- [x] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- src/services/webImageSearchClient.test.ts
```

Expected: FAIL because `src/services/webImageSearchClient.ts` does not exist.

- [x] **Step 3: Implement the client module**

Create `src/services/webImageSearchClient.ts`:

```ts
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

async function extractFunctionErrorMessage(error: ImageSearchFunctionError) {
  const response = error.context instanceof Response
    ? error.context
    : error.response instanceof Response
      ? error.response
      : undefined;

  if (response) {
    try {
      const body = (await response.clone().json()) as { error?: unknown };
      if (typeof body.error === 'string' && body.error.trim()) {
        return body.error;
      }
    } catch {
      return error.message || fallbackErrorMessage;
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

      return [
        {
          id: `local-web-image-${slug}`,
          title: `${query.trim() || 'Image'} in ${context.stopName}`,
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
```

- [x] **Step 4: Add environment documentation**

Modify `.env.example`:

```text
VITE_MAPTILER_API_KEY=
VITE_OPENROUTESERVICE_API_KEY=
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
VITE_TRIP_STORAGE=supabase
SERPAPI_API_KEY=
```

- [x] **Step 5: Run tests to verify they pass**

Run:

```bash
npm test -- src/services/webImageSearchClient.test.ts
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add .env.example src/services/webImageSearchClient.ts src/services/webImageSearchClient.test.ts
git commit -m "Add web image search client"
```

---

### Task 2: Image Search Edge Function

**Files:**
- Create: `supabase/functions/image-search/metadata.ts`
- Create: `supabase/functions/image-search/index.ts`
- Create: `supabase/functions/image-search/metadata.test.ts`

- [x] **Step 1: Write failing Deno tests for provider query and result filtering**

Create `supabase/functions/image-search/metadata.test.ts`:

```ts
// deno-lint-ignore-file no-import-prefix
import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildSerpApiImageSearchUrl,
  filterQualityImageResults,
  mapSerpApiImageResults,
  searchWebImages,
} from "./metadata.ts";

Deno.test("builds a SerpApi URL with contextual query and large photo filters", () => {
  const url = buildSerpApiImageSearchUrl({
    apiKey: "secret",
    query: "street art",
    context: {
      stopName: "Paris",
      countryName: "France",
      countryCode: "FR",
    },
  });

  assertEquals(url.origin, "https://serpapi.com");
  assertEquals(url.pathname, "/search.json");
  assertEquals(url.searchParams.get("engine"), "google_images");
  assertEquals(url.searchParams.get("q"), "street art Paris France");
  assertEquals(url.searchParams.get("api_key"), "secret");
  assertEquals(url.searchParams.get("hl"), "en");
  assertEquals(url.searchParams.get("gl"), "fr");
  assertEquals(url.searchParams.get("tbs"), "itp:photos,isz:l");
});

Deno.test("maps SerpApi image results and keeps source metadata", () => {
  assertEquals(
    mapSerpApiImageResults({
      images_results: [
        {
          position: 1,
          title: "Paris mural",
          source: "Example",
          link: "https://example.com/page",
          thumbnail: "https://example.com/thumb.jpg",
          original: "https://example.com/original.jpg",
          original_width: 1800,
          original_height: 1200,
        },
      ],
    }),
    [
      {
        id: "serpapi-1",
        title: "Paris mural",
        sourceName: "Example",
        sourceUrl: "https://example.com/page",
        thumbnailUrl: "https://example.com/thumb.jpg",
        imageUrl: "https://example.com/original.jpg",
        width: 1800,
        height: 1200,
      },
    ],
  );
});

Deno.test("filters known low-resolution images but keeps credible unknown dimensions", () => {
  const results = filterQualityImageResults([
    {
      id: "small",
      title: "Small",
      sourceName: "Example",
      sourceUrl: "https://example.com/small",
      thumbnailUrl: "https://example.com/small-thumb.jpg",
      imageUrl: "https://example.com/small.jpg",
      width: 640,
      height: 480,
    },
    {
      id: "large",
      title: "Large",
      sourceName: "Example",
      sourceUrl: "https://example.com/large",
      thumbnailUrl: "https://example.com/large-thumb.jpg",
      imageUrl: "https://example.com/large.jpg",
      width: 1800,
      height: 1200,
    },
    {
      id: "unknown",
      title: "Unknown",
      sourceName: "Example",
      sourceUrl: "https://example.com/unknown",
      thumbnailUrl: "https://example.com/unknown-thumb.jpg",
      imageUrl: "https://example.com/unknown.jpg",
    },
  ]);

  assertEquals(results.map((result) => result.id), ["large", "unknown"]);
});

Deno.test("searchWebImages rejects missing SerpApi keys", async () => {
  await assertRejects(
    () =>
      searchWebImages({
        apiKey: "",
        query: "mural",
        context: { stopName: "Paris", countryName: "France" },
        fetcher: fetch,
      }),
    Error,
    "SERPAPI_API_KEY",
  );
});
```

- [x] **Step 2: Run tests to verify they fail**

Run:

```bash
deno test --allow-env --allow-net=serpapi.com supabase/functions/image-search/metadata.test.ts
```

Expected: FAIL because `metadata.ts` does not exist.

- [x] **Step 3: Implement SerpApi metadata helpers**

Create `supabase/functions/image-search/metadata.ts`:

```ts
export type ImageSearchStopContext = {
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

type SerpApiImageResult = {
  position?: number;
  title?: string;
  source?: string;
  link?: string;
  thumbnail?: string;
  original?: string;
  original_width?: number;
  original_height?: number;
  width?: number;
  height?: number;
};

type SerpApiResponse = {
  images_results?: SerpApiImageResult[];
  error?: string;
};

type SearchWebImagesInput = {
  apiKey: string;
  query: string;
  context: ImageSearchStopContext;
  fetcher?: typeof fetch;
};

const largePhotoFilter = "itp:photos,isz:l";
const minLongEdge = 1200;
const minShortEdge = 700;

function clean(value: string | undefined) {
  return value?.trim().replace(/\s+/g, " ") ?? "";
}

function contextWords(value: string) {
  return value.toLocaleLowerCase().split(/[^a-z0-9]+/i).filter(Boolean);
}

function appendContextPart(parts: string[], seenWords: Set<string>, value: string | undefined) {
  const trimmed = clean(value);
  if (!trimmed) return;
  const words = contextWords(trimmed);
  if (words.length > 0 && words.every((word) => seenWords.has(word))) return;
  parts.push(trimmed);
  for (const word of words) seenWords.add(word);
}

export function buildProviderQuery(query: string, context: ImageSearchStopContext) {
  const visibleQuery = clean(query);
  const parts = visibleQuery ? [visibleQuery] : [];
  const seenWords = new Set(contextWords(visibleQuery));
  appendContextPart(parts, seenWords, context.stopName);
  appendContextPart(parts, seenWords, context.countryName || context.regionName);
  return parts.join(" ");
}

function normalizedCountryCode(context: ImageSearchStopContext) {
  const countryCode = clean(context.countryCode).toLocaleLowerCase();
  return /^[a-z]{2}$/.test(countryCode) ? countryCode : "us";
}

export function buildSerpApiImageSearchUrl(input: {
  apiKey: string;
  query: string;
  context: ImageSearchStopContext;
}) {
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google_images");
  url.searchParams.set("q", buildProviderQuery(input.query, input.context));
  url.searchParams.set("api_key", input.apiKey);
  url.searchParams.set("hl", "en");
  url.searchParams.set("gl", normalizedCountryCode(input.context));
  url.searchParams.set("device", "desktop");
  url.searchParams.set("tbs", largePhotoFilter);
  const location = [input.context.stopName, input.context.countryName || input.context.regionName]
    .map(clean)
    .filter(Boolean)
    .join(", ");
  if (location) {
    url.searchParams.set("location", location);
  }
  return url;
}

function isHttpUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function dimension(primary: number | undefined, fallback: number | undefined) {
  const value = primary ?? fallback;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

export function mapSerpApiImageResults(response: SerpApiResponse): WebImageSearchResult[] {
  return (response.images_results ?? []).flatMap((result, index) => {
    const title = clean(result.title) || "Web image";
    const sourceName = clean(result.source) || (isHttpUrl(result.link) ? new URL(result.link).hostname.replace(/^www\./, "") : "");
    const sourceUrl = result.link;
    const thumbnailUrl = result.thumbnail;
    const imageUrl = result.original;
    if (!sourceName || !isHttpUrl(sourceUrl) || !isHttpUrl(thumbnailUrl) || !isHttpUrl(imageUrl)) return [];
    const width = dimension(result.original_width, result.width);
    const height = dimension(result.original_height, result.height);
    return [{
      id: `serpapi-${result.position ?? index + 1}`,
      title,
      sourceName,
      sourceUrl,
      thumbnailUrl,
      imageUrl,
      ...(width !== undefined ? { width } : {}),
      ...(height !== undefined ? { height } : {}),
    }];
  });
}

export function filterQualityImageResults(results: WebImageSearchResult[]) {
  return results.filter((result) => {
    if (result.width === undefined || result.height === undefined) return true;
    const longEdge = Math.max(result.width, result.height);
    const shortEdge = Math.min(result.width, result.height);
    return longEdge >= minLongEdge && shortEdge >= minShortEdge;
  });
}

export async function searchWebImages({
  apiKey,
  query,
  context,
  fetcher = fetch,
}: SearchWebImagesInput) {
  if (!apiKey.trim()) {
    throw new Error("Set SERPAPI_API_KEY before searching web images.");
  }
  if (!query.trim()) {
    return [];
  }

  const response = await fetcher(buildSerpApiImageSearchUrl({ apiKey, query, context }));
  if (!response.ok) {
    throw new Error("Unable to search web images.");
  }

  const body = await response.json() as SerpApiResponse;
  if (body.error) {
    throw new Error(body.error);
  }

  return filterQualityImageResults(mapSerpApiImageResults(body));
}
```

- [x] **Step 4: Implement the Edge Function entrypoint**

Create `supabase/functions/image-search/index.ts`:

```ts
import { searchWebImages } from "./metadata.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed." }, { status: 405, headers: corsHeaders });
  }

  try {
    const body = await request.json();
    const query = typeof body.query === "string" ? body.query : "";
    const context = body.context && typeof body.context === "object"
      ? body.context
      : {};
    const results = await searchWebImages({
      apiKey: Deno.env.get("SERPAPI_API_KEY") ?? "",
      query,
      context: {
        stopName: typeof context.stopName === "string" ? context.stopName : "",
        regionName: typeof context.regionName === "string" ? context.regionName : undefined,
        countryName: typeof context.countryName === "string" ? context.countryName : undefined,
        countryCode: typeof context.countryCode === "string" ? context.countryCode : undefined,
      },
    });

    return Response.json({ results }, { headers: corsHeaders });
  } catch (caught) {
    return Response.json(
      { error: caught instanceof Error ? caught.message : "Unable to search web images." },
      { status: 400, headers: corsHeaders },
    );
  }
});
```

- [x] **Step 5: Run Deno tests**

Run:

```bash
deno test --allow-env --allow-net=serpapi.com supabase/functions/image-search/metadata.test.ts
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add supabase/functions/image-search
git commit -m "Add image search edge function"
```

---

### Task 3: Import Image Edge Function

**Files:**
- Create: `supabase/functions/import-image/metadata.ts`
- Create: `supabase/functions/import-image/index.ts`
- Create: `supabase/functions/import-image/metadata.test.ts`

- [x] **Step 1: Write failing Deno tests for URL safety, image validation, and object paths**

Create `supabase/functions/import-image/metadata.test.ts`:

```ts
// deno-lint-ignore-file no-import-prefix
import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createImportedImageObjectPath,
  fetchImportImage,
  normalizeImportResult,
  validatePublicImageUrl,
} from "./metadata.ts";

const publicResolver = () => Promise.resolve(["93.184.216.34"]);

Deno.test("rejects unsupported and private import image URLs", async () => {
  await assertRejects(
    () => validatePublicImageUrl("ftp://example.com/image.jpg", publicResolver),
    Error,
    "http or https",
  );
  await assertRejects(
    () => validatePublicImageUrl("http://127.0.0.1/image.jpg", publicResolver),
    Error,
    "public image URL",
  );
});

Deno.test("normalizes selected result metadata", () => {
  assertEquals(
    normalizeImportResult({
      id: "result-1",
      title: " Paris mural ",
      sourceName: " Example Source ",
      sourceUrl: "https://example.com/page",
      thumbnailUrl: "https://example.com/thumb.jpg",
      imageUrl: "https://example.com/image.jpg",
    }),
    {
      id: "result-1",
      title: "Paris mural",
      sourceName: "Example Source",
      sourceUrl: "https://example.com/page",
      thumbnailUrl: "https://example.com/thumb.jpg",
      imageUrl: "https://example.com/image.jpg",
    },
  );
});

Deno.test("creates trip and destination scoped object paths", () => {
  const path = createImportedImageObjectPath({
    tripId: "11111111-1111-4111-8111-111111111111",
    destinationId: "22222222-2222-4222-8222-222222222222",
    title: "Paris mural / old town",
    contentType: "image/jpeg",
    uuid: () => "33333333-3333-4333-8333-333333333333",
  });

  assertEquals(
    path,
    "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333-paris-mural-old-town.jpg",
  );
});

Deno.test("fetchImportImage rejects non-image responses", async () => {
  await assertRejects(
    () =>
      fetchImportImage({
        imageUrl: "https://example.com/data.json",
        fetcher: () =>
          Promise.resolve(new Response("{}", {
            headers: { "content-type": "application/json" },
          })),
        resolver: publicResolver,
      }),
    Error,
    "image",
  );
});

Deno.test("fetchImportImage returns image bytes and content type", async () => {
  const imported = await fetchImportImage({
    imageUrl: "https://example.com/image.jpg",
    fetcher: () =>
      Promise.resolve(new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "image/jpeg" },
      })),
    resolver: publicResolver,
  });

  assertEquals(imported.contentType, "image/jpeg");
  assertEquals(imported.bytes.byteLength, 3);
});
```

- [x] **Step 2: Run tests to verify they fail**

Run:

```bash
deno test --allow-env --allow-net supabase/functions/import-image/metadata.test.ts
```

Expected: FAIL because `metadata.ts` does not exist.

- [x] **Step 3: Implement import helpers**

Create `supabase/functions/import-image/metadata.ts`:

```ts
type Resolver = (hostname: string) => string[] | Promise<string[]>;

export type ImportImageResult = {
  id: string;
  title: string;
  sourceName: string;
  sourceUrl: string;
  thumbnailUrl: string;
  imageUrl: string;
  width?: number;
  height?: number;
};

type FetchImportImageInput = {
  imageUrl: string;
  fetcher?: typeof fetch;
  resolver?: Resolver;
};

const allowedProtocols = new Set(["http:", "https:"]);
const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const maxImageBytes = 50 * 1024 * 1024;
const userAgent = "WorldTourImageImport/1.0";

export function normalizeImportResult(value: unknown): ImportImageResult {
  if (!value || typeof value !== "object") {
    throw new Error("Choose a valid image result.");
  }

  const candidate = value as Record<string, unknown>;
  const result = {
    id: stringField(candidate.id),
    title: stringField(candidate.title),
    sourceName: stringField(candidate.sourceName),
    sourceUrl: stringField(candidate.sourceUrl),
    thumbnailUrl: stringField(candidate.thumbnailUrl),
    imageUrl: stringField(candidate.imageUrl),
    ...(typeof candidate.width === "number" ? { width: candidate.width } : {}),
    ...(typeof candidate.height === "number" ? { height: candidate.height } : {}),
  };

  if (
    !result.id ||
    !result.title ||
    !result.sourceName ||
    !isHttpUrl(result.sourceUrl) ||
    !isHttpUrl(result.thumbnailUrl) ||
    !isHttpUrl(result.imageUrl)
  ) {
    throw new Error("Choose a valid image result.");
  }

  return result;
}

function stringField(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isHttpUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export async function validatePublicImageUrl(rawUrl: string, resolver: Resolver = resolveHostname) {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Enter a valid image URL.");
  }

  if (!allowedProtocols.has(parsed.protocol)) {
    throw new Error("Image URLs must use http or https.");
  }

  if (isLocalOrPrivateHost(parsed.hostname)) {
    throw new Error("Enter a public image URL.");
  }

  if (shouldResolveHostname(parsed.hostname)) {
    const addresses = await resolver(parsed.hostname);
    if (addresses.length === 0 || addresses.some(isLocalOrPrivateHost)) {
      throw new Error("Enter a public image URL.");
    }
  }

  return parsed.toString();
}

export async function fetchImportImage({
  imageUrl,
  fetcher = fetch,
  resolver = resolveHostname,
}: FetchImportImageInput) {
  const safeUrl = await validatePublicImageUrl(imageUrl, resolver);
  const response = await fetcher(safeUrl, {
    headers: {
      accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,*/*;q=0.8",
      "User-Agent": userAgent,
    },
  });

  if (!response.ok) {
    throw new Error("Unable to fetch image.");
  }

  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() ?? "";
  if (!allowedImageTypes.has(contentType)) {
    throw new Error("Selected result did not return a supported image.");
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0) {
    throw new Error("Selected image was empty.");
  }
  if (bytes.byteLength > maxImageBytes) {
    throw new Error("Selected image is too large.");
  }

  return { bytes, contentType };
}

export function createImportedImageObjectPath(input: {
  tripId: string;
  destinationId: string;
  title: string;
  contentType: string;
  uuid?: () => string;
}) {
  const uuid = input.uuid ?? crypto.randomUUID;
  const extension = extensionForContentType(input.contentType);
  const slug = input.title
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "web-image";

  return `${input.tripId}/${input.destinationId}/${uuid()}-${slug}.${extension}`;
}

function extensionForContentType(contentType: string) {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  if (contentType === "image/gif") return "gif";
  return "jpg";
}

async function resolveHostname(hostname: string) {
  const lookups = await Promise.allSettled([
    Deno.resolveDns(hostname, "A"),
    Deno.resolveDns(hostname, "AAAA"),
  ]);

  return lookups.flatMap((result) => result.status === "fulfilled" ? result.value : []);
}

function shouldResolveHostname(hostname: string) {
  const unbracketed = hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  return !isIpv4Literal(unbracketed) && !unbracketed.includes(":");
}

function isLocalOrPrivateHost(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  const unbracketed = normalized.replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized.endsWith(".localhost")) return true;
  return isPrivateIpv4(unbracketed) || isPrivateIpv6(unbracketed);
}

function isIpv4Literal(hostname: string) {
  return parseIpv4Octets(hostname) !== undefined;
}

function parseIpv4Octets(hostname: string) {
  const parts = hostname.split(".");
  if (parts.length !== 4) return undefined;
  const octets = parts.map((part) => /^\d+$/.test(part) ? Number(part) : Number.NaN);
  return octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255) ? octets : undefined;
}

function isPrivateIpv4(hostname: string) {
  const octets = parseIpv4Octets(hostname);
  if (!octets) return false;
  const [first = 0, second = 0] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 169 && second === 254) ||
    (first === 192 && second === 0 && octets[2] === 0) ||
    (first === 192 && second === 0 && octets[2] === 2) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && octets[2] === 100) ||
    (first === 203 && second === 0 && octets[2] === 113) ||
    first >= 224
  );
}

function isPrivateIpv6(hostname: string) {
  return hostname.includes(":") && (
    hostname === "::" ||
    hostname === "::1" ||
    hostname.toLocaleLowerCase().startsWith("fc") ||
    hostname.toLocaleLowerCase().startsWith("fd") ||
    hostname.toLocaleLowerCase().startsWith("fe80")
  );
}
```

- [x] **Step 4: Implement import Edge Function entrypoint**

Create `supabase/functions/import-image/index.ts`:

```ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.108.2";
import {
  createImportedImageObjectPath,
  fetchImportImage,
  normalizeImportResult,
} from "./metadata.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed." }, { status: 405, headers: corsHeaders });
  }

  try {
    const authorization = request.headers.get("authorization") ?? "";
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { authorization } },
    });
    const userResponse = await supabase.auth.getUser();
    const user = userResponse.data.user;
    if (userResponse.error || !user) {
      throw new Error(userResponse.error?.message || "Sign in before importing images.");
    }

    const body = await request.json();
    const tripId = typeof body.tripId === "string" ? body.tripId : "";
    const destinationId = typeof body.destinationId === "string" ? body.destinationId : "";
    const result = normalizeImportResult(body.result);
    if (!tripId || !destinationId) {
      throw new Error("Select a stop before importing images.");
    }

    const { bytes, contentType } = await fetchImportImage({ imageUrl: result.imageUrl });
    const bucketId = "trip-media";
    const objectPath = createImportedImageObjectPath({
      tripId,
      destinationId,
      title: result.title,
      contentType,
    });

    const uploadResponse = await supabase.storage.from(bucketId).upload(objectPath, bytes, {
      contentType,
      upsert: false,
    });
    if (uploadResponse.error) {
      throw new Error(uploadResponse.error.message || "Unable to upload imported image.");
    }

    const existingRows = await supabase
      .from("media_assets")
      .select("sort_order")
      .eq("trip_id", tripId)
      .eq("destination_id", destinationId)
      .is("activity_id", null);
    if (existingRows.error) {
      await supabase.storage.from(bucketId).remove([objectPath]);
      throw new Error(existingRows.error.message || "Unable to load media order.");
    }

    const sortOrder = (existingRows.data ?? []).reduce(
      (maxOrder: number, row: { sort_order: number }) => Math.max(maxOrder, row.sort_order),
      -1,
    ) + 1;
    const inserted = await supabase
      .from("media_assets")
      .insert({
        trip_id: tripId,
        destination_id: destinationId,
        activity_id: null,
        bucket_id: bucketId,
        object_path: objectPath,
        caption: result.title,
        credit: result.sourceName,
        sort_order: sortOrder,
        content_type: contentType,
        size_bytes: bytes.byteLength,
        uploaded_by: user.id,
      })
      .select("*")
      .single();
    if (inserted.error || !inserted.data) {
      await supabase.storage.from(bucketId).remove([objectPath]);
      throw new Error(inserted.error?.message || "Unable to save imported image.");
    }

    return Response.json({ mediaAsset: inserted.data }, { headers: corsHeaders });
  } catch (caught) {
    return Response.json(
      { error: caught instanceof Error ? caught.message : "Unable to import image." },
      { status: 400, headers: corsHeaders },
    );
  }
});
```

- [x] **Step 5: Run Deno tests**

Run:

```bash
deno test --allow-env --allow-net supabase/functions/import-image/metadata.test.ts
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add supabase/functions/import-image
git commit -m "Add web image import function"
```

---

### Task 4: Trip Repository Import Surface

**Files:**
- Modify: `src/storage/tripRepository.ts`
- Modify: `src/storage/supabaseTripRepository.ts`
- Modify: `src/storage/tripRepository.test.ts`
- Modify: `src/storage/supabaseTripRepository.test.ts`

- [x] **Step 1: Write failing local repository test**

Add this test to `src/storage/tripRepository.test.ts` near existing media tests:

```ts
it('imports destination media from a web image result in local storage', async () => {
  const db = createTripDb(`test-trip-${crypto.randomUUID()}`);
  const repository = createTripRepository(db);
  const destination = createDestination({
    id: 'destination-1',
    name: 'Paris',
    media: [],
  });
  await db.destinations.put(destination);

  const mediaItem = await repository.importDestinationMediaFromSearch({
    destinationId: destination.id,
    result: {
      id: 'web-1',
      title: 'Paris mural',
      sourceName: 'Example Source',
      sourceUrl: 'https://example.com/page',
      thumbnailUrl: 'https://example.com/thumb.jpg',
      imageUrl: 'https://example.com/image.jpg',
      width: 1600,
      height: 1000,
    },
  });

  expect(mediaItem).toEqual(expect.objectContaining({
    caption: 'Paris mural',
    credit: 'Example Source',
    sortOrder: 0,
    contentType: 'image/jpeg',
  }));
  await expect(repository.listDestinationMedia(destination.id)).resolves.toEqual([
    expect.objectContaining({ id: mediaItem.id }),
  ]);

  await db.delete();
});
```

- [x] **Step 2: Write failing Supabase repository test**

Add this test to `src/storage/supabaseTripRepository.test.ts` near destination media tests:

```ts
it('imports destination media from web search through the import-image function', async () => {
  const tripId = crypto.randomUUID();
  const destinationId = crypto.randomUUID();
  const row = {
    id: crypto.randomUUID(),
    trip_id: tripId,
    destination_id: destinationId,
    activity_id: null,
    bucket_id: 'trip-media',
    object_path: `${tripId}/${destinationId}/imported.jpg`,
    caption: 'Paris mural',
    credit: 'Example Source',
    sort_order: 2,
    content_type: 'image/jpeg',
    size_bytes: 2048,
    uploaded_by: crypto.randomUUID(),
    created_at: '2026-07-05T10:00:00.000Z',
    updated_at: '2026-07-05T10:00:00.000Z',
  };
  const invoke = vi.fn(async () => ({ data: { mediaAsset: row }, error: null }));
  const createSignedUrl = vi.fn(async (_path: string, _expiresIn: number, options?: { transform?: { width: number } }) => ({
    data: { signedUrl: `https://signed.example/imported-${options?.transform?.width ?? 'original'}.jpg` },
    error: null,
  }));
  const supabase = {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: crypto.randomUUID() } },
        error: null,
      })),
    },
    functions: { invoke },
    storage: {
      from: vi.fn(() => ({ createSignedUrl })),
    },
    from: vi.fn((tableName: string) => {
      if (tableName === 'trips') {
        return createTripsTableMock([
          { id: tripId, owner_user_id: crypto.randomUUID(), name: 'World tour' },
        ]);
      }
      throw new Error(`Unexpected table ${tableName}`);
    }),
  };
  const repository = createSupabaseTripRepository(supabase as never);
  const result = {
    id: 'web-1',
    title: 'Paris mural',
    sourceName: 'Example Source',
    sourceUrl: 'https://example.com/page',
    thumbnailUrl: 'https://example.com/thumb.jpg',
    imageUrl: 'https://example.com/image.jpg',
  };

  await expect(repository.importDestinationMediaFromSearch({ destinationId, result })).resolves.toEqual(
    expect.objectContaining({
      id: row.id,
      caption: 'Paris mural',
      credit: 'Example Source',
      thumbnailUrl: 'https://signed.example/imported-320.jpg',
      previewUrl: 'https://signed.example/imported-900.jpg',
      fullUrl: 'https://signed.example/imported-2200.jpg',
    }),
  );
  expect(invoke).toHaveBeenCalledWith('import-image', {
    body: { tripId, destinationId, result },
  });
});
```

- [x] **Step 3: Run tests to verify they fail**

Run:

```bash
npm test -- src/storage/tripRepository.test.ts src/storage/supabaseTripRepository.test.ts
```

Expected: FAIL because `importDestinationMediaFromSearch` is not defined.

- [x] **Step 4: Extend repository types**

Modify `src/storage/tripRepository.ts` imports:

```ts
import type { WebImageSearchResult } from '../services/webImageSearchClient';
```

Add to `TripRepository` after `uploadDestinationMedia`:

```ts
  importDestinationMediaFromSearch(input: {
    destinationId: string;
    result: WebImageSearchResult;
  }): Promise<MediaItem>;
```

- [x] **Step 5: Implement local repository import**

Add this method after `uploadDestinationMedia` in `createTripRepository`:

```ts
    async importDestinationMediaFromSearch(input: {
      destinationId: string;
      result: WebImageSearchResult;
    }): Promise<MediaItem> {
      const destination = await db.destinations.get(input.destinationId);
      if (!destination) {
        throw new Error('Destination not found.');
      }

      const timestamp = new Date().toISOString();
      const mediaItem: MediaItem = {
        id: crypto.randomUUID(),
        url: input.result.imageUrl,
        thumbnailUrl: input.result.thumbnailUrl,
        previewUrl: input.result.imageUrl,
        fullUrl: input.result.imageUrl,
        caption: input.result.title,
        credit: input.result.sourceName,
        sortOrder:
          destination.media.reduce(
            (maxSortOrder, item, index) => Math.max(maxSortOrder, item.sortOrder ?? index),
            -1,
          ) + 1,
        contentType: 'image/jpeg',
        uploadedAt: timestamp,
      };

      await db.destinations.put({
        ...destination,
        media: [...destination.media, mediaItem],
        updatedAt: timestamp,
      });

      return mediaItem;
    },
```

- [x] **Step 6: Implement Supabase repository import**

Modify the Supabase client type in `src/storage/supabaseTripRepository.ts` to include `functions.invoke`. Add:

```ts
type SupabaseFunctionResponse<T> = {
  data: T | null;
  error: { message?: string; context?: unknown; response?: unknown } | null;
};
```

Inside `createSupabaseTripRepository`, add this method after `uploadDestinationMedia`:

```ts
    async importDestinationMediaFromSearch(input) {
      const tripId = await getActiveTripId();
      const response = await supabase.functions.invoke('import-image', {
        body: {
          tripId,
          destinationId: input.destinationId,
          result: input.result,
        },
      }) as SupabaseFunctionResponse<{ mediaAsset?: SupabaseMediaAssetRow }>;

      if (response.error) {
        throw new Error(response.error.message || 'Unable to import image.');
      }

      if (!response.data?.mediaAsset) {
        throw new Error('Unable to import image.');
      }

      return createSignedMediaItem(response.data.mediaAsset);
    },
```

- [x] **Step 7: Update repository mocks**

Add `importDestinationMediaFromSearch: vi.fn()` to every `TripRepository` test mock, including `src/App.test.tsx`, `src/hooks/useTripData.test.tsx`, `src/storage/appRepository.test.ts`, `src/hooks/useDestinationMedia.test.tsx`, and `src/hooks/useActivityMedia.test.tsx`.

- [x] **Step 8: Run tests**

Run:

```bash
npm test -- src/storage/tripRepository.test.ts src/storage/supabaseTripRepository.test.ts
```

Expected: PASS.

- [x] **Step 9: Commit**

```bash
git add src/storage/tripRepository.ts src/storage/supabaseTripRepository.ts src/storage/tripRepository.test.ts src/storage/supabaseTripRepository.test.ts src/App.test.tsx src/hooks/useTripData.test.tsx src/storage/appRepository.test.ts src/hooks/useDestinationMedia.test.tsx src/hooks/useActivityMedia.test.tsx
git commit -m "Add repository import for web images"
```

---

### Task 5: Web Image Search UI Components

**Files:**
- Create: `src/components/WebImageSearchField.tsx`
- Create: `src/components/WebImageSearchField.test.tsx`
- Modify: `src/styles.css`
- Modify: `src/styles.test.ts`

- [x] **Step 1: Write failing component tests**

Create `src/components/WebImageSearchField.test.tsx`:

```tsx
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { WebImageSearchClient, WebImageSearchResult, WebImageSearchStopContext } from '../services/webImageSearchClient';
import { WebImageSearchField } from './WebImageSearchField';

const context: WebImageSearchStopContext = {
  stopName: 'Paris',
  countryName: 'France',
  countryCode: 'FR',
};

const result: WebImageSearchResult = {
  id: 'image-1',
  title: 'Paris mural',
  sourceName: 'Example Source',
  sourceUrl: 'https://example.com/page',
  thumbnailUrl: 'https://example.com/thumb.jpg',
  imageUrl: 'https://example.com/image.jpg',
  width: 1600,
  height: 1000,
};

function createClient(results: WebImageSearchResult[] = [result]): WebImageSearchClient {
  return {
    searchImages: vi.fn(async () => results),
  };
}

describe('WebImageSearchField', () => {
  it('searches and renders image results in a popover grid', async () => {
    const user = userEvent.setup();
    const client = createClient();
    render(
      <WebImageSearchField
        context={context}
        client={client}
        onImportImage={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText('Search web images'), 'mural');

    await waitFor(() => expect(client.searchImages).toHaveBeenCalledWith('mural', context));
    const grid = await screen.findByRole('listbox', { name: 'Web image results' });
    expect(within(grid).getByRole('option', { name: 'Import Paris mural from Example Source' })).toBeInTheDocument();
  });

  it('imports immediately and clears the query on success', async () => {
    const user = userEvent.setup();
    const onImportImage = vi.fn(async () => undefined);
    render(
      <WebImageSearchField
        context={context}
        client={createClient()}
        onImportImage={onImportImage}
      />,
    );

    const input = screen.getByLabelText('Search web images');
    await user.type(input, 'mural');
    await user.click(await screen.findByRole('option', { name: 'Import Paris mural from Example Source' }));

    expect(onImportImage).toHaveBeenCalledWith(result);
    expect(input).toHaveValue('');
  });

  it('keeps results open when import fails', async () => {
    const user = userEvent.setup();
    render(
      <WebImageSearchField
        context={context}
        client={createClient()}
        onImportImage={vi.fn(async () => {
          throw new Error('Imported image is too small.');
        })}
      />,
    );

    await user.type(screen.getByLabelText('Search web images'), 'mural');
    await user.click(await screen.findByRole('option', { name: 'Import Paris mural from Example Source' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Imported image is too small.');
    expect(screen.getByRole('option', { name: 'Import Paris mural from Example Source' })).toBeInTheDocument();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/components/WebImageSearchField.test.tsx
```

Expected: FAIL because `WebImageSearchField.tsx` does not exist.

- [x] **Step 3: Implement the UI component**

Create `src/components/WebImageSearchField.tsx`:

```tsx
import { Search, X, LoaderCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type {
  WebImageSearchClient,
  WebImageSearchResult,
  WebImageSearchStopContext,
} from '../services/webImageSearchClient';

type WebImageSearchFieldProps = {
  context: WebImageSearchStopContext;
  client: WebImageSearchClient;
  onImportImage: (result: WebImageSearchResult) => Promise<void> | void;
};

const searchDelayMs = 300;

export function WebImageSearchField({ context, client, onImportImage }: WebImageSearchFieldProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<WebImageSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const searchIdRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const trimmedQuery = query.trim();
  const hasPopover = Boolean(trimmedQuery && (isSearching || error || results.length > 0));

  const clearSearch = useCallback(() => {
    searchIdRef.current += 1;
    setQuery('');
    setResults([]);
    setIsSearching(false);
    setError('');
    setImportingId(null);
  }, []);

  useEffect(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }

    if (!trimmedQuery) {
      setResults([]);
      setError('');
      setIsSearching(false);
      return;
    }

    timerRef.current = window.setTimeout(() => {
      const searchId = searchIdRef.current + 1;
      searchIdRef.current = searchId;
      setIsSearching(true);
      setError('');

      void client.searchImages(trimmedQuery, context)
        .then((nextResults) => {
          if (searchId !== searchIdRef.current) return;
          setResults(nextResults);
        })
        .catch((caught) => {
          if (searchId !== searchIdRef.current) return;
          setResults([]);
          setError(caught instanceof Error ? caught.message : 'Unable to search web images.');
        })
        .finally(() => {
          if (searchId === searchIdRef.current) {
            setIsSearching(false);
          }
        });
    }, searchDelayMs);

    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, [client, context, trimmedQuery]);

  const importResult = async (result: WebImageSearchResult) => {
    if (importingId) return;

    setImportingId(result.id);
    setError('');
    try {
      await onImportImage(result);
      clearSearch();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to import image.');
      setImportingId(null);
    }
  };

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      clearSearch();
    }
  }

  return (
    <div className="web-image-search">
      <label className="sr-only" htmlFor="web-image-search-input">Search web images</label>
      <div className="search-input-shell web-image-search-input-shell">
        <Search className="search-input-icon" size={18} aria-hidden="true" />
        <input
          id="web-image-search-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search web images"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={hasPopover}
          aria-controls="web-image-search-results"
        />
        {query ? (
          <button type="button" className="search-clear" aria-label="Clear web image search" onClick={clearSearch}>
            <X size={16} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {hasPopover ? (
        <div className="web-image-search-popover">
          {isSearching ? (
            <div className="web-image-search-status" role="status">
              <LoaderCircle size={16} aria-hidden="true" />
              <span>Searching images...</span>
            </div>
          ) : null}
          {error ? <p className="web-image-search-error" role="alert">{error}</p> : null}
          {!isSearching && !error && results.length === 0 ? (
            <p className="web-image-search-empty">No images found.</p>
          ) : null}
          {results.length > 0 ? (
            <div id="web-image-search-results" className="web-image-result-grid" role="listbox" aria-label="Web image results">
              {results.map((result) => (
                <button
                  key={result.id}
                  type="button"
                  role="option"
                  aria-selected="false"
                  aria-label={`Import ${result.title} from ${result.sourceName}`}
                  className="web-image-result-tile"
                  disabled={Boolean(importingId)}
                  onClick={() => void importResult(result)}
                >
                  <img src={result.thumbnailUrl} alt="" />
                  <span className="web-image-result-meta">
                    <span>{result.title}</span>
                    <small>{importingId === result.id ? 'Importing...' : result.sourceName}</small>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
```

- [x] **Step 4: Add CSS**

Append to `src/styles.css` near image strip styles:

```css
.web-image-search {
  position: relative;
  padding: 10px 12px 0;
}

.web-image-search-input-shell input {
  font-size: 0.88rem;
}

.web-image-search-popover {
  position: absolute;
  z-index: 40;
  top: calc(100% + 6px);
  left: 12px;
  right: 12px;
  max-height: min(380px, 56vh);
  overflow: auto;
  padding: 10px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--panel-bg);
  box-shadow: var(--shadow-popover);
}

.web-image-result-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.web-image-result-tile {
  display: grid;
  grid-template-rows: 88px auto;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: 7px;
  padding: 0;
  background: rgb(var(--color-panel-rgb) / 0.94);
  color: inherit;
  cursor: pointer;
}

.web-image-result-tile img {
  width: 100%;
  height: 88px;
  object-fit: cover;
}

.web-image-result-meta {
  display: grid;
  gap: 2px;
  min-width: 0;
  padding: 6px;
  text-align: left;
  font-size: 0.72rem;
}

.web-image-result-meta span,
.web-image-result-meta small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.web-image-search-status,
.web-image-search-error,
.web-image-search-empty {
  margin: 0;
  padding: 8px;
  font-size: 0.78rem;
}
```

- [x] **Step 5: Add style tests**

Add to `src/styles.test.ts`:

```ts
describe('web image search styles', () => {
  it('uses fixed image tile dimensions inside the popover grid', () => {
    expect(styles).toMatch(/\.web-image-result-grid\s*{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/s);
    expect(styles).toMatch(/\.web-image-result-tile\s*{[^}]*grid-template-rows:\s*88px auto;/s);
    expect(styles).toMatch(/\.web-image-result-tile img\s*{[^}]*height:\s*88px;[^}]*object-fit:\s*cover;/s);
  });
});
```

- [x] **Step 6: Run component and style tests**

Run:

```bash
npm test -- src/components/WebImageSearchField.test.tsx src/styles.test.ts
```

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add src/components/WebImageSearchField.tsx src/components/WebImageSearchField.test.tsx src/styles.css src/styles.test.ts
git commit -m "Add web image search field"
```

---

### Task 6: Wire Search Into Stop Image Panel

**Files:**
- Modify: `src/components/DestinationImageStrip.tsx`
- Modify: `src/components/DestinationProfile.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/components/DestinationImageStrip.test.tsx`
- Modify: `src/components/DestinationProfile.test.tsx`

- [x] **Step 1: Write failing App integration test**

Add to `src/App.test.tsx`:

```tsx
it('searches web images with stop context and imports a selected result', async () => {
  const user = userEvent.setup();
  const destination = createDestination({
    name: 'Paris',
    countryRegion: 'France',
    location: {
      placeName: 'Paris',
      regionName: 'Ile-de-France',
      countryName: 'France',
      countryCode: 'FR',
      sourceLabel: 'Paris, France',
      sourceProvider: 'maptiler',
    },
  });
  const importedMedia = createMediaItem({
    id: 'imported-web-image',
    url: '/imported.jpg',
    thumbnailUrl: '/imported-thumb.jpg',
    caption: 'Paris mural',
    credit: 'Example Source',
  });
  const webImageSearchClient = {
    searchImages: vi.fn(async () => [
      {
        id: 'web-1',
        title: 'Paris mural',
        sourceName: 'Example Source',
        sourceUrl: 'https://example.com/page',
        thumbnailUrl: '/web-thumb.jpg',
        imageUrl: 'https://example.com/image.jpg',
        width: 1600,
        height: 1000,
      },
    ]),
  };
  repositoryMock.initialDestinations = Promise.resolve([destination]);
  repositoryMock.importDestinationMediaFromSearch.mockResolvedValue(importedMedia);
  repositoryMock.listDestinationMedia.mockResolvedValue([]);
  repositoryMock.listDestinationMediaRollup.mockResolvedValue([]);

  render(<App webImageSearchClient={webImageSearchClient} />);

  await waitFor(() => expect(screen.queryByText('Loading trip data')).not.toBeInTheDocument());
  await user.click(screen.getByRole('button', { name: 'Paris, France' }));
  await user.type(screen.getByLabelText('Search web images'), 'mural');
  await user.click(await screen.findByRole('option', { name: 'Import Paris mural from Example Source' }));

  expect(webImageSearchClient.searchImages).toHaveBeenCalledWith('mural', {
    stopName: 'Paris',
    regionName: 'Ile-de-France',
    countryName: 'France',
    countryCode: 'FR',
  });
  expect(repositoryMock.importDestinationMediaFromSearch).toHaveBeenCalledWith({
    destinationId: destination.id,
    result: expect.objectContaining({ id: 'web-1' }),
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/App.test.tsx -t "searches web images"
```

Expected: FAIL because `App` does not accept `webImageSearchClient` and the image strip has no search field.

- [x] **Step 3: Update component props**

In `src/components/DestinationImageStrip.tsx`, import:

```ts
import type { WebImageSearchClient, WebImageSearchResult, WebImageSearchStopContext } from '../services/webImageSearchClient';
import { WebImageSearchField } from './WebImageSearchField';
```

Add props:

```ts
  webImageSearchClient?: WebImageSearchClient;
  webImageSearchContext?: WebImageSearchStopContext;
  onImportWebImage?: (result: WebImageSearchResult) => Promise<void> | void;
```

Render before `MediaImageStrip`:

```tsx
      {props.webImageSearchClient && props.webImageSearchContext && props.onImportWebImage ? (
        <WebImageSearchField
          client={props.webImageSearchClient}
          context={props.webImageSearchContext}
          onImportImage={props.onImportWebImage}
        />
      ) : null}
```

In `src/components/DestinationProfile.tsx`, add matching props and pass them to `DestinationImageStrip`.

- [x] **Step 4: Wire App search client and import handler**

In `src/App.tsx`, import:

```ts
import { createAppWebImageSearchClient } from './services/webImageSearchClient';
import type { WebImageSearchClient, WebImageSearchResult, WebImageSearchStopContext } from './services/webImageSearchClient';
```

Change `App` signature to allow test injection:

```ts
type AppProps = {
  webImageSearchClient?: WebImageSearchClient;
};

function createWebImageSearchContext(destination: Destination): WebImageSearchStopContext {
  return {
    stopName: destination.name,
    regionName: destination.location.regionName || destination.countryRegion,
    countryName: destination.location.countryName || destination.countryRegion,
    countryCode: destination.location.countryCode,
  };
}

export default function App({ webImageSearchClient = createAppWebImageSearchClient() }: AppProps) {
```

Add handler near destination media handlers:

```ts
  const handleDestinationWebImageImport = useCallback(async (result: WebImageSearchResult) => {
    if (!selectedDestinationId) return;

    await repository.importDestinationMediaFromSearch({
      destinationId: selectedDestinationId,
      result,
    });
    await destinationMedia.reload();
    await reloadDestinationMediaRollup();
  }, [destinationMedia, reloadDestinationMediaRollup, repository, selectedDestinationId]);
```

Pass into `DestinationProfile`:

```tsx
              webImageSearchClient={webImageSearchClient}
              webImageSearchContext={createWebImageSearchContext(selectedDestination)}
              onImportWebImage={handleDestinationWebImageImport}
```

- [x] **Step 5: Update unit tests for required props**

In `DestinationImageStrip.test.tsx`, add tests that it renders `Search web images` when all web image props are supplied and omits it otherwise.

In `DestinationProfile.test.tsx`, pass a fake `webImageSearchClient` only in the new test so existing tests do not need a search field.

- [x] **Step 6: Run tests**

Run:

```bash
npm test -- src/App.test.tsx src/components/DestinationImageStrip.test.tsx src/components/DestinationProfile.test.tsx
```

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add src/App.tsx src/App.test.tsx src/components/DestinationImageStrip.tsx src/components/DestinationImageStrip.test.tsx src/components/DestinationProfile.tsx src/components/DestinationProfile.test.tsx
git commit -m "Wire web image search into stop panel"
```

---

### Task 7: E2E Smoke Test

**Files:**
- Modify: `tests/world-tour.spec.ts`

- [x] **Step 1: Add e2e smoke test**

Add to `tests/world-tour.spec.ts`:

```ts
test('imports a web image result into a stop carousel', async ({ baseURL, context, page }) => {
  const origin = new URL(baseURL ?? 'http://127.0.0.1:5174').origin;
  const cdpSession = await context.newCDPSession(page);

  await cdpSession.send('Storage.clearDataForOrigin', {
    origin,
    storageTypes: 'indexeddb',
  });

  await page.route('https://api.maptiler.com/geocoding/**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: { features: parisResult },
    });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('Search for a destination')).toBeVisible();
  await page.getByLabel('Search for a destination').fill('Paris');
  await page.getByRole('option', { name: 'Paris, France' }).click();

  const stopPanel = page.getByRole('complementary', { name: 'Paris profile' });
  await expect(stopPanel).toBeVisible();
  await stopPanel.getByLabel('Search web images').fill('mural');
  await stopPanel.getByRole('option', { name: /Import mural in Paris from Local image search/ }).click();

  await expect(stopPanel.getByRole('button', { name: /Open full image: mural in Paris/ })).toBeVisible();
});
```

- [x] **Step 2: Run e2e test**

Run:

```bash
npm run test:e2e -- tests/world-tour.spec.ts -g "imports a web image result"
```

Expected: PASS.

- [x] **Step 3: Commit**

```bash
git add tests/world-tour.spec.ts
git commit -m "Add web image import e2e smoke test"
```

---

### Task 8: Final Verification

**Files:**
- Verify only.

- [x] **Step 1: Run focused tests**

Run:

```bash
npm test -- src/services/webImageSearchClient.test.ts src/components/WebImageSearchField.test.tsx src/components/DestinationImageStrip.test.tsx src/components/DestinationProfile.test.tsx src/App.test.tsx src/storage/tripRepository.test.ts src/storage/supabaseTripRepository.test.ts src/styles.test.ts
deno test --allow-env --allow-net supabase/functions/image-search/metadata.test.ts supabase/functions/import-image/metadata.test.ts
npm run test:e2e -- tests/world-tour.spec.ts -g "imports a web image result"
```

Expected: all commands PASS.

- [x] **Step 2: Run full app checks**

Run:

```bash
npm test
npm run build
npm run test:e2e
```

Expected: all commands PASS.

- [x] **Step 3: Manual browser verification**

Run:

```bash
npm run dev
```

Open the local Vite URL. In a stop panel, confirm:

- The search bar appears above the current preview image.
- Typing opens an image grid popover.
- Selecting a tile appends an image.
- Delete still works in the preview modal.
- Existing drag/drop upload and thumbnail reorder still work.

- [x] **Step 4: Commit verification notes only if files changed**

## Implementation Status

Completed across `4454c57 Add web image search client`, `7292242 Add image search edge function`, `05680d1 Add web image import function`, `d89a285 Add repository import for web images`, `2403bf1 Wire web image search into stop panel`, `e478841 Add web image import e2e smoke test`, and follow-up hardening commits through `26d91c1 Use activity location in image search`.

If manual verification required no file changes, do not commit. If a small fix was needed, commit it with:

```bash
git add <changed-files>
git commit -m "Polish web image search"
```

---

## Self-Review Notes

- Spec coverage: Tasks cover search bar placement, popover image grid, immediate import, context-aware query shaping, SerpApi provider, large/photo filters, quality filtering, server-side import, local/e2e fallback, accessibility, tests, and existing media storage.
- Placeholder scan: No `TBD`, `TODO`, or empty implementation steps remain.
- Type consistency: `WebImageSearchResult`, `WebImageSearchStopContext`, `WebImageSearchClient`, and `importDestinationMediaFromSearch` are defined before later tasks use them.
