import { createRouteKey, createRouteLeg, createStraightLineGeometry } from './routeLegs';
import type { LineString } from 'geojson';
import type { Coordinates, Destination, RouteIntentSnapshot, RouteLeg, RouteWaypoint, TripRoutingVehicle } from './types';
import { standardRoutingVehicle } from './vehiclePresets';

type ReconcileRouteLegsResult = {
  routeLegs: RouteLeg[];
  removedRouteLegIds: string[];
};

type PlanRouteLegReconciliationInput = {
  destinations: Destination[];
  currentRouteLegs: RouteLeg[];
  routingVehicle: TripRoutingVehicle;
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
const drivingGeometryEndpointTolerance = 0.001;

function degreesToRadians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

export function coordinateDistanceKm(left: Coordinates, right: Coordinates) {
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

function coordinateMatches(value: number | undefined, expected: number, tolerance = 0) {
  return value !== undefined && Math.abs(value - expected) <= tolerance;
}

function routeGeometryMatchesCoordinates(
  routeLeg: RouteLeg,
  origin: Destination,
  target: Destination,
  tolerance = 0,
) {
  const coordinates = routeLeg.geometry?.coordinates;
  const firstCoordinate = coordinates?.[0];
  const lastCoordinate = coordinates?.at(-1);

  return (
    coordinateMatches(firstCoordinate?.[0], origin.coordinates.lng, tolerance) &&
    coordinateMatches(firstCoordinate?.[1], origin.coordinates.lat, tolerance) &&
    coordinateMatches(lastCoordinate?.[0], target.coordinates.lng, tolerance) &&
    coordinateMatches(lastCoordinate?.[1], target.coordinates.lat, tolerance)
  );
}

function routeHasWarning(routeLeg: RouteLeg, code: NonNullable<RouteLeg['warnings']>[number]['code']) {
  return (routeLeg.warnings ?? []).some((warning) => warning.code === code);
}

function routeProfileMatchesCurrentIntent(routeLeg: RouteLeg, routingVehicle: TripRoutingVehicle) {
  const hasFallbackProvenance = routeHasWarning(routeLeg, 'VEHICLE_PROFILE_FALLBACK');
  if (hasFallbackProvenance) {
    return routingVehicle.profile === 'driving-hgv' && routeLeg.profile === 'driving-car';
  }

  return routeLeg.profile === routingVehicle.profile;
}

function hasCompleteAppImplementableDrivingRouteData(routeLeg: RouteLeg, routingVehicle: TripRoutingVehicle) {
  return (
    routeLeg.movement === 'drive' &&
    routeLeg.calculation === 'automatic' &&
    routeLeg.status === 'ready' &&
    routeLeg.geometry &&
    routeLeg.distanceKm !== undefined &&
    routeLeg.travelTimeHours !== undefined &&
    routeLeg.provider &&
    routeProfileMatchesCurrentIntent(routeLeg, routingVehicle) &&
    routeLeg.routeKey &&
    routeLeg.calculatedAt &&
    !routeLeg.error
  );
}

function routeKeyMatchesCurrentIntent(
  routeLeg: RouteLeg,
  origin: Destination,
  target: Destination,
  routingVehicle: TripRoutingVehicle,
) {
  const routeKey = routeLeg.routeKey;
  if (!routeKey) return false;
  try {
    const parsed = JSON.parse(routeKey) as { variant?: string; providerOptions?: Record<string, unknown> };
    const keyInput = {
      origin: origin.coordinates,
      target: target.coordinates,
      routingVehicle,
      waypoints: [...(routeLeg.waypoints ?? [])]
        .sort((left, right) => left.order - right.order)
        .map((waypoint) => waypoint.coordinates),
      ferryPolicy: routeLeg.ferryPolicy ?? 'allow',
      variant: parsed.variant ?? undefined,
      providerOptions: parsed.providerOptions ?? {},
    };
    const currentProfileKey = createRouteKey(keyInput);
    const actualProfileKey = routeLeg.profile === 'driving-car' || routeLeg.profile === 'driving-hgv'
      ? createRouteKey({ ...keyInput, profile: routeLeg.profile })
      : currentProfileKey;

    return routeKey === currentProfileKey || routeKey === actualProfileKey;
  } catch {
    return false;
  }
}

function routeGeometryMatchesCurrentEndpoints(
  routeLeg: RouteLeg,
  origin: Destination,
  target: Destination,
) {
  const coordinates = routeLeg.geometry?.coordinates;
  const firstCoordinate = coordinates?.[0];
  const lastCoordinate = coordinates?.at(-1);
  const hasAdjustedAnchorProvenance = routeHasWarning(routeLeg, 'ROUTING_ANCHOR_ADJUSTED');
  const profile = routeLeg.profile === 'driving-car' || routeLeg.profile === 'driving-hgv'
    ? routeLeg.profile
    : undefined;

  const endpointMatches = (coordinate: number[] | undefined, destination: Destination) => {
    if (
      coordinateMatches(coordinate?.[0], destination.coordinates.lng, drivingGeometryEndpointTolerance) &&
      coordinateMatches(coordinate?.[1], destination.coordinates.lat, drivingGeometryEndpointTolerance)
    ) {
      return true;
    }
    if (!hasAdjustedAnchorProvenance || !profile) return false;

    const anchor = destination.routingAnchors[profile];
    return Boolean(
      anchor &&
      anchor.profile === profile &&
      coordinateMatches(anchor.originalCoordinates.lng, destination.coordinates.lng) &&
      coordinateMatches(anchor.originalCoordinates.lat, destination.coordinates.lat) &&
      coordinateMatches(coordinate?.[0], anchor.coordinates.lng, drivingGeometryEndpointTolerance) &&
      coordinateMatches(coordinate?.[1], anchor.coordinates.lat, drivingGeometryEndpointTolerance),
    );
  };

  return endpointMatches(firstCoordinate, origin) && endpointMatches(lastCoordinate, target);
}

function refreshRouteLegForDestinationCoordinates(
  routeLeg: RouteLeg,
  origin: Destination,
  target: Destination,
  routingVehicle: TripRoutingVehicle,
): RouteLeg {
  if (routeLeg.movement === 'vehicle-shipping' && routeLeg.calculation === 'manual') {
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

  if (routeLeg.status === 'ready') {
    if (
      hasCompleteAppImplementableDrivingRouteData(routeLeg, routingVehicle) &&
      routeKeyMatchesCurrentIntent(routeLeg, origin, target, routingVehicle) &&
      routeGeometryMatchesCurrentEndpoints(routeLeg, origin, target)
    ) {
      return routeLeg;
    }

    return {
      ...routeLeg,
      status: 'pending',
      distanceKm: undefined,
      travelTimeHours: undefined,
      geometry: undefined,
      provider: undefined,
      profile: routingVehicle.profile,
      routeKey: createRouteKey({
        origin: origin.coordinates, target: target.coordinates, routingVehicle,
        waypoints: [...(routeLeg.waypoints ?? [])].sort((left, right) => left.order - right.order).map((waypoint) => waypoint.coordinates),
        ferryPolicy: routeLeg.ferryPolicy ?? 'allow',
      }),
      calculatedAt: undefined,
      error: undefined,
      updatedAt: createTimestamp(),
    };
  }

  const routeKey = createRouteKey({
    origin: origin.coordinates, target: target.coordinates, routingVehicle,
    waypoints: [...(routeLeg.waypoints ?? [])].sort((left, right) => left.order - right.order).map((waypoint) => waypoint.coordinates),
    ferryPolicy: routeLeg.ferryPolicy ?? 'allow',
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
    profile: routingVehicle.profile,
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
        addedDistanceKm: coordinateDistanceKm(onlyDestination.coordinates, coordinates),
      },
    ];
  }

  const candidates: DestinationInsertionCandidate[] = [];

  for (let insertionIndex = 1; insertionIndex < destinations.length; insertionIndex += 1) {
    const previousDestination = destinations[insertionIndex - 1];
    const nextDestination = destinations[insertionIndex];
    const addedDistance =
      coordinateDistanceKm(previousDestination.coordinates, coordinates) +
      coordinateDistanceKm(coordinates, nextDestination.coordinates) -
      coordinateDistanceKm(previousDestination.coordinates, nextDestination.coordinates);

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
    addedDistanceKm: coordinateDistanceKm(lastDestination.coordinates, coordinates),
  });

  return candidates;
}

function nearestGeometryIndex(geometry: LineString, coordinates: Coordinates) {
  return geometry.coordinates.reduce(
    (best, [lng, lat], index) => {
      const distance = coordinateDistanceKm(coordinates, { lat, lng });
      return distance < best.distance ? { index, distance } : best;
    },
    { index: 0, distance: Number.POSITIVE_INFINITY },
  ).index;
}

function routeIntent(routeLeg: RouteLeg): RouteIntentSnapshot {
  return {
    movement: routeLeg.movement,
    calculation: routeLeg.calculation,
    ferryPolicy: routeLeg.ferryPolicy ?? 'allow',
    waypoints: routeLeg.waypoints ?? [],
    notes: routeLeg.notes,
  };
}

function isManualVehicleShipping(routeLeg: RouteLeg) {
  const intent = routeIntent(routeLeg);
  return intent.movement === 'vehicle-shipping' && intent.calculation === 'manual';
}

function hasConstrainedIntent(intent: RouteIntentSnapshot) {
  return intent.ferryPolicy !== 'allow' || intent.waypoints.length > 0 || intent.notes.trim().length > 0;
}

function createReplacementLeg(input: {
  origin: Destination;
  target: Destination;
  routingVehicle: TripRoutingVehicle;
  ferryPolicy?: RouteLeg['ferryPolicy'];
  waypoints?: RouteWaypoint[];
  status?: RouteLeg['status'];
  warnings?: RouteLeg['warnings'];
}) {
  return createRouteLeg({
    originDestinationId: input.origin.id,
    targetDestinationId: input.target.id,
    movement: 'drive',
    calculation: 'automatic',
    ferryPolicy: input.ferryPolicy ?? 'allow',
    waypoints: (input.waypoints ?? []).map((waypoint, order) => ({ ...waypoint, order })),
    status: input.status,
    warnings: input.warnings,
    profile: input.routingVehicle.profile,
    routeKey: createRouteKey({
      origin: input.origin.coordinates,
      target: input.target.coordinates,
      routingVehicle: input.routingVehicle,
      waypoints: (input.waypoints ?? []).map((waypoint) => waypoint.coordinates),
      ferryPolicy: input.ferryPolicy ?? 'allow',
    }),
  });
}

function splitRouteLeg(input: {
  source: RouteLeg;
  destinations: Destination[];
  routingVehicle: TripRoutingVehicle;
}): RouteLeg[] {
  if (isManualVehicleShipping(input.source)) {
    throw new Error('Resolve vehicle shipping before inserting a stop');
  }

  const intent = routeIntent(input.source);
  const segmentCount = input.destinations.length - 1;
  const defaultSegments = () => Array.from({ length: segmentCount }, (_, index) => createReplacementLeg({
    origin: input.destinations[index],
    target: input.destinations[index + 1],
    routingVehicle: input.routingVehicle,
  }));
  const ambiguousSegments = (message: string) => {
    const warning = {
      code: 'ROUTE_INTENT_REASSIGNMENT_REQUIRED' as const,
      message,
      context: { sourceRouteLegId: input.source.id, unresolvedIntent: intent },
    };
    return defaultSegments().map((leg, index) => ({
      ...leg,
      status: 'review-required' as const,
      warnings: index === 0 ? [warning] : [],
    }));
  };

  if (!hasConstrainedIntent(intent)) return defaultSegments();

  const geometry = input.source.status === 'ready' ? input.source.geometry : undefined;
  const boundaryIndexes = geometry
    ? input.destinations.map((destination) => nearestGeometryIndex(geometry, destination.coordinates))
    : [];
  const waypointIndexes = geometry
    ? intent.waypoints.map((waypoint) => nearestGeometryIndex(geometry, waypoint.coordinates))
    : [];
  const canProject = Boolean(
    geometry &&
    intent.notes.trim().length === 0 &&
    boundaryIndexes.every((index, position) => position === 0 || index > boundaryIndexes[position - 1]) &&
    waypointIndexes.every((index, position) => position === 0 || index >= waypointIndexes[position - 1]) &&
    waypointIndexes.every((index) => index >= boundaryIndexes[0] && index <= boundaryIndexes.at(-1)!),
  );

  if (!canProject) {
    return ambiguousSegments('Route intent could not be assigned safely after the stop change.');
  }

  const waypointSegments = Array.from({ length: segmentCount }, () => [] as RouteWaypoint[]);
  intent.waypoints.forEach((waypoint, waypointPosition) => {
    const geometryIndex = waypointIndexes[waypointPosition];
    const segmentIndex = boundaryIndexes.findIndex((boundaryIndex, index) => (
      index < segmentCount && geometryIndex <= boundaryIndexes[index + 1]
    ));
    waypointSegments[Math.max(0, segmentIndex)].push(waypoint);
  });

  let requiredFerrySegment = -1;
  if (intent.ferryPolicy === 'require') {
    const ferrySection = input.source.sections?.find((section) => section.kind === 'ferry');
    const validFerrySection = ferrySection &&
      Number.isInteger(ferrySection.startGeometryIndex) &&
      Number.isInteger(ferrySection.endGeometryIndex) &&
      ferrySection.startGeometryIndex >= 0 &&
      ferrySection.endGeometryIndex >= ferrySection.startGeometryIndex &&
      ferrySection.endGeometryIndex < geometry!.coordinates.length;
    if (!validFerrySection) {
      return ambiguousSegments('Required ferry intent could not be assigned safely after the stop change.');
    }
    const midpoint = (ferrySection.startGeometryIndex + ferrySection.endGeometryIndex) / 2;
    requiredFerrySegment = boundaryIndexes.findIndex((boundaryIndex, index) => (
      index < segmentCount && midpoint <= boundaryIndexes[index + 1]
    ));
    if (requiredFerrySegment === -1 || midpoint < boundaryIndexes[0]) {
      return ambiguousSegments('Required ferry intent could not be assigned safely after the stop change.');
    }
  }

  return Array.from({ length: segmentCount }, (_, index) => createReplacementLeg({
    origin: input.destinations[index],
    target: input.destinations[index + 1],
    routingVehicle: input.routingVehicle,
    waypoints: waypointSegments[index],
    ferryPolicy: intent.ferryPolicy === 'avoid'
      ? 'avoid'
      : intent.ferryPolicy === 'require' && index === requiredFerrySegment
        ? 'require'
        : 'allow',
  }));
}

export function planRouteLegReconciliation({
  destinations,
  currentRouteLegs,
  routingVehicle,
}: PlanRouteLegReconciliationInput): ReconcileRouteLegsResult {
  const destinationIndexById = new Map(destinations.map((destination, index) => [destination.id, index]));
  const splitSources = currentRouteLegs.filter((routeLeg) => {
    const originIndex = destinationIndexById.get(routeLeg.originDestinationId);
    const targetIndex = destinationIndexById.get(routeLeg.targetDestinationId);
    return originIndex !== undefined && targetIndex !== undefined && targetIndex > originIndex + 1;
  });
  const base = reconcileRouteLegsForDestinations(destinations, currentRouteLegs, routingVehicle);
  if (splitSources.length === 0) return base;

  const replacementsByPair = new Map<string, RouteLeg>();
  for (const source of splitSources) {
    const originIndex = destinationIndexById.get(source.originDestinationId)!;
    const targetIndex = destinationIndexById.get(source.targetDestinationId)!;
    const replacements = splitRouteLeg({
      source,
      destinations: destinations.slice(originIndex, targetIndex + 1),
      routingVehicle,
    });
    for (const replacement of replacements) {
      replacementsByPair.set(routePairKey(replacement.originDestinationId, replacement.targetDestinationId), replacement);
    }
  }

  return {
    routeLegs: base.routeLegs.map((routeLeg) => replacementsByPair.get(routePairKey(routeLeg.originDestinationId, routeLeg.targetDestinationId)) ?? routeLeg),
    removedRouteLegIds: [...new Set([...base.removedRouteLegIds, ...splitSources.map((source) => source.id)])],
  };
}

export function reconcileRouteLegsForDestinations(
  destinations: Destination[],
  routeLegs: RouteLeg[],
  routingVehicle: TripRoutingVehicle = standardRoutingVehicle,
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
      nextRouteLegs.push(refreshRouteLegForDestinationCoordinates(existingRouteLeg, origin, target, routingVehicle));
      continue;
    }

    nextRouteLegs.push(
      createRouteLeg({
        originDestinationId: origin.id,
        targetDestinationId: target.id,
        movement: 'drive',
        calculation: 'automatic',
          routeKey: createRouteKey({
            origin: origin.coordinates,
            target: target.coordinates,
            routingVehicle,
          }),
          profile: routingVehicle.profile,
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
