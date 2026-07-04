import type { SupabaseClient } from '@supabase/supabase-js';
import type { LineString } from 'geojson';
import { createActivity, reorderActivities as reorderActivityModels } from '../domain/activities';
import type {
  Activity,
  Destination,
  DestinationLocation,
  DestinationStatus,
  MediaItem,
  MediaRollupItem,
  Priority,
  RouteLeg,
  RouteLegStatus,
  RouteLegType,
} from '../domain/types';
import { mediaImageVariants } from '../media/imageOptimization';
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

type SupabaseActivityRow = {
  id: string;
  trip_id: string;
  destination_id: string;
  activity_order: number;
  title: string;
  description: string;
  category: Activity['category'];
  status: Activity['status'];
  priority: Activity['priority'];
  location: Activity['location'] | null;
  links: Activity['links'];
  notes: string;
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
  created_at?: string;
};

type SupabaseTripReferenceRow = {
  trip_id: string;
};

type SupabaseMediaAssetRow = {
  id: string;
  trip_id: string;
  destination_id: string | null;
  activity_id: string | null;
  bucket_id: string;
  object_path: string;
  caption: string;
  credit: string;
  sort_order: number;
  content_type: string | null;
  size_bytes: number | null;
  uploaded_by: string;
  created_at: string;
  updated_at: string;
};

type SupabaseMediaSignedUrls = {
  originalUrl: string;
  thumbnailUrl: string;
  previewUrl: string;
  fullUrl: string;
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

function isDestinationMediaSortOrderConflict(errorMessage: string | undefined) {
  if (!errorMessage) return false;

  return (
    errorMessage.includes('media_assets_trip_destination_sort_order_key') ||
    errorMessage.includes('media_assets_destination_owned_sort_order_key') ||
    errorMessage.includes('duplicate key value')
  );
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

function createMediaOrderMismatchError(currentIds: string[], orderedIds: string[], ownerLabel = 'destination') {
  const requestedIds = new Set(orderedIds);
  const missingIds = currentIds.filter((id) => !requestedIds.has(id));
  const extraIds = orderedIds.filter((id) => !currentIds.includes(id));
  const duplicateIds = orderedIds.filter((id, index) => orderedIds.indexOf(id) !== index);

  return new Error(
    `Media order must include each ${ownerLabel} media item exactly once: missing ${missingIds.join(', ') || 'none'}; extra ${extraIds.join(', ') || 'none'}; duplicate ${duplicateIds.join(', ') || 'none'}.`,
  );
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

export function activityToSupabaseRow(activity: Activity, tripId: string): SupabaseActivityRow {
  return {
    id: activity.id,
    trip_id: tripId,
    destination_id: activity.destinationId,
    activity_order: activity.order,
    title: activity.title,
    description: activity.description,
    category: activity.category,
    status: activity.status,
    priority: activity.priority,
    location: activity.location ?? null,
    links: activity.links,
    notes: activity.notes,
    tags: activity.tags,
    created_at: activity.createdAt,
    updated_at: activity.updatedAt,
  };
}

export function activityFromSupabaseRow(row: SupabaseActivityRow): Activity {
  return {
    id: row.id,
    destinationId: row.destination_id,
    order: row.activity_order,
    title: row.title,
    description: row.description,
    category: row.category,
    status: row.status,
    priority: row.priority,
    location: row.location ?? undefined,
    links: row.links,
    notes: row.notes,
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

export function mediaAssetFromSupabaseRow(
  row: SupabaseMediaAssetRow,
  signedUrls: string | SupabaseMediaSignedUrls,
): MediaItem {
  const urls = typeof signedUrls === 'string'
    ? {
        originalUrl: signedUrls,
        thumbnailUrl: signedUrls,
        previewUrl: signedUrls,
        fullUrl: signedUrls,
      }
    : signedUrls;

  return {
    id: row.id,
    url: urls.originalUrl,
    thumbnailUrl: urls.thumbnailUrl,
    previewUrl: urls.previewUrl,
    fullUrl: urls.fullUrl,
    caption: row.caption,
    credit: row.credit,
    sortOrder: row.sort_order,
    bucketId: row.bucket_id,
    objectPath: row.object_path,
    contentType: row.content_type ?? undefined,
    sizeBytes: row.size_bytes ?? undefined,
    uploadedAt: row.created_at,
  };
}

export function createSupabaseTripRepository(supabase: SupabaseClient): TripRepository {
  let activeTripId: string | null = null;

  async function chooseTripWithPlanningData(trips: SupabaseTripRow[]) {
    if (trips.length <= 1) return trips[0];

    const tripIds = trips.map((trip) => trip.id);
    const [destinationRows, routeLegRows] = await Promise.all([
      assertNoSupabaseError<SupabaseTripReferenceRow[]>(
        await supabase.from('destinations').select('trip_id').in('trip_id', tripIds),
        'Unable to load destination trip counts.',
      ),
      assertNoSupabaseError<SupabaseTripReferenceRow[]>(
        await supabase.from('route_legs').select('trip_id').in('trip_id', tripIds),
        'Unable to load route leg trip counts.',
      ),
    ]);
    const planningCountsByTripId = new Map(tripIds.map((tripId) => [tripId, 0]));

    for (const row of [...destinationRows, ...routeLegRows]) {
      planningCountsByTripId.set(
        row.trip_id,
        (planningCountsByTripId.get(row.trip_id) ?? 0) + 1,
      );
    }

    return trips.reduce((bestTrip, trip) => {
      const bestCount = planningCountsByTripId.get(bestTrip.id) ?? 0;
      const tripCount = planningCountsByTripId.get(trip.id) ?? 0;

      return tripCount > bestCount ? trip : bestTrip;
    });
  }

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
        .select('id, owner_user_id, name, created_at')
        .order('created_at', { ascending: true }),
      'Unable to load trips.',
    );
    const selectedTrip = await chooseTripWithPlanningData(existingTrip);

    if (selectedTrip) {
      activeTripId = selectedTrip.id;
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

  async function listExistingDestinationMediaSortOrders(tripId: string, destinationId: string) {
    return assertNoSupabaseError<Pick<SupabaseMediaAssetRow, 'sort_order'>[]>(
      await supabase
        .from('media_assets')
        .select('sort_order')
        .eq('trip_id', tripId)
        .eq('destination_id', destinationId)
        .is('activity_id', null),
      'Unable to load destination media order.',
    );
  }

  async function listExistingActivityMediaSortOrders(tripId: string, activityId: string) {
    return assertNoSupabaseError<Pick<SupabaseMediaAssetRow, 'sort_order'>[]>(
      await supabase
        .from('media_assets')
        .select('sort_order')
        .eq('trip_id', tripId)
        .eq('activity_id', activityId),
      'Unable to load activity media order.',
    );
  }

  async function insertDestinationMediaMetadata(input: {
    tripId: string;
    destinationId: string;
    bucketId: string;
    objectPath: string;
    caption: string;
    credit: string;
    contentType: string | null;
    sizeBytes: number;
    uploadedBy: string;
  }) {
    let existingRows = await listExistingDestinationMediaSortOrders(input.tripId, input.destinationId);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const nextSortOrder =
        existingRows.reduce((maxSortOrder, row) => Math.max(maxSortOrder, row.sort_order), -1) + 1;
      const response = await supabase
        .from('media_assets')
        .insert({
          trip_id: input.tripId,
          destination_id: input.destinationId,
          activity_id: null,
          bucket_id: input.bucketId,
          object_path: input.objectPath,
          caption: input.caption,
          credit: input.credit,
          sort_order: nextSortOrder,
          content_type: input.contentType,
          size_bytes: input.sizeBytes,
          uploaded_by: input.uploadedBy,
        })
        .select('*')
        .single();

      if (!response.error && response.data) {
        return response.data;
      }

      if (!isDestinationMediaSortOrderConflict(response.error?.message) || attempt === 2) {
        throw new Error(response.error?.message || 'Unable to save media metadata.');
      }

      existingRows = await listExistingDestinationMediaSortOrders(input.tripId, input.destinationId);
    }

    throw new Error('Unable to save media metadata.');
  }

  async function insertActivityMediaMetadata(input: {
    tripId: string;
    destinationId: string;
    activityId: string;
    bucketId: string;
    objectPath: string;
    caption: string;
    credit: string;
    contentType: string | null;
    sizeBytes: number;
    uploadedBy: string;
  }) {
    const existingRows = await listExistingActivityMediaSortOrders(input.tripId, input.activityId);
    const nextSortOrder =
      existingRows.reduce((maxSortOrder, row) => Math.max(maxSortOrder, row.sort_order), -1) + 1;

    return assertNoSupabaseError<SupabaseMediaAssetRow>(
      await supabase
        .from('media_assets')
        .insert({
          trip_id: input.tripId,
          destination_id: input.destinationId,
          activity_id: input.activityId,
          bucket_id: input.bucketId,
          object_path: input.objectPath,
          caption: input.caption,
          credit: input.credit,
          sort_order: nextSortOrder,
          content_type: input.contentType,
          size_bytes: input.sizeBytes,
          uploaded_by: input.uploadedBy,
        })
        .select('*')
        .single(),
      'Unable to save activity media metadata.',
    );
  }

  async function createSignedMediaItem(row: SupabaseMediaAssetRow) {
    const storage = supabase.storage.from(row.bucket_id);
    const [originalUrlResponse, thumbnailUrlResponse, previewUrlResponse, fullUrlResponse] = await Promise.all([
      storage.createSignedUrl(row.object_path, 60 * 60),
      storage.createSignedUrl(row.object_path, 60 * 60, { transform: mediaImageVariants.thumbnail }),
      storage.createSignedUrl(row.object_path, 60 * 60, { transform: mediaImageVariants.preview }),
      storage.createSignedUrl(row.object_path, 60 * 60, { transform: mediaImageVariants.full }),
    ]);
    const signedUrls: SupabaseMediaSignedUrls = {
      originalUrl: assertNoSupabaseError(originalUrlResponse, 'Unable to create media URL.').signedUrl,
      thumbnailUrl: assertNoSupabaseError(thumbnailUrlResponse, 'Unable to create thumbnail media URL.').signedUrl,
      previewUrl: assertNoSupabaseError(previewUrlResponse, 'Unable to create preview media URL.').signedUrl,
      fullUrl: assertNoSupabaseError(fullUrlResponse, 'Unable to create full-size media URL.').signedUrl,
    };

    return mediaAssetFromSupabaseRow(row, signedUrls);
  }

  async function loadDestinationMediaRows(tripId: string, destinationId: string) {
    return assertNoSupabaseError<SupabaseMediaAssetRow[]>(
      await supabase
        .from('media_assets')
        .select('*')
        .eq('trip_id', tripId)
        .eq('destination_id', destinationId)
        .is('activity_id', null),
      'Unable to load destination media.',
    );
  }

  async function listSignedDestinationMedia(tripId: string, destinationId: string) {
    const rows = assertNoSupabaseError<SupabaseMediaAssetRow[]>(
      await supabase
        .from('media_assets')
        .select('*')
        .eq('trip_id', tripId)
        .eq('destination_id', destinationId)
        .is('activity_id', null)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true }),
      'Unable to load destination media.',
    );

    return Promise.all(rows.map((row) => createSignedMediaItem(row)));
  }

  async function listSignedActivityMedia(tripId: string, activityId: string) {
    const rows = assertNoSupabaseError<SupabaseMediaAssetRow[]>(
      await supabase
        .from('media_assets')
        .select('*')
        .eq('trip_id', tripId)
        .eq('activity_id', activityId)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true }),
      'Unable to load activity media.',
    );

    return Promise.all(rows.map((row) => createSignedMediaItem(row)));
  }

  async function loadDestinationActivityMediaRows(tripId: string, destinationId: string) {
    const rows = assertNoSupabaseError<SupabaseMediaAssetRow[]>(
      await supabase
        .from('media_assets')
        .select('*')
        .eq('trip_id', tripId)
        .eq('destination_id', destinationId)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true }),
      'Unable to load activity media.',
    );

    return rows.filter((row) => row.activity_id);
  }

  async function listTripActivities(tripId: string, destinationId: string) {
    const rows = assertNoSupabaseError<SupabaseActivityRow[]>(
      await supabase
        .from('activities')
        .select('*')
        .eq('trip_id', tripId)
        .eq('destination_id', destinationId)
        .order('activity_order', { ascending: true })
        .order('created_at', { ascending: true }),
      'Unable to load activities.',
    );

    return rows.map(activityFromSupabaseRow);
  }

  async function updateActivityOrder(input: {
    tripId: string;
    destinationId: string;
    activityId: string;
    order: number;
  }) {
    assertSupabaseWriteSucceeded(
      await supabase
        .from('activities')
        .update({ activity_order: input.order })
        .eq('trip_id', input.tripId)
        .eq('destination_id', input.destinationId)
        .eq('id', input.activityId),
      'Unable to update activity order.',
    );
  }

  async function updateDestinationMediaSortOrder(input: {
    tripId: string;
    destinationId: string;
    mediaId: string;
    sortOrder: number;
  }) {
    assertSupabaseWriteSucceeded(
      await supabase
        .from('media_assets')
        .update({ sort_order: input.sortOrder })
        .eq('trip_id', input.tripId)
        .eq('destination_id', input.destinationId)
        .is('activity_id', null)
        .eq('id', input.mediaId),
      'Unable to update media order.',
    );
  }

  async function updateActivityMediaSortOrder(input: {
    tripId: string;
    activityId: string;
    mediaId: string;
    sortOrder: number;
  }) {
    assertSupabaseWriteSucceeded(
      await supabase
        .from('media_assets')
        .update({ sort_order: input.sortOrder })
        .eq('trip_id', input.tripId)
        .eq('activity_id', input.activityId)
        .eq('id', input.mediaId),
      'Unable to update activity media order.',
    );
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

    async listActivities(destinationId) {
      const tripId = await getActiveTripId();
      return listTripActivities(tripId, destinationId);
    },

    async createActivity(input) {
      const tripId = await getActiveTripId();
      const existingActivities = await listTripActivities(tripId, input.destinationId);
      const nextOrder =
        existingActivities.reduce((maxOrder, activity) => Math.max(maxOrder, activity.order), -1) + 1;
      const activity = createActivity({
        ...input,
        order: input.order ?? nextOrder,
      });
      const row = assertNoSupabaseError<SupabaseActivityRow>(
        await supabase
          .from('activities')
          .insert(activityToSupabaseRow(activity, tripId))
          .select('*')
          .single(),
        'Unable to create activity.',
      );

      return activityFromSupabaseRow(row);
    },

    async updateActivity(activityId, patch) {
      const tripId = await getActiveTripId();
      const rowPatch: Partial<Pick<
        SupabaseActivityRow,
        'activity_order' | 'title' | 'description' | 'category' | 'status' | 'priority' | 'location' | 'links' | 'notes' | 'tags'
      >> = {};

      if (patch.order !== undefined) rowPatch.activity_order = patch.order;
      if (patch.title !== undefined) rowPatch.title = patch.title;
      if (patch.description !== undefined) rowPatch.description = patch.description;
      if (patch.category !== undefined) rowPatch.category = patch.category;
      if (patch.status !== undefined) rowPatch.status = patch.status;
      if (patch.priority !== undefined) rowPatch.priority = patch.priority;
      if ('location' in patch) rowPatch.location = patch.location ?? null;
      if (patch.links !== undefined) rowPatch.links = patch.links;
      if (patch.notes !== undefined) rowPatch.notes = patch.notes;
      if (patch.tags !== undefined) rowPatch.tags = patch.tags;

      const row = assertNoSupabaseError<SupabaseActivityRow>(
        await supabase
          .from('activities')
          .update(rowPatch)
          .eq('trip_id', tripId)
          .eq('id', activityId)
          .select('*')
          .single(),
        'Unable to update activity.',
      );

      return activityFromSupabaseRow(row);
    },

    async deleteActivity(activityId) {
      const tripId = await getActiveTripId();

      assertSupabaseWriteSucceeded(
        await supabase
          .from('activities')
          .delete()
          .eq('trip_id', tripId)
          .eq('id', activityId),
        'Unable to delete activity.',
      );
    },

    async reorderActivities(destinationId, orderedActivityIds) {
      const tripId = await getActiveTripId();
      const currentActivities = await listTripActivities(tripId, destinationId);
      const orderedActivities = reorderActivityModels(currentActivities, orderedActivityIds);

      for (const activity of orderedActivities) {
        await updateActivityOrder({
          tripId,
          destinationId,
          activityId: activity.id,
          order: activity.order,
        });
      }

      return listTripActivities(tripId, destinationId);
    },

    async listDestinationMedia(destinationId) {
      const tripId = await getActiveTripId();
      return listSignedDestinationMedia(tripId, destinationId);
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

      const row = await insertDestinationMediaMetadata({
        tripId,
        destinationId: input.destinationId,
        bucketId,
        objectPath: uploadResponse.data?.path ?? objectPath,
        caption: input.caption ?? '',
        credit: input.credit ?? '',
        contentType: input.file.type || null,
        sizeBytes: input.file.size,
        uploadedBy: user.id,
      });
      return createSignedMediaItem(row);
    },

    async listDestinationMediaRollup(destinationId): Promise<MediaRollupItem[]> {
      const tripId = await getActiveTripId();
      const destinationMedia = await listSignedDestinationMedia(tripId, destinationId);
      const activities = await listTripActivities(tripId, destinationId);
      const activityMediaRows = await loadDestinationActivityMediaRows(tripId, destinationId);
      const activityMediaRowsByActivityId = new Map<string, SupabaseMediaAssetRow[]>();

      for (const row of activityMediaRows) {
        if (!row.activity_id) continue;
        activityMediaRowsByActivityId.set(row.activity_id, [
          ...(activityMediaRowsByActivityId.get(row.activity_id) ?? []),
          row,
        ]);
      }

      const rollup: MediaRollupItem[] = destinationMedia.map((mediaItem) => ({
        mediaItem,
        ownerType: 'destination',
        destinationId,
        canReorderInStopCarousel: true,
      }));

      for (const activity of activities) {
        const rows = activityMediaRowsByActivityId.get(activity.id) ?? [];
        const activityMedia = await Promise.all(rows.map((row) => createSignedMediaItem(row)));

        rollup.push(...activityMedia.map((mediaItem) => ({
          mediaItem,
          ownerType: 'activity' as const,
          destinationId,
          activityId: activity.id,
          activityTitle: activity.title,
          canReorderInStopCarousel: false,
        })));
      }

      return rollup;
    },

    async listActivityMedia(activityId) {
      const tripId = await getActiveTripId();
      return listSignedActivityMedia(tripId, activityId);
    },

    async uploadActivityMedia(input) {
      const tripId = await getActiveTripId();
      const userResponse = await supabase.auth.getUser();
      const user = userResponse.data.user;
      if (userResponse.error || !user) {
        throw new Error(userResponse.error?.message || 'Sign in before uploading media.');
      }

      const bucketId = 'trip-media';
      const objectPath = `${tripId}/${input.destinationId}/${input.activityId}/${createStorageObjectName(input.file.name)}`;
      const uploadResponse = await supabase.storage
        .from(bucketId)
        .upload(objectPath, input.file, {
          contentType: input.file.type || undefined,
          upsert: false,
        });

      assertNoSupabaseError(uploadResponse, 'Unable to upload activity media.');

      const row = await insertActivityMediaMetadata({
        tripId,
        destinationId: input.destinationId,
        activityId: input.activityId,
        bucketId,
        objectPath: uploadResponse.data?.path ?? objectPath,
        caption: input.caption ?? '',
        credit: input.credit ?? '',
        contentType: input.file.type || null,
        sizeBytes: input.file.size,
        uploadedBy: user.id,
      });
      return createSignedMediaItem(row);
    },

    async updateDestinationMedia(mediaId, patch) {
      const tripId = await getActiveTripId();
      const rowPatch: Pick<Partial<SupabaseMediaAssetRow>, 'caption' | 'credit'> = {};

      if (patch.caption !== undefined) {
        rowPatch.caption = patch.caption;
      }

      if (patch.credit !== undefined) {
        rowPatch.credit = patch.credit;
      }

      const row = assertNoSupabaseError<SupabaseMediaAssetRow>(
        await supabase
          .from('media_assets')
          .update(rowPatch)
          .eq('trip_id', tripId)
          .eq('id', mediaId)
          .is('activity_id', null)
          .select('*')
          .single(),
        'Unable to update destination media.',
      );

      return createSignedMediaItem(row);
    },

    async updateActivityMedia(mediaId, patch) {
      const tripId = await getActiveTripId();
      const rowPatch: Pick<Partial<SupabaseMediaAssetRow>, 'caption' | 'credit'> = {};

      if (patch.caption !== undefined) {
        rowPatch.caption = patch.caption;
      }

      if (patch.credit !== undefined) {
        rowPatch.credit = patch.credit;
      }

      const row = assertNoSupabaseError<SupabaseMediaAssetRow>(
        await supabase
          .from('media_assets')
          .update(rowPatch)
          .eq('trip_id', tripId)
          .eq('id', mediaId)
          .not('activity_id', 'is', null)
          .select('*')
          .single(),
        'Unable to update activity media.',
      );

      return createSignedMediaItem(row);
    },

    async deleteDestinationMedia(mediaId) {
      const tripId = await getActiveTripId();
      const row = assertNoSupabaseError<SupabaseMediaAssetRow>(
        await supabase
          .from('media_assets')
          .select('*')
          .eq('trip_id', tripId)
          .eq('id', mediaId)
          .is('activity_id', null)
          .single(),
        'Unable to load destination media before deletion.',
      );

      assertSupabaseWriteSucceeded(
        await supabase.storage.from(row.bucket_id).remove([row.object_path]),
        'Unable to remove destination media file.',
      );
      assertSupabaseWriteSucceeded(
        await supabase
          .from('media_assets')
          .delete()
          .eq('trip_id', tripId)
          .eq('id', mediaId)
          .is('activity_id', null),
        'Unable to delete destination media metadata.',
      );
    },

    async deleteActivityMedia(mediaId) {
      const tripId = await getActiveTripId();
      const row = assertNoSupabaseError<SupabaseMediaAssetRow>(
        await supabase
          .from('media_assets')
          .select('*')
          .eq('trip_id', tripId)
          .eq('id', mediaId)
          .not('activity_id', 'is', null)
          .single(),
        'Unable to load activity media before deletion.',
      );

      assertSupabaseWriteSucceeded(
        await supabase.storage.from(row.bucket_id).remove([row.object_path]),
        'Unable to remove activity media file.',
      );
      assertSupabaseWriteSucceeded(
        await supabase
          .from('media_assets')
          .delete()
          .eq('trip_id', tripId)
          .eq('id', mediaId)
          .not('activity_id', 'is', null),
        'Unable to delete activity media metadata.',
      );
    },

    async reorderDestinationMedia(destinationId, orderedMediaIds) {
      const tripId = await getActiveTripId();
      const rows = await loadDestinationMediaRows(tripId, destinationId);
      const currentIds = rows.map((row) => row.id);
      const requestedIds = new Set(orderedMediaIds);
      const hasDuplicateIds = requestedIds.size !== orderedMediaIds.length;
      const hasMissingIds = currentIds.some((id) => !requestedIds.has(id));
      const hasExtraIds = orderedMediaIds.some((id) => !currentIds.includes(id));

      if (hasDuplicateIds || hasMissingIds || hasExtraIds) {
        throw createMediaOrderMismatchError(currentIds, orderedMediaIds);
      }

      const minSortOrder = Math.min(0, ...rows.map((row) => row.sort_order));
      const temporarySortOrderBase = minSortOrder - orderedMediaIds.length - 1;

      for (const [index, mediaId] of orderedMediaIds.entries()) {
        await updateDestinationMediaSortOrder({
          tripId,
          destinationId,
          mediaId,
          sortOrder: temporarySortOrderBase - index,
        });
      }

      for (const [index, mediaId] of orderedMediaIds.entries()) {
        await updateDestinationMediaSortOrder({
          tripId,
          destinationId,
          mediaId,
          sortOrder: index,
        });
      }

      return listSignedDestinationMedia(tripId, destinationId);
    },

    async reorderActivityMedia(activityId, orderedMediaIds) {
      const tripId = await getActiveTripId();
      const rows = assertNoSupabaseError<SupabaseMediaAssetRow[]>(
        await supabase
          .from('media_assets')
          .select('*')
          .eq('trip_id', tripId)
          .eq('activity_id', activityId),
        'Unable to load activity media.',
      );
      const currentIds = rows.map((row) => row.id);
      const requestedIds = new Set(orderedMediaIds);
      const hasDuplicateIds = requestedIds.size !== orderedMediaIds.length;
      const hasMissingIds = currentIds.some((id) => !requestedIds.has(id));
      const hasExtraIds = orderedMediaIds.some((id) => !currentIds.includes(id));

      if (hasDuplicateIds || hasMissingIds || hasExtraIds) {
        throw createMediaOrderMismatchError(currentIds, orderedMediaIds, 'activity');
      }

      const minSortOrder = Math.min(0, ...rows.map((row) => row.sort_order));
      const temporarySortOrderBase = minSortOrder - orderedMediaIds.length - 1;

      for (const [index, mediaId] of orderedMediaIds.entries()) {
        await updateActivityMediaSortOrder({
          tripId,
          activityId,
          mediaId,
          sortOrder: temporarySortOrderBase - index,
        });
      }

      for (const [index, mediaId] of orderedMediaIds.entries()) {
        await updateActivityMediaSortOrder({
          tripId,
          activityId,
          mediaId,
          sortOrder: index,
        });
      }

      return listSignedActivityMedia(tripId, activityId);
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
      const activityRows = (snapshot.activities ?? []).map((activity) =>
        activityToSupabaseRow(activity, tripId),
      );

      assertSupabaseWriteSucceeded(
        await supabase.from('route_legs').delete().eq('trip_id', tripId),
        'Unable to clear route legs.',
      );
      assertSupabaseWriteSucceeded(
        await supabase.from('activities').delete().eq('trip_id', tripId),
        'Unable to clear activities.',
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

      if (activityRows.length > 0) {
        assertSupabaseWriteSucceeded(
          await supabase.from('activities').insert(activityRows),
          'Unable to replace activities.',
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
