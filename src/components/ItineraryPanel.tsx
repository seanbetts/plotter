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

const kmToMiles = 0.621371;

function formatLegDistance(routeLeg: RouteLeg) {
  if (routeLeg.distanceKm === undefined) return routeLeg.status;

  return `${Math.round(routeLeg.distanceKm * kmToMiles).toLocaleString()} mi`;
}

function formatLegTime(routeLeg: RouteLeg) {
  if (routeLeg.travelTimeHours === undefined) return null;

  return `${routeLeg.travelTimeHours.toFixed(1)} hr`;
}

function nextRouteType(type: RouteLegType): RouteLegType {
  return type === 'shipping-manual' ? 'driving-auto' : 'shipping-manual';
}

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
  const routeLegsByPair = new Map(
    routeLegs.map((routeLeg) => [
      `${routeLeg.originDestinationId}:${routeLeg.targetDestinationId}`,
      routeLeg,
    ]),
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
          const nextDestination = destinations[index + 1];
          const routeLeg = nextDestination
            ? routeLegsByPair.get(`${destination.id}:${nextDestination.id}`)
            : undefined;

          return (
            <div key={destination.id} className="stop-sequence-item">
              <div
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
                  aria-label={`${destination.name} ${region}`}
                  aria-current={isSelected ? 'location' : undefined}
                  onClick={() => onSelectDestination(destination.id)}
                >
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
              {routeLeg && nextDestination ? (
                <div className={`inline-route-leg inline-route-leg-${routeLeg.type}`}>
                  <span className="inline-route-rail" aria-hidden="true" />
                  <button
                    type="button"
                    className="inline-route-type"
                    aria-label={`Set ${destination.name} to ${nextDestination.name} to ${
                      routeLeg.type === 'shipping-manual' ? 'driving' : 'shipping/manual'
                    }`}
                    title={routeLeg.type === 'shipping-manual' ? 'Set to driving' : 'Set to shipping/manual'}
                    onClick={() =>
                      onUpdateRouteLeg(routeLeg.id, {
                        type: nextRouteType(routeLeg.type),
                      })
                    }
                  >
                    {routeLeg.type === 'shipping-manual' ? <Ship size={15} /> : <Car size={15} />}
                  </button>
                  <span className="inline-route-metrics">
                    <span className="inline-route-metric">{formatLegDistance(routeLeg)}</span>
                    {formatLegTime(routeLeg) ? (
                      <span className="inline-route-metric">{formatLegTime(routeLeg)}</span>
                    ) : null}
                  </span>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
