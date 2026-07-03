import { describe, expect, it, vi } from 'vitest';
import { createDestination } from '../domain/destinations';
import { createRouteLeg, createStraightLineGeometry } from '../domain/routeLegs';
import {
  destinationFromSupabaseRow,
  destinationToSupabaseRow,
  mediaAssetFromSupabaseRow,
  routeLegFromSupabaseRow,
  routeLegToSupabaseRow,
  createSupabaseTripRepository,
} from './supabaseTripRepository';

function createTripsTableMock(rows: Array<{ id: string; owner_user_id: string; name: string }>) {
  return {
    select: vi.fn(() => ({
      order: vi.fn(async () => ({
        data: rows,
        error: null,
      })),
    })),
  };
}

describe('supabase trip repository mappers', () => {
  it('maps destinations to and from Supabase rows', () => {
    const destination = createDestination({
      name: 'Balcombe',
      countryRegion: 'United Kingdom',
      coordinates: { lat: 51.0576, lng: -0.1342 },
      order: 2,
    });
    const tripId = crypto.randomUUID();

    const row = destinationToSupabaseRow(destination, tripId);

    expect(row).toMatchObject({
      id: destination.id,
      trip_id: tripId,
      name: 'Balcombe',
      country_region: 'United Kingdom',
      lat: 51.0576,
      lng: -0.1342,
      stop_order: 2,
      route_context: destination.routeContext,
    });
    expect(destinationFromSupabaseRow(row)).toEqual(destination);
  });

  it('maps route legs to and from Supabase rows', () => {
    const origin = createDestination({
      name: 'Oslo',
      coordinates: { lat: 59.9139, lng: 10.7522 },
    });
    const target = createDestination({
      name: 'Bodo',
      coordinates: { lat: 67.2804, lng: 14.4049 },
    });
    const geometry = createStraightLineGeometry(origin.coordinates, target.coordinates);
    const routeLeg = createRouteLeg({
      originDestinationId: origin.id,
      targetDestinationId: target.id,
      type: 'driving-auto',
      status: 'ready',
      distanceKm: 1185,
      travelTimeHours: 17.5,
      geometry,
      provider: 'openrouteservice',
      profile: 'driving-car',
      routeKey: 'route-key',
      calculatedAt: '2026-06-29T12:00:00.000Z',
    });
    const tripId = crypto.randomUUID();

    const row = routeLegToSupabaseRow(routeLeg, tripId);

    expect(row).toMatchObject({
      id: routeLeg.id,
      trip_id: tripId,
      origin_destination_id: origin.id,
      target_destination_id: target.id,
      distance_km: 1185,
      travel_time_hours: 17.5,
      route_key: 'route-key',
    });
    expect(routeLegFromSupabaseRow(row)).toEqual(routeLeg);
  });

  it('upserts destinations and route legs against the trip-scoped id', async () => {
    const tripId = crypto.randomUUID();
    const destination = createDestination({
      name: 'Oslo',
      coordinates: { lat: 59.9139, lng: 10.7522 },
    });
    const routeLeg = createRouteLeg({
      originDestinationId: destination.id,
      targetDestinationId: crypto.randomUUID(),
      type: 'driving-auto',
    });
    const destinationUpsert = vi.fn(() => ({ error: null }));
    const routeLegUpsert = vi.fn(() => ({ error: null }));
    const supabase = {
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: crypto.randomUUID() } },
          error: null,
        })),
      },
      from: vi.fn((tableName: string) => {
        if (tableName === 'trips') {
          return createTripsTableMock([
            { id: tripId, owner_user_id: crypto.randomUUID(), name: 'World tour' },
          ]);
        }

        if (tableName === 'destinations') {
          return { upsert: destinationUpsert };
        }

        if (tableName === 'route_legs') {
          return { upsert: routeLegUpsert };
        }

        throw new Error(`Unexpected table ${tableName}`);
      }),
    };
    const repository = createSupabaseTripRepository(supabase as never);

    await repository.saveDestination(destination);
    await repository.saveRouteLeg(routeLeg);

    expect(destinationUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: destination.id, trip_id: tripId }),
      { onConflict: 'trip_id,id' },
    );
    expect(routeLegUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: routeLeg.id, trip_id: tripId }),
      { onConflict: 'trip_id,id' },
    );
  });

  it('uses the visible trip with planning data instead of a newer empty anonymous trip', async () => {
    const emptyTripId = crypto.randomUUID();
    const plannedTripId = crypto.randomUUID();
    const destination = createDestination({
      name: 'Kyoto',
      coordinates: { lat: 35.6764, lng: 139.65 },
    });
    const destinationRow = destinationToSupabaseRow(destination, plannedTripId);
    const destinationsByTrip = [{ trip_id: plannedTripId }, { trip_id: plannedTripId }];
    const routeLegsByTrip = [{ trip_id: plannedTripId }];

    const supabase = {
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: crypto.randomUUID() } },
          error: null,
        })),
      },
      from: vi.fn((tableName: string) => {
        if (tableName === 'trips') {
          return createTripsTableMock([
            { id: emptyTripId, owner_user_id: crypto.randomUUID(), name: 'Empty trip' },
            { id: plannedTripId, owner_user_id: crypto.randomUUID(), name: 'World tour' },
          ]);
        }

        if (tableName === 'destinations') {
          return {
            select: vi.fn((columns: string) => {
              if (columns === 'trip_id') {
                return {
                  in: vi.fn(async () => ({ data: destinationsByTrip, error: null })),
                };
              }

              return {
                eq: vi.fn(() => ({
                  order: vi.fn(() => ({
                    order: vi.fn(async () => ({ data: [destinationRow], error: null })),
                  })),
                })),
              };
            }),
          };
        }

        if (tableName === 'route_legs') {
          return {
            select: vi.fn(() => ({
              in: vi.fn(async () => ({ data: routeLegsByTrip, error: null })),
            })),
          };
        }

        throw new Error(`Unexpected table ${tableName}`);
      }),
    };
    const repository = createSupabaseTripRepository(supabase as never);

    await expect(repository.listDestinations()).resolves.toEqual([destination]);
    expect(supabase.from).toHaveBeenCalledWith('trips');
  });

  it('uploads destination media to trip-scoped Supabase Storage and records metadata', async () => {
    const tripId = crypto.randomUUID();
    const destinationId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const mediaAssetId = crypto.randomUUID();
    const uploadedPath = `${tripId}/${destinationId}/asset-paris.jpg`;
    const upload = vi.fn(async () => ({ data: { path: uploadedPath }, error: null }));
    const createSignedUrl = vi.fn(async () => ({
      data: { signedUrl: 'https://signed.example/paris.jpg' },
      error: null,
    }));
    const mediaInsert = vi.fn((row) => ({
      select: vi.fn(() => ({
        single: vi.fn(async () => ({
          data: {
            id: mediaAssetId,
            ...row,
            created_at: '2026-06-29T12:00:00.000Z',
            updated_at: '2026-06-29T12:00:00.000Z',
          },
          error: null,
        })),
      })),
    }));
    const supabase = {
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: userId } },
          error: null,
        })),
      },
      storage: {
        from: vi.fn(() => ({
          upload,
          createSignedUrl,
        })),
      },
      from: vi.fn((tableName: string) => {
        if (tableName === 'trips') {
          return createTripsTableMock([
            { id: tripId, owner_user_id: userId, name: 'World tour' },
          ]);
        }

        if (tableName === 'media_assets') {
          return { insert: mediaInsert };
        }

        throw new Error(`Unexpected table ${tableName}`);
      }),
    };
    const repository = createSupabaseTripRepository(supabase as never);
    const file = new File(['image-data'], 'Paris sunset.JPG', { type: 'image/jpeg' });

    const mediaItem = await repository.uploadDestinationMedia({
      destinationId,
      file,
      caption: 'Sunset',
      credit: 'Example photographer',
    });

    expect(supabase.storage.from).toHaveBeenCalledWith('trip-media');
    expect(upload).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^${tripId}/${destinationId}/.+-paris-sunset\\.jpg$`)),
      file,
      { contentType: 'image/jpeg', upsert: false },
    );
    expect(mediaInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        trip_id: tripId,
        destination_id: destinationId,
        bucket_id: 'trip-media',
        caption: 'Sunset',
        credit: 'Example photographer',
        content_type: 'image/jpeg',
        size_bytes: file.size,
        uploaded_by: userId,
      }),
    );
    expect(mediaItem).toEqual(
      expect.objectContaining({
        id: mediaAssetId,
        url: 'https://signed.example/paris.jpg',
        caption: 'Sunset',
        credit: 'Example photographer',
        bucketId: 'trip-media',
      }),
    );
  });

  it('lists destination media with signed URLs', async () => {
    const tripId = crypto.randomUUID();
    const destinationId = crypto.randomUUID();
    const objectPath = `${tripId}/${destinationId}/asset.webp`;
    const row = {
      id: crypto.randomUUID(),
      trip_id: tripId,
      destination_id: destinationId,
      bucket_id: 'trip-media',
      object_path: objectPath,
      caption: 'Harbour',
      credit: '',
      sort_order: 2,
      content_type: 'image/webp',
      size_bytes: 1234,
      uploaded_by: crypto.randomUUID(),
      created_at: '2026-06-29T12:00:00.000Z',
      updated_at: '2026-06-29T12:00:00.000Z',
    };
    const createSignedUrl = vi.fn(async () => ({
      data: { signedUrl: 'https://signed.example/asset.webp' },
      error: null,
    }));
    const supabase = {
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: crypto.randomUUID() } },
          error: null,
        })),
      },
      storage: {
        from: vi.fn(() => ({ createSignedUrl })),
      },
      from: vi.fn((tableName: string) => {
        if (tableName === 'trips') {
          return createTripsTableMock([
            { id: tripId, owner_user_id: crypto.randomUUID(), name: 'World tour' },
          ]);
        }

        if (tableName === 'media_assets') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  order: vi.fn(async () => ({ data: [row], error: null })),
                })),
              })),
            })),
          };
        }

        throw new Error(`Unexpected table ${tableName}`);
      }),
    };
    const repository = createSupabaseTripRepository(supabase as never);

    await expect(repository.listDestinationMedia(destinationId)).resolves.toEqual([
      expect.objectContaining({
        ...mediaAssetFromSupabaseRow(row, 'https://signed.example/asset.webp'),
        sortOrder: 2,
      }),
    ]);
    expect(createSignedUrl).toHaveBeenCalledWith(objectPath, 60 * 60);
  });
});
