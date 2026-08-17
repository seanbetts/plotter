import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  LATEST_SCHEMA_VERSION,
  REQUIRED_SCHEMA_INDEXES,
  REQUIRED_SCHEMA_TABLES,
  SCHEMA_MIGRATIONS,
  SCHEMA_V1_FINGERPRINT,
} from './schema';

const BUSY_TIMEOUT_MILLISECONDS = 5_000;
const INTEGRITY_ERROR_MESSAGE = 'Plotter database integrity validation failed.';
const UNSUPPORTED_SCHEMA_ERROR_MESSAGE = 'Plotter database schema is not supported.';
const DATABASE_UNAVAILABLE_ERROR_MESSAGE = 'Plotter database is unavailable.';

class UnsupportedSchemaError extends Error {
  constructor() {
    super(UNSUPPORTED_SCHEMA_ERROR_MESSAGE);
    this.name = 'UnsupportedSchemaError';
  }
}

class DatabaseUnavailableError extends Error {
  constructor() {
    super(DATABASE_UNAVAILABLE_ERROR_MESSAGE);
    this.name = 'DatabaseUnavailableError';
  }
}

class DatabaseIntegrityError extends Error {
  constructor() {
    super(INTEGRITY_ERROR_MESSAGE);
    this.name = 'DatabaseIntegrityError';
  }
}

export type PlotterDatabase = {
  connection: DatabaseSync;
  schemaVersion: number;
  close(): void;
};

function applyMigrations(connection: DatabaseSync, currentVersion: number): void {
  for (const migration of SCHEMA_MIGRATIONS) {
    if (migration.version <= currentVersion) {
      continue;
    }

    connection.exec('BEGIN IMMEDIATE');
    try {
      connection.exec(migration.sql);
      connection.exec(`PRAGMA user_version = ${migration.version}`);
      connection.exec('COMMIT');
    } catch (error) {
      connection.exec('ROLLBACK');
      throw error;
    }
  }
}

function assertSupportedSchemaVersion(connection: DatabaseSync, version: number): void {
  if (version > LATEST_SCHEMA_VERSION) {
    throw new UnsupportedSchemaError();
  }

  if (version === 0) {
    const schemaRow = connection.prepare(`
      SELECT COUNT(*) AS count
      FROM sqlite_schema
      WHERE name NOT LIKE 'sqlite_%'
    `).get() as { count: number };

    if (schemaRow.count !== 0) {
      throw new UnsupportedSchemaError();
    }
  }
}

function assertCurrentSchemaMetadata(connection: DatabaseSync): void {
  const storeRow = connection.prepare(`
    SELECT schema_version
    FROM store_metadata
    WHERE singleton = 1
  `).get() as { schema_version?: unknown } | undefined;
  const migrationRow = connection.prepare('SELECT MAX(version) AS version FROM schema_metadata').get() as {
    version?: unknown;
  } | undefined;

  if (
    storeRow?.schema_version !== LATEST_SCHEMA_VERSION
    || migrationRow?.version !== LATEST_SCHEMA_VERSION
  ) {
    throw new UnsupportedSchemaError();
  }
}

function assertCurrentSchemaShape(connection: DatabaseSync): void {
  const tableNames = connection.prepare(`
    SELECT name
    FROM sqlite_schema
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all().map((row) => (row as { name: string }).name);

  if (
    tableNames.length !== REQUIRED_SCHEMA_TABLES.length
    || tableNames.some((name, index) => name !== REQUIRED_SCHEMA_TABLES[index])
  ) {
    throw new UnsupportedSchemaError();
  }

  const indexNames = connection.prepare(`
    SELECT name
    FROM sqlite_schema
    WHERE type = 'index' AND name NOT LIKE 'sqlite_autoindex_%'
    ORDER BY name
  `).all().map((row) => (row as { name: string }).name);

  if (
    indexNames.length !== REQUIRED_SCHEMA_INDEXES.length
    || indexNames.some((name, index) => name !== REQUIRED_SCHEMA_INDEXES[index])
  ) {
    throw new UnsupportedSchemaError();
  }

  const schemaRows = connection.prepare(`
    SELECT type, name, tbl_name, sql
    FROM sqlite_schema
    WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL
    ORDER BY type, name
  `).all();
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(schemaRows))
    .digest('hex');

  if (fingerprint !== SCHEMA_V1_FINGERPRINT) {
    throw new UnsupportedSchemaError();
  }
}

export function openPlotterDatabase(databasePath: string): PlotterDatabase {
  let connection: DatabaseSync | undefined;

  try {
    connection = new DatabaseSync(databasePath);
    connection.exec('PRAGMA foreign_keys = ON');
    connection.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MILLISECONDS}`);
    connection.prepare('PRAGMA journal_mode = WAL').get();

    const versionRow = connection.prepare('PRAGMA user_version').get() as { user_version: number };
    assertSupportedSchemaVersion(connection, versionRow.user_version);
    applyMigrations(connection, versionRow.user_version);
    assertCurrentSchemaShape(connection);
    assertCurrentSchemaMetadata(connection);
    assertDatabaseIntegrity(connection);
    const openedConnection = connection;

    return {
      connection: openedConnection,
      schemaVersion: LATEST_SCHEMA_VERSION,
      close() {
        openedConnection.close();
      },
    };
  } catch (error) {
    try {
      connection?.close();
    } catch {
      // Preserve the stable readiness error rather than leaking SQLite detail.
    }

    if (error instanceof UnsupportedSchemaError || error instanceof DatabaseIntegrityError) {
      throw error;
    }
    throw new DatabaseUnavailableError();
  }
}

export function assertDatabaseIntegrity(connection: DatabaseSync): void {
  try {
    const integrityRows = connection.prepare('PRAGMA integrity_check').all();
    const foreignKeyViolations = connection.prepare('PRAGMA foreign_key_check').all();

    if (
      integrityRows.length !== 1
      || (integrityRows[0] as { integrity_check?: unknown } | undefined)?.integrity_check !== 'ok'
      || foreignKeyViolations.length > 0
    ) {
      throw new DatabaseIntegrityError();
    }
  } catch (error) {
    if (error instanceof DatabaseIntegrityError) {
      throw error;
    }
    throw new DatabaseIntegrityError();
  }
}
