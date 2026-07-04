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
export type RouteLegType = 'driving-auto' | 'shipping-manual';
export type RouteLegStatus = 'pending' | 'calculating' | 'ready' | 'failed' | 'manual';

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

export type RouteLeg = {
  id: string;
  originDestinationId: string;
  targetDestinationId: string;
  type: RouteLegType;
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
