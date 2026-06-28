import { createRouteKey, createRouteLeg } from './routeLegs';
import type { Coordinates, Destination, RouteLeg } from './types';

type ReconcileRouteLegsResult = {
  routeLegs: RouteLeg[];
  removedRouteLegIds: string[];
};

function routePairKey(originDestinationId: string, targetDestinationId: string) {
  return `${originDestinationId}:${targetDestinationId}`;
}

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

export function findBestDestinationInsertionIndex(
  destinations: Destination[],
  coordinates: Coordinates,
): number {
  if (destinations.length <= 1) {
    return destinations.length;
  }

  let bestIndex = destinations.length;
  let bestScore = distanceKm(destinations[destinations.length - 1].coordinates, coordinates);

  for (let insertionIndex = 1; insertionIndex < destinations.length; insertionIndex += 1) {
    const previousDestination = destinations[insertionIndex - 1];
    const nextDestination = destinations[insertionIndex];
    const addedDistance =
      distanceKm(previousDestination.coordinates, coordinates) +
      distanceKm(coordinates, nextDestination.coordinates) -
      distanceKm(previousDestination.coordinates, nextDestination.coordinates);

    if (addedDistance < bestScore) {
      bestScore = addedDistance;
      bestIndex = insertionIndex;
    }
  }

  return bestIndex;
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
      nextRouteLegs.push(existingRouteLeg);
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
