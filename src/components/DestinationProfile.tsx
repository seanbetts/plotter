import { Check, CircleAlert, Copy, LoaderCircle, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { formatLocationParts } from '../domain/locations';
import type { Destination } from '../domain/types';

type DestinationPatch = Partial<Omit<Destination, 'id' | 'createdAt' | 'updatedAt'>>;

type DestinationFormState = {
  sourceKey: string;
  name: string;
  expectedStayDays: string;
  tags: string[];
  tagInput: string;
};

type DestinationProfileProps = {
  destination: Destination;
  stopNumber?: number;
  onUpdate: (destinationId: string, patch: DestinationPatch) => Promise<void> | void;
  onClose: () => void;
};

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const autosaveDelayMs = 700;
const savedStatusVisibleMs = 2400;

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
const formatStopNumber = (stopNumber: number) => String(stopNumber).padStart(2, '0');
const formatCoordinateValue = (coordinate: number) => String(coordinate);
const listsMatch = (left: string[], right: string[]) =>
  left.length === right.length && left.every((item, index) => item === right[index]);

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

export function DestinationProfile({ destination, stopNumber, onUpdate, onClose }: DestinationProfileProps) {
  return (
    <DestinationProfileForm
      key={destination.id}
      destination={destination}
      stopNumber={stopNumber}
      onUpdate={onUpdate}
      onClose={onClose}
    />
  );
}

function DestinationProfileForm({ destination, stopNumber, onUpdate, onClose }: DestinationProfileProps) {
  const [draft, setDraft] = useState(() => createFormState(destination));
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [isEditingName, setIsEditingName] = useState(false);
  const autosaveTimerRef = useRef<number | null>(null);
  const savedStatusTimerRef = useRef<number | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
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

  const saveStatusText = statusTextForSaveStatus(saveStatus);
  const saveStatusClassName = ['profile-save-status', saveStatus !== 'idle' ? `is-${saveStatus}` : '']
    .filter(Boolean)
    .join(' ');
  const latitudeText = formatCoordinateValue(destination.coordinates.lat);
  const longitudeText = formatCoordinateValue(destination.coordinates.lng);
  const coordinatesText = `${latitudeText}, ${longitudeText}`;

  function copyCoordinate(value: string) {
    void navigator.clipboard?.writeText(value);
  }

  return (
    <aside className="destination-profile" aria-label={`${destination.name} profile`}>
      <header className="profile-header" aria-label="Stop detail header">
        <div>
          {stopNumber ? <span className="profile-stop-number">Stop {formatStopNumber(stopNumber)}</span> : null}
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
              aria-label={`Edit stop name ${form.name || destination.name}`}
              onClick={() => setIsEditingName(true)}
            >
              <h1>{form.name || destination.name}</h1>
            </button>
          )}
          <p>{formatLocationParts(destination.location) || 'Unassigned location'}</p>
          <div className="profile-coordinates" aria-label="Coordinates">
            <span className="profile-coordinate-pill">
              <span className="profile-coordinate-label">Latitude</span>
              <span className="profile-coordinate-value">{latitudeText}</span>
            </span>
            <span className="profile-coordinate-pill">
              <span className="profile-coordinate-label">Longitude</span>
              <span className="profile-coordinate-value">{longitudeText}</span>
            </span>
            <button
              type="button"
              className="profile-coordinate-copy"
              aria-label={`Copy coordinates ${coordinatesText}`}
              title="Copy coordinates"
              onClick={() => copyCoordinate(coordinatesText)}
            >
              <Copy size={13} aria-hidden="true" />
            </button>
          </div>
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

      <label>
        Expected stay days
        <input
          type="number"
          min="1"
          value={form.expectedStayDays}
          onChange={(event) => updateForm({ expectedStayDays: event.target.value })}
        />
      </label>
      <fieldset className="tag-editor" aria-label="Tags">
        <legend>Tags</legend>
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
    </aside>
  );
}
