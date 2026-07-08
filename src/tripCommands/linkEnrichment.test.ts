import { describe, expect, it, vi } from 'vitest';
import { createLinkEnricher } from './linkEnrichment';

describe('createLinkEnricher', () => {
  it('uses preview metadata when available', async () => {
    const previewClient = {
      fetchPreview: vi.fn(async () => ({
        title: 'Alnwick Castle',
        url: 'https://www.alnwickcastle.com/',
        domain: 'alnwickcastle.com',
        imageUrl: 'https://www.alnwickcastle.com/preview.jpg',
      })),
    };
    const link = await createLinkEnricher(previewClient)('www.alnwickcastle.com', 2);
    expect(link).toMatchObject({
      title: 'Alnwick Castle',
      url: 'https://www.alnwickcastle.com/',
      domain: 'alnwickcastle.com',
      imageUrl: 'https://www.alnwickcastle.com/preview.jpg',
      sortOrder: 2,
    });
    expect(link.id).toEqual(expect.any(String));
  });

  it('falls back to a domain link when preview fails', async () => {
    const previewClient = {
      fetchPreview: vi.fn(async () => {
        throw new Error('Preview failed');
      }),
    };
    const link = await createLinkEnricher(previewClient)('https://northcoastseatours.co.uk/', 0);
    expect(link).toMatchObject({
      title: 'northcoastseatours.co.uk',
      domain: 'northcoastseatours.co.uk',
      sortOrder: 0,
    });
  });
});
