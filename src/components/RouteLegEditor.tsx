import { useState } from 'react';
import type { FormEvent } from 'react';
import { formatDestinationLocation } from '../domain/locations';
import type { Destination, RouteMovement } from '../domain/types';

type CreateRouteLegInput = {
  originDestinationId: string;
  targetDestinationId: string;
  movement: RouteMovement;
  calculation: 'automatic' | 'manual';
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
  return formatDestinationLocation(destination);
}

export function RouteLegEditor({ destinations, onCreateRouteLeg }: RouteLegEditorProps) {
  const [originDestinationId, setOriginDestinationId] = useState('');
  const [targetDestinationId, setTargetDestinationId] = useState('');
  const [movement, setMovement] = useState<RouteMovement>('drive');
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
      movement,
      calculation: movement === 'vehicle-shipping' ? 'manual' : 'automatic',
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
        <select value={movement} onChange={(event) => setMovement(event.target.value as RouteMovement)}>
          <option value="drive">Automatic driving</option>
          <option value="vehicle-shipping">Vehicle shipping</option>
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
