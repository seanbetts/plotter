/// <reference types="vite/client" />

import { randomUUID } from 'node:crypto';
import type {
  CreateTripRequest,
  DirectoryWriteResponse,
  UpdateTripRequest,
} from '../src/api/contracts';
import {
  tripSummaryFromPersistedRow,
  tripSummaryToPersistedRow,
  type PersistedTripRow,
} from '../src/storage/persistedRows';
import type { DirectorySnapshot } from '../src/storage/revision';
import type { TripSummary } from '../src/storage/tripDirectoryRepository';
import { resolveVehiclePreset } from '../src/domain/vehiclePresets';
import type { PlotterDatabase } from './database';
import type { MediaStore } from './mediaStore';
import type { WriteCoordinator } from './writeCoordinator';

const LOCAL_OWNER_ID = 'local';

export type RevisionedDirectoryStore = {
  load(): Promise<DirectorySnapshot>;
  create(expectedRevision: number, input: CreateTripRequest): Promise<DirectoryWriteResponse>;
  update(expectedRevision: number, tripId: string, patch: UpdateTripRequest): Promise<DirectoryWriteResponse>;
  delete(expectedRevision: number, tripId: string): Promise<DirectoryWriteResponse>;
};

function parseJson<T>(value: unknown): T {
  if (typeof value !== 'string') {
    throw new Error('Stored trip metadata is invalid.');
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error('Stored trip metadata is invalid.');
  }
}

function tripRowFromSqlite(row: Record<string, unknown>): PersistedTripRow {
  return {
    id: row.id as string,
    owner_user_id: row.owner_user_id as string,
    name: row.name as string,
    description: row.description as string | null,
    vehicle_preset: row.vehicle_preset as PersistedTripRow['vehicle_preset'],
    vehicle_profile: row.vehicle_profile as PersistedTripRow['vehicle_profile'],
    vehicle_type: row.vehicle_type as PersistedTripRow['vehicle_type'],
    vehicle_restrictions: row.vehicle_restrictions === null
      ? undefined
      : parseJson<PersistedTripRow['vehicle_restrictions']>(row.vehicle_restrictions),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

function nextTimestamp(previous?: string): string {
  const now = new Date().toISOString();
  if (!previous || Date.parse(now) > Date.parse(previous)) return now;
  return new Date(Date.parse(previous) + 1).toISOString();
}

export function createSqliteDirectoryRepository(
  database: PlotterDatabase,
  writes: WriteCoordinator,
  mediaStore?: MediaStore,
): RevisionedDirectoryStore {
  const { connection } = database;
  const listTrips = connection.prepare(`
    SELECT id, owner_user_id, name, description, vehicle_preset, vehicle_profile,
      vehicle_type, vehicle_restrictions, created_at, updated_at
    FROM trips
    ORDER BY updated_at DESC, created_at DESC
  `);
  const readRevision = connection.prepare(`
    SELECT directory_revision
    FROM store_metadata
    WHERE singleton = 1
  `);
  const readTrip = connection.prepare(`
    SELECT id, owner_user_id, name, description, vehicle_preset, vehicle_profile,
      vehicle_type, vehicle_restrictions, created_at, updated_at
    FROM trips
    WHERE id = ?
  `);
  const insertTrip = connection.prepare(`
    INSERT INTO trips (
      id, owner_user_id, name, description, vehicle_preset, vehicle_profile,
      vehicle_type, vehicle_restrictions, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateTrip = connection.prepare(`
    UPDATE trips
    SET name = ?, description = ?, vehicle_preset = ?, vehicle_profile = ?,
      vehicle_type = ?, vehicle_restrictions = ?, updated_at = ?
    WHERE id = ?
  `);
  const insertTripRevision = connection.prepare(`
    INSERT INTO trip_revisions (trip_id, revision)
    VALUES (?, 0)
  `);
  const deleteTrip = connection.prepare('DELETE FROM trips WHERE id = ?');
  const mediaForTrip = connection.prepare(`
    SELECT id, relative_path FROM media_assets WHERE trip_id = ? ORDER BY id
  `);

  function decodeTrip(row: Record<string, unknown>): TripSummary {
    return tripSummaryFromPersistedRow(tripRowFromSqlite(row));
  }

  function insertTripRow(trip: TripSummary): void {
    const row = tripSummaryToPersistedRow(trip, LOCAL_OWNER_ID);
    insertTrip.run(
      row.id,
      row.owner_user_id,
      row.name,
      row.description,
      row.vehicle_preset ?? null,
      row.vehicle_profile ?? null,
      row.vehicle_type ?? null,
      row.vehicle_restrictions === undefined ? null : JSON.stringify(row.vehicle_restrictions),
      row.created_at,
      row.updated_at,
    );
  }

  return {
    async load() {
      connection.exec('BEGIN');
      try {
        const revisionRow = readRevision.get() as { directory_revision?: unknown } | undefined;
        if (typeof revisionRow?.directory_revision !== 'number') {
          throw new Error('Directory revision is unavailable.');
        }
        const trips = listTrips.all().map((row) => decodeTrip(row as Record<string, unknown>));
        connection.exec('COMMIT');
        return { revision: revisionRow.directory_revision, trips };
      } catch (error) {
        connection.exec('ROLLBACK');
        throw error;
      }
    },

    async create(expectedRevision, input) {
      const result = await writes.run({ kind: 'directory', expectedRevision }, (transaction) => {
        const timestamp = nextTimestamp();
        const trip: TripSummary = {
          id: randomUUID(),
          name: input.name,
          description: '',
          routingVehicle: input.routingVehicle ?? resolveVehiclePreset('standard'),
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        insertTripRow(trip);
        insertTripRevision.run(trip.id);
        void transaction;
        return trip;
      });

      return { revision: result.revision, trip: result.value };
    },

    async update(expectedRevision, tripId, request) {
      const result = await writes.run({ kind: 'directory', expectedRevision }, (transaction) => {
        const row = readTrip.get(tripId) as Record<string, unknown> | undefined;
        if (!row) throw new Error('Trip not found.');
        const existing = decodeTrip(row);
        const patch = request.patch;
        const updated: TripSummary = {
          ...existing,
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.routingVehicle !== undefined ? { routingVehicle: patch.routingVehicle } : {}),
          updatedAt: nextTimestamp(existing.updatedAt),
        };
        const persisted = tripSummaryToPersistedRow(updated, row.owner_user_id as string);
        const write = updateTrip.run(
          persisted.name,
          persisted.description,
          persisted.vehicle_preset ?? null,
          persisted.vehicle_profile ?? null,
          persisted.vehicle_type ?? null,
          persisted.vehicle_restrictions === undefined
            ? null
            : JSON.stringify(persisted.vehicle_restrictions),
          persisted.updated_at,
          tripId,
        );
        if (write.changes !== 1) throw new Error('Trip not found.');
        void transaction;
        return updated;
      });

      return { revision: result.revision, trip: result.value };
    },

    async delete(expectedRevision, tripId) {
      const restores: Array<() => Promise<void>> = [];
      const rows = mediaForTrip.all(tripId) as Array<{ id: string; relative_path: string }>;
      if (rows.length > 0 && !mediaStore) throw new Error('Media storage is unavailable.');
      if (mediaStore) {
        try {
          for (const row of rows) {
            restores.push(await mediaStore.moveToTrash(row.relative_path, row.id));
          }
        } catch (error) {
          for (const restore of restores.reverse()) await restore();
          throw error;
        }
      }

      try {
        const result = await writes.run({ kind: 'directory', expectedRevision }, (transaction) => {
          const write = deleteTrip.run(tripId);
          if (write.changes !== 1) throw new Error('Trip not found.');
          void transaction;
        });

        return { revision: result.revision };
      } catch (error) {
        for (const restore of restores.reverse()) await restore();
        throw error;
      }
    },
  };
}
