import type { SupabaseClient } from '@supabase/supabase-js';
import type { TripRoutingVehicle, VehiclePreset } from '../domain/types';
import { resolveVehiclePreset } from '../domain/vehiclePresets';
import type { TripDb } from './tripDb';

export type TripSummary = {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  routingVehicle: TripRoutingVehicle;
};

export type TripDirectoryRepository = {
  listTrips(): Promise<TripSummary[]>;
  createTrip(input: { name: string; routingVehicle?: TripRoutingVehicle }): Promise<TripSummary>;
  updateTrip(tripId: string, patch: { name?: string; description?: string; routingVehicle?: TripRoutingVehicle }): Promise<TripSummary>;
  deleteTrip(tripId: string): Promise<void>;
};

type SupabaseTripRow = {
  id: string;
  owner_user_id: string;
  name: string;
  description: string | null;
  vehicle_preset?: VehiclePreset;
  vehicle_profile?: TripRoutingVehicle['profile'];
  vehicle_type?: TripRoutingVehicle['vehicleType'] | null;
  vehicle_restrictions?: TripRoutingVehicle['restrictions'];
  created_at: string;
  updated_at: string;
};

type SupabaseMediaReferenceRow = {
  bucket_id: string;
  object_path: string;
};

type SupabaseResponse<T> = {
  data: T | null;
  error: { message: string } | null;
};

type SupabaseWriteResponse = {
  error: { message: string } | null;
};

function assertNoSupabaseError<T>(response: SupabaseResponse<T>, fallbackMessage: string): T {
  if (response.error) {
    throw new Error(response.error.message || fallbackMessage);
  }

  if (response.data === null) {
    throw new Error(fallbackMessage);
  }

  return response.data;
}

function assertSupabaseWriteSucceeded(response: SupabaseWriteResponse, fallbackMessage: string) {
  if (response.error) {
    throw new Error(response.error.message || fallbackMessage);
  }
}

function tripFromSupabaseRow(row: SupabaseTripRow): TripSummary {
  const defaultVehicle = resolveVehiclePreset('standard');
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    routingVehicle: {
      preset: row.vehicle_preset ?? defaultVehicle.preset,
      profile: row.vehicle_profile ?? defaultVehicle.profile,
      ...(row.vehicle_type ? { vehicleType: row.vehicle_type } : {}),
      restrictions: row.vehicle_restrictions ?? defaultVehicle.restrictions,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const tripColumns = 'id, owner_user_id, name, description, vehicle_preset, vehicle_profile, vehicle_type, vehicle_restrictions, created_at, updated_at';

function routingVehicleToSupabaseColumns(routingVehicle: TripRoutingVehicle) {
  return {
    vehicle_preset: routingVehicle.preset,
    vehicle_profile: routingVehicle.profile,
    vehicle_type: routingVehicle.vehicleType ?? null,
    vehicle_restrictions: routingVehicle.restrictions,
  };
}

function createTimestamp() {
  return new Date().toISOString();
}

export function createSupabaseTripDirectoryRepository(
  supabase: SupabaseClient,
): TripDirectoryRepository {
  return {
    async listTrips() {
      const rows = assertNoSupabaseError<SupabaseTripRow[]>(
        await supabase
          .from('trips')
          .select(tripColumns)
          .order('updated_at', { ascending: false })
          .order('created_at', { ascending: false }),
        'Unable to load trips.',
      );

      return rows.map(tripFromSupabaseRow);
    },

    async createTrip(input) {
      const userResponse = await supabase.auth.getUser();
      const user = userResponse.data.user;
      if (userResponse.error || !user) {
        throw new Error(userResponse.error?.message || 'Sign in before creating a trip.');
      }

      const routingVehicle = input.routingVehicle ?? resolveVehiclePreset('standard');
      const row = assertNoSupabaseError<SupabaseTripRow>(
        await supabase
          .from('trips')
          .insert({
            owner_user_id: user.id,
            name: input.name,
            description: '',
            ...routingVehicleToSupabaseColumns(routingVehicle),
          })
          .select(tripColumns)
          .single(),
        'Unable to create trip.',
      );

      return tripFromSupabaseRow(row);
    },

    async updateTrip(tripId, patch) {
      const { routingVehicle, ...tripPatch } = patch;
      const row = assertNoSupabaseError<SupabaseTripRow>(
        await supabase
          .from('trips')
          .update({
            ...tripPatch,
            ...(routingVehicle ? routingVehicleToSupabaseColumns(routingVehicle) : {}),
          })
          .eq('id', tripId)
          .select(tripColumns)
          .single(),
        'Unable to update trip.',
      );

      return tripFromSupabaseRow(row);
    },

    async deleteTrip(tripId) {
      const mediaRows = assertNoSupabaseError<SupabaseMediaReferenceRow[]>(
        await supabase
          .from('media_assets')
          .select('bucket_id, object_path')
          .eq('trip_id', tripId),
        'Unable to load trip media before deletion.',
      );
      const pathsByBucket = new Map<string, string[]>();

      for (const row of mediaRows) {
        pathsByBucket.set(row.bucket_id, [
          ...(pathsByBucket.get(row.bucket_id) ?? []),
          row.object_path,
        ]);
      }

      for (const [bucketId, objectPaths] of pathsByBucket) {
        assertSupabaseWriteSucceeded(
          await supabase.storage.from(bucketId).remove(objectPaths),
          'Unable to remove trip media.',
        );
      }

      assertSupabaseWriteSucceeded(
        await supabase.from('trips').delete().eq('id', tripId),
        'Unable to delete trip.',
      );
    },
  };
}

export function createLocalTripDirectoryRepository(db: TripDb): TripDirectoryRepository {
  return {
    async listTrips() {
      return (await db.trips.toArray()).sort(
        (left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) ||
          right.createdAt.localeCompare(left.createdAt),
      );
    },

    async createTrip(input) {
      const timestamp = createTimestamp();
      const trip: TripSummary = {
        id: crypto.randomUUID(),
        name: input.name,
        description: '',
        routingVehicle: input.routingVehicle ?? resolveVehiclePreset('standard'),
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      await db.trips.put(trip);
      return trip;
    },

    async updateTrip(tripId, patch) {
      const existing = await db.trips.get(tripId);
      if (!existing) {
        throw new Error('Trip not found.');
      }

      const updated: TripSummary = {
        ...existing,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.routingVehicle !== undefined ? { routingVehicle: patch.routingVehicle } : {}),
        updatedAt: createTimestamp(),
      };

      await db.trips.put(updated);
      return updated;
    },

    async deleteTrip(tripId) {
      await db.transaction(
        'rw',
        db.trips,
        db.destinations,
        db.routeLegs,
        db.activities,
        db.activityMedia,
        async () => {
          await db.trips.delete(tripId);
          await db.destinations.where('tripId').equals(tripId).delete();
          await db.routeLegs.where('tripId').equals(tripId).delete();
          await db.activities.where('tripId').equals(tripId).delete();
          await db.activityMedia.where('tripId').equals(tripId).delete();
        },
      );
    },
  };
}
