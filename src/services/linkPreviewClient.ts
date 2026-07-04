import { deriveLinkDomain, normalizeResearchLinkUrl } from '../domain/researchLinks';
import { createBrowserSupabaseClient } from '../storage/supabaseClient';

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

type LinkPreviewFunctionResponse = {
  data?: LinkPreviewFunctionData | null;
  error?: { message?: string } | null;
};

type LinkPreviewSupabaseClient = {
  functions: {
    invoke(
      functionName: 'link-preview',
      options: { body: { url: string } },
    ): Promise<LinkPreviewFunctionResponse>;
  };
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

export function createSupabaseLinkPreviewClient(supabase: LinkPreviewSupabaseClient): LinkPreviewClient {
  return {
    async fetchPreview(rawUrl) {
      const response = await supabase.functions.invoke('link-preview', {
        body: { url: rawUrl },
      });

      if (response.error) {
        throw new Error(response.error.message || fallbackErrorMessage);
      }

      if (!response.data) {
        throw new Error(fallbackErrorMessage);
      }

      return normalizePreviewData(response.data);
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

  return createSupabaseLinkPreviewClient(createBrowserSupabaseClient());
}
