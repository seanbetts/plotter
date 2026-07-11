import type { LineString } from 'geojson';
import type {
  ActivityLocation,
  Coordinates,
  FerryPolicy,
  ResearchLink,
  RouteCalculationMode,
  RouteMovement,
  RouteSection,
  RouteWaypoint,
  TripRoutingVehicle,
  VehiclePreset,
} from '../domain/types';
import type { TripRepository } from '../storage/tripRepository';
import type { TripDirectoryRepository, TripSummary } from '../storage/tripDirectoryRepository';
import type { TripAuditReport } from './tripAudit';

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

export type ActivityManifestDraft = {
  title: string;
  place?: PlaceInput;
  description?: string;
  notes?: string;
  tags: string[];
  links: string[];
};

export type StopManifestDraft = {
  key: string;
  name: string;
  place: PlaceInput;
  expectedStayDays: number;
  notes?: string;
  tags: string[];
  links: string[];
  activities: ActivityManifestDraft[];
};

export type RouteWaypointDraft = {
  name: string;
  place: PlaceInput;
  notes?: string;
  links: string[];
};

export type RouteLegDirectiveDraftV2 = {
  fromStopKey: string;
  toStopKey: string;
  movement?: RouteMovement;
  calculation?: RouteCalculationMode;
  ferryPolicy?: FerryPolicy;
  waypoints?: RouteWaypointDraft[];
  notes?: string;
};

export type RouteLegDirectiveDraft = RouteLegDirectiveDraftV2;

export type TripManifestDraftV1 = {
  manifestVersion: 1;
  name: string;
  stops: StopManifestDraft[];
  routeLegs: RouteLegDirectiveDraftV2[];
};

export type TripManifestDraftV2 = {
  manifestVersion: 2;
  name: string;
  vehiclePreset: VehiclePreset;
  stops: StopManifestDraft[];
  routeLegs: RouteLegDirectiveDraftV2[];
};

export type TripManifestDraft = TripManifestDraftV1 | TripManifestDraftV2;

export type RouteLegIntentPatch = {
  movement?: RouteMovement;
  calculation?: RouteCalculationMode;
  ferryPolicy?: FerryPolicy;
  waypoints?: RouteWaypointDraft[];
  notes?: string;
};

export type CommandError = {
  code: string;
  message: string;
  path?: string;
  details?: {
    audit?: TripAuditReport;
  };
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
  profile: TripRoutingVehicle['profile'];
  routingVehicle: TripRoutingVehicle;
  waypoints: RouteWaypoint[];
  ferryPolicy: FerryPolicy;
}) => Promise<{
  distanceKm: number;
  travelTimeHours: number;
  geometry: LineString;
  provider: string;
  profile: TripRoutingVehicle['profile'];
  sections: RouteSection[];
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
