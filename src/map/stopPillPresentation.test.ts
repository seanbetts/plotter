import { describe, expect, it } from 'vitest';
import { createDestination } from '../domain/destinations';
import {
  buildStopPillPresentations,
  createStopPillElement,
  positionStopPillPresentations,
  stopPillClassName,
  stopPillText,
} from './stopPillPresentation';

const balcombe = createDestination({
  name: 'Balcombe',
  countryRegion: 'United Kingdom',
  coordinates: { lat: 51.055, lng: -0.136 },
});
const ghent = createDestination({
  name: 'Ghent',
  countryRegion: 'Belgium',
  coordinates: { lat: 51.054, lng: 3.717 },
});

describe('stopPillPresentation', () => {
  it('uses the live app numbering and text contract', () => {
    expect(stopPillText('Balcombe', 0)).toBe('ST - Balcombe');
    expect(stopPillText('Ghent', 1)).toBe('02 - Ghent');
    expect(stopPillText('Honningsvåg', 14)).toBe('15 - Honningsvåg');
  });

  it('builds projected pills in canonical destination order', () => {
    const project = ([lng, lat]: [number, number]) => ({ x: lng * 10, y: lat * 10 });

    expect(buildStopPillPresentations({
      destinations: [balcombe, ghent],
      selectedDestinationId: ghent.id,
      project,
    })).toEqual([
      expect.objectContaining({
        id: balcombe.id,
        name: 'Balcombe',
        text: 'ST - Balcombe',
        selected: false,
        position: 'below',
        x: -1.36,
        y: 510.55,
      }),
      expect.objectContaining({
        id: ghent.id,
        name: 'Ghent',
        text: '02 - Ghent',
        selected: true,
        position: 'below',
        x: 37.17,
        y: 510.54,
      }),
    ]);
  });

  it('uses the exact live CSS classes for state and placement', () => {
    expect(stopPillClassName({ selected: false, position: 'below' })).toBe('map-destination-label');
    expect(stopPillClassName({ selected: true, position: 'above' })).toBe(
      'map-destination-label is-selected map-label-position-above',
    );
  });

  it('places an earlier overlapping pill above and leaves the later pill below', () => {
    const projected = buildStopPillPresentations({
      destinations: [balcombe, ghent],
      selectedDestinationId: null,
      project: () => ({ x: 240, y: 180 }),
    });

    expect(positionStopPillPresentations(projected).map(({ position }) => position)).toEqual([
      'above',
      'below',
    ]);
  });

  it('creates a non-interactive export element with live pill text and geometry', () => {
    const element = createStopPillElement({
      id: balcombe.id,
      name: 'Balcombe',
      text: 'ST - Balcombe',
      selected: false,
      position: 'below',
      x: 240,
      y: 180,
    });

    expect(element).toHaveClass('map-destination-label');
    expect(element).not.toHaveClass('is-selected');
    expect(element).toHaveTextContent('ST - Balcombe');
    expect(element.style.left).toBe('240px');
    expect(element.style.top).toBe('180px');
    expect(element.getAttribute('aria-hidden')).toBe('true');
    expect(element.tabIndex).toBe(-1);
  });
});
