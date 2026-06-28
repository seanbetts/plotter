import { createRouteKey, createRouteLeg } from './routeLegs';
import type { Destination, RouteLeg } from './types';

type ReconcileRouteLegsResult = {
  routeLegs: RouteLeg[];
  removedRouteLegIds: string[];
};

function routePairKey(originDestinationId: string, targetDestinationId: string) {
  return `${originDestinationId}:${targetDestinationId}`;
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
