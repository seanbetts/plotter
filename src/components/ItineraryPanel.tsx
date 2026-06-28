import { Car, GripVertical, Ship, Trash2 } from 'lucide-react';
import type { DragEvent, PointerEvent } from 'react';
import { useRef, useState } from 'react';
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

type DropPosition = 'before' | 'after';

type DropPreview = {
  destinationId: string;
  position: DropPosition;
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

function isRouteLegCalculating(routeLeg: RouteLeg) {
  return routeLeg.status === 'pending' || routeLeg.status === 'calculating';
}

function nextRouteType(type: RouteLegType): RouteLegType {
  return type === 'shipping-manual' ? 'driving-auto' : 'shipping-manual';
}

function reorderedDestinationIds(
  destinations: Destination[],
  draggedDestinationId: string,
  targetDestinationId: string,
  position: DropPosition,
) {
  if (draggedDestinationId === targetDestinationId) {
    return destinations.map((destination) => destination.id);
  }

  const destinationIds = destinations.map((destination) => destination.id);
  const withoutDragged = destinationIds.filter((destinationId) => destinationId !== draggedDestinationId);
  const targetIndex = withoutDragged.indexOf(targetDestinationId);

  if (targetIndex === -1) {
    return destinationIds;
  }

  const insertIndex = position === 'after' ? targetIndex + 1 : targetIndex;
  withoutDragged.splice(insertIndex, 0, draggedDestinationId);
  return withoutDragged;
}

function dropPreviewForPointer(
  destinations: Destination[],
  draggedDestinationId: string,
  targetDestinationId: string,
  targetPosition: DropPosition,
): DropPreview {
  if (targetPosition === 'before') {
    return { destinationId: targetDestinationId, position: 'before' };
  }

  const destinationIdsWithoutDragged = destinations
    .map((destination) => destination.id)
    .filter((destinationId) => destinationId !== draggedDestinationId);
  const targetIndex = destinationIdsWithoutDragged.indexOf(targetDestinationId);
  const nextDestinationId = destinationIdsWithoutDragged[targetIndex + 1];

  if (nextDestinationId) {
    return { destinationId: nextDestinationId, position: 'before' };
  }

  return { destinationId: targetDestinationId, position: 'after' };
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
  const [dropPreview, setDropPreview] = useState<DropPreview | null>(null);
  const draggedDestinationIdRef = useRef<string | null>(null);
  const dropPreviewRef = useRef<DropPreview | null>(null);
  const routeLegsByPair = new Map(
    routeLegs.map((routeLeg) => [
      `${routeLeg.originDestinationId}:${routeLeg.targetDestinationId}`,
      routeLeg,
    ]),
  );
  const stopListClassName = ['stop-list', draggedDestinationId ? 'is-reordering' : '']
    .filter(Boolean)
    .join(' ');

  const setActiveDraggedDestinationId = (destinationId: string | null) => {
    draggedDestinationIdRef.current = destinationId;
    setDraggedDestinationId(destinationId);
  };

  const setActiveDropPreview = (preview: DropPreview | null) => {
    dropPreviewRef.current = preview;
    setDropPreview(preview);
  };

  const clearDragState = () => {
    draggedDestinationIdRef.current = null;
    dropPreviewRef.current = null;
    setDraggedDestinationId(null);
    setDropPreview(null);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>, targetDestinationId: string) => {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }

    if (!draggedDestinationId || draggedDestinationId === targetDestinationId) {
      setActiveDropPreview(null);
      return;
    }

    const targetBounds = event.currentTarget.getBoundingClientRect();
    const targetMidpoint = targetBounds.top + targetBounds.height / 2;
    const position = event.clientY > targetMidpoint ? 'after' : 'before';

    setActiveDropPreview(
      dropPreviewForPointer(destinations, draggedDestinationId, targetDestinationId, position),
    );
  };

  const handleMarkerDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  };

  const handleMarkerDrop = (event: DragEvent<HTMLDivElement>, targetDestinationId: string) => {
    event.preventDefault();
    event.stopPropagation();
    handleDrop(targetDestinationId);
  };

  const reorderDraggedDestination = (
    activeDraggedDestinationId: string,
    resolvedDropPreview: DropPreview,
  ) => {
    const nextDestinationIds = reorderedDestinationIds(
      destinations,
      activeDraggedDestinationId,
      resolvedDropPreview.destinationId,
      resolvedDropPreview.position,
    );
    onReorderDestinations(nextDestinationIds);
    clearDragState();
  };

  const handleDrop = (targetDestinationId: string) => {
    if (!draggedDestinationId || draggedDestinationId === targetDestinationId) {
      clearDragState();
      return;
    }

    const resolvedDropPreview = dropPreviewRef.current ?? dropPreview ?? {
      destinationId: targetDestinationId,
      position: 'before' as const,
    };
    reorderDraggedDestination(draggedDestinationId, resolvedDropPreview);
  };

  const getPointerDropPreview = (event: PointerEvent<HTMLElement>) => {
    const activeDraggedDestinationId = draggedDestinationIdRef.current;

    if (!activeDraggedDestinationId || typeof document.elementFromPoint !== 'function') {
      return null;
    }

    const hoveredElement = document.elementFromPoint(event.clientX, event.clientY);
    const dropIndicator = hoveredElement?.closest<HTMLElement>('[data-drop-target-id]');

    if (dropIndicator?.dataset.dropTargetId) {
      const position =
        dropIndicator.dataset.dropPosition === 'after' ? 'after' : 'before';
      return {
        destinationId: dropIndicator.dataset.dropTargetId,
        position,
      } satisfies DropPreview;
    }

    const stopItem = hoveredElement?.closest<HTMLElement>('[data-stop-id]');
    const targetDestinationId = stopItem?.dataset.stopId;

    if (!stopItem || !targetDestinationId || targetDestinationId === activeDraggedDestinationId) {
      return null;
    }

    const targetBounds = stopItem.getBoundingClientRect();
    const targetMidpoint = targetBounds.top + targetBounds.height / 2;
    const position = event.clientY > targetMidpoint ? 'after' : 'before';

    return dropPreviewForPointer(
      destinations,
      activeDraggedDestinationId,
      targetDestinationId,
      position,
    );
  };

  const handlePointerDown = (
    event: PointerEvent<HTMLButtonElement>,
    destinationId: string,
  ) => {
    if (event.button !== 0) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setActiveDraggedDestinationId(destinationId);
    setActiveDropPreview(null);
  };

  const handlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!draggedDestinationIdRef.current) return;

    event.preventDefault();
    setActiveDropPreview(getPointerDropPreview(event));
  };

  const handlePointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    const activeDraggedDestinationId = draggedDestinationIdRef.current;

    if (!activeDraggedDestinationId) return;

    event.preventDefault();
    event.currentTarget.releasePointerCapture?.(event.pointerId);

    const resolvedDropPreview = getPointerDropPreview(event) ?? dropPreviewRef.current;

    if (!resolvedDropPreview) {
      clearDragState();
      return;
    }

    reorderDraggedDestination(activeDraggedDestinationId, resolvedDropPreview);
  };

  return (
    <aside className="itinerary-panel" aria-label="Itinerary">
      <h2>Stops</h2>
      <div className={stopListClassName}>
        {destinations.length === 0 ? <p>Add your first destination from the map search.</p> : null}
        {destinations.map((destination, index) => {
          const region = destination.countryRegion || 'Unassigned region';
          const isSelected = destination.id === selectedDestinationId;
          const nextDestination = destinations[index + 1];
          const routeLeg = nextDestination
            ? routeLegsByPair.get(`${destination.id}:${nextDestination.id}`)
            : undefined;
          const isCalculatingRoute = routeLeg ? isRouteLegCalculating(routeLeg) : false;
          const isDragging = draggedDestinationId === destination.id;
          const activeDropPosition =
            dropPreview?.destinationId === destination.id ? dropPreview.position : null;
          const stopItemClassName = [
            'stop-item',
            isSelected ? 'is-selected' : '',
            isDragging ? 'is-dragging' : '',
            activeDropPosition ? 'is-drop-target' : '',
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <div key={destination.id} className="stop-sequence-item">
              {activeDropPosition === 'before' ? (
                <div
                  className="stop-drop-indicator"
                  data-testid={`stop-insert-before-${destination.id}`}
                  data-drop-target-id={destination.id}
                  data-drop-position="before"
                  aria-hidden="true"
                  onDragOver={handleMarkerDragOver}
                  onDrop={(event) => handleMarkerDrop(event, destination.id)}
                />
              ) : null}
              <div
                className={stopItemClassName}
                data-testid={`stop-drop-target-${destination.id}`}
                data-stop-id={destination.id}
                onDragOver={(event) => handleDragOver(event, destination.id)}
                onDrop={() => handleDrop(destination.id)}
              >
                <button
                  type="button"
                  className="stop-drag"
                  aria-label={`Drag ${destination.name}`}
                  draggable={false}
                  onPointerDown={(event) => handlePointerDown(event, destination.id)}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={clearDragState}
                  onDragStart={(event) => {
                    if (event.dataTransfer) {
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', destination.id);
                    }
                    setActiveDraggedDestinationId(destination.id);
                    setActiveDropPreview(null);
                  }}
                  onDragEnd={clearDragState}
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
              {activeDropPosition === 'after' ? (
                <div
                  className="stop-drop-indicator"
                  data-testid={`stop-insert-after-${destination.id}`}
                  data-drop-target-id={destination.id}
                  data-drop-position="after"
                  aria-hidden="true"
                  onDragOver={handleMarkerDragOver}
                  onDrop={(event) => handleMarkerDrop(event, destination.id)}
                />
              ) : null}
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
                  <span
                    className={`inline-route-metrics ${
                      isCalculatingRoute ? 'is-calculating-route' : ''
                    }`}
                  >
                    {isCalculatingRoute ? (
                      <span
                        className="inline-route-spinner"
                        role="status"
                        aria-label={`Calculating ${destination.name} to ${nextDestination.name} route`}
                      />
                    ) : null}
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
