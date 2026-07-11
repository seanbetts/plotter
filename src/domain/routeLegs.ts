import type { LineString } from 'geojson';
import type {
  Coordinates,
  FerryPolicy,
  RouteCalculationMode,
  RouteLeg,
  RouteLegStatus,
  RouteMovement,
  RouteSection,
  RouteWarning,
  RouteWaypoint,
  TripRoutingVehicle,
} from './types';
import { standardRoutingVehicle } from './vehiclePresets';

type CreateRouteLegInput = {
  originDestinationId: string;
  targetDestinationId: string;
  movement?: RouteMovement;
  calculation?: RouteCalculationMode;
  ferryPolicy?: FerryPolicy;
  waypoints?: RouteWaypoint[];
  sections?: RouteSection[];
  warnings?: RouteWarning[];
  status?: RouteLegStatus;
  distanceKm?: number;
  travelTimeHours?: number;
  geometry?: LineString;
  provider?: string;
  profile?: string;
  routeKey?: string;
  calculatedAt?: string;
  error?: string;
  notes?: string;
};

type CreateRouteKeyInput = {
  origin: Coordinates;
  target: Coordinates;
  profile?: string;
  routingVehicle?: TripRoutingVehicle;
  waypoints?: Coordinates[];
  ferryPolicy?: FerryPolicy;
  variant?: string;
};

type CreateManualRouteLegInput = {
  origin: Coordinates;
  target: Coordinates;
  originDestinationId: string;
  targetDestinationId: string;
  notes?: string;
};

const nowIso = () => new Date().toISOString();
const createId = () => crypto.randomUUID();
const defaultProfile = 'driving-car';

function defaultStatusForIntent(movement: RouteMovement, calculation: RouteCalculationMode): RouteLegStatus {
  return movement === 'vehicle-shipping' && calculation === 'manual' ? 'manual' : 'pending';
}

function coordinateKey(coordinates: Coordinates) {
  return `${coordinates.lng.toFixed(5)},${coordinates.lat.toFixed(5)}`;
}

export function createRouteKey({
  origin,
  target,
  profile,
  routingVehicle = standardRoutingVehicle,
  waypoints = [],
  ferryPolicy = 'allow',
  variant,
}: CreateRouteKeyInput) {
  const vehicleSnapshot = profile && profile !== routingVehicle.profile
    ? { ...routingVehicle, profile }
    : routingVehicle;

  return JSON.stringify({
    routingVehicle: vehicleSnapshot,
    waypoints: waypoints.map(coordinateKey),
    ferryPolicy,
    origin: coordinateKey(origin),
    target: coordinateKey(target),
    variant: variant ?? null,
  });
}

export function createStraightLineGeometry(origin: Coordinates, target: Coordinates): LineString {
  return {
    type: 'LineString',
    coordinates: [
      [origin.lng, origin.lat],
      [target.lng, target.lat],
    ],
  };
}

export function createManualRouteLeg(input: CreateManualRouteLegInput): RouteLeg {
  return createRouteLeg({
    originDestinationId: input.originDestinationId,
    targetDestinationId: input.targetDestinationId,
    movement: 'vehicle-shipping',
    calculation: 'manual',
    status: 'manual',
    geometry: createStraightLineGeometry(input.origin, input.target),
    notes: input.notes,
  });
}

export function createRouteLeg(input: CreateRouteLegInput): RouteLeg {
  const timestamp = nowIso();
  const movement = input.movement ?? 'drive';
  const calculation = input.calculation ?? 'automatic';

  return {
    id: createId(),
    originDestinationId: input.originDestinationId,
    targetDestinationId: input.targetDestinationId,
    movement,
    calculation,
    ferryPolicy: input.ferryPolicy ?? 'allow',
    waypoints: input.waypoints ?? [],
    sections: input.sections ?? [],
    warnings: input.warnings ?? [],
    status: input.status ?? defaultStatusForIntent(movement, calculation),
    distanceKm: input.distanceKm,
    travelTimeHours: input.travelTimeHours,
    geometry: input.geometry,
    provider: input.provider,
    profile: input.profile ?? (movement === 'drive' && calculation === 'automatic' ? defaultProfile : undefined),
    routeKey: input.routeKey,
    calculatedAt: input.calculatedAt,
    error: input.error,
    notes: input.notes ?? '',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
