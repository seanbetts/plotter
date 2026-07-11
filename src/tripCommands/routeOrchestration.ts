import { createRouteKey, createStraightLineGeometry } from '../domain/routeLegs';
import { coordinateDistanceKm, reconcileRouteLegsForDestinations } from '../domain/routePlanner';
import { standardRoutingVehicle } from '../domain/vehiclePresets';
import type {
  Coordinates,
  Destination,
  FerryPolicy,
  RouteLeg,
  RouteSection,
  RouteWarning,
  RouteWaypoint,
  TripRoutingVehicle,
} from '../domain/types';

export type RouteLegPatch = Partial<Omit<RouteLeg, 'id' | 'createdAt' | 'updatedAt'>>;

export type CalculatedRoute = {
  distanceKm: number;
  travelTimeHours: number;
  geometry: NonNullable<RouteLeg['geometry']>;
  provider: string;
  profile: TripRoutingVehicle['profile'];
  sections: RouteSection[];
};

export type CalculateRouteInput = {
  origin: Coordinates;
  target: Coordinates;
  profile: TripRoutingVehicle['profile'];
  routingVehicle: TripRoutingVehicle;
  waypoints: RouteWaypoint[];
  ferryPolicy: FerryPolicy;
};

export type CalculateRoute = (input: CalculateRouteInput) => Promise<CalculatedRoute>;

export type RouteLegPersistence = {
  saveRouteLeg(routeLeg: RouteLeg): Promise<void>;
  deleteRouteLeg(routeLegId: string): Promise<void>;
};

const createTimestamp = () => new Date().toISOString();

export function createRouteResultFingerprint(
  routeLeg: RouteLeg,
  routingVehicle: TripRoutingVehicle,
) {
  return JSON.stringify({
    movement: routeLeg.movement,
    calculation: routeLeg.calculation,
    ferryPolicy: routeLeg.ferryPolicy ?? 'allow',
    waypoints: [...(routeLeg.waypoints ?? [])]
      .sort((left, right) => left.order - right.order)
      .map((waypoint) => ({
        id: waypoint.id,
        order: waypoint.order,
        lat: waypoint.coordinates.lat,
        lng: waypoint.coordinates.lng,
      })),
    notes: routeLeg.notes,
    routingVehicle: {
      preset: routingVehicle.preset,
      profile: routingVehicle.profile,
      vehicleType: routingVehicle.vehicleType ?? null,
      restrictions: {
        length: routingVehicle.restrictions.length ?? null,
        width: routingVehicle.restrictions.width ?? null,
        height: routingVehicle.restrictions.height ?? null,
        weight: routingVehicle.restrictions.weight ?? null,
        axleLoad: routingVehicle.restrictions.axleLoad ?? null,
      },
    },
    routeKey: routeLeg.routeKey ?? null,
  });
}

export function hasPreservableAutomaticRouteData(routeLeg: RouteLeg | RouteLegPatch): boolean {
  return Boolean(
    routeLeg.movement === 'drive' &&
    routeLeg.calculation === 'automatic' &&
    routeLeg.status === 'ready' &&
    routeLeg.geometry &&
    routeLeg.distanceKm !== undefined &&
    routeLeg.travelTimeHours !== undefined &&
    routeLeg.provider &&
    (routeLeg.profile === 'driving-car' || routeLeg.profile === 'driving-hgv') &&
    routeLeg.routeKey &&
    routeLeg.calculatedAt &&
    !routeLeg.error,
  );
}

export const hasPreservableDrivingRouteData = hasPreservableAutomaticRouteData;

function routeKeyForLeg(input: {
  origin: Destination;
  target: Destination;
  routeLeg: RouteLeg;
  routingVehicle: TripRoutingVehicle;
}) {
  return createRouteKey({
    origin: input.origin.coordinates,
    target: input.target.coordinates,
    routingVehicle: input.routingVehicle,
    waypoints: [...(input.routeLeg.waypoints ?? [])]
      .sort((left, right) => left.order - right.order)
      .map((waypoint) => waypoint.coordinates),
    ferryPolicy: input.routeLeg.ferryPolicy ?? 'allow',
  });
}

function clearCalculatedRouteData(routeLeg: RouteLeg, profile: TripRoutingVehicle['profile']): RouteLeg {
  return {
    ...routeLeg,
    distanceKm: undefined,
    travelTimeHours: undefined,
    geometry: undefined,
    provider: undefined,
    profile,
    sections: [],
    warnings: (routeLeg.warnings ?? []).filter(
      (warning) => warning.code === 'ROUTE_INTENT_REASSIGNMENT_REQUIRED',
    ),
    calculatedAt: undefined,
    error: undefined,
  };
}

function ferryIntentError(policy: FerryPolicy, sections: RouteSection[]) {
  const hasFerry = sections.some((section) => section.kind === 'ferry');
  if (policy === 'require' && !hasFerry) return 'FERRY_REQUIRED_NOT_FOUND' as const;
  if (policy === 'avoid' && hasFerry) return 'FERRY_AVOIDED_BUT_FOUND' as const;
  return null;
}

function ferryIntentMessage(code: 'FERRY_REQUIRED_NOT_FOUND' | 'FERRY_AVOIDED_BUT_FOUND') {
  return code === 'FERRY_REQUIRED_NOT_FOUND'
    ? 'Required ferry section was not returned.'
    : 'A ferry section was returned despite avoid-ferries intent.';
}

function hasCompleteCalculatedRoute(route: CalculatedRoute) {
  return (
    route.distanceKm !== undefined &&
    route.travelTimeHours !== undefined &&
    route.geometry !== undefined &&
    Boolean(route.provider) &&
    Boolean(route.profile)
  );
}

function suspiciousDetourWarning(input: {
  origin: Destination;
  target: Destination;
  routeDistanceKm: number;
}): RouteWarning | null {
  const directDistanceKm = coordinateDistanceKm(input.origin.coordinates, input.target.coordinates);
  const excessDistanceKm = input.routeDistanceKm - directDistanceKm;
  if (!(input.routeDistanceKm > directDistanceKm * 2 && excessDistanceKm >= 500)) return null;

  const ratio = input.routeDistanceKm / directDistanceKm;
  return {
    code: 'SUSPICIOUS_DETOUR',
    message: `Automatic driving route ${input.origin.name} to ${input.target.name} is ${Math.round(input.routeDistanceKm)} km versus ${Math.round(directDistanceKm)} km direct (${ratio.toFixed(1)}x, ${Math.round(excessDistanceKm)} km excess).`,
  };
}

type ApplyCalculatedRouteResultInput = {
  routeLeg: RouteLeg;
  origin: Destination;
  target: Destination;
  route: CalculatedRoute;
  routeKey: string;
  preserveUnresolvedReview?: boolean;
};

export function applyCalculatedRouteResult({
  routeLeg,
  origin,
  target,
  route,
  routeKey,
  preserveUnresolvedReview = false,
}: ApplyCalculatedRouteResultInput): RouteLeg {
  const clearedLeg = clearCalculatedRouteData(routeLeg, route.profile);
  const retainedWarnings = clearedLeg.warnings ?? [];
  const timestamp = createTimestamp();

  if (!hasCompleteCalculatedRoute(route)) {
    return {
      ...clearedLeg,
      status: 'failed',
      routeKey,
      error: 'Route calculation returned incomplete data',
      updatedAt: timestamp,
    };
  }
  if (!Array.isArray(route.sections)) {
    return {
      ...clearedLeg,
      status: 'failed',
      routeKey,
      error: 'Route calculation returned incomplete section metadata',
      updatedAt: timestamp,
    };
  }

  const ferryErrorCode = ferryIntentError(routeLeg.ferryPolicy ?? 'allow', route.sections);
  if (ferryErrorCode) {
    const message = ferryIntentMessage(ferryErrorCode);
    return {
      ...clearedLeg,
      status: 'failed',
      routeKey,
      warnings: [...retainedWarnings, { code: ferryErrorCode, message }],
      error: message,
      updatedAt: timestamp,
    };
  }

  const detourWarning = suspiciousDetourWarning({
    origin,
    target,
    routeDistanceKm: route.distanceKm,
  });
  const warnings = [...retainedWarnings, ...(detourWarning ? [detourWarning] : [])];
  const reviewRequired = preserveUnresolvedReview || warnings.length > 0;

  return {
    ...clearedLeg,
    ...route,
    status: reviewRequired ? 'review-required' : 'ready',
    distanceKm: reviewRequired ? undefined : route.distanceKm,
    travelTimeHours: reviewRequired ? undefined : route.travelTimeHours,
    routeKey,
    warnings,
    error: undefined,
    calculatedAt: timestamp,
    updatedAt: timestamp,
  };
}

export function hasFinalizedAutomaticRouteResult(routeLeg: RouteLeg): boolean {
  if (routeLeg.movement !== 'drive' || routeLeg.calculation !== 'automatic') return false;
  if (routeLeg.status === 'ready') return hasPreservableAutomaticRouteData(routeLeg);
  if (routeLeg.status === 'failed') {
    return Boolean(
      routeLeg.error &&
      routeLeg.distanceKm === undefined &&
      routeLeg.travelTimeHours === undefined &&
      routeLeg.geometry === undefined,
    );
  }
  if (routeLeg.status !== 'review-required') return false;

  return Boolean(
    routeLeg.geometry?.type === 'LineString' &&
    routeLeg.geometry.coordinates.length >= 2 &&
    routeLeg.provider &&
    (routeLeg.profile === 'driving-car' || routeLeg.profile === 'driving-hgv') &&
    routeLeg.routeKey &&
    routeLeg.calculatedAt &&
    routeLeg.distanceKm === undefined &&
    routeLeg.travelTimeHours === undefined &&
    !routeLeg.error,
  );
}

export async function calculateAutomaticRouteLegs(input: {
  destinations: Destination[];
  routeLegs: RouteLeg[];
  routingVehicle: TripRoutingVehicle;
  calculateRoute?: CalculateRoute;
  retryFailed?: boolean;
}): Promise<RouteLeg[]> {
  if (!input.calculateRoute) return input.routeLegs;

  const destinationsById = new Map(input.destinations.map((destination) => [destination.id, destination]));
  const calculatedRouteLegs: RouteLeg[] = [];

  for (const leg of input.routeLegs) {
    const origin = destinationsById.get(leg.originDestinationId);
    const target = destinationsById.get(leg.targetDestinationId);

    if (
      leg.movement !== 'drive' ||
      leg.calculation !== 'automatic' ||
      (leg.status === 'ready' && hasPreservableAutomaticRouteData(leg)) ||
      (leg.status === 'failed' && !input.retryFailed) ||
      !origin ||
      !target
    ) {
      calculatedRouteLegs.push(leg);
      continue;
    }

    const ferryPolicy = leg.ferryPolicy ?? 'allow';
    const waypoints = [...(leg.waypoints ?? [])].sort((left, right) => left.order - right.order);
    const routeKey = routeKeyForLeg({ origin, target, routeLeg: leg, routingVehicle: input.routingVehicle });
    const preservesUnresolvedReview = leg.status === 'review-required';
    const clearedLeg = clearCalculatedRouteData(leg, input.routingVehicle.profile);

    try {
      const route = await input.calculateRoute({
        origin: origin.coordinates,
        target: target.coordinates,
        profile: input.routingVehicle.profile,
        routingVehicle: input.routingVehicle,
        waypoints,
        ferryPolicy,
      });
      calculatedRouteLegs.push(applyCalculatedRouteResult({
        routeLeg: leg,
        origin,
        target,
        routeKey,
        route,
        preserveUnresolvedReview: preservesUnresolvedReview,
      }));
    } catch (caught) {
      calculatedRouteLegs.push({
        ...clearedLeg,
        status: 'failed',
        routeKey,
        error: caught instanceof Error ? caught.message : 'Route calculation failed',
        updatedAt: createTimestamp(),
      });
    }
  }

  return calculatedRouteLegs;
}

export async function calculateDrivingRouteLegs(input: {
  destinations: Destination[];
  routeLegs: RouteLeg[];
  calculateRoute?: CalculateRoute;
  retryFailed?: boolean;
}): Promise<RouteLeg[]> {
  return calculateAutomaticRouteLegs({ ...input, routingVehicle: standardRoutingVehicle });
}

export function recalculateAutomaticRouteLegsForVehicle(input: {
  destinations: Destination[];
  routeLegs: RouteLeg[];
  routingVehicle: TripRoutingVehicle;
}): RouteLeg[] {
  const destinationsById = new Map(input.destinations.map((destination) => [destination.id, destination]));

  return input.routeLegs.map((routeLeg) => {
    if (routeLeg.movement !== 'drive' || routeLeg.calculation !== 'automatic') return routeLeg;

    const origin = destinationsById.get(routeLeg.originDestinationId);
    const target = destinationsById.get(routeLeg.targetDestinationId);
    const clearedLeg = clearCalculatedRouteData(routeLeg, input.routingVehicle.profile);
    return {
      ...clearedLeg,
      status: 'pending',
      routeKey: origin && target
        ? routeKeyForLeg({ origin, target, routeLeg, routingVehicle: input.routingVehicle })
        : undefined,
      updatedAt: createTimestamp(),
    };
  });
}

export async function finalizeRouteLeg(input: {
  routeLeg: RouteLeg;
  destinations: Destination[];
  routingVehicle: TripRoutingVehicle;
  calculateRoute?: CalculateRoute;
}): Promise<RouteLeg> {
  const destinationsById = new Map(input.destinations.map((destination) => [destination.id, destination]));
  const origin = destinationsById.get(input.routeLeg.originDestinationId);
  const target = destinationsById.get(input.routeLeg.targetDestinationId);

  if (!origin || !target) return input.routeLeg;

  if (input.routeLeg.movement === 'vehicle-shipping' && input.routeLeg.calculation === 'manual') {
    return {
      ...input.routeLeg,
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

  if (hasPreservableAutomaticRouteData(input.routeLeg)) {
    return { ...input.routeLeg, error: undefined, updatedAt: createTimestamp() };
  }

  const [calculatedRouteLeg] = await calculateAutomaticRouteLegs({
    destinations: input.destinations,
    calculateRoute: input.calculateRoute,
    routingVehicle: input.routingVehicle,
    routeLegs: [{
      ...input.routeLeg,
      status: 'pending',
      profile: input.routingVehicle.profile,
      error: undefined,
      updatedAt: createTimestamp(),
    }],
  });

  return calculatedRouteLeg;
}

export async function reconcileAndSaveRouteLegs(input: {
  destinations: Destination[];
  currentRouteLegs: RouteLeg[];
  repository: RouteLegPersistence;
  routingVehicle?: TripRoutingVehicle;
  calculateRoute?: CalculateRoute;
}): Promise<RouteLeg[]> {
  const routingVehicle = input.routingVehicle ?? standardRoutingVehicle;
  const reconciliation = reconcileRouteLegsForDestinations(
    input.destinations,
    input.currentRouteLegs,
    routingVehicle,
  );
  const nextRouteLegs = await calculateAutomaticRouteLegs({
    destinations: input.destinations,
    routeLegs: reconciliation.routeLegs,
    routingVehicle,
    calculateRoute: input.calculateRoute,
  });

  await Promise.all([
    ...reconciliation.removedRouteLegIds.map((routeLegId) => input.repository.deleteRouteLeg(routeLegId)),
    ...nextRouteLegs.map((routeLeg) => input.repository.saveRouteLeg(routeLeg)),
  ]);

  return nextRouteLegs;
}
