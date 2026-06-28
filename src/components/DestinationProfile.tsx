import { X } from 'lucide-react';
import { useState } from 'react';
import type { Destination } from '../domain/types';

type DestinationPatch = Partial<Omit<Destination, 'id' | 'createdAt' | 'updatedAt'>>;

type DestinationFormState = {
  destinationId: string;
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

const listToText = (items: string[]) => items.join(', ');

const textToList = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const createFormState = (destination: Destination): DestinationFormState => ({
  destinationId: destination.id,
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
  const [draft, setDraft] = useState(() => createFormState(destination));
  const form = draft.destinationId === destination.id ? draft : createFormState(destination);

  function updateForm(patch: Partial<Omit<DestinationFormState, 'destinationId'>>) {
    setDraft({ ...form, ...patch });
  }

  async function handleSave() {
    await onUpdate(destination.id, {
      timing: {
        ...destination.timing,
        idealMonths: textToList(form.idealMonths),
        expectedStayDays: Number(form.expectedStayDays) || 1,
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
        items: textToList(form.activities).map((label) => ({
          id: crypto.randomUUID(),
          label,
          category: 'other',
          notes: '',
        })),
      },
      routeContext: {
        ...destination.routeContext,
        notes: form.routeNotes,
      },
      tags: textToList(form.tags),
    });
  }

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

      <button type="button" className="primary-action" onClick={handleSave}>
        Save destination
      </button>
    </aside>
  );
}
