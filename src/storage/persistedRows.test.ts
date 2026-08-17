import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Activity, Destination, RouteLeg } from '../domain/types';
import { resolveVehiclePreset } from '../domain/vehiclePresets';
import type { TripDirectoryRepository } from './tripDirectoryRepository';
import {
  activityFromPersistedRow,
  activityToPersistedRow,
  destinationFromPersistedRow,
  destinationToPersistedRow,
  mediaAssetFromPersistedRow,
  routeLegFromPersistedRow,
  routeLegToPersistedRow,
  tripSummaryFromPersistedRow,
  tripSummaryToPersistedRow,
} from './persistedRows';
import type { TripRepository } from './tripRepository';

const tripId = 'trip-aurora';
const timestamp = '2026-08-17T10:00:00.000Z';

const destination: Destination = {
  id: 'destination-tromso',
  name: 'Tromso',
  countryRegion: 'Troms, Norway',
  coordinates: { lat: 69.6492, lng: 18.9553 },
  routingAnchors: {
    'driving-car': {
      profile: 'driving-car',
      coordinates: { lat: 69.65, lng: 18.96 },
      originalCoordinates: { lat: 69.6492, lng: 18.9553 },
      snapDistanceKm: 0.4,
      provider: 'openrouteservice',
      resolvedAt: timestamp,
    },
  },
  location: {
    placeName: 'Tromso',
    regionName: 'Troms',
    countryName: 'Norway',
    countryCode: 'NO',
    sourceLabel: 'MapTiler',
    sourceProvider: 'maptiler',
    sourceFeatureId: 'place.1',
  },
  order: 2,
  status: 'planned',
  priority: 'must-do',
  timing: {
    idealMonths: ['January'],
    expectedStayDays: 3,
    provisionalStartDate: '2027-01-10',
    provisionalEndDate: '2027-01-13',
  },
  why: { summary: 'Aurora', highlights: 'Cable car', personalRationale: 'Winter route' },
  media: [{ id: 'legacy-media', url: 'https://example.test/legacy.jpg', caption: 'Legacy', credit: 'Archive', sortOrder: 4 }],
  research: {
    notes: 'Northern lights',
    links: [
      { id: 'later', title: 'Later', url: 'https://example.test/later', domain: 'example.test', sortOrder: 2 },
      { id: 'first', title: 'First', url: 'https://example.test/first', domain: 'example.test', sortOrder: 1 },
    ],
    bookReferences: [{ id: 'book-1', source: 'Other', reference: 'p. 10', note: 'Useful' }],
  },
  activities: { items: [{ id: 'legacy-activity', label: 'Old activity', category: 'outdoors', notes: 'Keep' }] },
  routeContext: { previousNextNotes: 'Northbound', drivingNotes: 'Ice', borderShippingNotes: '', notes: 'Fuel first' },
  tags: ['arctic', 'winter'],
  createdAt: timestamp,
  updatedAt: timestamp,
};

const activity: Activity = {
  id: 'activity-cable-car',
  destinationId: destination.id,
  order: 1,
  title: 'Fjellheisen',
  description: 'Cable car viewpoint',
  category: 'outdoors',
  status: 'booked',
  priority: 'high',
  location: {
    name: 'Fjellheisen',
    address: 'Sollivegen 12, Tromso',
    coordinates: { lat: 69.6389, lng: 18.9675 },
    sourceProvider: 'maptiler',
    sourceFeatureId: 'poi.1',
  },
  links: [
    { id: 'activity-later', title: 'Later', url: 'https://example.test/activity-later', domain: 'example.test', sortOrder: 3 },
    { id: 'activity-first', title: 'First', url: 'https://example.test/activity-first', domain: 'example.test', sortOrder: 0 },
  ],
  notes: 'Book sunset slot',
  tags: ['viewpoint'],
  createdAt: timestamp,
  updatedAt: timestamp,
};

const routeLeg: RouteLeg = {
  id: 'leg-tromso-alta',
  originDestinationId: destination.id,
  targetDestinationId: 'destination-alta',
  movement: 'drive',
  calculation: 'automatic',
  ferryPolicy: 'avoid',
  waypoints: [{
    id: 'waypoint-nordkjosbotn',
    order: 0,
    name: 'Nordkjosbotn',
    coordinates: { lat: 69.2129, lng: 19.5575 },
    location: { placeName: 'Nordkjosbotn', regionName: 'Troms', countryName: 'Norway', sourceLabel: 'MapTiler', sourceProvider: 'maptiler' },
    notes: 'Fuel',
    links: [{ id: 'waypoint-link', title: 'Road', url: 'https://example.test/road', domain: 'example.test', sortOrder: 0 }],
  }],
  sections: [{ kind: 'road', startGeometryIndex: 0, endGeometryIndex: 2, distanceKm: 130 }],
  warnings: [{ code: 'ROUTING_ANCHOR_ADJUSTED', message: 'Start snapped to road' }],
  status: 'ready',
  distanceKm: 385.4,
  travelTimeHours: 5.75,
  geometry: { type: 'LineString', coordinates: [[18.9553, 69.6492], [19.5575, 69.2129], [23.687, 69.9689]] },
  provider: 'openrouteservice',
  profile: 'driving-car',
  routeKey: 'route-key',
  calculatedAt: timestamp,
  providerDiagnostic: {
    provider: 'openrouteservice',
    httpStatus: 200,
    providerMessage: 'Recovered route',
    requestedProfile: 'driving-hgv',
    actualProfile: 'driving-car',
    attempts: 2,
  },
  notes: 'Avoid ferries when weather closes.',
  createdAt: timestamp,
  updatedAt: timestamp,
};

describe('persisted rows', () => {
  it('round-trips the full directory row including routing vehicle fields', () => {
    const row = {
      id: tripId,
      owner_user_id: 'source-user',
      name: 'Aurora drive',
      description: 'Northern Norway',
      vehicle_preset: 'large-camper' as const,
      vehicle_profile: 'driving-car' as const,
      vehicle_type: null,
      vehicle_restrictions: resolveVehiclePreset('large-camper').restrictions,
      created_at: timestamp,
      updated_at: timestamp,
    };

    expect(tripSummaryFromPersistedRow(row)).toEqual({
      id: tripId,
      name: 'Aurora drive',
      description: 'Northern Norway',
      routingVehicle: resolveVehiclePreset('large-camper'),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    expect(tripSummaryToPersistedRow(tripSummaryFromPersistedRow(row), row.owner_user_id)).toEqual(row);
  });

  it('round-trips complete trip rows without losing persisted routing, activity, and media data', () => {
    const destinationRow = destinationToPersistedRow(destination, tripId);
    const activityRow = activityToPersistedRow(activity, tripId);
    const routeLegRow = routeLegToPersistedRow(routeLeg, tripId);

    expect(destinationRow).toMatchObject({ trip_id: tripId, routing_anchors: destination.routingAnchors, stop_order: 2 });
    expect(destinationFromPersistedRow(destinationRow)).toEqual({
      ...destination,
      research: { ...destination.research, links: [destination.research.links[1], destination.research.links[0]] },
    });
    expect(activityFromPersistedRow(activityRow)).toEqual({
      ...activity,
      links: [activity.links[1], activity.links[0]],
    });
    expect(routeLegFromPersistedRow(routeLegRow)).toEqual(routeLeg);
    expect(mediaAssetFromPersistedRow({
      id: 'media-activity',
      trip_id: tripId,
      destination_id: destination.id,
      activity_id: activity.id,
      bucket_id: 'trip-media',
      object_path: `${tripId}/${destination.id}/${activity.id}/aurora.webp`,
      caption: 'Aurora',
      credit: 'Example photographer',
      sort_order: 7,
      content_type: 'image/webp',
      size_bytes: 1234,
      uploaded_by: 'source-user',
      created_at: timestamp,
      updated_at: timestamp,
    }, {
      originalUrl: '/api/v1/media/media-activity/content',
      thumbnailUrl: '/api/v1/media/media-activity/content?variant=thumbnail',
      previewUrl: '/api/v1/media/media-activity/content?variant=preview',
      fullUrl: '/api/v1/media/media-activity/content?variant=full',
    })).toEqual({
      id: 'media-activity',
      url: '/api/v1/media/media-activity/content',
      thumbnailUrl: '/api/v1/media/media-activity/content?variant=thumbnail',
      previewUrl: '/api/v1/media/media-activity/content?variant=preview',
      fullUrl: '/api/v1/media/media-activity/content?variant=full',
      caption: 'Aurora',
      credit: 'Example photographer',
      sortOrder: 7,
      bucketId: 'trip-media',
      objectPath: `${tripId}/${destination.id}/${activity.id}/aurora.webp`,
      contentType: 'image/webp',
      sizeBytes: 1234,
      uploadedAt: timestamp,
    });
  });

  it('rejects a malformed persisted research container before applying legacy defaults', () => {
    const row = destinationToPersistedRow(destination, tripId);

    expect(() => destinationFromPersistedRow({ ...row, research: 42 } as never))
      .toThrow('Saved destination research is invalid.');
  });

  it('adds revisioned snapshot loading without removing existing repository operations', () => {
    expectTypeOf<TripRepository['loadSnapshot']>().toEqualTypeOf<(() => Promise<import('./revision').TripSnapshot>) | undefined>();
    expectTypeOf<TripRepository['saveDestination']>().toEqualTypeOf<(destination: Destination) => Promise<void>>();
    expectTypeOf<TripRepository['applyTripMutation']>().toEqualTypeOf<(delta: import('./tripRepository').TripMutationDelta) => Promise<void>>();
    expectTypeOf<TripDirectoryRepository['loadDirectory']>().toEqualTypeOf<(() => Promise<import('./revision').DirectorySnapshot>) | undefined>();
    expectTypeOf<TripDirectoryRepository['createTrip']>().toBeFunction();
    expect(true).toBe(true);
  });
});
