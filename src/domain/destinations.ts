import type { Coordinates, Destination, DestinationLocation, RoutingAnchor } from './types';
import { createLegacyLocation } from './locations';

type CreateDestinationInput = {
  name: string;
  countryRegion?: string;
  location?: DestinationLocation;
  coordinates: Coordinates;
  order?: number;
};

const nowIso = () => new Date().toISOString();
const createId = () => crypto.randomUUID();
const coordinatesMatch = (left: Coordinates, right: Coordinates) => left.lat === right.lat && left.lng === right.lng;
const nextIsoAfter = (timestamp: string) => {
  const now = nowIso();

  if (now !== timestamp) {
    return now;
  }

  return new Date(Date.parse(timestamp) + 1).toISOString();
};

export function createDestination(input: CreateDestinationInput): Destination {
  const timestamp = nowIso();

  return {
    id: createId(),
    name: input.name,
    countryRegion: input.location?.countryName || input.countryRegion || '',
    coordinates: input.coordinates,
    routingAnchors: {},
    location: input.location ?? createLegacyLocation({ name: input.name, countryRegion: input.countryRegion }),
    order: input.order ?? 0,
    status: 'idea',
    priority: 'medium',
    timing: {
      idealMonths: [],
      expectedStayDays: 3,
      provisionalStartDate: '',
      provisionalEndDate: '',
    },
    why: {
      summary: '',
      highlights: '',
      personalRationale: '',
    },
    media: [],
    research: {
      notes: '',
      links: [],
      bookReferences: [],
    },
    activities: {
      items: [],
    },
    routeContext: {
      previousNextNotes: '',
      drivingNotes: '',
      borderShippingNotes: '',
      notes: '',
    },
    tags: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function updateDestination(
  destination: Destination,
  patch: Partial<Omit<Destination, 'id' | 'createdAt' | 'updatedAt'>>,
): Destination {
  const coordinates = patch.coordinates ?? destination.coordinates;
  const routingAnchors = coordinatesMatch(destination.coordinates, coordinates)
    ? (patch.routingAnchors ?? destination.routingAnchors)
    : {};

  return {
    ...destination,
    ...patch,
    coordinates,
    routingAnchors,
    updatedAt: nextIsoAfter(destination.updatedAt),
  };
}

export function withRoutingAnchor(destination: Destination, anchor: RoutingAnchor): Destination {
  return updateDestination(destination, {
    routingAnchors: {
      ...destination.routingAnchors,
      [anchor.profile]: anchor,
    },
  });
}
