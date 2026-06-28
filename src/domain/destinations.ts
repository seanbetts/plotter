import type { Coordinates, Destination } from './types';

type CreateDestinationInput = {
  name: string;
  countryRegion?: string;
  coordinates: Coordinates;
};

const nowIso = () => new Date().toISOString();
const createId = () => crypto.randomUUID();
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
    countryRegion: input.countryRegion ?? '',
    coordinates: input.coordinates,
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
  return {
    ...destination,
    ...patch,
    updatedAt: nextIsoAfter(destination.updatedAt),
  };
}
