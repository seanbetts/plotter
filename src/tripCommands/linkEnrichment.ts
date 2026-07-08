import {
  createFallbackResearchLink,
  deriveLinkDomain,
  normalizeResearchLinkUrl,
} from '../domain/researchLinks';
import type { ResearchLink } from '../domain/types';
import type { LinkPreviewClient } from '../services/linkPreviewClient';
import type { LinkEnricher } from './types';

export function createLinkEnricher(previewClient?: LinkPreviewClient): LinkEnricher {
  return async (rawUrl: string, sortOrder: number): Promise<ResearchLink> => {
    const normalizedUrl = normalizeResearchLinkUrl(rawUrl);

    if (!previewClient) {
      return createFallbackResearchLink(normalizedUrl, { sortOrder });
    }

    try {
      const preview = await previewClient.fetchPreview(normalizedUrl);
      const previewUrl = normalizeResearchLinkUrl(preview.url);
      const domain = preview.domain.trim() || deriveLinkDomain(previewUrl);

      return {
        id: crypto.randomUUID(),
        title: preview.title.trim() || domain,
        url: previewUrl,
        domain,
        ...(preview.imageUrl ? { imageUrl: preview.imageUrl } : {}),
        sortOrder,
        previewFetchedAt: new Date().toISOString(),
      };
    } catch {
      return createFallbackResearchLink(normalizedUrl, { sortOrder });
    }
  };
}
