import { isOpenRouteServiceError } from '../adapters/openRouteService';
import type { Coordinates, RouteWarning, RoutingAnchor, TripRoutingVehicle } from '../domain/types';
import type { CalculatedRoute, CalculateRouteInput } from './routeOrchestration';

export type RecoveredRoute = CalculatedRoute & {
  warnings: RouteWarning[];
  endpointAnchors: { origin?: RoutingAnchor; target?: RoutingAnchor };
};

export type ProviderRouteRequest = CalculateRouteInput & {
  radiuses?: [number, number];
};

export type CalculateProviderRoute = (
  request: ProviderRouteRequest,
) => Promise<CalculatedRoute>;

type RecoveryInput = CalculateRouteInput & {
  originAnchor?: RoutingAnchor;
  targetAnchor?: RoutingAnchor;
};

type EndpointName = 'origin' | 'target';

const endpointRadiusMeters = 2000;
const endpointRadiusKm = endpointRadiusMeters / 1000;
const snapToleranceKm = 0.001;

function degreesToRadians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

function coordinateDistanceKm(left: Coordinates, right: Coordinates) {
  const earthRadiusKm = 6371;
  const latDelta = degreesToRadians(right.lat - left.lat);
  const lngDelta = degreesToRadians(right.lng - left.lng);
  const leftLatitude = degreesToRadians(left.lat);
  const rightLatitude = degreesToRadians(right.lat);
  const haversine =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(leftLatitude) * Math.cos(rightLatitude) * Math.sin(lngDelta / 2) ** 2;

  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function coordinateFromPair(pair: number[]): Coordinates {
  const [lng, lat] = pair;
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    throw new Error('Route calculation returned invalid endpoint geometry');
  }
  return { lat, lng };
}

function matchingAnchor(anchor: RoutingAnchor | undefined, profile: TripRoutingVehicle['profile']) {
  return anchor?.profile === profile ? anchor : undefined;
}

function requestWithSavedAnchors(input: RecoveryInput, profile: TripRoutingVehicle['profile']): ProviderRouteRequest {
  const { originAnchor: savedOriginAnchor, targetAnchor: savedTargetAnchor, ...routeInput } = input;
  const originAnchor = matchingAnchor(savedOriginAnchor, profile);
  const targetAnchor = matchingAnchor(savedTargetAnchor, profile);

  return {
    ...routeInput,
    profile,
    routingVehicle: vehicleForProfile(input.routingVehicle, profile),
    origin: originAnchor?.coordinates ?? input.origin,
    target: targetAnchor?.coordinates ?? input.target,
  };
}

function requestWithEndpointRadius(input: RecoveryInput, profile: TripRoutingVehicle['profile']): ProviderRouteRequest {
  const { originAnchor, targetAnchor, ...routeInput } = input;
  void originAnchor;
  void targetAnchor;
  return {
    ...routeInput,
    profile,
    routingVehicle: vehicleForProfile(input.routingVehicle, profile),
    origin: input.origin,
    target: input.target,
    radiuses: [endpointRadiusMeters, endpointRadiusMeters],
  };
}

function vehicleForProfile(
  routingVehicle: TripRoutingVehicle,
  profile: TripRoutingVehicle['profile'],
): TripRoutingVehicle {
  if (routingVehicle.profile === profile) return routingVehicle;
  if (profile === 'driving-car') {
    return {
      ...routingVehicle,
      profile,
      vehicleType: undefined,
      restrictions: {},
    };
  }
  return {
    ...routingVehicle,
    profile,
  };
}

type MaybeRecoveredRoute = CalculatedRoute & Partial<Pick<RecoveredRoute, 'warnings' | 'endpointAnchors'>>;

function asRecoveredRoute(
  route: MaybeRecoveredRoute,
  warnings: RouteWarning[] = route.warnings ?? [],
  endpointAnchors: RecoveredRoute['endpointAnchors'] = route.endpointAnchors ?? {},
): RecoveredRoute {
  return {
    ...route,
    warnings,
    endpointAnchors,
  };
}

function isEndpointRecoveryError(error: unknown) {
  return isOpenRouteServiceError(error) && error.status === 404 && error.code === 2010;
}

function isDisconnectedRouteError(error: unknown) {
  return isOpenRouteServiceError(error) && error.status === 404 && error.code === 2009;
}

function anchorWarning(endpointAnchors: RecoveredRoute['endpointAnchors']): RouteWarning[] {
  const adjustedAnchors = Object.entries(endpointAnchors) as Array<[EndpointName, RoutingAnchor | undefined]>;
  return adjustedAnchors
    .filter((entry): entry is [EndpointName, RoutingAnchor] => Boolean(entry[1]))
    .map(([endpoint, anchor]) => ({
      code: 'ROUTING_ANCHOR_ADJUSTED',
      message: `Route ${endpoint} uses a routing point ${anchor.snapDistanceKm.toFixed(1)} km from the stop.`,
    }));
}

function vehicleFallbackWarning(): RouteWarning {
  return {
    code: 'VEHICLE_PROFILE_FALLBACK',
    message: 'OpenRouteService could not calculate this leg with the requested vehicle profile, so driving-car was used.',
  };
}

function anchorFromGeometryEndpoint(input: {
  endpoint: EndpointName;
  originalCoordinates: Coordinates;
  snappedCoordinates: Coordinates;
  profile: TripRoutingVehicle['profile'];
}): RoutingAnchor | undefined {
  const snapDistanceKm = coordinateDistanceKm(input.originalCoordinates, input.snappedCoordinates);
  if (snapDistanceKm > endpointRadiusKm) {
    throw new Error(`Recovered route ${input.endpoint} is outside the 2 km endpoint radius.`);
  }
  if (snapDistanceKm <= snapToleranceKm) return undefined;

  return {
    profile: input.profile,
    coordinates: input.snappedCoordinates,
    originalCoordinates: input.originalCoordinates,
    snapDistanceKm,
    provider: 'openrouteservice',
    resolvedAt: new Date().toISOString(),
  };
}

async function calculateWithEndpointRecovery(
  input: RecoveryInput,
  calculate: CalculateProviderRoute,
  profile: TripRoutingVehicle['profile'],
) {
  const route = await calculate(requestWithEndpointRadius(input, profile));
  const firstCoordinate = route.geometry.coordinates.at(0);
  const lastCoordinate = route.geometry.coordinates.at(-1);
  if (!firstCoordinate || !lastCoordinate) {
    throw new Error('Route calculation returned invalid endpoint geometry');
  }

  const endpointAnchors = {
    origin: anchorFromGeometryEndpoint({
      endpoint: 'origin',
      originalCoordinates: input.origin,
      snappedCoordinates: coordinateFromPair(firstCoordinate),
      profile: route.profile,
    }),
    target: anchorFromGeometryEndpoint({
      endpoint: 'target',
      originalCoordinates: input.target,
      snappedCoordinates: coordinateFromPair(lastCoordinate),
      profile: route.profile,
    }),
  };

  return asRecoveredRoute(route, anchorWarning(endpointAnchors), endpointAnchors);
}

async function calculateDrivingCarFallback(
  input: RecoveryInput,
  calculate: CalculateProviderRoute,
) {
  try {
    const route = await calculate(requestWithSavedAnchors(input, 'driving-car'));
    return asRecoveredRoute(route, [vehicleFallbackWarning()]);
  } catch (carError) {
    if (!isEndpointRecoveryError(carError)) throw carError;
    const route = await calculateWithEndpointRecovery(input, calculate, 'driving-car');
    return {
      ...route,
      warnings: [vehicleFallbackWarning(), ...route.warnings],
    };
  }
}

export async function calculateRouteWithRecovery(
  input: RecoveryInput,
  calculate: CalculateProviderRoute,
): Promise<RecoveredRoute> {
  try {
    const route = await calculate(requestWithSavedAnchors(input, input.profile));
    return asRecoveredRoute(route);
  } catch (initialError) {
    if (isEndpointRecoveryError(initialError)) {
      try {
        return await calculateWithEndpointRecovery(input, calculate, input.profile);
      } catch (sameProfileRecoveryError) {
        if (
          input.profile === 'driving-hgv' &&
          (isEndpointRecoveryError(sameProfileRecoveryError) || isDisconnectedRouteError(sameProfileRecoveryError))
        ) {
          return calculateDrivingCarFallback(input, calculate);
        }
        throw sameProfileRecoveryError;
      }
    }

    if (input.profile === 'driving-hgv' && isDisconnectedRouteError(initialError)) {
      return calculateDrivingCarFallback(input, calculate);
    }

    throw initialError;
  }
}
