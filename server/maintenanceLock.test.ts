import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DATA_DIRECTORY_LOCK_FILENAME, acquireDataDirectoryOwnership } from './maintenanceLock';

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('service and maintenance ownership lock', () => {
  it('prevents a newly starting service from racing a migration owner and releases only its own lock', () => {
    const root = mkdtempSync(join(tmpdir(), 'plotter-maintenance-lock-'));
    temporaryDirectories.push(root);
    const migration = acquireDataDirectoryOwnership(root, 'supabase-migration');
    expect(() => acquireDataDirectoryOwnership(root, 'service'))
      .toThrow('Plotter data directory is already owned by another process.');
    migration.release();
    const service = acquireDataDirectoryOwnership(root, 'service');
    expect(existsSync(join(root, DATA_DIRECTORY_LOCK_FILENAME))).toBe(true);
    service.release();
    expect(existsSync(join(root, DATA_DIRECTORY_LOCK_FILENAME))).toBe(false);
  });

  it('fails closed on a crash-stale lock instead of deleting unproved ownership', () => {
    const root = mkdtempSync(join(tmpdir(), 'plotter-maintenance-stale-'));
    temporaryDirectories.push(root);
    const lockPath = join(root, DATA_DIRECTORY_LOCK_FILENAME);
    writeFileSync(lockPath, '{"owner":"service","pid":999999}');
    expect(() => acquireDataDirectoryOwnership(root, 'supabase-migration'))
      .toThrow('Plotter data directory is already owned by another process.');
    expect(existsSync(lockPath)).toBe(true);
  });
});
