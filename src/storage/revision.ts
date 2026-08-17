import type { Activity, Destination, RouteLeg } from '../domain/types';
import type { TripSummary } from './tripDirectoryRepository';

export type TripSnapshot = {
  revision: number;
  destinations: Destination[];
  routeLegs: RouteLeg[];
  activities: Activity[];
};

export type DirectorySnapshot = {
  revision: number;
  trips: TripSummary[];
};

export class TripStorageConflictError extends Error {
  constructor(public readonly currentRevision: number) {
    super('Another device changed this data. Plotter reloaded the latest version.');
    this.name = 'TripStorageConflictError';
  }
}

export type RevisionEvent =
  | { scope: 'directory'; revision: number }
  | { scope: 'trip'; tripId: string; revision: number };
