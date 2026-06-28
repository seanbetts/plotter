import type { Destination, RouteLeg } from './types';

export type TripSnapshot = {
  version: 1;
  exportedAt: string;
  destinations: Destination[];
  routeLegs: RouteLeg[];
};

export type TripSnapshotInput = {
  destinations: Destination[];
  routeLegs: RouteLeg[];
};

export function serializeTripSnapshot(input: TripSnapshotInput): string {
  const snapshot: TripSnapshot = {
    version: 1,
    exportedAt: new Date().toISOString(),
    destinations: input.destinations,
    routeLegs: input.routeLegs,
  };

  return JSON.stringify(snapshot, null, 2);
}

export function parseTripSnapshot(json: string): TripSnapshot {
  const value = JSON.parse(json) as Partial<TripSnapshot> | null;

  if (
    value === null ||
    typeof value !== 'object' ||
    !Array.isArray(value.destinations) ||
    !Array.isArray(value.routeLegs)
  ) {
    throw new Error('Trip snapshot must include destinations and routeLegs arrays');
  }

  return {
    version: 1,
    exportedAt: typeof value.exportedAt === 'string' ? value.exportedAt : new Date().toISOString(),
    destinations: value.destinations as Destination[],
    routeLegs: value.routeLegs as RouteLeg[],
  };
}
