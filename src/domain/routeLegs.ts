import type { LineString } from 'geojson';
import type { Coordinates, RouteLeg, RouteLegType } from './types';

type CreateRouteLegInput = {
  originDestinationId: string;
  targetDestinationId: string;
  type: RouteLegType;
  distanceKm?: number;
  travelTimeHours?: number;
  geometry?: LineString;
  notes?: string;
};

const nowIso = () => new Date().toISOString();
const createId = () => crypto.randomUUID();

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
    distanceKm: input.distanceKm,
    travelTimeHours: input.travelTimeHours,
    geometry: input.geometry,
    notes: input.notes ?? '',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
