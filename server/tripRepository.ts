import type { DatabaseSync } from 'node:sqlite';
import type {
  MediaPatch,
  MediaWriteResponse,
  TripMutationRequest,
  TripWriteResponse,
} from '../src/api/contracts';
import { createActivity, reorderActivities, updateActivity } from '../src/domain/activities';
import type { Activity, Destination, MediaItem, RouteLeg } from '../src/domain/types';
import {
  activityFromPersistedRow,
  activityToPersistedRow,
  destinationFromPersistedRow,
  destinationToPersistedRow,
  routeLegFromPersistedRow,
  routeLegToPersistedRow,
  type PersistedActivityRow,
  type PersistedDestinationRow,
  type PersistedRouteLegRow,
} from '../src/storage/persistedRows';
import type { TripSnapshot } from '../src/storage/revision';
import {
  normalizeActivity,
  normalizeDestination,
  normalizeRouteLeg,
} from '../src/storage/tripRepository';
import type { PlotterDatabase } from './database';
import type { AtomicMediaStore, StoredMediaObject } from './mediaStore';
import type { WriteCoordinator } from './writeCoordinator';

export type MediaSourceMetadata = {
  bucketId: string;
  objectPath: string;
  uploadedBy: string;
  createdAt?: string;
  updatedAt?: string;
};

export type CreateMediaInput = {
  bytes: ReadableStream<Uint8Array>;
  contentType: string;
  caption?: string;
  credit?: string;
  source?: MediaSourceMetadata;
};

export type RevisionedTripStore = {
  load(): Promise<TripSnapshot>;
  mutate(expectedRevision: number, mutation: TripMutationRequest): Promise<TripWriteResponse>;
  listDestinationMedia(destinationId: string): Promise<MediaItem[]>;
  listActivityMedia(activityId: string): Promise<MediaItem[]>;
  createDestinationMedia(
    expectedRevision: number,
    destinationId: string,
    input: CreateMediaInput,
  ): Promise<MediaWriteResponse>;
  createActivityMedia(
    expectedRevision: number,
    destinationId: string,
    activityId: string,
    input: CreateMediaInput,
  ): Promise<MediaWriteResponse>;
  updateDestinationMedia(
    expectedRevision: number,
    mediaId: string,
    patch: MediaPatch,
  ): Promise<MediaWriteResponse>;
  updateActivityMedia(
    expectedRevision: number,
    mediaId: string,
    patch: MediaPatch,
  ): Promise<MediaWriteResponse>;
  deleteDestinationMedia(expectedRevision: number, mediaId: string): Promise<MediaWriteResponse>;
  deleteActivityMedia(expectedRevision: number, mediaId: string): Promise<MediaWriteResponse>;
  reorderDestinationMedia(
    expectedRevision: number,
    destinationId: string,
    orderedMediaIds: string[],
  ): Promise<MediaWriteResponse>;
  reorderActivityMedia(
    expectedRevision: number,
    activityId: string,
    orderedMediaIds: string[],
  ): Promise<MediaWriteResponse>;
};

type MediaRow = {
  id: string;
  trip_id: string;
  destination_id: string;
  activity_id: string | null;
  bucket_id: string;
  object_path: string;
  caption: string;
  credit: string;
  sort_order: number;
  content_type: string | null;
  size_bytes: number | null;
  uploaded_by: string;
  relative_path: string;
  sha256: string;
  created_at: string;
  updated_at: string;
};

function parseJson<T>(value: unknown, nullable = false): T {
  if (nullable && value === null) return null as T;
  if (typeof value !== 'string') throw new Error('Stored trip data is invalid.');

  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error('Stored trip data is invalid.');
  }
}

function nextTimestamp(previous?: string): string {
  const now = new Date().toISOString();
  if (!previous || Date.parse(now) > Date.parse(previous)) return now;
  return new Date(Date.parse(previous) + 1).toISOString();
}

function mediaItemFromRow(row: MediaRow): MediaItem {
  const url = `/api/v1/media/${encodeURIComponent(row.id)}/content`;
  return {
    id: row.id,
    url,
    thumbnailUrl: url,
    previewUrl: url,
    fullUrl: url,
    caption: row.caption,
    credit: row.credit,
    sortOrder: row.sort_order,
    bucketId: row.bucket_id,
    objectPath: row.object_path,
    ...(row.content_type === null ? {} : { contentType: row.content_type }),
    ...(row.size_bytes === null ? {} : { sizeBytes: row.size_bytes }),
    uploadedAt: row.created_at,
  };
}

function destinationRowFromSqlite(row: Record<string, unknown>): PersistedDestinationRow {
  return {
    id: row.id as string,
    trip_id: row.trip_id as string,
    name: row.name as string,
    country_region: row.country_region as string,
    lat: row.lat as number,
    lng: row.lng as number,
    location: parseJson<PersistedDestinationRow['location']>(row.location),
    stop_order: row.stop_order as number,
    status: row.status as PersistedDestinationRow['status'],
    priority: row.priority as PersistedDestinationRow['priority'],
    timing: parseJson<PersistedDestinationRow['timing']>(row.timing),
    why: parseJson<PersistedDestinationRow['why']>(row.why),
    media: parseJson<PersistedDestinationRow['media']>(row.media),
    research: parseJson<PersistedDestinationRow['research']>(row.research),
    activities: parseJson<PersistedDestinationRow['activities']>(row.activities),
    route_context: parseJson<PersistedDestinationRow['route_context']>(row.route_context),
    routing_anchors: row.routing_anchors === null
      ? undefined
      : parseJson<PersistedDestinationRow['routing_anchors']>(row.routing_anchors),
    tags: parseJson<string[]>(row.tags),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

function routeLegRowFromSqlite(row: Record<string, unknown>): PersistedRouteLegRow {
  return {
    id: row.id as string,
    trip_id: row.trip_id as string,
    origin_destination_id: row.origin_destination_id as string,
    target_destination_id: row.target_destination_id as string,
    movement: row.movement as PersistedRouteLegRow['movement'],
    calculation_mode: row.calculation_mode as PersistedRouteLegRow['calculation_mode'],
    ferry_policy: row.ferry_policy as PersistedRouteLegRow['ferry_policy'],
    waypoints: row.waypoints === null
      ? undefined
      : parseJson<NonNullable<PersistedRouteLegRow['waypoints']>>(row.waypoints),
    sections: row.sections === null
      ? undefined
      : parseJson<NonNullable<PersistedRouteLegRow['sections']>>(row.sections),
    warnings: row.warnings === null
      ? undefined
      : parseJson<NonNullable<PersistedRouteLegRow['warnings']>>(row.warnings),
    status: row.status as PersistedRouteLegRow['status'],
    distance_km: row.distance_km as number | null,
    travel_time_hours: row.travel_time_hours as number | null,
    geometry: row.geometry === null
      ? null
      : parseJson<NonNullable<PersistedRouteLegRow['geometry']>>(row.geometry),
    provider: row.provider as string | null,
    profile: row.profile as string | null,
    route_key: row.route_key as string | null,
    calculated_at: row.calculated_at as string | null,
    error: row.error as string | null,
    provider_diagnostic: row.provider_diagnostic === null
      ? null
      : parseJson<NonNullable<PersistedRouteLegRow['provider_diagnostic']>>(row.provider_diagnostic),
    notes: row.notes as string,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

function activityRowFromSqlite(row: Record<string, unknown>): PersistedActivityRow {
  return {
    id: row.id as string,
    trip_id: row.trip_id as string,
    destination_id: row.destination_id as string,
    activity_order: row.activity_order as number,
    title: row.title as string,
    description: row.description as string,
    category: row.category as PersistedActivityRow['category'],
    status: row.status as PersistedActivityRow['status'],
    priority: row.priority as PersistedActivityRow['priority'],
    location: row.location === null
      ? null
      : parseJson<NonNullable<PersistedActivityRow['location']>>(row.location),
    links: parseJson<PersistedActivityRow['links']>(row.links),
    notes: row.notes as string,
    tags: parseJson<string[]>(row.tags),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

function assertUniqueIds(ids: string[], message: string): void {
  if (new Set(ids).size !== ids.length) throw new Error(message);
}

function assertRouteEndpoints(routeLegs: RouteLeg[], destinationIds: Set<string>): void {
  if (routeLegs.some((routeLeg) =>
    !destinationIds.has(routeLeg.originDestinationId)
    || !destinationIds.has(routeLeg.targetDestinationId))) {
    throw new Error('Route leg endpoints must belong to the trip.');
  }
}

function readSnapshot(connection: DatabaseSync, tripId: string): TripSnapshot {
  connection.exec('BEGIN');
  try {
    const revisionRow = connection.prepare(`
      SELECT revision FROM trip_revisions WHERE trip_id = ?
    `).get(tripId) as { revision?: unknown } | undefined;
    if (typeof revisionRow?.revision !== 'number') throw new Error('Trip not found.');
    const destinations = connection.prepare(`
      SELECT * FROM destinations
      WHERE trip_id = ?
      ORDER BY stop_order, created_at
    `).all(tripId).map((row) => destinationFromPersistedRow(
      destinationRowFromSqlite(row as Record<string, unknown>),
    ));
    const routeLegs = connection.prepare(`
      SELECT * FROM route_legs
      WHERE trip_id = ?
      ORDER BY updated_at, id
    `).all(tripId).map((row) => routeLegFromPersistedRow(
      routeLegRowFromSqlite(row as Record<string, unknown>),
    ));
    const activities = connection.prepare(`
      SELECT activities.*
      FROM activities
      JOIN destinations
        ON destinations.trip_id = activities.trip_id
        AND destinations.id = activities.destination_id
      WHERE activities.trip_id = ?
      ORDER BY destinations.stop_order, activities.activity_order, activities.created_at
    `).all(tripId).map((row) => activityFromPersistedRow(
      activityRowFromSqlite(row as Record<string, unknown>),
    ));
    connection.exec('COMMIT');
    return { revision: revisionRow.revision, destinations, routeLegs, activities };
  } catch (error) {
    connection.exec('ROLLBACK');
    throw error;
  }
}

export function createSqliteTripRepository(
  database: PlotterDatabase,
  writes: WriteCoordinator,
  tripId: string,
  mediaStore?: AtomicMediaStore,
): RevisionedTripStore {
  const { connection } = database;
  const destinationUpsert = connection.prepare(`
    INSERT INTO destinations (
      id, trip_id, name, country_region, lat, lng, location, stop_order, status,
      priority, timing, why, media, research, activities, route_context,
      routing_anchors, tags, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (trip_id, id) DO UPDATE SET
      name = excluded.name,
      country_region = excluded.country_region,
      lat = excluded.lat,
      lng = excluded.lng,
      location = excluded.location,
      stop_order = excluded.stop_order,
      status = excluded.status,
      priority = excluded.priority,
      timing = excluded.timing,
      why = excluded.why,
      media = excluded.media,
      research = excluded.research,
      activities = excluded.activities,
      route_context = excluded.route_context,
      routing_anchors = excluded.routing_anchors,
      tags = excluded.tags,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at
  `);
  const routeLegUpsert = connection.prepare(`
    INSERT INTO route_legs (
      id, trip_id, origin_destination_id, target_destination_id, movement,
      calculation_mode, ferry_policy, waypoints, sections, warnings, status,
      distance_km, travel_time_hours, geometry, provider, profile, route_key,
      calculated_at, error, provider_diagnostic, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (trip_id, id) DO UPDATE SET
      origin_destination_id = excluded.origin_destination_id,
      target_destination_id = excluded.target_destination_id,
      movement = excluded.movement,
      calculation_mode = excluded.calculation_mode,
      ferry_policy = excluded.ferry_policy,
      waypoints = excluded.waypoints,
      sections = excluded.sections,
      warnings = excluded.warnings,
      status = excluded.status,
      distance_km = excluded.distance_km,
      travel_time_hours = excluded.travel_time_hours,
      geometry = excluded.geometry,
      provider = excluded.provider,
      profile = excluded.profile,
      route_key = excluded.route_key,
      calculated_at = excluded.calculated_at,
      error = excluded.error,
      provider_diagnostic = excluded.provider_diagnostic,
      notes = excluded.notes,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at
  `);
  const activityInsert = connection.prepare(`
    INSERT INTO activities (
      id, trip_id, destination_id, activity_order, title, description, category,
      status, priority, location, links, notes, tags, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const activityUpdate = connection.prepare(`
    UPDATE activities
    SET activity_order = ?, title = ?, description = ?, category = ?, status = ?,
      priority = ?, location = ?, links = ?, notes = ?, tags = ?, updated_at = ?
    WHERE id = ? AND trip_id = ? AND destination_id = ?
  `);
  const destinationExists = connection.prepare(`
    SELECT 1 AS present FROM destinations WHERE trip_id = ? AND id = ?
  `);
  const activityById = connection.prepare(`
    SELECT * FROM activities WHERE trip_id = ? AND id = ?
  `);
  const activitiesForDestination = connection.prepare(`
    SELECT * FROM activities
    WHERE trip_id = ? AND destination_id = ?
    ORDER BY activity_order, created_at
  `);
  const destinationIds = connection.prepare('SELECT id FROM destinations WHERE trip_id = ?');
  const routeRows = connection.prepare('SELECT * FROM route_legs WHERE trip_id = ?');
  const deleteDestination = connection.prepare('DELETE FROM destinations WHERE trip_id = ? AND id = ?');
  const deleteRouteLeg = connection.prepare('DELETE FROM route_legs WHERE trip_id = ? AND id = ?');
  const deleteActivity = connection.prepare('DELETE FROM activities WHERE trip_id = ? AND id = ?');
  const deleteAllDestinations = connection.prepare('DELETE FROM destinations WHERE trip_id = ?');
  const mediaById = connection.prepare(`
    SELECT * FROM media_assets WHERE trip_id = ? AND id = ?
  `);
  const destinationMedia = connection.prepare(`
    SELECT * FROM media_assets
    WHERE trip_id = ? AND destination_id = ? AND activity_id IS NULL
    ORDER BY sort_order, created_at, id
  `);
  const activityMedia = connection.prepare(`
    SELECT * FROM media_assets
    WHERE trip_id = ? AND activity_id = ?
    ORDER BY sort_order, created_at, id
  `);
  const mediaForTrip = connection.prepare(`
    SELECT * FROM media_assets WHERE trip_id = ? ORDER BY id
  `);
  const mediaForDestination = connection.prepare(`
    SELECT * FROM media_assets WHERE trip_id = ? AND destination_id = ? ORDER BY id
  `);
  const mediaForActivity = connection.prepare(`
    SELECT * FROM media_assets WHERE trip_id = ? AND activity_id = ? ORDER BY id
  `);
  const insertMedia = connection.prepare(`
    INSERT INTO media_assets (
      id, trip_id, destination_id, activity_id, bucket_id, object_path,
      caption, credit, sort_order, content_type, size_bytes, uploaded_by,
      relative_path, sha256, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateMedia = connection.prepare(`
    UPDATE media_assets SET caption = ?, credit = ?, updated_at = ?
    WHERE trip_id = ? AND id = ?
  `);
  const updateMediaOrder = connection.prepare(`
    UPDATE media_assets SET sort_order = ?, updated_at = ?
    WHERE trip_id = ? AND id = ?
  `);
  const deleteMedia = connection.prepare(`
    DELETE FROM media_assets WHERE trip_id = ? AND id = ?
  `);

  function writeDestination(destination: Destination, index = 0): void {
    const row = destinationToPersistedRow(normalizeDestination(destination, index), tripId);
    destinationUpsert.run(
      row.id, row.trip_id, row.name, row.country_region, row.lat, row.lng,
      JSON.stringify(row.location), row.stop_order, row.status, row.priority,
      JSON.stringify(row.timing), JSON.stringify(row.why), JSON.stringify(row.media),
      JSON.stringify(row.research), JSON.stringify(row.activities), JSON.stringify(row.route_context),
      row.routing_anchors === undefined ? null : JSON.stringify(row.routing_anchors),
      JSON.stringify(row.tags), row.created_at, row.updated_at,
    );
  }

  function writeRouteLeg(routeLeg: RouteLeg): void {
    const row = routeLegToPersistedRow(normalizeRouteLeg(routeLeg), tripId);
    routeLegUpsert.run(
      row.id, row.trip_id, row.origin_destination_id, row.target_destination_id,
      row.movement, row.calculation_mode, row.ferry_policy ?? null,
      row.waypoints === undefined ? null : JSON.stringify(row.waypoints),
      row.sections === undefined ? null : JSON.stringify(row.sections),
      row.warnings === undefined ? null : JSON.stringify(row.warnings),
      row.status, row.distance_km, row.travel_time_hours,
      row.geometry === null ? null : JSON.stringify(row.geometry),
      row.provider, row.profile, row.route_key, row.calculated_at, row.error,
      row.provider_diagnostic == null ? null : JSON.stringify(row.provider_diagnostic),
      row.notes, row.created_at, row.updated_at,
    );
  }

  function activityValues(activity: Activity) {
    const row = activityToPersistedRow(normalizeActivity(activity), tripId);
    return {
      row,
      values: [
        row.id, row.trip_id, row.destination_id, row.activity_order, row.title,
        row.description, row.category, row.status, row.priority,
        row.location === null ? null : JSON.stringify(row.location), JSON.stringify(row.links),
        row.notes, JSON.stringify(row.tags), row.created_at, row.updated_at,
      ] as const,
    };
  }

  function insertActivity(activity: Activity): void {
    activityInsert.run(...activityValues(activity).values);
  }

  function replaceActivity(activity: Activity): void {
    const { row } = activityValues(activity);
    const result = activityUpdate.run(
      row.activity_order, row.title, row.description, row.category, row.status,
      row.priority, row.location === null ? null : JSON.stringify(row.location),
      JSON.stringify(row.links), row.notes, JSON.stringify(row.tags), row.updated_at,
      row.id, row.trip_id, row.destination_id,
    );
    if (result.changes !== 1) throw new Error('Activity not found.');
  }

  function currentDestinationIds(): Set<string> {
    return new Set(destinationIds.all(tripId).map((row) => (row as { id: string }).id));
  }

  function requireDestination(id: string): void {
    if (!destinationExists.get(tripId, id)) throw new Error('Destination not found.');
  }

  function validateRequestedDestinationIds(ids: string[]): void {
    assertUniqueIds(ids, 'Destination set does not match the current trip.');
    const current = currentDestinationIds();
    if (ids.some((id) => !current.has(id))) {
      throw new Error('Destination set does not match the current trip.');
    }
  }

  function validateReplacement(
    destinations: Destination[],
    routeLegs: RouteLeg[],
    activities: Activity[],
  ): void {
    const ids = destinations.map(({ id }) => id);
    assertUniqueIds(ids, 'Destination IDs must be unique.');
    assertUniqueIds(routeLegs.map(({ id }) => id), 'Route leg IDs must be unique.');
    assertUniqueIds(activities.map(({ id }) => id), 'Activity IDs must be unique.');
    const idSet = new Set(ids);
    assertRouteEndpoints(routeLegs, idSet);
    if (activities.some((activity) => !idSet.has(activity.destinationId))) {
      throw new Error('Activity destinations must belong to the trip.');
    }
  }

  function requireMediaStore(): AtomicMediaStore {
    if (!mediaStore) throw new Error('Media storage is unavailable.');
    return mediaStore;
  }

  function decodeMediaRow(row: Record<string, unknown>): MediaRow {
    return row as MediaRow;
  }

  function readMedia(mediaId: string): MediaRow {
    const row = mediaById.get(tripId, mediaId) as Record<string, unknown> | undefined;
    if (!row) throw new Error('Media item not found.');
    return decodeMediaRow(row);
  }

  function mediaRowsForMutation(mutation: TripMutationRequest): MediaRow[] {
    switch (mutation.type) {
      case 'delete-destination':
        return mediaForDestination.all(tripId, mutation.destinationId)
          .map((row) => decodeMediaRow(row as Record<string, unknown>));
      case 'delete-destinations':
        return mutation.destinationIds.flatMap((destinationId) =>
          mediaForDestination.all(tripId, destinationId)
            .map((row) => decodeMediaRow(row as Record<string, unknown>)));
      case 'apply-trip-mutation':
        return mutation.delta.destinationIdsToDelete.flatMap((destinationId) =>
          mediaForDestination.all(tripId, destinationId)
            .map((row) => decodeMediaRow(row as Record<string, unknown>)));
      case 'replace-trip-data':
        return mediaForTrip.all(tripId).map((row) => decodeMediaRow(row as Record<string, unknown>));
      case 'delete-activity':
        return mediaForActivity.all(tripId, mutation.activityId)
          .map((row) => decodeMediaRow(row as Record<string, unknown>));
      default:
        return [];
    }
  }

  async function createMedia(
    expectedRevision: number,
    owner: { destinationId: string; activityId: string | null },
    input: CreateMediaInput,
  ): Promise<MediaWriteResponse> {
    const store = requireMediaStore();
    const staged = await store.stage(input.bytes, input.contentType);
    const mediaId = crypto.randomUUID();
    let preparationStarted = false;

    try {
      const result = await writes.runPrepared(
        { kind: 'trip', tripId, expectedRevision },
        async () => {
          requireDestination(owner.destinationId);
          if (owner.activityId !== null) {
            const activity = activityById.get(tripId, owner.activityId) as Record<string, unknown> | undefined;
            if (!activity || activity.destination_id !== owner.destinationId) {
              throw new Error('Activity not found.');
            }
          }
          preparationStarted = true;
          const prepared = await store.prepareCommit(staged, mediaId);
          return {
            value: prepared.value,
            rollback: prepared.rollback,
            finalize: prepared.finalize,
          };
        },
        (_transaction, committed: StoredMediaObject) => {
          requireDestination(owner.destinationId);
          if (owner.activityId !== null) {
            const activity = activityById.get(tripId, owner.activityId) as Record<string, unknown> | undefined;
            if (!activity || activity.destination_id !== owner.destinationId) {
              throw new Error('Activity not found.');
            }
          }
          const existing = owner.activityId === null
            ? destinationMedia.all(tripId, owner.destinationId)
            : activityMedia.all(tripId, owner.activityId);
          const nextOrder = existing.reduce(
            (maximum, row) => Math.max(maximum, (row as { sort_order: number }).sort_order),
            -1,
          ) + 1;
          const createdAt = input.source?.createdAt ?? nextTimestamp();
          const updatedAt = input.source?.updatedAt ?? createdAt;
          const bucketId = input.source?.bucketId ?? 'local-media';
          const objectPath = input.source?.objectPath ?? committed.relativePath;
          insertMedia.run(
            mediaId,
            tripId,
            owner.destinationId,
            owner.activityId,
            bucketId,
            objectPath,
            input.caption ?? '',
            input.credit ?? '',
            nextOrder,
            committed.contentType,
            committed.byteCount,
            input.source?.uploadedBy ?? 'local',
            committed.relativePath,
            committed.sha256,
            createdAt,
            updatedAt,
          );
          return readMedia(mediaId);
        },
      );
      return { revision: result.revision, mediaItem: mediaItemFromRow(result.value) };
    } catch (error) {
      if (!preparationStarted) {
        try {
          await store.discard(staged.relativePath);
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            'Media metadata creation failed and staged bytes could not be removed.',
            { cause: cleanupError },
          );
        }
      }
      throw error;
    }
  }

  async function updateOwnedMedia(
    expectedRevision: number,
    mediaId: string,
    owner: 'destination' | 'activity',
    patch: MediaPatch,
  ): Promise<MediaWriteResponse> {
    const result = await writes.run(
      { kind: 'trip', tripId, expectedRevision },
      () => {
        const existing = readMedia(mediaId);
        if ((owner === 'destination') !== (existing.activity_id === null)) {
          throw new Error('Media item not found.');
        }
        const timestamp = nextTimestamp(existing.updated_at);
        const write = updateMedia.run(
          patch.caption ?? existing.caption,
          patch.credit ?? existing.credit,
          timestamp,
          tripId,
          mediaId,
        );
        if (write.changes !== 1) throw new Error('Media item not found.');
        return readMedia(mediaId);
      },
    );
    return { revision: result.revision, mediaItem: mediaItemFromRow(result.value) };
  }

  async function deleteOwnedMedia(
    expectedRevision: number,
    mediaId: string,
    owner: 'destination' | 'activity',
  ): Promise<MediaWriteResponse> {
    const result = await writes.runPrepared(
      { kind: 'trip', tripId, expectedRevision },
      async () => {
        const existing = readMedia(mediaId);
        if ((owner === 'destination') !== (existing.activity_id === null)) {
          throw new Error('Media item not found.');
        }
        const prepared = await requireMediaStore().prepareMoveToTrash([{
          mediaId: existing.id,
          relativePath: existing.relative_path,
        }]);
        return {
          value: undefined,
          rollback: prepared.rollback,
          finalize: prepared.finalize,
        };
      },
      () => {
          const current = readMedia(mediaId);
          if ((owner === 'destination') !== (current.activity_id === null)) {
            throw new Error('Media item not found.');
          }
          const write = deleteMedia.run(tripId, mediaId);
          if (write.changes !== 1) throw new Error('Media item not found.');
      },
    );
    return { revision: result.revision };
  }

  async function reorderOwnedMedia(
    expectedRevision: number,
    owner: { type: 'destination'; id: string } | { type: 'activity'; id: string },
    orderedMediaIds: string[],
  ): Promise<MediaWriteResponse> {
    const result = await writes.run(
      { kind: 'trip', tripId, expectedRevision },
      () => {
        if (owner.type === 'destination') {
          requireDestination(owner.id);
        } else if (!activityById.get(tripId, owner.id)) {
          throw new Error('Activity not found.');
        }
        const current = (owner.type === 'destination'
          ? destinationMedia.all(tripId, owner.id)
          : activityMedia.all(tripId, owner.id))
          .map((row) => decodeMediaRow(row as Record<string, unknown>));
        const currentIds = current.map(({ id }) => id);
        if (
          new Set(orderedMediaIds).size !== orderedMediaIds.length
          || orderedMediaIds.length !== currentIds.length
          || orderedMediaIds.some((id) => !currentIds.includes(id))
        ) {
          throw new Error(
            `Media order must include each ${owner.type} media item exactly once.`,
          );
        }
        const timestamp = nextTimestamp(
          current.reduce((latest, row) => row.updated_at > latest ? row.updated_at : latest, ''),
        );
        current.forEach((row, index) => {
          updateMediaOrder.run(-(index + 1), timestamp, tripId, row.id);
        });
        orderedMediaIds.forEach((id, index) => {
          updateMediaOrder.run(index, timestamp, tripId, id);
        });
        const byId = new Map(current.map((row) => [row.id, row]));
        return orderedMediaIds.map((id, index) => ({
          ...byId.get(id)!,
          sort_order: index,
          updated_at: timestamp,
        }));
      },
    );
    return { revision: result.revision, mediaItems: result.value.map(mediaItemFromRow) };
  }

  function mutateTrip(mutation: TripMutationRequest): { activity?: Activity } {
    switch (mutation.type) {
      case 'save-destination':
        writeDestination(mutation.destination);
        return {};
      case 'delete-destination':
        deleteDestination.run(tripId, mutation.destinationId);
        return {};
      case 'delete-destinations':
        validateRequestedDestinationIds(mutation.destinationIds);
        for (const id of mutation.destinationIds) deleteDestination.run(tripId, id);
        return {};
      case 'save-route-leg':
        assertRouteEndpoints([mutation.routeLeg], currentDestinationIds());
        writeRouteLeg(mutation.routeLeg);
        return {};
      case 'delete-route-leg':
        deleteRouteLeg.run(tripId, mutation.routeLegId);
        return {};
      case 'apply-trip-mutation': {
        const { delta } = mutation;
        validateRequestedDestinationIds(delta.destinationIdsToDelete);
        assertUniqueIds(delta.destinationsToUpsert.map(({ id }) => id), 'Destination IDs must be unique.');
        assertUniqueIds(delta.routeLegIdsToDelete, 'Route leg set does not match the current trip.');
        assertUniqueIds(delta.routeLegsToUpsert.map(({ id }) => id), 'Route leg IDs must be unique.');
        const existingRoutes = routeRows.all(tripId).map((row) => routeLegFromPersistedRow(
          routeLegRowFromSqlite(row as Record<string, unknown>),
        ));
        const existingRouteIds = new Set(existingRoutes.map(({ id }) => id));
        if (delta.routeLegIdsToDelete.some((id) => !existingRouteIds.has(id))) {
          throw new Error('Route leg set does not match the current trip.');
        }
        const deletedDestinationIds = new Set(delta.destinationIdsToDelete);
        const deletedRouteIds = new Set(delta.routeLegIdsToDelete);
        if (existingRoutes.some((routeLeg) =>
          (deletedDestinationIds.has(routeLeg.originDestinationId)
            || deletedDestinationIds.has(routeLeg.targetDestinationId))
          && !deletedRouteIds.has(routeLeg.id))) {
          throw new Error('Route leg deletion set must include every affected leg.');
        }
        const finalDestinationIds = currentDestinationIds();
        for (const id of deletedDestinationIds) finalDestinationIds.delete(id);
        for (const destination of delta.destinationsToUpsert) finalDestinationIds.add(destination.id);
        const finalRoutes = new Map(existingRoutes.map((routeLeg) => [routeLeg.id, routeLeg]));
        for (const id of deletedRouteIds) finalRoutes.delete(id);
        for (const routeLeg of delta.routeLegsToUpsert) finalRoutes.set(routeLeg.id, routeLeg);
        assertRouteEndpoints([...finalRoutes.values()], finalDestinationIds);
        for (const id of deletedRouteIds) deleteRouteLeg.run(tripId, id);
        for (const id of deletedDestinationIds) deleteDestination.run(tripId, id);
        for (const destination of delta.destinationsToUpsert) writeDestination(destination);
        for (const routeLeg of delta.routeLegsToUpsert) writeRouteLeg(routeLeg);
        return {};
      }
      case 'replace-trip-data': {
        const activities = mutation.snapshot.activities ?? [];
        validateReplacement(mutation.snapshot.destinations, mutation.snapshot.routeLegs, activities);
        deleteAllDestinations.run(tripId);
        mutation.snapshot.destinations.forEach((destination, index) => writeDestination(destination, index));
        for (const routeLeg of mutation.snapshot.routeLegs) writeRouteLeg(routeLeg);
        for (const activity of activities) insertActivity(activity);
        return {};
      }
      case 'create-activity': {
        requireDestination(mutation.input.destinationId);
        const maxOrderRow = connection.prepare(`
          SELECT MAX(activity_order) AS max_order
          FROM activities
          WHERE trip_id = ? AND destination_id = ?
        `).get(tripId, mutation.input.destinationId) as { max_order: number | null };
        const activity = createActivity({
          ...mutation.input,
          order: mutation.input.order ?? (maxOrderRow.max_order ?? -1) + 1,
        });
        insertActivity(activity);
        return { activity };
      }
      case 'update-activity': {
        const row = activityById.get(tripId, mutation.activityId) as Record<string, unknown> | undefined;
        if (!row) throw new Error('Activity not found.');
        const activity = normalizeActivity(updateActivity(
          activityFromPersistedRow(activityRowFromSqlite(row)),
          mutation.patch,
        ));
        replaceActivity(activity);
        return { activity };
      }
      case 'delete-activity':
        deleteActivity.run(tripId, mutation.activityId);
        return {};
      case 'reorder-activities': {
        requireDestination(mutation.destinationId);
        const current = activitiesForDestination.all(tripId, mutation.destinationId)
          .map((row) => activityFromPersistedRow(activityRowFromSqlite(row as Record<string, unknown>)));
        const currentIds = current.map(({ id }) => id);
        const requestedIds = mutation.orderedActivityIds;
        if (
          new Set(requestedIds).size !== requestedIds.length
          || requestedIds.length !== currentIds.length
          || requestedIds.some((id) => !currentIds.includes(id))
        ) {
          throw new Error('Activity order must include each destination activity exactly once.');
        }
        for (const activity of reorderActivities(current, requestedIds)) replaceActivity(activity);
        return {};
      }
    }
  }

  return {
    async load() {
      return readSnapshot(connection, tripId);
    },

    async mutate(expectedRevision, mutation) {
      const result = await writes.runPrepared(
        { kind: 'trip', tripId, expectedRevision },
        async () => {
          const rows = mediaRowsForMutation(mutation);
          if (rows.length === 0) return { value: undefined };
          const prepared = await requireMediaStore().prepareMoveToTrash(rows.map((row) => ({
            mediaId: row.id,
            relativePath: row.relative_path,
          })));
          return {
            value: undefined,
            rollback: prepared.rollback,
            finalize: prepared.finalize,
          };
        },
        () => mutateTrip(mutation),
      );
      return { revision: result.revision, ...result.value };
    },

    async listDestinationMedia(destinationId) {
      return destinationMedia.all(tripId, destinationId)
        .map((row) => mediaItemFromRow(decodeMediaRow(row as Record<string, unknown>)));
    },

    async listActivityMedia(activityId) {
      return activityMedia.all(tripId, activityId)
        .map((row) => mediaItemFromRow(decodeMediaRow(row as Record<string, unknown>)));
    },

    createDestinationMedia(expectedRevision, destinationId, input) {
      return createMedia(expectedRevision, { destinationId, activityId: null }, input);
    },

    createActivityMedia(expectedRevision, destinationId, activityId, input) {
      return createMedia(expectedRevision, { destinationId, activityId }, input);
    },

    updateDestinationMedia(expectedRevision, mediaId, patch) {
      return updateOwnedMedia(expectedRevision, mediaId, 'destination', patch);
    },

    updateActivityMedia(expectedRevision, mediaId, patch) {
      return updateOwnedMedia(expectedRevision, mediaId, 'activity', patch);
    },

    deleteDestinationMedia(expectedRevision, mediaId) {
      return deleteOwnedMedia(expectedRevision, mediaId, 'destination');
    },

    deleteActivityMedia(expectedRevision, mediaId) {
      return deleteOwnedMedia(expectedRevision, mediaId, 'activity');
    },

    reorderDestinationMedia(expectedRevision, destinationId, orderedMediaIds) {
      return reorderOwnedMedia(
        expectedRevision,
        { type: 'destination', id: destinationId },
        orderedMediaIds,
      );
    },

    reorderActivityMedia(expectedRevision, activityId, orderedMediaIds) {
      return reorderOwnedMedia(
        expectedRevision,
        { type: 'activity', id: activityId },
        orderedMediaIds,
      );
    },
  };
}
