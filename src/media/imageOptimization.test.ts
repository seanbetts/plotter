import { describe, expect, it, vi } from 'vitest';
import {
  getNormalizedImageFileName,
  mediaImageVariants,
  normalizeImageFile,
} from './imageOptimization';

describe('imageOptimization', () => {
  it('defines thumbnail, preview, and full-display transform sizes', () => {
    expect(mediaImageVariants).toEqual({
      thumbnail: { width: 320, height: 220, quality: 70, resize: 'cover' },
      preview: { width: 900, quality: 78, resize: 'contain' },
      full: { width: 2200, quality: 82, resize: 'contain' },
    });
  });

  it('keeps animated GIF uploads untouched', async () => {
    const file = new File(['gif-bytes'], 'animation.gif', { type: 'image/gif' });

    await expect(normalizeImageFile(file)).resolves.toBe(file);
  });

  it('returns the original file when browser image processing APIs are unavailable', async () => {
    const file = new File(['image-bytes'], 'photo.jpg', { type: 'image/jpeg' });

    await expect(normalizeImageFile(file)).resolves.toBe(file);
  });

  it('uses a normalized extension when the output type changes', () => {
    expect(getNormalizedImageFileName('Paris sunset.JPG', 'image/webp')).toBe('Paris sunset.webp');
    expect(getNormalizedImageFileName('photo', 'image/jpeg')).toBe('photo.jpg');
  });

  it('resizes oversized images to the configured long edge before upload', async () => {
    const originalCreateImageBitmap = globalThis.createImageBitmap;
    const originalDocument = globalThis.document;
    const drawImage = vi.fn();
    const toBlob = vi.fn((callback: BlobCallback, type?: string) => {
      callback(new Blob(['optimized-image'], { type }));
    });

    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: vi.fn(async () => ({
        width: 5000,
        height: 2500,
        close: vi.fn(),
      })),
    });
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        createElement: vi.fn(() => ({
          width: 0,
          height: 0,
          getContext: vi.fn(() => ({ drawImage })),
          toBlob,
        })),
      },
    });

    try {
      const file = new File(['large-image'], 'large.JPG', { type: 'image/jpeg' });
      const normalized = await normalizeImageFile(file);

      expect(normalized).not.toBe(file);
      expect(normalized.name).toBe('large.jpg');
      expect(normalized.type).toBe('image/jpeg');
      expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 2500, 1250);
      expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.84);
    } finally {
      Object.defineProperty(globalThis, 'createImageBitmap', {
        configurable: true,
        value: originalCreateImageBitmap,
      });
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: originalDocument,
      });
    }
  });
});
