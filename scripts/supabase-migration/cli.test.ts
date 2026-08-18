import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openPlotterDatabase } from '../../server/database';
import { acquireDataDirectoryOwnership } from '../../server/maintenanceLock';
import { createPlotterStorageRuntime } from '../../server/storageRuntime';
import type { SupabaseClient } from '@supabase/supabase-js';
import { KNOWN_SOURCE_SCHEMA } from './source';
import {
  defaultRunCommand,
  loadFixtureSource,
  main,
  parseMigrationArguments,
  parsePublicTableSchema,
  runMigration,
} from './cli';

const fixturePath = join(import.meta.dirname, 'fixtures', 'complete-project.json');
const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true });
});

function canonicalRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'plotter-supabase-apply-'));
  temporaryDirectories.push(root);
  mkdirSync(join(root, 'media'), { mode: 0o700 });
  const database = openPlotterDatabase(join(root, 'plotter.sqlite3'));
  database.close();
  return root;
}

function syntheticJwt(role: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ role })).toString('base64url');
  const signature = Buffer.from('synthetic-signature').toString('base64url');
  return `${header}.${payload}.${signature}`;
}

describe('Supabase migration CLI', () => {
  it('parses help without requiring mode, credentials, a data directory, or network state', () => {
    expect(parseMigrationArguments(['--help'])).toEqual({ help: true });
    expect(() => parseMigrationArguments([])).toThrow('Choose exactly one of --dry-run or --apply.');
  });

  it('runs a credential-free fixture dry-run and retains its passing archive outside canonical state', async () => {
    const stagingParent = mkdtempSync(join(tmpdir(), 'plotter-fixture-staging-'));
    temporaryDirectories.push(stagingParent);
    const result = await runMigration({ mode: 'dry-run', fixturePath }, {
      environment: new Proxy({}, { get() { throw new Error('fixture mode read environment'); } }),
      runCommand: async () => { throw new Error('fixture mode invoked CLI'); },
      createClient: () => { throw new Error('fixture mode created a network client'); },
      createTemporaryStagingParent: async () => stagingParent,
    });
    const stagingRoot = join(stagingParent, result.stagingId);
    expect(result.report.passed).toBe(true);
    expect(result.applied).toBe(false);
    expect(result.stagingLabel).toBe(`temporary/${result.stagingId}`);
    expect(existsSync(join(stagingRoot, 'report.json'))).toBe(true);
    expect(existsSync(join(stagingRoot, 'source-archive', 'raw', 'schema.sql'))).toBe(true);
    expect(result.sourceFingerprintDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('retains realistic fixture schema and COPY dumps that agree with the structured fixture', async () => {
    const loaded = await loadFixtureSource(fixturePath);

    expect(parsePublicTableSchema(loaded.rawSchemaSql)).toEqual(loaded.schema);
    for (const [table, rows] of Object.entries(loaded.source.tables)) {
      expect(loaded.rawDataSql).toContain(`COPY "public"."${table}"`);
      const copy = new RegExp(`COPY "public"\\."${table}"[^;]+;\\n([\\s\\S]*?)\\n\\\\\\.`, 'm')
        .exec(loaded.rawDataSql);
      expect(copy?.[1]?.split('\n')).toHaveLength(rows.length);
    }
  });

  it('rejects fixture raw dumps that disagree with the structured fixture', async () => {
    const root = mkdtempSync(join(tmpdir(), 'plotter-fixture-consistency-'));
    temporaryDirectories.push(root);
    const inconsistentPath = join(root, 'fixture.json');
    const inconsistent = JSON.parse(readFileSync(fixturePath, 'utf8')) as Record<string, unknown>;
    inconsistent.rawDataSql = '-- no COPY records';
    writeFileSync(inconsistentPath, JSON.stringify(inconsistent));

    await expect(loadFixtureSource(inconsistentPath))
      .rejects.toThrow('Supabase migration fixture raw dumps are inconsistent.');

    inconsistent.rawDataSql = (JSON.parse(readFileSync(fixturePath, 'utf8')) as { rawDataSql: string })
      .rawDataSql.replace('Synthetic migration trip', 'Different migration trip');
    writeFileSync(inconsistentPath, JSON.stringify(inconsistent));
    await expect(loadFixtureSource(inconsistentPath))
      .rejects.toThrow('Supabase migration fixture raw dumps are inconsistent.');
  });

  it('does not reveal absolute fixture or data roots in normal CLI output', async () => {
    const dataDirectory = canonicalRoot();
    let stdout = '';
    const output = vi.spyOn(process.stdout, 'write').mockImplementation((value) => {
      stdout += String(value);
      return true;
    });
    try {
      await main(['--dry-run', '--fixture', fixturePath, '--data-dir', dataDirectory]);
    } finally {
      output.mockRestore();
    }

    expect(stdout).not.toContain(fixturePath);
    expect(stdout).not.toContain(dataDirectory);
    expect(stdout).not.toContain('stagingRoot');
    expect(stdout).toContain('stagingLabel');
  });

  it('sanitizes absolute fixture paths from entrypoint filesystem errors', () => {
    const missingFixture = join(tmpdir(), 'plotter-sensitive-fixture-root', 'missing.json');
    const result = spawnSync(process.execPath, [
      '--import', 'tsx', join(import.meta.dirname, '..', 'migrate-supabase.ts'),
      '--dry-run', '--fixture', missingFixture,
    ], { encoding: 'utf8' });

    expect(result.status).toBe(1);
    expect(result.stderr).not.toContain(missingFixture);
    expect(result.stderr).not.toContain(tmpdir());
    expect(result.stderr).toContain('Supabase migration failed.');
  });

  it('does not merge the parent process environment into a command', async () => {
    const parentSecretName = 'PLOTTER_TEST_PARENT_ONLY_SECRET';
    const previousParentSecret = process.env[parentSecretName];
    process.env[parentSecretName] = 'must-not-reach-child';
    try {
      const childEnvironment = {
        PATH: process.env.PATH,
        PLOTTER_TEST_ALLOWED_VALUE: 'explicit-child-value',
      };
      const result = await defaultRunCommand(process.execPath, [
        '-e',
        'process.stdout.write(JSON.stringify(process.env))',
      ], {
        cwd: import.meta.dirname,
        environment: childEnvironment,
      });

      const receivedEnvironment = JSON.parse(result.stdout) as Record<string, string>;
      expect(receivedEnvironment).toMatchObject(childEnvironment);
      expect(receivedEnvironment[parentSecretName]).toBeUndefined();
      expect(Object.keys(receivedEnvironment).filter((name) => (
        !(name in childEnvironment) && name !== '__CF_USER_TEXT_ENCODING'
      ))).toEqual([]);
    } finally {
      if (previousParentSecret === undefined) delete process.env[parentSecretName];
      else process.env[parentSecretName] = previousParentSecret;
    }
  });

  it.each([
    ['an arbitrary value', 'runtime-secret-value'],
    ['a publishable key', 'sb_publishable_synthetic-browser-key'],
    ['a legacy anon JWT', syntheticJwt('anon')],
    [
      'a malformed JWT claiming service_role',
      `not-json.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.signature`,
    ],
  ])('rejects %s before invoking Supabase CLI', async (_label, secretKey) => {
    const dataDirectory = canonicalRoot();
    let commandCalls = 0;

    await expect(runMigration({ mode: 'dry-run', dataDirectory }, {
      environment: {
        PLOTTER_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
        PLOTTER_SUPABASE_SECRET_KEY: secretKey,
        PLOTTER_SUPABASE_DB_PASSWORD: 'synthetic-database-password',
      },
      async runCommand() {
        commandCalls += 1;
        throw new Error('credential gate was bypassed');
      },
    })).rejects.toThrow(
      'PLOTTER_SUPABASE_SECRET_KEY must be a Supabase secret or service_role key.',
    );
    expect(commandCalls).toBe(0);
  });

  it.each([
    ['a secret key', 'sb_secret_synthetic-server-key'],
    ['a legacy service_role JWT', syntheticJwt('service_role')],
  ])('accepts %s through the local credential-shape gate', async (_label, secretKey) => {
    const dataDirectory = canonicalRoot();
    let commandCalls = 0;

    await expect(runMigration({ mode: 'dry-run', dataDirectory }, {
      environment: {
        PLOTTER_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
        PLOTTER_SUPABASE_SECRET_KEY: secretKey,
        PLOTTER_SUPABASE_DB_PASSWORD: 'synthetic-database-password',
      },
      async runCommand() {
        commandCalls += 1;
        throw new Error('synthetic accepted-credential stop');
      },
    })).rejects.toThrow('synthetic accepted-credential stop');
    expect(commandCalls).toBe(1);
  });

  it('uses disabled auth persistence and only authenticated linked public schema/COPY dump commands in live mode', async () => {
    const dataDirectory = canonicalRoot();
    const projectRef = 'abcdefghijklmnopqrst';
    const secret = 'sb_secret_synthetic-runtime-value';
    const password = 'separate-db-password';
    const safeEnvironment = {
      HOME: '/synthetic/home',
      PATH: '/synthetic/bin',
      TMPDIR: '/synthetic/tmp',
      XDG_CONFIG_HOME: '/synthetic/config',
      SUPABASE_ACCESS_TOKEN: 'synthetic-cli-access-token',
    };
    const calls: Array<{
      arguments: string[];
      environment: Record<string, string | undefined>;
    }> = [];
    const executables: string[] = [];
    const clientOptions: Record<string, unknown>[] = [];
    const logs: string[] = [];
    const emptyQuery = {
      order() { return this; },
      async range() { return { data: [], error: null, count: 0 }; },
    };
    const client = {
      from() {
        return { select() { return emptyQuery; } };
      },
      storage: {
        from() {
          return {
            async list() { return { data: [], error: null }; },
            async download() { throw new Error('no fixture objects'); },
          };
        },
      },
    } as unknown as SupabaseClient;
    const schemaSql = Object.entries(KNOWN_SOURCE_SCHEMA).map(([table, columns]) =>
      `CREATE TABLE IF NOT EXISTS "public"."${table}" (\n${columns.map((column) => `    "${column}" text`).join(',\n')}\n);`)
      .join('\n');

    const result = await runMigration({ mode: 'dry-run', dataDirectory }, {
      environment: {
        ...safeEnvironment,
        PLOTTER_SUPABASE_URL: `https://${projectRef}.supabase.co`,
        PLOTTER_SUPABASE_SECRET_KEY: secret,
        PLOTTER_SUPABASE_DB_PASSWORD: password,
        UNRELATED_SECRET: 'must-not-reach-child',
      },
      async readLinkedProjectReference() { return projectRef; },
      async runCommand(file, arguments_, options) {
        executables.push(file);
        calls.push({ arguments: arguments_, environment: options.environment });
        if (arguments_[0] === 'projects') return { stdout: JSON.stringify([{ id: projectRef }]) };
        const outputPath = arguments_[arguments_.indexOf('--file') + 1]!;
        writeFileSync(outputPath, arguments_.includes('--data-only') ? '-- COPY data\n' : schemaSql);
        return { stdout: '' };
      },
      createClient(_url, _key, options) {
        clientOptions.push(options);
        return client;
      },
      log(message) { logs.push(message); },
    });

    expect(result.report.passed).toBe(true);
    expect(clientOptions).toEqual([
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
    ]);
    const projectCalls = calls.filter((call) => call.arguments[0] === 'projects');
    const dumpCalls = calls.filter((call) => call.arguments[0] === 'db');
    expect(projectCalls).toHaveLength(2);
    expect(new Set(executables)).toEqual(new Set(['supabase']));
    expect(dumpCalls.map((call) => call.arguments)).toEqual(expect.arrayContaining([
      expect.arrayContaining(['db', 'dump', '--linked', '--schema', 'public', '--file']),
      expect.arrayContaining(['db', 'dump', '--linked', '--schema', 'public', '--data-only', '--use-copy', '--file']),
    ]));
    expect(calls.every((call) => !call.arguments.includes('--password'))).toBe(true);
    expect(calls.every((call) => !call.arguments.includes(password))).toBe(true);
    for (const call of projectCalls) expect(call.environment).toEqual(safeEnvironment);
    for (const call of dumpCalls) {
      expect(call.environment).toEqual({
        ...safeEnvironment,
        SUPABASE_DB_PASSWORD: password,
      });
    }
    expect(logs.join('\n')).not.toContain(secret);
    expect(logs.join('\n')).not.toContain(password);
    expect(logs.join('\n')).not.toContain(projectRef);
  });

  it('rejects the wrong full fingerprint before backup or promotion', async () => {
    const dataDirectory = canonicalRoot();
    await expect(runMigration({
      mode: 'apply', fixturePath, dataDirectory, confirmSourceFingerprint: '0'.repeat(64),
    })).rejects.toThrow('Source fingerprint confirmation does not match.');
    expect(existsSync(join(dataDirectory, 'backups'))).toBe(false);
    const database = new DatabaseSync(join(dataDirectory, 'plotter.sqlite3'), { readOnly: true });
    expect((database.prepare('SELECT COUNT(*) AS count FROM trips').get() as { count: number }).count).toBe(0);
    database.close();
  });

  it('fails a changed second full source pass before backup or promotion', async () => {
    const dataDirectory = canonicalRoot();
    let reads = 0;
    await expect(runMigration({
      mode: 'apply', fixturePath, dataDirectory,
      confirmSourceFingerprint: 'confirmation-is-checked-after-source-stability',
    }, {
      async loadFixture(path) {
        const loaded = await loadFixtureSource(path);
        reads += 1;
        if (reads === 2) loaded.source.tables.trips[0]!.name = 'changed during staging';
        return loaded;
      },
    })).rejects.toThrow('Supabase source changed after staging.');
    expect(existsSync(join(dataDirectory, 'backups'))).toBe(false);
    const imports = readdirSync(join(dataDirectory, 'imports'));
    expect(imports).toHaveLength(1);
    const retainedReport = JSON.parse(readFileSync(
      join(dataDirectory, 'imports', imports[0]!, 'report.json'),
      'utf8',
    )) as { passed: boolean; failures: Array<{ gate: string; message: string }> };
    expect(retainedReport.passed).toBe(false);
    expect(retainedReport.failures).toContainEqual({
      gate: 'source-stability',
      message: 'Supabase source changed after staging.',
    });
  });

  it('applies only to disposable canonical state through named backup and hardened restore, repeatably', async () => {
    const dataDirectory = canonicalRoot();
    const dryRun = await runMigration({ mode: 'dry-run', fixturePath, dataDirectory });
    const first = await runMigration({
      mode: 'apply', fixturePath, dataDirectory,
      confirmSourceFingerprint: dryRun.sourceFingerprintDigest,
    });
    expect(first.applied).toBe(true);
    expect(first.preImportBackupId).toMatch(/^pre-supabase-import-/);
    expect(readdirSync(join(dataDirectory, 'backups'))
      .some((name) => name.startsWith(`${first.preImportBackupId}.tar`))).toBe(true);
    const backupRuntime = await createPlotterStorageRuntime({ dataDirectory });
    expect(await backupRuntime.backups.inspect(first.preImportBackupId!)).toMatchObject({
      id: first.preImportBackupId,
    });
    backupRuntime.close();
    let database = new DatabaseSync(join(dataDirectory, 'plotter.sqlite3'), { readOnly: true });
    expect((database.prepare('SELECT COUNT(*) AS count FROM trips').get() as { count: number }).count).toBe(1);
    expect((database.prepare('SELECT COUNT(*) AS count FROM media_assets').get() as { count: number }).count).toBe(1);
    database.close();
    expect(readFileSync(join(dataDirectory, 'media', '00000000-0000-4000-8000-000000000006.png'), 'utf8'))
      .toBe('fixture-image');

    const second = await runMigration({
      mode: 'apply', fixturePath, dataDirectory,
      confirmSourceFingerprint: dryRun.sourceFingerprintDigest,
    });
    expect(second.sourceFingerprintDigest).toBe(first.sourceFingerprintDigest);
    expect(JSON.parse(readFileSync(join(dataDirectory, second.stagingLabel, 'report.json'), 'utf8')))
      .toMatchObject({ passed: true, failures: [] });
    database = new DatabaseSync(join(dataDirectory, 'plotter.sqlite3'), { readOnly: true });
    expect((database.prepare('SELECT COUNT(*) AS count FROM trips').get() as { count: number }).count).toBe(1);
    expect((database.prepare('SELECT COUNT(*) AS count FROM media_assets').get() as { count: number }).count).toBe(1);
    database.close();
  });

  it('fails apply while a service owns the data root and leaves canonical bytes untouched', async () => {
    const dataDirectory = canonicalRoot();
    const before = readFileSync(join(dataDirectory, 'plotter.sqlite3'));
    const dryRun = await runMigration({ mode: 'dry-run', fixturePath, dataDirectory });
    const service = acquireDataDirectoryOwnership(dataDirectory, 'service');
    try {
      await expect(runMigration({
        mode: 'apply', fixturePath, dataDirectory,
        confirmSourceFingerprint: dryRun.sourceFingerprintDigest,
      })).rejects.toThrow('Plotter data directory is already owned by another process.');
      expect(readFileSync(join(dataDirectory, 'plotter.sqlite3'))).toEqual(before);
      expect(existsSync(join(dataDirectory, 'backups'))).toBe(false);
    } finally {
      service.release();
    }
  });

  it('recovers an interrupted pre-commit portable restore under ownership before apply opens canonical state', async () => {
    const dataDirectory = canonicalRoot();
    const dryRun = await runMigration({ mode: 'dry-run', fixturePath, dataDirectory });
    const transactionId = '00000000-0000-4000-8000-000000000099';
    const transaction = join(dataDirectory, `.portable-restore-${transactionId}`);
    mkdirSync(join(transaction, 'rollback'), { recursive: true, mode: 0o700 });
    renameSync(
      join(dataDirectory, 'plotter.sqlite3'),
      join(transaction, 'rollback', 'plotter.sqlite3'),
    );
    renameSync(join(dataDirectory, 'media'), join(transaction, 'rollback', 'media'));
    writeFileSync(join(dataDirectory, 'plotter.sqlite3'), 'ambiguous promoted database');
    mkdirSync(join(dataDirectory, 'media'), { mode: 0o700 });
    writeFileSync(join(dataDirectory, 'media', 'ambiguous.png'), 'ambiguous promoted media');
    writeFileSync(join(transaction, 'restore-plan'), JSON.stringify({
      formatVersion: 1,
      transactionId,
      backupId: 'portable-20260817T120000000Z-00000000-0000-4000-8000-000000000009',
      originalWal: false,
      originalShm: false,
    }));

    const result = await runMigration({
      mode: 'apply', fixturePath, dataDirectory,
      confirmSourceFingerprint: dryRun.sourceFingerprintDigest,
    });

    expect(result.applied).toBe(true);
    expect(existsSync(transaction)).toBe(false);
    expect(existsSync(join(dataDirectory, 'media', 'ambiguous.png'))).toBe(false);
    const database = new DatabaseSync(join(dataDirectory, 'plotter.sqlite3'), { readOnly: true });
    expect((database.prepare('SELECT COUNT(*) AS count FROM trips').get() as { count: number }).count).toBe(1);
    database.close();
  });
});
