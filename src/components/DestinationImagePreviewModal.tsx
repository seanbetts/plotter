import { ChevronLeft, ChevronRight, LoaderCircle, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { MediaItem } from '../domain/types';

type DestinationImagePreviewModalProps = {
  mediaItem: MediaItem;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  onDelete: (mediaId: string) => Promise<void> | void;
  onNavigatePrevious: (mediaId: string) => Promise<void> | void;
  onNavigateNext: (mediaId: string) => Promise<void> | void;
  onClose: () => void;
};

export function DestinationImagePreviewModal({
  mediaItem,
  canMoveLeft,
  canMoveRight,
  onDelete,
  onNavigatePrevious,
  onNavigateNext,
  onClose,
}: DestinationImagePreviewModalProps) {
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const isDeletingRef = useRef(false);
  const imageAlt = mediaItem.caption.trim() || 'Stop reference image';
  const imageUrl = mediaItem.fullUrl ?? mediaItem.previewUrl ?? mediaItem.url;

  useEffect(() => {
    const handleDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return;

      event.preventDefault();
      event.stopPropagation();
      if (isConfirmingDelete) {
        setIsConfirmingDelete(false);
        setDeleteError('');
        return;
      }

      onClose();
    };

    document.addEventListener('keydown', handleDocumentKeyDown);

    return () => {
      document.removeEventListener('keydown', handleDocumentKeyDown);
    };
  }, [isConfirmingDelete, onClose]);

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
        </div>
      </section>
    </div>
  );
}
