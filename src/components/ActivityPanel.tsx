import { CircleAlert, X } from 'lucide-react';
import { forwardRef, useEffect, useRef, useState } from 'react';
import type { CSSProperties, Ref } from 'react';
import type { Activity, MediaItem } from '../domain/types';
import { ActivityImageStrip } from './ActivityImageStrip';

type ActivityPanelProps = {
  activity: Activity;
  stopName: string;
  mediaItems: MediaItem[];
  mediaError: string | null;
  isMediaLoading: boolean;
  isMediaUploading: boolean;
  onClose: () => void;
  onUpdateActivity: (
    activityId: string,
    patch: Partial<Pick<Activity, 'title' | 'description' | 'notes'>>,
  ) => Promise<void> | void;
  onUploadMedia: (files: File[]) => Promise<void> | void;
  onReorderMedia: (orderedMediaIds: string[]) => Promise<void> | void;
  onOpenMediaPreview: (mediaId: string) => void;
};

type ActivityDraft = Pick<Activity, 'title' | 'description' | 'notes'>;
type ActivityDraftField = keyof ActivityDraft;

function createActivityDraft(activity: Activity): ActivityDraft {
  return {
    title: activity.title,
    description: activity.description,
    notes: activity.notes,
  };
}

function activitySourceKey(activity: Activity) {
  return `${activity.id}:${activity.updatedAt}`;
}

const profileTitleControlStyle = {
  '--profile-title-block-padding': '0px',
  '--profile-title-inline-padding': '0px',
} as CSSProperties;

export const ActivityPanel = forwardRef<HTMLElement, ActivityPanelProps>(function ActivityPanel({
  activity,
  stopName,
  mediaItems,
  mediaError,
  isMediaLoading,
  isMediaUploading,
  onClose,
  onUpdateActivity,
  onUploadMedia,
  onReorderMedia,
  onOpenMediaPreview,
}: ActivityPanelProps, ref) {
  return (
    <ActivityPanelForm
      key={activity.id}
      panelRef={ref}
      activity={activity}
      stopName={stopName}
      mediaItems={mediaItems}
      mediaError={mediaError}
      isMediaLoading={isMediaLoading}
      isMediaUploading={isMediaUploading}
      onClose={onClose}
      onUpdateActivity={onUpdateActivity}
      onUploadMedia={onUploadMedia}
      onReorderMedia={onReorderMedia}
      onOpenMediaPreview={onOpenMediaPreview}
    />
  );
});

function ActivityPanelForm({
  panelRef,
  activity,
  stopName,
  mediaItems,
  mediaError,
  isMediaLoading,
  isMediaUploading,
  onClose,
  onUpdateActivity,
  onUploadMedia,
  onReorderMedia,
  onOpenMediaPreview,
}: ActivityPanelProps & { panelRef: Ref<HTMLElement> }) {
  const [draft, setDraft] = useState(() => createActivityDraft(activity));
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [saveError, setSaveError] = useState('');
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const latestDraftRef = useRef(createActivityDraft(activity));
  const dirtyFieldsRef = useRef(new Set<ActivityDraftField>());
  const fieldEditRevisionRef = useRef<Record<ActivityDraftField, number>>({
    title: 0,
    description: 0,
    notes: 0,
  });
  const fieldSaveRevisionRef = useRef<Record<ActivityDraftField, number>>({
    title: 0,
    description: 0,
    notes: 0,
  });
  const sourceKey = activitySourceKey(activity);
  const activityTitle = activity.title;
  const activityDescription = activity.description;
  const activityNotes = activity.notes;

  useEffect(() => {
    setDraft((current) => {
      const shouldPreserveDraft = <Field extends ActivityDraftField>(
        field: Field,
        persistedValue: ActivityDraft[Field],
      ) => dirtyFieldsRef.current.has(field) && current[field] !== persistedValue;
      const acceptPersistedField = (field: ActivityDraftField) => {
        dirtyFieldsRef.current.delete(field);
      };

      if (!shouldPreserveDraft('title', activityTitle)) acceptPersistedField('title');
      if (!shouldPreserveDraft('description', activityDescription)) acceptPersistedField('description');
      if (!shouldPreserveDraft('notes', activityNotes)) acceptPersistedField('notes');

      const nextDraft = {
        title: dirtyFieldsRef.current.has('title') ? current.title : activityTitle,
        description: dirtyFieldsRef.current.has('description') ? current.description : activityDescription,
        notes: dirtyFieldsRef.current.has('notes') ? current.notes : activityNotes,
      };

      latestDraftRef.current = nextDraft;
      return nextDraft;
    });
    setSaveError('');
  }, [
    activityDescription,
    activityNotes,
    activityTitle,
    sourceKey,
  ]);

  useEffect(() => {
    if (isEditingTitle) {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }
  }, [isEditingTitle]);

  function updateDraft<Field extends ActivityDraftField>(field: Field, value: ActivityDraft[Field]) {
    setSaveError('');
    dirtyFieldsRef.current.add(field);
    fieldEditRevisionRef.current[field] += 1;
    setDraft((current) => {
      const nextDraft = {
        ...current,
        [field]: value,
      };
      latestDraftRef.current = nextDraft;
      return nextDraft;
    });
  }

  async function commitDraft<Field extends ActivityDraftField>(field: Field) {
    const nextValue = latestDraftRef.current[field];
    if (nextValue === activity[field]) {
      dirtyFieldsRef.current.delete(field);
      return;
    }

    const saveRevision = fieldSaveRevisionRef.current[field] + 1;
    fieldSaveRevisionRef.current[field] = saveRevision;
    const editRevision = fieldEditRevisionRef.current[field];
    setSaveError('');
    try {
      await Promise.resolve(onUpdateActivity(activity.id, { [field]: nextValue }));
      if (canApplySaveResult(field, saveRevision, editRevision, nextValue)) {
        dirtyFieldsRef.current.delete(field);
      }
    } catch {
      if (canApplySaveResult(field, saveRevision, editRevision, nextValue)) {
        dirtyFieldsRef.current.delete(field);
        setDraft((current) => {
          const nextDraft = {
            ...current,
            [field]: activity[field],
          };
          latestDraftRef.current = nextDraft;
          return nextDraft;
        });
        setSaveError('Unable to update activity.');
      }
    }
  }

  function canApplySaveResult<Field extends ActivityDraftField>(
    field: Field,
    saveRevision: number,
    editRevision: number,
    submittedValue: ActivityDraft[Field],
  ) {
    return (
      fieldSaveRevisionRef.current[field] === saveRevision &&
      fieldEditRevisionRef.current[field] === editRevision &&
      latestDraftRef.current[field] === submittedValue
    );
  }

  return (
    <aside ref={panelRef} className="activity-panel" aria-label={`${activity.title} activity`}>
      <header className="profile-header" aria-label="Activity detail header">
        <div>
          <span className="profile-stop-number">{stopName}</span>
          {isEditingTitle ? (
            <label className="profile-title-editor profile-title-control" style={profileTitleControlStyle}>
              <span className="sr-only">Activity title</span>
              <input
                ref={titleInputRef}
                className="profile-title-input"
                aria-label="Activity title"
                value={draft.title}
                onChange={(event) => updateDraft('title', event.target.value)}
                onBlur={() => void commitDraft('title')}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void commitDraft('title');
                    setIsEditingTitle(false);
                  }
                }}
              />
            </label>
          ) : (
            <button
              type="button"
              className="profile-title-button profile-title-control"
              style={profileTitleControlStyle}
              aria-label={`Edit activity title ${draft.title || activity.title}`}
              onClick={() => setIsEditingTitle(true)}
            >
              <h1>{draft.title || activity.title}</h1>
            </button>
          )}
        </div>
        <button
          type="button"
          className="profile-close-button"
          onClick={onClose}
          aria-label="Close activity panel"
        >
          <X size={18} aria-hidden="true" />
        </button>
      </header>

      {saveError ? (
        <p className="activity-panel-error" role="alert">
          <CircleAlert size={15} aria-hidden="true" />
          <span>{saveError}</span>
        </p>
      ) : null}

      <ActivityImageStrip
        mediaItems={mediaItems}
        isLoading={isMediaLoading}
        isUploading={isMediaUploading}
        error={mediaError}
        onUploadFiles={onUploadMedia}
        onReorder={onReorderMedia}
        onOpenPreview={onOpenMediaPreview}
      />

      <label>
        {draft.title.trim() || 'Activity'} description
        <textarea
          aria-label={`${draft.title.trim() || 'Activity'} description`}
          value={draft.description}
          onChange={(event) => updateDraft('description', event.target.value)}
          onBlur={() => void commitDraft('description')}
        />
      </label>
      <label>
        {draft.title.trim() || 'Activity'} notes
        <textarea
          aria-label={`${draft.title.trim() || 'Activity'} notes`}
          value={draft.notes}
          onChange={(event) => updateDraft('notes', event.target.value)}
          onBlur={() => void commitDraft('notes')}
        />
      </label>
    </aside>
  );
}
