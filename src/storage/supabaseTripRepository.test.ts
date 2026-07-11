import { describe, expect, it, vi } from 'vitest';
import { createActivity as createActivityModel } from '../domain/activities';
import { createDestination } from '../domain/destinations';
import { createRouteLeg, createStraightLineGeometry } from '../domain/routeLegs';
import type { Activity } from '../domain/types';
import { resolveVehiclePreset } from '../domain/vehiclePresets';
import { mediaImageVariants } from '../media/imageOptimization';
import {
  activityFromSupabaseRow,
  activityToSupabaseRow,
  destinationFromSupabaseRow,
  destinationToSupabaseRow,
  mediaAssetFromSupabaseRow,
  routeLegFromSupabaseRow,
  routeLegToSupabaseRow,
  createSupabaseTripRepository,
} from './supabaseTripRepository';
import { createSupabaseTripDirectoryRepository } from './tripDirectoryRepository';

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

describe('supabase trip directory repository', () => {
  it('lists trips ordered by update time', async () => {
    const rows = [
      {
        id: crypto.randomUUID(),
        owner_user_id: crypto.randomUUID(),
        name: 'Japan',
        description: 'Cherry blossom route',
        vehicle_preset: 'large-camper',
        vehicle_profile: 'driving-hgv',
        vehicle_type: 'hgv',
        vehicle_restrictions: resolveVehiclePreset('large-camper').restrictions,
        created_at: '2026-07-01T12:00:00.000Z',
        updated_at: '2026-07-02T12:00:00.000Z',
      },
    ];
    const orderCreatedAt = vi.fn(async () => ({ data: rows, error: null }));
    const orderUpdatedAt = vi.fn(() => ({ order: orderCreatedAt }));
    const supabase = {
      from: vi.fn((tableName: string) => {
        expect(tableName).toBe('trips');
        return {
          select: vi.fn(() => ({
            order: orderUpdatedAt,
          })),
        };
      }),
    };
    const repository = createSupabaseTripDirectoryRepository(supabase as never);

    await expect(repository.listTrips()).resolves.toEqual([
      {
        id: rows[0].id,
        name: 'Japan',
        description: 'Cherry blossom route',
        routingVehicle: resolveVehiclePreset('large-camper'),
        createdAt: '2026-07-01T12:00:00.000Z',
        updatedAt: '2026-07-02T12:00:00.000Z',
      },
    ]);
    expect(orderUpdatedAt).toHaveBeenCalledWith('updated_at', { ascending: false });
    expect(orderCreatedAt).toHaveBeenCalledWith('created_at', { ascending: false });
  });

  it('creates a trip for the current Supabase user', async () => {
    const userId = crypto.randomUUID();
    const row = {
      id: crypto.randomUUID(),
      owner_user_id: userId,
      name: 'South America',
      description: '',
      vehicle_preset: 'expedition-truck',
      vehicle_profile: 'driving-hgv',
      vehicle_type: 'hgv',
      vehicle_restrictions: resolveVehiclePreset('expedition-truck').restrictions,
      created_at: '2026-07-03T12:00:00.000Z',
      updated_at: '2026-07-03T12:00:00.000Z',
    };
    const insert = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn(async () => ({ data: row, error: null })),
      })),
    }));
    const supabase = {
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: userId } }, error: null })),
      },
      from: vi.fn(() => ({ insert })),
    };
    const repository = createSupabaseTripDirectoryRepository(supabase as never);

    await expect(repository.createTrip({
      name: 'South America',
      routingVehicle: resolveVehiclePreset('expedition-truck'),
    })).resolves.toMatchObject({
      id: row.id,
      name: 'South America',
      routingVehicle: resolveVehiclePreset('expedition-truck'),
    });
    expect(insert).toHaveBeenCalledWith({
      owner_user_id: userId,
      name: 'South America',
      description: '',
      vehicle_preset: 'expedition-truck',
      vehicle_profile: 'driving-hgv',
      vehicle_type: 'hgv',
      vehicle_restrictions: resolveVehiclePreset('expedition-truck').restrictions,
    });
  });

  it('renames a trip', async () => {
    const tripId = crypto.randomUUID();
    const row = {
      id: tripId,
      owner_user_id: crypto.randomUUID(),
      name: 'Renamed trip',
      description: 'Updated',
      vehicle_preset: 'large-camper',
      vehicle_profile: 'driving-hgv',
      vehicle_type: 'hgv',
      vehicle_restrictions: resolveVehiclePreset('large-camper').restrictions,
      created_at: '2026-07-01T12:00:00.000Z',
      updated_at: '2026-07-03T12:00:00.000Z',
    };
    const eq = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn(async () => ({ data: row, error: null })),
      })),
    }));
    const update = vi.fn(() => ({ eq }));
    const supabase = {
      from: vi.fn(() => ({ update })),
    };
    const repository = createSupabaseTripDirectoryRepository(supabase as never);

    await expect(repository.updateTrip(tripId, {
      name: 'Renamed trip',
      description: 'Updated',
      routingVehicle: resolveVehiclePreset('large-camper'),
    })).resolves.toMatchObject({
      id: tripId,
      name: 'Renamed trip',
      description: 'Updated',
      routingVehicle: resolveVehiclePreset('large-camper'),
    });
    expect(update).toHaveBeenCalledWith({
      name: 'Renamed trip',
      description: 'Updated',
      vehicle_preset: 'large-camper',
      vehicle_profile: 'driving-hgv',
      vehicle_type: 'hgv',
      vehicle_restrictions: resolveVehiclePreset('large-camper').restrictions,
    });
    expect(eq).toHaveBeenCalledWith('id', tripId);
  });

  it('removes storage objects before deleting a trip row', async () => {
    const tripId = crypto.randomUUID();
    const remove = vi.fn(async () => ({ data: [], error: null }));
    const deleteEq = vi.fn(async () => ({ error: null }));
    const supabase = {
      storage: {
        from: vi.fn(() => ({ remove })),
      },
      from: vi.fn((tableName: string) => {
        if (tableName === 'media_assets') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(async () => ({
                data: [
                  { bucket_id: 'trip-media', object_path: `${tripId}/stop/a.webp` },
                  { bucket_id: 'trip-media', object_path: `${tripId}/stop/b.webp` },
                ],
                error: null,
              })),
            })),
          };
        }

        if (tableName === 'trips') {
          return {
            delete: vi.fn(() => ({
              eq: deleteEq,
            })),
          };
        }

        throw new Error(`Unexpected table ${tableName}`);
      }),
    };
    const repository = createSupabaseTripDirectoryRepository(supabase as never);

    await repository.deleteTrip(tripId);

    expect(supabase.storage.from).toHaveBeenCalledWith('trip-media');
    expect(remove).toHaveBeenCalledWith([`${tripId}/stop/a.webp`, `${tripId}/stop/b.webp`]);
    expect(deleteEq).toHaveBeenCalledWith('id', tripId);
  });

  it('does not delete the trip row when storage cleanup fails', async () => {
    const tripId = crypto.randomUUID();
    const deleteTrip = vi.fn();
    const supabase = {
      storage: {
        from: vi.fn(() => ({
          remove: vi.fn(async () => ({
            data: null,
            error: { message: 'Storage remove failed' },
          })),
        })),
      },
      from: vi.fn((tableName: string) => {
        if (tableName === 'media_assets') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(async () => ({
                data: [{ bucket_id: 'trip-media', object_path: `${tripId}/stop/a.webp` }],
                error: null,
              })),
            })),
          };
        }

        if (tableName === 'trips') {
          return { delete: deleteTrip };
        }

        throw new Error(`Unexpected table ${tableName}`);
      }),
    };
    const repository = createSupabaseTripDirectoryRepository(supabase as never);

    await expect(repository.deleteTrip(tripId)).rejects.toThrow('Storage remove failed');
    expect(deleteTrip).not.toHaveBeenCalled();
  });
});

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

  it('normalizes legacy destination research links from Supabase rows', () => {
    const destination = createDestination({
      name: 'Kyoto',
      coordinates: { lat: 35.6764, lng: 139.65 },
    });
    const row = {
      ...destinationToSupabaseRow(destination, crypto.randomUUID()),
      research: {
        notes: null,
        links: [
          {
            id: 'wiki-link',
            title: '',
            url: 'www.wikipedia.org/wiki/Kyoto',
          },
          {
            id: 'official-link',
            title: 'Official',
            url: 'https://kyoto.example/official',
            sortOrder: 0,
          },
        ],
      },
    };

    expect(destinationFromSupabaseRow(row as never).research).toEqual({
      notes: '',
      bookReferences: [],
      links: [
        expect.objectContaining({
          id: 'official-link',
          domain: 'kyoto.example',
          sortOrder: 0,
        }),
        expect.objectContaining({
          id: 'wiki-link',
          title: 'wikipedia.org',
          url: 'https://www.wikipedia.org/wiki/Kyoto',
          domain: 'wikipedia.org',
          sortOrder: 0,
        }),
      ],
    });
  });

  it('round-trips route intent through Supabase mapping', () => {
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
      movement: 'drive', calculation: 'automatic',
      status: 'ready',
      distanceKm: 1185,
      travelTimeHours: 17.5,
      geometry,
      provider: 'openrouteservice',
      profile: 'driving-car',
      routeKey: 'route-key',
      calculatedAt: '2026-06-29T12:00:00.000Z',
      ferryPolicy: 'require',
      waypoints: [{
        id: 'waypoint-1',
        order: 0,
        name: 'Trondheim',
        coordinates: { lat: 63.4305, lng: 10.3951 },
        location: origin.location,
        notes: 'Pause in Trondheim.',
        links: [],
      }],
      sections: [{ kind: 'ferry', startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 8 }],
      warnings: [{ code: 'FERRY_REQUIRED_NOT_FOUND', message: 'Ferry crossing required.' }],
    });
    const tripId = 'trip-1';

    const row = routeLegToSupabaseRow(routeLeg, tripId);

    expect(row).toMatchObject({
      id: routeLeg.id,
      trip_id: tripId,
      origin_destination_id: origin.id,
      target_destination_id: target.id,
      distance_km: 1185,
      travel_time_hours: 17.5,
      route_key: 'route-key',
      movement: 'drive',
      calculation_mode: 'automatic',
      ferry_policy: 'require',
      waypoints: routeLeg.waypoints,
      sections: routeLeg.sections,
      warnings: routeLeg.warnings,
    });
    expect(routeLegFromSupabaseRow(row)).toEqual(routeLeg);
  });

  it('maps activities to and from Supabase rows', () => {
    const activity: Activity = {
      ...createActivityModel({
        destinationId: crypto.randomUUID(),
        title: 'Night market',
        order: 3,
      }),
      description: 'Street food crawl',
      category: 'food',
      status: 'planned',
      priority: 'high',
      location: {
        name: 'Myeongdong',
        address: 'Seoul, South Korea',
        coordinates: { lat: 37.5638, lng: 126.985 },
        sourceProvider: 'manual',
      },
      links: [
        {
          id: crypto.randomUUID(),
          title: 'Menu',
          url: 'https://example.com/menu',
          domain: 'example.com',
          sortOrder: 0,
        },
      ],
      notes: 'Go hungry.',
      tags: ['food', 'evening'],
    };
    const tripId = crypto.randomUUID();

    const row = activityToSupabaseRow(activity, tripId);

    expect(row).toMatchObject({
      id: activity.id,
      trip_id: tripId,
      destination_id: activity.destinationId,
      activity_order: 3,
      title: 'Night market',
      category: 'food',
      status: 'planned',
      priority: 'high',
      notes: 'Go hungry.',
      tags: ['food', 'evening'],
    });
    expect(row.location).toEqual(activity.location);
    expect(activityFromSupabaseRow(row)).toEqual(activity);
  });

  it('normalizes legacy activity links from Supabase rows', () => {
    const activity = createActivityModel({
      destinationId: crypto.randomUUID(),
      title: 'Night market',
      order: 3,
    });
    const row = {
      ...activityToSupabaseRow(activity, crypto.randomUUID()),
      links: [
        {
          id: 'official-link',
          title: 'Official',
          url: 'https://market.example',
          sortOrder: 0,
        },
        {
          id: 'wiki-link',
          title: '',
          url: 'www.wikipedia.org/wiki/Night_market',
        },
      ],
    };

    expect(activityFromSupabaseRow(row as never).links).toEqual([
      expect.objectContaining({
        id: 'official-link',
        domain: 'market.example',
        sortOrder: 0,
      }),
      expect.objectContaining({
        id: 'wiki-link',
        title: 'wikipedia.org',
        url: 'https://www.wikipedia.org/wiki/Night_market',
        domain: 'wikipedia.org',
        sortOrder: 1,
      }),
    ]);
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
      movement: 'drive', calculation: 'automatic',
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
            { id: tripId, owner_user_id: crypto.randomUUID(), name: 'Example trip' },
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
    const repository = createSupabaseTripRepository(supabase as never, tripId);

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

  it('removes destination media storage objects after deleting a destination', async () => {
    const tripId = crypto.randomUUID();
    const destinationId = crypto.randomUUID();
    const calls: string[] = [];
    const mediaRows = [
      {
        id: crypto.randomUUID(),
        trip_id: tripId,
        destination_id: destinationId,
        activity_id: null,
        bucket_id: 'trip-media',
        object_path: `${tripId}/${destinationId}/destination.webp`,
        caption: '',
        credit: '',
        sort_order: 0,
        content_type: 'image/webp',
        size_bytes: 1200,
        uploaded_by: crypto.randomUUID(),
        created_at: '2026-06-29T12:00:00.000Z',
        updated_at: '2026-06-29T12:00:00.000Z',
      },
      {
        id: crypto.randomUUID(),
        trip_id: tripId,
        destination_id: destinationId,
        activity_id: crypto.randomUUID(),
        bucket_id: 'trip-media',
        object_path: `${tripId}/${destinationId}/activity.webp`,
        caption: '',
        credit: '',
        sort_order: 0,
        content_type: 'image/webp',
        size_bytes: 1200,
        uploaded_by: crypto.randomUUID(),
        created_at: '2026-06-29T12:01:00.000Z',
        updated_at: '2026-06-29T12:01:00.000Z',
      },
      {
        id: crypto.randomUUID(),
        trip_id: tripId,
        destination_id: destinationId,
        activity_id: null,
        bucket_id: 'archive-media',
        object_path: `${tripId}/${destinationId}/archive.webp`,
        caption: '',
        credit: '',
        sort_order: 1,
        content_type: 'image/webp',
        size_bytes: 1200,
        uploaded_by: crypto.randomUUID(),
        created_at: '2026-06-29T12:02:00.000Z',
        updated_at: '2026-06-29T12:02:00.000Z',
      },
    ];
    const removeTripMedia = vi.fn(async () => {
      calls.push('storage:trip-media');
      return { data: [], error: null };
    });
    const removeArchiveMedia = vi.fn(async () => {
      calls.push('storage:archive-media');
      return { data: [], error: null };
    });
    const mediaDestinationFilter = vi.fn(async () => ({ data: mediaRows, error: null }));
    const mediaTripFilter = vi.fn(() => ({ eq: mediaDestinationFilter }));
    const deleteIdFilter = vi.fn(async () => {
      calls.push('destination');
      return { error: null };
    });
    const deleteTripFilter = vi.fn(() => ({ eq: deleteIdFilter }));
    const deleteRows = vi.fn(() => ({ eq: deleteTripFilter }));
    const supabase = {
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: crypto.randomUUID() } },
          error: null,
        })),
      },
      storage: {
        from: vi.fn((bucketId: string) => ({
          remove: bucketId === 'archive-media' ? removeArchiveMedia : removeTripMedia,
        })),
      },
      from: vi.fn((tableName: string) => {
        if (tableName === 'trips') {
          return createTripsTableMock([
            { id: tripId, owner_user_id: crypto.randomUUID(), name: 'Example trip' },
          ]);
        }

        if (tableName === 'media_assets') {
          return {
            select: vi.fn(() => ({ eq: mediaTripFilter })),
          };
        }

        if (tableName === 'destinations') {
          return {
            delete: deleteRows,
          };
        }

        throw new Error(`Unexpected table ${tableName}`);
      }),
    };
    const repository = createSupabaseTripRepository(supabase as never, tripId);

    await repository.deleteDestination(destinationId);

    expect(mediaTripFilter).toHaveBeenCalledWith('trip_id', tripId);
    expect(mediaDestinationFilter).toHaveBeenCalledWith('destination_id', destinationId);
    expect(deleteTripFilter).toHaveBeenCalledWith('trip_id', tripId);
    expect(deleteIdFilter).toHaveBeenCalledWith('id', destinationId);
    expect(removeTripMedia).toHaveBeenCalledWith([
      mediaRows[0].object_path,
      mediaRows[1].object_path,
    ]);
    expect(removeArchiveMedia).toHaveBeenCalledWith([mediaRows[2].object_path]);
    expect(calls).toEqual(['destination', 'storage:trip-media', 'storage:archive-media']);
  });

  it('batch deletes destination rows in one statement before best-effort storage cleanup', async () => {
    const tripId = crypto.randomUUID();
    const destinationIds = [crypto.randomUUID(), crypto.randomUUID()];
    const mediaIn = vi.fn(async () => ({
      data: [{ bucket_id: 'trip-media', object_path: 'one.webp' }], error: null,
    }));
    const mediaEq = vi.fn(() => ({ in: mediaIn }));
    const deleteIn = vi.fn(async () => ({ error: null }));
    const deleteEq = vi.fn(() => ({ in: deleteIn }));
    const remove = vi.fn(async () => ({ data: [], error: new Error('cleanup failed') }));
    const supabase = {
      storage: { from: vi.fn(() => ({ remove })) },
      from: vi.fn((table: string) => {
        if (table === 'media_assets') return { select: vi.fn(() => ({ eq: mediaEq })) };
        if (table === 'destinations') return { delete: vi.fn(() => ({ eq: deleteEq })) };
        throw new Error(`Unexpected table ${table}`);
      }),
    };
    const repository = createSupabaseTripRepository(supabase as never, tripId);

    await expect(repository.deleteDestinations!(destinationIds)).resolves.toBeUndefined();

    expect(mediaEq).toHaveBeenCalledWith('trip_id', tripId);
    expect(mediaIn).toHaveBeenCalledWith('destination_id', destinationIds);
    expect(deleteEq).toHaveBeenCalledWith('trip_id', tripId);
    expect(deleteIn).toHaveBeenCalledWith('id', destinationIds);
    expect(remove).toHaveBeenCalledWith(['one.webp']);
  });

  it('lists activities for a destination ordered by activity order and creation time', async () => {
    const tripId = crypto.randomUUID();
    const destinationId = crypto.randomUUID();
    const rows = [
      activityToSupabaseRow(
        createActivityModel({
          destinationId,
          title: 'First sorted',
          order: 0,
        }),
        tripId,
      ),
      activityToSupabaseRow(
        createActivityModel({
          destinationId,
          title: 'Second sorted',
          order: 1,
        }),
        tripId,
      ),
    ];
    const createdOrder = vi.fn(async () => ({ data: rows, error: null }));
    const activityOrder = vi.fn(() => ({ order: createdOrder }));
    const destinationFilter = vi.fn(() => ({ order: activityOrder }));
    const tripFilter = vi.fn(() => ({ eq: destinationFilter }));
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
            { id: tripId, owner_user_id: crypto.randomUUID(), name: 'Example trip' },
          ]);
        }

        if (tableName === 'activities') {
          return {
            select: vi.fn(() => ({ eq: tripFilter })),
          };
        }

        throw new Error(`Unexpected table ${tableName}`);
      }),
    };
    const repository = createSupabaseTripRepository(supabase as never, tripId);

    await expect(repository.listActivities(destinationId)).resolves.toEqual(
      rows.map(activityFromSupabaseRow),
    );

    expect(tripFilter).toHaveBeenCalledWith('trip_id', tripId);
    expect(destinationFilter).toHaveBeenCalledWith('destination_id', destinationId);
    expect(activityOrder).toHaveBeenCalledWith('activity_order', { ascending: true });
    expect(createdOrder).toHaveBeenCalledWith('created_at', { ascending: true });
  });

  it('creates an activity scoped to the active trip and destination', async () => {
    const tripId = crypto.randomUUID();
    const destinationId = crypto.randomUUID();
    const activityId = crypto.randomUUID();
    const createdAt = '2026-07-03T12:00:00.000Z';
    const location = {
      name: 'Louvre Museum',
      address: 'Rue de Rivoli',
      coordinates: { lat: 48.8606, lng: 2.3364 },
      sourceProvider: 'maptiler' as const,
      sourceFeatureId: 'poi.123',
    };
    const insertedRows: unknown[] = [];
    vi.setSystemTime(new Date(createdAt));

    const existingCreatedOrder = vi.fn(async () => ({ data: [], error: null }));
    const existingActivityOrder = vi.fn(() => ({ order: existingCreatedOrder }));
    const existingDestinationFilter = vi.fn(() => ({ order: existingActivityOrder }));
    const existingTripFilter = vi.fn(() => ({ eq: existingDestinationFilter }));
    const insert = vi.fn((row) => {
      insertedRows.push(row);
      return {
        select: vi.fn(() => ({
          single: vi.fn(async () => ({
            data: {
              ...row,
              id: activityId,
              created_at: createdAt,
              updated_at: createdAt,
            },
            error: null,
          })),
        })),
      };
    });
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
            { id: tripId, owner_user_id: crypto.randomUUID(), name: 'Example trip' },
          ]);
        }

        if (tableName === 'activities') {
          return {
            select: vi.fn(() => ({ eq: existingTripFilter })),
            insert,
          };
        }

        throw new Error(`Unexpected table ${tableName}`);
      }),
    };
    const repository = createSupabaseTripRepository(supabase as never, tripId);

    const activity = await repository.createActivity({
      destinationId,
      title: 'Night market',
      order: 4,
      location,
    });

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      trip_id: tripId,
      destination_id: destinationId,
      activity_order: 4,
      title: 'Night market',
      description: '',
      category: 'other',
      status: 'idea',
      priority: 'medium',
      links: [],
      notes: '',
      tags: [],
      location,
    }));
    expect(activity).toEqual(expect.objectContaining({
      id: activityId,
      destinationId,
      title: 'Night market',
      order: 4,
      location,
    }));
    expect(insertedRows).toHaveLength(1);

    vi.useRealTimers();
  });

  it('creates an activity without explicit order after the current max order', async () => {
    const tripId = crypto.randomUUID();
    const destinationId = crypto.randomUUID();
    const existingRows = [0, 3].map((order) =>
      activityToSupabaseRow(
        createActivityModel({
          destinationId,
          title: `Existing ${order}`,
          order,
        }),
        tripId,
      ),
    );
    const existingCreatedOrder = vi.fn(async () => ({ data: existingRows, error: null }));
    const existingActivityOrder = vi.fn(() => ({ order: existingCreatedOrder }));
    const existingDestinationFilter = vi.fn(() => ({ order: existingActivityOrder }));
    const existingTripFilter = vi.fn(() => ({ eq: existingDestinationFilter }));
    const insert = vi.fn((row) => ({
      select: vi.fn(() => ({
        single: vi.fn(async () => ({
          data: row,
          error: null,
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
      from: vi.fn((tableName: string) => {
        if (tableName === 'trips') {
          return createTripsTableMock([
            { id: tripId, owner_user_id: crypto.randomUUID(), name: 'Example trip' },
          ]);
        }

        if (tableName === 'activities') {
          return {
            select: vi.fn(() => ({ eq: existingTripFilter })),
            insert,
          };
        }

        throw new Error(`Unexpected table ${tableName}`);
      }),
    };
    const repository = createSupabaseTripRepository(supabase as never, tripId);

    await repository.createActivity({
      destinationId,
      title: 'After a deleted middle item',
    });

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      activity_order: 4,
    }));
  });

  it('updates and deletes activities through Supabase using active trip scope', async () => {
    const tripId = crypto.randomUUID();
    const destinationId = crypto.randomUUID();
    const activityId = crypto.randomUUID();
    const updatedRow = activityToSupabaseRow(
      {
        ...createActivityModel({ destinationId, title: 'Updated title', order: 0 }),
        id: activityId,
        description: 'Updated description',
        status: 'booked',
      },
      tripId,
    );
    const updateSingle = vi.fn(async () => ({ data: updatedRow, error: null }));
    const updateSelect = vi.fn(() => ({ single: updateSingle }));
    const updateIdFilter = vi.fn(() => ({ select: updateSelect }));
    const updateTripFilter = vi.fn(() => ({ eq: updateIdFilter }));
    const update = vi.fn(() => ({ eq: updateTripFilter }));
    const deleteIdFilter = vi.fn(async () => ({ error: null }));
    const deleteTripFilter = vi.fn(() => ({ eq: deleteIdFilter }));
    const deleteRows = vi.fn(() => ({ eq: deleteTripFilter }));
    const mediaActivityFilter = vi.fn(async () => ({ data: [], error: null }));
    const mediaTripFilter = vi.fn(() => ({ eq: mediaActivityFilter }));
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
            { id: tripId, owner_user_id: crypto.randomUUID(), name: 'Example trip' },
          ]);
        }

        if (tableName === 'activities') {
          return {
            update,
            delete: deleteRows,
          };
        }

        if (tableName === 'media_assets') {
          return {
            select: vi.fn(() => ({ eq: mediaTripFilter })),
          };
        }

        throw new Error(`Unexpected table ${tableName}`);
      }),
    };
    const repository = createSupabaseTripRepository(supabase as never, tripId);

    await expect(repository.updateActivity(activityId, {
      title: 'Updated title',
      description: 'Updated description',
      status: 'booked',
      location: undefined,
    })).resolves.toEqual(expect.objectContaining({
      id: activityId,
      title: 'Updated title',
      description: 'Updated description',
      status: 'booked',
    }));
    await repository.deleteActivity(activityId);

    expect(update).toHaveBeenCalledWith({
      title: 'Updated title',
      description: 'Updated description',
      status: 'booked',
      location: null,
    });
    expect(updateTripFilter).toHaveBeenCalledWith('trip_id', tripId);
    expect(updateIdFilter).toHaveBeenCalledWith('id', activityId);
    expect(mediaTripFilter).toHaveBeenCalledWith('trip_id', tripId);
    expect(mediaActivityFilter).toHaveBeenCalledWith('activity_id', activityId);
    expect(deleteTripFilter).toHaveBeenCalledWith('trip_id', tripId);
    expect(deleteIdFilter).toHaveBeenCalledWith('id', activityId);
  });

  it('updates activity links with rich metadata as-is', async () => {
    const tripId = crypto.randomUUID();
    const destinationId = crypto.randomUUID();
    const activityId = crypto.randomUUID();
    const links = [
      {
        id: crypto.randomUUID(),
        title: 'Official guide',
        url: 'https://louvre.example/guide',
        domain: 'louvre.example',
        imageUrl: 'https://louvre.example/guide.jpg',
        sortOrder: 2,
        previewFetchedAt: '2026-07-01T10:00:00.000Z',
      },
    ];
    const updatedRow = activityToSupabaseRow(
      {
        ...createActivityModel({ destinationId, title: 'Louvre', order: 0 }),
        id: activityId,
        links,
      },
      tripId,
    );
    const updateSingle = vi.fn(async () => ({ data: updatedRow, error: null }));
    const updateSelect = vi.fn(() => ({ single: updateSingle }));
    const updateIdFilter = vi.fn(() => ({ select: updateSelect }));
    const updateTripFilter = vi.fn(() => ({ eq: updateIdFilter }));
    const update = vi.fn(() => ({ eq: updateTripFilter }));
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
            { id: tripId, owner_user_id: crypto.randomUUID(), name: 'Example trip' },
          ]);
        }

        if (tableName === 'activities') {
          return { update };
        }

        throw new Error(`Unexpected table ${tableName}`);
      }),
    };
    const repository = createSupabaseTripRepository(supabase as never, tripId);

    await expect(repository.updateActivity(activityId, { links })).resolves.toEqual(
      expect.objectContaining({ id: activityId, links }),
    );

    expect(update).toHaveBeenCalledWith({ links });
    expect(updateTripFilter).toHaveBeenCalledWith('trip_id', tripId);
    expect(updateIdFilter).toHaveBeenCalledWith('id', activityId);
  });

  it('removes activity media storage objects after deleting an activity', async () => {
    const tripId = crypto.randomUUID();
    const activityId = crypto.randomUUID();
    const calls: string[] = [];
    const mediaRows = [
      {
        id: crypto.randomUUID(),
        trip_id: tripId,
        destination_id: crypto.randomUUID(),
        activity_id: activityId,
        bucket_id: 'trip-media',
        object_path: `${tripId}/destination/${activityId}/first.webp`,
        caption: '',
        credit: '',
        sort_order: 0,
        content_type: 'image/webp',
        size_bytes: 1200,
        uploaded_by: crypto.randomUUID(),
        created_at: '2026-06-29T12:00:00.000Z',
        updated_at: '2026-06-29T12:00:00.000Z',
      },
      {
        id: crypto.randomUUID(),
        trip_id: tripId,
        destination_id: crypto.randomUUID(),
        activity_id: activityId,
        bucket_id: 'trip-media',
        object_path: `${tripId}/destination/${activityId}/second.webp`,
        caption: '',
        credit: '',
        sort_order: 1,
        content_type: 'image/webp',
        size_bytes: 1200,
        uploaded_by: crypto.randomUUID(),
        created_at: '2026-06-29T12:01:00.000Z',
        updated_at: '2026-06-29T12:01:00.000Z',
      },
      {
        id: crypto.randomUUID(),
        trip_id: tripId,
        destination_id: crypto.randomUUID(),
        activity_id: activityId,
        bucket_id: 'archive-media',
        object_path: `${tripId}/destination/${activityId}/archived.webp`,
        caption: '',
        credit: '',
        sort_order: 2,
        content_type: 'image/webp',
        size_bytes: 1200,
        uploaded_by: crypto.randomUUID(),
        created_at: '2026-06-29T12:02:00.000Z',
        updated_at: '2026-06-29T12:02:00.000Z',
      },
    ];
    const removeTripMedia = vi.fn(async () => {
      calls.push('storage:trip-media');
      return { data: [], error: null };
    });
    const removeArchiveMedia = vi.fn(async () => {
      calls.push('storage:archive-media');
      return { data: [], error: null };
    });
    const mediaActivityFilter = vi.fn(async () => ({ data: mediaRows, error: null }));
    const mediaTripFilter = vi.fn(() => ({ eq: mediaActivityFilter }));
    const deleteIdFilter = vi.fn(async () => {
      calls.push('activity');
      return { error: null };
    });
    const deleteTripFilter = vi.fn(() => ({ eq: deleteIdFilter }));
    const deleteRows = vi.fn(() => ({ eq: deleteTripFilter }));
    const supabase = {
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: crypto.randomUUID() } },
          error: null,
        })),
      },
      storage: {
        from: vi.fn((bucketId: string) => ({
          remove: bucketId === 'archive-media' ? removeArchiveMedia : removeTripMedia,
        })),
      },
      from: vi.fn((tableName: string) => {
        if (tableName === 'trips') {
          return createTripsTableMock([
            { id: tripId, owner_user_id: crypto.randomUUID(), name: 'Example trip' },
          ]);
        }

        if (tableName === 'media_assets') {
          return {
            select: vi.fn(() => ({ eq: mediaTripFilter })),
          };
        }

        if (tableName === 'activities') {
          return {
            delete: deleteRows,
          };
        }

        throw new Error(`Unexpected table ${tableName}`);
      }),
    };
    const repository = createSupabaseTripRepository(supabase as never, tripId);

    await repository.deleteActivity(activityId);

    expect(mediaTripFilter).toHaveBeenCalledWith('trip_id', tripId);
    expect(mediaActivityFilter).toHaveBeenCalledWith('activity_id', activityId);
    expect(deleteTripFilter).toHaveBeenCalledWith('trip_id', tripId);
    expect(deleteIdFilter).toHaveBeenCalledWith('id', activityId);
    expect(removeTripMedia).toHaveBeenCalledWith([
      mediaRows[0].object_path,
      mediaRows[1].object_path,
    ]);
    expect(removeArchiveMedia).toHaveBeenCalledWith([mediaRows[2].object_path]);
    expect(calls).toEqual(['activity', 'storage:trip-media', 'storage:archive-media']);
  });

  it('reorders activities and persists updated orders for the active trip', async () => {
    const tripId = crypto.randomUUID();
    const destinationId = crypto.randomUUID();
    const first = createActivityModel({ destinationId, title: 'First', order: 0 });
    const second = createActivityModel({ destinationId, title: 'Second', order: 1 });
    const listedRows = [activityToSupabaseRow(first, tripId), activityToSupabaseRow(second, tripId)];
    const reorderedRows = [
      activityToSupabaseRow({ ...second, order: 0 }, tripId),
      activityToSupabaseRow({ ...first, order: 1 }, tripId),
    ];
    const updateCalls: Array<{
      order: number;
      filters: Array<{ column: string; value: string }>;
    }> = [];
    const listCreatedOrder = vi
      .fn()
      .mockResolvedValueOnce({ data: listedRows, error: null })
      .mockResolvedValueOnce({ data: reorderedRows, error: null });
    const listActivityOrder = vi.fn(() => ({ order: listCreatedOrder }));
    const listDestinationFilter = vi.fn(() => ({ order: listActivityOrder }));
    const listTripFilter = vi.fn(() => ({ eq: listDestinationFilter }));
    const update = vi.fn((patch: { activity_order: number }) => {
      const filters: Array<{ column: string; value: string }> = [];
      updateCalls.push({ order: patch.activity_order, filters });

      const idFilter = vi.fn(async (column: string, value: string) => {
        filters.push({ column, value });
        return { error: null };
      });
      const destinationFilter = vi.fn((column: string, value: string) => {
        filters.push({ column, value });
        return { eq: idFilter };
      });
      const tripFilter = vi.fn((column: string, value: string) => {
        filters.push({ column, value });
        return { eq: destinationFilter };
      });

      return { eq: tripFilter };
    });
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
            { id: tripId, owner_user_id: crypto.randomUUID(), name: 'Example trip' },
          ]);
        }

        if (tableName === 'activities') {
          return {
            select: vi.fn(() => ({ eq: listTripFilter })),
            update,
          };
        }

        throw new Error(`Unexpected table ${tableName}`);
      }),
    };
    const repository = createSupabaseTripRepository(supabase as never, tripId);

    await expect(repository.reorderActivities(destinationId, [second.id, first.id])).resolves.toEqual([
      expect.objectContaining({ id: second.id, order: 0 }),
      expect.objectContaining({ id: first.id, order: 1 }),
    ]);

    expect(updateCalls).toEqual([
      {
        order: 0,
        filters: [
          { column: 'trip_id', value: tripId },
          { column: 'destination_id', value: destinationId },
          { column: 'id', value: second.id },
        ],
      },
      {
        order: 1,
        filters: [
          { column: 'trip_id', value: tripId },
          { column: 'destination_id', value: destinationId },
          { column: 'id', value: first.id },
        ],
      },
    ]);
  });

  it('replaces trip data with activity snapshots after destinations', async () => {
    const tripId = crypto.randomUUID();
    const destination = createDestination({
      name: 'Paris',
      coordinates: { lat: 48.8566, lng: 2.3522 },
    });
    const routeLeg = createRouteLeg({
      originDestinationId: destination.id,
      targetDestinationId: crypto.randomUUID(),
      movement: 'drive', calculation: 'automatic',
    });
    const activity = createActivityModel({
      destinationId: destination.id,
      title: 'Louvre',
      order: 0,
    });
    const calls: string[] = [];
    const inserts: Record<string, unknown[]> = {};
    const createTableMock = (tableName: string) => ({
      delete: vi.fn(() => ({
        eq: vi.fn(async (column: string, value: string) => {
          calls.push(`delete:${tableName}:${column}:${value}`);
          return { error: null };
        }),
      })),
      insert: vi.fn(async (rows: unknown[]) => {
        calls.push(`insert:${tableName}`);
        inserts[tableName] = rows;
        return { error: null };
      }),
    });
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
            { id: tripId, owner_user_id: crypto.randomUUID(), name: 'Example trip' },
          ]);
        }

        if (tableName === 'destinations' || tableName === 'route_legs' || tableName === 'activities') {
          return createTableMock(tableName);
        }

        throw new Error(`Unexpected table ${tableName}`);
      }),
    };
    const repository = createSupabaseTripRepository(supabase as never, tripId);

    await repository.replaceTripData({
      destinations: [destination],
      routeLegs: [routeLeg],
      activities: [activity],
    });

    expect(calls).toEqual([
      `delete:route_legs:trip_id:${tripId}`,
      `delete:activities:trip_id:${tripId}`,
      `delete:destinations:trip_id:${tripId}`,
      'insert:destinations',
      'insert:activities',
      'insert:route_legs',
    ]);
    expect(inserts.activities).toEqual([
      expect.objectContaining({
        id: activity.id,
        trip_id: tripId,
        destination_id: destination.id,
        title: 'Louvre',
      }),
    ]);
  });

  it('loads only destinations for the explicit trip id', async () => {
    const tripId = crypto.randomUUID();
    const destination = createDestination({
      name: 'Kyoto',
      coordinates: { lat: 35.6764, lng: 139.65 },
    });
    const destinationRow = destinationToSupabaseRow(destination, tripId);
    const eq = vi.fn(() => ({
      order: vi.fn(() => ({
        order: vi.fn(async () => ({ data: [destinationRow], error: null })),
      })),
    }));
    const supabase = {
      from: vi.fn((tableName: string) => {
        if (tableName !== 'destinations') {
          throw new Error(`Unexpected table ${tableName}`);
        }

        return {
          select: vi.fn(() => ({ eq })),
        };
      }),
    };
    const repository = createSupabaseTripRepository(supabase as never, tripId);

    await expect(repository.listDestinations()).resolves.toEqual([destination]);
    expect(eq).toHaveBeenCalledWith('trip_id', tripId);
    expect(supabase.from).not.toHaveBeenCalledWith('trips');
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
        getSession: vi.fn(async () => ({
          data: { session: { access_token: 'session-access-token' } },
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
            { id: tripId, owner_user_id: userId, name: 'Example trip' },
          ]);
        }

        if (tableName === 'media_assets') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  is: vi.fn(async () => ({ data: existingRows, error: null })),
                })),
              })),
            })),
            insert: mediaInsert,
          };
        }

        throw new Error(`Unexpected table ${tableName}`);
      }),
    };
    const repository = createSupabaseTripRepository(supabase as never, tripId);
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
      .mockImplementationOnce(() => ({
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
          eq: vi.fn(() => ({
            is: vi.fn(async () => ({ data: existingRowsResponses[0], error: null })),
          })),
        })),
      }))
      .mockImplementationOnce(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            is: vi.fn(async () => ({ data: existingRowsResponses[1], error: null })),
          })),
        })),
      }));
    const supabase = {
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: userId } },
          error: null,
        })),
        getSession: vi.fn(async () => ({
          data: { session: { access_token: 'session-access-token' } },
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
            { id: tripId, owner_user_id: userId, name: 'Example trip' },
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
    const repository = createSupabaseTripRepository(supabase as never, tripId);
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

  it('removes an uploaded destination media object when metadata insertion fails', async () => {
    const tripId = crypto.randomUUID();
    const destinationId = crypto.randomUUID();
    const uploadedPath = `${tripId}/${destinationId}/asset-paris.jpg`;
    const upload = vi.fn(async () => ({ data: { path: uploadedPath }, error: null }));
    const remove = vi.fn(async () => ({ data: [], error: null }));
    const mediaInsert = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn(async () => ({
          data: null,
          error: { message: 'metadata insert failed' },
        })),
      })),
    }));
    const destinationOwnerFilter = vi.fn(async () => ({ data: [], error: null }));
    const destinationFilter = vi.fn(() => ({ is: destinationOwnerFilter }));
    const tripFilter = vi.fn(() => ({ eq: destinationFilter }));
    const supabase = {
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: crypto.randomUUID() } },
          error: null,
        })),
      },
      storage: {
        from: vi.fn(() => ({
          upload,
          remove,
        })),
      },
      from: vi.fn((tableName: string) => {
        if (tableName === 'trips') {
          return createTripsTableMock([
            { id: tripId, owner_user_id: crypto.randomUUID(), name: 'Example trip' },
          ]);
        }

        if (tableName === 'media_assets') {
          return {
            select: vi.fn(() => ({ eq: tripFilter })),
            insert: mediaInsert,
          };
        }

        throw new Error(`Unexpected table ${tableName}`);
      }),
    };
    const repository = createSupabaseTripRepository(supabase as never, tripId);

    await expect(repository.uploadDestinationMedia({
      destinationId,
      file: new File(['image-data'], 'Paris.JPG', { type: 'image/jpeg' }),
    })).rejects.toThrow('metadata insert failed');

    expect(upload).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith([uploadedPath]);
  });

  it('removes destination media metadata and storage when signed URL creation fails after upload', async () => {
    const tripId = crypto.randomUUID();
    const destinationId = crypto.randomUUID();
    const mediaAssetId = crypto.randomUUID();
    const uploadedPath = `${tripId}/${destinationId}/asset-paris.jpg`;
    const upload = vi.fn(async () => ({ data: { path: uploadedPath }, error: null }));
    const remove = vi.fn(async () => ({ data: [], error: null }));
    const createSignedUrl = vi.fn(async () => ({
      data: null,
      error: { message: 'signed url failed' },
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
    const destinationOwnerFilter = vi.fn(async () => ({ data: [], error: null }));
    const destinationFilter = vi.fn(() => ({ is: destinationOwnerFilter }));
    const tripFilter = vi.fn(() => ({ eq: destinationFilter }));
    const deleteActivityOwnerFilter = vi.fn(async () => ({ error: null }));
    const deleteMediaIdFilter = vi.fn(() => ({ is: deleteActivityOwnerFilter }));
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
        from: vi.fn(() => ({
          upload,
          remove,
          createSignedUrl,
        })),
      },
      from: vi.fn((tableName: string) => {
        if (tableName === 'trips') {
          return createTripsTableMock([
            { id: tripId, owner_user_id: crypto.randomUUID(), name: 'Example trip' },
          ]);
        }

        if (tableName === 'media_assets') {
          return {
            select: vi.fn(() => ({ eq: tripFilter })),
            insert: mediaInsert,
            delete: deleteRows,
          };
        }

        throw new Error(`Unexpected table ${tableName}`);
      }),
    };
    const repository = createSupabaseTripRepository(supabase as never, tripId);

    await expect(repository.uploadDestinationMedia({
      destinationId,
      file: new File(['image-data'], 'Paris.JPG', { type: 'image/jpeg' }),
    })).rejects.toThrow('signed url failed');

    expect(deleteTripFilter).toHaveBeenCalledWith('trip_id', tripId);
    expect(deleteMediaIdFilter).toHaveBeenCalledWith('id', mediaAssetId);
    expect(deleteActivityOwnerFilter).toHaveBeenCalledWith('activity_id', null);
    expect(remove).toHaveBeenCalledWith([uploadedPath]);
  });

  it('imports destination media from a web image result and returns signed media URLs', async () => {
    const tripId = crypto.randomUUID();
    const destinationId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const mediaAssetId = crypto.randomUUID();
    const result = {
      id: 'image-result-1',
      title: 'Paris mural',
      sourceName: 'Example Source',
      sourceUrl: 'https://example.com/paris-mural',
      thumbnailUrl: 'https://images.example.com/paris-mural-thumb.jpg',
      imageUrl: 'https://images.example.com/paris-mural.jpg',
    };
    const row = {
      id: mediaAssetId,
      trip_id: tripId,
      destination_id: destinationId,
      activity_id: null,
      bucket_id: 'trip-media',
      object_path: `${tripId}/${destinationId}/imported-paris-mural.jpg`,
      caption: 'Paris mural',
      credit: 'Example Source',
      sort_order: 0,
      content_type: 'image/jpeg',
      size_bytes: 2048,
      uploaded_by: userId,
      created_at: '2026-06-29T12:00:00.000Z',
      updated_at: '2026-06-29T12:00:00.000Z',
    };
    const fetcher = vi.fn(async () => Response.json({ mediaAsset: row }));
    const createSignedUrl = vi.fn(async (_path: string, _expiresIn: number, options?: { transform?: { width: number } }) => ({
      data: { signedUrl: `https://signed.example/imported-${options?.transform?.width ?? 'original'}.jpg` },
      error: null,
    }));
    const supabase = {
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: userId } },
          error: null,
        })),
        getSession: vi.fn(async () => ({
          data: { session: { access_token: 'session-access-token' } },
          error: null,
        })),
      },
      storage: {
        from: vi.fn(() => ({ createSignedUrl })),
      },
      from: vi.fn((tableName: string) => {
        if (tableName === 'trips') {
          return createTripsTableMock([
            { id: tripId, owner_user_id: userId, name: 'Example trip' },
          ]);
        }

        throw new Error(`Unexpected table ${tableName}`);
      }),
    };
    const repository = createSupabaseTripRepository(supabase as never, tripId, {
      importImageFunctionUrl: 'https://project.supabase.co/functions/v1/import-image',
      publishableKey: 'publishable-key',
      fetcher,
    });

    await expect(repository.importDestinationMediaFromSearch({
      destinationId,
      result,
    })).resolves.toEqual(
      expect.objectContaining({
        id: mediaAssetId,
        url: 'https://signed.example/imported-original.jpg',
        thumbnailUrl: 'https://signed.example/imported-320.jpg',
        previewUrl: 'https://signed.example/imported-900.jpg',
        fullUrl: 'https://signed.example/imported-2200.jpg',
        caption: 'Paris mural',
        credit: 'Example Source',
        sortOrder: 0,
      }),
    );
    expect(fetcher).toHaveBeenCalledWith('https://project.supabase.co/functions/v1/import-image', {
      method: 'POST',
      headers: {
        apikey: 'publishable-key',
        Authorization: 'Bearer session-access-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ tripId, destinationId, result }),
    });
    expect(supabase.storage.from).toHaveBeenCalledWith('trip-media');
  });

  it('imports activity media from a web image result and returns signed media URLs', async () => {
    const tripId = crypto.randomUUID();
    const destinationId = crypto.randomUUID();
    const activityId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const mediaAssetId = crypto.randomUUID();
    const result = {
      id: 'image-result-1',
      title: 'Louvre Pyramid',
      sourceName: 'Example Source',
      sourceUrl: 'https://example.com/louvre-pyramid',
      thumbnailUrl: 'https://images.example.com/louvre-pyramid-thumb.jpg',
      imageUrl: 'https://images.example.com/louvre-pyramid.jpg',
    };
    const row = {
      id: mediaAssetId,
      trip_id: tripId,
      destination_id: destinationId,
      activity_id: activityId,
      bucket_id: 'trip-media',
      object_path: `${tripId}/${destinationId}/${activityId}/imported-louvre-pyramid.jpg`,
      caption: 'Louvre Pyramid',
      credit: 'Example Source',
      sort_order: 0,
      content_type: 'image/jpeg',
      size_bytes: 2048,
      uploaded_by: userId,
      created_at: '2026-06-29T12:00:00.000Z',
      updated_at: '2026-06-29T12:00:00.000Z',
    };
    const fetcher = vi.fn(async () => Response.json({ mediaAsset: row }));
    const createSignedUrl = vi.fn(async (_path: string, _expiresIn: number, options?: { transform?: { width: number } }) => ({
      data: { signedUrl: `https://signed.example/imported-${options?.transform?.width ?? 'original'}.jpg` },
      error: null,
    }));
    const supabase = {
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: userId } },
          error: null,
        })),
        getSession: vi.fn(async () => ({
          data: { session: { access_token: 'session-access-token' } },
          error: null,
        })),
      },
      storage: {
        from: vi.fn(() => ({ createSignedUrl })),
      },
      from: vi.fn((tableName: string) => {
        if (tableName === 'trips') {
          return createTripsTableMock([
            { id: tripId, owner_user_id: userId, name: 'Example trip' },
          ]);
        }

        throw new Error(`Unexpected table ${tableName}`);
      }),
    };
    const repository = createSupabaseTripRepository(supabase as never, tripId, {
      importImageFunctionUrl: 'https://project.supabase.co/functions/v1/import-image',
      publishableKey: 'publishable-key',
      fetcher,
    });

    await expect(repository.importActivityMediaFromSearch({
      destinationId,
      activityId,
      result,
    })).resolves.toEqual(
      expect.objectContaining({
        id: mediaAssetId,
        url: 'https://signed.example/imported-original.jpg',
        thumbnailUrl: 'https://signed.example/imported-320.jpg',
        previewUrl: 'https://signed.example/imported-900.jpg',
        fullUrl: 'https://signed.example/imported-2200.jpg',
        caption: 'Louvre Pyramid',
        credit: 'Example Source',
        sortOrder: 0,
      }),
    );
    expect(fetcher).toHaveBeenCalledWith('https://project.supabase.co/functions/v1/import-image', {
      method: 'POST',
      headers: {
        apikey: 'publishable-key',
        Authorization: 'Bearer session-access-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ tripId, destinationId, activityId, result }),
    });
    expect(supabase.storage.from).toHaveBeenCalledWith('trip-media');
  });

  it('surfaces import-image JSON error bodies over generic Edge Function messages', async () => {
    const tripId = crypto.randomUUID();
    const destinationId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const result = {
      id: 'image-result-1',
      title: 'Paris mural',
      sourceName: 'Example Source',
      sourceUrl: 'https://example.com/paris-mural',
      thumbnailUrl: 'https://images.example.com/paris-mural-thumb.jpg',
      imageUrl: 'https://images.example.com/paris-mural.jpg',
    };
    const fetcher = vi.fn(async () => Response.json(
      { error: 'Selected image is too large.' },
      { status: 400 },
    ));
    const supabase = {
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: userId } },
          error: null,
        })),
        getSession: vi.fn(async () => ({
          data: { session: { access_token: 'session-access-token' } },
          error: null,
        })),
      },
      from: vi.fn((tableName: string) => {
        if (tableName === 'trips') {
          return createTripsTableMock([
            { id: tripId, owner_user_id: userId, name: 'Example trip' },
          ]);
        }

        throw new Error(`Unexpected table ${tableName}`);
      }),
    };
    const repository = createSupabaseTripRepository(supabase as never, tripId, {
      importImageFunctionUrl: 'https://project.supabase.co/functions/v1/import-image',
      publishableKey: 'publishable-key',
      fetcher,
    });

    await expect(repository.importDestinationMediaFromSearch({
      destinationId,
      result,
    })).rejects.toThrow('Selected image is too large.');
    expect(fetcher).toHaveBeenCalledWith('https://project.supabase.co/functions/v1/import-image', {
      method: 'POST',
      headers: {
        apikey: 'publishable-key',
        Authorization: 'Bearer session-access-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ tripId, destinationId, result }),
    });
  });

  it('uses the image import fallback when the function error has no readable message', async () => {
    const tripId = crypto.randomUUID();
    const destinationId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const result = {
      id: 'image-result-1',
      title: 'Paris mural',
      sourceName: 'Example Source',
      sourceUrl: 'https://example.com/paris-mural',
      thumbnailUrl: 'https://images.example.com/paris-mural-thumb.jpg',
      imageUrl: 'https://images.example.com/paris-mural.jpg',
    };
    const fetcher = vi.fn(async () => new Response('not json', {
      status: 500,
      headers: { 'content-type': 'text/plain' },
    }));
    const supabase = {
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: userId } },
          error: null,
        })),
        getSession: vi.fn(async () => ({
          data: { session: { access_token: 'session-access-token' } },
          error: null,
        })),
      },
      from: vi.fn((tableName: string) => {
        if (tableName === 'trips') {
          return createTripsTableMock([
            { id: tripId, owner_user_id: userId, name: 'Example trip' },
          ]);
        }

        throw new Error(`Unexpected table ${tableName}`);
      }),
    };
    const repository = createSupabaseTripRepository(supabase as never, tripId, {
      importImageFunctionUrl: 'https://project.supabase.co/functions/v1/import-image',
      publishableKey: 'publishable-key',
      fetcher,
    });

    await expect(repository.importDestinationMediaFromSearch({
      destinationId,
      result,
    })).rejects.toThrow('Unable to import image.');
  });

  it('lists destination media with signed URLs', async () => {
    const tripId = crypto.randomUUID();
    const destinationId = crypto.randomUUID();
    const activityId = crypto.randomUUID();
    const rows = [
      {
        id: crypto.randomUUID(),
        trip_id: tripId,
        destination_id: destinationId,
        activity_id: null,
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
        activity_id: null,
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
    const createSignedUrl = vi.fn(async (_path: string, _expiresIn: number, options?: { transform?: { width: number } }) => ({
      data: { signedUrl: `https://signed.example/asset-${options?.transform?.width ?? 'original'}.webp` },
      error: null,
    }));
    const mediaOrderBy = vi.fn(async () => ({ data: rows, error: null }));
    const mediaSortOrderBy = vi.fn(() => ({ order: mediaOrderBy }));
    const activityOwnerFilter = vi.fn(() => ({ order: mediaSortOrderBy }));
    const destinationFilter = vi.fn(() => ({ is: activityOwnerFilter }));
    const tripFilter = vi.fn(() => ({ eq: destinationFilter }));
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
            { id: tripId, owner_user_id: crypto.randomUUID(), name: 'Example trip' },
          ]);
        }

        if (tableName === 'media_assets') {
          return {
            select: vi.fn(() => ({ eq: tripFilter })),
          };
        }

        throw new Error(`Unexpected table ${tableName}`);
      }),
    };
    const repository = createSupabaseTripRepository(supabase as never, tripId);

    expect(mediaAssetFromSupabaseRow(rows[0], 'https://signed.example/asset.webp')).toEqual(
      expect.objectContaining({
        id: rows[0].id,
        url: 'https://signed.example/asset.webp',
        thumbnailUrl: 'https://signed.example/asset.webp',
        previewUrl: 'https://signed.example/asset.webp',
        fullUrl: 'https://signed.example/asset.webp',
        sortOrder: rows[0].sort_order,
      }),
    );

    expect(
      mediaAssetFromSupabaseRow(
        { ...rows[0], activity_id: activityId },
        'https://signed.example/activity-asset.webp',
      ),
    ).toEqual(
      expect.objectContaining({
        id: rows[0].id,
        url: 'https://signed.example/activity-asset.webp',
        sortOrder: rows[0].sort_order,
      }),
    );

    await expect(repository.listDestinationMedia(destinationId)).resolves.toEqual([
      expect.objectContaining({
        id: rows[0].id,
        url: 'https://signed.example/asset-original.webp',
        thumbnailUrl: 'https://signed.example/asset-320.webp',
        previewUrl: 'https://signed.example/asset-900.webp',
        fullUrl: 'https://signed.example/asset-2200.webp',
        sortOrder: rows[0].sort_order,
      }),
      expect.objectContaining({
        id: rows[1].id,
        url: 'https://signed.example/asset-original.webp',
        thumbnailUrl: 'https://signed.example/asset-320.webp',
        previewUrl: 'https://signed.example/asset-900.webp',
        fullUrl: 'https://signed.example/asset-2200.webp',
        sortOrder: rows[1].sort_order,
      }),
    ]);
    expect(tripFilter).toHaveBeenCalledWith('trip_id', tripId);
    expect(destinationFilter).toHaveBeenCalledWith('destination_id', destinationId);
    expect(activityOwnerFilter).toHaveBeenCalledWith('activity_id', null);
    expect(mediaSortOrderBy).toHaveBeenCalledWith('sort_order', { ascending: true });
    expect(mediaOrderBy).toHaveBeenCalledWith('created_at', { ascending: true });
    expect(createSignedUrl).toHaveBeenNthCalledWith(1, rows[0].object_path, 60 * 60);
    expect(createSignedUrl).toHaveBeenNthCalledWith(2, rows[0].object_path, 60 * 60, {
      transform: mediaImageVariants.thumbnail,
    });
    expect(createSignedUrl).toHaveBeenNthCalledWith(3, rows[0].object_path, 60 * 60, {
      transform: mediaImageVariants.preview,
    });
    expect(createSignedUrl).toHaveBeenNthCalledWith(4, rows[0].object_path, 60 * 60, {
      transform: mediaImageVariants.full,
    });
    expect(createSignedUrl).toHaveBeenNthCalledWith(5, rows[1].object_path, 60 * 60);
    expect(createSignedUrl).toHaveBeenNthCalledWith(6, rows[1].object_path, 60 * 60, {
      transform: mediaImageVariants.thumbnail,
    });
    expect(createSignedUrl).toHaveBeenNthCalledWith(7, rows[1].object_path, 60 * 60, {
      transform: mediaImageVariants.preview,
    });
    expect(createSignedUrl).toHaveBeenNthCalledWith(8, rows[1].object_path, 60 * 60, {
      transform: mediaImageVariants.full,
    });
  });

  it('skips stale destination media rows when the storage object is missing', async () => {
    const tripId = crypto.randomUUID();
    const destinationId = crypto.randomUUID();
    const missingRow = {
      id: crypto.randomUUID(),
      trip_id: tripId,
      destination_id: destinationId,
      activity_id: null,
      bucket_id: 'trip-media',
      object_path: `${tripId}/${destinationId}/missing.webp`,
      caption: 'Missing image',
      credit: '',
      sort_order: 0,
      content_type: 'image/webp',
      size_bytes: 1200,
      uploaded_by: crypto.randomUUID(),
      created_at: '2026-06-29T12:00:00.000Z',
      updated_at: '2026-06-29T12:00:00.000Z',
    };
    const availableRow = {
      ...missingRow,
      id: crypto.randomUUID(),
      object_path: `${tripId}/${destinationId}/available.webp`,
      caption: 'Available image',
      sort_order: 1,
    };
    const createSignedUrl = vi.fn(async (path: string, _expiresIn: number, options?: { transform?: { width: number } }) => {
      if (path === missingRow.object_path) {
        return { data: null, error: { message: 'Object not found' } };
      }

      return {
        data: { signedUrl: `https://signed.example/${options?.transform?.width ?? 'original'}.webp` },
        error: null,
      };
    });
    const mediaOrderBy = vi.fn(async () => ({ data: [missingRow, availableRow], error: null }));
    const mediaSortOrderBy = vi.fn(() => ({ order: mediaOrderBy }));
    const activityOwnerFilter = vi.fn(() => ({ order: mediaSortOrderBy }));
    const destinationFilter = vi.fn(() => ({ is: activityOwnerFilter }));
    const tripFilter = vi.fn(() => ({ eq: destinationFilter }));
    const supabase = {
      storage: {
        from: vi.fn(() => ({ createSignedUrl })),
      },
      from: vi.fn((tableName: string) => {
        if (tableName === 'media_assets') {
          return {
            select: vi.fn(() => ({ eq: tripFilter })),
          };
        }

        throw new Error(`Unexpected table ${tableName}`);
      }),
    };
    const repository = createSupabaseTripRepository(supabase as never, tripId);

    await expect(repository.listDestinationMedia(destinationId)).resolves.toEqual([
      expect.objectContaining({
        id: availableRow.id,
        url: 'https://signed.example/original.webp',
        thumbnailUrl: 'https://signed.example/320.webp',
        previewUrl: 'https://signed.example/900.webp',
        fullUrl: 'https://signed.example/2200.webp',
      }),
    ]);
  });

  it('uploads activity media under the activity owner and records metadata', async () => {
    const tripId = crypto.randomUUID();
    const destinationId = crypto.randomUUID();
    const activityId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const mediaAssetId = crypto.randomUUID();
    const uploadedPath = `${tripId}/${destinationId}/${activityId}/asset-louvre.jpg`;
    const upload = vi.fn(async () => ({ data: { path: uploadedPath }, error: null }));
    const createSignedUrl = vi.fn(async () => ({
      data: { signedUrl: 'https://signed.example/louvre.jpg' },
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
    const activityMediaFilter = vi.fn(async () => ({ data: [], error: null }));
    const tripFilter = vi.fn(() => ({ eq: activityMediaFilter }));
    const validateActivitySingle = vi.fn(async () => ({ data: { id: activityId }, error: null }));
    const validateActivityIdFilter = vi.fn(() => ({ single: validateActivitySingle }));
    const validateDestinationFilter = vi.fn(() => ({ eq: validateActivityIdFilter }));
    const validateTripFilter = vi.fn(() => ({ eq: validateDestinationFilter }));
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
            { id: tripId, owner_user_id: userId, name: 'Example trip' },
          ]);
        }

        if (tableName === 'activities') {
          return {
            select: vi.fn(() => ({ eq: validateTripFilter })),
          };
        }

        if (tableName === 'media_assets') {
          return {
            select: vi.fn(() => ({ eq: tripFilter })),
            insert: mediaInsert,
          };
        }

        throw new Error(`Unexpected table ${tableName}`);
      }),
    };
    const repository = createSupabaseTripRepository(supabase as never, tripId);
    const file = new File(['image-data'], 'Louvre.JPG', { type: 'image/jpeg' });

    await expect(repository.uploadActivityMedia({
      destinationId,
      activityId,
      file,
      caption: 'Winged Victory',
      credit: 'Example photographer',
    })).resolves.toEqual(expect.objectContaining({
      id: mediaAssetId,
      url: 'https://signed.example/louvre.jpg',
      caption: 'Winged Victory',
      credit: 'Example photographer',
    }));

    expect(upload).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^${tripId}/${destinationId}/${activityId}/.+-louvre\\.jpg$`)),
      file,
      expect.objectContaining({ contentType: 'image/jpeg', upsert: false }),
    );
    expect(validateTripFilter).toHaveBeenCalledWith('trip_id', tripId);
    expect(validateDestinationFilter).toHaveBeenCalledWith('destination_id', destinationId);
    expect(validateActivityIdFilter).toHaveBeenCalledWith('id', activityId);
    expect(mediaInsert).toHaveBeenCalledWith(expect.objectContaining({
      trip_id: tripId,
      destination_id: destinationId,
      activity_id: activityId,
      bucket_id: 'trip-media',
      sort_order: 0,
    }));
  });

  it('does not upload activity media when the activity does not belong to the destination', async () => {
    const tripId = crypto.randomUUID();
    const destinationId = crypto.randomUUID();
    const activityId = crypto.randomUUID();
    const upload = vi.fn();
    const validateActivitySingle = vi.fn(async () => ({
      data: null,
      error: { message: 'Activity not found.' },
    }));
    const validateActivityIdFilter = vi.fn(() => ({ single: validateActivitySingle }));
    const validateDestinationFilter = vi.fn(() => ({ eq: validateActivityIdFilter }));
    const validateTripFilter = vi.fn(() => ({ eq: validateDestinationFilter }));
    const supabase = {
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: crypto.randomUUID() } },
          error: null,
        })),
      },
      storage: {
        from: vi.fn(() => ({ upload })),
      },
      from: vi.fn((tableName: string) => {
        if (tableName === 'trips') {
          return createTripsTableMock([
            { id: tripId, owner_user_id: crypto.randomUUID(), name: 'Example trip' },
          ]);
        }

        if (tableName === 'activities') {
          return {
            select: vi.fn(() => ({ eq: validateTripFilter })),
          };
        }

        throw new Error(`Unexpected table ${tableName}`);
      }),
    };
    const repository = createSupabaseTripRepository(supabase as never, tripId);

    await expect(repository.uploadActivityMedia({
      destinationId,
      activityId,
      file: new File(['image-data'], 'Louvre.JPG', { type: 'image/jpeg' }),
    })).rejects.toThrow('Activity not found.');

    expect(validateTripFilter).toHaveBeenCalledWith('trip_id', tripId);
    expect(validateDestinationFilter).toHaveBeenCalledWith('destination_id', destinationId);
    expect(validateActivityIdFilter).toHaveBeenCalledWith('id', activityId);
    expect(upload).not.toHaveBeenCalled();
  });

  it('removes an uploaded activity media object when metadata insertion fails', async () => {
    const tripId = crypto.randomUUID();
    const destinationId = crypto.randomUUID();
    const activityId = crypto.randomUUID();
    const uploadedPath = `${tripId}/${destinationId}/${activityId}/asset-louvre.jpg`;
    const upload = vi.fn(async () => ({ data: { path: uploadedPath }, error: null }));
    const remove = vi.fn(async () => ({ data: [], error: null }));
    const mediaInsert = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn(async () => ({
          data: null,
          error: { message: 'metadata insert failed' },
        })),
      })),
    }));
    const activityMediaFilter = vi.fn(async () => ({ data: [], error: null }));
    const tripFilter = vi.fn(() => ({ eq: activityMediaFilter }));
    const validateActivitySingle = vi.fn(async () => ({ data: { id: activityId }, error: null }));
    const validateActivityIdFilter = vi.fn(() => ({ single: validateActivitySingle }));
    const validateDestinationFilter = vi.fn(() => ({ eq: validateActivityIdFilter }));
    const validateTripFilter = vi.fn(() => ({ eq: validateDestinationFilter }));
    const supabase = {
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: crypto.randomUUID() } },
          error: null,
        })),
      },
      storage: {
        from: vi.fn(() => ({
          upload,
          remove,
        })),
      },
      from: vi.fn((tableName: string) => {
        if (tableName === 'trips') {
          return createTripsTableMock([
            { id: tripId, owner_user_id: crypto.randomUUID(), name: 'Example trip' },
          ]);
        }

        if (tableName === 'activities') {
          return {
            select: vi.fn(() => ({ eq: validateTripFilter })),
          };
        }

        if (tableName === 'media_assets') {
          return {
            select: vi.fn(() => ({ eq: tripFilter })),
            insert: mediaInsert,
          };
        }

        throw new Error(`Unexpected table ${tableName}`);
      }),
    };
    const repository = createSupabaseTripRepository(supabase as never, tripId);

    await expect(repository.uploadActivityMedia({
      destinationId,
      activityId,
      file: new File(['image-data'], 'Louvre.JPG', { type: 'image/jpeg' }),
    })).rejects.toThrow('metadata insert failed');

    expect(upload).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith([uploadedPath]);
  });

  it('retries activity media metadata insert with a later sort order after a duplicate', async () => {
    const tripId = crypto.randomUUID();
    const destinationId = crypto.randomUUID();
    const activityId = crypto.randomUUID();
    const mediaAssetId = crypto.randomUUID();
    const uploadedPath = `${tripId}/${destinationId}/${activityId}/asset-louvre.jpg`;
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
    const remove = vi.fn(async () => ({ data: [], error: null }));
    const createSignedUrl = vi.fn(async () => ({
      data: { signedUrl: 'https://signed.example/louvre.jpg' },
      error: null,
    }));
    const mediaInsert = vi
      .fn()
      .mockImplementationOnce(() => ({
        select: vi.fn(() => ({
          single: vi.fn(async () => ({
            data: null,
            error: {
              message:
                'duplicate key value violates unique constraint "media_assets_activity_owned_sort_order_key"',
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
    const validateActivitySingle = vi.fn(async () => ({ data: { id: activityId }, error: null }));
    const validateActivityIdFilter = vi.fn(() => ({ single: validateActivitySingle }));
    const validateDestinationFilter = vi.fn(() => ({ eq: validateActivityIdFilter }));
    const validateTripFilter = vi.fn(() => ({ eq: validateDestinationFilter }));
    const supabase = {
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: crypto.randomUUID() } },
          error: null,
        })),
      },
      storage: {
        from: vi.fn(() => ({
          upload,
          remove,
          createSignedUrl,
        })),
      },
      from: vi.fn((tableName: string) => {
        if (tableName === 'trips') {
          return createTripsTableMock([
            { id: tripId, owner_user_id: crypto.randomUUID(), name: 'Example trip' },
          ]);
        }

        if (tableName === 'activities') {
          return {
            select: vi.fn(() => ({ eq: validateTripFilter })),
          };
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
    const repository = createSupabaseTripRepository(supabase as never, tripId);

    await expect(repository.uploadActivityMedia({
      destinationId,
      activityId,
      file: new File(['image-data'], 'Louvre.JPG', { type: 'image/jpeg' }),
    })).resolves.toEqual(expect.objectContaining({
      id: mediaAssetId,
      sortOrder: 4,
    }));

    expect(upload).toHaveBeenCalledTimes(1);
    expect(mediaSelect).toHaveBeenCalledTimes(2);
    expect(mediaInsert).toHaveBeenNthCalledWith(1, expect.objectContaining({ sort_order: 3 }));
    expect(mediaInsert).toHaveBeenNthCalledWith(2, expect.objectContaining({ sort_order: 4 }));
    expect(remove).not.toHaveBeenCalled();
  });

  it('lists activity media filtered by active trip and activity owner', async () => {
    const tripId = crypto.randomUUID();
    const destinationId = crypto.randomUUID();
    const activityId = crypto.randomUUID();
    const rows = [
      {
        id: crypto.randomUUID(),
        trip_id: tripId,
        destination_id: destinationId,
        activity_id: activityId,
        bucket_id: 'trip-media',
        object_path: `${tripId}/${destinationId}/${activityId}/asset.webp`,
        caption: 'Louvre',
        credit: '',
        sort_order: 0,
        content_type: 'image/webp',
        size_bytes: 1200,
        uploaded_by: crypto.randomUUID(),
        created_at: '2026-06-29T12:05:00.000Z',
        updated_at: '2026-06-29T12:05:00.000Z',
      },
    ];
    const createSignedUrl = vi.fn(async () => ({
      data: { signedUrl: 'https://signed.example/activity.webp' },
      error: null,
    }));
    const createdOrder = vi.fn(async () => ({ data: rows, error: null }));
    const sortOrder = vi.fn(() => ({ order: createdOrder }));
    const activityFilter = vi.fn(() => ({ order: sortOrder }));
    const tripFilter = vi.fn(() => ({ eq: activityFilter }));
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
            { id: tripId, owner_user_id: crypto.randomUUID(), name: 'Example trip' },
          ]);
        }

        if (tableName === 'media_assets') {
          return {
            select: vi.fn(() => ({ eq: tripFilter })),
          };
        }

        throw new Error(`Unexpected table ${tableName}`);
      }),
    };
    const repository = createSupabaseTripRepository(supabase as never, tripId);

    await expect(repository.listActivityMedia(activityId)).resolves.toEqual([
      expect.objectContaining({
        id: rows[0].id,
        url: 'https://signed.example/activity.webp',
        sortOrder: 0,
      }),
    ]);
    expect(tripFilter).toHaveBeenCalledWith('trip_id', tripId);
    expect(activityFilter).toHaveBeenCalledWith('activity_id', activityId);
    expect(sortOrder).toHaveBeenCalledWith('sort_order', { ascending: true });
    expect(createdOrder).toHaveBeenCalledWith('created_at', { ascending: true });
  });

  it('lists destination media rollups with destination media first and activity media by activity order', async () => {
    const tripId = crypto.randomUUID();
    const destinationId = crypto.randomUUID();
    const bakeryId = crypto.randomUUID();
    const louvreId = crypto.randomUUID();
    const destinationRows = [
      {
        id: crypto.randomUUID(),
        trip_id: tripId,
        destination_id: destinationId,
        activity_id: null,
        bucket_id: 'trip-media',
        object_path: `${tripId}/${destinationId}/stop.webp`,
        caption: 'Paris',
        credit: '',
        sort_order: 0,
        content_type: 'image/webp',
        size_bytes: 1200,
        uploaded_by: crypto.randomUUID(),
        created_at: '2026-06-29T12:00:00.000Z',
        updated_at: '2026-06-29T12:00:00.000Z',
      },
    ];
    const activityRows = [
      {
        id: crypto.randomUUID(),
        trip_id: tripId,
        destination_id: destinationId,
        activity_id: louvreId,
        bucket_id: 'trip-media',
        object_path: `${tripId}/${destinationId}/${louvreId}/louvre.webp`,
        caption: 'Louvre',
        credit: '',
        sort_order: 0,
        content_type: 'image/webp',
        size_bytes: 1200,
        uploaded_by: crypto.randomUUID(),
        created_at: '2026-06-29T12:02:00.000Z',
        updated_at: '2026-06-29T12:02:00.000Z',
      },
      {
        id: crypto.randomUUID(),
        trip_id: tripId,
        destination_id: destinationId,
        activity_id: bakeryId,
        bucket_id: 'trip-media',
        object_path: `${tripId}/${destinationId}/${bakeryId}/bakery.webp`,
        caption: 'Bakery',
        credit: '',
        sort_order: 0,
        content_type: 'image/webp',
        size_bytes: 1200,
        uploaded_by: crypto.randomUUID(),
        created_at: '2026-06-29T12:01:00.000Z',
        updated_at: '2026-06-29T12:01:00.000Z',
      },
    ];
    const activityRowsByOwner = [
      {
        id: bakeryId,
        trip_id: tripId,
        destination_id: destinationId,
        activity_order: 0,
        title: 'Bakery crawl',
        description: '',
        category: 'food',
        status: 'planned',
        priority: 'medium',
        location: null,
        links: [],
        notes: '',
        tags: [],
        created_at: '2026-06-29T12:00:00.000Z',
        updated_at: '2026-06-29T12:00:00.000Z',
      },
      {
        id: louvreId,
        trip_id: tripId,
        destination_id: destinationId,
        activity_order: 1,
        title: 'Louvre',
        description: '',
        category: 'sightseeing',
        status: 'planned',
        priority: 'medium',
        location: null,
        links: [],
        notes: '',
        tags: [],
        created_at: '2026-06-29T12:00:00.000Z',
        updated_at: '2026-06-29T12:00:00.000Z',
      },
    ];
    const createSignedUrl = vi.fn(async () => ({
      data: { signedUrl: 'https://signed.example/rollup.webp' },
      error: null,
    }));
    const destinationMediaCreatedOrder = vi.fn(async () => ({ data: destinationRows, error: null }));
    const destinationMediaSortOrder = vi.fn(() => ({ order: destinationMediaCreatedOrder }));
    const destinationMediaActivityFilter = vi.fn(() => ({ order: destinationMediaSortOrder }));
    const destinationMediaDestinationFilter = vi.fn(() => ({ is: destinationMediaActivityFilter }));
    const destinationMediaTripFilter = vi.fn(() => ({ eq: destinationMediaDestinationFilter }));
    const activityMediaCreatedOrder = vi.fn(async () => ({ data: activityRows, error: null }));
    const activityMediaSortOrder = vi.fn(() => ({ order: activityMediaCreatedOrder }));
    const activityMediaOwnerFilter = vi.fn(() => ({ order: activityMediaSortOrder }));
    const activityMediaDestinationFilter = vi.fn(() => ({ not: activityMediaOwnerFilter }));
    const activityMediaTripFilter = vi.fn(() => ({ eq: activityMediaDestinationFilter }));
    const activitiesCreatedOrder = vi.fn(async () => ({ data: activityRowsByOwner, error: null }));
    const activitiesOrder = vi.fn(() => ({ order: activitiesCreatedOrder }));
    const activitiesDestinationFilter = vi.fn(() => ({ order: activitiesOrder }));
    const activitiesTripFilter = vi.fn(() => ({ eq: activitiesDestinationFilter }));
    let mediaSelectCalls = 0;
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
            { id: tripId, owner_user_id: crypto.randomUUID(), name: 'Example trip' },
          ]);
        }

        if (tableName === 'activities') {
          return {
            select: vi.fn(() => ({ eq: activitiesTripFilter })),
          };
        }

        if (tableName === 'media_assets') {
          return {
            select: vi.fn(() => {
              mediaSelectCalls += 1;
              return mediaSelectCalls === 1
                ? { eq: destinationMediaTripFilter }
                : { eq: activityMediaTripFilter };
            }),
          };
        }

        throw new Error(`Unexpected table ${tableName}`);
      }),
    };
    const repository = createSupabaseTripRepository(supabase as never, tripId);

    const rollup = await repository.listDestinationMediaRollup(destinationId);

    expect(rollup.map((item) => ({
      ownerType: item.ownerType,
      activityTitle: item.activityTitle,
      canReorder: item.canReorderInStopCarousel,
    }))).toEqual([
      { ownerType: 'destination', activityTitle: undefined, canReorder: true },
      { ownerType: 'activity', activityTitle: 'Bakery crawl', canReorder: false },
      { ownerType: 'activity', activityTitle: 'Louvre', canReorder: false },
    ]);
    expect(activityMediaOwnerFilter).toHaveBeenCalledWith('activity_id', 'is', null);
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
    const activityOwnerFilter = vi.fn(() => ({ select: updateSelect }));
    const mediaIdFilter = vi.fn(() => ({ is: activityOwnerFilter }));
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
            { id: tripId, owner_user_id: crypto.randomUUID(), name: 'Example trip' },
          ]);
        }

        if (tableName === 'media_assets') {
          return { update };
        }

        throw new Error(`Unexpected table ${tableName}`);
      }),
    };
    const repository = createSupabaseTripRepository(supabase as never, tripId);

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
    expect(activityOwnerFilter).toHaveBeenCalledWith('activity_id', null);
    expect(createSignedUrl).toHaveBeenCalledWith(row.object_path, 60 * 60);
  });

  it('updates activity media caption and credit only for activity-owned rows', async () => {
    const tripId = crypto.randomUUID();
    const mediaId = crypto.randomUUID();
    const row = {
      id: mediaId,
      trip_id: tripId,
      destination_id: crypto.randomUUID(),
      activity_id: crypto.randomUUID(),
      bucket_id: 'trip-media',
      object_path: `${tripId}/destination/activity/asset.webp`,
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
      data: { signedUrl: 'https://signed.example/activity-updated.webp' },
      error: null,
    }));
    const updateSingle = vi.fn(async () => ({ data: row, error: null }));
    const updateSelect = vi.fn(() => ({ single: updateSingle }));
    const activityOwnerFilter = vi.fn(() => ({ select: updateSelect }));
    const mediaIdFilter = vi.fn(() => ({ not: activityOwnerFilter }));
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
            { id: tripId, owner_user_id: crypto.randomUUID(), name: 'Example trip' },
          ]);
        }

        if (tableName === 'media_assets') {
          return { update };
        }

        throw new Error(`Unexpected table ${tableName}`);
      }),
    };
    const repository = createSupabaseTripRepository(supabase as never, tripId);

    await expect(repository.updateActivityMedia(mediaId, {
      caption: 'New caption',
      credit: 'Example photographer',
    })).resolves.toEqual(expect.objectContaining({
      id: mediaId,
      url: 'https://signed.example/activity-updated.webp',
      caption: 'New caption',
      credit: 'Example photographer',
      sortOrder: 2,
    }));

    expect(update).toHaveBeenCalledWith({ caption: 'New caption', credit: 'Example photographer' });
    expect(tripFilter).toHaveBeenCalledWith('trip_id', tripId);
    expect(mediaIdFilter).toHaveBeenCalledWith('id', mediaId);
    expect(activityOwnerFilter).toHaveBeenCalledWith('activity_id', 'is', null);
    expect(createSignedUrl).toHaveBeenCalledWith(row.object_path, 60 * 60);
  });

  it('deletes destination media metadata before best-effort storage cleanup', async () => {
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
    const loadActivityOwnerFilter = vi.fn(() => ({ single: loadSingle }));
    const loadMediaIdFilter = vi.fn(() => ({ is: loadActivityOwnerFilter }));
    const loadTripFilter = vi.fn(() => ({ eq: loadMediaIdFilter }));
    const deleteActivityOwnerFilter = vi.fn(async () => {
      calls.push('metadata');
      return { error: null };
    });
    const deleteMediaIdFilter = vi.fn(() => ({ is: deleteActivityOwnerFilter }));
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
            { id: tripId, owner_user_id: crypto.randomUUID(), name: 'Example trip' },
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
    const repository = createSupabaseTripRepository(supabase as never, tripId);

    await repository.deleteDestinationMedia(mediaId);

    expect(loadTripFilter).toHaveBeenCalledWith('trip_id', tripId);
    expect(loadMediaIdFilter).toHaveBeenCalledWith('id', mediaId);
    expect(loadActivityOwnerFilter).toHaveBeenCalledWith('activity_id', null);
    expect(deleteTripFilter).toHaveBeenCalledWith('trip_id', tripId);
    expect(deleteMediaIdFilter).toHaveBeenCalledWith('id', mediaId);
    expect(deleteActivityOwnerFilter).toHaveBeenCalledWith('activity_id', null);
    expect(remove).toHaveBeenCalledWith([row.object_path]);
    expect(calls).toEqual(['metadata', 'storage']);
  });

  it('deletes activity media metadata before best-effort storage cleanup for activity-owned rows', async () => {
    const tripId = crypto.randomUUID();
    const mediaId = crypto.randomUUID();
    const row = {
      id: mediaId,
      trip_id: tripId,
      destination_id: crypto.randomUUID(),
      activity_id: crypto.randomUUID(),
      bucket_id: 'trip-media',
      object_path: `${tripId}/destination/activity/asset.webp`,
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
    const loadActivityOwnerFilter = vi.fn(() => ({ single: loadSingle }));
    const loadMediaIdFilter = vi.fn(() => ({ not: loadActivityOwnerFilter }));
    const loadTripFilter = vi.fn(() => ({ eq: loadMediaIdFilter }));
    const deleteActivityOwnerFilter = vi.fn(async () => {
      calls.push('metadata');
      return { error: null };
    });
    const deleteMediaIdFilter = vi.fn(() => ({ not: deleteActivityOwnerFilter }));
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
            { id: tripId, owner_user_id: crypto.randomUUID(), name: 'Example trip' },
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
    const repository = createSupabaseTripRepository(supabase as never, tripId);

    await repository.deleteActivityMedia(mediaId);

    expect(loadTripFilter).toHaveBeenCalledWith('trip_id', tripId);
    expect(loadMediaIdFilter).toHaveBeenCalledWith('id', mediaId);
    expect(loadActivityOwnerFilter).toHaveBeenCalledWith('activity_id', 'is', null);
    expect(deleteTripFilter).toHaveBeenCalledWith('trip_id', tripId);
    expect(deleteMediaIdFilter).toHaveBeenCalledWith('id', mediaId);
    expect(deleteActivityOwnerFilter).toHaveBeenCalledWith('activity_id', 'is', null);
    expect(remove).toHaveBeenCalledWith([row.object_path]);
    expect(calls).toEqual(['metadata', 'storage']);
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
      .mockImplementationOnce(() => ({
        is: vi.fn(async () => ({ data: rows, error: null })),
      }))
      .mockImplementationOnce(() => ({
        is: vi.fn(() => ({ order: selectOrderFirst })),
      }));
    const selectTripFilter = vi.fn(() => ({ eq: selectDestinationFilter }));
    const update = vi.fn((patch: { sort_order: number }) => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          is: vi.fn(() => ({
            eq: vi.fn(async (_column: string, id: string) => {
              updates.push({ id, sortOrder: patch.sort_order });
              return { error: null };
            }),
          })),
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
            { id: tripId, owner_user_id: crypto.randomUUID(), name: 'Example trip' },
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
    const repository = createSupabaseTripRepository(supabase as never, tripId);
    const { reorderDestinationMedia } = repository;

    await expect(reorderDestinationMedia(destinationId, [secondId, firstId])).resolves.toEqual([
      expect.objectContaining({ id: secondId, sortOrder: 0 }),
      expect.objectContaining({ id: firstId, sortOrder: 1 }),
    ]);

    expect(updates).toEqual([
      { id: secondId, sortOrder: 5 },
      { id: firstId, sortOrder: 4 },
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
            { id: tripId, owner_user_id: crypto.randomUUID(), name: 'Example trip' },
          ]);
        }

        if (tableName === 'media_assets') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  is: vi.fn(async () => ({ data: rows, error: null })),
                })),
              })),
            })),
            update,
          };
        }

        throw new Error(`Unexpected table ${tableName}`);
      }),
    };
    const repository = createSupabaseTripRepository(supabase as never, tripId);

    await expect(repository.reorderDestinationMedia(destinationId, [firstId, foreignId]))
      .rejects.toThrow(`missing ${secondId}`);

    expect(update).not.toHaveBeenCalled();
  });

  it('reorders activity media with collision-safe temporary sort orders', async () => {
    const tripId = crypto.randomUUID();
    const activityId = crypto.randomUUID();
    const firstId = crypto.randomUUID();
    const secondId = crypto.randomUUID();
    const rows = [
      {
        id: firstId,
        trip_id: tripId,
        destination_id: crypto.randomUUID(),
        activity_id: activityId,
        bucket_id: 'trip-media',
        object_path: `${tripId}/destination/${activityId}/first.webp`,
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
        destination_id: crypto.randomUUID(),
        activity_id: activityId,
        bucket_id: 'trip-media',
        object_path: `${tripId}/destination/${activityId}/second.webp`,
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
    const updates: Array<{ id: string; sortOrder: number; filters: Array<{ column: string; value: string }> }> = [];
    const createSignedUrl = vi.fn(async () => ({
      data: { signedUrl: 'https://signed.example/activity-reordered.webp' },
      error: null,
    }));
    const validateSingle = vi.fn(async () => ({ data: { id: activityId }, error: null }));
    const validateIdFilter = vi.fn(() => ({ single: validateSingle }));
    const validateTripFilter = vi.fn(() => ({ eq: validateIdFilter }));
    const mediaSelectActivityFilter = vi
      .fn()
      .mockImplementationOnce(async () => ({ data: rows, error: null }))
      .mockImplementationOnce(() => ({
        order: vi.fn(() => ({
          order: vi.fn(async () => ({ data: reorderedRows, error: null })),
        })),
      }));
    const mediaSelectTripFilter = vi.fn(() => ({ eq: mediaSelectActivityFilter }));
    const update = vi.fn((patch: { sort_order: number }) => {
      const filters: Array<{ column: string; value: string }> = [];

      return {
        eq: vi.fn((column: string, value: string) => {
          filters.push({ column, value });
          if (filters.length === 3) {
            updates.push({ id: value, sortOrder: patch.sort_order, filters: [...filters] });
            return Promise.resolve({ error: null });
          }
          return {
            eq: vi.fn((nextColumn: string, nextValue: string) => {
              filters.push({ column: nextColumn, value: nextValue });
              if (filters.length === 3) {
                updates.push({ id: nextValue, sortOrder: patch.sort_order, filters: [...filters] });
                return Promise.resolve({ error: null });
              }
              return {
                eq: vi.fn(async (finalColumn: string, finalValue: string) => {
                  filters.push({ column: finalColumn, value: finalValue });
                  updates.push({ id: finalValue, sortOrder: patch.sort_order, filters: [...filters] });
                  return { error: null };
                }),
              };
            }),
          };
        }),
      };
    });
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
            { id: tripId, owner_user_id: crypto.randomUUID(), name: 'Example trip' },
          ]);
        }

        if (tableName === 'activities') {
          return {
            select: vi.fn(() => ({ eq: validateTripFilter })),
          };
        }

        if (tableName === 'media_assets') {
          return {
            select: vi.fn(() => ({ eq: mediaSelectTripFilter })),
            update,
          };
        }

        throw new Error(`Unexpected table ${tableName}`);
      }),
    };
    const repository = createSupabaseTripRepository(supabase as never, tripId);

    await expect(repository.reorderActivityMedia(activityId, [secondId, firstId])).resolves.toEqual([
      expect.objectContaining({ id: secondId, sortOrder: 0 }),
      expect.objectContaining({ id: firstId, sortOrder: 1 }),
    ]);

    expect(validateTripFilter).toHaveBeenCalledWith('trip_id', tripId);
    expect(validateIdFilter).toHaveBeenCalledWith('id', activityId);
    expect(mediaSelectTripFilter).toHaveBeenCalledWith('trip_id', tripId);
    expect(mediaSelectActivityFilter).toHaveBeenCalledWith('activity_id', activityId);
    expect(updates).toEqual([
      {
        id: secondId,
        sortOrder: 5,
        filters: [
          { column: 'trip_id', value: tripId },
          { column: 'activity_id', value: activityId },
          { column: 'id', value: secondId },
        ],
      },
      {
        id: firstId,
        sortOrder: 4,
        filters: [
          { column: 'trip_id', value: tripId },
          { column: 'activity_id', value: activityId },
          { column: 'id', value: firstId },
        ],
      },
      {
        id: secondId,
        sortOrder: 0,
        filters: [
          { column: 'trip_id', value: tripId },
          { column: 'activity_id', value: activityId },
          { column: 'id', value: secondId },
        ],
      },
      {
        id: firstId,
        sortOrder: 1,
        filters: [
          { column: 'trip_id', value: tripId },
          { column: 'activity_id', value: activityId },
          { column: 'id', value: firstId },
        ],
      },
    ]);
  });

  it('rejects activity media reorders for missing activities before updating rows', async () => {
    const tripId = crypto.randomUUID();
    const activityId = crypto.randomUUID();
    const update = vi.fn();
    const validateSingle = vi.fn(async () => ({
      data: null,
      error: { message: 'Activity not found.' },
    }));
    const validateIdFilter = vi.fn(() => ({ single: validateSingle }));
    const validateTripFilter = vi.fn(() => ({ eq: validateIdFilter }));
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
            { id: tripId, owner_user_id: crypto.randomUUID(), name: 'Example trip' },
          ]);
        }

        if (tableName === 'activities') {
          return {
            select: vi.fn(() => ({ eq: validateTripFilter })),
          };
        }

        if (tableName === 'media_assets') {
          return { update };
        }

        throw new Error(`Unexpected table ${tableName}`);
      }),
    };
    const repository = createSupabaseTripRepository(supabase as never, tripId);

    await expect(repository.reorderActivityMedia(activityId, []))
      .rejects.toThrow('Activity not found.');

    expect(validateTripFilter).toHaveBeenCalledWith('trip_id', tripId);
    expect(validateIdFilter).toHaveBeenCalledWith('id', activityId);
    expect(update).not.toHaveBeenCalled();
  });
});
