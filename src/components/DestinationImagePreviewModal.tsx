import { ChevronLeft, ChevronRight, LoaderCircle, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { MediaItem } from '../domain/types';

type DestinationImagePreviewModalProps = {
  mediaItem: MediaItem;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  imageFallbackAlt?: string;
  activityAttribution?: string;
  onOpenActivity?: () => void;
  onDelete: (mediaId: string) => Promise<void> | void;
  onNavigatePrevious: (mediaId: string) => Promise<void> | void;
  onNavigateNext: (mediaId: string) => Promise<void> | void;
  onClose: () => void;
};

export function DestinationImagePreviewModal({
  mediaItem,
  canMoveLeft,
  canMoveRight,
  imageFallbackAlt,
  activityAttribution,
  onOpenActivity,
  onDelete,
  onNavigatePrevious,
  onNavigateNext,
  onClose,
}: DestinationImagePreviewModalProps) {
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const isDeletingRef = useRef(false);
  const imageAlt = mediaItem.caption.trim() || imageFallbackAlt || 'Reference image';
  const imageUrl = mediaItem.fullUrl ?? mediaItem.previewUrl ?? mediaItem.url;
  const hasActivityAttribution = Boolean(activityAttribution);
  const canOpenActivity = Boolean(activityAttribution && onOpenActivity);

  useEffect(() => {
    const handleDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;

      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        event.stopPropagation();

        if (event.key === 'ArrowLeft' && canMoveLeft) {
          void onNavigatePrevious(mediaItem.id);
        }

        if (event.key === 'ArrowRight' && canMoveRight) {
          void onNavigateNext(mediaItem.id);
        }

        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (isConfirmingDelete) {
          setIsConfirmingDelete(false);
          setDeleteError('');
          return;
        }

        onClose();
      }
    };

    document.addEventListener('keydown', handleDocumentKeyDown);

    return () => {
      document.removeEventListener('keydown', handleDocumentKeyDown);
    };
  }, [
    canMoveLeft,
    canMoveRight,
    isConfirmingDelete,
    mediaItem.id,
    onClose,
    onNavigateNext,
    onNavigatePrevious,
  ]);

  const handleDelete = async () => {
    if (isDeletingRef.current) return;

    isDeletingRef.current = true;
    setIsDeleting(true);
    setDeleteError('');

    try {
      await onDelete(mediaItem.id);
    } catch {
      setDeleteError('Unable to delete image.');
    } finally {
      isDeletingRef.current = false;
      setIsDeleting(false);
    }
  };

  return (
    <div className="image-preview-backdrop">
      <section
        className="image-preview-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Image preview"
      >
        <div className="image-preview-frame">
          <img src={imageUrl} alt={imageAlt} />
          <button
            type="button"
            className="image-preview-floating-button image-preview-close-button"
            aria-label="Close image preview"
            title="Close image preview"
            onClick={onClose}
          >
            <X size={20} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="image-preview-floating-button image-preview-nav-button is-previous"
            aria-label="Previous full image"
            title="Previous full image"
            disabled={!canMoveLeft}
            onClick={() => void onNavigatePrevious(mediaItem.id)}
          >
            <ChevronLeft size={24} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="image-preview-floating-button image-preview-nav-button is-next"
            aria-label="Next full image"
            title="Next full image"
            disabled={!canMoveRight}
            onClick={() => void onNavigateNext(mediaItem.id)}
          >
            <ChevronRight size={24} aria-hidden="true" />
          </button>
          <div className="image-preview-delete-control">
            {isConfirmingDelete ? (
              <div
                className="image-preview-delete-popover"
                role="alertdialog"
                aria-label="Delete image confirmation"
              >
                <p>Delete this image?</p>
                {deleteError ? (
                  <p className="image-preview-delete-error" role="alert">
                    {deleteError}
                  </p>
                ) : null}
                <div className="image-preview-delete-actions">
                  <button
                    type="button"
                    onClick={() => {
                      setIsConfirmingDelete(false);
                      setDeleteError('');
                    }}
                    disabled={isDeleting}
                  >
                    Cancel
                  </button>
                  <button type="button" className="is-danger" onClick={() => void handleDelete()} disabled={isDeleting}>
                    {isDeleting ? <LoaderCircle size={15} aria-hidden="true" /> : null}
                    <span>Delete image</span>
                  </button>
                </div>
              </div>
            ) : null}
            <button
              type="button"
              className="image-preview-floating-button image-preview-delete-button"
              aria-label="Delete image"
              title="Delete image"
              disabled={isDeleting}
              onClick={() => {
                setDeleteError('');
                setIsConfirmingDelete(true);
              }}
            >
              {isDeleting ? <LoaderCircle size={18} aria-hidden="true" /> : <Trash2 size={18} aria-hidden="true" />}
            </button>
          </div>
          {hasActivityAttribution ? (
            <div className="image-preview-activity-tools">
              <span className="image-preview-activity-attribution">{activityAttribution}</span>
              {canOpenActivity ? (
                <button
                  type="button"
                  className="image-preview-open-activity-button"
                  onClick={onOpenActivity}
                >
                  Open activity
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
