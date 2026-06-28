import { Car, GripVertical, Ship, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { Destination, RouteLeg, RouteLegType } from '../domain/types';

type ItineraryPanelProps = {
  destinations: Destination[];
  routeLegs: RouteLeg[];
  selectedDestinationId: string | null;
  onSelectDestination: (destinationId: string) => void;
  onDeleteDestination: (destinationId: string) => void;
  onReorderDestinations: (destinationIds: string[]) => void;
  onUpdateRouteLeg: (
    routeLegId: string,
    patch: Partial<Omit<RouteLeg, 'id' | 'createdAt' | 'updatedAt'>>,
  ) => void;
};

export function ItineraryPanel({
  destinations,
  routeLegs,
  selectedDestinationId,
  onSelectDestination,
  onDeleteDestination,
  onReorderDestinations,
  onUpdateRouteLeg,
}: ItineraryPanelProps) {
  const [draggedDestinationId, setDraggedDestinationId] = useState<string | null>(null);
  const destinationsById = new Map(
    destinations.map((destination) => [destination.id, destination]),
  );

  const handleDrop = (targetDestinationId: string) => {
    if (!draggedDestinationId || draggedDestinationId === targetDestinationId) {
      setDraggedDestinationId(null);
      return;
    }

    const nextDestinationIds = destinations.map((destination) => destination.id);
    const draggedIndex = nextDestinationIds.indexOf(draggedDestinationId);
    const targetIndex = nextDestinationIds.indexOf(targetDestinationId);

    if (draggedIndex === -1 || targetIndex === -1) {
      setDraggedDestinationId(null);
      return;
    }

    nextDestinationIds.splice(draggedIndex, 1);
    nextDestinationIds.splice(targetIndex, 0, draggedDestinationId);
    onReorderDestinations(nextDestinationIds);
    setDraggedDestinationId(null);
  };

  return (
    <aside className="itinerary-panel" aria-label="Itinerary">
      <h2>Stops</h2>
      <div className="stop-list">
        {destinations.length === 0 ? <p>Add your first destination from the map search.</p> : null}
        {destinations.map((destination, index) => {
          const region = destination.countryRegion || 'Unassigned region';
          const isSelected = destination.id === selectedDestinationId;

          return (
            <div
              key={destination.id}
              className={`stop-item ${isSelected ? 'is-selected' : ''}`}
              data-testid={`stop-drop-target-${destination.id}`}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => handleDrop(destination.id)}
            >
              <button
                type="button"
                className="stop-drag"
                aria-label={`Drag ${destination.name}`}
                draggable
                onDragStart={() => setDraggedDestinationId(destination.id)}
                onDragEnd={() => setDraggedDestinationId(null)}
              >
                <GripVertical size={16} aria-hidden="true" />
              </button>
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

      <div className="route-leg-list">
        {routeLegs.length === 0 ? <p>No route legs yet.</p> : null}
        {routeLegs.map((routeLeg, index) => {
          const origin = destinationsById.get(routeLeg.originDestinationId);
          const target = destinationsById.get(routeLeg.targetDestinationId);
          const originName = origin?.name ?? 'Unknown origin';
          const targetName = target?.name ?? 'Unknown target';
          const legLabel = `${originName} to ${targetName}`;
          const metricLabel =
            routeLeg.distanceKm !== undefined && routeLeg.travelTimeHours !== undefined
              ? `${Math.round(routeLeg.distanceKm).toLocaleString()} km, ${routeLeg.travelTimeHours.toFixed(1)} hr`
              : routeLeg.status;

          return (
            <div key={routeLeg.id} className={`route-leg-row route-leg-row-${routeLeg.type}`}>
              <div className="route-leg-icon" aria-hidden="true">
                {routeLeg.type === 'shipping-manual' ? <Ship size={16} /> : <Car size={16} />}
              </div>
              <div className="route-leg-copy">
                <strong>{legLabel}</strong>
                <small>
                  {String(index + 1).padStart(2, '0')} - {metricLabel}
                </small>
              </div>
              <label className="route-leg-type">
                <span className="sr-only">Leg type {legLabel}</span>
                <select
                  aria-label={`Leg type ${legLabel}`}
                  value={routeLeg.type}
                  onChange={(event) =>
                    onUpdateRouteLeg(routeLeg.id, {
                      type: event.target.value as RouteLegType,
                    })
                  }
                >
                  <option value="driving-auto">Drive</option>
                  <option value="shipping-manual">Ship/manual</option>
                </select>
              </label>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
