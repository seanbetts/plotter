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
  createSupabaseSourceBackend,
  fingerprintSourceSnapshot,
  readSourceSnapshot,
  sourceFingerprintDigest,
  validateSourceSchema,
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
  stagingParent: string;
  stagingRoot: string;
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
    return {
      path: value.path,
      listing: value.listing as SourceStorageEntry,
      bytes: new Uint8Array(bytes),
    };
  });
  return {
    schema,
    source: { tables, storage },
    rawSchemaSql: parsed.rawSchemaSql,
    rawDataSql: parsed.rawDataSql,
  };
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

async function defaultRunCommand(
  file: string,
  arguments_: string[],
  options: CommandOptions,
): Promise<CommandResult> {
  return new Promise((resolvePromise, reject) => {
    execFile(file, arguments_, {
      cwd: options.cwd,
      env: { ...process.env, ...options.environment },
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
  const expectedProjectReference = projectReference(url);
  const runCommand = dependencies.runCommand ?? defaultRunCommand;
  const localSupabaseExecutable = resolve(repositoryRoot, 'node_modules', '.bin', 'supabase');
  const supabaseExecutable = existsSync(localSupabaseExecutable)
    ? localSupabaseExecutable
    : 'supabase';
  const commandOptions = { cwd: repositoryRoot, environment };
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
    await runCommand(supabaseExecutable, [
      'db', 'dump', '--linked', '--schema', 'public', '--password', databasePassword,
      '--file', schemaPath,
    ], commandOptions);
    await runCommand(supabaseExecutable, [
      'db', 'dump', '--linked', '--schema', 'public', '--data-only', '--use-copy',
      '--password', databasePassword, '--file', dataPath,
    ], commandOptions);
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
    stagingParent = await mkdtemp(join(tmpdir(), 'plotter-supabase-fixture-'));
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
  const report = reconcileMaterialization({
    source: first.source,
    fingerprint: firstFingerprint,
    materialized,
  });
  await writePrivateJson(join(archive.root, 'report.json'), report);

  const second = await load();
  const secondDigest = sourceFingerprintDigest(
    fingerprintSourceSnapshot(second.source, second.schema),
  );
  if (secondDigest !== digest) throw new Error('Supabase source changed after staging.');
  if (!report.passed) throw new Error('Supabase migration reconciliation failed.');
  if (arguments_.mode === 'dry-run') {
    dependencies.log?.(`Supabase migration dry-run passed fingerprint=${digest}`);
    return {
      applied: false, stagingParent, stagingRoot: archive.root,
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
      applied: true, stagingParent, stagingRoot: archive.root,
      sourceFingerprintDigest: digest, report, preImportBackupId,
    };
  } finally {
    ownership.release();
  }
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
    stagingRoot: result.stagingRoot,
    sourceFingerprint: result.sourceFingerprintDigest,
    passed: result.report.passed,
    ...(result.preImportBackupId === undefined ? {} : { preImportBackupId: result.preImportBackupId }),
  })}\n`);
}
