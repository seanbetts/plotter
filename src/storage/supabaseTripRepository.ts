import type { SupabaseClient } from '@supabase/supabase-js';
import type { LineString } from 'geojson';
import type {
  Destination,
  DestinationLocation,
  DestinationStatus,
  MediaItem,
  Priority,
  RouteLeg,
  RouteLegStatus,
  RouteLegType,
} from '../domain/types';
import type { TripRepository } from './tripRepository';

type SupabaseDestinationRow = {
  id: string;
  trip_id: string;
  name: string;
  country_region: string;
  lat: number;
  lng: number;
  location: DestinationLocation;
  stop_order: number;
  status: DestinationStatus;
  priority: Priority;
  timing: Destination['timing'];
  why: Destination['why'];
  media: Destination['media'];
  research: Destination['research'];
  activities: Destination['activities'];
  route_context: Destination['routeContext'];
  tags: string[];
  created_at: string;
  updated_at: string;
};

type SupabaseRouteLegRow = {
  id: string;
  trip_id: string;
  origin_destination_id: string;
  target_destination_id: string;
  type: RouteLegType;
  status: RouteLegStatus;
  distance_km: number | null;
  travel_time_hours: number | null;
  geometry: LineString | null;
  provider: string | null;
  profile: string | null;
  route_key: string | null;
  calculated_at: string | null;
  error: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
};

type SupabaseTripRow = {
  id: string;
  owner_user_id: string;
  name: string;
};

type SupabaseMediaAssetRow = {
  id: string;
  trip_id: string;
  destination_id: string | null;
  bucket_id: string;
  object_path: string;
  caption: string;
  credit: string;
  content_type: string | null;
  size_bytes: number | null;
  uploaded_by: string;
  created_at: string;
  updated_at: string;
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

function createStorageObjectName(fileName: string) {
  const normalizedFileName = fileName.trim().toLowerCase();
  const extensionMatch = normalizedFileName.match(/\.([a-z0-9]+)$/);
  const extension = extensionMatch ? `.${extensionMatch[1]}` : '';
  const baseName = normalizedFileName
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72) || 'image';

  return `${crypto.randomUUID()}-${baseName}${extension}`;
}

export function destinationToSupabaseRow(destination: Destination, tripId: string): SupabaseDestinationRow {
  return {
    id: destination.id,
    trip_id: tripId,
    name: destination.name,
    country_region: destination.countryRegion,
    lat: destination.coordinates.lat,
    lng: destination.coordinates.lng,
    location: destination.location,
    stop_order: destination.order,
    status: destination.status,
    priority: destination.priority,
    timing: destination.timing,
    why: destination.why,
    media: destination.media,
    research: destination.research,
    activities: destination.activities,
    route_context: destination.routeContext,
    tags: destination.tags,
    created_at: destination.createdAt,
    updated_at: destination.updatedAt,
  };
}

export function destinationFromSupabaseRow(row: SupabaseDestinationRow): Destination {
  return {
    id: row.id,
    name: row.name,
    countryRegion: row.country_region,
    coordinates: {
      lat: row.lat,
      lng: row.lng,
    },
    location: row.location,
    order: row.stop_order,
    status: row.status,
    priority: row.priority,
    timing: row.timing,
    why: row.why,
    media: row.media,
    research: row.research,
    activities: row.activities,
    routeContext: row.route_context,
    tags: row.tags,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function routeLegToSupabaseRow(routeLeg: RouteLeg, tripId: string): SupabaseRouteLegRow {
  return {
    id: routeLeg.id,
    trip_id: tripId,
    origin_destination_id: routeLeg.originDestinationId,
    target_destination_id: routeLeg.targetDestinationId,
    type: routeLeg.type,
    status: routeLeg.status,
    distance_km: routeLeg.distanceKm ?? null,
    travel_time_hours: routeLeg.travelTimeHours ?? null,
    geometry: routeLeg.geometry ?? null,
    provider: routeLeg.provider ?? null,
    profile: routeLeg.profile ?? null,
    route_key: routeLeg.routeKey ?? null,
    calculated_at: routeLeg.calculatedAt ?? null,
    error: routeLeg.error ?? null,
    notes: routeLeg.notes,
    created_at: routeLeg.createdAt,
    updated_at: routeLeg.updatedAt,
  };
}

export function routeLegFromSupabaseRow(row: SupabaseRouteLegRow): RouteLeg {
  return {
    id: row.id,
    originDestinationId: row.origin_destination_id,
    targetDestinationId: row.target_destination_id,
    type: row.type,
    status: row.status,
    distanceKm: row.distance_km ?? undefined,
    travelTimeHours: row.travel_time_hours ?? undefined,
    geometry: row.geometry ?? undefined,
    provider: row.provider ?? undefined,
    profile: row.profile ?? undefined,
    routeKey: row.route_key ?? undefined,
    calculatedAt: row.calculated_at ?? undefined,
    error: row.error ?? undefined,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mediaAssetFromSupabaseRow(row: SupabaseMediaAssetRow, signedUrl: string): MediaItem {
  return {
    id: row.id,
    url: signedUrl,
    caption: row.caption,
    credit: row.credit,
    bucketId: row.bucket_id,
    objectPath: row.object_path,
    contentType: row.content_type ?? undefined,
    sizeBytes: row.size_bytes ?? undefined,
    uploadedAt: row.created_at,
  };
}

export function createSupabaseTripRepository(supabase: SupabaseClient): TripRepository {
  let activeTripId: string | null = null;

  async function getActiveTripId() {
    if (activeTripId) return activeTripId;

    const userResponse = await supabase.auth.getUser();
    const user = userResponse.data.user;
    if (userResponse.error || !user) {
      throw new Error(userResponse.error?.message || 'Sign in before syncing trip data.');
    }

    const existingTrip = assertNoSupabaseError<SupabaseTripRow[]>(
      await supabase
        .from('trips')
        .select('id, owner_user_id, name')
        .order('created_at', { ascending: true })
        .limit(1),
      'Unable to load trips.',
    )[0];

    if (existingTrip) {
      activeTripId = existingTrip.id;
      return activeTripId;
    }

    const createdTrip = assertNoSupabaseError<SupabaseTripRow>(
      await supabase
        .from('trips')
        .insert({
          owner_user_id: user.id,
          name: 'World tour',
        })
        .select('id, owner_user_id, name')
        .single(),
      'Unable to create a trip.',
    );

    activeTripId = createdTrip.id;
    return activeTripId;
  }

  return {
    async listDestinations() {
      const tripId = await getActiveTripId();
      const rows = assertNoSupabaseError<SupabaseDestinationRow[]>(
        await supabase
          .from('destinations')
          .select('*')
          .eq('trip_id', tripId)
          .order('stop_order', { ascending: true })
          .order('created_at', { ascending: true }),
        'Unable to load destinations.',
      );

      return rows.map(destinationFromSupabaseRow);
    },

    async saveDestination(destination) {
      const tripId = await getActiveTripId();
      const row = destinationToSupabaseRow(destination, tripId);

      assertSupabaseWriteSucceeded(
        await supabase.from('destinations').upsert(row, { onConflict: 'trip_id,id' }),
        'Unable to save destination.',
      );
    },

    async deleteDestination(destinationId) {
      const tripId = await getActiveTripId();

      assertSupabaseWriteSucceeded(
        await supabase
          .from('destinations')
          .delete()
          .eq('trip_id', tripId)
          .eq('id', destinationId),
        'Unable to delete destination.',
      );
    },

    async listDestinationMedia(destinationId) {
      const tripId = await getActiveTripId();
      const rows = assertNoSupabaseError<SupabaseMediaAssetRow[]>(
        await supabase
          .from('media_assets')
          .select('*')
          .eq('trip_id', tripId)
          .eq('destination_id', destinationId)
          .order('created_at', { ascending: true }),
        'Unable to load destination media.',
      );

      return Promise.all(
        rows.map(async (row) => {
          const signedUrlResponse = await supabase.storage
            .from(row.bucket_id)
            .createSignedUrl(row.object_path, 60 * 60);
          const signedUrl = assertNoSupabaseError(
            signedUrlResponse,
            'Unable to create media URL.',
          ).signedUrl;

          return mediaAssetFromSupabaseRow(row, signedUrl);
        }),
      );
    },

    async uploadDestinationMedia(input) {
      const tripId = await getActiveTripId();
      const userResponse = await supabase.auth.getUser();
      const user = userResponse.data.user;
      if (userResponse.error || !user) {
        throw new Error(userResponse.error?.message || 'Sign in before uploading media.');
      }

      const bucketId = 'trip-media';
      const objectPath = `${tripId}/${input.destinationId}/${createStorageObjectName(input.file.name)}`;
      const uploadResponse = await supabase.storage
        .from(bucketId)
        .upload(objectPath, input.file, {
          contentType: input.file.type || undefined,
          upsert: false,
        });

      assertNoSupabaseError(uploadResponse, 'Unable to upload destination media.');

      const row = assertNoSupabaseError<SupabaseMediaAssetRow>(
        await supabase
          .from('media_assets')
          .insert({
            trip_id: tripId,
            destination_id: input.destinationId,
            bucket_id: bucketId,
            object_path: uploadResponse.data?.path ?? objectPath,
            caption: input.caption ?? '',
            credit: input.credit ?? '',
            content_type: input.file.type || null,
            size_bytes: input.file.size,
            uploaded_by: user.id,
          })
          .select('*')
          .single(),
        'Unable to save media metadata.',
      );
      const signedUrlResponse = await supabase.storage
        .from(bucketId)
        .createSignedUrl(row.object_path, 60 * 60);
      const signedUrl = assertNoSupabaseError(
        signedUrlResponse,
        'Unable to create media URL.',
      ).signedUrl;

      return mediaAssetFromSupabaseRow(row, signedUrl);
    },

    async listRouteLegs() {
      const tripId = await getActiveTripId();
      const rows = assertNoSupabaseError<SupabaseRouteLegRow[]>(
        await supabase
          .from('route_legs')
          .select('*')
          .eq('trip_id', tripId)
          .order('updated_at', { ascending: true }),
        'Unable to load route legs.',
      );

      return rows.map(routeLegFromSupabaseRow);
    },

    async saveRouteLeg(routeLeg) {
      const tripId = await getActiveTripId();
      const row = routeLegToSupabaseRow(routeLeg, tripId);

      assertSupabaseWriteSucceeded(
        await supabase.from('route_legs').upsert(row, { onConflict: 'trip_id,id' }),
        'Unable to save route leg.',
      );
    },

    async deleteRouteLeg(routeLegId) {
      const tripId = await getActiveTripId();

      assertSupabaseWriteSucceeded(
        await supabase
          .from('route_legs')
          .delete()
          .eq('trip_id', tripId)
          .eq('id', routeLegId),
        'Unable to delete route leg.',
      );
    },

    async replaceTripData(snapshot) {
      const tripId = await getActiveTripId();

      const destinationRows = snapshot.destinations.map((destination) =>
        destinationToSupabaseRow(destination, tripId),
      );
      const routeLegRows = snapshot.routeLegs.map((routeLeg) =>
        routeLegToSupabaseRow(routeLeg, tripId),
      );

      assertSupabaseWriteSucceeded(
        await supabase.from('route_legs').delete().eq('trip_id', tripId),
        'Unable to clear route legs.',
      );
      assertSupabaseWriteSucceeded(
        await supabase.from('destinations').delete().eq('trip_id', tripId),
        'Unable to clear destinations.',
      );

      if (destinationRows.length > 0) {
        assertSupabaseWriteSucceeded(
          await supabase.from('destinations').insert(destinationRows),
          'Unable to replace destinations.',
        );
      }

      if (routeLegRows.length > 0) {
        assertSupabaseWriteSucceeded(
          await supabase.from('route_legs').insert(routeLegRows),
          'Unable to replace route legs.',
        );
      }
    },
  };
}
