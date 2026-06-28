import type { LineString } from 'geojson';

export type Coordinates = {
  lat: number;
  lng: number;
};

export type DestinationStatus = 'idea' | 'planned' | 'confirmed' | 'visited';
export type Priority = 'low' | 'medium' | 'high' | 'must-do';
export type RouteLegType = 'driving-auto' | 'shipping-manual';
export type RouteLegStatus = 'pending' | 'calculating' | 'ready' | 'failed' | 'manual';

export type MediaItem = {
  id: string;
  url: string;
  caption: string;
  credit: string;
};

export type ResearchLink = {
  id: string;
  title: string;
  url: string;
};

export type BookReference = {
  id: string;
  source: 'World Atlas of Street Art' | "Lonely Planet's Where to Go When" | 'Powder' | 'Other';
  reference: string;
  note: string;
};

export type ActivityItem = {
  id: string;
  label: string;
  category: 'food' | 'culture' | 'outdoors' | 'street-art' | 'ski' | 'detour' | 'other';
  notes: string;
};

export type Destination = {
  id: string;
  name: string;
  countryRegion: string;
  coordinates: Coordinates;
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
