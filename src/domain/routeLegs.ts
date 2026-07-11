import type { LineString } from 'geojson';
import type {
  Coordinates,
  FerryPolicy,
  RouteCalculationMode,
  RouteLeg,
  RouteLegStatus,
  RouteMovement,
  RouteProviderDiagnostic,
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
  providerDiagnostic?: RouteProviderDiagnostic;
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
  providerOptions?: Record<string, unknown>;
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

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)]),
  );
}

function coordinateSnapshot(coordinates: Coordinates) {
  return { lat: coordinates.lat, lng: coordinates.lng };
}

export function createRouteKey({
  origin,
  target,
  profile,
  routingVehicle = standardRoutingVehicle,
  waypoints = [],
  ferryPolicy = 'allow',
  variant,
  providerOptions = {},
}: CreateRouteKeyInput) {
  const vehicleSnapshot = profile && profile !== routingVehicle.profile
    ? { ...routingVehicle, profile }
    : routingVehicle;

  return JSON.stringify({
    version: 1,
    origin: coordinateSnapshot(origin),
    target: coordinateSnapshot(target),
    waypoints: waypoints.map(coordinateSnapshot),
    routingVehicle: {
      preset: vehicleSnapshot.preset,
      profile: vehicleSnapshot.profile,
      vehicleType: vehicleSnapshot.vehicleType ?? null,
      restrictions: {
        length: vehicleSnapshot.restrictions.length ?? null,
        width: vehicleSnapshot.restrictions.width ?? null,
        height: vehicleSnapshot.restrictions.height ?? null,
        weight: vehicleSnapshot.restrictions.weight ?? null,
        axleLoad: vehicleSnapshot.restrictions.axleLoad ?? null,
      },
    },
    ferryPolicy,
    providerOptions: canonicalize(providerOptions),
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
    providerDiagnostic: input.providerDiagnostic,
    notes: input.notes ?? '',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
