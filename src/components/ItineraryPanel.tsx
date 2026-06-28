import { Trash2 } from 'lucide-react';
import type { Destination, RouteLeg } from '../domain/types';
import { RouteLegEditor } from './RouteLegEditor';

type ItineraryPanelProps = {
  destinations: Destination[];
  routeLegs: RouteLeg[];
  selectedDestinationId: string | null;
  onSelectDestination: (destinationId: string) => void;
  onDeleteDestination: (destinationId: string) => void;
  onCreateRouteLeg: Parameters<typeof RouteLegEditor>[0]['onCreateRouteLeg'];
};

export function ItineraryPanel({
  destinations,
  routeLegs,
  selectedDestinationId,
  onSelectDestination,
  onDeleteDestination,
  onCreateRouteLeg,
}: ItineraryPanelProps) {
  return (
    <aside className="itinerary-panel" aria-label="Itinerary">
      <h2>Stops</h2>
      <div className="stop-list">
        {destinations.length === 0 ? <p>Add your first destination from the map search.</p> : null}
        {destinations.map((destination, index) => {
          const region = destination.countryRegion || 'Unassigned region';
          const isSelected = destination.id === selectedDestinationId;

          return (
            <div key={destination.id} className={`stop-item ${isSelected ? 'is-selected' : ''}`}>
              <button
                type="button"
                className="stop-select"
                aria-label={`${String(index + 1).padStart(2, '0')} ${destination.name} ${region}`}
                aria-current={isSelected ? 'location' : undefined}
                onClick={() => onSelectDestination(destination.id)}
              >
                <span>{String(index + 1).padStart(2, '0')}</span>
                <strong>{destination.name}</strong>
                <small>{region}</small>
              </button>
              <button
                type="button"
                className="stop-delete"
                aria-label={`Delete ${destination.name}`}
                onClick={() => onDeleteDestination(destination.id)}
              >
                <Trash2 size={15} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>

      <h2>Routes</h2>
      <p className="route-summary">
        {routeLegs.length} route {routeLegs.length === 1 ? 'leg' : 'legs'}
      </p>

      <RouteLegEditor destinations={destinations} onCreateRouteLeg={onCreateRouteLeg} />
    </aside>
  );
}
