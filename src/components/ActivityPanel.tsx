import { CircleAlert, X } from 'lucide-react';
import { useEffect, useState } from 'react';
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

export function ActivityPanel({
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
}: ActivityPanelProps) {
  return (
    <ActivityPanelForm
      key={activity.id}
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
}

function ActivityPanelForm({
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
}: ActivityPanelProps) {
  const [draft, setDraft] = useState(() => createActivityDraft(activity));
  const [saveError, setSaveError] = useState('');
  const sourceKey = activitySourceKey(activity);

  useEffect(() => {
    setDraft(createActivityDraft(activity));
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
    setDraft((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function commitDraft<Field extends ActivityDraftField>(field: Field) {
    const nextValue = draft[field];
    if (nextValue === activity[field]) return;

    setSaveError('');
    try {
      await Promise.resolve(onUpdateActivity(activity.id, { [field]: nextValue }));
    } catch {
      setDraft((current) => ({
        ...current,
        [field]: activity[field],
      }));
      setSaveError('Unable to update activity.');
    }
  }

  return (
    <aside className="activity-panel" aria-label={`${activity.title} activity`}>
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
