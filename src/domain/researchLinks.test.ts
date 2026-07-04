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
});
