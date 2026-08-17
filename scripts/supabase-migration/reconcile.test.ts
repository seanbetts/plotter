import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadFixtureSource } from './cli';
import { materializeSource } from './materialize';
import { reconcileMaterialization } from './reconcile';
import { fingerprintSourceSnapshot } from './source';

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('Supabase migration reconciliation', () => {
  it('proves exact counts, IDs, integrity, domain rows, media bytes, and archive-only classifications', async () => {
    const loaded = await loadFixtureSource(join(import.meta.dirname, 'fixtures', 'complete-project.json'));
    const fingerprint = fingerprintSourceSnapshot(loaded.source, loaded.schema);
    const root = mkdtempSync(join(tmpdir(), 'plotter-reconcile-'));
    temporaryDirectories.push(root);
    const materialized = await materializeSource({
      destinationRoot: root,
      archiveRelativePath: 'imports/synthetic',
      source: loaded.source,
      fingerprint,
      importedAt: '2026-08-17T12:00:00.000Z',
    });
    const report = reconcileMaterialization({ source: loaded.source, fingerprint, materialized });

    expect(report.passed).toBe(true);
    expect(report.source).toEqual(fingerprint);
    expect(report.destinationCounts).toMatchObject({
      trips: 1, destinations: 2, route_legs: 1, activities: 1, media_assets: 1,
    });
    expect(report.preservedSourceIds).toEqual({
      trips: true, trip_members: true, destinations: true, route_legs: true,
      activities: true, media_assets: true,
    });
    expect(report.media).toEqual({ objectCount: 2, byteCount: 17, hashesMatch: true });
    expect(report.failures).toEqual([]);
  });

  it('reports duplicate source identities instead of silently deduplicating them', async () => {
    const loaded = await loadFixtureSource(join(import.meta.dirname, 'fixtures', 'complete-project.json'));
    loaded.source.tables.activities.push({ ...loaded.source.tables.activities[0]! });
    const fingerprint = fingerprintSourceSnapshot(loaded.source, loaded.schema);
    const root = mkdtempSync(join(tmpdir(), 'plotter-reconcile-duplicate-'));
    temporaryDirectories.push(root);
    const materialized = await materializeSource({
      destinationRoot: root,
      archiveRelativePath: 'imports/synthetic',
      source: loaded.source,
      fingerprint,
      importedAt: '2026-08-17T12:00:00.000Z',
    });
    const report = reconcileMaterialization({ source: loaded.source, fingerprint, materialized });
    expect(report.passed).toBe(false);
    expect(report.failures.some((failure) => failure.gate === 'identity')).toBe(true);
  });

  it('repeated identical fresh materializations preserve the same IDs without duplication', async () => {
    const loaded = await loadFixtureSource(join(import.meta.dirname, 'fixtures', 'complete-project.json'));
    const fingerprint = fingerprintSourceSnapshot(loaded.source, loaded.schema);
    const reports = [];
    for (let index = 0; index < 2; index += 1) {
      const root = mkdtempSync(join(tmpdir(), 'plotter-reconcile-repeat-'));
      temporaryDirectories.push(root);
      const materialized = await materializeSource({
        destinationRoot: root,
        archiveRelativePath: 'imports/synthetic',
        source: loaded.source,
        fingerprint,
        importedAt: '2026-08-17T12:00:00.000Z',
      });
      reports.push(reconcileMaterialization({ source: loaded.source, fingerprint, materialized }));
    }
    expect(reports[0]).toEqual(reports[1]);
    expect(reports[0]!.passed).toBe(true);
  });
});
