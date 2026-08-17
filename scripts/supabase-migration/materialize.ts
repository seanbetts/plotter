import { createHash } from 'node:crypto';
import { constants, lstatSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { assertDatabaseIntegrity, openPlotterDatabase } from '../../server/database';
import { createSqliteDirectoryRepository } from '../../server/directoryRepository';
import { createMediaStore } from '../../server/mediaStore';
import { createSqliteTripRepository } from '../../server/tripRepository';
import type { WriteCoordinator } from '../../server/writeCoordinator';
import { isCanonicalId } from '../../src/api/identifiers';
import { sourceFingerprintDigest, type SourceFingerprint, type SourceSnapshot } from './source';

export type MigrationFailure = { gate: string; message: string };
export type OrphanClassification = { kind: string; sourceId: string; disposition: string };

export type MaterializedSource = {
  root: string;
  databasePath: string;
  mediaRoot: string;
  promotable: boolean;
  failures: MigrationFailure[];
  orphanClassifications: OrphanClassification[];
  validate(): void;
};

type MaterializeOptions = {
  destinationRoot: string;
  archiveRelativePath: string;
  source: SourceSnapshot;
  fingerprint: SourceFingerprint;
  importedAt: string;
};

const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const destinationStatuses = new Set(['idea', 'planned', 'confirmed', 'visited']);
const priorities = new Set(['low', 'medium', 'high', 'must-do']);
const vehiclePresets = new Set(['standard', 'large-camper', 'expedition-truck']);
const vehicleProfiles = new Set(['driving-car', 'driving-hgv']);
const routeMovements = new Set(['drive', 'vehicle-shipping']);
const calculationModes = new Set(['automatic', 'manual']);
const ferryPolicies = new Set(['allow', 'avoid', 'require']);
const routeStatuses = new Set(['pending', 'calculating', 'ready', 'failed', 'manual', 'review-required']);
const activityCategories = new Set(['food', 'culture', 'outdoors', 'street-art', 'ski', 'detour', 'logistics', 'other']);
const activityStatuses = new Set(['idea', 'planned', 'booked', 'done', 'skipped']);
const tripMemberRoles = new Set(['owner', 'editor', 'viewer']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isContained(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}${sep}`);
}

function fail(failures: MigrationFailure[], gate: string, message: string): void {
  if (!failures.some((item) => item.gate === gate && item.message === message)) {
    failures.push({ gate, message });
  }
}

function stringValue(value: unknown): value is string {
  return typeof value === 'string';
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && !Number.isNaN(Date.parse(value));
}

function validStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every(stringValue);
}

function validTrip(row: Record<string, unknown>): boolean {
  return isCanonicalId(row.id)
    && isCanonicalId(row.owner_user_id)
    && stringValue(row.name)
    && (row.description === null || stringValue(row.description))
    && isRecord(row.metadata)
    && vehiclePresets.has(String(row.vehicle_preset))
    && vehicleProfiles.has(String(row.vehicle_profile))
    && (row.vehicle_type === null || row.vehicle_type === 'hgv')
    && isRecord(row.vehicle_restrictions)
    && validTimestamp(row.created_at)
    && validTimestamp(row.updated_at);
}

function validTripMember(row: Record<string, unknown>): boolean {
  return isCanonicalId(row.trip_id)
    && isCanonicalId(row.user_id)
    && tripMemberRoles.has(String(row.role))
    && validTimestamp(row.created_at)
    && validTimestamp(row.updated_at);
}

function validDestination(row: Record<string, unknown>): boolean {
  if (!(
    isCanonicalId(row.id) && isCanonicalId(row.trip_id) && stringValue(row.name)
    && stringValue(row.country_region) && finiteNumber(row.lat) && finiteNumber(row.lng)
    && isRecord(row.location) && nonNegativeInteger(row.stop_order)
    && destinationStatuses.has(String(row.status)) && priorities.has(String(row.priority))
    && isRecord(row.timing) && isRecord(row.why) && Array.isArray(row.media)
    && isRecord(row.research) && isRecord(row.activities) && isRecord(row.route_context)
    && isRecord(row.routing_anchors) && validStringArray(row.tags)
    && validTimestamp(row.created_at) && validTimestamp(row.updated_at)
  )) return false;
  const timing = row.timing;
  const why = row.why;
  const research = row.research;
  const activities = row.activities;
  const routeContext = row.route_context;
  return validStringArray(timing.idealMonths)
    && finiteNumber(timing.expectedStayDays)
    && stringValue(timing.provisionalStartDate)
    && stringValue(timing.provisionalEndDate)
    && stringValue(why.summary) && stringValue(why.highlights) && stringValue(why.personalRationale)
    && stringValue(research.notes) && Array.isArray(research.links) && Array.isArray(research.bookReferences)
    && Array.isArray(activities.items)
    && stringValue(routeContext.previousNextNotes) && stringValue(routeContext.drivingNotes)
    && stringValue(routeContext.borderShippingNotes) && stringValue(routeContext.notes);
}

function validRoute(row: Record<string, unknown>): boolean {
  return isCanonicalId(row.id) && isCanonicalId(row.trip_id)
    && isCanonicalId(row.origin_destination_id) && isCanonicalId(row.target_destination_id)
    && routeMovements.has(String(row.movement)) && calculationModes.has(String(row.calculation_mode))
    && ferryPolicies.has(String(row.ferry_policy)) && Array.isArray(row.waypoints)
    && Array.isArray(row.sections) && Array.isArray(row.warnings)
    && routeStatuses.has(String(row.status))
    && (row.distance_km === null || finiteNumber(row.distance_km))
    && (row.travel_time_hours === null || finiteNumber(row.travel_time_hours))
    && (row.geometry === null || isRecord(row.geometry))
    && (row.provider === null || stringValue(row.provider))
    && (row.profile === null || stringValue(row.profile))
    && (row.route_key === null || stringValue(row.route_key))
    && (row.calculated_at === null || validTimestamp(row.calculated_at))
    && (row.error === null || stringValue(row.error))
    && (row.provider_diagnostic === null || isRecord(row.provider_diagnostic))
    && stringValue(row.notes) && validTimestamp(row.created_at) && validTimestamp(row.updated_at);
}

function validActivity(row: Record<string, unknown>): boolean {
  return isCanonicalId(row.id) && isCanonicalId(row.trip_id) && isCanonicalId(row.destination_id)
    && nonNegativeInteger(row.activity_order) && stringValue(row.title) && stringValue(row.description)
    && activityCategories.has(String(row.category)) && activityStatuses.has(String(row.status))
    && priorities.has(String(row.priority)) && (row.location === null || isRecord(row.location))
    && Array.isArray(row.links) && stringValue(row.notes) && validStringArray(row.tags)
    && validTimestamp(row.created_at) && validTimestamp(row.updated_at);
}

function validMedia(row: Record<string, unknown>): boolean {
  return isCanonicalId(row.id) && isCanonicalId(row.trip_id) && isCanonicalId(row.destination_id)
    && (row.activity_id === null || isCanonicalId(row.activity_id))
    && row.bucket_id === 'trip-media' && stringValue(row.object_path) && row.object_path.length > 0
    && stringValue(row.caption) && stringValue(row.credit) && nonNegativeInteger(row.sort_order)
    && (row.content_type === null
      || (stringValue(row.content_type) && CONTENT_TYPE_EXTENSIONS[row.content_type] !== undefined))
    && (row.size_bytes === null || (nonNegativeInteger(row.size_bytes) && row.size_bytes > 0))
    && isCanonicalId(row.uploaded_by)
    && validTimestamp(row.created_at) && validTimestamp(row.updated_at);
}

function identities(rows: Record<string, unknown>[], columns: string[]): string[] {
  return rows.map((row) => columns.map((column) => String(row[column])).join('\0'));
}

function effectiveContentType(
  row: Record<string, unknown>,
  object: SourceSnapshot['storage'][number],
): string | undefined {
  if (typeof row.content_type === 'string' && CONTENT_TYPE_EXTENSIONS[row.content_type]) {
    return row.content_type;
  }
  const mimetype = object.listing.metadata?.mimetype;
  if (typeof mimetype === 'string' && CONTENT_TYPE_EXTENSIONS[mimetype]) return mimetype;
  const lowerPath = object.path.toLowerCase();
  if (lowerPath.endsWith('.jpg') || lowerPath.endsWith('.jpeg')) return 'image/jpeg';
  if (lowerPath.endsWith('.png')) return 'image/png';
  if (lowerPath.endsWith('.webp')) return 'image/webp';
  if (lowerPath.endsWith('.gif')) return 'image/gif';
  return undefined;
}

function checkDuplicateIdentities(source: SourceSnapshot, failures: MigrationFailure[]): void {
  const definitions: Array<[keyof SourceSnapshot['tables'], string[]]> = [
    ['trips', ['id']], ['trip_members', ['trip_id', 'user_id']], ['destinations', ['id']],
    ['route_legs', ['id']], ['activities', ['id']], ['media_assets', ['id']],
  ];
  for (const [table, columns] of definitions) {
    const ids = identities(source.tables[table], columns);
    if (new Set(ids).size !== ids.length) fail(failures, 'identity', 'Source row identity is duplicate.');
  }
  const objectPaths = source.tables.media_assets.map((row) => String(row.object_path));
  if (new Set(objectPaths).size !== objectPaths.length) {
    fail(failures, 'identity', 'Source media object path is duplicate.');
  }
}

function validateSource(
  source: SourceSnapshot,
  failures: MigrationFailure[],
  classifications: OrphanClassification[],
): Map<string, SourceSnapshot['storage'][number]> {
  checkDuplicateIdentities(source, failures);
  for (const row of source.tables.trips) if (!validTrip(row)) fail(failures, 'domain', 'Source trip domain data is invalid.');
  for (const row of source.tables.trip_members) if (!validTripMember(row)) fail(failures, 'domain', 'Source trip-member domain data is invalid.');
  for (const row of source.tables.destinations) if (!validDestination(row)) fail(failures, 'domain', 'Source destination domain data is invalid.');
  for (const row of source.tables.route_legs) if (!validRoute(row)) fail(failures, 'domain', 'Source route-leg domain data is invalid.');
  for (const row of source.tables.activities) if (!validActivity(row)) fail(failures, 'domain', 'Source activity domain data is invalid.');
  for (const row of source.tables.media_assets) if (!validMedia(row)) fail(failures, 'domain', 'Source media domain data is invalid.');

  const tripIds = new Set(source.tables.trips.map((row) => row.id));
  const destinations = new Set(source.tables.destinations.map((row) => `${row.trip_id}\0${row.id}`));
  const activities = new Set(source.tables.activities.map((row) => `${row.trip_id}\0${row.destination_id}\0${row.id}`));
  for (const member of source.tables.trip_members) {
    const id = `${String(member.trip_id)}\0${String(member.user_id)}`;
    classifications.push({ kind: 'trip-member', sourceId: id, disposition: 'preserved-in-raw-archive' });
    if (!tripIds.has(member.trip_id)) {
      classifications.push({
        kind: 'orphan-trip-member', sourceId: id,
        disposition: 'preserved-in-raw-archive-and-rejected',
      });
      fail(failures, 'foreign-key', 'Source trip member has no parent trip.');
    }
  }
  for (const destination of source.tables.destinations) {
    if (!tripIds.has(destination.trip_id)) {
      classifications.push({
        kind: 'orphan-destination', sourceId: String(destination.id),
        disposition: 'preserved-in-raw-archive-and-rejected',
      });
      fail(failures, 'foreign-key', 'Source destination has no parent trip.');
    }
  }
  for (const route of source.tables.route_legs) {
    if (
      !tripIds.has(route.trip_id)
      || !destinations.has(`${route.trip_id}\0${route.origin_destination_id}`)
      || !destinations.has(`${route.trip_id}\0${route.target_destination_id}`)
    ) {
      classifications.push({
        kind: 'orphan-route-leg', sourceId: String(route.id),
        disposition: 'preserved-in-raw-archive-and-rejected',
      });
      fail(failures, 'foreign-key', 'Source route leg has an invalid endpoint.');
    }
  }
  for (const activity of source.tables.activities) {
    if (!destinations.has(`${activity.trip_id}\0${activity.destination_id}`)) {
      classifications.push({
        kind: 'orphan-activity', sourceId: String(activity.id),
        disposition: 'preserved-in-raw-archive-and-rejected',
      });
      fail(failures, 'foreign-key', 'Source activity has no parent destination.');
    }
  }
  const objects = new Map(source.storage.map((object) => [object.path, object]));
  const referenced = new Set<string>();
  for (const media of source.tables.media_assets) {
    const objectPath = String(media.object_path);
    referenced.add(objectPath);
    if (
      !destinations.has(`${media.trip_id}\0${media.destination_id}`)
      || (media.activity_id !== null
        && !activities.has(`${media.trip_id}\0${media.destination_id}\0${media.activity_id}`))
    ) {
      classifications.push({
        kind: 'orphan-media', sourceId: String(media.id),
        disposition: 'preserved-in-raw-archive-and-rejected',
      });
      fail(failures, 'foreign-key', 'Source media has an invalid owner.');
    }
    const object = objects.get(objectPath);
    if (!object) {
      fail(failures, 'referenced-media', 'Source media object is missing.');
    } else if (media.size_bytes !== null && object.bytes.byteLength !== media.size_bytes) {
      fail(failures, 'referenced-media', 'Source media byte count does not match metadata.');
    } else if (!effectiveContentType(media, object)) {
      fail(failures, 'referenced-media', 'Source media content type cannot be derived.');
    }
  }
  for (const object of source.storage) {
    if (!referenced.has(object.path)) {
      classifications.push({
        kind: 'unreferenced-storage-object',
        sourceId: object.path,
        disposition: 'preserved-in-raw-archive',
      });
    }
  }
  return objects;
}

async function writeExclusive(path: string, bytes: Uint8Array): Promise<void> {
  const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function sql(value: unknown): string | number | null {
  if (value === null || typeof value === 'string' || typeof value === 'number') return value;
  throw new Error('Validated source scalar is unavailable.');
}

async function validateProductionRepositories(databasePath: string, tripIds: string[], dataRoot: string): Promise<void> {
  const database = openPlotterDatabase(databasePath);
  try {
    await createSqliteDirectoryRepository(database, {} as WriteCoordinator, createMediaStore(dataRoot)).load();
    for (const tripId of tripIds) {
      await createSqliteTripRepository(database, {} as WriteCoordinator, tripId, createMediaStore(dataRoot)).load();
    }
  } finally {
    database.close();
  }
}

export async function materializeSource(options: MaterializeOptions): Promise<MaterializedSource> {
  const root = realpathSync(options.destinationRoot);
  if (!lstatSync(root).isDirectory()) throw new Error('Materialization root is invalid.');
  const mediaRoot = join(root, 'media');
  mkdirSync(mediaRoot, { mode: 0o700 });
  if (!isContained(realpathSync(mediaRoot), root)) throw new Error('Materialization root is invalid.');
  const databasePath = join(root, 'plotter.sqlite3');
  const failures: MigrationFailure[] = [];
  const orphanClassifications: OrphanClassification[] = [];
  const objects = validateSource(options.source, failures, orphanClassifications);
  const expectedMedia = new Map<string, { path: string; sha256: string; byteCount: number }>();

  const database = openPlotterDatabase(databasePath);
  try {
    if (failures.length === 0) {
      const connection = database.connection;
      connection.exec('BEGIN IMMEDIATE');
      try {
        const digest = sourceFingerprintDigest(options.fingerprint);
        const provenanceId = `supabase-${digest.slice(0, 32)}`;
        connection.prepare(`
          INSERT INTO migration_provenance (
            id, source, source_fingerprint, source_created_at, imported_at,
            archive_relative_path, details
          ) VALUES (?, 'supabase', ?, ?, ?, ?, ?)
        `).run(
          provenanceId,
          digest,
          null,
          options.importedAt,
          options.archiveRelativePath,
          json({
            sourceFingerprint: options.fingerprint,
            archivedOnlyTables: ['trip_members'],
            archivedOnlyColumns: { trips: ['metadata'] },
            derivedMediaFields: options.source.tables.media_assets
              .filter((row) => row.content_type === null || row.size_bytes === null)
              .map((row) => ({
                id: row.id,
                fields: [
                  ...(row.content_type === null ? ['content_type'] : []),
                  ...(row.size_bytes === null ? ['size_bytes'] : []),
                ],
              })),
          }),
        );
        const insertTrip = connection.prepare(`
          INSERT INTO trips (
            id, owner_user_id, name, description, vehicle_preset, vehicle_profile,
            vehicle_type, vehicle_restrictions, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const row of options.source.tables.trips) {
          insertTrip.run(
            sql(row.id), sql(row.owner_user_id), sql(row.name), sql(row.description),
            sql(row.vehicle_preset), sql(row.vehicle_profile), sql(row.vehicle_type),
            json(row.vehicle_restrictions), sql(row.created_at), sql(row.updated_at),
          );
          connection.prepare('INSERT INTO trip_revisions (trip_id, revision) VALUES (?, 0)').run(sql(row.id));
        }
        const insertDestination = connection.prepare(`
          INSERT INTO destinations (
            id, trip_id, name, country_region, lat, lng, location, stop_order, status,
            priority, timing, why, media, research, activities, route_context,
            routing_anchors, tags, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const row of options.source.tables.destinations) {
          insertDestination.run(
            sql(row.id), sql(row.trip_id), sql(row.name), sql(row.country_region),
            sql(row.lat), sql(row.lng), json(row.location), sql(row.stop_order),
            sql(row.status), sql(row.priority), json(row.timing),
            json(row.why), json(row.media), json(row.research), json(row.activities),
            json(row.route_context), json(row.routing_anchors), json(row.tags),
            sql(row.created_at), sql(row.updated_at),
          );
        }
        const insertRoute = connection.prepare(`
          INSERT INTO route_legs (
            id, trip_id, origin_destination_id, target_destination_id, movement,
            calculation_mode, ferry_policy, waypoints, sections, warnings, status,
            distance_km, travel_time_hours, geometry, provider, profile, route_key,
            calculated_at, error, provider_diagnostic, notes, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const row of options.source.tables.route_legs) {
          insertRoute.run(
            sql(row.id), sql(row.trip_id), sql(row.origin_destination_id),
            sql(row.target_destination_id), sql(row.movement), sql(row.calculation_mode),
            sql(row.ferry_policy), json(row.waypoints), json(row.sections), json(row.warnings),
            sql(row.status), sql(row.distance_km), sql(row.travel_time_hours),
            row.geometry === null ? null : json(row.geometry),
            sql(row.provider), sql(row.profile), sql(row.route_key), sql(row.calculated_at),
            sql(row.error),
            row.provider_diagnostic === null ? null : json(row.provider_diagnostic),
            sql(row.notes), sql(row.created_at), sql(row.updated_at),
          );
        }
        const insertActivity = connection.prepare(`
          INSERT INTO activities (
            id, trip_id, destination_id, activity_order, title, description, category,
            status, priority, location, links, notes, tags, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const row of options.source.tables.activities) {
          insertActivity.run(
            sql(row.id), sql(row.trip_id), sql(row.destination_id), sql(row.activity_order),
            sql(row.title), sql(row.description), sql(row.category), sql(row.status),
            sql(row.priority), row.location === null ? null : json(row.location),
            json(row.links), sql(row.notes), json(row.tags), sql(row.created_at),
            sql(row.updated_at),
          );
        }
        const insertMedia = connection.prepare(`
          INSERT INTO media_assets (
            id, trip_id, destination_id, activity_id, bucket_id, object_path,
            caption, credit, sort_order, content_type, size_bytes, uploaded_by,
            relative_path, sha256, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const row of options.source.tables.media_assets) {
          const object = objects.get(String(row.object_path))!;
          const contentType = effectiveContentType(row, object)!;
          const extension = CONTENT_TYPE_EXTENSIONS[contentType]!;
          const relativePath = `media/${String(row.id)}.${extension}`;
          const hash = createHash('sha256').update(object.bytes).digest('hex');
          await writeExclusive(join(root, relativePath), object.bytes);
          expectedMedia.set(String(row.id), {
            path: join(root, relativePath), sha256: hash, byteCount: object.bytes.byteLength,
          });
          insertMedia.run(
            sql(row.id), sql(row.trip_id), sql(row.destination_id), sql(row.activity_id),
            sql(row.bucket_id), sql(row.object_path), sql(row.caption), sql(row.credit),
            sql(row.sort_order), contentType, object.bytes.byteLength, sql(row.uploaded_by),
            relativePath, hash, sql(row.created_at), sql(row.updated_at),
          );
        }
        connection.prepare(`
          UPDATE store_metadata SET accepted_import_id = ? WHERE singleton = 1
        `).run(provenanceId);
        assertDatabaseIntegrity(connection);
        connection.exec('COMMIT');
      } catch (error) {
        connection.exec('ROLLBACK');
        throw error;
      }
    }
  } catch {
    fail(failures, 'materialization', 'Source rows could not be materialized safely.');
  } finally {
    database.close();
  }

  if (failures.length === 0) {
    try {
      await validateProductionRepositories(
        databasePath,
        options.source.tables.trips.map((row) => String(row.id)),
        root,
      );
    } catch {
      fail(failures, 'domain', 'Materialized rows do not deserialize through production repositories.');
    }
  }

  function validate(): void {
    if (failures.length > 0) throw new Error(failures[0]!.message);
    const reopened = openPlotterDatabase(databasePath);
    try {
      assertDatabaseIntegrity(reopened.connection);
      for (const expected of expectedMedia.values()) {
        const bytes = readFileSyncSafe(expected.path);
        if (
          bytes.byteLength !== expected.byteCount
          || createHash('sha256').update(bytes).digest('hex') !== expected.sha256
        ) throw new Error('Materialized media bytes changed.');
      }
    } finally {
      reopened.close();
    }
  }

  return {
    root, databasePath, mediaRoot, promotable: failures.length === 0,
    failures, orphanClassifications, validate,
  };
}

function readFileSyncSafe(path: string): Uint8Array {
  try {
    const metadata = lstatSync(path);
    return new Uint8Array(
      metadata.isFile() && !metadata.isSymbolicLink() ? readFileSync(path) : Buffer.alloc(0),
    );
  } catch {
    return new Uint8Array();
  }
}
