import { Image, LoaderCircle } from 'lucide-react';
import { useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import type { MediaItem } from '../domain/types';

export type DestinationImageStripProps = {
  destinationName: string;
  mediaItems: MediaItem[];
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
  return `Open image ${index + 1}${caption ? `: ${caption}` : ''}`;
}

function getHeroImageUrl(mediaItem: MediaItem) {
  return mediaItem.previewUrl ?? mediaItem.fullUrl ?? mediaItem.url;
}

function getThumbnailImageUrl(mediaItem: MediaItem) {
  return mediaItem.thumbnailUrl ?? mediaItem.previewUrl ?? mediaItem.url;
}

function isFileDrag(event: DragEvent<HTMLElement>) {
  const types = Array.from(event.dataTransfer.types ?? []);

  return types.includes('Files') || event.dataTransfer.files.length > 0;
}

function getThumbnailDropSide(event: DragEvent<HTMLElement>): ThumbnailDropSide {
  const bounds = event.currentTarget.getBoundingClientRect();
  const midpoint = bounds.left + bounds.width / 2;

  return event.clientX < midpoint ? 'before' : 'after';
}

function reorderAroundTarget(
  mediaItems: MediaItem[],
  draggedMediaId: string,
  targetMediaId: string,
  side: ThumbnailDropSide,
) {
  if (draggedMediaId === targetMediaId) {
    return mediaItems.map((mediaItem) => mediaItem.id);
  }

  const withoutDragged = mediaItems.filter((mediaItem) => mediaItem.id !== draggedMediaId);
  const targetIndex = withoutDragged.findIndex((mediaItem) => mediaItem.id === targetMediaId);

  if (targetIndex === -1 || withoutDragged.length === mediaItems.length) {
    return mediaItems.map((mediaItem) => mediaItem.id);
  }

  const draggedMediaItem = mediaItems.find((mediaItem) => mediaItem.id === draggedMediaId);
  if (!draggedMediaItem) {
    return mediaItems.map((mediaItem) => mediaItem.id);
  }

  const insertionIndex = side === 'before' ? targetIndex : targetIndex + 1;

  return [
    ...withoutDragged.slice(0, insertionIndex).map((mediaItem) => mediaItem.id),
    draggedMediaItem.id,
    ...withoutDragged.slice(insertionIndex).map((mediaItem) => mediaItem.id),
  ];
}

export function DestinationImageStrip({
  destinationName,
  mediaItems,
  isLoading,
  isUploading,
  error,
  onUploadFiles,
  onReorder,
  onOpenPreview,
}: DestinationImageStripProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileDragDepthRef = useRef(0);
  const [isFileDragOver, setIsFileDragOver] = useState(false);
  const [draggedMediaId, setDraggedMediaId] = useState<string | null>(null);
  const [dragTarget, setDragTarget] = useState<ThumbnailDropTarget | null>(null);
  const heroMediaItem = mediaItems[0] ?? null;
  const stripClassName = `destination-image-strip${isFileDragOver ? ' is-drag-over' : ''}`;

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

  const handleThumbnailDragStart = (event: DragEvent<HTMLButtonElement>, mediaId: string) => {
    setDraggedMediaId(mediaId);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', mediaId);
    }
  };

  const handleThumbnailDragOver = (event: DragEvent<HTMLButtonElement>, mediaId: string) => {
    if (!draggedMediaId || draggedMediaId === mediaId) return;

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
    const nextOrder = reorderAroundTarget(
      mediaItems,
      draggedMediaId,
      targetMediaId,
      getThumbnailDropSide(event),
    );
    setDraggedMediaId(null);
    setDragTarget(null);

    if (nextOrder.some((mediaId, index) => mediaId !== mediaItems[index]?.id)) {
      void Promise.resolve(onReorder(nextOrder)).catch(() => undefined);
    }
  };

  const clearThumbnailDrag = () => {
    setDraggedMediaId(null);
    setDragTarget(null);
  };

  return (
    <section
      className={stripClassName}
      aria-label="Stop images"
      onDragEnter={handleStripDragEnter}
      onDragOver={handleStripDragOver}
      onDragLeave={handleStripDragLeave}
      onDrop={handleStripDrop}
    >
      <input
        ref={fileInputRef}
        className="destination-image-file-input"
        type="file"
        aria-label="Choose stop images"
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
          aria-label={
            isUploading
              ? `Uploading stop images for ${destinationName}`
              : `Add stop images for ${destinationName}`
          }
          onClick={openFilePicker}
          disabled={isUploading}
        >
          {isUploading ? (
            <>
              <span className="destination-image-upload-icon" aria-hidden="true">
                <LoaderCircle size={20} />
              </span>
              <span role="status" aria-label="Uploading images">
                Uploading images...
              </span>
              <small>Keep this pane open while the upload finishes.</small>
            </>
          ) : (
            <>
              <Image size={20} aria-hidden="true" />
              <span>No images yet</span>
              <small>Drop images here or click to add.</small>
            </>
          )}
        </button>
      ) : null}

      {!isLoading && heroMediaItem ? (
        <button
          type="button"
          className="destination-image-hero"
          aria-label={`Open hero image${heroMediaItem.caption.trim() ? `: ${heroMediaItem.caption.trim()}` : ''}`}
          onClick={() => onOpenPreview(heroMediaItem.id)}
        >
          <img src={getHeroImageUrl(heroMediaItem)} alt={mediaLabel(heroMediaItem, 0)} />
          {isUploading ? (
            <span className="destination-image-hero-status" role="status" aria-label="Uploading images">
              <LoaderCircle size={14} aria-hidden="true" />
              Uploading
            </span>
          ) : null}
        </button>
      ) : null}

      {mediaItems.length > 0 ? (
        <div className="destination-image-carousel" aria-label="Image thumbnails">
          {mediaItems.map((mediaItem, index) => (
            <button
              key={mediaItem.id}
              type="button"
              className={`destination-image-thumbnail${
                dragTarget?.mediaId === mediaItem.id ? ` is-drop-${dragTarget.side}` : ''
              }`}
              aria-label={openPreviewLabel(mediaItem, index)}
              draggable
              onClick={() => onOpenPreview(mediaItem.id)}
              onDragStart={(event) => handleThumbnailDragStart(event, mediaItem.id)}
              onDragOver={(event) => handleThumbnailDragOver(event, mediaItem.id)}
              onDrop={(event) => handleThumbnailDrop(event, mediaItem.id)}
              onDragEnd={clearThumbnailDrag}
            >
              <img src={getThumbnailImageUrl(mediaItem)} alt={mediaLabel(mediaItem, index)} />
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
