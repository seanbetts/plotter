export const LATEST_SCHEMA_VERSION = 1;
// SHA-256 of ordered, non-internal sqlite_schema rows created by migration 1.
export const SCHEMA_V1_FINGERPRINT = 'a970938c51bab123ceda51920ef60615eaccfbe6a98f35700cc49697efef1b24';

export const REQUIRED_SCHEMA_TABLES = [
  'activities',
  'destinations',
  'media_assets',
  'migration_provenance',
  'route_legs',
  'schema_metadata',
  'store_metadata',
  'trip_revisions',
  'trips',
] as const;

export const REQUIRED_SCHEMA_INDEXES = [
  'activities_trip_destination_order_idx',
  'activities_trip_updated_at_idx',
  'destinations_trip_order_idx',
  'destinations_trip_updated_at_idx',
  'media_assets_activity_owned_sort_order_key',
  'media_assets_destination_owned_sort_order_key',
  'media_assets_trip_destination_activity_idx',
  'route_legs_origin_destination_idx',
  'route_legs_target_destination_idx',
  'route_legs_trip_updated_at_idx',
  'trips_updated_created_idx',
] as const;

export type SchemaMigration = {
  version: number;
  sql: string;
};

export const SCHEMA_MIGRATIONS: readonly SchemaMigration[] = [{
  version: 1,
  sql: `
    CREATE TABLE migration_provenance (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      source_fingerprint TEXT NOT NULL UNIQUE,
      source_created_at TEXT,
      imported_at TEXT NOT NULL,
      archive_relative_path TEXT NOT NULL,
      details TEXT NOT NULL CHECK (json_valid(details))
    ) STRICT;

    CREATE TABLE schema_metadata (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE store_metadata (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
      directory_revision INTEGER NOT NULL DEFAULT 0 CHECK (directory_revision >= 0),
      accepted_import_id TEXT REFERENCES migration_provenance(id) ON DELETE RESTRICT
    ) STRICT;

    CREATE TABLE trips (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      vehicle_preset TEXT,
      vehicle_profile TEXT,
      vehicle_type TEXT,
      vehicle_restrictions TEXT CHECK (vehicle_restrictions IS NULL OR json_valid(vehicle_restrictions)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE destinations (
      id TEXT NOT NULL,
      trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      country_region TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      location TEXT NOT NULL CHECK (json_valid(location)),
      stop_order INTEGER NOT NULL,
      status TEXT NOT NULL,
      priority TEXT NOT NULL,
      timing TEXT NOT NULL CHECK (json_valid(timing)),
      why TEXT NOT NULL CHECK (json_valid(why)),
      media TEXT NOT NULL CHECK (json_valid(media)),
      research TEXT NOT NULL CHECK (json_valid(research)),
      activities TEXT NOT NULL CHECK (json_valid(activities)),
      route_context TEXT NOT NULL CHECK (json_valid(route_context)),
      routing_anchors TEXT CHECK (routing_anchors IS NULL OR json_valid(routing_anchors)),
      tags TEXT NOT NULL CHECK (json_valid(tags)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (trip_id, id)
    ) STRICT;

    CREATE TABLE route_legs (
      id TEXT NOT NULL,
      trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      origin_destination_id TEXT NOT NULL,
      target_destination_id TEXT NOT NULL,
      movement TEXT NOT NULL,
      calculation_mode TEXT NOT NULL,
      ferry_policy TEXT,
      waypoints TEXT CHECK (waypoints IS NULL OR json_valid(waypoints)),
      sections TEXT CHECK (sections IS NULL OR json_valid(sections)),
      warnings TEXT CHECK (warnings IS NULL OR json_valid(warnings)),
      status TEXT NOT NULL,
      distance_km REAL,
      travel_time_hours REAL,
      geometry TEXT CHECK (geometry IS NULL OR json_valid(geometry)),
      provider TEXT,
      profile TEXT,
      route_key TEXT,
      calculated_at TEXT,
      error TEXT,
      provider_diagnostic TEXT CHECK (provider_diagnostic IS NULL OR json_valid(provider_diagnostic)),
      notes TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (trip_id, id),
      FOREIGN KEY (trip_id, origin_destination_id)
        REFERENCES destinations(trip_id, id) ON DELETE CASCADE,
      FOREIGN KEY (trip_id, target_destination_id)
        REFERENCES destinations(trip_id, id) ON DELETE CASCADE
    ) STRICT;

    CREATE TABLE activities (
      id TEXT PRIMARY KEY,
      trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      destination_id TEXT NOT NULL,
      activity_order INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      status TEXT NOT NULL,
      priority TEXT NOT NULL,
      location TEXT CHECK (location IS NULL OR json_valid(location)),
      links TEXT NOT NULL CHECK (json_valid(links)),
      notes TEXT NOT NULL,
      tags TEXT NOT NULL CHECK (json_valid(tags)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (trip_id, destination_id, id),
      FOREIGN KEY (trip_id, destination_id)
        REFERENCES destinations(trip_id, id) ON DELETE CASCADE
    ) STRICT;

    CREATE TABLE media_assets (
      id TEXT PRIMARY KEY,
      trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      destination_id TEXT NOT NULL,
      activity_id TEXT,
      bucket_id TEXT NOT NULL,
      object_path TEXT NOT NULL,
      caption TEXT NOT NULL,
      credit TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      content_type TEXT,
      size_bytes INTEGER,
      uploaded_by TEXT NOT NULL,
      relative_path TEXT NOT NULL UNIQUE,
      sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (bucket_id, object_path),
      FOREIGN KEY (trip_id, destination_id)
        REFERENCES destinations(trip_id, id) ON DELETE CASCADE,
      FOREIGN KEY (trip_id, destination_id, activity_id)
        REFERENCES activities(trip_id, destination_id, id) ON DELETE CASCADE
    ) STRICT;

    CREATE TABLE trip_revisions (
      trip_id TEXT PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
    ) STRICT;

    CREATE INDEX trips_updated_created_idx
    ON trips(updated_at DESC, created_at DESC);

    CREATE INDEX destinations_trip_order_idx
    ON destinations(trip_id, stop_order, created_at);

    CREATE INDEX destinations_trip_updated_at_idx
    ON destinations(trip_id, updated_at);

    CREATE INDEX route_legs_trip_updated_at_idx
    ON route_legs(trip_id, updated_at);

    CREATE INDEX route_legs_origin_destination_idx
    ON route_legs(trip_id, origin_destination_id);

    CREATE INDEX route_legs_target_destination_idx
    ON route_legs(trip_id, target_destination_id);

    CREATE INDEX activities_trip_destination_order_idx
    ON activities(trip_id, destination_id, activity_order, created_at);

    CREATE INDEX activities_trip_updated_at_idx
    ON activities(trip_id, updated_at);

    CREATE UNIQUE INDEX media_assets_destination_owned_sort_order_key
    ON media_assets(trip_id, destination_id, sort_order)
    WHERE activity_id IS NULL;

    CREATE UNIQUE INDEX media_assets_activity_owned_sort_order_key
    ON media_assets(trip_id, destination_id, activity_id, sort_order)
    WHERE activity_id IS NOT NULL;

    CREATE INDEX media_assets_trip_destination_activity_idx
    ON media_assets(trip_id, destination_id, activity_id);

    INSERT INTO schema_metadata (version, applied_at)
    VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

    INSERT INTO store_metadata (singleton, schema_version, directory_revision, accepted_import_id)
    VALUES (1, 1, 0, NULL);
  `,
}];
