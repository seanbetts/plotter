import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { BackupManifest } from '../../src/api/contracts';
import type { MaterializedSource, MigrationFailure, OrphanClassification } from './materialize';
import {
  SOURCE_TABLES,
  type SourceCaptureProvenance,
  type SourceFingerprint,
  type SourceSnapshot,
  type SourceTableName,
} from './source';

export type ReconciliationReport = {
  passed: boolean;
  source: SourceFingerprint;
  destinationCounts: Record<string, number>;
  preservedSourceIds: Record<string, boolean>;
  orphanClassifications: Array<{ kind: string; sourceId: string; disposition: string }>;
  media: { objectCount: number; byteCount: number; hashesMatch: boolean };
  failures: Array<{ gate: string; message: string }>;
  candidatePackage?: {
    backupId: string;
    byteCount: number;
    sha256: string;
    manifest: BackupManifest;
  };
  provenance?: SourceCaptureProvenance;
};

type ReconcileOptions = {
  source: SourceSnapshot;
  fingerprint: SourceFingerprint;
  materialized: MaterializedSource;
};

const TABLE_IDS: Record<Exclude<SourceTableName, 'trip_members'>, readonly string[]> = {
  trips: ['id'], destinations: ['id'], route_legs: ['id'], activities: ['id'], media_assets: ['id'],
};

function rowId(row: Record<string, unknown>, columns: readonly string[]): string {
  return columns.map((column) => String(row[column])).join('\0');
}

function sorted(values: string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function equal(left: string[], right: string[]): boolean {
  const first = sorted(left);
  const second = sorted(right);
  return first.length === second.length && first.every((value, index) => value === second[index]);
}

function pushFailure(failures: MigrationFailure[], gate: string, message: string): void {
  if (!failures.some((failure) => failure.gate === gate && failure.message === message)) {
    failures.push({ gate, message });
  }
}

export function reconcileMaterialization(options: ReconcileOptions): ReconciliationReport {
  const failures = options.materialized.failures.map((failure) => ({ ...failure }));
  try {
    options.materialized.validate();
  } catch (error) {
    pushFailure(
      failures,
      'integrity',
      error instanceof Error ? error.message : 'Materialized state validation failed.',
    );
  }
  const destinationCounts: Record<string, number> = {};
  const preservedSourceIds: Record<string, boolean> = {};
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(options.materialized.databasePath, { readOnly: true });
    for (const table of Object.keys(TABLE_IDS) as Array<keyof typeof TABLE_IDS>) {
      const rows = database.prepare(`SELECT id FROM ${table} ORDER BY id`).all() as Array<{ id: string }>;
      destinationCounts[table] = rows.length;
      const sourceIds = options.source.tables[table].map((row) => rowId(row, TABLE_IDS[table]));
      const destinationIds = rows.map((row) => row.id);
      const duplicate = new Set(sourceIds).size !== sourceIds.length;
      preservedSourceIds[table] = !duplicate && equal(sourceIds, destinationIds);
      if (duplicate) pushFailure(failures, 'identity', 'Source row identity is duplicate.');
      else if (!preservedSourceIds[table]) pushFailure(failures, 'count-id', 'Source row identities were not preserved.');
    }
  } catch {
    for (const table of Object.keys(TABLE_IDS)) {
      destinationCounts[table] ??= 0;
      preservedSourceIds[table] ??= false;
    }
    pushFailure(failures, 'integrity', 'Materialized database could not be reconciled.');
  } finally {
    database?.close();
  }
  const memberClassifications = new Set(
    options.materialized.orphanClassifications
      .filter((item) => item.kind === 'trip-member')
      .map((item) => item.sourceId),
  );
  const memberIds = options.source.tables.trip_members.map((row) => `${row.trip_id}\0${row.user_id}`);
  preservedSourceIds.trip_members = memberIds.every((id) => memberClassifications.has(id));
  destinationCounts.trip_members = 0;
  if (!preservedSourceIds.trip_members) {
    pushFailure(failures, 'classification', 'Archived-only trip members were not classified.');
  }

  let hashesMatch = true;
  const mediaRows = options.source.tables.media_assets;
  for (const row of mediaRows) {
    const object = options.source.storage.find((item) => item.path === row.object_path);
    const sourceContentType = row.content_type ?? object?.listing.metadata?.mimetype;
    const extension = sourceContentType === 'image/jpeg' ? 'jpg'
      : sourceContentType === 'image/png' ? 'png'
        : sourceContentType === 'image/webp' ? 'webp'
          : sourceContentType === 'image/gif' ? 'gif'
            : String(row.object_path).toLowerCase().endsWith('.png') ? 'png'
              : String(row.object_path).toLowerCase().endsWith('.webp') ? 'webp'
                : String(row.object_path).toLowerCase().endsWith('.gif') ? 'gif'
                  : /\.jpe?g$/i.test(String(row.object_path)) ? 'jpg' : '';
    if (!object || !extension) {
      hashesMatch = false;
      continue;
    }
    try {
      const bytes = readFileSync(`${options.materialized.mediaRoot}/${String(row.id)}.${extension}`);
      hashesMatch = hashesMatch
        && bytes.byteLength === object.bytes.byteLength
        && createHash('sha256').update(bytes).digest('hex')
          === createHash('sha256').update(object.bytes).digest('hex');
    } catch {
      hashesMatch = false;
    }
  }
  if (!hashesMatch) pushFailure(failures, 'media', 'Materialized media hashes do not match the source.');

  const report: ReconciliationReport = {
    passed: failures.length === 0,
    source: options.fingerprint,
    destinationCounts,
    preservedSourceIds: Object.fromEntries(SOURCE_TABLES.map((table) => [table, preservedSourceIds[table] ?? false])),
    orphanClassifications: options.materialized.orphanClassifications.map((item: OrphanClassification) => ({ ...item })),
    media: {
      objectCount: options.source.storage.length,
      byteCount: options.source.storage.reduce((total, object) => total + object.bytes.byteLength, 0),
      hashesMatch,
    },
    failures,
  };
  return report;
}
