import { CircleAlert, X } from 'lucide-react';
import { forwardRef, useEffect, useRef, useState } from 'react';
import type { Ref } from 'react';
import type { Activity, MediaItem } from '../domain/types';
import { ActivityImageStrip } from './ActivityImageStrip';

type ActivityPanelProps = {
  activity: Activity;
  mediaItems: MediaItem[];
  mediaError: string | null;
  isMediaLoading: boolean;
  isMediaUploading: boolean;
  onClose: () => void;
  onUpdateActivity: (
    activityId: string,
    patch: Partial<Pick<Activity, 'title' | 'description' | 'notes' | 'status' | 'priority'>>,
  ) => Promise<void> | void;
  onUploadMedia: (files: File[]) => Promise<void> | void;
  onReorderMedia: (orderedMediaIds: string[]) => Promise<void> | void;
  onOpenMediaPreview: (mediaId: string) => void;
};

type ActivityDraft = Pick<Activity, 'title' | 'description' | 'notes' | 'status' | 'priority'>;
type ActivityDraftField = keyof ActivityDraft;

const activityStatusOptions: Array<{ value: Activity['status']; label: string }> = [
  { value: 'idea', label: 'Idea' },
  { value: 'planned', label: 'Planned' },
  { value: 'booked', label: 'Booked' },
  { value: 'done', label: 'Done' },
  { value: 'skipped', label: 'Skipped' },
];

const activityPriorityOptions: Array<{ value: Activity['priority']; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'must-do', label: 'Must-do' },
];

function createActivityDraft(activity: Activity): ActivityDraft {
  return {
    title: activity.title,
    description: activity.description,
    notes: activity.notes,
    status: activity.status,
    priority: activity.priority,
  };
}

function activitySourceKey(activity: Activity) {
  return `${activity.id}:${activity.updatedAt}`;
}

export const ActivityPanel = forwardRef<HTMLElement, ActivityPanelProps>(function ActivityPanel({
  activity,
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
  const [saveError, setSaveError] = useState('');
  const latestDraftRef = useRef(createActivityDraft(activity));
  const dirtyFieldsRef = useRef(new Set<ActivityDraftField>());
  const fieldEditRevisionRef = useRef<Record<ActivityDraftField, number>>({
    title: 0,
    description: 0,
    notes: 0,
    status: 0,
    priority: 0,
  });
  const fieldSaveRevisionRef = useRef<Record<ActivityDraftField, number>>({
    title: 0,
    description: 0,
    notes: 0,
    status: 0,
    priority: 0,
  });
  const sourceKey = activitySourceKey(activity);

  useEffect(() => {
    setDraft((current) => {
      const shouldPreserveDraft = (field: ActivityDraftField) =>
        dirtyFieldsRef.current.has(field) && current[field] !== activity[field];
      const usePersistedField = (field: ActivityDraftField) => {
        dirtyFieldsRef.current.delete(field);
      };

      if (!shouldPreserveDraft('title')) usePersistedField('title');
      if (!shouldPreserveDraft('description')) usePersistedField('description');
      if (!shouldPreserveDraft('notes')) usePersistedField('notes');
      if (!shouldPreserveDraft('status')) usePersistedField('status');
      if (!shouldPreserveDraft('priority')) usePersistedField('priority');

      const nextDraft = {
        title: dirtyFieldsRef.current.has('title') ? current.title : activity.title,
        description: dirtyFieldsRef.current.has('description') ? current.description : activity.description,
        notes: dirtyFieldsRef.current.has('notes') ? current.notes : activity.notes,
        status: dirtyFieldsRef.current.has('status') ? current.status : activity.status,
        priority: dirtyFieldsRef.current.has('priority') ? current.priority : activity.priority,
      };

      latestDraftRef.current = nextDraft;
      return nextDraft;
    });
    setSaveError('');
  }, [
    activity.description,
    activity.notes,
    activity.priority,
    activity.status,
    activity.title,
    sourceKey,
  ]);

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
          <span className="profile-stop-number">Activity</span>
          <label className="activity-title-field">
            <span className="sr-only">Activity title</span>
            <input
              className="profile-title-input"
              aria-label="Activity title"
              value={draft.title}
              onChange={(event) => updateDraft('title', event.target.value)}
              onBlur={() => void commitDraft('title')}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
              }}
            />
          </label>
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

      <div className="activity-panel-field-grid">
        <label>
          Activity status
          <select
            aria-label="Activity status"
            value={draft.status}
            onChange={(event) => updateDraft('status', event.target.value as Activity['status'])}
            onBlur={() => void commitDraft('status')}
          >
            {activityStatusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Activity priority
          <select
            aria-label="Activity priority"
            value={draft.priority}
            onChange={(event) => updateDraft('priority', event.target.value as Activity['priority'])}
            onBlur={() => void commitDraft('priority')}
          >
            {activityPriorityOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label>
        Activity description
        <textarea
          aria-label="Activity description"
          value={draft.description}
          onChange={(event) => updateDraft('description', event.target.value)}
          onBlur={() => void commitDraft('description')}
        />
      </label>
      <label>
        Activity notes
        <textarea
          aria-label="Activity notes"
          value={draft.notes}
          onChange={(event) => updateDraft('notes', event.target.value)}
          onBlur={() => void commitDraft('notes')}
        />
      </label>
    </aside>
  );
}
