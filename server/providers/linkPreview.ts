import type { LinkPreviewResult } from '../../src/services/linkPreviewClient';
import {
  cancelResponse,
  createBoundarySignal,
  defaultProviderBoundaryDependencies,
  type ProviderBoundaryDependencies,
  validatePublicHttpUrl,
} from './network';

export type { ProviderBoundaryDependencies } from './network';
export type LinkPreview = LinkPreviewResult;

const MAX_PREVIEW_BYTES = 512_000;
const MAX_REDIRECTS = 3;
const PREVIEW_TIMEOUT_MS = 5_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const FETCH_ERROR = 'Unable to fetch link preview.';
const validationMessages = {
  invalid: 'Enter a valid URL.',
  protocol: 'Links must use http or https.',
  nonPublic: 'Enter a public URL.',
  unresolved: 'Unable to resolve URL host.',
};

function throwRedactedFetchError(): never {
  throw new Error(FETCH_ERROR);
}

function normalizeUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) throw new Error('Enter a URL.');
  return /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function cleanText(value: string): string {
  return decodeHtmlEntities(value).replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&', apos: "'", gt: '>', lt: '<', quot: '"',
  };
  return value.replace(/&(#\d+|#x[\da-f]+|[a-z]+);/gi, (entity, body: string) => {
    if (body.toLowerCase().startsWith('#x')) {
      return decodeCodePoint(Number.parseInt(body.slice(2), 16), entity);
    }
    if (body.startsWith('#')) return decodeCodePoint(Number.parseInt(body.slice(1), 10), entity);
    return named[body.toLowerCase()] ?? entity;
  });
}

function decodeCodePoint(codePoint: number, fallback: string): string {
  if (!Number.isFinite(codePoint)) return fallback;
  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return fallback;
  }
}

function attributes(tag: string): Map<string, string> {
  const result = new Map<string, string>();
  const pattern = /([^\s"'=<>`]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  for (const match of tag.matchAll(pattern)) {
    const [, name, doubleQuoted, singleQuoted, bare] = match;
    if (name) result.set(name.toLowerCase(), doubleQuoted ?? singleQuoted ?? bare ?? '');
  }
  return result;
}

function metaContent(html: string, name: string): string | undefined {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const parsed = attributes(match[0]);
    const candidateName = (parsed.get('property') || parsed.get('name') || '').toLowerCase();
    if (candidateName !== name) continue;
    const content = parsed.get('content');
    if (content) {
      const cleaned = cleanText(content);
      if (cleaned) return cleaned;
    }
  }
  return undefined;
}

function documentTitle(html: string): string | undefined {
  const content = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return content ? cleanText(content.replace(/<[^>]+>/g, '')) || undefined : undefined;
}

function mimeType(response: Response): string {
  return (response.headers.get('content-type') ?? '').split(';', 1)[0]!.trim().toLowerCase();
}

async function readBoundedHtml(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PREVIEW_BYTES) {
    await cancelResponse(response);
    throw new Error('Link preview response is too large.');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteCount = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteCount += value.byteLength;
      if (byteCount > MAX_PREVIEW_BYTES) {
        await reader.cancel();
        throw new Error('Link preview response is too large.');
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
  return new TextDecoder().decode(bytes);
}

async function safeImageUrl(
  rawUrl: string | undefined,
  baseUrl: URL,
  dependencies: ProviderBoundaryDependencies,
  signal: AbortSignal,
): Promise<string | undefined> {
  if (!rawUrl) return undefined;
  try {
    const candidate = new URL(rawUrl, baseUrl);
    const validated = await validatePublicHttpUrl(
      candidate.toString(), dependencies, validationMessages, signal,
    );
    return validated.url.toString();
  } catch {
    return undefined;
  }
}

export function createLinkPreviewProvider(
  dependencies: ProviderBoundaryDependencies = defaultProviderBoundaryDependencies,
): (input: { url: string }, signal: AbortSignal) => Promise<LinkPreview> {
  return async ({ url: rawUrl }, externalSignal) => {
    const boundarySignal = createBoundarySignal(externalSignal, dependencies, PREVIEW_TIMEOUT_MS);
    try {
      let currentUrl = normalizeUrl(rawUrl);
      let response: Response | undefined;
      let finalUrl: URL | undefined;
      for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
        const validated = await validatePublicHttpUrl(
          currentUrl, dependencies, validationMessages, boundarySignal.signal,
        );
        try {
          response = await dependencies.fetch(validated.url, {
            method: 'GET',
            headers: {
              accept: 'text/html, application/xhtml+xml',
              'user-agent': 'PlotterLinkPreview/1.0',
            },
            redirect: 'manual',
            signal: boundarySignal.signal,
          }, validated.addresses);
        } catch {
          throw new Error(FETCH_ERROR);
        }

        if (!REDIRECT_STATUSES.has(response.status)) {
          finalUrl = validated.url;
          break;
        }
        await cancelResponse(response);
        if (redirectCount >= MAX_REDIRECTS) {
          throw new Error('Too many redirects while fetching link preview.');
        }
        const location = response.headers.get('location');
        if (!location) throw new Error('Redirect response is missing a Location header.');
        try {
          currentUrl = new URL(location, validated.url).toString();
        } catch {
          throw new Error(FETCH_ERROR);
        }
      }

      if (!response || !finalUrl) throw new Error(FETCH_ERROR);
      if (!response.ok) {
        await cancelResponse(response);
        throw new Error(FETCH_ERROR);
      }
      const contentType = mimeType(response);
      if (contentType !== 'text/html' && contentType !== 'application/xhtml+xml') {
        await cancelResponse(response);
        throw new Error('URL returned a non-HTML response.');
      }

      let html: string;
      try {
        html = await readBoundedHtml(response);
      } catch (error) {
        if (error instanceof Error && error.message === 'Link preview response is too large.') throw error;
        throwRedactedFetchError();
      }
      const domain = finalUrl.hostname.replace(/^www\./i, '');
      const title = metaContent(html, 'og:title')
        || metaContent(html, 'twitter:title')
        || documentTitle(html)
        || domain;
      const rawImageUrl = metaContent(html, 'og:image') || metaContent(html, 'twitter:image');
      const imageUrl = await safeImageUrl(
        rawImageUrl, finalUrl, dependencies, boundarySignal.signal,
      );
      return {
        url: finalUrl.toString(),
        title,
        domain,
        ...(imageUrl ? { imageUrl } : {}),
      };
    } finally {
      boundarySignal.cleanup();
    }
  };
}

export function fetchLinkPreview(
  input: { url: string },
  signal: AbortSignal,
): Promise<LinkPreview> {
  return createLinkPreviewProvider()(input, signal);
}
