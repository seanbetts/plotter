import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { calculateOpenRouteServiceRoute } from '../adapters/openRouteService';
import { createSupabaseLinkPreviewClient } from '../services/linkPreviewClient';
import { createSupabaseTripDirectoryRepository } from '../storage/tripDirectoryRepository';
import { createSupabaseTripRepository } from '../storage/supabaseTripRepository';
import { createLinkEnricher } from '../tripCommands/linkEnrichment';
import { createPlaceResolver } from '../tripCommands/placeResolver';
import { createTripDataService } from '../tripCommands/tripDataService';
import type { TripDataService } from '../tripCommands/tripDataService';
import { createNodeSupabaseClient, ensureNodeAnonymousSession } from './nodeSupabase';

type ParsedArgs = {
  command: string;
  flags: Record<string, string | boolean>;
};

type RunTripCliInput = {
  argv: string[];
  service: TripDataService;
  readFile: (path: string) => Promise<string>;
  write: (value: string) => void;
  writeError: (value: string) => void;
};

type CliResult = {
  ok: false;
  error: {
    code: string;
    message: string;
  };
};

type JsonRecord = Record<string, unknown>;

export function parseTripCliArgs(argv: string[]): ParsedArgs {
  const [command = 'help', ...rest] = argv;
  const flags: Record<string, string | boolean> = {};

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) {
      continue;
    }

    const name = token.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith('--')) {
      flags[name] = true;
      continue;
    }

    flags[name] = next;
    index += 1;
  }

  return { command, flags };
}

function stringFlag(flags: Record<string, string | boolean>, name: string) {
  const value = flags[name];
  return typeof value === 'string' ? value : undefined;
}

async function readJson(path: string | undefined, readFileImpl: RunTripCliInput['readFile']) {
  if (!path) {
    throw new Error('Missing --input path.');
  }

  return JSON.parse(await readFileImpl(path));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function writeStructuredError(write: (value: string) => void, message: string, code = 'COMMAND_FAILED') {
  const payload: CliResult = {
    ok: false,
    error: {
      code,
      message,
    },
  };

  write(`${JSON.stringify(payload)}\n`);
}

function errorMessage(caught: unknown) {
  return caught instanceof Error ? caught.message : 'Trip CLI failed.';
}

async function readIdList(
  path: string | undefined,
  key: string,
  readFileImpl: RunTripCliInput['readFile'],
) {
  const value = await readJson(path, readFileImpl);
  if (isStringArray(value)) {
    return value;
  }

  if (value && typeof value === 'object' && key in value) {
    const candidate = (value as JsonRecord)[key];
    if (isStringArray(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Expected --input JSON to be a string array or an object with '${key}'.`);
}

export async function runTripCli(input: RunTripCliInput) {
  try {
    const { command, flags } = parseTripCliArgs(input.argv);
    const dryRun = Boolean(flags['dry-run']);
    const yes = Boolean(flags.yes);
    let result: unknown;

    switch (command) {
      case 'list':
        result = await input.service.listTrips();
        break;
      case 'get':
        result = await input.service.getTrip({
          tripId: stringFlag(flags, 'trip-id') ?? '',
          includeActivities: Boolean(flags['include-activities']),
          includeLinks: Boolean(flags['include-links']),
        });
        break;
      case 'create':
        result = await input.service.createTrip(
          await readJson(stringFlag(flags, 'input'), input.readFile),
          { dryRun, yes },
        );
        break;
      case 'delete':
        result = await input.service.deleteTrip(
          { tripId: stringFlag(flags, 'trip-id') ?? '' },
          { dryRun, yes },
        );
        break;
      case 'rename':
        result = await input.service.renameTrip(
          {
            tripId: stringFlag(flags, 'trip-id') ?? '',
            name: stringFlag(flags, 'name') ?? '',
          },
          { dryRun, yes },
        );
        break;
      case 'replace-stops':
        result = await input.service.replaceStops(
          {
            tripId: stringFlag(flags, 'trip-id') ?? '',
            stops: await readJson(stringFlag(flags, 'input'), input.readFile),
          },
          { dryRun, yes },
        );
        break;
      case 'insert-stop':
        result = await input.service.insertStop(
          {
            tripId: stringFlag(flags, 'trip-id') ?? '',
            afterStopId: stringFlag(flags, 'after-stop-id'),
            beforeStopId: stringFlag(flags, 'before-stop-id'),
            stop: await readJson(stringFlag(flags, 'input'), input.readFile),
          },
          { dryRun, yes },
        );
        break;
      case 'update-stop':
        result = await input.service.updateStop(
          {
            tripId: stringFlag(flags, 'trip-id') ?? '',
            stopId: stringFlag(flags, 'stop-id') ?? '',
            patch: await readJson(stringFlag(flags, 'input'), input.readFile),
          },
          { dryRun, yes },
        );
        break;
      case 'delete-stop':
        result = await input.service.deleteStop(
          {
            tripId: stringFlag(flags, 'trip-id') ?? '',
            stopId: stringFlag(flags, 'stop-id') ?? '',
          },
          { dryRun, yes },
        );
        break;
      case 'reorder-stops':
        result = await input.service.reorderStops(
          {
            tripId: stringFlag(flags, 'trip-id') ?? '',
            stopIds: await readIdList(stringFlag(flags, 'input'), 'stopIds', input.readFile),
            strict: Boolean(flags.strict),
          },
          { dryRun, yes },
        );
        break;
      case 'add-stop-link':
        result = await input.service.addStopLink(
          {
            tripId: stringFlag(flags, 'trip-id') ?? '',
            stopId: stringFlag(flags, 'stop-id') ?? '',
            url: stringFlag(flags, 'url') ?? '',
          },
          { dryRun, yes },
        );
        break;
      case 'delete-stop-link':
        result = await input.service.deleteStopLink(
          {
            tripId: stringFlag(flags, 'trip-id') ?? '',
            stopId: stringFlag(flags, 'stop-id') ?? '',
            linkId: stringFlag(flags, 'link-id') ?? '',
          },
          { dryRun, yes },
        );
        break;
      case 'list-activities':
        result = await input.service.listActivities({
          tripId: stringFlag(flags, 'trip-id') ?? '',
          stopId: stringFlag(flags, 'stop-id') ?? '',
        });
        break;
      case 'create-activity':
        result = await input.service.createActivity(
          {
            tripId: stringFlag(flags, 'trip-id') ?? '',
            stopId: stringFlag(flags, 'stop-id') ?? '',
            activity: await readJson(stringFlag(flags, 'input'), input.readFile),
          },
          { dryRun, yes },
        );
        break;
      case 'update-activity':
        result = await input.service.updateActivity(
          {
            tripId: stringFlag(flags, 'trip-id') ?? '',
            activityId: stringFlag(flags, 'activity-id') ?? '',
            patch: await readJson(stringFlag(flags, 'input'), input.readFile),
          },
          { dryRun, yes },
        );
        break;
      case 'delete-activity':
        result = await input.service.deleteActivity(
          {
            tripId: stringFlag(flags, 'trip-id') ?? '',
            activityId: stringFlag(flags, 'activity-id') ?? '',
          },
          { dryRun, yes },
        );
        break;
      case 'reorder-activities':
        result = await input.service.reorderActivities(
          {
            tripId: stringFlag(flags, 'trip-id') ?? '',
            stopId: stringFlag(flags, 'stop-id') ?? '',
            activityIds: await readIdList(stringFlag(flags, 'input'), 'activityIds', input.readFile),
          },
          { dryRun, yes },
        );
        break;
      case 'add-activity-link':
        result = await input.service.addActivityLink(
          {
            tripId: stringFlag(flags, 'trip-id') ?? '',
            activityId: stringFlag(flags, 'activity-id') ?? '',
            url: stringFlag(flags, 'url') ?? '',
          },
          { dryRun, yes },
        );
        break;
      case 'delete-activity-link':
        result = await input.service.deleteActivityLink(
          {
            tripId: stringFlag(flags, 'trip-id') ?? '',
            activityId: stringFlag(flags, 'activity-id') ?? '',
            linkId: stringFlag(flags, 'link-id') ?? '',
          },
          { dryRun, yes },
        );
        break;
      default:
        throw new Error(`Unknown trip command '${command}'.`);
    }

    input.write(`${JSON.stringify(result, null, flags.pretty ? 2 : 0)}\n`);
    return typeof result === 'object' && result !== null && 'ok' in result && result.ok === false ? 1 : 0;
  } catch (caught) {
    writeStructuredError(input.writeError, errorMessage(caught));
    return 1;
  }
}

function createCliService() {
  const supabase = createNodeSupabaseClient();

  return {
    supabase,
    service: createTripDataService({
      directory: createSupabaseTripDirectoryRepository(supabase),
      createTripRepository: (tripId) => createSupabaseTripRepository(supabase, tripId),
      calculateRoute: process.env.VITE_OPENROUTESERVICE_API_KEY
        ? (routeInput) => calculateOpenRouteServiceRoute({
            ...routeInput,
            apiKey: process.env.VITE_OPENROUTESERVICE_API_KEY ?? '',
          })
        : undefined,
      resolvePlace: createPlaceResolver({ apiKey: process.env.VITE_MAPTILER_API_KEY }),
      enrichLink: createLinkEnricher(createSupabaseLinkPreviewClient(supabase)),
    }),
  };
}

type RunTripProgramInput = {
  argv?: string[];
  createService?: typeof createCliService;
  ensureSession?: typeof ensureNodeAnonymousSession;
  readFile?: (path: string) => Promise<string>;
  write?: (value: string) => void;
  writeError?: (value: string) => void;
  stdout?: typeof process.stdout.write;
  stderr?: typeof process.stderr.write;
  setExitCode?: (code: number) => void;
};

export async function runTripProgram(input: RunTripProgramInput = {}) {
  try {
    const createService = input.createService ?? createCliService;
    const ensureSession = input.ensureSession ?? ensureNodeAnonymousSession;
    const readFileImpl = input.readFile ?? ((path: string) => readFile(path, 'utf8'));
    const write = input.write ?? ((value: string) => {
      process.stdout.write(value);
    });
    const writeError = input.writeError ?? ((value: string) => {
      process.stderr.write(value);
    });
    const setExitCode = input.setExitCode ?? ((code: number) => {
      process.exitCode = code;
    });

    const { supabase, service } = createService();
    await ensureSession(supabase);

    const exitCode = await runTripCli({
      argv: input.argv ?? process.argv.slice(2),
      service,
      readFile: readFileImpl,
      write,
      writeError,
    });
    setExitCode(exitCode);
    return exitCode;
  } catch (caught) {
    const writeError = input.writeError ?? ((value: string) => {
      process.stderr.write(value);
    });
    const setExitCode = input.setExitCode ?? ((code: number) => {
      process.exitCode = code;
    });
    writeStructuredError(writeError, errorMessage(caught));
    setExitCode(1);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runTripProgram({ argv: process.argv.slice(2) });
}
