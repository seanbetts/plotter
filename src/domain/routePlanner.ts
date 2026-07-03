import { createRouteKey, createRouteLeg, createStraightLineGeometry } from './routeLegs';
import type { Coordinates, Destination, RouteLeg } from './types';

type ReconcileRouteLegsResult = {
  routeLegs: RouteLeg[];
  removedRouteLegIds: string[];
};

export type DestinationInsertionCandidate = {
  insertionIndex: number;
  previousDestinationId?: string;
  nextDestinationId?: string;
  addedDistanceKm: number;
};

function routePairKey(originDestinationId: string, targetDestinationId: string) {
  return `${originDestinationId}:${targetDestinationId}`;
}

const createTimestamp = () => new Date().toISOString();

function degreesToRadians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

function distanceKm(left: Coordinates, right: Coordinates) {
  const earthRadiusKm = 6371;
  const latDelta = degreesToRadians(right.lat - left.lat);
  const lngDelta = degreesToRadians(right.lng - left.lng);
  const leftLat = degreesToRadians(left.lat);
  const rightLat = degreesToRadians(right.lat);
  const haversine =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(leftLat) * Math.cos(rightLat) * Math.sin(lngDelta / 2) ** 2;

  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function routeGeometryMatchesCoordinates(routeLeg: RouteLeg, origin: Destination, target: Destination) {
  const coordinates = routeLeg.geometry?.coordinates;
  const firstCoordinate = coordinates?.[0];
  const lastCoordinate = coordinates?.at(-1);

  return (
    firstCoordinate?.[0] === origin.coordinates.lng &&
    firstCoordinate?.[1] === origin.coordinates.lat &&
    lastCoordinate?.[0] === target.coordinates.lng &&
    lastCoordinate?.[1] === target.coordinates.lat
  );
}

function refreshRouteLegForDestinationCoordinates(
  routeLeg: RouteLeg,
  origin: Destination,
  target: Destination,
): RouteLeg {
  if (routeLeg.type === 'shipping-manual') {
    if (!routeLeg.geometry || routeGeometryMatchesCoordinates(routeLeg, origin, target)) {
      return routeLeg;
    }

    return {
      ...routeLeg,
      status: 'manual',
      geometry: createStraightLineGeometry(origin.coordinates, target.coordinates),
      distanceKm: undefined,
      travelTimeHours: undefined,
      provider: undefined,
      profile: undefined,
      routeKey: undefined,
      calculatedAt: undefined,
      error: undefined,
      updatedAt: createTimestamp(),
    };
  }

  const routeKey = createRouteKey({
    origin: origin.coordinates,
    target: target.coordinates,
    profile: routeLeg.profile,
  });

  if (routeLeg.routeKey === routeKey) {
    return routeLeg;
  }

  return {
    ...routeLeg,
    status: 'pending',
    distanceKm: undefined,
    travelTimeHours: undefined,
    geometry: undefined,
    provider: undefined,
    profile: routeLeg.profile ?? 'driving-car',
    routeKey,
    calculatedAt: undefined,
    error: undefined,
    updatedAt: createTimestamp(),
  };
}

export function findBestDestinationInsertionIndex(
  destinations: Destination[],
  coordinates: Coordinates,
): number {
  const candidates = getDestinationInsertionCandidates(destinations, coordinates);
  const bestCandidate = candidates.reduce<DestinationInsertionCandidate | null>(
    (best, candidate) =>
      best === null || candidate.addedDistanceKm < best.addedDistanceKm ? candidate : best,
    null,
  );

  return bestCandidate?.insertionIndex ?? destinations.length;
}

export function getDestinationInsertionCandidates(
  destinations: Destination[],
  coordinates: Coordinates,
): DestinationInsertionCandidate[] {
  if (destinations.length === 0) {
    return [{ insertionIndex: 0, addedDistanceKm: 0 }];
  }

  if (destinations.length <= 1) {
    const [onlyDestination] = destinations;

    return [
      {
        insertionIndex: destinations.length,
        previousDestinationId: onlyDestination.id,
        addedDistanceKm: distanceKm(onlyDestination.coordinates, coordinates),
      },
    ];
  }

  const candidates: DestinationInsertionCandidate[] = [];

  for (let insertionIndex = 1; insertionIndex < destinations.length; insertionIndex += 1) {
    const previousDestination = destinations[insertionIndex - 1];
    const nextDestination = destinations[insertionIndex];
    const addedDistance =
      distanceKm(previousDestination.coordinates, coordinates) +
      distanceKm(coordinates, nextDestination.coordinates) -
      distanceKm(previousDestination.coordinates, nextDestination.coordinates);

    candidates.push({
      insertionIndex,
      previousDestinationId: previousDestination.id,
      nextDestinationId: nextDestination.id,
      addedDistanceKm: addedDistance,
    });
  }

  const lastDestination = destinations[destinations.length - 1];
  candidates.push({
    insertionIndex: destinations.length,
    previousDestinationId: lastDestination.id,
    addedDistanceKm: distanceKm(lastDestination.coordinates, coordinates),
  });

  return candidates;
}

export function reconcileRouteLegsForDestinations(
  destinations: Destination[],
  routeLegs: RouteLeg[],
): ReconcileRouteLegsResult {
  const existingRouteLegsByPair = new Map(
    routeLegs.map((leg) => [
      routePairKey(leg.originDestinationId, leg.targetDestinationId),
      leg,
    ]),
  );
  const adjacentPairKeys = new Set<string>();
  const nextRouteLegs: RouteLeg[] = [];

  for (let index = 0; index < destinations.length - 1; index += 1) {
    const origin = destinations[index];
    const target = destinations[index + 1];
    const pairKey = routePairKey(origin.id, target.id);
    adjacentPairKeys.add(pairKey);

    const existingRouteLeg = existingRouteLegsByPair.get(pairKey);
    if (existingRouteLeg) {
      nextRouteLegs.push(refreshRouteLegForDestinationCoordinates(existingRouteLeg, origin, target));
      continue;
    }

    nextRouteLegs.push(
      createRouteLeg({
        originDestinationId: origin.id,
        targetDestinationId: target.id,
        type: 'driving-auto',
        routeKey: createRouteKey({
          origin: origin.coordinates,
          target: target.coordinates,
        }),
      }),
    );
  }

  return {
    routeLegs: nextRouteLegs,
    removedRouteLegIds: routeLegs
      .filter((leg) => !adjacentPairKeys.has(routePairKey(leg.originDestinationId, leg.targetDestinationId)))
      .map((leg) => leg.id),
  };
}
