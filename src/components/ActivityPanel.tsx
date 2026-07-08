import { Check, CircleAlert, Copy, Pencil, X } from 'lucide-react';
import { forwardRef, useEffect, useRef, useState } from 'react';
import type { ClipboardEvent, CSSProperties, KeyboardEvent, Ref } from 'react';
import { formatLocationContext } from '../domain/locations';
import type { Activity, ActivityLocation, Coordinates, MediaItem } from '../domain/types';
import type { LinkPreviewClient } from '../services/linkPreviewClient';
import type {
  WebImageSearchClient,
  WebImageSearchResult,
  WebImageSearchStopContext,
} from '../services/webImageSearchClient';
import { ActivityImageStrip } from './ActivityImageStrip';
import { LinkPreviewGrid } from './LinkPreviewGrid';
import { TagEditor } from './TagEditor';
import { listsMatch } from './tagEditorModel';
import type { TagSuggestion } from './tagEditorModel';

type ActivityPanelProps = {
  activity: Activity;
  stopName: string;
  mediaItems: MediaItem[];
  mediaError: string | null;
  isMediaLoading: boolean;
  isMediaUploading: boolean;
  tagSuggestions?: TagSuggestion[];
  linkPreviewClient: LinkPreviewClient;
  onClose: () => void;
  onUpdateActivity: (
    activityId: string,
    patch: Partial<Pick<Activity, 'title' | 'description' | 'notes' | 'tags' | 'links' | 'location'>>,
  ) => Promise<void> | void;
  onUploadMedia: (files: File[]) => Promise<void> | void;
  onReorderMedia: (orderedMediaIds: string[]) => Promise<void> | void;
  onOpenMediaPreview: (mediaId: string) => void;
  webImageSearchClient?: WebImageSearchClient;
  webImageSearchContext?: WebImageSearchStopContext;
  onImportWebImage?: (result: WebImageSearchResult) => Promise<void> | void;
};

type ActivityDraft = Pick<Activity, 'title' | 'notes' | 'tags' | 'links'>;
type ActivityDraftField = keyof ActivityDraft;
type CoordinateDraft = {
  lat: string;
  lng: string;
};

function createActivityDraft(activity: Activity): ActivityDraft {
  return {
    title: activity.title,
    notes: activity.notes,
    tags: activity.tags,
    links: activity.links,
  };
}

function activitySourceKey(activity: Activity) {
  return `${activity.id}:${activity.updatedAt}`;
}

function draftValuesMatch(left: ActivityDraft[ActivityDraftField], right: ActivityDraft[ActivityDraftField]) {
  if (Array.isArray(left) && Array.isArray(right)) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  return left === right;
}

const profileTitleControlStyle = {
  '--profile-title-block-padding': '0px',
  '--profile-title-inline-padding': '0px',
} as CSSProperties;
const missingLocationText = 'TBC';

function formatCoordinate(value: number) {
  return value.toFixed(4);
}

function formatCoordinatePair(coordinates: Coordinates) {
  return `${formatCoordinate(coordinates.lat)}, ${formatCoordinate(coordinates.lng)}`;
}

function createCoordinateDraft(coordinates: Coordinates | undefined): CoordinateDraft {
  return {
    lat: coordinates ? formatCoordinate(coordinates.lat) : '',
    lng: coordinates ? formatCoordinate(coordinates.lng) : '',
  };
}

function parseCoordinateDraft(draft: CoordinateDraft):
  | { type: 'valid'; coordinates: Coordinates }
  | { type: 'error'; error: string } {
  const lat = Number(draft.lat);
  const lng = Number(draft.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { type: 'error', error: 'Enter valid numeric coordinates.' };
  }

  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { type: 'error', error: 'Latitude must be -90 to 90 and longitude -180 to 180.' };
  }

  return { type: 'valid', coordinates: { lat, lng } };
}

function parsePastedCoordinatePair(value: string): CoordinateDraft | null {
  const parts = value
    .trim()
    .split(',')
    .map((part) => part.trim());

  if (parts.length !== 2 || parts.some((part) => part === '')) return null;

  const parsed = parseCoordinateDraft({ lat: parts[0], lng: parts[1] });
  if (parsed.type === 'error') return null;

  return { lat: parts[0], lng: parts[1] };
}

function createManualActivityLocation(title: string, coordinates: Coordinates): ActivityLocation {
  return {
    name: title.trim() || 'Activity',
    address: missingLocationText,
    coordinates,
    sourceProvider: 'manual',
  };
}

export const ActivityPanel = forwardRef<HTMLElement, ActivityPanelProps>(function ActivityPanel({
  activity,
  stopName,
  mediaItems,
  mediaError,
  isMediaLoading,
  isMediaUploading,
  tagSuggestions = [],
  linkPreviewClient,
  onClose,
  onUpdateActivity,
  onUploadMedia,
  onReorderMedia,
  onOpenMediaPreview,
  webImageSearchClient,
  webImageSearchContext,
  onImportWebImage,
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
      tagSuggestions={tagSuggestions}
      linkPreviewClient={linkPreviewClient}
      onClose={onClose}
      onUpdateActivity={onUpdateActivity}
      onUploadMedia={onUploadMedia}
      onReorderMedia={onReorderMedia}
      onOpenMediaPreview={onOpenMediaPreview}
      webImageSearchClient={webImageSearchClient}
      webImageSearchContext={webImageSearchContext}
      onImportWebImage={onImportWebImage}
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
  tagSuggestions = [],
  linkPreviewClient,
  onClose,
  onUpdateActivity,
  onUploadMedia,
  onReorderMedia,
  onOpenMediaPreview,
  webImageSearchClient,
  webImageSearchContext,
  onImportWebImage,
}: ActivityPanelProps & { panelRef: Ref<HTMLElement> }) {
  const [draft, setDraft] = useState(() => createActivityDraft(activity));
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isEditingCoordinates, setIsEditingCoordinates] = useState(false);
  const [coordinateDraft, setCoordinateDraft] = useState(() => createCoordinateDraft(activity.location?.coordinates));
  const [coordinateError, setCoordinateError] = useState('');
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle');
  const [saveError, setSaveError] = useState('');
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const latitudeInputRef = useRef<HTMLInputElement | null>(null);
  const copyFeedbackTimerRef = useRef<number | null>(null);
  const latestDraftRef = useRef(createActivityDraft(activity));
  const dirtyFieldsRef = useRef(new Set<ActivityDraftField>());
  const fieldEditRevisionRef = useRef<Record<ActivityDraftField, number>>({
    title: 0,
    notes: 0,
    tags: 0,
    links: 0,
  });
  const fieldSaveRevisionRef = useRef<Record<ActivityDraftField, number>>({
    title: 0,
    notes: 0,
    tags: 0,
    links: 0,
  });
  const sourceKey = activitySourceKey(activity);
  const activityTitle = activity.title;
  const activityNotes = activity.notes;
  const activityTags = activity.tags;
  const activityLinks = activity.links;
  const activityLocation = activity.location;
  const activityCoordinates = activityLocation?.coordinates;
  const activityDisplayTitle = draft.title || activityTitle;
  const activityAddressContext = activityLocation?.address
    ? formatLocationContext(activityLocation.address, activityDisplayTitle)
    : '';
  const activityAddressText = activityAddressContext || missingLocationText;

  useEffect(() => {
    setDraft((current) => {
      const shouldPreserveDraft = <Field extends ActivityDraftField>(
        field: Field,
        persistedValue: ActivityDraft[Field],
      ) => dirtyFieldsRef.current.has(field) && !draftValuesMatch(current[field], persistedValue);
      const acceptPersistedField = (field: ActivityDraftField) => {
        dirtyFieldsRef.current.delete(field);
      };

      if (!shouldPreserveDraft('title', activityTitle)) acceptPersistedField('title');
      if (!shouldPreserveDraft('notes', activityNotes)) acceptPersistedField('notes');
      if (!shouldPreserveDraft('tags', activityTags)) acceptPersistedField('tags');
      if (!shouldPreserveDraft('links', activityLinks)) acceptPersistedField('links');

      const nextDraft = {
        title: dirtyFieldsRef.current.has('title') ? current.title : activityTitle,
        notes: dirtyFieldsRef.current.has('notes') ? current.notes : activityNotes,
        tags: dirtyFieldsRef.current.has('tags') ? current.tags : activityTags,
        links: dirtyFieldsRef.current.has('links') ? current.links : activityLinks,
      };

      latestDraftRef.current = nextDraft;
      return nextDraft;
    });
    setSaveError('');
    setCoordinateError('');
    setCoordinateDraft(createCoordinateDraft(activityCoordinates));
  }, [
    activityLinks,
    activityCoordinates,
    activityNotes,
    activityTags,
    activityTitle,
    sourceKey,
  ]);

  useEffect(() => {
    if (isEditingTitle) {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }
  }, [isEditingTitle]);

  useEffect(() => {
    if (isEditingCoordinates) {
      latitudeInputRef.current?.focus();
      latitudeInputRef.current?.select();
    }
  }, [isEditingCoordinates]);

  useEffect(
    () => () => {
      if (copyFeedbackTimerRef.current !== null) {
        window.clearTimeout(copyFeedbackTimerRef.current);
      }
    },
    [],
  );

  function updateDraft<Field extends ActivityDraftField>(field: Field, value: ActivityDraft[Field]) {
    setSaveError('');
    dirtyFieldsRef.current.add(field);
    fieldEditRevisionRef.current[field] += 1;
    const nextDraft = {
      ...latestDraftRef.current,
      [field]: value,
    };
    latestDraftRef.current = nextDraft;
    setDraft(nextDraft);
  }

  async function commitDraft<Field extends ActivityDraftField>(field: Field) {
    const nextValue = latestDraftRef.current[field];
    if (draftValuesMatch(nextValue, activity[field])) {
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
      draftValuesMatch(latestDraftRef.current[field], submittedValue)
    );
  }

  function updateTags(tags: string[]) {
    if (listsMatch(tags, latestDraftRef.current.tags)) return;

    updateDraft('tags', tags);
    void commitDraft('tags');
  }

  function startEditingCoordinates() {
    setCoordinateDraft(createCoordinateDraft(activityCoordinates));
    setCoordinateError('');
    setIsEditingCoordinates(true);
  }

  function cancelEditingCoordinates() {
    setCoordinateDraft(createCoordinateDraft(activityCoordinates));
    setCoordinateError('');
    setIsEditingCoordinates(false);
  }

  async function saveCoordinates() {
    const parsed = parseCoordinateDraft(coordinateDraft);
    if (parsed.type === 'error') {
      setCoordinateError(parsed.error);
      return;
    }

    setCoordinateError('');
    try {
      await Promise.resolve(
        onUpdateActivity(activity.id, {
          location: activityLocation
            ? {
                ...activityLocation,
                coordinates: parsed.coordinates,
              }
            : createManualActivityLocation(activityDisplayTitle, parsed.coordinates),
        }),
      );
      setIsEditingCoordinates(false);
    } catch {
      setCoordinateError('Unable to update coordinates.');
    }
  }

  function handleCoordinatePaste(event: ClipboardEvent<HTMLInputElement>) {
    const pastedPair = parsePastedCoordinatePair(event.clipboardData.getData('text'));
    if (!pastedPair) return;

    event.preventDefault();
    setCoordinateError('');
    setCoordinateDraft(pastedPair);
  }

  function handleCoordinateInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      void saveCoordinates();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      cancelEditingCoordinates();
    }
  }

  async function copyCoordinate(value: string) {
    if (!navigator.clipboard) return;

    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus('copied');
      if (copyFeedbackTimerRef.current !== null) {
        window.clearTimeout(copyFeedbackTimerRef.current);
      }
      copyFeedbackTimerRef.current = window.setTimeout(() => {
        setCopyStatus('idle');
        copyFeedbackTimerRef.current = null;
      }, 1600);
    } catch {
      setCopyStatus('idle');
    }
  }

  const coordinatesText = activityCoordinates ? formatCoordinatePair(activityCoordinates) : '';
  const latitudeText = activityCoordinates ? formatCoordinate(activityCoordinates.lat) : missingLocationText;
  const longitudeText = activityCoordinates ? formatCoordinate(activityCoordinates.lng) : missingLocationText;
  const copyButtonClassName = ['profile-coordinate-copy', copyStatus === 'copied' ? 'is-copied' : '']
    .filter(Boolean)
    .join(' ');
  const tagsLabel = `${activityDisplayTitle.trim() || 'Activity'} Tags`;
  const linksLabel = `${activityDisplayTitle.trim() || 'Activity'} Links`;
  const detailsLabel = `${activityDisplayTitle.trim() || 'Activity'} Details`;

  return (
    <aside ref={panelRef} className="activity-panel" aria-label={`${activity.title} activity`}>
      <header className="profile-header" aria-label="Activity detail header">
        <div className="profile-header-main">
          <span className="profile-stop-number">{stopName}</span>
          {isEditingTitle ? (
            <label className="profile-title-editor profile-title-control" style={profileTitleControlStyle}>
              <span className="sr-only">Activity title</span>
              <input
                ref={titleInputRef}
                className="profile-title-input"
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
              aria-label={`Edit activity title ${activityDisplayTitle}`}
              onClick={() => setIsEditingTitle(true)}
            >
              <h1>{activityDisplayTitle}</h1>
            </button>
          )}
          <p className="profile-location-address activity-location-address">{activityAddressText}</p>
          {isEditingCoordinates ? (
            <div className="profile-coordinate-editor" aria-label="Edit coordinates">
              <label className="profile-coordinate-input-pill profile-coordinate-field">
                <span className="profile-coordinate-label">Latitude</span>
                <input
                  ref={latitudeInputRef}
                  aria-label="Latitude"
                  inputMode="decimal"
                  value={coordinateDraft.lat}
                  onChange={(event) =>
                    setCoordinateDraft((current) => ({ ...current, lat: event.target.value }))
                  }
                  onPaste={handleCoordinatePaste}
                  onKeyDown={handleCoordinateInputKeyDown}
                />
              </label>
              <label className="profile-coordinate-input-pill profile-coordinate-field">
                <span className="profile-coordinate-label">Longitude</span>
                <input
                  aria-label="Longitude"
                  inputMode="decimal"
                  value={coordinateDraft.lng}
                  onChange={(event) =>
                    setCoordinateDraft((current) => ({ ...current, lng: event.target.value }))
                  }
                  onPaste={handleCoordinatePaste}
                  onKeyDown={handleCoordinateInputKeyDown}
                />
              </label>
              <button
                type="button"
                className="profile-coordinate-action"
                aria-label="Save coordinates"
                title="Save coordinates"
                onClick={() => void saveCoordinates()}
              >
                <Check size={13} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="profile-coordinate-action"
                aria-label="Cancel coordinate edits"
                title="Cancel coordinate edits"
                onClick={cancelEditingCoordinates}
              >
                <X size={13} aria-hidden="true" />
              </button>
              {coordinateError ? (
                <p className="profile-coordinate-error" role="alert">
                  {coordinateError}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="profile-coordinates" aria-label="Coordinates">
              <span className="profile-coordinate-pill profile-coordinate-field">
                <span className="profile-coordinate-label">Latitude</span>
                <span className="profile-coordinate-value">{latitudeText}</span>
              </span>
              <span className="profile-coordinate-pill profile-coordinate-field">
                <span className="profile-coordinate-label">Longitude</span>
                <span className="profile-coordinate-value">{longitudeText}</span>
              </span>
              <button
                type="button"
                className="profile-coordinate-action"
                aria-label="Edit coordinates"
                title="Edit coordinates"
                onClick={startEditingCoordinates}
              >
                <Pencil size={13} aria-hidden="true" />
              </button>
              {activityCoordinates ? (
                <button
                  type="button"
                  className={copyButtonClassName}
                  aria-label={`Copy coordinates ${coordinatesText}`}
                  title="Copy coordinates"
                  onClick={() => void copyCoordinate(coordinatesText)}
                >
                  {copyStatus === 'copied' ? (
                    <Check size={13} aria-hidden="true" />
                  ) : (
                    <Copy size={13} aria-hidden="true" />
                  )}
                </button>
              ) : null}
            </div>
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
        webImageSearchClient={webImageSearchClient}
        webImageSearchContext={webImageSearchContext}
        onImportWebImage={onImportWebImage}
      />

      <LinkPreviewGrid
        label={linksLabel}
        links={draft.links}
        previewClient={linkPreviewClient}
        onChange={(links) => {
          updateDraft('links', links);
          return commitDraft('links');
        }}
      />

      <section className="activity-details-section" aria-label={detailsLabel}>
        <div className="activity-details-header">
          <h2>{detailsLabel}</h2>
        </div>
        <label>
          {draft.title.trim() || 'Activity'} Notes
          <textarea
            aria-label={`${draft.title.trim() || 'Activity'} Notes`}
            value={draft.notes}
            onChange={(event) => updateDraft('notes', event.target.value)}
            onBlur={() => void commitDraft('notes')}
          />
        </label>
      </section>
      <TagEditor
        label={tagsLabel}
        tags={draft.tags}
        suggestions={tagSuggestions}
        onChange={updateTags}
      />
    </aside>
  );
}
