import { ChevronLeft, ChevronRight, Image, LoaderCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import type { MediaItem } from '../domain/types';
import { preloadImageUrls } from '../media/imagePreloading';

export type MediaStripItem = {
  mediaItem: MediaItem;
  attribution?: string;
  canReorder: boolean;
};

export type MediaImageStripProps = {
  regionLabel: string;
  emptyLabel: string;
  emptyHint: string;
  chooseFilesLabel: string;
  uploadingLabel: string;
  items: MediaStripItem[];
  isLoading: boolean;
  isUploading: boolean;
  error: string | null;
  onUploadFiles: (files: File[]) => Promise<void> | void;
  onReorder: (orderedMediaIds: string[]) => Promise<void> | void;
  onOpenPreview: (mediaId: string) => void;
};

const acceptedImageTypes = 'image/jpeg,image/png,image/webp,image/gif';

type ThumbnailDropSide = 'before' | 'after';
type ThumbnailDropTarget = {
  mediaId: string;
  side: ThumbnailDropSide;
};

function mediaLabel(mediaItem: MediaItem, index: number) {
  const caption = mediaItem.caption.trim();
  return caption || `Image ${index + 1}`;
}

function openPreviewLabel(mediaItem: MediaItem, index: number) {
  const caption = mediaItem.caption.trim();
  return `Show image ${index + 1}${caption ? `: ${caption}` : ''}`;
}

function getHeroImageUrl(mediaItem: MediaItem) {
  return mediaItem.previewUrl ?? mediaItem.fullUrl ?? mediaItem.url;
}

function getThumbnailImageUrl(mediaItem: MediaItem) {
  return mediaItem.thumbnailUrl ?? mediaItem.previewUrl ?? mediaItem.url;
}

function isEditableKeyboardTarget(element: Element | null) {
  if (!(element instanceof HTMLElement)) return false;

  return (
    element.isContentEditable ||
    element.tagName === 'INPUT' ||
    element.tagName === 'SELECT' ||
    element.tagName === 'TEXTAREA'
  );
}

function isFileDrag(event: DragEvent<HTMLElement>) {
  if (!event.dataTransfer) return false;

  const types = Array.from(event.dataTransfer.types ?? []);

  return types.includes('Files') || event.dataTransfer.files.length > 0;
}

function getThumbnailDropSide(event: DragEvent<HTMLElement>): ThumbnailDropSide {
  const bounds = event.currentTarget.getBoundingClientRect();
  const midpoint = bounds.left + bounds.width / 2;

  return event.clientX < midpoint ? 'before' : 'after';
}

function reorderAroundTarget(
  items: MediaStripItem[],
  draggedMediaId: string,
  targetMediaId: string,
  side: ThumbnailDropSide,
) {
  if (draggedMediaId === targetMediaId) {
    return items.map((item) => item.mediaItem.id);
  }

  const withoutDragged = items.filter((item) => item.mediaItem.id !== draggedMediaId);
  const targetIndex = withoutDragged.findIndex((item) => item.mediaItem.id === targetMediaId);

  if (targetIndex === -1 || withoutDragged.length === items.length) {
    return items.map((item) => item.mediaItem.id);
  }

  const draggedItem = items.find((item) => item.mediaItem.id === draggedMediaId);
  if (!draggedItem) {
    return items.map((item) => item.mediaItem.id);
  }

  const insertionIndex = side === 'before' ? targetIndex : targetIndex + 1;

  return [
    ...withoutDragged.slice(0, insertionIndex).map((item) => item.mediaItem.id),
    draggedItem.mediaItem.id,
    ...withoutDragged.slice(insertionIndex).map((item) => item.mediaItem.id),
  ];
}

function findItem(items: MediaStripItem[], mediaId: string) {
  return items.find((item) => item.mediaItem.id === mediaId) ?? null;
}

export function MediaImageStrip({
  regionLabel,
  emptyLabel,
  emptyHint,
  chooseFilesLabel,
  uploadingLabel,
  items,
  isLoading,
  isUploading,
  error,
  onUploadFiles,
  onReorder,
  onOpenPreview,
}: MediaImageStripProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileDragDepthRef = useRef(0);
  const [isFileDragOver, setIsFileDragOver] = useState(false);
  const [draggedMediaId, setDraggedMediaId] = useState<string | null>(null);
  const [dragTarget, setDragTarget] = useState<ThumbnailDropTarget | null>(null);
  const [previewMediaId, setPreviewMediaId] = useState<string | null>(null);
  const previewMediaIndex =
    previewMediaId === null ? 0 : items.findIndex((item) => item.mediaItem.id === previewMediaId);
  const safePreviewMediaIndex = previewMediaIndex === -1 ? 0 : previewMediaIndex;
  const heroItem = items[safePreviewMediaIndex] ?? null;
  const heroMediaItem = heroItem?.mediaItem ?? null;
  const stripClassName = `destination-image-strip${isFileDragOver ? ' is-drag-over' : ''}`;

  useEffect(() => {
    if (items.length < 2) return;

    const previousIndex = (safePreviewMediaIndex - 1 + items.length) % items.length;
    const nextIndex = (safePreviewMediaIndex + 1) % items.length;

    preloadImageUrls([
      getHeroImageUrl(items[previousIndex].mediaItem),
      getHeroImageUrl(items[nextIndex].mediaItem),
    ]);
  }, [items, safePreviewMediaIndex]);

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  const resetFileDragState = () => {
    fileDragDepthRef.current = 0;
    setIsFileDragOver(false);
  };

  const uploadFiles = (files: File[]) => {
    if (files.length === 0) return;

    void Promise.resolve(onUploadFiles(files)).catch(() => undefined);
  };

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    uploadFiles(files);
    event.currentTarget.value = '';
  };

  const handleStripDragEnter = (event: DragEvent<HTMLElement>) => {
    if (!isFileDrag(event)) return;

    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    fileDragDepthRef.current += 1;
    setIsFileDragOver(true);
  };

  const handleStripDragOver = (event: DragEvent<HTMLElement>) => {
    if (!isFileDrag(event)) return;

    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    fileDragDepthRef.current = Math.max(1, fileDragDepthRef.current);
    setIsFileDragOver(true);
  };

  const handleStripDragLeave = (event: DragEvent<HTMLElement>) => {
    if (!isFileDrag(event)) return;

    fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1);
    if (fileDragDepthRef.current === 0) {
      setIsFileDragOver(false);
    }
  };

  const handleStripDrop = (event: DragEvent<HTMLElement>) => {
    if (!isFileDrag(event)) return;

    event.preventDefault();
    resetFileDragState();
    uploadFiles(Array.from(event.dataTransfer.files));
  };

  const canDropOnTarget = (targetMediaId: string) => {
    if (!draggedMediaId || draggedMediaId === targetMediaId) return false;

    const draggedItem = findItem(items, draggedMediaId);
    const targetItem = findItem(items, targetMediaId);

    return Boolean(draggedItem?.canReorder && targetItem?.canReorder);
  };

  const handleThumbnailDragStart = (event: DragEvent<HTMLButtonElement>, item: MediaStripItem) => {
    if (!item.canReorder) {
      event.preventDefault();
      return;
    }

    setDraggedMediaId(item.mediaItem.id);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', item.mediaItem.id);
    }
  };

  const handleThumbnailDragOver = (event: DragEvent<HTMLButtonElement>, mediaId: string) => {
    if (!canDropOnTarget(mediaId)) return;

    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    setDragTarget({
      mediaId,
      side: getThumbnailDropSide(event),
    });
  };

  const handleThumbnailDrop = (event: DragEvent<HTMLButtonElement>, targetMediaId: string) => {
    if (!draggedMediaId) return;

    event.preventDefault();
    event.stopPropagation();

    if (!canDropOnTarget(targetMediaId)) {
      setDraggedMediaId(null);
      setDragTarget(null);
      return;
    }

    const nextOrder = reorderAroundTarget(items, draggedMediaId, targetMediaId, getThumbnailDropSide(event));
    setDraggedMediaId(null);
    setDragTarget(null);

    if (nextOrder.some((mediaId, index) => mediaId !== items[index]?.mediaItem.id)) {
      void Promise.resolve(onReorder(nextOrder)).catch(() => undefined);
    }
  };

  const clearThumbnailDrag = () => {
    setDraggedMediaId(null);
    setDragTarget(null);
  };

  const selectAdjacentPreview = useCallback(
    (direction: -1 | 1) => {
      if (items.length === 0) return;

      const nextItem = items[(safePreviewMediaIndex + direction + items.length) % items.length];
      if (!nextItem) return;

      setPreviewMediaId(nextItem.mediaItem.id);
    },
    [items, safePreviewMediaIndex],
  );

  useEffect(() => {
    if (items.length < 2) return undefined;

    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (isEditableKeyboardTarget(document.activeElement)) return;

      event.preventDefault();
      selectAdjacentPreview(event.key === 'ArrowLeft' ? -1 : 1);
    };

    window.addEventListener('keydown', handleWindowKeyDown);

    return () => {
      window.removeEventListener('keydown', handleWindowKeyDown);
    };
  }, [items.length, selectAdjacentPreview]);

  return (
    <section
      className={stripClassName}
      aria-label={regionLabel}
      onDragEnter={handleStripDragEnter}
      onDragOver={handleStripDragOver}
      onDragLeave={handleStripDragLeave}
      onDrop={handleStripDrop}
    >
      <input
        ref={fileInputRef}
        className="destination-image-file-input"
        type="file"
        aria-label={`${chooseFilesLabel} file input`}
        accept={acceptedImageTypes}
        multiple
        onChange={handleFileInputChange}
      />

      {isLoading ? (
        <div className="destination-image-state" role="status" aria-label="Loading images">
          <LoaderCircle size={16} aria-hidden="true" />
          <span>Loading images</span>
        </div>
      ) : null}

      {!isLoading && !heroMediaItem ? (
        <button
          type="button"
          className={`destination-image-empty${isUploading ? ' is-uploading' : ''}`}
          aria-label={isUploading ? uploadingLabel : chooseFilesLabel}
          onClick={openFilePicker}
          disabled={isUploading}
        >
          {isUploading ? (
            <>
              <span className="destination-image-upload-icon" aria-hidden="true">
                <LoaderCircle size={20} />
              </span>
              <span role="status" aria-label={uploadingLabel}>
                {uploadingLabel}...
              </span>
              <small>Keep this pane open while the upload finishes.</small>
            </>
          ) : (
            <>
              <Image size={20} aria-hidden="true" />
              <span>{emptyLabel}</span>
              <small>{emptyHint}</small>
            </>
          )}
        </button>
      ) : null}

      {!isLoading && heroMediaItem ? (
        <div className="destination-image-hero" role="group" aria-label="Image preview">
          <button
            type="button"
            className="destination-image-preview-button"
            aria-label={`Open full image${heroMediaItem.caption.trim() ? `: ${heroMediaItem.caption.trim()}` : ''}`}
            onClick={() => onOpenPreview(heroMediaItem.id)}
          >
            <img src={getHeroImageUrl(heroMediaItem)} alt={mediaLabel(heroMediaItem, safePreviewMediaIndex)} />
          </button>
          {heroItem.attribution ? (
            <span className="destination-image-attribution">{heroItem.attribution}</span>
          ) : null}
          <button
            type="button"
            className="destination-image-preview-nav is-previous"
            aria-label="Previous preview image"
            title="Previous preview image"
            disabled={items.length < 2}
            onClick={() => selectAdjacentPreview(-1)}
          >
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="destination-image-preview-nav is-next"
            aria-label="Next preview image"
            title="Next preview image"
            disabled={items.length < 2}
            onClick={() => selectAdjacentPreview(1)}
          >
            <ChevronRight size={18} aria-hidden="true" />
          </button>
          {isUploading ? (
            <span className="destination-image-hero-status" role="status" aria-label={uploadingLabel}>
              <LoaderCircle size={14} aria-hidden="true" />
              Uploading
            </span>
          ) : null}
        </div>
      ) : null}

      {items.length > 0 ? (
        <div className="destination-image-carousel" aria-label="Image thumbnails">
          {items.map((item, index) => (
            <button
              key={item.mediaItem.id}
              type="button"
              className={`destination-image-thumbnail${
                dragTarget?.mediaId === item.mediaItem.id ? ` is-drop-${dragTarget.side}` : ''
              }`}
              aria-label={openPreviewLabel(item.mediaItem, index)}
              draggable={item.canReorder}
              onClick={() => setPreviewMediaId(item.mediaItem.id)}
              onDragStart={(event) => handleThumbnailDragStart(event, item)}
              onDragOver={(event) => handleThumbnailDragOver(event, item.mediaItem.id)}
              onDrop={(event) => handleThumbnailDrop(event, item.mediaItem.id)}
              onDragEnd={clearThumbnailDrag}
            >
              <img src={getThumbnailImageUrl(item.mediaItem)} alt={mediaLabel(item.mediaItem, index)} />
              {item.attribution ? (
                <span className="destination-image-thumbnail-attribution">{item.attribution}</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      {isFileDragOver ? (
        <div className="destination-image-drop-status" role="status" aria-label="Drop images to upload">
          Drop images to upload
        </div>
      ) : null}

      {error ? (
        <p className="destination-image-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
