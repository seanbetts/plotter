import type { Destination } from '../domain/types';
import { formatStopMarker } from '../components/stopLabels';

export type StopPillPosition = 'below' | 'above';

export type StopPillPresentation = {
  id: string;
  name: string;
  text: string;
  selected: boolean;
  position: StopPillPosition;
  x: number;
  y: number;
};

type BuildStopPillPresentationsInput = {
  destinations: Destination[];
  selectedDestinationId: string | null;
  project: (coordinates: [number, number]) => { x: number; y: number };
  positions?: ReadonlyMap<string, StopPillPosition>;
};

export function stopPillText(name: string, stopIndex: number) {
  return `${formatStopMarker(stopIndex + 1)} - ${name}`;
}

export function stopPillClassName(input: Pick<StopPillPresentation, 'selected' | 'position'>) {
  return [
    'map-destination-label',
    input.selected ? 'is-selected' : '',
    input.position === 'above' ? 'map-label-position-above' : '',
  ].filter(Boolean).join(' ');
}

export function buildStopPillPresentations({
  destinations,
  selectedDestinationId,
  project,
  positions,
}: BuildStopPillPresentationsInput): StopPillPresentation[] {
  return destinations.map((destination, index) => {
    const point = project([destination.coordinates.lng, destination.coordinates.lat]);
    return {
      id: destination.id,
      name: destination.name,
      text: stopPillText(destination.name, index),
      selected: destination.id === selectedDestinationId,
      position: positions?.get(destination.id) ?? 'below',
      x: point.x,
      y: point.y,
    };
  });
}

export function createStopPillElement(pill: StopPillPresentation) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = stopPillClassName(pill);
  element.textContent = pill.text;
  element.style.left = `${pill.x}px`;
  element.style.top = `${pill.y}px`;
  element.tabIndex = -1;
  element.setAttribute('aria-hidden', 'true');
  return element;
}
