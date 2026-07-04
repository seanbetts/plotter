import { Check, CircleAlert, Copy, LoaderCircle, Pencil, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClipboardEvent, CSSProperties, KeyboardEvent } from 'react';
import type { PlaceSearchResult } from '../adapters/geocoding';
import { formatLocationContext, formatLocationParts } from '../domain/locations';
import type { Activity, ActivityLocation, Destination, MediaItem, MediaRollupItem } from '../domain/types';
import { ActivityList } from './ActivityList';
import { DestinationImageStrip } from './DestinationImageStrip';
import { formatStopHeaderLabel } from './stopLabels';

type DestinationPatch = Partial<Omit<Destination, 'id' | 'createdAt' | 'updatedAt'>>;

type DestinationFormState = {
  sourceKey: string;
  name: string;
  expectedStayDays: string;
  tags: string[];
  tagInput: string;
};

type CreateActivityInput = { title: string; location?: ActivityLocation };
type CreateActivityHandler =
  | ((destinationId: string, input: CreateActivityInput) => Promise<void> | void)
  | ((destinationId: string, title: string) => Promise<void> | void);

type DestinationProfileProps = {
  destination: Destination;
  activities: Activity[];
  selectedActivityId: string | null;
  stopNumber?: number;
  mediaItems: MediaItem[];
  mediaRollupItems?: MediaRollupItem[];
  isMediaLoading: boolean;
  isMediaUploading: boolean;
  mediaError: string | null;
  onSelectActivity: (activityId: string) => void;
  onCreateActivity: CreateActivityHandler;
  searchActivities?: (query: string) => Promise<PlaceSearchResult[]>;
  onDeleteActivity: (activityId: string) => Promise<void> | void;
  onReorderActivities: (
    destinationId: string,
    orderedActivityIds: string[],
  ) => Promise<unknown> | unknown;
  onUpdate: (destinationId: string, patch: DestinationPatch) => Promise<void> | void;
  onUploadMedia: (files: File[]) => Promise<void> | void;
  onReorderMedia: (orderedMediaIds: string[]) => Promise<void> | void;
  onOpenMediaPreview: (mediaId: string) => void;
  onClose: () => void;
};

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
type CoordinateDraft = {
  lat: string;
  lng: string;
};
type CoordinateDraftResult =
  | { type: 'valid'; coordinates: { lat: number; lng: number } }
  | { type: 'error'; error: string };

const autosaveDelayMs = 700;
const savedStatusVisibleMs = 2400;
const copiedStatusVisibleMs = 1600;
const emptyActivitySearch = async (): Promise<PlaceSearchResult[]> => [];

const splitTagInput = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const tagKey = (tag: string) => tag.toLocaleLowerCase();

const addUniqueTags = (currentTags: string[], newTags: string[]) => {
  const existingTags = new Set(currentTags.map(tagKey));
  const additions = newTags.filter((tag) => {
    const key = tagKey(tag);
    if (existingTags.has(key)) {
      return false;
    }

    existingTags.add(key);
    return true;
  });

  return [...currentTags, ...additions];
};

const normalizeExpectedStayDays = (value: string) => {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return 1;
  }

  return Math.max(1, Math.floor(parsed));
};

const destinationSourceKey = (destination: Destination) => `${destination.id}:${destination.updatedAt}`;
const profileTitleControlStyle = {
  '--profile-title-block-padding': '0px',
  '--profile-title-inline-padding': '0px',
} as CSSProperties;
const coordinateDecimalPlaces = 5;
const normalizeCoordinateValue = (coordinate: number) => {
  const rounded = Number(coordinate.toFixed(coordinateDecimalPlaces));

  return Object.is(rounded, -0) ? 0 : rounded;
};
const formatCoordinateValue = (coordinate: number) => String(normalizeCoordinateValue(coordinate));
const listsMatch = (left: string[], right: string[]) =>
  left.length === right.length && left.every((item, index) => item === right[index]);
const createCoordinateDraft = (destination: Destination): CoordinateDraft => ({
  lat: formatCoordinateValue(destination.coordinates.lat),
  lng: formatCoordinateValue(destination.coordinates.lng),
});

function parsePastedCoordinatePair(value: string): CoordinateDraft | null {
  const parts = value
    .trim()
    .split(',')
    .map((part) => part.trim());

  if (parts.length !== 2 || parts.some((part) => part === '')) return null;

  const lat = Number(parts[0]);
  const lng = Number(parts[1]);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return null;
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) return null;

  return { lat: parts[0], lng: parts[1] };
}

const createFormState = (destination: Destination): DestinationFormState => ({
  sourceKey: destinationSourceKey(destination),
  name: destination.name,
  expectedStayDays: String(destination.timing.expectedStayDays),
  tags: destination.tags,
  tagInput: '',
});

function statusTextForSaveStatus(saveStatus: SaveStatus) {
  if (saveStatus === 'saving') return 'Saving...';
  if (saveStatus === 'saved') return 'Saved';
  if (saveStatus === 'error') return 'Unable to save';

  return '';
}

const createPatchFromForm = (
  form: DestinationFormState,
  destination: Destination,
): DestinationPatch | null => {
  const name = form.name.trim() || destination.name;
  const expectedStayDays = normalizeExpectedStayDays(form.expectedStayDays);
  const tags = form.tags;
  const hasChanges =
    name !== destination.name ||
    expectedStayDays !== destination.timing.expectedStayDays ||
    !listsMatch(tags, destination.tags);

  if (!hasChanges) {
    return null;
  }

  return {
    name,
    location: destination.location,
    timing: {
      ...destination.timing,
      expectedStayDays,
    },
    tags,
  };
};

export function DestinationProfile(props: DestinationProfileProps) {
  return (
    <DestinationProfileForm
      key={props.destination.id}
      {...props}
    />
  );
}

function DestinationProfileForm({
  destination,
  activities,
  selectedActivityId,
  stopNumber,
  mediaItems,
  mediaRollupItems,
  isMediaLoading,
  isMediaUploading,
  mediaError,
  onSelectActivity,
  onCreateActivity,
  searchActivities,
  onDeleteActivity,
  onReorderActivities,
  onUpdate,
  onUploadMedia,
  onReorderMedia,
  onOpenMediaPreview,
  onClose,
}: DestinationProfileProps) {
  const [draft, setDraft] = useState(() => createFormState(destination));
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle');
  const [isEditingName, setIsEditingName] = useState(false);
  const [isEditingCoordinates, setIsEditingCoordinates] = useState(false);
  const [coordinateDraft, setCoordinateDraft] = useState(() => createCoordinateDraft(destination));
  const [coordinateError, setCoordinateError] = useState('');
  const autosaveTimerRef = useRef<number | null>(null);
  const savedStatusTimerRef = useRef<number | null>(null);
  const copyFeedbackTimerRef = useRef<number | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const latitudeInputRef = useRef<HTMLInputElement | null>(null);
  const editRevisionRef = useRef(0);
  const savedRevisionRef = useRef(0);
  const saveSequenceRef = useRef(0);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const latestDestinationIdRef = useRef(destination.id);
  const sourceKeyRef = useRef(destinationSourceKey(destination));
  const sourceKey = destinationSourceKey(destination);
  const form = draft;

  useEffect(
    () => () => {
      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current);
      }
      if (savedStatusTimerRef.current !== null) {
        window.clearTimeout(savedStatusTimerRef.current);
      }
      if (copyFeedbackTimerRef.current !== null) {
        window.clearTimeout(copyFeedbackTimerRef.current);
      }
      saveSequenceRef.current += 1;
    },
    [],
  );

  useEffect(() => {
    latestDestinationIdRef.current = destination.id;
  }, [destination.id]);

  useEffect(() => {
    if (sourceKeyRef.current === sourceKey) return;

    sourceKeyRef.current = sourceKey;
    if (editRevisionRef.current > savedRevisionRef.current) return;

    setDraft(createFormState(destination));
  }, [destination, sourceKey]);

  useEffect(() => {
    if (isEditingName) {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }
  }, [isEditingName]);

  useEffect(() => {
    if (isEditingCoordinates) {
      latitudeInputRef.current?.focus();
      latitudeInputRef.current?.select();
    }
  }, [isEditingCoordinates]);

  const autosave = useCallback(
    async (
      destinationId: string,
      draftRevision: number,
      patch: DestinationPatch,
    ) => {
      const saveSequence = saveSequenceRef.current + 1;
      saveSequenceRef.current = saveSequence;
      setSaveStatus('saving');

      const runSave = () => Promise.resolve(onUpdate(destinationId, patch));
      const savePromise = saveChainRef.current.then(runSave, runSave);
      saveChainRef.current = savePromise.catch(() => undefined);

      try {
        await savePromise;
        if (
          latestDestinationIdRef.current !== destinationId ||
          saveSequenceRef.current !== saveSequence ||
          editRevisionRef.current !== draftRevision
        ) {
          return;
        }

        savedRevisionRef.current = Math.max(savedRevisionRef.current, draftRevision);
        setSaveStatus('saved');
        if (savedStatusTimerRef.current !== null) {
          window.clearTimeout(savedStatusTimerRef.current);
        }
        savedStatusTimerRef.current = window.setTimeout(() => {
          setSaveStatus('idle');
          savedStatusTimerRef.current = null;
        }, savedStatusVisibleMs);
      } catch {
        if (
          latestDestinationIdRef.current !== destinationId ||
          saveSequenceRef.current !== saveSequence ||
          editRevisionRef.current !== draftRevision
        ) {
          return;
        }

        setSaveStatus('error');
      }
    },
    [onUpdate],
  );

  useEffect(() => {
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }

    const patch = createPatchFromForm(form, destination);
    const draftRevision = editRevisionRef.current;
    if (!patch || draftRevision <= savedRevisionRef.current) {
      return undefined;
    }

    autosaveTimerRef.current = window.setTimeout(() => {
      autosaveTimerRef.current = null;
      void autosave(destination.id, draftRevision, patch);
    }, autosaveDelayMs);

    return () => {
      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [autosave, destination, form]);

  function updateForm(patch: Partial<DestinationFormState>) {
    editRevisionRef.current += 1;
    if (savedStatusTimerRef.current !== null) {
      window.clearTimeout(savedStatusTimerRef.current);
      savedStatusTimerRef.current = null;
    }
    setSaveStatus('idle');
    setDraft((current) => ({ ...current, ...patch }));
  }

  function updateTagInput(tagInput: string) {
    setDraft((current) => ({ ...current, tagInput }));
  }

  function commitTagInput() {
    const nextTags = addUniqueTags(form.tags, splitTagInput(form.tagInput));
    if (listsMatch(nextTags, form.tags)) {
      updateTagInput('');
      return;
    }

    updateForm({ tags: nextTags, tagInput: '' });
  }

  function removeTag(tagToRemove: string) {
    updateForm({ tags: form.tags.filter((tag) => tag !== tagToRemove) });
  }

  function startEditingCoordinates() {
    setCoordinateDraft(createCoordinateDraft(destination));
    setCoordinateError('');
    setIsEditingCoordinates(true);
  }

  function cancelEditingCoordinates() {
    setCoordinateDraft(createCoordinateDraft(destination));
    setCoordinateError('');
    setIsEditingCoordinates(false);
  }

  function parseCoordinateDraft(): CoordinateDraftResult {
    const lat = Number(coordinateDraft.lat);
    const lng = Number(coordinateDraft.lng);

    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      return { type: 'error', error: 'Latitude must be a number between -90 and 90.' };
    }

    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      return { type: 'error', error: 'Longitude must be a number between -180 and 180.' };
    }

    return {
      type: 'valid',
      coordinates: {
        lat: normalizeCoordinateValue(lat),
        lng: normalizeCoordinateValue(lng),
      },
    };
  }

  async function saveCoordinates() {
    const result = parseCoordinateDraft();

    if (result.type === 'error') {
      setCoordinateError(result.error);
      return;
    }

    setCoordinateError('');
    if (
      result.coordinates.lat !== destination.coordinates.lat ||
      result.coordinates.lng !== destination.coordinates.lng
    ) {
      await Promise.resolve(onUpdate(destination.id, { coordinates: result.coordinates }));
    }
    setIsEditingCoordinates(false);
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

  function handleCoordinatePaste(event: ClipboardEvent<HTMLInputElement>) {
    const pastedPair = parsePastedCoordinatePair(event.clipboardData.getData('text'));
    if (!pastedPair) return;

    event.preventDefault();
    setCoordinateError('');
    setCoordinateDraft(pastedPair);
  }

  const saveStatusText = statusTextForSaveStatus(saveStatus);
  const saveStatusClassName = ['profile-save-status', saveStatus !== 'idle' ? `is-${saveStatus}` : '']
    .filter(Boolean)
    .join(' ');
  const latitudeText = formatCoordinateValue(destination.coordinates.lat);
  const longitudeText = formatCoordinateValue(destination.coordinates.lng);
  const coordinatesText = `${latitudeText}, ${longitudeText}`;
  const destinationTitle = form.name || destination.name;
  const destinationLocationLabel = formatLocationParts(destination.location);
  const destinationLocationContext = destinationLocationLabel
    ? formatLocationContext(destinationLocationLabel, destinationTitle)
    : '';
  const tagsLabel = `${destinationTitle.trim() || destination.name} Tags`;
  const copyButtonClassName = ['profile-coordinate-copy', copyStatus === 'copied' ? 'is-copied' : '']
    .filter(Boolean)
    .join(' ');

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
      }, copiedStatusVisibleMs);
    } catch {
      setCopyStatus('idle');
    }
  }

  function createProfileActivity(input: CreateActivityInput) {
    if (!searchActivities && !input.location) {
      return (onCreateActivity as (destinationId: string, title: string) => Promise<void> | void)(
        destination.id,
        input.title,
      );
    }

    return (onCreateActivity as (destinationId: string, input: CreateActivityInput) => Promise<void> | void)(
      destination.id,
      input,
    );
  }

  return (
    <aside className="destination-profile" aria-label={`${destination.name} profile`}>
      <header className="profile-header" aria-label="Stop detail header">
        <div className="profile-header-main">
          {stopNumber ? <span className="profile-stop-number">{formatStopHeaderLabel(stopNumber)}</span> : null}
          {isEditingName ? (
            <label className="profile-title-editor profile-title-control" style={profileTitleControlStyle}>
              <span className="sr-only">Stop name</span>
              <input
                ref={nameInputRef}
                className="profile-title-input"
                value={form.name}
                onChange={(event) => updateForm({ name: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    setIsEditingName(false);
                  }
                }}
              />
            </label>
          ) : (
            <button
              type="button"
              className="profile-title-button profile-title-control"
              style={profileTitleControlStyle}
              aria-label={`Edit stop name ${destinationTitle}`}
              onClick={() => setIsEditingName(true)}
            >
              <h1>{destinationTitle}</h1>
            </button>
          )}
          <p className="profile-location-address">
            {destinationLocationLabel ? destinationLocationContext : 'Unassigned location'}
          </p>
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
            </div>
          )}
        </div>
        <div className="profile-header-actions">
          {saveStatus !== 'idle' ? (
            <div
              className={saveStatusClassName}
              role="status"
              aria-live="polite"
              aria-label={saveStatusText}
              title={saveStatusText}
            >
              {saveStatus === 'saving' ? <LoaderCircle size={16} aria-hidden="true" /> : null}
              {saveStatus === 'saved' ? <Check size={16} aria-hidden="true" /> : null}
              {saveStatus === 'error' ? <CircleAlert size={16} aria-hidden="true" /> : null}
              <span className="sr-only">{saveStatusText}</span>
            </div>
          ) : null}
          <button
            type="button"
            className="profile-close-button"
            onClick={onClose}
            aria-label="Close destination profile"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
      </header>

      <DestinationImageStrip
        destinationName={form.name || destination.name}
        mediaItems={mediaItems}
        mediaRollupItems={mediaRollupItems}
        isLoading={isMediaLoading}
        isUploading={isMediaUploading}
        error={mediaError}
        onUploadFiles={onUploadMedia}
        onReorder={onReorderMedia}
        onOpenPreview={onOpenMediaPreview}
      />

      <label>
        Expected stay days
        <input
          type="number"
          min="1"
          value={form.expectedStayDays}
          onChange={(event) => updateForm({ expectedStayDays: event.target.value })}
        />
      </label>
      <fieldset className="tag-editor" aria-label={tagsLabel}>
        <legend>{tagsLabel}</legend>
        <div className="tag-pill-list">
          {form.tags.map((tag) => (
            <button
              key={tag}
              type="button"
              className="tag-pill"
              aria-label={`Remove tag ${tag}`}
              onClick={() => removeTag(tag)}
            >
              <span>{tag}</span>
              <X size={13} aria-hidden="true" />
            </button>
          ))}
          <input
            className="tag-pill-input"
            aria-label="Add tag"
            placeholder="Add tag"
            value={form.tagInput}
            onChange={(event) => updateTagInput(event.target.value)}
            onBlur={commitTagInput}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ',') {
                event.preventDefault();
                commitTagInput();
                return;
              }

              if (event.key === 'Backspace' && form.tagInput === '' && form.tags.length > 0) {
                event.preventDefault();
                updateForm({ tags: form.tags.slice(0, -1) });
              }
            }}
          />
        </div>
      </fieldset>

      <ActivityList
        activities={activities}
        selectedActivityId={selectedActivityId}
        onSelectActivity={onSelectActivity}
        onCreateActivity={createProfileActivity}
        searchActivities={searchActivities ?? emptyActivitySearch}
        onDeleteActivity={(activityId) => onDeleteActivity(activityId)}
        onReorderActivities={(orderedActivityIds) =>
          onReorderActivities(destination.id, orderedActivityIds)
        }
      />
    </aside>
  );
}
