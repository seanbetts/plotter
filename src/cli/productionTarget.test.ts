import { describe, expect, it, vi } from 'vitest';
import { resolvePlotterBaseUrl } from './trip';

const target = { schemaVersion: 1, appId: 'plotter', targetKind: 'nas-docker',
  baseUrl: 'https://local.example.ts.net/plotter', profileRevision: 'a'.repeat(64) };

describe('canonical production data target', () => {
  it('uses NAS metadata without a local service fallback', () => {
    expect(resolvePlotterBaseUrl({}, () => target).href).toBe('https://local.example.ts.net/plotter/');
    expect(() => resolvePlotterBaseUrl({}, () => { throw new Error('metadata unavailable'); })).toThrow('Plotter CLI configuration is invalid.');
  });
  it('rejects wrong app, absent profile identity, and NAS HTTP targets', () => {
    for (const changed of [{ ...target, appId: 'other' }, { ...target, profileRevision: '' },
      { ...target, baseUrl: 'http://127.0.0.1/plotter/' }, { ...target, targetKind: 'unknown' }]) {
      expect(() => resolvePlotterBaseUrl({}, () => changed)).toThrow();
    }
  });
  it('preserves an explicit fixture URL without consulting production metadata', () => {
    const resolver = vi.fn(() => { throw new Error('must not read production'); });
    expect(resolvePlotterBaseUrl({ PLOTTER_BASE_URL: 'http://127.0.0.1:9123/' }, resolver).href).toBe('http://127.0.0.1:9123/');
    expect(resolver).not.toHaveBeenCalled();
  });
});
