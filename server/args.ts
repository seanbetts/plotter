import { existsSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export type ServiceArguments = {
  port: number;
  dataDir: string;
  envFile?: string;
};

const INVALID_ARGUMENTS_MESSAGE = 'The service arguments are invalid.';
const INVALID_PORT_MESSAGE = 'The service port must be an integer between 1 and 65535.';
const MISSING_PORT_MESSAGE = 'The service port is required.';
const MISSING_DATA_DIRECTORY_MESSAGE = 'The service data directory is required.';
const OUTSIDE_DATA_DIRECTORY_MESSAGE = 'The service data directory is outside the Plotter repository.';
const INVALID_DATA_DIRECTORY_MESSAGE = 'The service data directory must be a directory.';
const ABSOLUTE_ENV_FILE_MESSAGE = 'The service env file must be an absolute path.';
const INVALID_ENV_FILE_MESSAGE = 'The service env file must be a file.';
const OUTSIDE_ENV_FILE_MESSAGE = 'The service env file is outside the Plotter repository.';

function parseOptions(argv: string[]): Map<string, string> {
  const options = new Map<string, string>();
  const optionNames = new Set(['--port', '--data-dir', '--env-file']);
  const serviceArguments = argv[0] === '--' ? argv.slice(1) : argv;

  for (let index = 0; index < serviceArguments.length; index += 2) {
    const optionName = serviceArguments[index];
    const value = serviceArguments[index + 1];
    if (!optionNames.has(optionName) || value === undefined || options.has(optionName)) {
      throw new Error(INVALID_ARGUMENTS_MESSAGE);
    }
    options.set(optionName, value);
  }

  return options;
}

export function resolveServiceRepositoryRoot(argv: string[], moduleDirectory: string): string {
  const envFile = parseOptions(argv).get('--env-file');
  if (envFile === undefined) {
    return realpathSync(resolve(moduleDirectory, '..'));
  }
  if (!isAbsolute(envFile)) {
    throw new Error(ABSOLUTE_ENV_FILE_MESSAGE);
  }
  return realpathSync(dirname(envFile));
}

function isContainedBy(repositoryRoot: string, candidate: string): boolean {
  const pathFromRepository = relative(repositoryRoot, candidate);
  return pathFromRepository === '' || (!pathFromRepository.startsWith(`..${sep}`) && pathFromRepository !== '..' && !isAbsolute(pathFromRepository));
}

function canonicalizeRequestedPath(path: string): string {
  try {
    return resolve(realpathSync(dirname(path)), basename(path));
  } catch {
    return path;
  }
}

function parsePort(value: string | undefined): number {
  if (value === undefined) {
    throw new Error(MISSING_PORT_MESSAGE);
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(INVALID_PORT_MESSAGE);
  }
  return port;
}

function resolveDataDirectory(value: string | undefined, repositoryRoot: string): string {
  if (value === undefined) {
    throw new Error(MISSING_DATA_DIRECTORY_MESSAGE);
  }
  const requestedDirectory = canonicalizeRequestedPath(resolve(repositoryRoot, value));
  if (!existsSync(requestedDirectory)) {
    const initialDataDirectory = resolve(repositoryRoot, 'user-data');
    if (requestedDirectory === initialDataDirectory) {
      return initialDataDirectory;
    }
    throw new Error(OUTSIDE_DATA_DIRECTORY_MESSAGE);
  }

  const canonicalDirectory = realpathSync(requestedDirectory);
  if (!isContainedBy(repositoryRoot, canonicalDirectory)) {
    throw new Error(OUTSIDE_DATA_DIRECTORY_MESSAGE);
  }
  if (!statSync(canonicalDirectory).isDirectory()) {
    throw new Error(INVALID_DATA_DIRECTORY_MESSAGE);
  }
  return canonicalDirectory;
}

function resolveEnvFile(value: string | undefined, repositoryRoot: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isAbsolute(value)) {
    throw new Error(ABSOLUTE_ENV_FILE_MESSAGE);
  }
  const requestedFile = canonicalizeRequestedPath(resolve(value));
  if (!isContainedBy(repositoryRoot, requestedFile)) {
    throw new Error(OUTSIDE_ENV_FILE_MESSAGE);
  }
  if (!existsSync(requestedFile)) {
    return requestedFile;
  }
  const canonicalFile = realpathSync(requestedFile);
  if (!isContainedBy(repositoryRoot, canonicalFile)) {
    throw new Error(OUTSIDE_ENV_FILE_MESSAGE);
  }
  if (!statSync(canonicalFile).isFile()) {
    throw new Error(INVALID_ENV_FILE_MESSAGE);
  }
  return canonicalFile;
}

export function parseServiceArguments(argv: string[], repositoryRoot: string): ServiceArguments {
  const canonicalRepositoryRoot = realpathSync(repositoryRoot);
  const options = parseOptions(argv);
  const port = parsePort(options.get('--port'));
  const dataDir = resolveDataDirectory(options.get('--data-dir'), canonicalRepositoryRoot);
  const envFile = resolveEnvFile(options.get('--env-file'), canonicalRepositoryRoot);

  return envFile === undefined ? { port, dataDir } : { port, dataDir, envFile };
}
