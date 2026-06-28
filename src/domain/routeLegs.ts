import type { LineString } from 'geojson';
import type { Coordinates, RouteLeg, RouteLegStatus, RouteLegType } from './types';

type CreateRouteLegInput = {
  originDestinationId: string;
  targetDestinationId: string;
  type: RouteLegType;
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
};

const nowIso = () => new Date().toISOString();
const createId = () => crypto.randomUUID();
const defaultProfile = 'driving-car';

function defaultStatusForType(type: RouteLegType): RouteLegStatus {
  return type === 'shipping-manual' ? 'manual' : 'pending';
}

function coordinateKey(coordinates: Coordinates) {
  return `${coordinates.lng.toFixed(5)},${coordinates.lat.toFixed(5)}`;
}

export function createRouteKey({ origin, target, profile = defaultProfile }: CreateRouteKeyInput) {
  return `${profile}:${coordinateKey(origin)}:${coordinateKey(target)}`;
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

export function createRouteLeg(input: CreateRouteLegInput): RouteLeg {
  const timestamp = nowIso();

  return {
    id: createId(),
    originDestinationId: input.originDestinationId,
    targetDestinationId: input.targetDestinationId,
    type: input.type,
    status: input.status ?? defaultStatusForType(input.type),
    distanceKm: input.distanceKm,
    travelTimeHours: input.travelTimeHours,
    geometry: input.geometry,
    provider: input.provider,
    profile: input.profile ?? (input.type === 'driving-auto' ? defaultProfile : undefined),
    routeKey: input.routeKey,
    calculatedAt: input.calculatedAt,
    error: input.error,
    notes: input.notes ?? '',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
