import { Check, ChevronLeft, ChevronRight, CircleAlert, LoaderCircle, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { MediaItem } from '../domain/types';

type MediaPatch = Pick<Partial<MediaItem>, 'caption' | 'credit'>;

type DestinationImagePreviewModalProps = {
  mediaItem: MediaItem;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  onUpdate: (mediaId: string, patch: MediaPatch) => Promise<MediaItem | undefined> | MediaItem | undefined;
  onDelete: (mediaId: string) => Promise<void> | void;
  onMoveLeft: (mediaId: string) => Promise<void> | void;
  onMoveRight: (mediaId: string) => Promise<void> | void;
  onClose: () => void;
};

type DraftState = Pick<MediaItem, 'caption' | 'credit'>;
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const autosaveDelayMs = 700;
const savedStatusVisibleMs = 2400;

function createDraft(mediaItem: MediaItem): DraftState {
  return {
    caption: mediaItem.caption,
    credit: mediaItem.credit,
  };
}

function createPatch(draft: DraftState, baseline: DraftState): MediaPatch | null {
  const patch: MediaPatch = {};

  if (draft.caption !== baseline.caption) {
    patch.caption = draft.caption;
  }

  if (draft.credit !== baseline.credit) {
    patch.credit = draft.credit;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

function saveStatusText(saveStatus: SaveStatus) {
  if (saveStatus === 'saving') return 'Saving...';
  if (saveStatus === 'saved') return 'Saved';
  if (saveStatus === 'error') return 'Unable to save';

  return '';
}

export function DestinationImagePreviewModal({
  mediaItem,
  canMoveLeft,
  canMoveRight,
  onUpdate,
  onDelete,
  onMoveLeft,
  onMoveRight,
  onClose,
}: DestinationImagePreviewModalProps) {
  return (
    <DestinationImagePreviewModalForm
      key={mediaItem.id}
      mediaItem={mediaItem}
      canMoveLeft={canMoveLeft}
      canMoveRight={canMoveRight}
      onUpdate={onUpdate}
      onDelete={onDelete}
      onMoveLeft={onMoveLeft}
      onMoveRight={onMoveRight}
      onClose={onClose}
    />
  );
}

function DestinationImagePreviewModalForm({
  mediaItem,
  canMoveLeft,
  canMoveRight,
  onUpdate,
  onDelete,
  onMoveLeft,
  onMoveRight,
  onClose,
}: DestinationImagePreviewModalProps) {
  const [draft, setDraft] = useState(() => createDraft(mediaItem));
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const autosaveTimerRef = useRef<number | null>(null);
  const savedStatusTimerRef = useRef<number | null>(null);
  const draftRef = useRef(createDraft(mediaItem));
  const baselineRef = useRef(createDraft(mediaItem));
  const mediaIdRef = useRef(mediaItem.id);
  const isDeletingRef = useRef(false);
  const editRevisionRef = useRef(0);
  const savedRevisionRef = useRef(0);
  const saveSequenceRef = useRef(0);
  const statusText = saveStatusText(saveStatus);
  const saveStatusClassName = `image-preview-save-status is-${saveStatus}`;
  const imageAlt = mediaItem.caption.trim() || 'Stop reference image';

  const clearAutosaveTimer = useCallback(() => {
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
  }, []);

  const clearSavedStatusTimer = useCallback(() => {
    if (savedStatusTimerRef.current !== null) {
      window.clearTimeout(savedStatusTimerRef.current);
      savedStatusTimerRef.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      clearAutosaveTimer();
      clearSavedStatusTimer();
      saveSequenceRef.current += 1;
    },
    [clearAutosaveTimer, clearSavedStatusTimer],
  );

  useEffect(() => {
    const handleDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return;

      onClose();
    };

    document.addEventListener('keydown', handleDocumentKeyDown);

    return () => {
      document.removeEventListener('keydown', handleDocumentKeyDown);
    };
  }, [onClose]);

  const autosave = useCallback(
    async function runAutosave(mediaId: string, draftRevision: number, patch: MediaPatch) {
      const saveSequence = saveSequenceRef.current + 1;
      saveSequenceRef.current = saveSequence;
      clearSavedStatusTimer();
      setSaveStatus('saving');

      try {
        const updatedMediaItem = await onUpdate(mediaId, patch);
        if (!updatedMediaItem) {
          throw new Error('Unable to update image.');
        }

        if (
          mediaIdRef.current !== mediaId ||
          saveSequenceRef.current !== saveSequence ||
          editRevisionRef.current !== draftRevision
        ) {
          const draftMatchedPreviousBaseline = createPatch(draftRef.current, baselineRef.current) === null;

          if (mediaIdRef.current === mediaId && draftMatchedPreviousBaseline) {
            const nextBaseline = createDraft(updatedMediaItem);
            baselineRef.current = nextBaseline;
            const followUpPatch = createPatch(draftRef.current, nextBaseline);

            if (followUpPatch) {
              clearSavedStatusTimer();
              void runAutosave(mediaId, editRevisionRef.current, followUpPatch);
              return;
            }

            clearSavedStatusTimer();
            savedRevisionRef.current = Math.max(savedRevisionRef.current, editRevisionRef.current);
            setSaveStatus('idle');
          }
          return;
        }

        const nextBaseline = createDraft(updatedMediaItem);
        baselineRef.current = nextBaseline;
        savedRevisionRef.current = Math.max(savedRevisionRef.current, draftRevision);
        setSaveStatus('saved');
        savedStatusTimerRef.current = window.setTimeout(() => {
          setSaveStatus('idle');
          savedStatusTimerRef.current = null;
        }, savedStatusVisibleMs);
      } catch {
        if (
          mediaIdRef.current !== mediaId ||
          saveSequenceRef.current !== saveSequence ||
          editRevisionRef.current !== draftRevision
        ) {
          if (mediaIdRef.current === mediaId && createPatch(draftRef.current, baselineRef.current) === null) {
            clearSavedStatusTimer();
            savedRevisionRef.current = Math.max(savedRevisionRef.current, editRevisionRef.current);
            setSaveStatus('idle');
          }
          return;
        }

        setSaveStatus('error');
      }
    },
    [clearSavedStatusTimer, onUpdate],
  );

  useEffect(() => {
    clearAutosaveTimer();

    const patch = createPatch(draft, baselineRef.current);
    const draftRevision = editRevisionRef.current;
    if (!patch || draftRevision <= savedRevisionRef.current) {
      if (!patch && draftRevision > savedRevisionRef.current) {
        saveSequenceRef.current += 1;
        savedRevisionRef.current = draftRevision;
        clearSavedStatusTimer();
        setSaveStatus('idle');
      }
      return undefined;
    }

    autosaveTimerRef.current = window.setTimeout(() => {
      autosaveTimerRef.current = null;
      void autosave(mediaItem.id, draftRevision, patch);
    }, autosaveDelayMs);

    return clearAutosaveTimer;
  }, [autosave, clearAutosaveTimer, clearSavedStatusTimer, draft, mediaItem.id]);

  const updateDraft = (patch: Partial<DraftState>) => {
    editRevisionRef.current += 1;
    setIsConfirmingDelete(false);
    setDeleteError('');
    setDraft((current) => {
      const nextDraft = { ...current, ...patch };
      draftRef.current = nextDraft;
      return nextDraft;
    });
  };

  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
    }
  };

  const handleDelete = async () => {
    if (!isConfirmingDelete) {
      setDeleteError('');
      setIsConfirmingDelete(true);
      return;
    }

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
        <header className="image-preview-header">
          <div className="image-preview-title-block">
            <h2>Image preview</h2>
            <p>Reference image</p>
          </div>
          <div className="image-preview-header-actions">
            {saveStatus !== 'idle' ? (
              <div
                className={saveStatusClassName}
                role="status"
                aria-live="polite"
                aria-label={statusText}
                title={statusText}
              >
                {saveStatus === 'saving' ? <LoaderCircle size={16} aria-hidden="true" /> : null}
                {saveStatus === 'saved' ? <Check size={16} aria-hidden="true" /> : null}
                {saveStatus === 'error' ? <CircleAlert size={16} aria-hidden="true" /> : null}
                <span className="sr-only">{statusText}</span>
              </div>
            ) : null}
            <button
              type="button"
              className="image-preview-icon-button"
              aria-label="Close image preview"
              title="Close image preview"
              onClick={onClose}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="image-preview-frame">
          <img src={mediaItem.url} alt={imageAlt} />
        </div>

        <div className="image-preview-controls" aria-label="Image actions">
          <button
            type="button"
            className="image-preview-icon-button"
            aria-label="Move image left"
            title="Move image left"
            disabled={!canMoveLeft}
            onClick={() => void onMoveLeft(mediaItem.id)}
          >
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="image-preview-icon-button"
            aria-label="Move image right"
            title="Move image right"
            disabled={!canMoveRight}
            onClick={() => void onMoveRight(mediaItem.id)}
          >
            <ChevronRight size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="image-preview-delete-button"
            aria-label={isConfirmingDelete ? 'Confirm delete image' : 'Delete image'}
            disabled={isDeleting}
            onClick={() => void handleDelete()}
          >
            {isDeleting ? <LoaderCircle size={16} aria-hidden="true" /> : <Trash2 size={16} aria-hidden="true" />}
            <span>{isConfirmingDelete ? 'Delete this image?' : 'Delete'}</span>
          </button>
        </div>
        {deleteError ? (
          <p className="image-preview-delete-error" role="alert">
            {deleteError}
          </p>
        ) : null}

        <div className="image-preview-fields">
          <label>
            Caption
            <textarea
              value={draft.caption}
              onChange={(event) => updateDraft({ caption: event.target.value })}
              onKeyDown={handleInputKeyDown}
              rows={3}
            />
          </label>
          <label>
            Credit
            <input
              value={draft.credit}
              onChange={(event) => updateDraft({ credit: event.target.value })}
              onKeyDown={handleInputKeyDown}
            />
          </label>
        </div>
      </section>
    </div>
  );
}
