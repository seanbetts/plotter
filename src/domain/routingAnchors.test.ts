import { describe, expect, it } from 'vitest';
import type { Coordinates, RoutingAnchor } from './types';
import {
  coordinateDistanceKm,
  routingAnchorDistanceToleranceKm,
  validateRoutingAnchor,
} from './routingAnchors';

const canonicalCoordinates = { lat: 0, lng: 0 };
const oneKilometreCoordinates = { lat: 0.008993216, lng: 0 };

function anchorFor(coordinates: Coordinates): RoutingAnchor {
  return {
    profile: 'driving-car',
    coordinates,
    originalCoordinates: canonicalCoordinates,
    snapDistanceKm: coordinateDistanceKm(canonicalCoordinates, coordinates),
    provider: 'openrouteservice',
    resolvedAt: '2026-07-12T00:00:00.000Z',
  };
}

describe('routing anchor validation', () => {
  it('accepts a one kilometre ORS anchor for its canonical endpoint and profile', () => {
    const anchor = anchorFor(oneKilometreCoordinates);

    expect(validateRoutingAnchor({
      anchor,
      canonicalCoordinates,
      profile: 'driving-car',
    })).toEqual({
      anchor,
      actualSnapDistanceKm: expect.closeTo(1, 5),
    });
  });

  it('rejects a far coordinate with a fake one kilometre stored distance', () => {
    const anchor = {
      ...anchorFor({ lat: 0.03, lng: 0 }),
      snapDistanceKm: 1,
    };

    expect(validateRoutingAnchor({
      anchor,
      canonicalCoordinates,
      profile: 'driving-car',
    })).toBeUndefined();
  });

  it('rejects a close coordinate with an inconsistent stored distance', () => {
    const anchor = {
      ...anchorFor(oneKilometreCoordinates),
      snapDistanceKm: 0.5,
    };

    expect(validateRoutingAnchor({
      anchor,
      canonicalCoordinates,
      profile: 'driving-car',
    })).toBeUndefined();
  });

  it('accepts stored distance agreement at the tolerance boundary', () => {
    const anchor = anchorFor(oneKilometreCoordinates);
    const boundaryAnchor = {
      ...anchor,
      snapDistanceKm: anchor.snapDistanceKm + routingAnchorDistanceToleranceKm,
    };

    expect(validateRoutingAnchor({
      anchor: boundaryAnchor,
      canonicalCoordinates,
      profile: 'driving-car',
    })?.actualSnapDistanceKm).toBeCloseTo(1, 5);
  });
});
