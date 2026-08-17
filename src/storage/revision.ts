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
  public readonly currentRevision: number;

  constructor(currentRevision: number) {
    super('Another device changed this data. Plotter reloaded the latest version.');
    this.name = 'TripStorageConflictError';
    this.currentRevision = currentRevision;
  }
}

export type RevisionChange =
  | { scope: 'directory'; revision: number }
  | { scope: 'trip'; tripId: string; revision: number };

export type RevisionEvent =
  | { kind: 'revision'; epoch: string; scope: 'directory'; revision: number }
  | { kind: 'revision'; epoch: string; scope: 'trip'; tripId: string; revision: number }
  | { kind: 'restore-reset'; epoch: string; scope: 'directory' }
  | { kind: 'restore-reset'; epoch: string; scope: 'trip'; tripId: string };

export type ServiceInvalidation =
  | number
  | { kind: 'restore-reset'; resetId: string };
