import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Destination, RouteLegType } from '../domain/types';

type CreateRouteLegInput = {
  originDestinationId: string;
  targetDestinationId: string;
  type: RouteLegType;
  notes: string;
};

type RouteLegEditorProps = {
  destinations: Destination[];
  onCreateRouteLeg: (input: CreateRouteLegInput) => Promise<void> | void;
};

export function RouteLegEditor({ destinations, onCreateRouteLeg }: RouteLegEditorProps) {
  const [originDestinationId, setOriginDestinationId] = useState('');
  const [targetDestinationId, setTargetDestinationId] = useState('');
  const [type, setType] = useState<RouteLegType>('driving');
  const [notes, setNotes] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!originDestinationId || !targetDestinationId || originDestinationId === targetDestinationId) {
      return;
    }

    await onCreateRouteLeg({
      originDestinationId,
      targetDestinationId,
      type,
      notes,
    });
    setNotes('');
  }

  return (
    <form className="route-leg-editor" onSubmit={handleSubmit}>
      <label>
        Origin
        <select value={originDestinationId} onChange={(event) => setOriginDestinationId(event.target.value)}>
          <option value="">Choose origin</option>
          {destinations.map((destination) => (
            <option key={destination.id} value={destination.id}>
              {destination.name}
            </option>
          ))}
        </select>
      </label>

      <label>
        Target
        <select value={targetDestinationId} onChange={(event) => setTargetDestinationId(event.target.value)}>
          <option value="">Choose target</option>
          {destinations.map((destination) => (
            <option key={destination.id} value={destination.id}>
              {destination.name}
            </option>
          ))}
        </select>
      </label>

      <label>
        Leg type
        <select value={type} onChange={(event) => setType(event.target.value as RouteLegType)}>
          <option value="driving">driving</option>
          <option value="ferry-shipping">ferry-shipping</option>
          <option value="uncertain">uncertain</option>
        </select>
      </label>

      <label>
        Route notes
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
      </label>

      <button type="submit">Add route leg</button>
    </form>
  );
}
