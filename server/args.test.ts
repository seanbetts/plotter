import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as serviceArguments from './args';

const { parseServiceArguments } = serviceArguments;
const resolveServiceRepositoryRoot = (serviceArguments as typeof serviceArguments & {
  resolveServiceRepositoryRoot: (argv: string[], moduleRoot: string) => string;
}).resolveServiceRepositoryRoot;

const repositoryRoot = realpathSync(join(import.meta.dirname, '..'));
const temporaryDirectories: string[] = [];

function createRepositoryDirectory(): string {
  const parentDirectory = join(repositoryRoot, 'tests', '.tmp');
  mkdirSync(parentDirectory, { recursive: true });
  const directory = mkdtempSync(join(parentDirectory, 'service-args-'));
  temporaryDirectories.push(directory);
  return directory;
}

function createOutsideDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'plotter-service-args-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('parseServiceArguments', () => {
  it('accepts a numeric port and a repository data directory', () => {
    const repositoryDataDir = createRepositoryDirectory();

    expect(parseServiceArguments([
      '--port', '5175',
      '--data-dir', repositoryDataDir,
    ], repositoryRoot)).toEqual({ port: 5175, dataDir: repositoryDataDir });
  });

  it('rejects missing required arguments without exposing repository paths', () => {
    expect(() => parseServiceArguments([], repositoryRoot))
      .toThrow('The service port is required.');
    expect(() => parseServiceArguments(['--port', '5175'], repositoryRoot))
      .toThrow('The service data directory is required.');
  });

  it('rejects ports outside the supported TCP range without exposing repository paths', () => {
    const repositoryDataDir = createRepositoryDirectory();

    for (const port of ['0', '65536', 'not-a-number']) {
      expect(() => parseServiceArguments([
        '--port', port,
        '--data-dir', repositoryDataDir,
      ], repositoryRoot)).toThrow('The service port must be an integer between 1 and 65535.');
    }
  });

  it('rejects data directories outside the canonical repository', () => {
    const outsideDirectory = createOutsideDirectory();

    expect(() => parseServiceArguments([
      '--port', '5175',
      '--data-dir', outsideDirectory,
    ], repositoryRoot)).toThrow('The service data directory is outside the Plotter repository.');
  });

  it('rejects a repository symlink that escapes the canonical repository', () => {
    const outsideDirectory = createOutsideDirectory();
    const repositoryDirectory = createRepositoryDirectory();
    const escapedDataDirectory = join(repositoryDirectory, 'escaped-data');
    symlinkSync(outsideDirectory, escapedDataDirectory);

    expect(() => parseServiceArguments([
      '--port', '5175',
      '--data-dir', escapedDataDirectory,
    ], repositoryRoot)).toThrow('The service data directory is outside the Plotter repository.');
  });

  it('accepts an optional existing env file', () => {
    const repositoryDataDir = createRepositoryDirectory();
    const envFile = join(repositoryDataDir, '.service.env');
    writeFileSync(envFile, 'PLOTTER_SERVICE_TEST=value\n');

    expect(parseServiceArguments([
      '--port', '5175',
      '--data-dir', repositoryDataDir,
      '--env-file', envFile,
    ], repositoryRoot)).toEqual({
      port: 5175,
      dataDir: repositoryDataDir,
      envFile,
    });
  });

  it('uses an absolute optional env-file parent as the trusted root for relocated releases', () => {
    const repositoryDirectory = createOutsideDirectory();
    const moduleRoot = join(repositoryDirectory, 'release');
    const dataDirectory = join(repositoryDirectory, 'user-data');
    const envFile = join(repositoryDirectory, '.env');
    mkdirSync(moduleRoot);

    const resolvedRepositoryRoot = resolveServiceRepositoryRoot([
      '--port', '5175',
      '--data-dir', dataDirectory,
      '--env-file', envFile,
    ], moduleRoot);

    expect(resolvedRepositoryRoot).toBe(realpathSync(repositoryDirectory));
    expect(parseServiceArguments([
      '--port', '5175',
      '--data-dir', dataDirectory,
      '--env-file', envFile,
    ], resolvedRepositoryRoot)).toEqual({
      port: 5175,
      dataDir: join(realpathSync(repositoryDirectory), 'user-data'),
      envFile: join(realpathSync(repositoryDirectory), '.env'),
    });
  });

  it('accepts a missing optional env file while rejecting relative and outside-root data paths', () => {
    const repositoryDirectory = createOutsideDirectory();
    const moduleRoot = join(repositoryDirectory, 'release');
    const dataDirectory = join(repositoryDirectory, 'user-data');
    const envFile = join(repositoryDirectory, '.env');
    const outsideDirectory = createOutsideDirectory();
    mkdirSync(moduleRoot);

    expect(() => resolveServiceRepositoryRoot([
      '--port', '5175', '--data-dir', dataDirectory, '--env-file', '.env',
    ], moduleRoot)).toThrow('The service env file must be an absolute path.');

    const resolvedRepositoryRoot = resolveServiceRepositoryRoot([
      '--port', '5175', '--data-dir', dataDirectory, '--env-file', envFile,
    ], moduleRoot);
    expect(() => parseServiceArguments([
      '--port', '5175', '--data-dir', outsideDirectory, '--env-file', envFile,
    ], resolvedRepositoryRoot)).toThrow('The service data directory is outside the Plotter repository.');
  });

  it('falls back to the module root when no env-file is supplied', () => {
    const repositoryDirectory = createOutsideDirectory();
    const moduleRoot = join(repositoryDirectory, 'server-dist');
    mkdirSync(moduleRoot);

    expect(resolveServiceRepositoryRoot(['--port', '5175', '--data-dir', 'user-data'], moduleRoot))
      .toBe(realpathSync(repositoryDirectory));
  });

  it('accepts the standard Node argument separator before service options', () => {
    const repositoryDataDir = createRepositoryDirectory();

    expect(parseServiceArguments([
      '--', '--port', '5175', '--data-dir', repositoryDataDir,
    ], repositoryRoot)).toEqual({ port: 5175, dataDir: repositoryDataDir });
  });
});

describe('explicit NAS paths', () => {
  const options = ['--runtime', 'nas-docker', '--port', '4174', '--data-dir', '/state',
    '--bind-host', '0.0.0.0', '--public-origin', 'https://plotter.example.ts.net',
    '--proxy-address', '172.30.200.2'];
  it('selects only the fixed durable mount and optional selected secret', () => {
    expect(parseServiceArguments([...options, '--env-file', '/run/secrets/plotter.env'], repositoryRoot)).toMatchObject({
      dataDir: '/state', envFile: '/run/secrets/plotter.env', bindHost: '0.0.0.0', runtime: 'nas-docker',
      ingress: { publicOrigin: 'https://plotter.example.ts.net', proxyAddress: '172.30.200.2' },
    });
    expect(resolveServiceRepositoryRoot([...options, '--env-file', '/run/secrets/plotter.env'], repositoryRoot)).toBe(realpathSync(join(repositoryRoot, '..')));
  });
  it('refuses arbitrary external stores, secrets, and incomplete proxy configuration', () => {
    for (const [flag, value] of [['--data-dir', '/tmp/store'], ['--bind-host', '127.0.0.1']]) {
      const modified = [...options]; modified[modified.indexOf(flag) + 1] = value;
      expect(() => parseServiceArguments(modified, repositoryRoot)).toThrow();
    }
    expect(() => parseServiceArguments([...options, '--env-file', '/etc/passwd'], repositoryRoot)).toThrow();
    expect(() => parseServiceArguments(options.slice(0, -2), repositoryRoot)).toThrow();
  });
});
