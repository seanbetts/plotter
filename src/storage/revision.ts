import type {
  Activity,
  Destination,
  ResearchLink,
  RouteIntentSnapshot,
  RouteLeg,
  RouteWarning,
  RouteWaypoint,
} from '../domain/types';
import type { TripSummary } from './tripDirectoryRepository';

export type TripSnapshot = {
  revision: number;
  destinations: Destination[];
  routeLegs: RouteLeg[];
  activities: Activity[];
};

export type TripContextResearchLink = Omit<ResearchLink, 'imageUrl'>;

export type TripContextDestination = Omit<
  Destination,
  'media' | 'routingAnchors' | 'activities' | 'research'
> & {
  research: Omit<Destination['research'], 'links'> & {
    links: TripContextResearchLink[];
  };
};

export type TripContextActivity = Omit<Activity, 'links'> & {
  links: TripContextResearchLink[];
};

export type TripContextWaypoint = Omit<RouteWaypoint, 'links'> & {
  links: TripContextResearchLink[];
};

export type TripContextRouteIntent = Omit<RouteIntentSnapshot, 'waypoints'> & {
  waypoints: TripContextWaypoint[];
};

export type TripContextRouteWarning = Omit<RouteWarning, 'context'> & {
  context?: {
    sourceRouteLegId: string;
    unresolvedIntent: TripContextRouteIntent;
  };
};

export type TripContextRouteLeg = Omit<
  RouteLeg,
  'geometry' | 'routeKey' | 'providerDiagnostic' | 'error' | 'waypoints' | 'warnings'
> & {
  waypoints: TripContextWaypoint[];
  warnings: TripContextRouteWarning[];
};

export type TripContextSnapshot = {
  directoryRevision: number;
  tripRevision: number;
  trip: TripSummary;
  destinations: TripContextDestination[];
  routeLegs: TripContextRouteLeg[];
  activities: TripContextActivity[];
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
