import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ActivityItem, Destination } from '../domain/types';

type DestinationPatch = Partial<Omit<Destination, 'id' | 'createdAt' | 'updatedAt'>>;

type DestinationFormState = {
  sourceKey: string;
  summary: string;
  highlights: string;
  personalRationale: string;
  expectedStayDays: string;
  idealMonths: string;
  researchNotes: string;
  activities: string;
  routeNotes: string;
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

const createActivityItems = (labels: string[], existingItems: ActivityItem[]): ActivityItem[] => {
  const remainingExistingItems = [...existingItems];

  return labels.map((label) => {
    const existingIndex = remainingExistingItems.findIndex((item) => item.label === label);

    if (existingIndex >= 0) {
      const [existingItem] = remainingExistingItems.splice(existingIndex, 1);
      return existingItem;
    }

    return {
      id: crypto.randomUUID(),
      label,
      category: 'other',
      notes: '',
    };
  });
};

const destinationSourceKey = (destination: Destination) => `${destination.id}:${destination.updatedAt}`;

const createFormState = (destination: Destination): DestinationFormState => ({
  sourceKey: destinationSourceKey(destination),
  summary: destination.why.summary,
  highlights: destination.why.highlights,
  personalRationale: destination.why.personalRationale,
  expectedStayDays: String(destination.timing.expectedStayDays),
  idealMonths: listToText(destination.timing.idealMonths),
  researchNotes: destination.research.notes,
  activities: listToText(destination.activities.items.map((item) => item.label)),
  routeNotes: destination.routeContext.notes,
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
  const savedTimerRef = useRef<number | null>(null);
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
        timing: {
          ...destination.timing,
          idealMonths: textToList(form.idealMonths),
          expectedStayDays: normalizeExpectedStayDays(form.expectedStayDays),
        },
        why: {
          summary: form.summary,
          highlights: form.highlights,
          personalRationale: form.personalRationale,
        },
        research: {
          ...destination.research,
          notes: form.researchNotes,
        },
        activities: {
          items: createActivityItems(textToList(form.activities), destination.activities.items),
        },
        routeContext: {
          ...destination.routeContext,
          notes: form.routeNotes,
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
      <div className="profile-header">
        <div>
          <p>{destination.countryRegion || 'Unassigned region'}</p>
          <h1>{destination.name}</h1>
        </div>
        <button type="button" onClick={onClose} aria-label="Close destination profile">
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      <label>
        Why it matters
        <textarea value={form.summary} onChange={(event) => updateForm({ summary: event.target.value })} />
      </label>
      <label>
        Highlights
        <textarea value={form.highlights} onChange={(event) => updateForm({ highlights: event.target.value })} />
      </label>
      <label>
        Personal rationale
        <textarea
          value={form.personalRationale}
          onChange={(event) => updateForm({ personalRationale: event.target.value })}
        />
      </label>
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
        Ideal months
        <input value={form.idealMonths} onChange={(event) => updateForm({ idealMonths: event.target.value })} />
      </label>
      <label>
        Research notes
        <textarea value={form.researchNotes} onChange={(event) => updateForm({ researchNotes: event.target.value })} />
      </label>
      <label>
        Activities
        <textarea value={form.activities} onChange={(event) => updateForm({ activities: event.target.value })} />
      </label>
      <label>
        Route notes
        <textarea value={form.routeNotes} onChange={(event) => updateForm({ routeNotes: event.target.value })} />
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
