import { afterEach, describe, expect, it, vi } from 'vitest';
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
  afterEach(() => {
    vi.useRealTimers();
  });

  it('normalizes pasted URLs and derives display domains', () => {
    expect(normalizeResearchLinkUrl(' example.com/menu ')).toBe('https://example.com/menu');
    expect(normalizeResearchLinkUrl('http://example.com/a b')).toBe('http://example.com/a%20b');
    expect(deriveLinkDomain('https://www.timeout.com/paris')).toBe('timeout.com');
  });

  it('rejects invalid URLs before preview fetching', () => {
    expect(() => normalizeResearchLinkUrl('ftp://example.com/file')).toThrow(
      'Links must use http or https.',
    );
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

  it.each([
    { id: 42, title: 'Bad ID', url: 'https://example.com' },
    { id: 'bad-order', title: 'Bad order', url: 'https://example.com', sortOrder: 'first' },
    { id: 'bad-image', title: 'Bad image', url: 'https://example.com', imageUrl: 0 },
  ])('rejects malformed saved link fields instead of dropping or deriving them', (link) => {
    expect(() => normalizeResearchLink(link as never, 0)).toThrow('Saved research link is invalid.');
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

    expect(
      reorderResearchLinks([first, second, third], ['third', 'first']).map((link) => ({
        id: link.id,
        sortOrder: link.sortOrder,
      })),
    ).toEqual([
      { id: 'third', sortOrder: 0 },
      { id: 'first', sortOrder: 1 },
      { id: 'second', sortOrder: 2 },
    ]);
  });

  it('sorts links with the same explicit sortOrder by title', () => {
    const zulu: ResearchLink = {
      id: 'zulu',
      title: 'Zulu',
      url: 'https://zulu.example',
      domain: 'zulu.example',
      sortOrder: 1,
    };
    const alpha: ResearchLink = {
      id: 'alpha',
      title: 'Alpha',
      url: 'https://alpha.example',
      domain: 'alpha.example',
      sortOrder: 1,
    };

    expect(sortResearchLinks([zulu, alpha]).map((link) => link.id)).toEqual(['alpha', 'zulu']);
  });
});
