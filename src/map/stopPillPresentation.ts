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

export type StopPillBounds = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

type BuildStopPillPresentationsInput = {
  destinations: Destination[];
  selectedDestinationId: string | null;
  project: (coordinates: [number, number]) => { x: number; y: number };
  positions?: ReadonlyMap<string, StopPillPosition>;
};

const stopPillMaxWidthPx = 190;
const stopPillHeightPx = 24;
const stopPillVerticalOffsetPx = 14;
const stopPillCollisionPaddingPx = 6;
const stopPillApproxCharacterWidthPx = 7.2;
const stopPillHorizontalChromePx = 18;

function estimateStopPillWidth(text: string) {
  return Math.min(
    stopPillMaxWidthPx,
    Math.max(stopPillHeightPx, text.length * stopPillApproxCharacterWidthPx + stopPillHorizontalChromePx),
  );
}

function renderedStopPillBounds(
  pill: Pick<StopPillPresentation, 'text' | 'x' | 'y'>,
  position: StopPillPosition,
): StopPillBounds {
  const width = estimateStopPillWidth(pill.text);
  const left = pill.x - width / 2;
  const top = position === 'above'
    ? pill.y - stopPillVerticalOffsetPx - stopPillHeightPx
    : pill.y + stopPillVerticalOffsetPx;

  return {
    left,
    right: left + width,
    top,
    bottom: top + stopPillHeightPx,
  };
}

function stopPillBoundsOverlap(left: StopPillBounds, right: StopPillBounds) {
  return left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top;
}

export function stopPillCollisionBounds(pill: StopPillPresentation): StopPillBounds {
  const renderedBounds = renderedStopPillBounds(pill, pill.position);
  return {
    left: renderedBounds.left - stopPillCollisionPaddingPx,
    right: renderedBounds.right + stopPillCollisionPaddingPx,
    top: renderedBounds.top - stopPillCollisionPaddingPx,
    bottom: renderedBounds.bottom + stopPillCollisionPaddingPx,
  };
}

export function positionStopPillPresentations(
  pills: StopPillPresentation[],
): StopPillPresentation[] {
  const belowBounds = pills.map((pill) => renderedStopPillBounds(pill, 'below'));
  return pills.map((pill, index) => ({
    ...pill,
    position: belowBounds.slice(index + 1).some((bounds) =>
      stopPillBoundsOverlap(belowBounds[index], bounds),
    ) ? 'above' : 'below',
  }));
}

export function stopPillText(name: string, stopIndex: number, totalStops?: number) {
  return `${formatStopMarker(stopIndex + 1, totalStops)} - ${name}`;
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
      text: stopPillText(destination.name, index, destinations.length),
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
