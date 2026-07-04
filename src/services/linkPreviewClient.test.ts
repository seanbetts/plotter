import { describe, expect, it, vi } from 'vitest';
import { createLocalLinkPreviewClient, createSupabaseLinkPreviewClient } from './linkPreviewClient';

describe('linkPreviewClient', () => {
  it('fetches previews through the Supabase Edge Function and normalizes response data', async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: {
        url: ' example.com/menu ',
        title: 'Example Menu',
        domain: 'menus.example',
        imageUrl: 'https://example.com/preview.jpg',
      },
      error: null,
    });
    const client = createSupabaseLinkPreviewClient({ functions: { invoke } });

    await expect(client.fetchPreview('example.com/menu')).resolves.toEqual({
      url: 'https://example.com/menu',
      title: 'Example Menu',
      domain: 'menus.example',
      imageUrl: 'https://example.com/preview.jpg',
    });
    expect(invoke).toHaveBeenCalledWith('link-preview', {
      body: { url: 'example.com/menu' },
    });
  });

  it('uses the returned domain as the title fallback when the title is blank', async () => {
    const client = createSupabaseLinkPreviewClient({
      functions: {
        invoke: vi.fn().mockResolvedValue({
          data: {
            url: 'https://example.com/menu',
            title: '   ',
            domain: 'menus.example',
          },
          error: null,
        }),
      },
    });

    await expect(client.fetchPreview('example.com/menu')).resolves.toEqual({
      url: 'https://example.com/menu',
      title: 'menus.example',
      domain: 'menus.example',
      imageUrl: undefined,
    });
  });

  it('throws the Edge Function error message when preview fetching fails', async () => {
    const client = createSupabaseLinkPreviewClient({
      functions: {
        invoke: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'Enter a public URL.' },
        }),
      },
    });

    await expect(client.fetchPreview('localhost:5173')).rejects.toThrow('Enter a public URL.');
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
