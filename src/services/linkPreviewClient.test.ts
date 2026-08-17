import { describe, expect, it, vi } from 'vitest';
import type { PlotterApiClient } from '../api/client';
import { createHttpLinkPreviewClient, createLocalLinkPreviewClient } from './linkPreviewClient';

describe('linkPreviewClient', () => {
  it('posts preview requests to the shared service route and normalizes response data', async () => {
    const request = vi.fn().mockResolvedValue({
      preview: {
        url: ' example.com/menu ',
        title: 'Example Menu',
        domain: 'menus.example',
        imageUrl: 'https://example.com/preview.jpg',
      },
    });
    const client = createHttpLinkPreviewClient({ request } as Pick<PlotterApiClient, 'request'>);

    await expect(client.fetchPreview('example.com/menu')).resolves.toEqual({
      url: 'https://example.com/menu',
      title: 'Example Menu',
      domain: 'menus.example',
      imageUrl: 'https://example.com/preview.jpg',
    });
    expect(request).toHaveBeenCalledWith('/api/v1/link-preview', {
      method: 'POST',
      body: JSON.stringify({ url: 'example.com/menu' }),
    });
  });

  it('uses the returned domain as the title fallback when the title is blank', async () => {
    const client = createHttpLinkPreviewClient({
      request: vi.fn().mockResolvedValue({
        preview: {
          url: 'https://example.com/menu',
          title: '   ',
          domain: 'menus.example',
        },
      }),
    } as Pick<PlotterApiClient, 'request'>);

    await expect(client.fetchPreview('example.com/menu')).resolves.toEqual({
      url: 'https://example.com/menu',
      title: 'menus.example',
      domain: 'menus.example',
      imageUrl: undefined,
    });
  });

  it('preserves the shared API client error when preview fetching fails', async () => {
    const client = createHttpLinkPreviewClient({
      request: vi.fn().mockRejectedValue(new Error('Enter a public URL.')),
    } as Pick<PlotterApiClient, 'request'>);

    await expect(client.fetchPreview('localhost:5173')).rejects.toThrow('Enter a public URL.');
  });

  it('rejects a service response without a preview', async () => {
    const client = createHttpLinkPreviewClient({
      request: vi.fn().mockResolvedValue({}),
    } as Pick<PlotterApiClient, 'request'>);

    await expect(client.fetchPreview('https://example.com')).rejects.toThrow('Unable to fetch link preview.');
  });

  it('creates deterministic local fallback previews for e2e-local storage', async () => {
    const client = createLocalLinkPreviewClient();

    await expect(client.fetchPreview(' www.timeout.com/paris ')).resolves.toEqual({
      url: 'https://www.timeout.com/paris',
      title: 'timeout.com',
      domain: 'timeout.com',
      imageUrl: undefined,
    });
  });
});
