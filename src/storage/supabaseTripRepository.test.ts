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
    const existingRows = [
      { id: crypto.randomUUID(), sort_order: 0 },
      { id: crypto.randomUUID(), sort_order: 2 },
    ];
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
            sort_order: row.sort_order,
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
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(async () => ({ data: existingRows, error: null })),
              })),
            })),
            insert: mediaInsert,
          };
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
        sort_order: 3,
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

  it('retries metadata insert with a later sort order when the first insert hits a duplicate', async () => {
    const tripId = crypto.randomUUID();
    const destinationId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const mediaAssetId = crypto.randomUUID();
    const uploadedPath = `${tripId}/${destinationId}/asset-aurora.jpg`;
    const existingRowsResponses = [
      [
        { sort_order: 0 },
        { sort_order: 2 },
      ],
      [
        { sort_order: 0 },
        { sort_order: 2 },
        { sort_order: 3 },
      ],
    ];
    const upload = vi.fn(async () => ({ data: { path: uploadedPath }, error: null }));
    const createSignedUrl = vi.fn(async () => ({
      data: { signedUrl: 'https://signed.example/aurora.jpg' },
      error: null,
    }));
    const mediaInsert = vi
      .fn()
      .mockImplementationOnce((row) => ({
        select: vi.fn(() => ({
          single: vi.fn(async () => ({
            data: null,
            error: {
              message:
                'duplicate key value violates unique constraint "media_assets_trip_destination_sort_order_key"',
            },
          })),
        })),
      }))
      .mockImplementationOnce((row) => ({
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
    const mediaSelect = vi
      .fn()
      .mockImplementationOnce(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(async () => ({ data: existingRowsResponses[0], error: null })),
        })),
      }))
      .mockImplementationOnce(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(async () => ({ data: existingRowsResponses[1], error: null })),
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
          return {
            select: mediaSelect,
            insert: mediaInsert,
          };
        }

        throw new Error(`Unexpected table ${tableName}`);
      }),
    };
    const repository = createSupabaseTripRepository(supabase as never);
    const file = new File(['image-data'], 'Aurora.JPG', { type: 'image/jpeg' });

    const mediaItem = await repository.uploadDestinationMedia({
      destinationId,
      file,
      caption: 'Aurora',
      credit: 'Example photographer',
    });

    expect(upload).toHaveBeenCalledTimes(1);
    expect(mediaSelect).toHaveBeenCalledTimes(2);
    expect(mediaInsert).toHaveBeenCalledTimes(2);
    expect(mediaInsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ sort_order: 3 }),
    );
    expect(mediaInsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ sort_order: 4 }),
    );
    expect(mediaItem).toEqual(
      expect.objectContaining({
        id: mediaAssetId,
        url: 'https://signed.example/aurora.jpg',
        sortOrder: 4,
      }),
    );
  });

  it('lists destination media with signed URLs', async () => {
    const tripId = crypto.randomUUID();
    const destinationId = crypto.randomUUID();
    const rows = [
      {
        id: crypto.randomUUID(),
        trip_id: tripId,
        destination_id: destinationId,
        bucket_id: 'trip-media',
        object_path: `${tripId}/${destinationId}/asset-b.webp`,
        caption: 'Later created but first sorted',
        credit: '',
        sort_order: 0,
        content_type: 'image/webp',
        size_bytes: 1200,
        uploaded_by: crypto.randomUUID(),
        created_at: '2026-06-29T12:05:00.000Z',
        updated_at: '2026-06-29T12:05:00.000Z',
      },
      {
        id: crypto.randomUUID(),
        trip_id: tripId,
        destination_id: destinationId,
        bucket_id: 'trip-media',
        object_path: `${tripId}/${destinationId}/asset-a.webp`,
        caption: 'Earlier created but second sorted',
        credit: '',
        sort_order: 1,
        content_type: 'image/webp',
        size_bytes: 1234,
        uploaded_by: crypto.randomUUID(),
        created_at: '2026-06-29T12:00:00.000Z',
        updated_at: '2026-06-29T12:00:00.000Z',
      },
    ];
    const createSignedUrl = vi.fn(async () => ({
      data: { signedUrl: 'https://signed.example/asset.webp' },
      error: null,
    }));
    const mediaOrderBy = vi.fn(async () => ({ data: rows, error: null }));
    const mediaSortOrderBy = vi.fn(() => ({ order: mediaOrderBy }));
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
                  order: mediaSortOrderBy,
                })),
              })),
            })),
          };
        }

        throw new Error(`Unexpected table ${tableName}`);
      }),
    };
    const repository = createSupabaseTripRepository(supabase as never);

    expect(mediaAssetFromSupabaseRow(rows[0], 'https://signed.example/asset.webp')).toEqual(
      expect.objectContaining({
        id: rows[0].id,
        url: 'https://signed.example/asset.webp',
        sortOrder: rows[0].sort_order,
      }),
    );

    await expect(repository.listDestinationMedia(destinationId)).resolves.toEqual([
      expect.objectContaining({
        id: rows[0].id,
        url: 'https://signed.example/asset.webp',
        sortOrder: rows[0].sort_order,
      }),
      expect.objectContaining({
        id: rows[1].id,
        url: 'https://signed.example/asset.webp',
        sortOrder: rows[1].sort_order,
      }),
    ]);
    expect(mediaSortOrderBy).toHaveBeenCalledWith('sort_order', { ascending: true });
    expect(mediaOrderBy).toHaveBeenCalledWith('created_at', { ascending: true });
    expect(createSignedUrl).toHaveBeenNthCalledWith(1, rows[0].object_path, 60 * 60);
    expect(createSignedUrl).toHaveBeenNthCalledWith(2, rows[1].object_path, 60 * 60);
  });

  it('updates destination media caption and credit in the active trip and returns a fresh signed URL', async () => {
    const tripId = crypto.randomUUID();
    const mediaId = crypto.randomUUID();
    const row = {
      id: mediaId,
      trip_id: tripId,
      destination_id: crypto.randomUUID(),
      bucket_id: 'trip-media',
      object_path: `${tripId}/destination/asset.webp`,
      caption: 'New caption',
      credit: 'Example photographer',
      sort_order: 2,
      content_type: 'image/webp',
      size_bytes: 2048,
      uploaded_by: crypto.randomUUID(),
      created_at: '2026-06-29T12:00:00.000Z',
      updated_at: '2026-06-29T12:10:00.000Z',
    };
    const createSignedUrl = vi.fn(async () => ({
      data: { signedUrl: 'https://signed.example/updated.webp' },
      error: null,
    }));
    const updateSingle = vi.fn(async () => ({ data: row, error: null }));
    const updateSelect = vi.fn(() => ({ single: updateSingle }));
    const mediaIdFilter = vi.fn(() => ({ select: updateSelect }));
    const tripFilter = vi.fn(() => ({ eq: mediaIdFilter }));
    const update = vi.fn(() => ({ eq: tripFilter }));
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
          return { update };
        }

        throw new Error(`Unexpected table ${tableName}`);
      }),
    };
    const repository = createSupabaseTripRepository(supabase as never);

    await expect(repository.updateDestinationMedia(mediaId, {
      caption: 'New caption',
      credit: 'Example photographer',
    })).resolves.toEqual(expect.objectContaining({
      id: mediaId,
      url: 'https://signed.example/updated.webp',
      caption: 'New caption',
      credit: 'Example photographer',
      sortOrder: 2,
    }));

    expect(update).toHaveBeenCalledWith({ caption: 'New caption', credit: 'Example photographer' });
    expect(tripFilter).toHaveBeenCalledWith('trip_id', tripId);
    expect(mediaIdFilter).toHaveBeenCalledWith('id', mediaId);
    expect(createSignedUrl).toHaveBeenCalledWith(row.object_path, 60 * 60);
  });

  it('deletes destination media storage before deleting active-trip metadata', async () => {
    const tripId = crypto.randomUUID();
    const mediaId = crypto.randomUUID();
    const row = {
      id: mediaId,
      trip_id: tripId,
      destination_id: crypto.randomUUID(),
      bucket_id: 'trip-media',
      object_path: `${tripId}/destination/asset.webp`,
      caption: '',
      credit: '',
      sort_order: 0,
      content_type: 'image/webp',
      size_bytes: 2048,
      uploaded_by: crypto.randomUUID(),
      created_at: '2026-06-29T12:00:00.000Z',
      updated_at: '2026-06-29T12:00:00.000Z',
    };
    const calls: string[] = [];
    const remove = vi.fn(async () => {
      calls.push('storage');
      return { data: [{ name: 'asset.webp' }], error: null };
    });
    const loadSingle = vi.fn(async () => ({ data: row, error: null }));
    const loadMediaIdFilter = vi.fn(() => ({ single: loadSingle }));
    const loadTripFilter = vi.fn(() => ({ eq: loadMediaIdFilter }));
    const deleteMediaIdFilter = vi.fn(async () => {
      calls.push('metadata');
      return { error: null };
    });
    const deleteTripFilter = vi.fn(() => ({ eq: deleteMediaIdFilter }));
    const deleteRows = vi.fn(() => ({ eq: deleteTripFilter }));
    const supabase = {
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: crypto.randomUUID() } },
          error: null,
        })),
      },
      storage: {
        from: vi.fn(() => ({ remove })),
      },
      from: vi.fn((tableName: string) => {
        if (tableName === 'trips') {
          return createTripsTableMock([
            { id: tripId, owner_user_id: crypto.randomUUID(), name: 'World tour' },
          ]);
        }

        if (tableName === 'media_assets') {
          return {
            select: vi.fn(() => ({ eq: loadTripFilter })),
            delete: deleteRows,
          };
        }

        throw new Error(`Unexpected table ${tableName}`);
      }),
    };
    const repository = createSupabaseTripRepository(supabase as never);

    await repository.deleteDestinationMedia(mediaId);

    expect(loadTripFilter).toHaveBeenCalledWith('trip_id', tripId);
    expect(loadMediaIdFilter).toHaveBeenCalledWith('id', mediaId);
    expect(remove).toHaveBeenCalledWith([row.object_path]);
    expect(deleteTripFilter).toHaveBeenCalledWith('trip_id', tripId);
    expect(deleteMediaIdFilter).toHaveBeenCalledWith('id', mediaId);
    expect(calls).toEqual(['storage', 'metadata']);
  });

  it('reorders destination media with collision-safe temporary sort orders when destructured', async () => {
    const tripId = crypto.randomUUID();
    const destinationId = crypto.randomUUID();
    const firstId = crypto.randomUUID();
    const secondId = crypto.randomUUID();
    const rows = [
      {
        id: firstId,
        trip_id: tripId,
        destination_id: destinationId,
        bucket_id: 'trip-media',
        object_path: `${tripId}/${destinationId}/first.webp`,
        caption: 'First',
        credit: '',
        sort_order: 0,
        content_type: 'image/webp',
        size_bytes: 1000,
        uploaded_by: crypto.randomUUID(),
        created_at: '2026-06-29T12:00:00.000Z',
        updated_at: '2026-06-29T12:00:00.000Z',
      },
      {
        id: secondId,
        trip_id: tripId,
        destination_id: destinationId,
        bucket_id: 'trip-media',
        object_path: `${tripId}/${destinationId}/second.webp`,
        caption: 'Second',
        credit: '',
        sort_order: 1,
        content_type: 'image/webp',
        size_bytes: 1000,
        uploaded_by: crypto.randomUUID(),
        created_at: '2026-06-29T12:01:00.000Z',
        updated_at: '2026-06-29T12:01:00.000Z',
      },
    ];
    const reorderedRows = [
      { ...rows[1], sort_order: 0 },
      { ...rows[0], sort_order: 1 },
    ];
    const updates: Array<{ id: string; sortOrder: number }> = [];
    const createSignedUrl = vi.fn(async () => ({
      data: { signedUrl: 'https://signed.example/reordered.webp' },
      error: null,
    }));
    const selectOrderFinal = vi.fn(async () => ({ data: reorderedRows, error: null }));
    const selectOrderFirst = vi.fn(() => ({ order: selectOrderFinal }));
    const selectDestinationFilter = vi
      .fn()
      .mockImplementationOnce(async () => ({ data: rows, error: null }))
      .mockImplementationOnce(() => ({ order: selectOrderFirst }));
    const selectTripFilter = vi.fn(() => ({ eq: selectDestinationFilter }));
    const update = vi.fn((patch: { sort_order: number }) => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(async (_column: string, id: string) => {
            updates.push({ id, sortOrder: patch.sort_order });
            return { error: null };
          }),
        })),
      })),
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
            select: vi.fn(() => ({ eq: selectTripFilter })),
            update,
          };
        }

        throw new Error(`Unexpected table ${tableName}`);
      }),
    };
    const repository = createSupabaseTripRepository(supabase as never);
    const { reorderDestinationMedia } = repository;

    await expect(reorderDestinationMedia(destinationId, [secondId, firstId])).resolves.toEqual([
      expect.objectContaining({ id: secondId, sortOrder: 0 }),
      expect.objectContaining({ id: firstId, sortOrder: 1 }),
    ]);

    expect(updates).toEqual([
      { id: secondId, sortOrder: -3 },
      { id: firstId, sortOrder: -4 },
      { id: secondId, sortOrder: 0 },
      { id: firstId, sortOrder: 1 },
    ]);
  });

  it('rejects destination media reorders with missing or foreign ids before updating rows', async () => {
    const tripId = crypto.randomUUID();
    const destinationId = crypto.randomUUID();
    const firstId = crypto.randomUUID();
    const secondId = crypto.randomUUID();
    const foreignId = crypto.randomUUID();
    const rows = [
      {
        id: firstId,
        trip_id: tripId,
        destination_id: destinationId,
        bucket_id: 'trip-media',
        object_path: `${tripId}/${destinationId}/first.webp`,
        caption: '',
        credit: '',
        sort_order: 0,
        content_type: 'image/webp',
        size_bytes: 1000,
        uploaded_by: crypto.randomUUID(),
        created_at: '2026-06-29T12:00:00.000Z',
        updated_at: '2026-06-29T12:00:00.000Z',
      },
      {
        id: secondId,
        trip_id: tripId,
        destination_id: destinationId,
        bucket_id: 'trip-media',
        object_path: `${tripId}/${destinationId}/second.webp`,
        caption: '',
        credit: '',
        sort_order: 1,
        content_type: 'image/webp',
        size_bytes: 1000,
        uploaded_by: crypto.randomUUID(),
        created_at: '2026-06-29T12:01:00.000Z',
        updated_at: '2026-06-29T12:01:00.000Z',
      },
    ];
    const update = vi.fn();
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

        if (tableName === 'media_assets') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(async () => ({ data: rows, error: null })),
              })),
            })),
            update,
          };
        }

        throw new Error(`Unexpected table ${tableName}`);
      }),
    };
    const repository = createSupabaseTripRepository(supabase as never);

    await expect(repository.reorderDestinationMedia(destinationId, [firstId, foreignId]))
      .rejects.toThrow(`missing ${secondId}`);

    expect(update).not.toHaveBeenCalled();
  });
});
