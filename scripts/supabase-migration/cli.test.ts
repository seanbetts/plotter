import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { openPlotterDatabase } from '../../server/database';
import { acquireDataDirectoryOwnership } from '../../server/maintenanceLock';
import { createPlotterStorageRuntime } from '../../server/storageRuntime';
import type { SupabaseClient } from '@supabase/supabase-js';
import { KNOWN_SOURCE_SCHEMA } from './source';
import { loadFixtureSource, parseMigrationArguments, runMigration } from './cli';

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

describe('Supabase migration CLI', () => {
  it('parses help without requiring mode, credentials, a data directory, or network state', () => {
    expect(parseMigrationArguments(['--help'])).toEqual({ help: true });
    expect(() => parseMigrationArguments([])).toThrow('Choose exactly one of --dry-run or --apply.');
  });

  it('runs a credential-free fixture dry-run and retains its passing archive outside canonical state', async () => {
    const result = await runMigration({ mode: 'dry-run', fixturePath }, {
      environment: new Proxy({}, { get() { throw new Error('fixture mode read environment'); } }),
      runCommand: async () => { throw new Error('fixture mode invoked CLI'); },
      createClient: () => { throw new Error('fixture mode created a network client'); },
    });
    temporaryDirectories.push(result.stagingParent);
    expect(result.report.passed).toBe(true);
    expect(result.applied).toBe(false);
    expect(existsSync(join(result.stagingRoot, 'report.json'))).toBe(true);
    expect(existsSync(join(result.stagingRoot, 'raw', 'schema.sql'))).toBe(true);
    expect(result.sourceFingerprintDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('uses disabled auth persistence and only authenticated linked public schema/COPY dump commands in live mode', async () => {
    const dataDirectory = canonicalRoot();
    const projectRef = 'abcdefghijklmnopqrst';
    const secret = 'runtime-secret-value';
    const password = 'separate-db-password';
    const calls: string[][] = [];
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
        PLOTTER_SUPABASE_URL: `https://${projectRef}.supabase.co`,
        PLOTTER_SUPABASE_SECRET_KEY: secret,
        PLOTTER_SUPABASE_DB_PASSWORD: password,
      },
      async readLinkedProjectReference() { return projectRef; },
      async runCommand(file, arguments_) {
        executables.push(file);
        calls.push(arguments_);
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
    expect(calls.filter((call) => call[0] === 'projects')).toHaveLength(2);
    expect(new Set(executables)).toEqual(new Set(['supabase']));
    expect(calls.filter((call) => call[0] === 'db')).toEqual(expect.arrayContaining([
      expect.arrayContaining(['db', 'dump', '--linked', '--schema', 'public', '--password', password, '--file']),
      expect.arrayContaining(['db', 'dump', '--linked', '--schema', 'public', '--data-only', '--use-copy', '--password', password, '--file']),
    ]));
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
  });

  it('applies only to disposable canonical state through named backup and hardened restore, repeatably', async () => {
    const dataDirectory = canonicalRoot();
    const dryRun = await runMigration({ mode: 'dry-run', fixturePath });
    temporaryDirectories.push(dryRun.stagingParent);
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
    database = new DatabaseSync(join(dataDirectory, 'plotter.sqlite3'), { readOnly: true });
    expect((database.prepare('SELECT COUNT(*) AS count FROM trips').get() as { count: number }).count).toBe(1);
    expect((database.prepare('SELECT COUNT(*) AS count FROM media_assets').get() as { count: number }).count).toBe(1);
    database.close();
  });

  it('fails apply while a service owns the data root and leaves canonical bytes untouched', async () => {
    const dataDirectory = canonicalRoot();
    const before = readFileSync(join(dataDirectory, 'plotter.sqlite3'));
    const dryRun = await runMigration({ mode: 'dry-run', fixturePath });
    temporaryDirectories.push(dryRun.stagingParent);
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
    const dryRun = await runMigration({ mode: 'dry-run', fixturePath });
    temporaryDirectories.push(dryRun.stagingParent);
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
