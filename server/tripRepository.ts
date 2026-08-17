import type { DatabaseSync } from 'node:sqlite';
import type { TripMutationRequest, TripWriteResponse } from '../src/api/contracts';
import { createActivity, reorderActivities, updateActivity } from '../src/domain/activities';
import type { Activity, Destination, RouteLeg } from '../src/domain/types';
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
import type { WriteCoordinator } from './writeCoordinator';

export type RevisionedTripStore = {
  load(): Promise<TripSnapshot>;
  mutate(expectedRevision: number, mutation: TripMutationRequest): Promise<TripWriteResponse>;
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
      const result = await writes.run(
        { kind: 'trip', tripId, expectedRevision },
        () => mutateTrip(mutation),
      );
      return { revision: result.revision, ...result.value };
    },
  };
}
