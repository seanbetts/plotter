import type { LineString } from 'geojson';
import type {
  Activity,
  Destination,
  MediaItem,
  RouteCalculationMode,
  RouteLeg,
  RouteMovement,
  RouteSection,
  RouteWarning,
  RouteWaypoint,
  TripRoutingVehicle,
  VehiclePreset,
} from '../domain/types';
import { sortResearchLinks } from '../domain/researchLinks';
import { resolveVehiclePreset } from '../domain/vehiclePresets';
import type { TripSummary } from './tripDirectoryRepository';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type PersistedTripRow = {
  id: string;
  owner_user_id: string;
  name: string;
  description: string | null;
  vehicle_preset?: VehiclePreset;
  vehicle_profile?: TripRoutingVehicle['profile'];
  vehicle_type?: TripRoutingVehicle['vehicleType'] | null;
  vehicle_restrictions?: TripRoutingVehicle['restrictions'];
  created_at: string;
  updated_at: string;
};

export type PersistedDestinationRow = {
  id: string;
  trip_id: string;
  name: string;
  country_region: string;
  lat: number;
  lng: number;
  location: Destination['location'];
  stop_order: number;
  status: Destination['status'];
  priority: Destination['priority'];
  timing: Destination['timing'];
  why: Destination['why'];
  media: Destination['media'];
  research: Destination['research'];
  activities: Destination['activities'];
  route_context: Destination['routeContext'];
  routing_anchors?: Destination['routingAnchors'];
  tags: string[];
  created_at: string;
  updated_at: string;
};

export type PersistedActivityRow = {
  id: string;
  trip_id: string;
  destination_id: string;
  activity_order: number;
  title: string;
  description: string;
  category: Activity['category'];
  status: Activity['status'];
  priority: Activity['priority'];
  location: Activity['location'] | null;
  links: Activity['links'];
  notes: string;
  tags: string[];
  created_at: string;
  updated_at: string;
};

export type PersistedRouteLegRow = {
  id: string;
  trip_id: string;
  origin_destination_id: string;
  target_destination_id: string;
  movement: RouteMovement;
  calculation_mode: RouteCalculationMode;
  ferry_policy?: RouteLeg['ferryPolicy'];
  waypoints?: RouteWaypoint[];
  sections?: RouteSection[];
  warnings?: RouteWarning[];
  status: RouteLeg['status'];
  distance_km: number | null;
  travel_time_hours: number | null;
  geometry: LineString | null;
  provider: string | null;
  profile: string | null;
  route_key: string | null;
  calculated_at: string | null;
  error: string | null;
  provider_diagnostic?: RouteLeg['providerDiagnostic'] | null;
  notes: string;
  created_at: string;
  updated_at: string;
};

export type PersistedMediaAssetRow = {
  id: string;
  trip_id: string;
  destination_id: string | null;
  activity_id: string | null;
  bucket_id: string;
  object_path: string;
  caption: string;
  credit: string;
  sort_order: number;
  content_type: string | null;
  size_bytes: number | null;
  uploaded_by: string;
  created_at: string;
  updated_at: string;
};

export type PersistedMediaSignedUrls = {
  originalUrl: string;
  thumbnailUrl: string;
  previewUrl: string;
  fullUrl: string;
};

export function tripSummaryFromPersistedRow(row: PersistedTripRow): TripSummary {
  const defaultVehicle = resolveVehiclePreset('standard');
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    routingVehicle: {
      preset: row.vehicle_preset ?? defaultVehicle.preset,
      profile: row.vehicle_profile ?? defaultVehicle.profile,
      ...(row.vehicle_type ? { vehicleType: row.vehicle_type } : {}),
      restrictions: row.vehicle_restrictions ?? defaultVehicle.restrictions,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function routingVehicleToPersistedColumns(routingVehicle: TripRoutingVehicle) {
  return {
    vehicle_preset: routingVehicle.preset,
    vehicle_profile: routingVehicle.profile,
    vehicle_type: routingVehicle.vehicleType ?? null,
    vehicle_restrictions: routingVehicle.restrictions,
  };
}

export function tripSummaryToPersistedRow(trip: TripSummary, ownerUserId: string): PersistedTripRow {
  return {
    id: trip.id,
    owner_user_id: ownerUserId,
    name: trip.name,
    description: trip.description,
    ...routingVehicleToPersistedColumns(trip.routingVehicle),
    created_at: trip.createdAt,
    updated_at: trip.updatedAt,
  };
}

export function destinationToPersistedRow(destination: Destination, tripId: string): PersistedDestinationRow {
  return {
    id: destination.id,
    trip_id: tripId,
    name: destination.name,
    country_region: destination.countryRegion,
    lat: destination.coordinates.lat,
    lng: destination.coordinates.lng,
    location: destination.location,
    stop_order: destination.order,
    status: destination.status,
    priority: destination.priority,
    timing: destination.timing,
    why: destination.why,
    media: destination.media,
    research: destination.research,
    activities: destination.activities,
    route_context: destination.routeContext,
    routing_anchors: destination.routingAnchors,
    tags: destination.tags,
    created_at: destination.createdAt,
    updated_at: destination.updatedAt,
  };
}

export function destinationFromPersistedRow(row: PersistedDestinationRow): Destination {
  const savedResearch = row.research as unknown;
  if (savedResearch !== null && savedResearch !== undefined && !isRecord(savedResearch)) {
    throw new Error('Saved destination research is invalid.');
  }
  const research = (savedResearch ?? {}) as Partial<Destination['research']> & {
    notes?: string | null;
  };

  return {
    id: row.id,
    name: row.name,
    countryRegion: row.country_region,
    coordinates: { lat: row.lat, lng: row.lng },
    location: row.location,
    order: row.stop_order,
    status: row.status,
    priority: row.priority,
    timing: row.timing,
    why: row.why,
    media: row.media,
    research: {
      ...research,
      links: sortResearchLinks(research.links ?? []),
      bookReferences: research.bookReferences ?? [],
      notes: research.notes ?? '',
    },
    activities: row.activities,
    routeContext: row.route_context,
    routingAnchors: row.routing_anchors ?? {},
    tags: row.tags,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function activityToPersistedRow(activity: Activity, tripId: string): PersistedActivityRow {
  return {
    id: activity.id,
    trip_id: tripId,
    destination_id: activity.destinationId,
    activity_order: activity.order,
    title: activity.title,
    description: activity.description,
    category: activity.category,
    status: activity.status,
    priority: activity.priority,
    location: activity.location ?? null,
    links: activity.links,
    notes: activity.notes,
    tags: activity.tags,
    created_at: activity.createdAt,
    updated_at: activity.updatedAt,
  };
}

export function activityFromPersistedRow(row: PersistedActivityRow): Activity {
  return {
    id: row.id,
    destinationId: row.destination_id,
    order: row.activity_order,
    title: row.title,
    description: row.description,
    category: row.category,
    status: row.status,
    priority: row.priority,
    location: row.location ?? undefined,
    links: sortResearchLinks(row.links ?? []),
    notes: row.notes,
    tags: row.tags,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function routeLegToPersistedRow(routeLeg: RouteLeg, tripId: string): PersistedRouteLegRow {
  return {
    id: routeLeg.id,
    trip_id: tripId,
    origin_destination_id: routeLeg.originDestinationId,
    target_destination_id: routeLeg.targetDestinationId,
    movement: routeLeg.movement,
    calculation_mode: routeLeg.calculation,
    ferry_policy: routeLeg.ferryPolicy ?? 'allow',
    waypoints: routeLeg.waypoints ?? [],
    sections: routeLeg.sections ?? [],
    warnings: routeLeg.warnings ?? [],
    status: routeLeg.status,
    distance_km: routeLeg.distanceKm ?? null,
    travel_time_hours: routeLeg.travelTimeHours ?? null,
    geometry: routeLeg.geometry ?? null,
    provider: routeLeg.provider ?? null,
    profile: routeLeg.profile ?? null,
    route_key: routeLeg.routeKey ?? null,
    calculated_at: routeLeg.calculatedAt ?? null,
    error: routeLeg.error ?? null,
    provider_diagnostic: routeLeg.providerDiagnostic ?? null,
    notes: routeLeg.notes,
    created_at: routeLeg.createdAt,
    updated_at: routeLeg.updatedAt,
  };
}

export function routeLegFromPersistedRow(row: PersistedRouteLegRow): RouteLeg {
  return {
    id: row.id,
    originDestinationId: row.origin_destination_id,
    targetDestinationId: row.target_destination_id,
    movement: row.movement,
    calculation: row.calculation_mode,
    ferryPolicy: row.ferry_policy ?? 'allow',
    waypoints: row.waypoints ?? [],
    sections: row.sections ?? [],
    warnings: row.warnings ?? [],
    status: row.status,
    distanceKm: row.distance_km ?? undefined,
    travelTimeHours: row.travel_time_hours ?? undefined,
    geometry: row.geometry ?? undefined,
    provider: row.provider ?? undefined,
    profile: row.profile ?? undefined,
    routeKey: row.route_key ?? undefined,
    calculatedAt: row.calculated_at ?? undefined,
    error: row.error ?? undefined,
    providerDiagnostic: row.provider_diagnostic ?? undefined,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mediaAssetFromPersistedRow(
  row: PersistedMediaAssetRow,
  signedUrls: string | PersistedMediaSignedUrls,
): MediaItem {
  const urls = typeof signedUrls === 'string'
    ? { originalUrl: signedUrls, thumbnailUrl: signedUrls, previewUrl: signedUrls, fullUrl: signedUrls }
    : signedUrls;

  return {
    id: row.id,
    url: urls.originalUrl,
    thumbnailUrl: urls.thumbnailUrl,
    previewUrl: urls.previewUrl,
    fullUrl: urls.fullUrl,
    caption: row.caption,
    credit: row.credit,
    sortOrder: row.sort_order,
    bucketId: row.bucket_id,
    objectPath: row.object_path,
    contentType: row.content_type ?? undefined,
    sizeBytes: row.size_bytes ?? undefined,
    uploadedAt: row.created_at,
  };
}
