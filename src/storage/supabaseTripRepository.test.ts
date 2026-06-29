import { describe, expect, it, vi } from 'vitest';
import { createDestination } from '../domain/destinations';
import { createRouteLeg, createStraightLineGeometry } from '../domain/routeLegs';
import {
  destinationFromSupabaseRow,
  destinationToSupabaseRow,
  routeLegFromSupabaseRow,
  routeLegToSupabaseRow,
  createSupabaseTripRepository,
} from './supabaseTripRepository';

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
          return {
            select: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(async () => ({
                  data: [{ id: tripId, owner_user_id: crypto.randomUUID(), name: 'World tour' }],
                  error: null,
                })),
              })),
            })),
          };
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
});
