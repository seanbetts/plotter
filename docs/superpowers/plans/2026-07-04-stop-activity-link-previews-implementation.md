# Stop And Activity Link Previews Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Build visual URL preview cards for stop and activity links, with server-side preview fetching, fallback visuals, click-to-open, delete, and drag-to-reorder.

**Architecture:** Extend the existing shared `ResearchLink` JSON shape and add focused domain helpers for normalization, fallback creation, sorting, and reorder. Add a Supabase Edge Function for preview metadata fetching and a browser client wrapper for invoking it. Build one reusable `LinkPreviewGrid` component and wire it into `DestinationProfile` and `ActivityPanel`.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Supabase Edge Functions, Supabase JS client, CSS modules through the existing `src/styles.css` file.

---

## File Structure

- Modify `src/domain/types.ts`: extend `ResearchLink` with `domain`, `imageUrl`, `sortOrder`, and `previewFetchedAt`.
- Create `src/domain/researchLinks.ts`: URL normalization, domain derivation, fallback link creation, sorting, reorder, and legacy link normalization.
- Create `src/domain/researchLinks.test.ts`: unit tests for link helpers.
- Create `supabase/functions/link-preview/index.ts`: Edge Function HTTP entrypoint.
- Create `supabase/functions/link-preview/metadata.ts`: URL safety checks, metadata parsing, and preview response creation.
- Create `supabase/functions/link-preview/metadata.test.ts`: Deno tests for metadata helpers.
- Create `src/services/linkPreviewClient.ts`: browser-side preview client factory and local fallback client.
- Create `src/services/linkPreviewClient.test.ts`: tests for Supabase invocation and fallback behavior.
- Create `src/components/LinkPreviewGrid.tsx`: shared visual card grid and add-link form.
- Create `src/components/LinkPreviewGrid.test.tsx`: component tests for add, fallback, open anchor, delete, and reorder.
- Modify `src/components/DestinationProfile.tsx`: include stop links in the form state and render `LinkPreviewGrid`.
- Modify `src/components/DestinationProfile.test.tsx`: stop link integration coverage.
- Modify `src/components/ActivityPanel.tsx`: include activity links in the draft and render `LinkPreviewGrid`.
- Modify `src/components/ActivityPanel.test.tsx`: activity link integration coverage.
- Modify `src/App.tsx`: create and pass the link preview client to both panels.
- Modify `src/App.test.tsx`: mock the preview client prop flow.
- Modify `src/styles.css`: visual tile styles, two-column grid, fallback image treatment, focused keyboard controls.
- Add `tests/e2e/link-previews.spec.ts`: focused e2e coverage with e2e-local storage.

---

### Task 1: Domain Link Model And Helpers

**Files:**
- Modify: `src/domain/types.ts`
- Create: `src/domain/researchLinks.ts`
- Test: `src/domain/researchLinks.test.ts`
- Modify: `src/domain/activities.test.ts`
- Modify: `src/domain/destinations.test.ts`

- [x] **Step 1: Write failing tests for URL normalization, fallback creation, sorting, and reorder**

Create `src/domain/researchLinks.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import {
  createFallbackResearchLink,
  deriveLinkDomain,
  normalizeResearchLink,
  normalizeResearchLinkUrl,
  reorderResearchLinks,
  sortResearchLinks,
} from './researchLinks';
import type { ResearchLink } from './types';

describe('researchLinks', () => {
  it('normalizes pasted URLs and derives display domains', () => {
    expect(normalizeResearchLinkUrl(' example.com/menu ')).toBe('https://example.com/menu');
    expect(normalizeResearchLinkUrl('http://example.com/a b')).toBe('http://example.com/a%20b');
    expect(deriveLinkDomain('https://www.timeout.com/paris')).toBe('timeout.com');
  });

  it('rejects invalid URLs before preview fetching', () => {
    expect(() => normalizeResearchLinkUrl('ftp://example.com/file')).toThrow('Links must use http or https.');
    expect(() => normalizeResearchLinkUrl('   ')).toThrow('Enter a URL.');
  });

  it('creates a fallback card snapshot from a URL', () => {
    vi.setSystemTime(new Date('2026-07-04T12:00:00.000Z'));
    const link = createFallbackResearchLink('example.com/menu', { sortOrder: 2 });

    expect(link).toMatchObject({
      url: 'https://example.com/menu',
      title: 'example.com',
      domain: 'example.com',
      sortOrder: 2,
      previewFetchedAt: '2026-07-04T12:00:00.000Z',
    });
    expect(link.id).toEqual(expect.any(String));
    expect(link.imageUrl).toBeUndefined();
  });

  it('normalizes old links that only have id, title, and url', () => {
    const oldLink = {
      id: 'link-1',
      title: 'Menu',
      url: 'https://restaurant.example/menu',
    } satisfies Pick<ResearchLink, 'id' | 'title' | 'url'>;

    expect(normalizeResearchLink(oldLink, 4)).toEqual({
      id: 'link-1',
      title: 'Menu',
      url: 'https://restaurant.example/menu',
      domain: 'restaurant.example',
      sortOrder: 4,
    });
  });

  it('sorts links by sortOrder and reassigns order after drag reorder', () => {
    const first: ResearchLink = {
      id: 'first',
      title: 'First',
      url: 'https://first.example',
      domain: 'first.example',
      sortOrder: 0,
    };
    const second: ResearchLink = {
      id: 'second',
      title: 'Second',
      url: 'https://second.example',
      domain: 'second.example',
      sortOrder: 1,
    };
    const third: ResearchLink = {
      id: 'third',
      title: 'Third',
      url: 'https://third.example',
      domain: 'third.example',
      sortOrder: 2,
    };

    expect(sortResearchLinks([third, first, second]).map((link) => link.id)).toEqual([
      'first',
      'second',
      'third',
    ]);

    expect(reorderResearchLinks([first, second, third], ['third', 'first']).map((link) => ({
      id: link.id,
      sortOrder: link.sortOrder,
    }))).toEqual([
      { id: 'third', sortOrder: 0 },
      { id: 'first', sortOrder: 1 },
      { id: 'second', sortOrder: 2 },
    ]);
  });
});
```

Update existing default tests:

```ts
expect(activity.links).toEqual([]);
expect(destination.research.links).toEqual([]);
```

Keep those expectations unchanged after extending the type.

- [x] **Step 2: Run the failing domain tests**

Run:

```bash
npm test -- src/domain/researchLinks.test.ts src/domain/activities.test.ts src/domain/destinations.test.ts
```

Expected: `src/domain/researchLinks.test.ts` fails because `src/domain/researchLinks.ts` does not exist.

- [x] **Step 3: Extend the shared type and implement helpers**

Modify `src/domain/types.ts`:

```ts
export type ResearchLink = {
  id: string;
  title: string;
  url: string;
  domain: string;
  imageUrl?: string;
  sortOrder: number;
  previewFetchedAt?: string;
};
```

Create `src/domain/researchLinks.ts`:

```ts
import type { ResearchLink } from './types';

type LegacyResearchLink = Pick<ResearchLink, 'id' | 'title' | 'url'> & Partial<ResearchLink>;

const allowedProtocols = new Set(['http:', 'https:']);

const nowIso = () => new Date().toISOString();
const createId = () => crypto.randomUUID();

export function normalizeResearchLinkUrl(rawUrl: string) {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new Error('Enter a URL.');
  }

  const withScheme = /^[a-z][a-z\d+\-.]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error('Enter a valid URL.');
  }

  if (!allowedProtocols.has(parsed.protocol)) {
    throw new Error('Links must use http or https.');
  }

  return parsed.toString();
}

export function deriveLinkDomain(url: string) {
  const parsed = new URL(normalizeResearchLinkUrl(url));
  return parsed.hostname.replace(/^www\./i, '');
}

export function createFallbackResearchLink(
  rawUrl: string,
  options: { sortOrder: number; id?: string; fetchedAt?: string } = { sortOrder: 0 },
): ResearchLink {
  const url = normalizeResearchLinkUrl(rawUrl);
  const domain = deriveLinkDomain(url);

  return {
    id: options.id ?? createId(),
    url,
    title: domain,
    domain,
    sortOrder: options.sortOrder,
    previewFetchedAt: options.fetchedAt ?? nowIso(),
  };
}

export function normalizeResearchLink(link: LegacyResearchLink, index: number): ResearchLink {
  const url = normalizeResearchLinkUrl(link.url);
  const domain = link.domain || deriveLinkDomain(url);

  return {
    id: link.id,
    title: link.title || domain,
    url,
    domain,
    imageUrl: link.imageUrl,
    sortOrder: Number.isFinite(link.sortOrder) ? link.sortOrder : index,
    previewFetchedAt: link.previewFetchedAt,
  };
}

export function sortResearchLinks(links: LegacyResearchLink[]) {
  return links
    .map((link, index) => normalizeResearchLink(link, index))
    .sort((left, right) => left.sortOrder - right.sortOrder || left.title.localeCompare(right.title));
}

export function reorderResearchLinks(links: ResearchLink[], orderedLinkIds: string[]) {
  const requestedIds = new Set(orderedLinkIds);
  const linksById = new Map(links.map((link) => [link.id, link]));
  const orderedLinks = [
    ...orderedLinkIds
      .map((linkId) => linksById.get(linkId))
      .filter((link): link is ResearchLink => link !== undefined),
    ...links.filter((link) => !requestedIds.has(link.id)),
  ];

  return orderedLinks.map((link, sortOrder) => ({
    ...link,
    sortOrder,
  }));
}
```

- [x] **Step 4: Run the domain tests**

Run:

```bash
npm test -- src/domain/researchLinks.test.ts src/domain/activities.test.ts src/domain/destinations.test.ts
```

Expected: all listed test files pass.

- [x] **Step 5: Commit domain helpers**

Run:

```bash
git add src/domain/types.ts src/domain/researchLinks.ts src/domain/researchLinks.test.ts src/domain/activities.test.ts src/domain/destinations.test.ts
git commit -m "Add research link domain helpers"
```

---

### Task 2: Supabase Link Preview Edge Function

**Files:**
- Create: `supabase/functions/link-preview/index.ts`
- Create: `supabase/functions/link-preview/metadata.ts`
- Test: `supabase/functions/link-preview/metadata.test.ts`

- [x] **Step 1: Write failing Deno tests for metadata helpers**

Create `supabase/functions/link-preview/metadata.test.ts`:

```ts
import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  createPreviewFromHtml,
  normalizePreviewUrl,
  validatePublicPreviewUrl,
} from './metadata.ts';

Deno.test('normalizes URLs and rejects unsupported protocols', () => {
  assertEquals(normalizePreviewUrl('example.com/menu'), 'https://example.com/menu');
  assertEquals(normalizePreviewUrl(' http://example.com/a b '), 'http://example.com/a%20b');
  assertRejects(() => Promise.resolve(normalizePreviewUrl('ftp://example.com/file')), Error, 'http or https');
});

Deno.test('rejects private and local targets', async () => {
  await assertRejects(() => validatePublicPreviewUrl('http://localhost:5173'), Error, 'public URL');
  await assertRejects(() => validatePublicPreviewUrl('http://127.0.0.1:5173'), Error, 'public URL');
  await assertRejects(() => validatePublicPreviewUrl('http://192.168.1.10/page'), Error, 'public URL');
  await assertRejects(() => validatePublicPreviewUrl('http://169.254.1.2/page'), Error, 'public URL');
});

Deno.test('extracts Open Graph preview data before other metadata', async () => {
  const preview = await createPreviewFromHtml({
    requestedUrl: 'example.com/page',
    finalUrl: 'https://example.com/page',
    html: `
      <html>
        <head>
          <title>Document title</title>
          <meta name="twitter:title" content="Twitter title">
          <meta name="twitter:image" content="/twitter.jpg">
          <meta property="og:title" content="OG title">
          <meta property="og:image" content="/og.jpg">
        </head>
      </html>
    `,
  });

  assertEquals(preview, {
    url: 'https://example.com/page',
    title: 'OG title',
    domain: 'example.com',
    imageUrl: 'https://example.com/og.jpg',
  });
});

Deno.test('falls back to Twitter metadata and then document title', async () => {
  assertEquals(
    await createPreviewFromHtml({
      requestedUrl: 'https://example.com/page',
      finalUrl: 'https://example.com/page',
      html: '<meta name="twitter:title" content="Twitter title"><meta name="twitter:image" content="/twitter.jpg">',
    }),
    {
      url: 'https://example.com/page',
      title: 'Twitter title',
      domain: 'example.com',
      imageUrl: 'https://example.com/twitter.jpg',
    },
  );

  assertEquals(
    await createPreviewFromHtml({
      requestedUrl: 'https://example.com/page',
      finalUrl: 'https://example.com/page',
      html: '<title>Document title</title>',
    }),
    {
      url: 'https://example.com/page',
      title: 'Document title',
      domain: 'example.com',
      imageUrl: undefined,
    },
  );
});
```

- [x] **Step 2: Run the failing Deno tests**

Run:

```bash
deno test --allow-net=deno.land supabase/functions/link-preview/metadata.test.ts
```

Expected: fail because `metadata.ts` does not exist.

- [x] **Step 3: Implement metadata parsing and URL safety**

Create `supabase/functions/link-preview/metadata.ts`:

```ts
export type LinkPreviewResponse = {
  url: string;
  title: string;
  domain: string;
  imageUrl?: string;
};

const allowedProtocols = new Set(['http:', 'https:']);
const maxHtmlBytes = 512_000;

export function normalizePreviewUrl(rawUrl: string) {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new Error('Enter a URL.');
  }

  const withScheme = /^[a-z][a-z\d+\-.]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error('Enter a valid URL.');
  }

  if (!allowedProtocols.has(parsed.protocol)) {
    throw new Error('Links must use http or https.');
  }

  return parsed.toString();
}

function isPrivateHostname(hostname: string) {
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.localhost')) return true;

  const parts = lower.split('.').map((part) => Number(part));
  if (parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    const [first, second] = parts;
    return (
      first === 10 ||
      first === 127 ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 169 && second === 254) ||
      first === 0
    );
  }

  return lower === '[::1]' || lower === '::1';
}

export async function validatePublicPreviewUrl(rawUrl: string) {
  const url = normalizePreviewUrl(rawUrl);
  const parsed = new URL(url);

  if (isPrivateHostname(parsed.hostname)) {
    throw new Error('Enter a public URL.');
  }

  return url;
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function readMetaContent(html: string, attributeName: 'property' | 'name', attributeValue: string) {
  const escaped = attributeValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const direct = new RegExp(`<meta\\s+[^>]*${attributeName}=["']${escaped}["'][^>]*content=["']([^"']+)["'][^>]*>`, 'i');
  const reversed = new RegExp(`<meta\\s+[^>]*content=["']([^"']+)["'][^>]*${attributeName}=["']${escaped}["'][^>]*>`, 'i');
  const match = html.match(direct) ?? html.match(reversed);
  return match?.[1] ? decodeHtmlEntities(match[1].trim()) : undefined;
}

function readTitle(html: string) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1] ? decodeHtmlEntities(match[1].replace(/\s+/g, ' ').trim()) : undefined;
}

function absoluteImageUrl(imageUrl: string | undefined, baseUrl: string) {
  if (!imageUrl) return undefined;

  try {
    return new URL(imageUrl, baseUrl).toString();
  } catch {
    return undefined;
  }
}

function domainFromUrl(url: string) {
  return new URL(url).hostname.replace(/^www\./i, '');
}

export async function createPreviewFromHtml(input: {
  requestedUrl: string;
  finalUrl: string;
  html: string;
}): Promise<LinkPreviewResponse> {
  const url = normalizePreviewUrl(input.finalUrl || input.requestedUrl);
  const domain = domainFromUrl(url);
  const title =
    readMetaContent(input.html, 'property', 'og:title') ||
    readMetaContent(input.html, 'name', 'twitter:title') ||
    readTitle(input.html) ||
    domain;
  const imageUrl = absoluteImageUrl(
    readMetaContent(input.html, 'property', 'og:image') ||
      readMetaContent(input.html, 'name', 'twitter:image'),
    url,
  );

  return {
    url,
    title,
    domain,
    imageUrl,
  };
}

export async function fetchLinkPreview(rawUrl: string, fetcher: typeof fetch = fetch) {
  const url = await validatePublicPreviewUrl(rawUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetcher(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': 'world-tour-link-preview/1.0',
      },
    });

    if (!response.ok) {
      throw new Error('Unable to fetch link preview.');
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      throw new Error('Link preview must be an HTML page.');
    }

    const text = await response.text();
    const html = text.slice(0, maxHtmlBytes);

    return createPreviewFromHtml({
      requestedUrl: url,
      finalUrl: response.url || url,
      html,
    });
  } finally {
    clearTimeout(timeout);
  }
}
```

- [x] **Step 4: Implement the Edge Function entrypoint**

Create `supabase/functions/link-preview/index.ts`:

```ts
import { fetchLinkPreview } from './metadata.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return Response.json(
      { error: 'Method not allowed.' },
      { status: 405, headers: corsHeaders },
    );
  }

  try {
    const body = await request.json();
    const url = typeof body.url === 'string' ? body.url : '';
    const preview = await fetchLinkPreview(url);

    return Response.json(preview, { headers: corsHeaders });
  } catch (caught) {
    return Response.json(
      { error: caught instanceof Error ? caught.message : 'Unable to fetch link preview.' },
      { status: 400, headers: corsHeaders },
    );
  }
});
```

- [x] **Step 5: Run Edge Function tests**

Run:

```bash
deno test --allow-net=deno.land supabase/functions/link-preview/metadata.test.ts
```

Expected: all tests pass.

- [x] **Step 6: Commit Edge Function**

Run:

```bash
git add supabase/functions/link-preview/index.ts supabase/functions/link-preview/metadata.ts supabase/functions/link-preview/metadata.test.ts
git commit -m "Add link preview edge function"
```

---

### Task 3: Browser Link Preview Client

**Files:**
- Create: `src/services/linkPreviewClient.ts`
- Test: `src/services/linkPreviewClient.test.ts`
- Modify: `src/storage/supabaseClient.ts`

- [x] **Step 1: Write failing tests for preview client behavior**

Create `src/services/linkPreviewClient.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import {
  createLocalLinkPreviewClient,
  createSupabaseLinkPreviewClient,
} from './linkPreviewClient';

describe('linkPreviewClient', () => {
  it('invokes the Supabase Edge Function and returns preview data', async () => {
    const invoke = vi.fn(async () => ({
      data: {
        url: 'https://example.com/menu',
        title: 'Dinner menu',
        domain: 'example.com',
        imageUrl: 'https://example.com/og.jpg',
      },
      error: null,
    }));
    const client = createSupabaseLinkPreviewClient({ functions: { invoke } });

    await expect(client.fetchPreview('example.com/menu')).resolves.toEqual({
      url: 'https://example.com/menu',
      title: 'Dinner menu',
      domain: 'example.com',
      imageUrl: 'https://example.com/og.jpg',
    });
    expect(invoke).toHaveBeenCalledWith('link-preview', {
      body: { url: 'example.com/menu' },
    });
  });

  it('throws the Edge Function error message', async () => {
    const invoke = vi.fn(async () => ({
      data: null,
      error: { message: 'Enter a public URL.' },
    }));
    const client = createSupabaseLinkPreviewClient({ functions: { invoke } });

    await expect(client.fetchPreview('localhost:5173')).rejects.toThrow('Enter a public URL.');
  });

  it('creates deterministic local fallback previews for e2e-local storage', async () => {
    const client = createLocalLinkPreviewClient();

    await expect(client.fetchPreview('example.com/menu')).resolves.toEqual({
      url: 'https://example.com/menu',
      title: 'example.com',
      domain: 'example.com',
      imageUrl: undefined,
    });
  });
});
```

- [x] **Step 2: Run the failing client tests**

Run:

```bash
npm test -- src/services/linkPreviewClient.test.ts
```

Expected: fail because `src/services/linkPreviewClient.ts` does not exist.

- [x] **Step 3: Export Supabase env helpers and implement the client**

Modify `src/storage/supabaseClient.ts`:

```ts
export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? '';
export const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';
```

Create `src/services/linkPreviewClient.ts`:

```ts
import { createBrowserSupabaseClient } from '../storage/supabaseClient';
import { deriveLinkDomain, normalizeResearchLinkUrl } from '../domain/researchLinks';

export type LinkPreviewResult = {
  url: string;
  title: string;
  domain: string;
  imageUrl?: string;
};

export type LinkPreviewClient = {
  fetchPreview(rawUrl: string): Promise<LinkPreviewResult>;
};

type SupabaseFunctionClient = {
  functions: {
    invoke(
      name: string,
      options: { body: { url: string } },
    ): Promise<{
      data: LinkPreviewResult | null;
      error: { message: string } | null;
    }>;
  };
};

function normalizePreviewResult(rawUrl: string, result: Partial<LinkPreviewResult>): LinkPreviewResult {
  const url = normalizeResearchLinkUrl(result.url || rawUrl);
  const domain = result.domain || deriveLinkDomain(url);

  return {
    url,
    title: result.title || domain,
    domain,
    imageUrl: result.imageUrl || undefined,
  };
}

export function createSupabaseLinkPreviewClient(supabase: SupabaseFunctionClient): LinkPreviewClient {
  return {
    async fetchPreview(rawUrl: string) {
      const response = await supabase.functions.invoke('link-preview', {
        body: { url: rawUrl },
      });

      if (response.error) {
        throw new Error(response.error.message || 'Unable to fetch link preview.');
      }

      if (!response.data) {
        throw new Error('Unable to fetch link preview.');
      }

      return normalizePreviewResult(rawUrl, response.data);
    },
  };
}

export function createLocalLinkPreviewClient(): LinkPreviewClient {
  return {
    async fetchPreview(rawUrl: string) {
      const url = normalizeResearchLinkUrl(rawUrl);
      const domain = deriveLinkDomain(url);

      return {
        url,
        title: domain,
        domain,
        imageUrl: undefined,
      };
    },
  };
}

export function createAppLinkPreviewClient(): LinkPreviewClient {
  if (import.meta.env.VITE_TRIP_STORAGE === 'e2e-local') {
    return createLocalLinkPreviewClient();
  }

  return createSupabaseLinkPreviewClient(createBrowserSupabaseClient());
}
```

- [x] **Step 4: Run client tests**

Run:

```bash
npm test -- src/services/linkPreviewClient.test.ts
```

Expected: all tests pass.

- [x] **Step 5: Commit preview client**

Run:

```bash
git add src/storage/supabaseClient.ts src/services/linkPreviewClient.ts src/services/linkPreviewClient.test.ts
git commit -m "Add link preview client"
```

---

### Task 4: Shared Link Preview Grid Component

**Files:**
- Create: `src/components/LinkPreviewGrid.tsx`
- Test: `src/components/LinkPreviewGrid.test.tsx`
- Modify: `src/styles.css`

- [x] **Step 1: Write failing component tests**

Create `src/components/LinkPreviewGrid.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ResearchLink } from '../domain/types';
import type { LinkPreviewClient } from '../services/linkPreviewClient';
import { LinkPreviewGrid } from './LinkPreviewGrid';

function createLink(overrides: Partial<ResearchLink> = {}): ResearchLink {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    title: overrides.title ?? 'Dinner menu',
    url: overrides.url ?? 'https://restaurant.example/menu',
    domain: overrides.domain ?? 'restaurant.example',
    imageUrl: overrides.imageUrl,
    sortOrder: overrides.sortOrder ?? 0,
    previewFetchedAt: overrides.previewFetchedAt,
  };
}

function createPreviewClient(
  implementation: LinkPreviewClient['fetchPreview'] = async (url) => ({
    url: `https://${url.replace(/^https?:\/\//, '')}`,
    title: 'Fetched title',
    domain: 'example.com',
    imageUrl: 'https://example.com/og.jpg',
  }),
): LinkPreviewClient {
  return {
    fetchPreview: vi.fn(implementation),
  };
}

describe('LinkPreviewGrid', () => {
  it('renders image-led link cards with anchors and delete buttons', () => {
    const links = [
      createLink({
        id: 'link-1',
        title: 'Dinner menu',
        domain: 'restaurant.example',
        imageUrl: 'https://restaurant.example/menu.jpg',
      }),
      createLink({
        id: 'link-2',
        title: 'Museum tickets',
        url: 'https://museum.example/tickets',
        domain: 'museum.example',
        sortOrder: 1,
      }),
    ];

    render(
      <LinkPreviewGrid
        label="Links"
        links={links}
        previewClient={createPreviewClient()}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('group', { name: 'Links' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Dinner menu restaurant.example' })).toHaveAttribute(
      'href',
      'https://restaurant.example/menu',
    );
    expect(screen.getByRole('button', { name: 'Delete Dinner menu link' })).toBeInTheDocument();
    expect(screen.getByText('Museum tickets')).toBeInTheDocument();
  });

  it('adds a fetched preview link', async () => {
    const onChange = vi.fn();
    const previewClient = createPreviewClient();

    render(
      <LinkPreviewGrid
        label="Links"
        links={[]}
        previewClient={previewClient}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText('Add link URL'), { target: { value: 'example.com/page' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Add link' }));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(previewClient.fetchPreview).toHaveBeenCalledWith('example.com/page');
    expect(onChange.mock.calls[0][0][0]).toMatchObject({
      title: 'Fetched title',
      url: 'https://example.com/page',
      domain: 'example.com',
      imageUrl: 'https://example.com/og.jpg',
      sortOrder: 0,
    });
  });

  it('falls back to a generated domain card when preview fetching fails', async () => {
    const onChange = vi.fn();
    const previewClient = createPreviewClient(async () => {
      throw new Error('Preview failed');
    });

    render(
      <LinkPreviewGrid
        label="Links"
        links={[]}
        previewClient={previewClient}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText('Add link URL'), { target: { value: 'example.com/page' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Add link' }));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(onChange.mock.calls[0][0][0]).toMatchObject({
      title: 'example.com',
      url: 'https://example.com/page',
      domain: 'example.com',
      imageUrl: undefined,
    });
  });

  it('shows an inline validation error for invalid URLs', async () => {
    const onChange = vi.fn();

    render(
      <LinkPreviewGrid
        label="Links"
        links={[]}
        previewClient={createPreviewClient()}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText('Add link URL'), { target: { value: 'ftp://example.com/file' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Add link' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Links must use http or https.');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('deletes and reorders links through callbacks', () => {
    const onChange = vi.fn();
    const first = createLink({ id: 'first', title: 'First', domain: 'first.example', sortOrder: 0 });
    const second = createLink({ id: 'second', title: 'Second', domain: 'second.example', sortOrder: 1 });

    render(
      <LinkPreviewGrid
        label="Links"
        links={[first, second]}
        previewClient={createPreviewClient()}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete First link' }));
    expect(onChange.mock.calls[0][0]).toEqual([second]);

    const firstCard = screen.getByTestId('link-preview-card-first');
    const secondCard = screen.getByTestId('link-preview-card-second');
    fireEvent.dragStart(firstCard);
    fireEvent.dragOver(secondCard);
    fireEvent.drop(secondCard);

    expect(onChange.mock.calls[1][0].map((link: ResearchLink) => link.id)).toEqual(['second', 'first']);
  });
});
```

- [x] **Step 2: Run the failing component tests**

Run:

```bash
npm test -- src/components/LinkPreviewGrid.test.tsx
```

Expected: fail because `src/components/LinkPreviewGrid.tsx` does not exist.

- [x] **Step 3: Implement `LinkPreviewGrid`**

Create `src/components/LinkPreviewGrid.tsx`:

```tsx
import { Trash2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import {
  createFallbackResearchLink,
  normalizeResearchLinkUrl,
  reorderResearchLinks,
  sortResearchLinks,
} from '../domain/researchLinks';
import type { ResearchLink } from '../domain/types';
import type { LinkPreviewClient } from '../services/linkPreviewClient';

type LinkPreviewGridProps = {
  label: string;
  links: ResearchLink[];
  previewClient: LinkPreviewClient;
  onChange: (links: ResearchLink[]) => Promise<void> | void;
};

export function LinkPreviewGrid({ label, links, previewClient, onChange }: LinkPreviewGridProps) {
  const orderedLinks = useMemo(() => sortResearchLinks(links), [links]);
  const [urlInput, setUrlInput] = useState('');
  const [error, setError] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const draggedLinkIdRef = useRef<string | null>(null);

  async function addLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    let normalizedUrl = '';
    try {
      normalizedUrl = normalizeResearchLinkUrl(urlInput);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Enter a valid URL.');
      return;
    }

    const nextSortOrder =
      orderedLinks.reduce((maxSortOrder, link) => Math.max(maxSortOrder, link.sortOrder), -1) + 1;

    setIsAdding(true);
    try {
      const preview = await previewClient.fetchPreview(urlInput);
      await Promise.resolve(onChange([
        ...orderedLinks,
        {
          id: crypto.randomUUID(),
          url: normalizeResearchLinkUrl(preview.url || normalizedUrl),
          title: preview.title || preview.domain,
          domain: preview.domain,
          imageUrl: preview.imageUrl,
          sortOrder: nextSortOrder,
          previewFetchedAt: new Date().toISOString(),
        },
      ]));
      setUrlInput('');
    } catch {
      await Promise.resolve(onChange([
        ...orderedLinks,
        createFallbackResearchLink(normalizedUrl, { sortOrder: nextSortOrder }),
      ]));
      setUrlInput('');
    } finally {
      setIsAdding(false);
    }
  }

  function deleteLink(linkId: string) {
    void Promise.resolve(onChange(
      orderedLinks
        .filter((link) => link.id !== linkId)
        .map((link, sortOrder) => ({ ...link, sortOrder })),
    ));
  }

  function moveLink(linkId: string, direction: -1 | 1) {
    const currentIndex = orderedLinks.findIndex((link) => link.id === linkId);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= orderedLinks.length) return;

    const nextLinks = [...orderedLinks];
    const [moved] = nextLinks.splice(currentIndex, 1);
    nextLinks.splice(targetIndex, 0, moved);
    void Promise.resolve(onChange(nextLinks.map((link, sortOrder) => ({ ...link, sortOrder }))));
  }

  function dropOnLink(targetLinkId: string) {
    const draggedLinkId = draggedLinkIdRef.current;
    draggedLinkIdRef.current = null;
    if (!draggedLinkId || draggedLinkId === targetLinkId) return;

    const targetIds = orderedLinks.map((link) => link.id).filter((linkId) => linkId !== draggedLinkId);
    const targetIndex = targetIds.indexOf(targetLinkId);
    targetIds.splice(targetIndex, 0, draggedLinkId);
    void Promise.resolve(onChange(reorderResearchLinks(orderedLinks, targetIds)));
  }

  return (
    <section className="link-preview-section" aria-label={label}>
      <div className="link-preview-section__header">
        <h2>{label}</h2>
      </div>
      <div className="link-preview-grid">
        {orderedLinks.map((link) => (
          <article
            key={link.id}
            className="link-preview-card"
            data-testid={`link-preview-card-${link.id}`}
            draggable
            onDragStart={() => {
              draggedLinkIdRef.current = link.id;
            }}
            onDragOver={(event) => {
              event.preventDefault();
            }}
            onDrop={() => dropOnLink(link.id)}
          >
            <a
              className="link-preview-card__anchor"
              href={link.url}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open ${link.title} ${link.domain}`}
            >
              <span
                className="link-preview-card__image"
                style={link.imageUrl ? { backgroundImage: `url(${link.imageUrl})` } : undefined}
                aria-hidden="true"
              >
                {link.imageUrl ? null : <span>{link.domain.slice(0, 1).toUpperCase()}</span>}
              </span>
              <span className="link-preview-card__body">
                <span className="link-preview-card__title">{link.title}</span>
                <span className="link-preview-card__domain">{link.domain}</span>
              </span>
            </a>
            <button
              type="button"
              className="link-preview-card__delete"
              aria-label={`Delete ${link.title} link`}
              onClick={() => deleteLink(link.id)}
            >
              <Trash2 size={15} aria-hidden="true" />
            </button>
            <div className="link-preview-card__keyboard-actions">
              <button type="button" onClick={() => moveLink(link.id, -1)}>Move up</button>
              <button type="button" onClick={() => moveLink(link.id, 1)}>Move down</button>
            </div>
          </article>
        ))}
      </div>
      <form className="link-preview-add" aria-label="Add link" onSubmit={addLink}>
        <input
          aria-label="Add link URL"
          placeholder="Add link"
          value={urlInput}
          onChange={(event) => setUrlInput(event.target.value)}
          disabled={isAdding}
        />
        <button type="submit" disabled={isAdding}>+</button>
      </form>
      {error ? <p className="link-preview-error" role="alert">{error}</p> : null}
    </section>
  );
}
```

- [x] **Step 4: Add link preview CSS**

Append to `src/styles.css`:

```css
.link-preview-section {
  display: grid;
  gap: 10px;
  min-width: 0;
}

.link-preview-section__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.link-preview-section__header h2 {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.92rem;
}

.link-preview-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.link-preview-card {
  position: relative;
  min-width: 0;
  border: 1px solid var(--border-control);
  border-radius: 8px;
  overflow: hidden;
  background: var(--surface-panel);
  cursor: grab;
}

.link-preview-card:active {
  cursor: grabbing;
}

.link-preview-card:hover,
.link-preview-card:focus-within {
  border-color: var(--border-selected);
  box-shadow: 0 8px 24px rgb(var(--color-text-rgb) / 0.09);
}

.link-preview-card__anchor {
  display: grid;
  color: inherit;
  text-decoration: none;
}

.link-preview-card__image {
  display: grid;
  place-items: center;
  aspect-ratio: 16 / 9;
  background-color: rgb(var(--color-accent-rgb) / 0.12);
  background-image: linear-gradient(135deg, rgb(var(--color-accent-rgb) / 0.18), rgb(var(--color-route-rgb) / 0.12));
  background-position: center;
  background-size: cover;
  color: var(--color-accent-strong);
  font-size: 1.4rem;
  font-weight: 900;
}

.link-preview-card__body {
  display: grid;
  gap: 4px;
  padding: 9px 10px 10px;
}

.link-preview-card__title,
.link-preview-card__domain {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.link-preview-card__title {
  color: var(--color-text);
  font-size: 0.86rem;
  font-weight: 850;
}

.link-preview-card__domain {
  color: var(--text-secondary);
  font-size: 0.74rem;
}

.link-preview-card__delete {
  position: absolute;
  top: 7px;
  right: 7px;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 1px solid rgb(var(--color-text-rgb) / 0.18);
  border-radius: 7px;
  color: var(--color-text);
  background: rgb(var(--surface-panel-rgb) / 0.88);
}

.link-preview-card__keyboard-actions {
  display: none;
  gap: 6px;
  padding: 0 10px 10px;
}

.link-preview-card:focus-within .link-preview-card__keyboard-actions {
  display: flex;
}

.link-preview-card__keyboard-actions button,
.link-preview-add button {
  border: 1px solid var(--border-control);
  border-radius: var(--radius-control);
  color: var(--color-text);
  background: var(--surface-control);
}

.link-preview-add {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 42px;
  gap: 8px;
}

.link-preview-error {
  margin: 0;
  color: var(--color-danger);
  font-size: 0.78rem;
  font-weight: 800;
}

@media (max-width: 560px) {
  .link-preview-grid {
    grid-template-columns: 1fr;
  }
}
```

- [x] **Step 5: Run component tests**

Run:

```bash
npm test -- src/components/LinkPreviewGrid.test.tsx
```

Expected: all tests pass.

- [x] **Step 6: Commit the shared component**

Run:

```bash
git add src/components/LinkPreviewGrid.tsx src/components/LinkPreviewGrid.test.tsx src/styles.css
git commit -m "Add shared link preview grid"
```

---

### Task 5: Stop Panel Link Integration

**Files:**
- Modify: `src/components/DestinationProfile.tsx`
- Modify: `src/components/DestinationProfile.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

- [x] **Step 1: Write failing stop panel tests**

Add tests to `src/components/DestinationProfile.test.tsx`:

```tsx
it('renders stop research links and saves added links without overwriting research notes', async () => {
  setupAutosaveTimers();
  const destination: Destination = {
    ...createDestination({
      name: 'Paris',
      coordinates: { lat: 48.8566, lng: 2.3522 },
    }),
    research: {
      notes: 'Keep this research note.',
      links: [{
        id: 'menu-link',
        title: 'Dinner menu',
        url: 'https://restaurant.example/menu',
        domain: 'restaurant.example',
        imageUrl: 'https://restaurant.example/menu.jpg',
        sortOrder: 0,
      }],
      bookReferences: [],
    },
  };
  const onUpdate = vi.fn();
  const previewClient = {
    fetchPreview: vi.fn(async () => ({
      url: 'https://museum.example/tickets',
      title: 'Museum tickets',
      domain: 'museum.example',
      imageUrl: 'https://museum.example/og.jpg',
    })),
  };

  render(
    <DestinationProfile
      {...defaultMediaProps}
      destination={destination}
      linkPreviewClient={previewClient}
      onUpdate={onUpdate}
      onClose={vi.fn()}
    />,
  );

  expect(screen.getByRole('link', { name: 'Open Dinner menu restaurant.example' })).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('Add link URL'), { target: { value: 'museum.example/tickets' } });
  fireEvent.submit(screen.getByRole('form', { name: 'Add link' }));

  await waitFor(() => expect(onUpdate).toHaveBeenCalled());
  expect(onUpdate).toHaveBeenCalledWith(
    destination.id,
    expect.objectContaining({
      research: {
        notes: 'Keep this research note.',
        bookReferences: [],
        links: [
          destination.research.links[0],
          expect.objectContaining({
            title: 'Museum tickets',
            url: 'https://museum.example/tickets',
            domain: 'museum.example',
            sortOrder: 1,
          }),
        ],
      },
    }),
  );
});
```

- [x] **Step 2: Run the failing stop panel test**

Run:

```bash
npm test -- src/components/DestinationProfile.test.tsx
```

Expected: fail because `DestinationProfile` does not accept `linkPreviewClient`.

- [x] **Step 3: Add stop links to `DestinationProfile` props and state**

Modify imports in `src/components/DestinationProfile.tsx`:

```ts
import type { Activity, Destination, MediaItem, MediaRollupItem, ResearchLink } from '../domain/types';
import type { LinkPreviewClient } from '../services/linkPreviewClient';
import { LinkPreviewGrid } from './LinkPreviewGrid';
```

Extend `DestinationFormState`:

```ts
type DestinationFormState = {
  sourceKey: string;
  name: string;
  expectedStayDays: string;
  tags: string[];
  tagInput: string;
  links: ResearchLink[];
};
```

Extend props:

```ts
linkPreviewClient: LinkPreviewClient;
```

Update `createFormState`:

```ts
const createFormState = (destination: Destination): DestinationFormState => ({
  sourceKey: destinationSourceKey(destination),
  name: destination.name,
  expectedStayDays: String(destination.timing.expectedStayDays),
  tags: destination.tags,
  tagInput: '',
  links: destination.research.links,
});
```

Update `createPatchFromForm`:

```ts
const links = form.links;
const hasChanges =
  name !== destination.name ||
  expectedStayDays !== destination.timing.expectedStayDays ||
  !listsMatch(tags, destination.tags) ||
  JSON.stringify(links) !== JSON.stringify(destination.research.links);
```

Include `research` only when links changed:

```ts
return {
  name,
  location: destination.location,
  timing: {
    ...destination.timing,
    expectedStayDays,
  },
  tags,
  ...(JSON.stringify(links) === JSON.stringify(destination.research.links)
    ? {}
    : {
        research: {
          ...destination.research,
          links,
        },
      }),
};
```

Pass `linkPreviewClient` through `DestinationProfile` to `DestinationProfileForm`.

- [x] **Step 4: Render stop links**

In `DestinationProfileForm`, insert the grid after the tag editor and before `ActivityList`:

```tsx
<LinkPreviewGrid
  label="Links"
  links={form.links}
  previewClient={linkPreviewClient}
  onChange={(links) => updateForm({ links })}
/>
```

- [x] **Step 5: Wire the app preview client**

Modify `src/App.tsx` imports:

```ts
import { createAppLinkPreviewClient } from './services/linkPreviewClient';
import type { LinkPreviewClient } from './services/linkPreviewClient';
```

Create state next to repository state:

```ts
const [linkPreviewClient, setLinkPreviewClient] = useState<LinkPreviewClient | null>(null);
```

During app initialization, set both:

```ts
Promise.all([
  createAppTripRepository(),
  Promise.resolve(createAppLinkPreviewClient()),
])
  .then(([nextRepository, nextLinkPreviewClient]) => {
    if (isCancelled) return;
    setRepository(nextRepository);
    setLinkPreviewClient(nextLinkPreviewClient);
  })
```

Render the workspace only when both are present:

```tsx
{repository && linkPreviewClient ? (
  <TripWorkspace repository={repository} linkPreviewClient={linkPreviewClient} />
) : null}
```

Extend `TripWorkspace`:

```ts
function TripWorkspace({
  repository,
  linkPreviewClient,
}: {
  repository: TripRepository;
  linkPreviewClient: LinkPreviewClient;
}) {
```

Pass `linkPreviewClient` into `DestinationProfile`.

- [x] **Step 6: Update App tests with a mock preview client**

In `src/App.test.tsx`, mock `createAppLinkPreviewClient`:

```ts
vi.mock('./services/linkPreviewClient', () => ({
  createAppLinkPreviewClient: vi.fn(() => ({
    fetchPreview: vi.fn(async (url: string) => ({
      url,
      title: 'Preview title',
      domain: 'example.com',
      imageUrl: undefined,
    })),
  })),
}));
```

- [x] **Step 7: Run stop integration tests**

Run:

```bash
npm test -- src/components/DestinationProfile.test.tsx src/App.test.tsx
```

Expected: all listed test files pass.

- [x] **Step 8: Commit stop link integration**

Run:

```bash
git add src/components/DestinationProfile.tsx src/components/DestinationProfile.test.tsx src/App.tsx src/App.test.tsx
git commit -m "Add stop link previews"
```

---

### Task 6: Activity Panel Link Integration

**Files:**
- Modify: `src/components/ActivityPanel.tsx`
- Modify: `src/components/ActivityPanel.test.tsx`
- Modify: `src/App.tsx`

- [x] **Step 1: Write failing activity panel tests**

Add tests to `src/components/ActivityPanel.test.tsx`:

```tsx
it('renders activity links and saves added links on the activity', async () => {
  const activity = {
    ...createActivity({
      destinationId: 'destination-1',
      title: 'Louvre',
      order: 0,
    }),
    links: [{
      id: 'louvre-link',
      title: 'Museum tickets',
      url: 'https://louvre.example/tickets',
      domain: 'louvre.example',
      imageUrl: 'https://louvre.example/og.jpg',
      sortOrder: 0,
    }],
  };
  const onUpdateActivity = vi.fn();
  const linkPreviewClient = {
    fetchPreview: vi.fn(async () => ({
      url: 'https://restaurant.example/menu',
      title: 'Dinner menu',
      domain: 'restaurant.example',
      imageUrl: 'https://restaurant.example/menu.jpg',
    })),
  };

  render(
    <ActivityPanel
      {...createProps({ activity, onUpdateActivity, linkPreviewClient })}
    />,
  );

  expect(screen.getByRole('link', { name: 'Open Museum tickets louvre.example' })).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('Add link URL'), { target: { value: 'restaurant.example/menu' } });
  fireEvent.submit(screen.getByRole('form', { name: 'Add link' }));

  await waitFor(() => expect(onUpdateActivity).toHaveBeenCalled());
  expect(onUpdateActivity).toHaveBeenCalledWith(activity.id, {
    links: [
      activity.links[0],
      expect.objectContaining({
        title: 'Dinner menu',
        url: 'https://restaurant.example/menu',
        domain: 'restaurant.example',
        sortOrder: 1,
      }),
    ],
  });
});
```

- [x] **Step 2: Run the failing activity panel tests**

Run:

```bash
npm test -- src/components/ActivityPanel.test.tsx
```

Expected: fail because `ActivityPanel` does not accept `linkPreviewClient` and cannot update `links`.

- [x] **Step 3: Add links to `ActivityPanel` draft handling**

Modify imports in `src/components/ActivityPanel.tsx`:

```ts
import type { Activity, MediaItem } from '../domain/types';
import type { LinkPreviewClient } from '../services/linkPreviewClient';
import { LinkPreviewGrid } from './LinkPreviewGrid';
```

Extend props:

```ts
linkPreviewClient: LinkPreviewClient;
onUpdateActivity: (
  activityId: string,
  patch: Partial<Pick<Activity, 'title' | 'description' | 'notes' | 'tags' | 'links'>>,
) => Promise<void> | void;
```

Extend draft:

```ts
type ActivityDraft = Pick<Activity, 'title' | 'description' | 'notes' | 'tags' | 'links'>;
```

Update `createActivityDraft`:

```ts
function createActivityDraft(activity: Activity): ActivityDraft {
  return {
    title: activity.title,
    description: activity.description,
    notes: activity.notes,
    tags: activity.tags,
    links: activity.links,
  };
}
```

Add `links` to both revision refs:

```ts
links: 0,
```

Read `activityLinks`:

```ts
const activityLinks = activity.links;
```

Update the sync effect to preserve or accept `links`:

```ts
if (!shouldPreserveDraft('links', activityLinks)) acceptPersistedField('links');

const nextDraft = {
  title: dirtyFieldsRef.current.has('title') ? current.title : activityTitle,
  description: dirtyFieldsRef.current.has('description') ? current.description : activityDescription,
  notes: dirtyFieldsRef.current.has('notes') ? current.notes : activityNotes,
  tags: dirtyFieldsRef.current.has('tags') ? current.tags : activityTags,
  links: dirtyFieldsRef.current.has('links') ? current.links : activityLinks,
};
```

Add `activityLinks` to the dependency list.

- [x] **Step 4: Render activity links**

Insert after the activity tag editor:

```tsx
<LinkPreviewGrid
  label="Links"
  links={draft.links}
  previewClient={linkPreviewClient}
  onChange={(links) => {
    updateDraft('links', links);
    void commitDraft('links');
  }}
/>
```

- [x] **Step 5: Pass the preview client from App**

In `src/App.tsx`, pass `linkPreviewClient` into `ActivityPanel`:

```tsx
<ActivityPanel
  ...
  linkPreviewClient={linkPreviewClient}
/>
```

- [x] **Step 6: Run activity integration tests**

Run:

```bash
npm test -- src/components/ActivityPanel.test.tsx src/App.test.tsx
```

Expected: all listed test files pass.

- [x] **Step 7: Commit activity link integration**

Run:

```bash
git add src/components/ActivityPanel.tsx src/components/ActivityPanel.test.tsx src/App.tsx
git commit -m "Add activity link previews"
```

---

### Task 7: Persistence, Repository, And Legacy Link Guards

**Files:**
- Modify: `src/storage/tripRepository.ts`
- Modify: `src/storage/tripRepository.test.ts`
- Modify: `src/storage/supabaseTripRepository.ts`
- Modify: `src/storage/supabaseTripRepository.test.ts`
- Modify: `src/hooks/useTripData.test.tsx`

- [x] **Step 1: Add repository tests for rich link JSON**

Add to `src/storage/tripRepository.test.ts`:

```ts
it('persists destination research links with preview metadata', async () => {
  const repository = createRepository();
  const destination = createDestination({
    name: 'Paris',
    coordinates: { lat: 48.8566, lng: 2.3522 },
  });
  const link = {
    id: 'link-1',
    title: 'Dinner menu',
    url: 'https://restaurant.example/menu',
    domain: 'restaurant.example',
    imageUrl: 'https://restaurant.example/menu.jpg',
    sortOrder: 0,
    previewFetchedAt: '2026-07-04T12:00:00.000Z',
  };

  await repository.saveDestination({
    ...destination,
    research: {
      ...destination.research,
      links: [link],
    },
  });

  await expect(repository.listDestinations()).resolves.toEqual([
    expect.objectContaining({
      research: expect.objectContaining({
        links: [link],
      }),
    }),
  ]);
});
```

Add to `src/storage/supabaseTripRepository.test.ts` in the activity update area:

```ts
it('updates activity links with preview metadata', async () => {
  const supabase = createSupabaseMock();
  const repository = createSupabaseTripRepository(supabase as never);
  const activityId = crypto.randomUUID();
  const links = [{
    id: 'link-1',
    title: 'Dinner menu',
    url: 'https://restaurant.example/menu',
    domain: 'restaurant.example',
    imageUrl: 'https://restaurant.example/menu.jpg',
    sortOrder: 0,
    previewFetchedAt: '2026-07-04T12:00:00.000Z',
  }];

  await repository.updateActivity(activityId, { links });

  expect(supabase.from).toHaveBeenCalledWith('activities');
  expect(supabase.updatePayload).toMatchObject({ links });
});
```

- [x] **Step 2: Run persistence tests**

Run:

```bash
npm test -- src/storage/tripRepository.test.ts src/storage/supabaseTripRepository.test.ts src/hooks/useTripData.test.tsx
```

Expected: failures identify any mocks or type fixtures that still create `ResearchLink` without `domain` and `sortOrder`.

- [x] **Step 3: Update fixtures and normalize repository reads**

In `src/storage/tripRepository.ts`, import helper:

```ts
import { sortResearchLinks } from '../domain/researchLinks';
```

Normalize destination research links in `normalizeDestination`:

```ts
research: {
  ...destination.research,
  links: sortResearchLinks(destination.research?.links ?? []),
  bookReferences: destination.research?.bookReferences ?? [],
  notes: destination.research?.notes ?? '',
},
```

In `src/storage/supabaseTripRepository.ts`, import helper:

```ts
import { sortResearchLinks } from '../domain/researchLinks';
```

Normalize destination links in `destinationFromSupabaseRow`:

```ts
research: {
  ...row.research,
  links: sortResearchLinks(row.research?.links ?? []),
  notes: row.research?.notes ?? '',
  bookReferences: row.research?.bookReferences ?? [],
},
```

Normalize activity links in `activityFromSupabaseRow`:

```ts
links: sortResearchLinks(row.links ?? []),
```

Update any test fixtures that intentionally create link objects so they include:

```ts
domain: 'example.com',
sortOrder: 0,
```

- [x] **Step 4: Run persistence tests again**

Run:

```bash
npm test -- src/storage/tripRepository.test.ts src/storage/supabaseTripRepository.test.ts src/hooks/useTripData.test.tsx
```

Expected: all listed test files pass.

- [x] **Step 5: Commit persistence guards**

Run:

```bash
git add src/storage/tripRepository.ts src/storage/tripRepository.test.ts src/storage/supabaseTripRepository.ts src/storage/supabaseTripRepository.test.ts src/hooks/useTripData.test.tsx
git commit -m "Normalize persisted research links"
```

---

### Task 8: Focused E2E And Render Verification

**Files:**
- Create: `tests/e2e/link-previews.spec.ts`

- [x] **Step 1: Write focused e2e coverage**

Create `tests/e2e/link-previews.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

test('adds and reorders stop link preview cards', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('button', { name: 'Home' })).toBeVisible();
  await page.getByRole('button', { name: 'Home' }).click();

  await page.getByLabel('Add link URL').fill('example.com/menu');
  await page.getByRole('form', { name: 'Add link' }).getByRole('button').click();

  await expect(page.getByRole('link', { name: 'Open example.com example.com' })).toBeVisible();
  await expect(page.getByTestId(/link-preview-card-/)).toHaveCount(1);
});
```

Use the existing e2e-local preview client. It produces fallback cards without Supabase network access.

- [x] **Step 2: Run the focused e2e test**

Run:

```bash
npm run test:e2e -- tests/e2e/link-previews.spec.ts
```

Expected: the e2e test passes.

- [x] **Step 3: Run unit and build verification**

Run:

```bash
npm test -- src/domain/researchLinks.test.ts src/services/linkPreviewClient.test.ts src/components/LinkPreviewGrid.test.tsx src/components/DestinationProfile.test.tsx src/components/ActivityPanel.test.tsx
npm run build
```

Expected: both commands pass.

- [x] **Step 4: Verify rendered app in the browser**

Start the app:

```bash
npm run dev
```

Open the local app, select a stop, add a link, and confirm:

- the link card appears in a two-column grid at desktop panel width
- the card has no diagonal arrow, edit button, open button, category, note, or drag handle
- the delete button is the only visible per-card action
- clicking the card opens the link in a new tab
- dragging the card itself changes order when at least two cards exist

- [x] **Step 5: Commit final verification coverage**

## Implementation Status

Completed across the link-preview client/function/component work now present in `src/services/linkPreviewClient.ts`, `supabase/functions/link-preview/`, `src/components/LinkPreviewGrid.tsx`, and `tests/link-previews.spec.ts`, with final visible coverage committed in `a0322af Add link preview e2e coverage`.

Run:

```bash
git add tests/e2e/link-previews.spec.ts
git commit -m "Add link preview e2e coverage"
```

---

## Final Verification

Run:

```bash
npm test
npm run build
npm run test:e2e -- tests/e2e/link-previews.spec.ts
deno test --allow-net=deno.land supabase/functions/link-preview/metadata.test.ts
git status --short
```

Expected:

- all Vitest tests pass
- build passes
- focused Playwright test passes
- Deno Edge Function tests pass
- `git status --short` contains no implementation changes except unrelated user work that existed before execution

## Self-Review Notes

- Spec coverage: the plan covers shared stop/activity UI, two-column image-led cards, click-to-open, drag-to-reorder, delete-only card actions, server-side fetch, persisted preview snapshots, fallback visuals, legacy JSON guards, and focused e2e coverage.
- Scope: the plan does not add categories, notes, edit controls, preview-image caching, or a database migration.
- Type consistency: `ResearchLink`, `LinkPreviewResult`, and `LinkPreviewClient` use the same `url`, `title`, `domain`, `imageUrl`, `sortOrder`, and `previewFetchedAt` names throughout.
