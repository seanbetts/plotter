import { describe, expect, it } from 'vitest';
import { createDestination } from './destinations';
import { createRouteLeg } from './routeLegs';
import {
  findBestDestinationInsertionIndex,
  getDestinationInsertionCandidates,
  reconcileRouteLegsForDestinations,
} from './routePlanner';

describe('route planner helpers', () => {
  it('finds the best insertion point after the fixed first stop', () => {
    const balcombe = createDestination({
      name: 'Balcombe',
      coordinates: { lat: 51.0576, lng: -0.1342 },
      order: 0,
    });
    const liseleje = createDestination({
      name: 'Liseleje',
      coordinates: { lat: 56.0111, lng: 11.9656 },
      order: 1,
    });

    expect(
      findBestDestinationInsertionIndex(
        [balcombe, liseleje],
        { lat: 48.8566, lng: 2.3522 },
      ),
    ).toBe(1);
  });

  it('scores candidate insertion points for Norway stops', () => {
    const oslo = createDestination({
      name: 'Oslo',
      coordinates: { lat: 59.9139, lng: 10.7522 },
      order: 0,
    });
    const bodo = createDestination({
      name: 'Bodo',
      coordinates: { lat: 67.2804, lng: 14.4049 },
      order: 1,
    });
    const trondheimCoordinates = { lat: 63.4305, lng: 10.3951 };

    const candidates = getDestinationInsertionCandidates([oslo, bodo], trondheimCoordinates);

    expect(candidates).toEqual([
      expect.objectContaining({
        insertionIndex: 1,
        previousDestinationId: oslo.id,
        nextDestinationId: bodo.id,
      }),
      expect.objectContaining({
        insertionIndex: 2,
        previousDestinationId: bodo.id,
      }),
    ]);
    expect(candidates[1]).not.toHaveProperty('nextDestinationId');
    expect(candidates[0].addedDistanceKm).toBeLessThan(candidates[1].addedDistanceKm);
    expect(findBestDestinationInsertionIndex([oslo, bodo], trondheimCoordinates)).toBe(1);
  });

  it('scores Bergen between Oslo and Trondheim when Bodo is already last', () => {
    const oslo = createDestination({
      name: 'Oslo',
      coordinates: { lat: 59.9139, lng: 10.7522 },
      order: 0,
    });
    const trondheim = createDestination({
      name: 'Trondheim',
      coordinates: { lat: 63.4305, lng: 10.3951 },
      order: 1,
    });
    const bodo = createDestination({
      name: 'Bodo',
      coordinates: { lat: 67.2804, lng: 14.4049 },
      order: 2,
    });
    const bergenCoordinates = { lat: 60.3913, lng: 5.3221 };

    const candidates = getDestinationInsertionCandidates([oslo, trondheim, bodo], bergenCoordinates);

    expect(candidates.map((candidate) => candidate.insertionIndex)).toEqual([1, 2, 3]);
    expect(findBestDestinationInsertionIndex([oslo, trondheim, bodo], bergenCoordinates)).toBe(1);
    expect(candidates[0].addedDistanceKm).toBeLessThan(candidates[1].addedDistanceKm);
    expect(candidates[0].addedDistanceKm).toBeLessThan(candidates[2].addedDistanceKm);
  });

  it('never places a new destination before the first stop', () => {
    const london = createDestination({
      name: 'London',
      coordinates: { lat: 51.5072, lng: -0.1276 },
      order: 0,
    });
    const paris = createDestination({
      name: 'Paris',
      coordinates: { lat: 48.8566, lng: 2.3522 },
      order: 1,
    });

    const insertionIndex =
      findBestDestinationInsertionIndex(
        [london, paris],
        { lat: 55.9533, lng: -3.1883 },
      );

    expect(insertionIndex).not.toBe(0);
    expect(insertionIndex).toBeGreaterThanOrEqual(1);
  });

  it('appends when adding to an empty or single-stop trip', () => {
    const london = createDestination({
      name: 'London',
      coordinates: { lat: 51.5072, lng: -0.1276 },
      order: 0,
    });

    expect(findBestDestinationInsertionIndex([], { lat: 48.8566, lng: 2.3522 })).toBe(0);
    expect(findBestDestinationInsertionIndex([london], { lat: 48.8566, lng: 2.3522 })).toBe(1);
  });

  it('creates driving route legs for adjacent ordered destinations', () => {
    const london = createDestination({
      name: 'London',
      coordinates: { lat: 51.5072, lng: -0.1276 },
      order: 0,
    });
    const paris = createDestination({
      name: 'Paris',
      coordinates: { lat: 48.8566, lng: 2.3522 },
      order: 1,
    });
    const istanbul = createDestination({
      name: 'Istanbul',
      coordinates: { lat: 41.0082, lng: 28.9784 },
      order: 2,
    });

    const result = reconcileRouteLegsForDestinations([london, paris, istanbul], []);

    expect(result.routeLegs).toHaveLength(2);
    expect(result.removedRouteLegIds).toEqual([]);
    expect(result.routeLegs).toMatchObject([
      {
        originDestinationId: london.id,
        targetDestinationId: paris.id,
        type: 'driving-auto',
        status: 'pending',
      },
      {
        originDestinationId: paris.id,
        targetDestinationId: istanbul.id,
        type: 'driving-auto',
        status: 'pending',
      },
    ]);
  });

  it('preserves existing manual shipping legs for the same adjacent pair', () => {
    const origin = createDestination({
      name: 'Singapore',
      coordinates: { lat: 1.3521, lng: 103.8198 },
      order: 0,
    });
    const target = createDestination({
      name: 'Perth',
      coordinates: { lat: -31.9523, lng: 115.8613 },
      order: 1,
    });
    const shippingLeg = createRouteLeg({
      originDestinationId: origin.id,
      targetDestinationId: target.id,
      type: 'shipping-manual',
      notes: 'Ship the truck across here.',
    });

    const result = reconcileRouteLegsForDestinations([origin, target], [shippingLeg]);

    expect(result.routeLegs).toEqual([shippingLeg]);
    expect(result.removedRouteLegIds).toEqual([]);
  });

  it('removes route legs that are no longer adjacent after a reorder', () => {
    const first = createDestination({
      name: 'First',
      coordinates: { lat: 1, lng: 1 },
      order: 0,
    });
    const second = createDestination({
      name: 'Second',
      coordinates: { lat: 2, lng: 2 },
      order: 1,
    });
    const third = createDestination({
      name: 'Third',
      coordinates: { lat: 3, lng: 3 },
      order: 2,
    });
    const oldLeg = createRouteLeg({
      originDestinationId: first.id,
      targetDestinationId: second.id,
      type: 'driving-auto',
    });

    const result = reconcileRouteLegsForDestinations([first, third, second], [oldLeg]);

    expect(result.removedRouteLegIds).toEqual([oldLeg.id]);
    expect(result.routeLegs.map((leg) => [leg.originDestinationId, leg.targetDestinationId])).toEqual([
      [first.id, third.id],
      [third.id, second.id],
    ]);
  });
});
