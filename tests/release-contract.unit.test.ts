import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPlotterApiClient } from '../src/api/client';

const repositoryRoot = resolve(import.meta.dirname, '..');
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function readReleaseFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? readReleaseFiles(path) : [readFileSync(path, 'utf8')];
  });
}

describe('Plotter local-web service release contract', () => {
  it('declares the exact supported service manifest without browser Supabase or provider secrets', () => {
    expect(JSON.parse(readFileSync(join(repositoryRoot, 'local-web.json'), 'utf8'))).toEqual({
      schemaVersion: 1,
      id: 'plotter',
      title: 'Plotter',
      route: '/plotter',
      kind: 'service',
      build: {
        commands: [['npm', 'ci'], ['npm', 'run', 'build']],
        output: 'release',
        release: [
          { source: 'dist', target: 'public' },
          { source: 'server-dist', target: 'server' },
        ],
        environment: [
          'VITE_PUBLIC_BASE_PATH',
          'VITE_MAPTILER_API_KEY',
          'VITE_OPENROUTESERVICE_API_KEY',
        ],
      },
      healthPath: '/plotter/healthz',
      service: {
        module: 'server/service.mjs',
        internalHealthPath: '/healthz',
        frontendOutput: 'public',
        proxyPaths: ['/api'],
        frontendSecurity: {
          connectSources: [
            'https://api.maptiler.com',
            'https://api.openrouteservice.org',
          ],
        },
        startCommand: [
          '/usr/bin/env', 'node', '{release}/server/service.mjs', '--', '--port', '{port}',
          '--data-dir', '{repository}/user-data', '--env-file', '{repository}/.env',
        ],
      },
      home: { icon: 'route', accent: '#D9467A' },
      platform: { contractVersion: 1, templateVersion: 1, uiVersion: '0.5.2', capabilities: [] },
    });
  });

  it('rewrites the hosted API path to the local development service', async () => {
    const previousBasePath = process.env.VITE_PUBLIC_BASE_PATH;
    const previousServiceUrl = process.env.VITE_E2E_SERVICE_URL;
    process.env.VITE_PUBLIC_BASE_PATH = '/plotter/';
    delete process.env.VITE_E2E_SERVICE_URL;
    const server = await createServer({ configFile: join(repositoryRoot, 'vite.config.ts') });

    try {
      const proxy = server.config.server.proxy?.['/plotter/api'];
      expect(proxy).toMatchObject({ target: 'http://127.0.0.1:5175' });
      expect(typeof proxy === 'object' && proxy !== null ? proxy.rewrite : undefined).toBeTypeOf('function');
      expect((proxy as { rewrite: (path: string) => string }).rewrite('/plotter/api/v1/trips'))
        .toBe('/api/v1/trips');
    } finally {
      await server.close();
      if (previousBasePath === undefined) delete process.env.VITE_PUBLIC_BASE_PATH;
      else process.env.VITE_PUBLIC_BASE_PATH = previousBasePath;
      if (previousServiceUrl === undefined) delete process.env.VITE_E2E_SERVICE_URL;
      else process.env.VITE_E2E_SERVICE_URL = previousServiceUrl;
    }
  });

  it('uses a same-origin production API path', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ trips: [] })));
    const client = createPlotterApiClient({ baseUrl: '/plotter/', fetcher });

    await client.request('/api/v1/trips');

    expect(fetcher).toHaveBeenCalledWith('/plotter/api/v1/trips', expect.any(Object));
  });

  it('replaces stale generated artifacts and keeps synthetic Supabase and SerpApi secrets out of the release', () => {
    const environmentDirectory = mkdtempSync(join(tmpdir(), 'plotter-build-env-'));
    temporaryDirectories.push(environmentDirectory);
    const supabaseUrl = 'https://build-sentinel.supabase.invalid';
    const supabaseKey = 'build-sentinel-supabase-key';
    const serpApiKey = 'build-sentinel-serpapi-key';
    mkdirSync(join(repositoryRoot, 'server-dist'), { recursive: true });
    mkdirSync(join(repositoryRoot, 'release', 'public'), { recursive: true });
    mkdirSync(join(repositoryRoot, 'release', 'server'), { recursive: true });
    writeFileSync(join(repositoryRoot, 'server-dist', 'stale-server-sentinel.mjs'), 'stale server output');
    writeFileSync(join(repositoryRoot, 'release', 'public', 'stale-public-sentinel.txt'), 'stale public output');
    writeFileSync(join(repositoryRoot, 'release', 'server', 'stale-release-sentinel.mjs'), 'stale release output');
    execFileSync('npm', ['run', 'build'], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        PLOTTER_ENV_DIR: environmentDirectory,
        VITE_PUBLIC_BASE_PATH: '/plotter/',
        VITE_MAPTILER_API_KEY: 'build-sentinel-maptiler-key',
        VITE_OPENROUTESERVICE_API_KEY: 'build-sentinel-routing-key',
        VITE_SUPABASE_URL: supabaseUrl,
        VITE_SUPABASE_PUBLISHABLE_KEY: supabaseKey,
        SERPAPI_API_KEY: serpApiKey,
      },
      stdio: 'pipe',
    });

    expect(readFileSync(join(repositoryRoot, 'release', 'public', 'index.html'), 'utf8')).toContain('/plotter/');
    expect(readFileSync(join(repositoryRoot, 'release', 'server', 'service.mjs'), 'utf8')).not.toBe('');
    expect(existsSync(join(repositoryRoot, 'server-dist', 'stale-server-sentinel.mjs'))).toBe(false);
    expect(existsSync(join(repositoryRoot, 'release', 'public', 'stale-public-sentinel.txt'))).toBe(false);
    expect(existsSync(join(repositoryRoot, 'release', 'server', 'stale-release-sentinel.mjs'))).toBe(false);
    const publicAssets = readReleaseFiles(join(repositoryRoot, 'release', 'public')).join('\n');
    const serverBundle = readReleaseFiles(join(repositoryRoot, 'release', 'server')).join('\n');
    expect(publicAssets).not.toContain(supabaseUrl);
    expect(publicAssets).not.toContain(supabaseKey);
    expect(publicAssets).not.toContain(serpApiKey);
    expect(serverBundle).not.toContain(supabaseUrl);
    expect(serverBundle).not.toContain(supabaseKey);
    expect(serverBundle).not.toContain(serpApiKey);
  });
});
