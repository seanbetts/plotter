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

export type CalculatedRoute = Pick<
  RouteLeg,
  'distanceKm' | 'travelTimeHours' | 'geometry' | 'provider' | 'profile' | 'sections'
>;

export type CalculateRouteInput = {
  origin: Coordinates;
  target: Coordinates;
  profile: TripRoutingVehicle['profile'];
  routingVehicle?: TripRoutingVehicle;
  waypoints?: RouteWaypoint[];
  ferryPolicy?: FerryPolicy;
};

export type CalculateRoute = {
  bivarianceHack(input: CalculateRouteInput): Promise<CalculatedRoute>;
}['bivarianceHack'];

export type RouteLegPersistence = {
  saveRouteLeg(routeLeg: RouteLeg): Promise<void>;
  deleteRouteLeg(routeLegId: string): Promise<void>;
};

const createTimestamp = () => new Date().toISOString();

export function hasPreservableAutomaticRouteData(routeLeg: RouteLeg | RouteLegPatch): boolean {
  return Boolean(
    routeLeg.type === 'driving-auto' &&
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

function hasCompleteCalculatedRoute(route: CalculatedRoute): route is CalculatedRoute & {
  distanceKm: number;
  travelTimeHours: number;
  geometry: NonNullable<RouteLeg['geometry']>;
  provider: string;
  profile: string;
} {
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
      leg.type !== 'driving-auto' ||
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
    const clearedLeg = clearCalculatedRouteData(leg, input.routingVehicle.profile);
    const retainedWarnings = clearedLeg.warnings ?? [];

    try {
      const route = await input.calculateRoute({
        origin: origin.coordinates,
        target: target.coordinates,
        profile: input.routingVehicle.profile,
        routingVehicle: input.routingVehicle,
        waypoints,
        ferryPolicy,
      });
      if (!hasCompleteCalculatedRoute(route)) {
        throw new Error('Route calculation returned incomplete data');
      }

      const sections = route.sections ?? [];
      const ferryErrorCode = ferryIntentError(ferryPolicy, sections);
      if (ferryErrorCode) {
        const message = ferryIntentMessage(ferryErrorCode);
        calculatedRouteLegs.push({
          ...clearedLeg,
          status: 'failed',
          routeKey,
          warnings: [...retainedWarnings, { code: ferryErrorCode, message }],
          error: message,
          updatedAt: createTimestamp(),
        });
        continue;
      }

      const detourWarning = suspiciousDetourWarning({
        origin,
        target,
        routeDistanceKm: route.distanceKm,
      });
      const warnings = [...retainedWarnings, ...(detourWarning ? [detourWarning] : [])];
      const reviewRequired = warnings.length > 0;
      calculatedRouteLegs.push({
        ...clearedLeg,
        ...route,
        sections,
        status: reviewRequired ? 'review-required' : 'ready',
        distanceKm: reviewRequired ? undefined : route.distanceKm,
        travelTimeHours: reviewRequired ? undefined : route.travelTimeHours,
        routeKey,
        warnings,
        error: undefined,
        calculatedAt: createTimestamp(),
        updatedAt: createTimestamp(),
      });
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
    if (routeLeg.type !== 'driving-auto') return routeLeg;

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
  calculateRoute?: CalculateRoute;
}): Promise<RouteLeg> {
  const destinationsById = new Map(input.destinations.map((destination) => [destination.id, destination]));
  const origin = destinationsById.get(input.routeLeg.originDestinationId);
  const target = destinationsById.get(input.routeLeg.targetDestinationId);

  if (!origin || !target) return input.routeLeg;

  if (input.routeLeg.type === 'shipping-manual') {
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

  const [calculatedRouteLeg] = await calculateDrivingRouteLegs({
    destinations: input.destinations,
    calculateRoute: input.calculateRoute,
    routeLegs: [{
      ...input.routeLeg,
      status: 'pending',
      profile: input.routeLeg.profile ?? 'driving-car',
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
  calculateRoute?: CalculateRoute;
}): Promise<RouteLeg[]> {
  const reconciliation = reconcileRouteLegsForDestinations(input.destinations, input.currentRouteLegs);
  const nextRouteLegs = await calculateDrivingRouteLegs({
    destinations: input.destinations,
    routeLegs: reconciliation.routeLegs,
    calculateRoute: input.calculateRoute,
  });

  await Promise.all([
    ...reconciliation.removedRouteLegIds.map((routeLegId) => input.repository.deleteRouteLeg(routeLegId)),
    ...nextRouteLegs.map((routeLeg) => input.repository.saveRouteLeg(routeLeg)),
  ]);

  return nextRouteLegs;
}
