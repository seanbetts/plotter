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

function hasDestination(destinations: Destination[], destinationId: string) {
  return destinations.some((destination) => destination.id === destinationId);
}

function formatDestinationOption(destination: Destination) {
  return `${destination.name} - ${destination.countryRegion || 'Unassigned region'}`;
}

export function RouteLegEditor({ destinations, onCreateRouteLeg }: RouteLegEditorProps) {
  const [originDestinationId, setOriginDestinationId] = useState('');
  const [targetDestinationId, setTargetDestinationId] = useState('');
  const [type, setType] = useState<RouteLegType>('driving-auto');
  const [notes, setNotes] = useState('');

  const originSelectValue = hasDestination(destinations, originDestinationId) ? originDestinationId : '';
  const targetSelectValue = hasDestination(destinations, targetDestinationId) ? targetDestinationId : '';

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (
      !originDestinationId ||
      !targetDestinationId ||
      originDestinationId === targetDestinationId ||
      !hasDestination(destinations, originDestinationId) ||
      !hasDestination(destinations, targetDestinationId)
    ) {
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
        <select value={originSelectValue} onChange={(event) => setOriginDestinationId(event.target.value)}>
          <option value="">Choose origin</option>
          {destinations.map((destination) => (
            <option key={destination.id} value={destination.id}>
              {formatDestinationOption(destination)}
            </option>
          ))}
        </select>
      </label>

      <label>
        Target
        <select value={targetSelectValue} onChange={(event) => setTargetDestinationId(event.target.value)}>
          <option value="">Choose target</option>
          {destinations.map((destination) => (
            <option key={destination.id} value={destination.id}>
              {formatDestinationOption(destination)}
            </option>
          ))}
        </select>
      </label>

      <label>
        Leg type
        <select value={type} onChange={(event) => setType(event.target.value as RouteLegType)}>
          <option value="driving-auto">driving-auto</option>
          <option value="shipping-manual">shipping-manual</option>
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
