import { deriveLinkDomain, normalizeResearchLinkUrl } from '../domain/researchLinks';
import { createPlotterApiClient, type PlotterApiClient } from '../api/client';

export type LinkPreviewResult = {
  url: string;
  title: string;
  domain: string;
  imageUrl?: string;
};

export type LinkPreviewClient = {
  fetchPreview(rawUrl: string): Promise<LinkPreviewResult>;
};

type LinkPreviewFunctionData = {
  url?: string | null;
  title?: string | null;
  domain?: string | null;
  imageUrl?: string | null;
};

const fallbackErrorMessage = 'Unable to fetch link preview.';

function normalizePreviewData(data: LinkPreviewFunctionData): LinkPreviewResult {
  if (!data.url) {
    throw new Error(fallbackErrorMessage);
  }

  const url = normalizeResearchLinkUrl(data.url);
  const domain = data.domain?.trim() || deriveLinkDomain(url);
  const title = data.title?.trim() || domain;

  return {
    url,
    title,
    domain,
    imageUrl: data.imageUrl || undefined,
  };
}

export function createHttpLinkPreviewClient(client: Pick<PlotterApiClient, 'request'>): LinkPreviewClient {
  return {
    async fetchPreview(rawUrl) {
      const response = await client.request<{ preview?: LinkPreviewFunctionData }>('/api/v1/link-preview', {
        method: 'POST',
        body: JSON.stringify({ url: rawUrl }),
      });
      if (!response.preview) {
        throw new Error(fallbackErrorMessage);
      }
      return normalizePreviewData(response.preview);
    },
  };
}

export function createLocalLinkPreviewClient(): LinkPreviewClient {
  return {
    async fetchPreview(rawUrl) {
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

  return createHttpLinkPreviewClient(createPlotterApiClient({ baseUrl: import.meta.env.BASE_URL }));
}
