import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { formatLocationParts } from '../domain/locations';
import type { Destination } from '../domain/types';

type DestinationPatch = Partial<Omit<Destination, 'id' | 'createdAt' | 'updatedAt'>>;

type DestinationFormState = {
  sourceKey: string;
  name: string;
  expectedStayDays: string;
  tags: string;
};

type DestinationProfileProps = {
  destination: Destination;
  onUpdate: (destinationId: string, patch: DestinationPatch) => Promise<void> | void;
  onClose: () => void;
};

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const listToText = (items: string[]) => items.join(', ');

const textToList = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

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

const createFormState = (destination: Destination): DestinationFormState => ({
  sourceKey: destinationSourceKey(destination),
  name: destination.name,
  expectedStayDays: String(destination.timing.expectedStayDays),
  tags: listToText(destination.tags),
});

export function DestinationProfile({ destination, onUpdate, onClose }: DestinationProfileProps) {
  return (
    <DestinationProfileForm
      key={destination.id}
      destination={destination}
      onUpdate={onUpdate}
      onClose={onClose}
    />
  );
}

function DestinationProfileForm({ destination, onUpdate, onClose }: DestinationProfileProps) {
  const [draft, setDraft] = useState(() => createFormState(destination));
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [isEditingName, setIsEditingName] = useState(false);
  const savedTimerRef = useRef<number | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const sourceKey = destinationSourceKey(destination);
  const form = draft.sourceKey === sourceKey || saveStatus === 'saving' ? draft : createFormState(destination);

  useEffect(
    () => () => {
      if (savedTimerRef.current !== null) {
        window.clearTimeout(savedTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (isEditingName) {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }
  }, [isEditingName]);

  function updateForm(patch: Partial<DestinationFormState>) {
    if (savedTimerRef.current !== null) {
      window.clearTimeout(savedTimerRef.current);
      savedTimerRef.current = null;
    }
    setSaveStatus('idle');
    setDraft({ ...form, ...patch });
  }

  async function handleSave() {
    setSaveStatus('saving');
    try {
      await onUpdate(destination.id, {
        name: form.name.trim() || destination.name,
        location: destination.location,
        timing: {
          ...destination.timing,
          expectedStayDays: normalizeExpectedStayDays(form.expectedStayDays),
        },
        tags: textToList(form.tags),
      });
      setSaveStatus('saved');
      if (savedTimerRef.current !== null) {
        window.clearTimeout(savedTimerRef.current);
      }
      savedTimerRef.current = window.setTimeout(() => {
        setSaveStatus('idle');
        savedTimerRef.current = null;
      }, 1600);
    } catch {
      setSaveStatus('error');
    }
  }

  const saveButtonLabel =
    saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved' : 'Save destination';

  return (
    <aside className="destination-profile" aria-label={`${destination.name} profile`}>
      <header className="profile-header" aria-label="Stop detail header">
        <div>
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
        </div>
        <button
          type="button"
          className="profile-close-button"
          onClick={onClose}
          aria-label="Close destination profile"
        >
          <X size={18} aria-hidden="true" />
        </button>
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
      <label>
        Tags
        <input value={form.tags} onChange={(event) => updateForm({ tags: event.target.value })} />
      </label>

      <button
        type="button"
        className="primary-action"
        onClick={() => void handleSave()}
        disabled={saveStatus === 'saving'}
      >
        {saveButtonLabel}
      </button>
      <div className="profile-save-status" aria-live="polite">
        {saveStatus === 'saved' ? 'Destination saved' : null}
        {saveStatus === 'error' ? 'Unable to save destination' : null}
      </div>
    </aside>
  );
}
