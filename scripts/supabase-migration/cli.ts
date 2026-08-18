import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { constants, existsSync, lstatSync, mkdirSync, realpathSync, renameSync } from 'node:fs';
import { link, mkdtemp, open, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
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
  assertCopyMatchesSource,
  createSupabaseSourceBackend,
  fingerprintSourceSnapshot,
  parseSourceDumpEvidence,
  readSourceSnapshot,
  sourceFingerprintDigest,
  validateSourceSchema,
  validateStorageObjectBytes,
  type SourceCaptureProvenance,
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
  packageCandidate?(
    materialized: Awaited<ReturnType<typeof materializeSource>>,
  ): Promise<PreparedMigrationCandidate>;
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
  provenance?: SourceCaptureProvenance;
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
    provenance: {
      sourceKind: 'fixture',
      projectReference: null,
      linkedProjectReferenceConfirmed: false,
      captureStartedAt: null,
      captureCompletedAt: null,
      captureTool: 'synthetic-fixture',
      dumpFormat: 'postgres-schema-and-copy-v1',
    } satisfies SourceCaptureProvenance,
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

function validateFixtureRawDumps(fixture: LoadedFixtureSource): void {
  try {
    const rawSchema = parsePublicTableSchema(fixture.rawSchemaSql);
    for (const table of Object.keys(fixture.schema) as Array<keyof SourceSchema>) {
      if (JSON.stringify(rawSchema[table]) !== JSON.stringify(fixture.schema[table])) {
        throw new Error('schema mismatch');
      }
    }
    const evidence = parseSourceDumpEvidence(
      fixture.rawSchemaSql,
      fixture.rawDataSql,
      fixture.schema,
    );
    assertCopyMatchesSource(evidence, fixture.source);
  } catch {
    throw new Error('Supabase migration fixture raw dumps are inconsistent.');
  }
}

async function captureLiveSource(
  repositoryRoot: string,
  dependencies: RunDependencies,
  captureDirectory: string,
): Promise<LoadedFixtureSource> {
  const captureStartedAt = new Date().toISOString();
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

  const dumpRoot = realpathSync(captureDirectory);
  if (!isContained(dumpRoot, realpathSync(dirname(dumpRoot)))) {
    throw new Error('Migration capture directory is invalid.');
  }
  const dumpMetadata = lstatSync(dumpRoot);
  if (
    !dumpMetadata.isDirectory()
    || dumpMetadata.isSymbolicLink()
    || (dumpMetadata.mode & 0o777) !== 0o700
    || (process.getuid?.() !== undefined && dumpMetadata.uid !== process.getuid?.())
    || (process.getgid?.() !== undefined && dumpMetadata.gid !== process.getgid?.())
  ) throw new Error('Migration capture directory is invalid.');
  const schemaPath = join(dumpRoot, 'schema.sql');
  const dataPath = join(dumpRoot, 'data.sql');
  const readSecureDump = async (path: string): Promise<string> => {
    const metadata = lstatSync(path);
    if (
      !metadata.isFile()
      || metadata.isSymbolicLink()
      || realpathSync(path) !== path
      || !isContained(path, dumpRoot)
    ) throw new Error('Supabase dump evidence is invalid.');
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      await handle.chmod(0o600);
      const opened = await handle.stat();
      if (opened.dev !== metadata.dev || opened.ino !== metadata.ino || opened.size !== metadata.size) {
        throw new Error('Supabase dump evidence is invalid.');
      }
      const bytes = await handle.readFile();
      await handle.sync();
      const after = await handle.stat();
      const current = lstatSync(path);
      if (
        after.dev !== opened.dev
        || after.ino !== opened.ino
        || after.size !== opened.size
        || current.dev !== opened.dev
        || current.ino !== opened.ino
        || !current.isFile()
        || current.isSymbolicLink()
        || (current.mode & 0o777) !== 0o600
        || (process.getuid?.() !== undefined && current.uid !== process.getuid?.())
        || (process.getgid?.() !== undefined && current.gid !== process.getgid?.())
      ) throw new Error('Supabase dump evidence is invalid.');
      return bytes.toString('utf8');
    } finally {
      await handle.close();
    }
  };
  try {
    const dumpCommandOptions = {
      cwd: repositoryRoot,
      environment: { ...cliEnvironment, SUPABASE_DB_PASSWORD: databasePassword },
    };
    await runCommand(supabaseExecutable, [
      'db', 'dump', '--linked', '--schema', 'public', '--file', schemaPath,
    ], dumpCommandOptions);
    const rawSchemaSql = await readSecureDump(schemaPath);
    await syncDirectory(dumpRoot);
    await runCommand(supabaseExecutable, [
      'db', 'dump', '--linked', '--schema', 'public', '--data-only', '--use-copy',
      '--file', dataPath,
    ], dumpCommandOptions);
    const rawDataSql = await readSecureDump(dataPath);
    await syncDirectory(dumpRoot);
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
    return {
      schema,
      source,
      rawSchemaSql,
      rawDataSql,
      provenance: {
        sourceKind: 'live',
        projectReference: expectedProjectReference,
        linkedProjectReferenceConfirmed: true,
        captureStartedAt,
        captureCompletedAt: new Date().toISOString(),
        captureTool: 'supabase-cli-linked',
        dumpFormat: 'postgres-schema-and-copy-v1',
      },
    };
  } catch (error) {
    await syncDirectory(dumpRoot).catch(() => undefined);
    throw error;
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
  await syncDirectory(dirname(path));
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function assertPrivateOwnedDirectory(path: string, root: string): void {
  const metadata = lstatSync(path);
  if (
    metadata.isSymbolicLink()
    || !metadata.isDirectory()
    || realpathSync(path) !== path
    || !isContained(path, root)
    || (metadata.mode & 0o777) !== 0o700
    || (process.getuid?.() !== undefined && metadata.uid !== process.getuid?.())
    || (process.getgid?.() !== undefined && metadata.gid !== process.getgid?.())
  ) throw new Error('Migration staging directory is invalid.');
}

function migrationRunName(now: Date, identifier: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(identifier)) {
    throw new Error('Migration staging identity is invalid.');
  }
  return `supabase-${now.toISOString().replaceAll(/[-:.]/g, '')}-${identifier}`;
}

async function createMigrationRunRoot(stagingParent: string): Promise<string> {
  const canonicalParent = realpathSync(stagingParent);
  const root = join(canonicalParent, migrationRunName(new Date(), randomUUID()));
  mkdirSync(root, { mode: 0o700 });
  assertPrivateOwnedDirectory(root, canonicalParent);
  await syncDirectory(canonicalParent);
  return root;
}

async function createCaptureSlot(
  runRoot: string,
  slot: 'first' | 'second',
): Promise<string> {
  assertPrivateOwnedDirectory(runRoot, dirname(runRoot));
  const capturesRoot = join(runRoot, 'captures');
  if (!existsSync(capturesRoot)) {
    mkdirSync(capturesRoot, { mode: 0o700 });
    assertPrivateOwnedDirectory(capturesRoot, runRoot);
    await syncDirectory(runRoot);
  } else {
    assertPrivateOwnedDirectory(capturesRoot, runRoot);
  }
  const captureRoot = join(capturesRoot, slot);
  if (existsSync(captureRoot)) throw new Error('Migration capture slot already exists.');
  mkdirSync(captureRoot, { mode: 0o700 });
  assertPrivateOwnedDirectory(captureRoot, runRoot);
  await syncDirectory(capturesRoot);
  return captureRoot;
}

function captureFailurePhase(error: unknown): 'capture' | 'schema' | 'copy' {
  const message = error instanceof Error ? error.message : '';
  if (/schema|column|table/i.test(message) && !/COPY/i.test(message)) return 'schema';
  if (/COPY/i.test(message)) return 'copy';
  return 'capture';
}

async function retainCaptureFailure(runRoot: string, error: unknown): Promise<void> {
  const phase = captureFailurePhase(error);
  const message = formatMigrationError(error);
  await writePrivateJson(join(runRoot, 'report.json'), {
    formatVersion: 1,
    passed: false,
    phase,
    failures: [{ gate: phase, message }],
  });
}

export type PreparedMigrationCandidate = {
  backupId: string;
  archivePath: string;
  identity: { dev: number; ino: number };
  evidence: NonNullable<ReconciliationReport['candidatePackage']>;
};

async function hashExactFile(path: string): Promise<{
  byteCount: number;
  sha256: string;
  dev: number;
  ino: number;
}> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size <= 0) {
      throw new Error('Portable migration candidate is invalid.');
    }
    const hash = createHash('sha256');
    let offset = 0;
    while (offset < before.size) {
      const buffer = Buffer.alloc(Math.min(64 * 1024, before.size - offset));
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, offset);
      if (bytesRead <= 0) throw new Error('Portable migration candidate is invalid.');
      hash.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (
      after.dev !== before.dev
      || after.ino !== before.ino
      || after.size !== before.size
      || offset !== before.size
    ) throw new Error('Portable migration candidate is invalid.');
    return {
      byteCount: before.size,
      sha256: hash.digest('hex'),
      dev: before.dev,
      ino: before.ino,
    };
  } finally {
    await handle.close();
  }
}

export async function packagePortableCandidate(
  materialized: Awaited<ReturnType<typeof materializeSource>>,
): Promise<PreparedMigrationCandidate> {
  materialized.validate();
  let database: PlotterDatabase | undefined = openPlotterDatabase(materialized.databasePath);
  const operations = createPortableBackupOperations({
    dataDirectory: materialized.root,
    currentDatabase() {
      if (!database) throw new Error('Migration candidate database is closed.');
      return database;
    },
    closeStorage() {
      const closing = database;
      database = undefined;
      closing?.close();
    },
    openStorage() {
      database = openPlotterDatabase(materialized.databasePath);
    },
    publishRestoreReset() { /* Candidate packaging has no clients. */ },
  });
  try {
    const backupId = (await operations.create()).id;
    const manifest = await operations.inspect(backupId);
    const archivePath = join(materialized.root, 'backups', `${backupId}.tar`);
    const canonicalArchive = realpathSync(archivePath);
    if (!isContained(canonicalArchive, materialized.root) || canonicalArchive !== archivePath) {
      throw new Error('Portable migration candidate is invalid.');
    }
    const { dev, ino, ...digest } = await hashExactFile(archivePath);
    return {
      backupId,
      archivePath,
      identity: { dev, ino },
      evidence: { backupId, ...digest, manifest },
    };
  } finally {
    database?.close();
    database = undefined;
  }
}

async function promoteWithPortableRestore(
  dataDirectory: string,
  materialized: Awaited<ReturnType<typeof materializeSource>>,
  candidate: PreparedMigrationCandidate,
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

    const currentCandidate = await hashExactFile(candidate.archivePath);
    if (
      currentCandidate.dev !== candidate.identity.dev
      || currentCandidate.ino !== candidate.identity.ino
      || currentCandidate.byteCount !== candidate.evidence.byteCount
      || currentCandidate.sha256 !== candidate.evidence.sha256
    ) throw new Error('Migration candidate changed after inspection.');
    const destinationArchive = join(backupsRoot, `${candidate.backupId}.tar`);
    await link(candidate.archivePath, destinationArchive);
    const linked = lstatSync(destinationArchive);
    if (
      !linked.isFile()
      || linked.isSymbolicLink()
      || linked.dev !== candidate.identity.dev
      || linked.ino !== candidate.identity.ino
    ) throw new Error('Migration candidate changed during publication.');
    await syncDirectory(backupsRoot);
    await canonicalOperations.restore(candidate.backupId, {
      confirmation: `RESTORE ${candidate.backupId}`,
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
  let runRoot = arguments_.fixturePath
    ? undefined
    : await createMigrationRunRoot(stagingParent);
  const load = async (slot: 'first' | 'second'): Promise<LoadedFixtureSource> => {
    if (arguments_.fixturePath) {
      return (dependencies.loadFixture ?? loadFixtureSource)(resolve(arguments_.fixturePath));
    }
    const captureRoot = await createCaptureSlot(runRoot!, slot);
    return captureLiveSource(repositoryRoot, dependencies, captureRoot);
  };
  let first: LoadedFixtureSource;
  let firstDumpEvidence: ReturnType<typeof parseSourceDumpEvidence>;
  try {
    first = await load('first');
    firstDumpEvidence = parseSourceDumpEvidence(
      first.rawSchemaSql,
      first.rawDataSql,
      first.schema,
    );
    assertCopyMatchesSource(firstDumpEvidence, first.source);
  } catch (error) {
    if (runRoot) await retainCaptureFailure(runRoot, error);
    throw error;
  }
  runRoot ??= await createMigrationRunRoot(stagingParent);
  const firstFingerprint = fingerprintSourceSnapshot(
    first.source,
    first.schema,
    firstDumpEvidence,
    first.provenance?.projectReference ?? null,
  );
  const digest = sourceFingerprintDigest(firstFingerprint);

  const archive = await createRawArchive({
    stagingParent,
    stagingRoot: runRoot,
    source: first.source,
    schema: first.schema,
    fingerprint: firstFingerprint,
    rawSchemaSql: first.rawSchemaSql,
    rawDataSql: first.rawDataSql,
    provenance: first.provenance,
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
    provenance: first.provenance,
  });
  const reconciliationReport = reconcileMaterialization({
    source: first.source,
    fingerprint: firstFingerprint,
    materialized,
  });
  let report: ReconciliationReport = {
    ...reconciliationReport,
    ...(first.provenance === undefined ? {} : { provenance: first.provenance }),
  };
  try {
    const second = await load('second');
    const secondDumpEvidence = parseSourceDumpEvidence(
      second.rawSchemaSql,
      second.rawDataSql,
      second.schema,
    );
    const secondDigest = sourceFingerprintDigest(fingerprintSourceSnapshot(
      second.source,
      second.schema,
      secondDumpEvidence,
      second.provenance?.projectReference ?? null,
    ));
    if (secondDigest !== digest) throw new Error('Supabase source changed after staging.');
  } catch (error) {
    const message = error instanceof Error && error.message === 'Supabase source changed after staging.'
      ? error.message
      : 'Second Supabase source acquisition failed.';
    const evidenceFailure = message === 'Supabase source changed after staging.'
      ? []
      : [{ gate: captureFailurePhase(error), message: formatMigrationError(error) }];
    report = {
      ...report,
      passed: false,
      failures: [
        ...report.failures,
        { gate: 'source-stability', message },
        ...evidenceFailure,
      ],
    };
    await writePrivateJson(join(archive.root, 'report.json'), report);
    throw new Error(message, { cause: error });
  }
  if (!report.passed) {
    await writePrivateJson(join(archive.root, 'report.json'), report);
    throw new Error('Supabase migration reconciliation failed.');
  }
  await archive.verify();
  let candidate: PreparedMigrationCandidate;
  try {
    candidate = await (dependencies.packageCandidate ?? packagePortableCandidate)(materialized);
    report = { ...report, candidatePackage: candidate.evidence };
  } catch (error) {
    report = {
      ...report,
      passed: false,
      failures: [
        ...report.failures,
        {
          gate: 'candidate-package',
          message: 'Portable migration candidate could not be created and inspected.',
        },
      ],
    };
    await writePrivateJson(join(archive.root, 'report.json'), report);
    throw new Error('Supabase migration candidate packaging failed.', { cause: error });
  }
  await writePrivateJson(join(archive.root, 'report.json'), report);
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
    const preImportBackupId = await promoteWithPortableRestore(dataRoot!, materialized, candidate);
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
