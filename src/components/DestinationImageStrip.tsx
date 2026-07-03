import { Image, LoaderCircle, Plus, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
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

function mediaLabel(mediaItem: MediaItem, index: number) {
  const caption = mediaItem.caption.trim();
  return caption || `Image ${index + 1}`;
}

function openPreviewLabel(mediaItem: MediaItem, index: number) {
  const caption = mediaItem.caption.trim();
  return `Open image ${index + 1}${caption ? `: ${caption}` : ''}`;
}

function isFileDrag(event: DragEvent<HTMLElement>) {
  const types = Array.from(event.dataTransfer.types ?? []);

  return types.includes('Files') || event.dataTransfer.files.length > 0;
}

function reorderAfter(mediaItems: MediaItem[], draggedMediaId: string, targetMediaId: string) {
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

  return [
    ...withoutDragged.slice(0, targetIndex + 1).map((mediaItem) => mediaItem.id),
    draggedMediaItem.id,
    ...withoutDragged.slice(targetIndex + 1).map((mediaItem) => mediaItem.id),
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
  const fileDragClearTimerRef = useRef<number | null>(null);
  const [isFileDragOver, setIsFileDragOver] = useState(false);
  const [draggedMediaId, setDraggedMediaId] = useState<string | null>(null);
  const [dragTargetMediaId, setDragTargetMediaId] = useState<string | null>(null);
  const heroMediaItem = mediaItems[0] ?? null;
  const stripClassName = `destination-image-strip${isFileDragOver ? ' is-drag-over' : ''}`;

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  const clearPendingFileDragReset = () => {
    if (fileDragClearTimerRef.current !== null) {
      window.clearTimeout(fileDragClearTimerRef.current);
      fileDragClearTimerRef.current = null;
    }
  };

  const resetFileDragState = () => {
    clearPendingFileDragReset();
    fileDragDepthRef.current = 0;
    setIsFileDragOver(false);
  };

  useEffect(
    () => () => {
      clearPendingFileDragReset();
    },
    [],
  );

  const uploadFiles = (files: File[]) => {
    if (files.length === 0) return;

    void Promise.resolve(onUploadFiles(files)).catch(() => undefined);
  };

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    uploadFiles(files);
    event.currentTarget.value = '';
  };

  const handleStripDragOver = (event: DragEvent<HTMLElement>) => {
    if (!isFileDrag(event)) return;

    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    clearPendingFileDragReset();
    fileDragDepthRef.current = Math.max(1, fileDragDepthRef.current);
    setIsFileDragOver(true);
  };

  const handleStripDragLeave = (event: DragEvent<HTMLElement>) => {
    if (!isFileDrag(event)) return;
    if (event.relatedTarget === null && fileDragDepthRef.current > 0) {
      clearPendingFileDragReset();
      fileDragClearTimerRef.current = window.setTimeout(resetFileDragState, 80);
      return;
    }
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;

    resetFileDragState();
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
    setDragTargetMediaId(mediaId);
  };

  const handleThumbnailDrop = (event: DragEvent<HTMLButtonElement>, targetMediaId: string) => {
    if (!draggedMediaId) return;

    event.preventDefault();
    event.stopPropagation();
    const nextOrder = reorderAfter(mediaItems, draggedMediaId, targetMediaId);
    setDraggedMediaId(null);
    setDragTargetMediaId(null);

    if (nextOrder.some((mediaId, index) => mediaId !== mediaItems[index]?.id)) {
      void Promise.resolve(onReorder(nextOrder)).catch(() => undefined);
    }
  };

  const clearThumbnailDrag = () => {
    setDraggedMediaId(null);
    setDragTargetMediaId(null);
  };

  return (
    <section
      className={stripClassName}
      aria-label="Stop images"
      onDragOver={handleStripDragOver}
      onDragLeave={handleStripDragLeave}
      onDrop={handleStripDrop}
    >
      <div className="destination-image-strip-header">
        <div>
          <h3>Stop images</h3>
          <p>{destinationName}</p>
        </div>
        <button
          type="button"
          className="destination-image-add-button"
          aria-label="Add stop images"
          onClick={openFilePicker}
        >
          <Plus size={16} aria-hidden="true" />
          <span>Add</span>
        </button>
      </div>

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
          className="destination-image-empty"
          aria-label={`Add stop images for ${destinationName}`}
          onClick={openFilePicker}
        >
          <Image size={20} aria-hidden="true" />
          <span>No images yet</span>
          <small>Drop images here or click to add.</small>
        </button>
      ) : null}

      {!isLoading && heroMediaItem ? (
        <button
          type="button"
          className="destination-image-hero"
          aria-label={`Open hero image${heroMediaItem.caption.trim() ? `: ${heroMediaItem.caption.trim()}` : ''}`}
          onClick={() => onOpenPreview(heroMediaItem.id)}
        >
          <img src={heroMediaItem.url} alt={mediaLabel(heroMediaItem, 0)} />
        </button>
      ) : null}

      <div className="destination-image-carousel" aria-label="Image thumbnails">
        {mediaItems.map((mediaItem, index) => (
          <button
            key={mediaItem.id}
            type="button"
            className={`destination-image-thumbnail${dragTargetMediaId === mediaItem.id ? ' is-drag-target' : ''}`}
            aria-label={openPreviewLabel(mediaItem, index)}
            draggable
            onClick={() => onOpenPreview(mediaItem.id)}
            onDragStart={(event) => handleThumbnailDragStart(event, mediaItem.id)}
            onDragOver={(event) => handleThumbnailDragOver(event, mediaItem.id)}
            onDrop={(event) => handleThumbnailDrop(event, mediaItem.id)}
            onDragEnd={clearThumbnailDrag}
          >
            <img src={mediaItem.url} alt={mediaLabel(mediaItem, index)} />
          </button>
        ))}
        <button
          type="button"
          className="destination-image-add-tile"
          aria-label={`Add another stop image for ${destinationName}`}
          onClick={openFilePicker}
        >
          <Plus size={18} aria-hidden="true" />
        </button>
        {isUploading ? (
          <div className="destination-image-uploading" role="status" aria-label="Uploading images">
            <Upload size={15} aria-hidden="true" />
            <span>Uploading</span>
          </div>
        ) : null}
      </div>

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
