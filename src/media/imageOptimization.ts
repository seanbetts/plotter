export const mediaImageVariants = {
  thumbnail: { width: 320, height: 220, quality: 70, resize: 'cover' },
  preview: { width: 900, quality: 78, resize: 'contain' },
  full: { width: 2200, quality: 82, resize: 'contain' },
} as const;

const maxUploadLongEdge = 2500;
const uploadQuality = 0.84;
const optimizableImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

function getOutputType(file: File) {
  if (file.type === 'image/png') return 'image/png';
  return 'image/jpeg';
}

function getExtensionForImageType(type: string) {
  if (type === 'image/png') return 'png';
  if (type === 'image/webp') return 'webp';
  return 'jpg';
}

export function getNormalizedImageFileName(fileName: string, outputType: string) {
  const extension = getExtensionForImageType(outputType);
  const trimmedName = fileName.trim() || 'image';
  const baseName = trimmedName.replace(/\.[a-z0-9]+$/i, '') || 'image';

  return `${baseName}.${extension}`;
}

function hasImageProcessingSupport() {
  return (
    typeof globalThis.createImageBitmap === 'function' &&
    typeof globalThis.document !== 'undefined' &&
    typeof globalThis.document.createElement === 'function'
  );
}

async function canvasToBlob(canvas: HTMLCanvasElement, type: string) {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, type, uploadQuality);
  });
}

export async function normalizeImageFile(file: File): Promise<File> {
  if (!optimizableImageTypes.has(file.type) || !hasImageProcessingSupport()) {
    return file;
  }

  let bitmap: ImageBitmap | null = null;

  try {
    bitmap = await globalThis.createImageBitmap(file);
    const longestEdge = Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(1, maxUploadLongEdge / longestEdge);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = globalThis.document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) {
      return file;
    }

    context.drawImage(bitmap, 0, 0, width, height);

    const outputType = getOutputType(file);
    const blob = await canvasToBlob(canvas, outputType);
    if (!blob) {
      return file;
    }

    if (scale === 1 && blob.size >= file.size) {
      return file;
    }

    return new File([blob], getNormalizedImageFileName(file.name, blob.type || outputType), {
      type: blob.type || outputType,
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  } finally {
    bitmap?.close();
  }
}
