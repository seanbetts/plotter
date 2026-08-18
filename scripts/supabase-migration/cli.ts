import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';
import { execFile } from 'node:child_process';
import { constants, existsSync, lstatSync, mkdirSync, realpathSync, renameSync } from 'node:fs';
import { link, mkdtemp, open, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve, sep } from 'node:path';
import { openPlotterDatabase, type PlotterDatabase } from '../../server/database';
import { acquireDataDirectoryOwnership } from '../../server/maintenanceLock';
import {
  createPortableBackupOperations,
  recoverInterruptedPortableRestore,
} from '../../server/portableBackup';
import { createRawArchive } from './archive';
import { materializeSource } from './materialize';
import { reconcileMaterialization, type ReconciliationReport } from './reconcile';
import {
  SOURCE_TABLES,
  canonicalJson,
  createSupabaseSourceBackend,
  fingerprintSourceSnapshot,
  readSourceSnapshot,
  sourceFingerprintDigest,
  validateSourceSchema,
  validateStorageObjectBytes,
  type SourceSchema,
  type SourceSnapshot,
  type SourceStorageEntry,
} from './source';

export type MigrationMode = 'dry-run' | 'apply';

export type MigrationArguments = {
  mode: MigrationMode;
  fixturePath?: string;
  dataDirectory?: string;
  confirmSourceFingerprint?: string;
};

export type MigrationRunResult = {
  applied: boolean;
  stagingId: string;
  stagingLabel: string;
  sourceFingerprintDigest: string;
  report: ReconciliationReport;
  preImportBackupId?: string;
};

type CommandResult = { stdout: string };
type CommandOptions = { cwd: string; environment: Record<string, string | undefined> };

type RunDependencies = {
  environment?: Record<string, string | undefined>;
  runCommand?(file: string, arguments_: string[], options: CommandOptions): Promise<CommandResult>;
  createClient?(url: string, key: string, options: Record<string, unknown>): SupabaseClient;
  loadFixture?(path: string): Promise<LoadedFixtureSource>;
  readLinkedProjectReference?(repositoryRoot: string): Promise<string>;
  createTemporaryStagingParent?(): Promise<string>;
  log?(message: string): void;
};

export const MIGRATION_HELP = `Usage: npm run migrate:supabase -- (--dry-run | --apply) [options]

Options:
  --dry-run                         Stage, materialize, reconcile, and retain without promotion
  --apply                           Promote only after all gates and exact confirmation
  --fixture <path>                  Use a synthetic fixture; bypass credentials, CLI, and network
  --data-dir <path>                 Canonical Plotter data root (required for apply and live mode)
  --confirm-source-fingerprint <sha256>
                                    Exact full fingerprint required for apply
  --help                            Show this help
`;

export type LoadedFixtureSource = {
  schema: SourceSchema;
  source: SourceSnapshot;
  rawSchemaSql: string;
  rawDataSql: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function loadFixtureSource(path: string): Promise<LoadedFixtureSource> {
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (!isRecord(parsed) || !isRecord(parsed.schema) || !isRecord(parsed.tables)
    || !Array.isArray(parsed.storage) || typeof parsed.rawSchemaSql !== 'string'
    || typeof parsed.rawDataSql !== 'string') {
    throw new Error('Supabase migration fixture is invalid.');
  }
  const schema = parsed.schema as Record<string, readonly string[]>;
  validateSourceSchema(schema);
  const tables = parsed.tables as SourceSnapshot['tables'];
  const storage = parsed.storage.map((value) => {
    if (!isRecord(value) || typeof value.path !== 'string' || !isRecord(value.listing)
      || typeof value.base64 !== 'string') throw new Error('Supabase migration fixture is invalid.');
    const bytes = Buffer.from(value.base64, 'base64');
    if (bytes.toString('base64') !== value.base64) throw new Error('Supabase migration fixture is invalid.');
    validateStorageObjectBytes(value.listing as SourceStorageEntry, bytes);
    return {
      path: value.path,
      listing: value.listing as SourceStorageEntry,
      bytes: new Uint8Array(bytes),
    };
  });
  const loaded = {
    schema,
    source: { tables, storage },
    rawSchemaSql: parsed.rawSchemaSql,
    rawDataSql: parsed.rawDataSql,
  };
  validateFixtureRawDumps(loaded);
  return loaded;
}

export type ParsedMigrationArguments = MigrationArguments | { help: true };

export function parseMigrationArguments(arguments_: string[]): ParsedMigrationArguments {
  if (arguments_.includes('--help')) {
    if (arguments_.length !== 1) throw new Error('--help cannot be combined with migration options.');
    return { help: true };
  }
  let mode: MigrationMode | undefined;
  let fixturePath: string | undefined;
  let dataDirectory: string | undefined;
  let confirmSourceFingerprint: string | undefined;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    if (argument === '--dry-run' || argument === '--apply') {
      if (mode !== undefined) throw new Error('Choose exactly one of --dry-run or --apply.');
      mode = argument === '--dry-run' ? 'dry-run' : 'apply';
      continue;
    }
    const value = arguments_[index + 1];
    if (['--fixture', '--data-dir', '--confirm-source-fingerprint'].includes(argument)) {
      if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${argument}.`);
      index += 1;
      if (argument === '--fixture') {
        if (fixturePath !== undefined) throw new Error('--fixture may be supplied only once.');
        fixturePath = value;
      } else if (argument === '--data-dir') {
        if (dataDirectory !== undefined) throw new Error('--data-dir may be supplied only once.');
        dataDirectory = value;
      } else {
        if (confirmSourceFingerprint !== undefined) {
          throw new Error('--confirm-source-fingerprint may be supplied only once.');
        }
        confirmSourceFingerprint = value;
      }
      continue;
    }
    throw new Error(`Unknown migration option: ${argument}`);
  }
  if (mode === undefined) throw new Error('Choose exactly one of --dry-run or --apply.');
  return {
    mode,
    ...(fixturePath === undefined ? {} : { fixturePath }),
    ...(dataDirectory === undefined ? {} : { dataDirectory }),
    ...(confirmSourceFingerprint === undefined ? {} : { confirmSourceFingerprint }),
  };
}

function isContained(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}${sep}`);
}

function ensureDirectory(path: string, root: string): string {
  if (!existsSync(path)) mkdirSync(path, { mode: 0o700 });
  const metadata = lstatSync(path);
  const canonical = realpathSync(path);
  if (metadata.isSymbolicLink() || !metadata.isDirectory() || !isContained(canonical, root)) {
    throw new Error('Migration staging directory is invalid.');
  }
  return canonical;
}

export async function defaultRunCommand(
  file: string,
  arguments_: string[],
  options: CommandOptions,
): Promise<CommandResult> {
  return new Promise((resolvePromise, reject) => {
    execFile(file, arguments_, {
      cwd: options.cwd,
      env: options.environment,
      maxBuffer: 32 * 1024 * 1024,
    }, (error, stdout) => {
      if (error) {
        reject(new Error('Supabase CLI verification or dump failed.'));
        return;
      }
      resolvePromise({ stdout: String(stdout) });
    });
  });
}

const supabaseCliEnvironmentNames = [
  'HOME',
  'PATH',
  'TMPDIR',
  'XDG_CONFIG_HOME',
  'SUPABASE_ACCESS_TOKEN',
] as const;

function createSupabaseCliEnvironment(
  environment: Record<string, string | undefined>,
): Record<string, string> {
  const safeEnvironment: Record<string, string> = {};
  for (const name of supabaseCliEnvironmentNames) {
    const value = environment[name];
    if (value !== undefined) safeEnvironment[name] = value;
  }
  return safeEnvironment;
}

function decodeJwtJsonSegment(segment: string): Record<string, unknown> | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) return undefined;
  const bytes = Buffer.from(segment, 'base64url');
  if (bytes.length === 0 || bytes.toString('base64url') !== segment) return undefined;
  try {
    const value: unknown = JSON.parse(bytes.toString('utf8'));
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function isProjectWideSecretKey(value: string): boolean {
  if (/^sb_secret_\S+$/.test(value)) return true;
  const segments = value.split('.');
  if (segments.length !== 3) return false;
  const header = decodeJwtJsonSegment(segments[0]!);
  const payload = decodeJwtJsonSegment(segments[1]!);
  const signature = segments[2]!;
  return header !== undefined
    && typeof header.alg === 'string'
    && header.alg.length > 0
    && payload?.role === 'service_role'
    && /^[A-Za-z0-9_-]+$/.test(signature)
    && Buffer.from(signature, 'base64url').toString('base64url') === signature;
}

function assertProjectWideSecretKey(value: string): void {
  // This rejects obviously partial-project credentials; Supabase remains the
  // authority that authenticates the supplied key during the source reads.
  if (!isProjectWideSecretKey(value)) {
    throw new Error(
      'PLOTTER_SUPABASE_SECRET_KEY must be a Supabase secret or service_role key.',
    );
  }
}

function projectReference(urlValue: string): string {
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    throw new Error('PLOTTER_SUPABASE_URL is invalid.');
  }
  const match = /^([a-z0-9]+)\.supabase\.co$/i.exec(url.hostname);
  if (url.protocol !== 'https:' || !match) throw new Error('PLOTTER_SUPABASE_URL is invalid.');
  return match[1]!;
}

function parseProjectList(stdout: string): Record<string, unknown>[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error('Supabase CLI authentication could not be verified.');
  }
  const projects = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.projects) ? parsed.projects : undefined;
  if (!projects || !projects.every(isRecord)) {
    throw new Error('Supabase CLI authentication could not be verified.');
  }
  return projects;
}

export function parsePublicTableSchema(sql: string): SourceSchema {
  const schema: Record<string, string[]> = {};
  const tablePattern = /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:"public"|public)\.(?:"([^"]+)"|([a-zA-Z_][a-zA-Z0-9_]*))\s*\(([\s\S]*?)\n\);/g;
  for (const match of sql.matchAll(tablePattern)) {
    const table = match[1] ?? match[2]!;
    const columns: string[] = [];
    for (const line of match[3]!.split('\n')) {
      const trimmed = line.trim();
      const column = /^(?:"([^"]+)"|([a-zA-Z_][a-zA-Z0-9_]*))\s+/.exec(trimmed);
      if (!column) continue;
      const name = column[1] ?? column[2]!;
      if (['CONSTRAINT', 'PRIMARY', 'UNIQUE', 'CHECK', 'FOREIGN', 'EXCLUDE'].includes(name.toUpperCase())) {
        continue;
      }
      columns.push(name);
    }
    schema[table] = columns;
  }
  validateSourceSchema(schema);
  return schema;
}

const fixtureJsonColumns: Partial<Record<(typeof SOURCE_TABLES)[number], Set<string>>> = {
  trips: new Set(['metadata', 'vehicle_restrictions']),
  destinations: new Set([
    'location', 'timing', 'why', 'media', 'research', 'activities', 'route_context',
    'routing_anchors',
  ]),
  route_legs: new Set(['geometry', 'waypoints', 'sections', 'warnings', 'provider_diagnostic']),
  activities: new Set(['location', 'links']),
};

const fixtureTextArrayColumns: Partial<Record<(typeof SOURCE_TABLES)[number], Set<string>>> = {
  destinations: new Set(['tags']),
  activities: new Set(['tags']),
};

function decodeCopyText(value: string): string {
  const replacements: Record<string, string> = {
    b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '\\': '\\',
  };
  return value.replace(/\\([bfnrtv\\])/g, (_match, escaped: string) => replacements[escaped]!);
}

function encodePostgresTextArray(value: unknown[]): string {
  return `{${value.map((item) => {
    if (typeof item !== 'string') throw new Error('invalid text array');
    return /^[a-zA-Z0-9_-]+$/.test(item)
      ? item
      : `"${item.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
  }).join(',')}}`;
}

function fixtureCopyCellMatches(
  table: (typeof SOURCE_TABLES)[number],
  column: string,
  rawValue: string,
  expectedValue: unknown,
): boolean {
  if (expectedValue === null) return rawValue === '\\N';
  if (rawValue === '\\N') return false;
  const value = decodeCopyText(rawValue);
  if (fixtureJsonColumns[table]?.has(column)) {
    try {
      return canonicalJson(JSON.parse(value)) === canonicalJson(expectedValue);
    } catch {
      return false;
    }
  }
  if (fixtureTextArrayColumns[table]?.has(column)) {
    return Array.isArray(expectedValue) && value === encodePostgresTextArray(expectedValue);
  }
  if (typeof expectedValue === 'number') {
    return Number.isFinite(expectedValue) && Number(value) === expectedValue;
  }
  if (typeof expectedValue !== 'string') return false;
  if (column.endsWith('_at')) {
    return !Number.isNaN(Date.parse(value)) && Date.parse(value) === Date.parse(expectedValue);
  }
  return value === expectedValue;
}

function validateFixtureRawDumps(fixture: LoadedFixtureSource): void {
  try {
    const rawSchema = parsePublicTableSchema(fixture.rawSchemaSql);
    for (const table of Object.keys(fixture.schema) as Array<keyof SourceSchema>) {
      if (JSON.stringify(rawSchema[table]) !== JSON.stringify(fixture.schema[table])) {
        throw new Error('schema mismatch');
      }
    }
    const inventories = new Map<string, { columns: string[]; rows: string[][] }>();
    const copyPattern = /COPY\s+(?:"public"|public)\.(?:"([^"]+)"|([a-zA-Z_][a-zA-Z0-9_]*))\s*\(([^)]*)\)\s+FROM stdin;\r?\n([\s\S]*?)\r?\n\\\.\r?(?:\n|$)/g;
    for (const match of fixture.rawDataSql.matchAll(copyPattern)) {
      const table = match[1] ?? match[2]!;
      if (inventories.has(table)) throw new Error('duplicate COPY');
      const columns = match[3]!.split(',').map((column) => {
        const trimmed = column.trim();
        return trimmed.startsWith('"') && trimmed.endsWith('"')
          ? trimmed.slice(1, -1).replaceAll('""', '"')
          : trimmed;
      });
      inventories.set(table, {
        columns,
        rows: match[4]!.length === 0
          ? []
          : match[4]!.split(/\r?\n/).map((row) => row.split('\t')),
      });
    }
    if (inventories.size !== SOURCE_TABLES.length) throw new Error('COPY count mismatch');
    for (const table of SOURCE_TABLES) {
      const inventory = inventories.get(table);
      if (!inventory
        || JSON.stringify(inventory.columns) !== JSON.stringify(fixture.schema[table])
        || inventory.rows.length !== fixture.source.tables[table].length) {
        throw new Error('COPY inventory mismatch');
      }
      for (const [rowIndex, rawRow] of inventory.rows.entries()) {
        const structuredRow = fixture.source.tables[table][rowIndex]!;
        if (rawRow.length !== inventory.columns.length
          || inventory.columns.some((column, columnIndex) => !fixtureCopyCellMatches(
            table,
            column,
            rawRow[columnIndex]!,
            structuredRow[column],
          ))) throw new Error('COPY row mismatch');
      }
    }
  } catch {
    throw new Error('Supabase migration fixture raw dumps are inconsistent.');
  }
}

async function captureLiveSource(
  repositoryRoot: string,
  dependencies: RunDependencies,
): Promise<LoadedFixtureSource> {
  const environment = dependencies.environment ?? process.env;
  const url = environment.PLOTTER_SUPABASE_URL;
  const secretKey = environment.PLOTTER_SUPABASE_SECRET_KEY;
  const databasePassword = environment.PLOTTER_SUPABASE_DB_PASSWORD;
  if (!url || !secretKey) {
    throw new Error('PLOTTER_SUPABASE_URL and PLOTTER_SUPABASE_SECRET_KEY are required.');
  }
  if (!databasePassword) throw new Error('PLOTTER_SUPABASE_DB_PASSWORD is required.');
  assertProjectWideSecretKey(secretKey);
  const expectedProjectReference = projectReference(url);
  const runCommand = dependencies.runCommand ?? defaultRunCommand;
  const localSupabaseExecutable = resolve(repositoryRoot, 'node_modules', '.bin', 'supabase');
  const supabaseExecutable = existsSync(localSupabaseExecutable)
    ? localSupabaseExecutable
    : 'supabase';
  const cliEnvironment = createSupabaseCliEnvironment(environment);
  const commandOptions = { cwd: repositoryRoot, environment: cliEnvironment };
  const projects = parseProjectList((await runCommand(
    supabaseExecutable,
    ['projects', 'list', '--output-format', 'json'],
    commandOptions,
  )).stdout);
  if (!projects.some((project) => [project.id, project.ref, project.project_ref]
    .includes(expectedProjectReference))) {
    throw new Error('Supabase CLI authentication does not include the source project.');
  }
  let linkedProjectReference: string;
  try {
    linkedProjectReference = dependencies.readLinkedProjectReference
      ? (await dependencies.readLinkedProjectReference(repositoryRoot)).trim()
      : (await readFile(
        join(repositoryRoot, 'supabase', '.temp', 'project-ref'),
        'utf8',
      )).trim();
  } catch {
    throw new Error('Supabase CLI linked project could not be verified.');
  }
  if (linkedProjectReference !== expectedProjectReference) {
    throw new Error('Supabase CLI linked project does not match the source URL.');
  }

  const dumpRoot = await mkdtemp(join(tmpdir(), 'plotter-supabase-read-'));
  try {
    const schemaPath = join(dumpRoot, 'schema.sql');
    const dataPath = join(dumpRoot, 'data.sql');
    const dumpCommandOptions = {
      cwd: repositoryRoot,
      environment: { ...cliEnvironment, SUPABASE_DB_PASSWORD: databasePassword },
    };
    await runCommand(supabaseExecutable, [
      'db', 'dump', '--linked', '--schema', 'public', '--file', schemaPath,
    ], dumpCommandOptions);
    await runCommand(supabaseExecutable, [
      'db', 'dump', '--linked', '--schema', 'public', '--data-only', '--use-copy',
      '--file', dataPath,
    ], dumpCommandOptions);
    const rawSchemaSql = await readFile(schemaPath, 'utf8');
    const rawDataSql = await readFile(dataPath, 'utf8');
    const schema = parsePublicTableSchema(rawSchemaSql);
    const authOptions = {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    };
    const client = dependencies.createClient
      ? dependencies.createClient(url, secretKey, authOptions)
      : createSupabaseClient(url, secretKey, authOptions);
    const source = await readSourceSnapshot(createSupabaseSourceBackend(client));
    return { schema, source, rawSchemaSql, rawDataSql };
  } finally {
    await rm(dumpRoot, { recursive: true, force: true });
  }
}

async function writePrivateJson(path: string, value: unknown): Promise<void> {
  const handle = await open(
    path,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function promoteWithPortableRestore(
  dataDirectory: string,
  materialized: Awaited<ReturnType<typeof materializeSource>>,
): Promise<string> {
  materialized.validate();
  const dataRoot = realpathSync(dataDirectory);
  if (lstatSync(dataRoot).dev !== lstatSync(materialized.root).dev) {
    throw new Error('Migration candidate must be on the canonical filesystem.');
  }
  const backupsRoot = ensureDirectory(join(dataRoot, 'backups'), dataRoot);
  let canonicalDatabase: PlotterDatabase | undefined = openPlotterDatabase(join(dataRoot, 'plotter.sqlite3'));
  const canonicalOperations = createPortableBackupOperations({
    dataDirectory: dataRoot,
    currentDatabase() {
      if (!canonicalDatabase) throw new Error('Canonical database is closed.');
      return canonicalDatabase;
    },
    closeStorage() {
      const closing = canonicalDatabase;
      canonicalDatabase = undefined;
      closing?.close();
    },
    openStorage() {
      canonicalDatabase = openPlotterDatabase(join(dataRoot, 'plotter.sqlite3'));
    },
    publishRestoreReset() { /* No service is running while the ownership lock is held. */ },
  });
  try {
    const backup = await canonicalOperations.create();
    const preImportBackupId = backup.id.replace(/^portable-/, 'pre-supabase-import-');
    renameSync(
      join(backupsRoot, `${backup.id}.tar`),
      join(backupsRoot, `${preImportBackupId}.tar`),
    );
    await syncDirectory(backupsRoot);

    let candidateDatabase: PlotterDatabase | undefined = openPlotterDatabase(materialized.databasePath);
    const candidateOperations = createPortableBackupOperations({
      dataDirectory: materialized.root,
      currentDatabase() {
        if (!candidateDatabase) throw new Error('Migration candidate database is closed.');
        return candidateDatabase;
      },
      closeStorage() {
        const closing = candidateDatabase;
        candidateDatabase = undefined;
        closing?.close();
      },
      openStorage() {
        candidateDatabase = openPlotterDatabase(materialized.databasePath);
      },
      publishRestoreReset() { /* Candidate packaging has no clients. */ },
    });
    let candidateBackupId: string;
    try {
      candidateBackupId = (await candidateOperations.create()).id;
    } finally {
      candidateDatabase?.close();
      candidateDatabase = undefined;
    }
    const sourceArchive = join(materialized.root, 'backups', `${candidateBackupId}.tar`);
    const destinationArchive = join(backupsRoot, `${candidateBackupId}.tar`);
    await link(sourceArchive, destinationArchive);
    await syncDirectory(backupsRoot);
    await canonicalOperations.restore(candidateBackupId, {
      confirmation: `RESTORE ${candidateBackupId}`,
    });
    canonicalDatabase?.close();
    canonicalDatabase = undefined;
    const verified = openPlotterDatabase(join(dataRoot, 'plotter.sqlite3'));
    verified.close();
    return preImportBackupId;
  } finally {
    canonicalDatabase?.close();
  }
}

export async function runMigration(
  arguments_: MigrationArguments,
  dependencies: RunDependencies = {},
): Promise<MigrationRunResult> {
  if (arguments_.mode === 'apply' && !arguments_.dataDirectory) {
    throw new Error('--data-dir is required for apply.');
  }
  if (!arguments_.fixturePath && !arguments_.dataDirectory) {
    throw new Error('--data-dir is required for live source migration.');
  }
  const repositoryRoot = resolve(import.meta.dirname, '..', '..');
  const load = arguments_.fixturePath
    ? async () => (dependencies.loadFixture ?? loadFixtureSource)(resolve(arguments_.fixturePath!))
    : async () => captureLiveSource(repositoryRoot, dependencies);
  const first = await load();
  const firstFingerprint = fingerprintSourceSnapshot(first.source, first.schema);
  const digest = sourceFingerprintDigest(firstFingerprint);

  let stagingParent: string;
  let dataRoot: string | undefined;
  if (arguments_.dataDirectory) {
    dataRoot = realpathSync(resolve(arguments_.dataDirectory));
    stagingParent = ensureDirectory(join(dataRoot, 'imports'), dataRoot);
  } else {
    stagingParent = dependencies.createTemporaryStagingParent
      ? await dependencies.createTemporaryStagingParent()
      : await mkdtemp(join(tmpdir(), 'plotter-supabase-fixture-'));
  }
  const archive = await createRawArchive({
    stagingParent,
    source: first.source,
    schema: first.schema,
    fingerprint: firstFingerprint,
    rawSchemaSql: first.rawSchemaSql,
    rawDataSql: first.rawDataSql,
    log: dependencies.log,
  });
  const materializedRoot = join(archive.root, 'materialized');
  mkdirSync(materializedRoot, { mode: 0o700 });
  const archiveRelativePath = dataRoot
    ? relative(dataRoot, archive.root)
    : basename(archive.root);
  const materialized = await materializeSource({
    destinationRoot: materializedRoot,
    archiveRelativePath,
    source: first.source,
    fingerprint: firstFingerprint,
    importedAt: new Date().toISOString(),
  });
  const reconciliationReport = reconcileMaterialization({
    source: first.source,
    fingerprint: firstFingerprint,
    materialized,
  });
  let report = reconciliationReport;
  try {
    const second = await load();
    const secondDigest = sourceFingerprintDigest(
      fingerprintSourceSnapshot(second.source, second.schema),
    );
    if (secondDigest !== digest) throw new Error('Supabase source changed after staging.');
  } catch (error) {
    const message = error instanceof Error && error.message === 'Supabase source changed after staging.'
      ? error.message
      : 'Second Supabase source acquisition failed.';
    report = {
      ...reconciliationReport,
      passed: false,
      failures: [
        ...reconciliationReport.failures,
        { gate: 'source-stability', message },
      ],
    };
    await writePrivateJson(join(archive.root, 'report.json'), report);
    throw new Error(message, { cause: error });
  }
  await writePrivateJson(join(archive.root, 'report.json'), report);
  if (!report.passed) throw new Error('Supabase migration reconciliation failed.');
  const stagingId = basename(archive.root);
  const stagingLabel = dataRoot ? relative(dataRoot, archive.root) : `temporary/${stagingId}`;
  if (arguments_.mode === 'dry-run') {
    dependencies.log?.(`Supabase migration dry-run passed fingerprint=${digest}`);
    return {
      applied: false, stagingId, stagingLabel,
      sourceFingerprintDigest: digest, report,
    };
  }
  if (arguments_.confirmSourceFingerprint !== digest) {
    throw new Error('Source fingerprint confirmation does not match.');
  }
  const ownership = acquireDataDirectoryOwnership(dataRoot!, 'supabase-migration');
  try {
    await recoverInterruptedPortableRestore(dataRoot!);
    const preImportBackupId = await promoteWithPortableRestore(dataRoot!, materialized);
    dependencies.log?.(`Supabase migration apply passed fingerprint=${digest}`);
    return {
      applied: true, stagingId, stagingLabel,
      sourceFingerprintDigest: digest, report, preImportBackupId,
    };
  } finally {
    ownership.release();
  }
}

export function formatMigrationError(error: unknown): string {
  if (!(error instanceof Error)) return 'Supabase migration failed.';
  const message = error.message;
  return message.includes('/') || message.includes('\\')
    ? 'Supabase migration failed.'
    : message;
}

export async function main(arguments_ = process.argv.slice(2)): Promise<void> {
  const parsed = parseMigrationArguments(arguments_);
  if ('help' in parsed) {
    process.stdout.write(MIGRATION_HELP);
    return;
  }
  const result = await runMigration(parsed, { log: (message) => process.stdout.write(`${message}\n`) });
  process.stdout.write(`${JSON.stringify({
    applied: result.applied,
    stagingId: result.stagingId,
    stagingLabel: result.stagingLabel,
    sourceFingerprint: result.sourceFingerprintDigest,
    passed: result.report.passed,
    ...(result.preImportBackupId === undefined ? {} : { preImportBackupId: result.preImportBackupId }),
  })}\n`);
}
