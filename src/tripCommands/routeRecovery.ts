import { isOpenRouteServiceError, type OpenRouteServiceError } from '../adapters/openRouteService';
import type { Coordinates, RouteWarning, RoutingAnchor, RoutingAnchors, TripRoutingVehicle } from '../domain/types';
import type { CalculatedRoute, CalculateRouteInput } from './routeOrchestration';

export type RecoveredRoute = CalculatedRoute & {
  warnings: RouteWarning[];
  endpointAnchors: { origin?: RoutingAnchor; target?: RoutingAnchor };
};

export type ProviderRouteRequest = CalculateRouteInput & {
  radiuses?: number[];
};

export type CalculateProviderRoute = (
  request: ProviderRouteRequest,
) => Promise<CalculatedRoute>;

type RecoveryInput = CalculateRouteInput & {
  originAnchor?: RoutingAnchor;
  targetAnchor?: RoutingAnchor;
  originAnchors?: RoutingAnchors;
  targetAnchors?: RoutingAnchors;
};

type EndpointName = 'origin' | 'target';

const endpointRadiusMeters = 2000;
const endpointRadiusKm = endpointRadiusMeters / 1000;
const strictEndpointRadiusMeters = 350;
const snapToleranceKm = 0.001;

class EndpointRecoveryRejectedError extends Error {
  readonly name = 'EndpointRecoveryRejectedError';

  constructor(readonly details: {
    endpoint: EndpointName;
    profile: TripRoutingVehicle['profile'];
    snapDistanceKm: number;
  }) {
    super(`Recovered route ${details.endpoint} is outside the 2 km endpoint radius.`);
  }
}

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

function matchingAnchor(input: {
  anchor?: RoutingAnchor;
  anchors?: RoutingAnchors;
  profile: TripRoutingVehicle['profile'];
}) {
  return input.anchors?.[input.profile] ?? (input.anchor?.profile === input.profile ? input.anchor : undefined);
}

function routeRequestInput(input: RecoveryInput) {
  const {
    originAnchor,
    targetAnchor,
    originAnchors,
    targetAnchors,
    ...routeInput
  } = input;
  void originAnchor;
  void targetAnchor;
  void originAnchors;
  void targetAnchors;
  return routeInput;
}

function originAnchorFor(input: RecoveryInput, profile: TripRoutingVehicle['profile']) {
  return matchingAnchor({ anchor: input.originAnchor, anchors: input.originAnchors, profile });
}

function targetAnchorFor(input: RecoveryInput, profile: TripRoutingVehicle['profile']) {
  return matchingAnchor({ anchor: input.targetAnchor, anchors: input.targetAnchors, profile });
}

function savedAnchorsFor(input: RecoveryInput, profile: TripRoutingVehicle['profile']) {
  return {
    origin: originAnchorFor(input, profile),
    target: targetAnchorFor(input, profile),
  };
}

function requestWithSavedAnchors(input: RecoveryInput, profile: TripRoutingVehicle['profile']): ProviderRouteRequest {
  const originAnchor = originAnchorFor(input, profile);
  const targetAnchor = targetAnchorFor(input, profile);

  return {
    ...routeRequestInput(input),
    profile,
    routingVehicle: vehicleForProfile(input.routingVehicle, profile),
    origin: originAnchor?.coordinates ?? input.origin,
    target: targetAnchor?.coordinates ?? input.target,
  };
}

function requestWithEndpointRadius(
  input: RecoveryInput,
  profile: TripRoutingVehicle['profile'],
  coordinateIndex: number,
): ProviderRouteRequest {
  const targetIndex = input.waypoints.length + 1;
  const originAnchor = coordinateIndex === 0 ? undefined : originAnchorFor(input, profile);
  const targetAnchor = coordinateIndex === targetIndex ? undefined : targetAnchorFor(input, profile);
  const radiuses = Array.from(
    { length: input.waypoints.length + 2 },
    (_, index) => index === coordinateIndex ? endpointRadiusMeters : strictEndpointRadiusMeters,
  );

  return {
    ...routeRequestInput(input),
    profile,
    routingVehicle: vehicleForProfile(input.routingVehicle, profile),
    origin: originAnchor?.coordinates ?? input.origin,
    target: targetAnchor?.coordinates ?? input.target,
    radiuses,
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

function isEndpointRecoveryError(error: unknown): error is OpenRouteServiceError & { status: 404; code: 2010 } {
  return isOpenRouteServiceError(error) && error.status === 404 && error.code === 2010;
}

function endpointRecoveryIndex(error: unknown, input: RecoveryInput) {
  if (!isEndpointRecoveryError(error)) return null;
  const targetIndex = input.waypoints.length + 1;
  if (error.coordinateIndex === 0) return 0;
  if (error.coordinateIndex === targetIndex) return targetIndex;
  return null;
}

function isDisconnectedRouteError(error: unknown) {
  return isOpenRouteServiceError(error) && error.status === 404 && error.code === 2009;
}

function isEndpointRecoveryRejectedError(error: unknown): error is EndpointRecoveryRejectedError {
  return error instanceof EndpointRecoveryRejectedError;
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
    message: 'OpenRouteService could not calculate this leg with the requested vehicle profile, so driving-car was used; truck dimensions were not validated.',
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
    throw new EndpointRecoveryRejectedError({
      endpoint: input.endpoint,
      profile: input.profile,
      snapDistanceKm,
    });
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
  coordinateIndex: number,
) {
  const route = await calculate(requestWithEndpointRadius(input, profile, coordinateIndex));
  const firstCoordinate = route.geometry.coordinates.at(0);
  const lastCoordinate = route.geometry.coordinates.at(-1);
  if (!firstCoordinate || !lastCoordinate) {
    throw new Error('Route calculation returned invalid endpoint geometry');
  }
  const targetIndex = input.waypoints.length + 1;
  const endpoint = coordinateIndex === 0 ? 'origin' : 'target';
  const endpointAnchor = endpoint === 'origin'
    ? anchorFromGeometryEndpoint({
        endpoint,
        originalCoordinates: input.origin,
        snappedCoordinates: coordinateFromPair(firstCoordinate),
        profile: route.profile,
      })
    : anchorFromGeometryEndpoint({
        endpoint,
        originalCoordinates: input.target,
        snappedCoordinates: coordinateFromPair(lastCoordinate),
        profile: route.profile,
      });

  const endpointAnchors: RecoveredRoute['endpointAnchors'] = {
    ...(coordinateIndex === 0 ? { origin: endpointAnchor } : {}),
    ...(coordinateIndex === targetIndex ? { target: endpointAnchor } : {}),
  };
  const savedAnchors = savedAnchorsFor(input, profile);
  const usedAnchors: RecoveredRoute['endpointAnchors'] = {
    ...(coordinateIndex === 0 ? {} : { origin: savedAnchors.origin }),
    ...(coordinateIndex === targetIndex ? {} : { target: savedAnchors.target }),
    ...endpointAnchors,
  };

  return asRecoveredRoute(route, anchorWarning(usedAnchors), endpointAnchors);
}

async function calculateDrivingCarFallback(
  input: RecoveryInput,
  calculate: CalculateProviderRoute,
) {
  try {
    const route = await calculate(requestWithSavedAnchors(input, 'driving-car'));
    return asRecoveredRoute(route, [vehicleFallbackWarning(), ...anchorWarning(savedAnchorsFor(input, 'driving-car'))]);
  } catch (carError) {
    const carEndpointIndex = endpointRecoveryIndex(carError, input);
    if (carEndpointIndex === null) throw carError;
    const route = await calculateWithEndpointRecovery(input, calculate, 'driving-car', carEndpointIndex);
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
    const recoveredRoute = asRecoveredRoute(route);
    return asRecoveredRoute(recoveredRoute, [
      ...recoveredRoute.warnings,
      ...anchorWarning(savedAnchorsFor(input, input.profile)),
    ]);
  } catch (initialError) {
    const initialEndpointIndex = endpointRecoveryIndex(initialError, input);
    if (initialEndpointIndex !== null) {
      try {
        return await calculateWithEndpointRecovery(input, calculate, input.profile, initialEndpointIndex);
      } catch (sameProfileRecoveryError) {
        if (
          input.profile === 'driving-hgv' &&
          (
            endpointRecoveryIndex(sameProfileRecoveryError, input) !== null ||
            isDisconnectedRouteError(sameProfileRecoveryError) ||
            isEndpointRecoveryRejectedError(sameProfileRecoveryError)
          )
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
