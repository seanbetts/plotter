import type { Destination, RouteLeg } from '../domain/types';
import { RouteLegEditor } from './RouteLegEditor';

type ItineraryPanelProps = {
  destinations: Destination[];
  routeLegs: RouteLeg[];
  selectedDestinationId: string | null;
  onSelectDestination: (destinationId: string) => void;
  onCreateRouteLeg: Parameters<typeof RouteLegEditor>[0]['onCreateRouteLeg'];
};

export function ItineraryPanel({
  destinations,
  routeLegs,
  selectedDestinationId,
  onSelectDestination,
  onCreateRouteLeg,
}: ItineraryPanelProps) {
  return (
    <aside className="itinerary-panel" aria-label="Itinerary">
      <h2>Stops</h2>
      <div className="stop-list">
        {destinations.length === 0 ? <p>Add your first destination from the map search.</p> : null}
        {destinations.map((destination, index) => (
          <button
            key={destination.id}
            type="button"
            aria-label={`${String(index + 1).padStart(2, '0')} ${destination.name} ${
              destination.countryRegion || 'Unassigned region'
            }`}
            className={destination.id === selectedDestinationId ? 'is-selected' : ''}
            onClick={() => onSelectDestination(destination.id)}
          >
            <span>{String(index + 1).padStart(2, '0')}</span>
            <strong>{destination.name}</strong>
            <small>{destination.countryRegion || 'Unassigned region'}</small>
          </button>
        ))}
      </div>

      <h2>Routes</h2>
      <p className="route-summary">
        {routeLegs.length} route {routeLegs.length === 1 ? 'leg' : 'legs'}
      </p>

      <RouteLegEditor destinations={destinations} onCreateRouteLeg={onCreateRouteLeg} />
    </aside>
  );
}
