import type { LineString } from 'geojson';
import type { ResearchLink, Coordinates, ActivityLocation } from '../domain/types';
import type { TripRepository } from '../storage/tripRepository';
import type { TripDirectoryRepository, TripSummary } from '../storage/tripDirectoryRepository';

export type PlaceInput = {
  query?: string;
  coordinates?: Coordinates;
};

export type StopDraft = {
  id?: string;
  name: string;
  place: PlaceInput;
  expectedStayDays?: number;
  notes?: string;
  tags?: string[];
};

export type StopPatch = Partial<Omit<StopDraft, 'id'>> & {
  place?: PlaceInput;
};

export type ActivityDraft = {
  title: string;
  place?: PlaceInput;
};

export type ActivityPatch = {
  title?: string;
  description?: string;
  notes?: string;
  tags?: string[];
  place?: PlaceInput;
};

export type CommandError = {
  code: string;
  message: string;
  path?: string;
};

export type CommandResult<T> =
  | ({ ok: true; summary: string } & T)
  | { ok: false; error: CommandError };

export type ChangedSummary = {
  tripsCreated: string[];
  tripsDeleted: string[];
  stopsAdded: string[];
  stopsUpdated: string[];
  stopsDeleted: string[];
  activitiesAdded: string[];
  activitiesUpdated: string[];
  activitiesDeleted: string[];
  linksAdded: string[];
  linksDeleted: string[];
  routesRecalculated: number;
};

export type RouteCalculator = (input: {
  origin: Coordinates;
  target: Coordinates;
  profile: 'driving-car';
}) => Promise<{
  distanceKm: number;
  travelTimeHours: number;
  geometry: LineString;
  provider: string;
  profile: 'driving-car';
}>;

export type PlaceResolver = (input: {
  place: PlaceInput;
  profile: 'stop' | 'activity';
  fallbackName: string;
}) => Promise<{
  coordinates: Coordinates;
  location?: import('../domain/types').DestinationLocation;
  activityLocation?: ActivityLocation;
}>;

export type LinkEnricher = (url: string, sortOrder: number) => Promise<ResearchLink>;

export type TripDataServiceDependencies = {
  directory: TripDirectoryRepository;
  createTripRepository: (tripId: string) => TripRepository;
  calculateRoute?: RouteCalculator;
  resolvePlace?: PlaceResolver;
  enrichLink?: LinkEnricher;
};

export type TripWithData = {
  trip: TripSummary;
  stops: import('../domain/types').Destination[];
  routeLegs: import('../domain/types').RouteLeg[];
  activitiesByStopId?: Record<string, import('../domain/types').Activity[]>;
};
