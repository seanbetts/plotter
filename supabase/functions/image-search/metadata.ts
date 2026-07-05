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
const providerSearchErrorMessage = "Unable to search web images.";

function clean(value: string | undefined) {
  return value?.trim().replace(/\s+/g, " ") ?? "";
}

function contextWords(value: string) {
  return value.toLocaleLowerCase().split(/[^a-z0-9]+/i).filter(Boolean);
}

function appendContextPart(
  parts: string[],
  seenWords: Set<string>,
  value: string | undefined,
) {
  const trimmed = clean(value);
  if (!trimmed) return;

  const words = contextWords(trimmed);
  if (words.length > 0 && words.every((word) => seenWords.has(word))) return;

  parts.push(trimmed);
  for (const word of words) {
    seenWords.add(word);
  }
}

export function buildProviderQuery(
  query: string,
  context: ImageSearchStopContext,
) {
  const visibleQuery = clean(query);
  const parts = visibleQuery ? [visibleQuery] : [];
  const seenWords = new Set(contextWords(visibleQuery));

  appendContextPart(parts, seenWords, context.stopName);
  appendContextPart(
    parts,
    seenWords,
    context.countryName || context.regionName,
  );

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

  const location = [
    input.context.stopName,
    input.context.countryName || input.context.regionName,
  ].map(clean).filter(Boolean).join(", ");
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
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function parseSerpApiResponse(
  response: Response,
): Promise<SerpApiResponse> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(providerSearchErrorMessage);
  }

  if (!isRecord(body)) {
    throw new Error(providerSearchErrorMessage);
  }

  if (typeof body.error === "string") {
    throw new Error(body.error);
  }

  if (
    body.images_results !== undefined && !Array.isArray(body.images_results)
  ) {
    throw new Error(providerSearchErrorMessage);
  }

  return body as SerpApiResponse;
}

export function mapSerpApiImageResults(
  response: SerpApiResponse,
): WebImageSearchResult[] {
  return (response.images_results ?? []).flatMap((result, index) => {
    const title = clean(result.title) || "Web image";
    const sourceName = clean(result.source) ||
      (isHttpUrl(result.link)
        ? new URL(result.link).hostname.replace(/^www\./, "")
        : "");
    const sourceUrl = result.link;
    const thumbnailUrl = result.thumbnail;
    const imageUrl = result.original;

    if (
      !sourceName ||
      !isHttpUrl(sourceUrl) ||
      !isHttpUrl(thumbnailUrl) ||
      !isHttpUrl(imageUrl)
    ) {
      return [];
    }

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

  const response = await fetcher(
    buildSerpApiImageSearchUrl({ apiKey, query, context }),
  );
  if (!response.ok) {
    throw new Error(providerSearchErrorMessage);
  }

  const body = await parseSerpApiResponse(response);

  return filterQualityImageResults(mapSerpApiImageResults(body));
}
