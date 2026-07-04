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
    sortOrder: typeof link.sortOrder === 'number' && Number.isFinite(link.sortOrder) ? link.sortOrder : index,
    ...(link.imageUrl ? { imageUrl: link.imageUrl } : {}),
    ...(link.previewFetchedAt ? { previewFetchedAt: link.previewFetchedAt } : {}),
  };
}

export function sortResearchLinks(links: LegacyResearchLink[]) {
  return links
    .map((link, index) => ({ link: normalizeResearchLink(link, index), index }))
    .sort(
      (left, right) =>
        left.link.sortOrder - right.link.sortOrder ||
        left.link.title.localeCompare(right.link.title) ||
        left.index - right.index,
    )
    .map(({ link }) => link);
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
