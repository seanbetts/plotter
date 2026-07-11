import type { LineString } from 'geojson';

export type Coordinates = {
  lat: number;
  lng: number;
};

export type DestinationLocation = {
  placeName: string;
  regionName: string;
  countryName: string;
  countryCode?: string;
  sourceLabel: string;
  sourceProvider: 'maptiler' | 'legacy';
  sourceFeatureId?: string;
};

export type DestinationStatus = 'idea' | 'planned' | 'confirmed' | 'visited';
export type Priority = 'low' | 'medium' | 'high' | 'must-do';
export type RouteLegStatus = 'pending' | 'calculating' | 'ready' | 'failed' | 'manual' | 'review-required';

export type VehiclePreset = 'standard' | 'large-camper' | 'expedition-truck';

export type VehicleRestrictions = {
  length?: number;
  width?: number;
  height?: number;
  weight?: number;
  axleLoad?: number;
};

export type TripRoutingVehicle = {
  preset: VehiclePreset;
  profile: 'driving-car' | 'driving-hgv';
  vehicleType?: 'hgv';
  restrictions: VehicleRestrictions;
};

export type RoutingAnchorProfile = TripRoutingVehicle['profile'];

export type RoutingAnchor = {
  profile: RoutingAnchorProfile;
  coordinates: Coordinates;
  originalCoordinates: Coordinates;
  snapDistanceKm: number;
  provider: 'openrouteservice';
  resolvedAt: string;
};

export type RoutingAnchors = Partial<Record<RoutingAnchorProfile, RoutingAnchor>>;

export type RouteMovement = 'drive' | 'vehicle-shipping';
export type RouteCalculationMode = 'automatic' | 'manual';
export type FerryPolicy = 'allow' | 'avoid' | 'require';

export type MediaItem = {
  id: string;
  url: string;
  thumbnailUrl?: string;
  previewUrl?: string;
  fullUrl?: string;
  caption: string;
  credit: string;
  sortOrder?: number;
  bucketId?: string;
  objectPath?: string;
  contentType?: string;
  sizeBytes?: number;
  uploadedAt?: string;
};

export type MediaOwnerType = 'destination' | 'activity';

export type MediaRollupItem = {
  mediaItem: MediaItem;
  ownerType: MediaOwnerType;
  destinationId: string;
  activityId?: string;
  activityTitle?: string;
  canReorderInStopCarousel: boolean;
};

export type ActivityMediaRecord = MediaItem & {
  activityId: string;
  destinationId: string;
};

export type ResearchLink = {
  id: string;
  title: string;
  url: string;
  domain: string;
  imageUrl?: string;
  sortOrder: number;
  previewFetchedAt?: string;
};

export type BookReference = {
  id: string;
  source: 'World Atlas of Street Art' | "Lonely Planet's Where to Go When" | 'Powder' | 'Other';
  reference: string;
  note: string;
};

export type ActivityCategory =
  | 'food'
  | 'culture'
  | 'outdoors'
  | 'street-art'
  | 'ski'
  | 'detour'
  | 'logistics'
  | 'other';

export type ActivityStatus = 'idea' | 'planned' | 'booked' | 'done' | 'skipped';

export type ActivityLocation = {
  name: string;
  address: string;
  coordinates?: Coordinates;
  sourceProvider?: 'maptiler' | 'manual';
  sourceFeatureId?: string;
};

export type Activity = {
  id: string;
  destinationId: string;
  order: number;
  title: string;
  description: string;
  category: ActivityCategory;
  status: ActivityStatus;
  priority: Priority;
  location?: ActivityLocation;
  links: ResearchLink[];
  notes: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

export type ActivityItem = {
  id: string;
  label: string;
  category: ActivityCategory;
  notes: string;
};

export type Destination = {
  id: string;
  name: string;
  countryRegion: string;
  coordinates: Coordinates;
  routingAnchors: RoutingAnchors;
  location: DestinationLocation;
  order: number;
  status: DestinationStatus;
  priority: Priority;
  timing: {
    idealMonths: string[];
    expectedStayDays: number;
    provisionalStartDate: string;
    provisionalEndDate: string;
  };
  why: {
    summary: string;
    highlights: string;
    personalRationale: string;
  };
  media: MediaItem[];
  research: {
    notes: string;
    links: ResearchLink[];
    bookReferences: BookReference[];
  };
  activities: {
    items: ActivityItem[];
  };
  routeContext: {
    previousNextNotes: string;
    drivingNotes: string;
    borderShippingNotes: string;
    notes: string;
  };
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

export type RouteWaypoint = {
  id: string;
  order: number;
  name: string;
  coordinates: Coordinates;
  location: DestinationLocation;
  notes: string;
  links: ResearchLink[];
};

export type RouteSection = {
  kind: 'road' | 'ferry';
  startGeometryIndex: number;
  endGeometryIndex: number;
  distanceKm: number;
};

export type RouteIntentSnapshot = {
  movement: RouteMovement;
  calculation: RouteCalculationMode;
  ferryPolicy: FerryPolicy;
  waypoints: RouteWaypoint[];
  notes: string;
};

export type RouteWarning = {
  code:
    | 'SUSPICIOUS_DETOUR'
    | 'FERRY_REQUIRED_NOT_FOUND'
    | 'FERRY_AVOIDED_BUT_FOUND'
    | 'ROUTE_INTENT_REASSIGNMENT_REQUIRED';
  message: string;
  context?: {
    sourceRouteLegId: string;
    unresolvedIntent: RouteIntentSnapshot;
  };
};

export type RouteLeg = {
  id: string;
  originDestinationId: string;
  targetDestinationId: string;
  movement: RouteMovement;
  calculation: RouteCalculationMode;
  ferryPolicy?: FerryPolicy;
  waypoints?: RouteWaypoint[];
  sections?: RouteSection[];
  warnings?: RouteWarning[];
  status: RouteLegStatus;
  distanceKm?: number;
  travelTimeHours?: number;
  geometry?: LineString;
  provider?: string;
  profile?: string;
  routeKey?: string;
  calculatedAt?: string;
  error?: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
};
