import { describe, expect, it } from 'vitest';
import { createDestination } from './destinations';
import { createRouteLeg } from './routeLegs';
import { resolveVehiclePreset } from './vehiclePresets';
import {
  coordinateDistanceKm,
  findBestDestinationInsertionIndex,
  getDestinationInsertionCandidates,
  planRouteLegReconciliation,
  reconcileRouteLegsForDestinations,
} from './routePlanner';

describe('route planner helpers', () => {
  it('creates two automatic trip-vehicle legs after an ordinary insertion', () => {
    const bremen = createDestination({ name: 'Bremen', coordinates: { lat: 53.08, lng: 8.8 }, order: 0 });
    const hirtshals = createDestination({ name: 'Hirtshals', coordinates: { lat: 57.59, lng: 9.96 }, order: 1 });
    const kristiansand = createDestination({ name: 'Kristiansand', coordinates: { lat: 58.15, lng: 8.0 }, order: 2 });
    const bremenToKristiansand = createRouteLeg({
      originDestinationId: bremen.id,
      targetDestinationId: kristiansand.id,
      movement: 'drive', calculation: 'automatic',
    });

    const result = planRouteLegReconciliation({
      destinations: [bremen, hirtshals, kristiansand],
      currentRouteLegs: [bremenToKristiansand],
      routingVehicle: resolveVehiclePreset('expedition-truck'),
    });

    expect(result.routeLegs).toHaveLength(2);
    expect(result.routeLegs.every((leg) => leg.calculation === 'automatic')).toBe(true);
    expect(result.routeLegs.every((leg) => leg.profile === 'driving-hgv')).toBe(true);
    expect(result.routeLegs.every((leg) => leg.geometry === undefined)).toBe(true);
  });

  it('partitions waypoints and keeps require with the ferry section', () => {
    const origin = createDestination({ name: 'Origin', coordinates: { lat: 0, lng: 0 }, order: 0 });
    const insertedStop = createDestination({ name: 'Inserted', coordinates: { lat: 0, lng: 5 }, order: 1 });
    const target = createDestination({ name: 'Target', coordinates: { lat: 0, lng: 10 }, order: 2 });
    const location = origin.location;
    const constrainedReadyLeg = createRouteLeg({
      originDestinationId: origin.id,
      targetDestinationId: target.id,
      movement: 'drive', calculation: 'automatic',
      status: 'ready',
      ferryPolicy: 'require',
      waypoints: [
        { id: 'before', order: 0, name: 'Before stop', coordinates: { lat: 0, lng: 2 }, location, notes: '', links: [] },
        { id: 'ferry', order: 1, name: 'Ferry terminal', coordinates: { lat: 0, lng: 8 }, location, notes: '', links: [] },
      ],
      sections: [
        { kind: 'road', startGeometryIndex: 0, endGeometryIndex: 5, distanceKm: 5 },
        { kind: 'ferry', startGeometryIndex: 6, endGeometryIndex: 9, distanceKm: 4 },
        { kind: 'road', startGeometryIndex: 9, endGeometryIndex: 10, distanceKm: 1 },
      ],
      geometry: {
        type: 'LineString',
        coordinates: Array.from({ length: 11 }, (_, lng) => [lng, 0]),
      },
      distanceKm: 10,
      travelTimeHours: 1,
      provider: 'test',
      profile: 'driving-car',
      routeKey: 'ready',
      calculatedAt: '2026-07-11T00:00:00.000Z',
    });

    const result = planRouteLegReconciliation({
      destinations: [origin, insertedStop, target],
      currentRouteLegs: [constrainedReadyLeg],
      routingVehicle: resolveVehiclePreset('standard'),
    });

    expect(result.routeLegs[0].waypoints?.map((item) => item.name)).toEqual(['Before stop']);
    expect(result.routeLegs[1]).toMatchObject({
      ferryPolicy: 'require',
      waypoints: [expect.objectContaining({ name: 'Ferry terminal' })],
    });
    expect(result.routeLegs[0].ferryPolicy).toBe('allow');
  });

  it('copies avoid intent to both projected sections without copying waypoints to both', () => {
    const origin = createDestination({ name: 'Origin', coordinates: { lat: 0, lng: 0 }, order: 0 });
    const inserted = createDestination({ name: 'Inserted', coordinates: { lat: 0, lng: 5 }, order: 1 });
    const target = createDestination({ name: 'Target', coordinates: { lat: 0, lng: 10 }, order: 2 });
    const waypoint = { id: 'only', order: 0, name: 'Only once', coordinates: { lat: 0, lng: 3 }, location: origin.location, notes: '', links: [] };
    const source = createRouteLeg({
      originDestinationId: origin.id, targetDestinationId: target.id, movement: 'drive', calculation: 'automatic', status: 'ready',
      ferryPolicy: 'avoid', waypoints: [waypoint], geometry: { type: 'LineString', coordinates: Array.from({ length: 11 }, (_, lng) => [lng, 0]) },
      distanceKm: 10, travelTimeHours: 1, provider: 'test', profile: 'driving-car', routeKey: 'ready', calculatedAt: '2026-07-11T00:00:00.000Z',
    });

    const result = planRouteLegReconciliation({ destinations: [origin, inserted, target], currentRouteLegs: [source], routingVehicle: resolveVehiclePreset('standard') });

    expect(result.routeLegs.map((leg) => leg.ferryPolicy)).toEqual(['avoid', 'avoid']);
    expect(result.routeLegs.flatMap((leg) => leg.waypoints ?? []).map((item) => item.id)).toEqual(['only']);
  });

  it('treats reversed waypoint projections as ambiguous instead of reordering intent', () => {
    const origin = createDestination({ name: 'Origin', coordinates: { lat: 0, lng: 0 }, order: 0 });
    const inserted = createDestination({ name: 'Inserted', coordinates: { lat: 0, lng: 5 }, order: 1 });
    const target = createDestination({ name: 'Target', coordinates: { lat: 0, lng: 10 }, order: 2 });
    const waypoints = [
      { id: 'later', order: 0, name: 'Later', coordinates: { lat: 0, lng: 8 }, location: origin.location, notes: '', links: [] },
      { id: 'earlier', order: 1, name: 'Earlier', coordinates: { lat: 0, lng: 2 }, location: origin.location, notes: '', links: [] },
    ];
    const source = createRouteLeg({
      originDestinationId: origin.id,
      targetDestinationId: target.id,
      movement: 'drive', calculation: 'automatic',
      status: 'ready',
      waypoints,
      geometry: { type: 'LineString', coordinates: Array.from({ length: 11 }, (_, lng) => [lng, 0]) },
      distanceKm: 10,
      travelTimeHours: 1,
      provider: 'test',
      profile: 'driving-car',
      routeKey: 'ready',
      calculatedAt: '2026-07-11T00:00:00.000Z',
    });

    const result = planRouteLegReconciliation({ destinations: [origin, inserted, target], currentRouteLegs: [source], routingVehicle: resolveVehiclePreset('standard') });

    expect(result.routeLegs.every((leg) => leg.status === 'review-required')).toBe(true);
    expect(result.routeLegs.every((leg) => (leg.waypoints ?? []).length === 0)).toBe(true);
    expect(result.routeLegs.flatMap((leg) => leg.warnings ?? [])).toEqual([
      expect.objectContaining({
        code: 'ROUTE_INTENT_REASSIGNMENT_REQUIRED',
        context: { sourceRouteLegId: source.id, unresolvedIntent: expect.objectContaining({ waypoints }) },
      }),
    ]);
  });

  it('treats out-of-range ferry section indices as ambiguous without dropping require', () => {
    const origin = createDestination({ name: 'Origin', coordinates: { lat: 0, lng: 0 }, order: 0 });
    const inserted = createDestination({ name: 'Inserted', coordinates: { lat: 0, lng: 5 }, order: 1 });
    const target = createDestination({ name: 'Target', coordinates: { lat: 0, lng: 10 }, order: 2 });
    const source = createRouteLeg({
      originDestinationId: origin.id,
      targetDestinationId: target.id,
      movement: 'drive', calculation: 'automatic',
      status: 'ready',
      ferryPolicy: 'require',
      sections: [{ kind: 'ferry', startGeometryIndex: 90, endGeometryIndex: 100, distanceKm: 10 }],
      geometry: { type: 'LineString', coordinates: Array.from({ length: 11 }, (_, lng) => [lng, 0]) },
      distanceKm: 10,
      travelTimeHours: 1,
      provider: 'test',
      profile: 'driving-car',
      routeKey: 'ready',
      calculatedAt: '2026-07-11T00:00:00.000Z',
    });

    const result = planRouteLegReconciliation({ destinations: [origin, inserted, target], currentRouteLegs: [source], routingVehicle: resolveVehiclePreset('standard') });

    expect(result.routeLegs.every((leg) => leg.status === 'review-required')).toBe(true);
    expect(result.routeLegs.every((leg) => leg.ferryPolicy === 'allow')).toBe(true);
    expect(result.routeLegs.flatMap((leg) => leg.warnings ?? [])).toEqual([
      expect.objectContaining({
        code: 'ROUTE_INTENT_REASSIGNMENT_REQUIRED',
        context: { sourceRouteLegId: source.id, unresolvedIntent: expect.objectContaining({ ferryPolicy: 'require' }) },
      }),
    ]);
  });

  it('marks ambiguous constrained replacements review-required with one complete intent warning', () => {
    const origin = createDestination({ name: 'Origin', coordinates: { lat: 0, lng: 0 }, order: 0 });
    const inserted = createDestination({ name: 'Inserted', coordinates: { lat: 0, lng: 5 }, order: 1 });
    const target = createDestination({ name: 'Target', coordinates: { lat: 0, lng: 10 }, order: 2 });
    const unresolvedIntent = {
      movement: 'drive' as const,
      calculation: 'automatic' as const,
      ferryPolicy: 'require' as const,
      waypoints: [],
      notes: 'Use the overnight ferry.',
    };
    const source = createRouteLeg({
      originDestinationId: origin.id, targetDestinationId: target.id,
      ...unresolvedIntent,
    });

    const result = planRouteLegReconciliation({ destinations: [origin, inserted, target], currentRouteLegs: [source], routingVehicle: resolveVehiclePreset('standard') });

    expect(result.routeLegs).toHaveLength(2);
    expect(result.routeLegs.every((leg) => leg.status === 'review-required')).toBe(true);
    expect(result.routeLegs.flatMap((leg) => leg.warnings ?? [])).toEqual([
      expect.objectContaining({
        code: 'ROUTE_INTENT_REASSIGNMENT_REQUIRED',
        context: { sourceRouteLegId: source.id, unresolvedIntent },
      }),
    ]);
  });
  it('calculates a known great-circle distance', () => {
    expect(coordinateDistanceKm(
      { lat: 51.5072, lng: -0.1276 },
      { lat: 48.8566, lng: 2.3522 },
    )).toBeCloseTo(343.5, 0);
  });

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
        movement: 'drive', calculation: 'automatic',
        status: 'pending',
      },
      {
        originDestinationId: paris.id,
        targetDestinationId: istanbul.id,
        movement: 'drive', calculation: 'automatic',
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
      movement: 'vehicle-shipping', calculation: 'manual',
      notes: 'Ship the truck across here.',
    });

    const result = reconcileRouteLegsForDestinations([origin, target], [shippingLeg]);

    expect(result.routeLegs).toEqual([shippingLeg]);
    expect(result.removedRouteLegIds).toEqual([]);
  });

  it('preserves manual shipping leg geometry with waypoints when endpoints still match', () => {
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
      movement: 'vehicle-shipping', calculation: 'manual',
      geometry: {
        type: 'LineString',
        coordinates: [
          [origin.coordinates.lng, origin.coordinates.lat],
          [110.4, -12.2],
          [target.coordinates.lng, target.coordinates.lat],
        ],
      },
    });

    const result = reconcileRouteLegsForDestinations([origin, target], [shippingLeg]);

    expect(result.routeLegs).toEqual([shippingLeg]);
    expect(result.removedRouteLegIds).toEqual([]);
  });

  it('preserves complete selected driving alternative geometry when endpoints still match', () => {
    const origin = createDestination({
      name: 'Durmitor',
      coordinates: { lat: 43.1306, lng: 19.0342 },
      order: 0,
    });
    const target = createDestination({
      name: 'Kotor',
      coordinates: { lat: 42.4247, lng: 18.7712 },
      order: 1,
    });
    const selectedAlternativeLeg = createRouteLeg({
      originDestinationId: origin.id,
      targetDestinationId: target.id,
      movement: 'drive', calculation: 'automatic',
      status: 'ready',
      distanceKm: 140,
      travelTimeHours: 3.1,
      geometry: {
        type: 'LineString',
        coordinates: [
          [19.0342, 43.1306],
          [18.9, 42.9],
          [18.7712, 42.4247],
        ],
      },
      provider: 'openrouteservice',
      profile: 'driving-car',
      routeKey: 'driving-car:19.03420,43.13060:18.77120,42.42470:alternative-1',
      calculatedAt: '2026-07-04T12:00:00.000Z',
    });

    const result = reconcileRouteLegsForDestinations([origin, target], [selectedAlternativeLeg]);

    expect(result.routeLegs).toEqual([selectedAlternativeLeg]);
    expect(result.removedRouteLegIds).toEqual([]);
  });

  it('preserves complete selected driving alternatives with slightly snapped geometry endpoints', () => {
    const origin = createDestination({
      name: 'Durmitor',
      coordinates: { lat: 43.1306, lng: 19.0342 },
      order: 0,
    });
    const target = createDestination({
      name: 'Kotor',
      coordinates: { lat: 42.4247, lng: 18.7712 },
      order: 1,
    });
    const selectedAlternativeLeg = createRouteLeg({
      originDestinationId: origin.id,
      targetDestinationId: target.id,
      movement: 'drive', calculation: 'automatic',
      status: 'ready',
      distanceKm: 140,
      travelTimeHours: 3.1,
      geometry: {
        type: 'LineString',
        coordinates: [
          [19.03425, 43.13055],
          [18.9, 42.9],
          [18.77124, 42.42466],
        ],
      },
      provider: 'openrouteservice',
      profile: 'driving-car',
      routeKey: 'driving-car:19.03420,43.13060:18.77120,42.42470:alternative-1',
      calculatedAt: '2026-07-04T12:00:00.000Z',
    });

    const result = reconcileRouteLegsForDestinations([origin, target], [selectedAlternativeLeg]);

    expect(result.routeLegs).toEqual([selectedAlternativeLeg]);
    expect(result.removedRouteLegIds).toEqual([]);
  });

  it('marks selected driving alternatives pending when endpoints no longer match', () => {
    const origin = createDestination({
      name: 'Durmitor',
      coordinates: { lat: 43.1306, lng: 19.0342 },
      order: 0,
    });
    const target = createDestination({
      name: 'Kotor',
      coordinates: { lat: 42.4247, lng: 18.7712 },
      order: 1,
    });
    const movedOrigin = {
      ...origin,
      coordinates: { lat: 43.14, lng: 19.045 },
    };
    const selectedAlternativeLeg = createRouteLeg({
      originDestinationId: origin.id,
      targetDestinationId: target.id,
      movement: 'drive', calculation: 'automatic',
      status: 'ready',
      distanceKm: 140,
      travelTimeHours: 3.1,
      geometry: {
        type: 'LineString',
        coordinates: [
          [19.0342, 43.1306],
          [18.9, 42.9],
          [18.7712, 42.4247],
        ],
      },
      provider: 'openrouteservice',
      profile: 'driving-car',
      routeKey: 'driving-car:19.03420,43.13060:18.77120,42.42470:alternative-1',
      calculatedAt: '2026-07-04T12:00:00.000Z',
    });

    const result = reconcileRouteLegsForDestinations([movedOrigin, target], [selectedAlternativeLeg]);

    expect(result.routeLegs).toMatchObject([
      {
        id: selectedAlternativeLeg.id,
        movement: 'drive', calculation: 'automatic',
        status: 'pending',
        distanceKm: undefined,
        travelTimeHours: undefined,
        geometry: undefined,
        provider: undefined,
        profile: 'driving-car',
        routeKey: 'driving-car:19.04500,43.14000:18.77120,42.42470',
        calculatedAt: undefined,
        error: undefined,
      },
    ]);
  });

  it('marks selected driving alternatives pending after small coordinate edits within endpoint tolerance', () => {
    const origin = createDestination({
      name: 'Durmitor',
      coordinates: { lat: 43.1306, lng: 19.0342 },
      order: 0,
    });
    const target = createDestination({
      name: 'Kotor',
      coordinates: { lat: 42.4247, lng: 18.7712 },
      order: 1,
    });
    const slightlyMovedOrigin = {
      ...origin,
      coordinates: { lat: 43.1307, lng: 19.0343 },
    };
    const selectedAlternativeLeg = createRouteLeg({
      originDestinationId: origin.id,
      targetDestinationId: target.id,
      movement: 'drive', calculation: 'automatic',
      status: 'ready',
      distanceKm: 140,
      travelTimeHours: 3.1,
      geometry: {
        type: 'LineString',
        coordinates: [
          [19.0342, 43.1306],
          [18.9, 42.9],
          [18.7712, 42.4247],
        ],
      },
      provider: 'openrouteservice',
      profile: 'driving-car',
      routeKey: 'driving-car:19.03420,43.13060:18.77120,42.42470:alternative-1',
      calculatedAt: '2026-07-04T12:00:00.000Z',
    });

    const result = reconcileRouteLegsForDestinations([slightlyMovedOrigin, target], [selectedAlternativeLeg]);

    expect(result.routeLegs[0]).toMatchObject({
      id: selectedAlternativeLeg.id,
      movement: 'drive', calculation: 'automatic',
      status: 'pending',
      geometry: undefined,
      distanceKm: undefined,
      travelTimeHours: undefined,
      provider: undefined,
      profile: 'driving-car',
      routeKey: 'driving-car:19.03430,43.13070:18.77120,42.42470',
      calculatedAt: undefined,
      error: undefined,
    });
  });

  it('marks incomplete ready driving route data pending during reconciliation', () => {
    const origin = createDestination({
      name: 'Durmitor',
      coordinates: { lat: 43.1306, lng: 19.0342 },
      order: 0,
    });
    const target = createDestination({
      name: 'Kotor',
      coordinates: { lat: 42.4247, lng: 18.7712 },
      order: 1,
    });
    const incompleteLeg = createRouteLeg({
      originDestinationId: origin.id,
      targetDestinationId: target.id,
      movement: 'drive', calculation: 'automatic',
      status: 'ready',
      distanceKm: 140,
      travelTimeHours: 3.1,
      provider: 'openrouteservice',
      profile: 'driving-car',
      routeKey: 'driving-car:19.03420,43.13060:18.77120,42.42470:alternative-1',
      calculatedAt: '2026-07-04T12:00:00.000Z',
    });

    const result = reconcileRouteLegsForDestinations([origin, target], [incompleteLeg]);

    expect(result.routeLegs[0]).toMatchObject({
      id: incompleteLeg.id,
      movement: 'drive', calculation: 'automatic',
      status: 'pending',
      geometry: undefined,
      distanceKm: undefined,
      travelTimeHours: undefined,
      provider: undefined,
      profile: 'driving-car',
      calculatedAt: undefined,
      error: undefined,
    });
  });

  it('marks errored ready driving route data pending during reconciliation', () => {
    const origin = createDestination({
      name: 'Durmitor',
      coordinates: { lat: 43.1306, lng: 19.0342 },
      order: 0,
    });
    const target = createDestination({
      name: 'Kotor',
      coordinates: { lat: 42.4247, lng: 18.7712 },
      order: 1,
    });
    const erroredLeg = createRouteLeg({
      originDestinationId: origin.id,
      targetDestinationId: target.id,
      movement: 'drive', calculation: 'automatic',
      status: 'ready',
      distanceKm: 140,
      travelTimeHours: 3.1,
      geometry: {
        type: 'LineString',
        coordinates: [
          [19.0342, 43.1306],
          [18.9, 42.9],
          [18.7712, 42.4247],
        ],
      },
      provider: 'openrouteservice',
      profile: 'driving-car',
      routeKey: 'driving-car:19.03420,43.13060:18.77120,42.42470:alternative-1',
      calculatedAt: '2026-07-04T12:00:00.000Z',
      error: 'Route option failed after selection.',
    });

    const result = reconcileRouteLegsForDestinations([origin, target], [erroredLeg]);

    expect(result.routeLegs[0]).toMatchObject({
      id: erroredLeg.id,
      movement: 'drive', calculation: 'automatic',
      status: 'pending',
      geometry: undefined,
      distanceKm: undefined,
      travelTimeHours: undefined,
      provider: undefined,
      profile: 'driving-car',
      calculatedAt: undefined,
      error: undefined,
    });
  });

  it('marks non-driving ready route data pending during reconciliation', () => {
    const origin = createDestination({
      name: 'Durmitor',
      coordinates: { lat: 43.1306, lng: 19.0342 },
      order: 0,
    });
    const target = createDestination({
      name: 'Kotor',
      coordinates: { lat: 42.4247, lng: 18.7712 },
      order: 1,
    });
    const cyclingLeg = createRouteLeg({
      originDestinationId: origin.id,
      targetDestinationId: target.id,
      movement: 'drive', calculation: 'automatic',
      status: 'ready',
      distanceKm: 140,
      travelTimeHours: 3.1,
      geometry: {
        type: 'LineString',
        coordinates: [
          [19.0342, 43.1306],
          [18.9, 42.9],
          [18.7712, 42.4247],
        ],
      },
      provider: 'openrouteservice',
      profile: 'cycling-regular',
      routeKey: 'cycling-regular:19.03420,43.13060:18.77120,42.42470:alternative-1',
      calculatedAt: '2026-07-04T12:00:00.000Z',
    });

    const result = reconcileRouteLegsForDestinations([origin, target], [cyclingLeg]);

    expect(result.routeLegs[0]).toMatchObject({
      id: cyclingLeg.id,
      movement: 'drive', calculation: 'automatic',
      status: 'pending',
      geometry: undefined,
      distanceKm: undefined,
      travelTimeHours: undefined,
      provider: undefined,
      profile: 'driving-car',
      routeKey: 'driving-car:19.03420,43.13060:18.77120,42.42470',
      calculatedAt: undefined,
      error: undefined,
    });
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
      movement: 'drive', calculation: 'automatic',
    });

    const result = reconcileRouteLegsForDestinations([first, third, second], [oldLeg]);

    expect(result.removedRouteLegIds).toEqual([oldLeg.id]);
    expect(result.routeLegs.map((leg) => [leg.originDestinationId, leg.targetDestinationId])).toEqual([
      [first.id, third.id],
      [third.id, second.id],
    ]);
  });
});
