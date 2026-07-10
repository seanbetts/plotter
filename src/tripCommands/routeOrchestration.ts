import { createRouteKey, createStraightLineGeometry } from '../domain/routeLegs';
import { reconcileRouteLegsForDestinations } from '../domain/routePlanner';
import type { Coordinates, Destination, RouteLeg } from '../domain/types';

export type RouteLegPatch = Partial<Omit<RouteLeg, 'id' | 'createdAt' | 'updatedAt'>>;

export type CalculatedRoute = Pick<
  RouteLeg,
  'distanceKm' | 'travelTimeHours' | 'geometry' | 'provider' | 'profile'
>;

export type CalculateRouteInput = {
  origin: Coordinates;
  target: Coordinates;
  profile: 'driving-car';
};

export type CalculateRoute = (input: CalculateRouteInput) => Promise<CalculatedRoute>;

export type RouteLegPersistence = {
  saveRouteLeg(routeLeg: RouteLeg): Promise<void>;
  deleteRouteLeg(routeLegId: string): Promise<void>;
};

const createTimestamp = () => new Date().toISOString();

export function hasPreservableDrivingRouteData(routeLeg: RouteLeg | RouteLegPatch): boolean {
  return Boolean(
    routeLeg.type === 'driving-auto' &&
    routeLeg.status === 'ready' &&
    routeLeg.geometry &&
    routeLeg.distanceKm !== undefined &&
    routeLeg.travelTimeHours !== undefined &&
    routeLeg.provider &&
    routeLeg.profile === 'driving-car' &&
    routeLeg.routeKey &&
    routeLeg.calculatedAt &&
    !routeLeg.error,
  );
}

export async function calculateDrivingRouteLegs(input: {
  destinations: Destination[];
  routeLegs: RouteLeg[];
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
      (leg.status === 'ready' && hasPreservableDrivingRouteData(leg)) ||
      (leg.status === 'failed' && !input.retryFailed) ||
      !origin ||
      !target
    ) {
      calculatedRouteLegs.push(leg);
      continue;
    }

    try {
      const route = await input.calculateRoute({
        origin: origin.coordinates,
        target: target.coordinates,
        profile: 'driving-car',
      });
      calculatedRouteLegs.push({
        ...leg,
        ...route,
        status: 'ready',
        routeKey: createRouteKey({
          origin: origin.coordinates,
          target: target.coordinates,
          profile: 'driving-car',
        }),
        error: undefined,
        calculatedAt: createTimestamp(),
        updatedAt: createTimestamp(),
      });
    } catch (caught) {
      calculatedRouteLegs.push({
        ...leg,
        status: 'failed',
        distanceKm: undefined,
        travelTimeHours: undefined,
        geometry: undefined,
        provider: undefined,
        profile: 'driving-car',
        routeKey: createRouteKey({
          origin: origin.coordinates,
          target: target.coordinates,
          profile: 'driving-car',
        }),
        calculatedAt: undefined,
        error: caught instanceof Error ? caught.message : 'Route calculation failed',
        updatedAt: createTimestamp(),
      });
    }
  }

  return calculatedRouteLegs;
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

  if (hasPreservableDrivingRouteData(input.routeLeg)) {
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
