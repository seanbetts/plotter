import { createDestination, updateDestination } from '../domain/destinations';
import { sortResearchLinks } from '../domain/researchLinks';
import type { Activity, Destination, RouteLeg } from '../domain/types';
import type { TripSummary } from '../storage/tripDirectoryRepository';
import type { TripRepository } from '../storage/tripRepository';
import {
  reconcileAndSaveRouteLegs,
  type CalculateRoute,
} from './routeOrchestration';
import type {
  ChangedSummary,
  CommandResult,
  StopDraft,
  StopPatch,
  TripDataServiceDependencies,
  TripWithData,
} from './types';
import {
  TripCommandValidationError,
  validateStopDraft,
  validateStopPatch,
} from './validation';

export type CommandOptions = {
  dryRun?: boolean;
  yes?: boolean;
};

export type TripDataService = {
  listTrips(): Promise<CommandResult<{ trips: Array<TripSummary & { stopCount: number }> }>>;
  getTrip(input: { tripId: string; includeActivities?: boolean; includeLinks?: boolean }): Promise<CommandResult<{ trip: TripWithData }>>;
  createTrip(input: { name: string; stops?: unknown[] }, options?: CommandOptions): Promise<CommandResult<{ trip: TripSummary; stops: Destination[]; routeLegs: RouteLeg[]; changed: ChangedSummary }>>;
  deleteTrip(input: { tripId: string }, options?: CommandOptions): Promise<CommandResult<{ changed: ChangedSummary }>>;
  renameTrip(input: { tripId: string; name: string }, options?: CommandOptions): Promise<CommandResult<{ trip: TripSummary; changed: ChangedSummary }>>;
  replaceStops(input: { tripId: string; stops: unknown[] }, options?: CommandOptions): Promise<CommandResult<{ stops: Destination[]; routeLegs: RouteLeg[]; changed: ChangedSummary }>>;
  insertStop(input: { tripId: string; afterStopId?: string; beforeStopId?: string; stop: unknown }, options?: CommandOptions): Promise<CommandResult<{ stop: Destination; stops: Destination[]; routeLegs: RouteLeg[]; changed: ChangedSummary }>>;
  updateStop(input: { tripId: string; stopId: string; patch: unknown }, options?: CommandOptions): Promise<CommandResult<{ stop: Destination; routeLegs: RouteLeg[]; changed: ChangedSummary }>>;
  deleteStop(input: { tripId: string; stopId: string }, options?: CommandOptions): Promise<CommandResult<{ changed: ChangedSummary }>>;
  reorderStops(input: { tripId: string; stopIds: string[]; strict?: boolean }, options?: CommandOptions): Promise<CommandResult<{ stops: Destination[]; routeLegs: RouteLeg[]; changed: ChangedSummary }>>;
  listActivities(input: { tripId: string; stopId: string }): Promise<CommandResult<{ activities: Activity[] }>>;
  createActivity(input: { tripId: string; stopId: string; activity: unknown }, options?: CommandOptions): Promise<CommandResult<{ activity: Activity; changed: ChangedSummary }>>;
  updateActivity(input: { tripId: string; activityId: string; patch: unknown }, options?: CommandOptions): Promise<CommandResult<{ activity: Activity; changed: ChangedSummary }>>;
  deleteActivity(input: { tripId: string; activityId: string }, options?: CommandOptions): Promise<CommandResult<{ changed: ChangedSummary }>>;
  reorderActivities(input: { tripId: string; stopId: string; activityIds: string[] }, options?: CommandOptions): Promise<CommandResult<{ activities: Activity[]; changed: ChangedSummary }>>;
  addStopLink(input: { tripId: string; stopId: string; url: unknown }, options?: CommandOptions): Promise<CommandResult<{ changed: ChangedSummary }>>;
  deleteStopLink(input: { tripId: string; stopId: string; linkId: string }, options?: CommandOptions): Promise<CommandResult<{ changed: ChangedSummary }>>;
  addActivityLink(input: { tripId: string; activityId: string; url: unknown }, options?: CommandOptions): Promise<CommandResult<{ changed: ChangedSummary }>>;
  deleteActivityLink(input: { tripId: string; activityId: string; linkId: string }, options?: CommandOptions): Promise<CommandResult<{ changed: ChangedSummary }>>;
};

const emptyChanged = (): ChangedSummary => ({
  tripsCreated: [],
  tripsDeleted: [],
  stopsAdded: [],
  stopsUpdated: [],
  stopsDeleted: [],
  activitiesAdded: [],
  activitiesUpdated: [],
  activitiesDeleted: [],
  linksAdded: [],
  linksDeleted: [],
  routesRecalculated: 0,
});

function unsupported<T>(summary: string): CommandResult<T> {
  return {
    ok: false,
    error: {
      code: 'COMMAND_NOT_IMPLEMENTED',
      message: summary,
    },
  };
}

function commandError<T>(code: string, message: string, path?: string): CommandResult<T> {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(path ? { path } : {}),
    },
  };
}

type CommandFailure = ReturnType<typeof commandError<never>>;

function commandSuccess<T extends object>(summary: string, payload: T): CommandResult<T> {
  return {
    ok: true,
    summary,
    ...payload,
  };
}

function trimRequiredString(value: unknown, label: string, path: string) {
  if (typeof value !== 'string') {
    throw new TripCommandValidationError('INVALID_STRING', `${label} must be a string.`, path);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new TripCommandValidationError('REQUIRED_STRING', `${label} is required.`, path);
  }
  return trimmed;
}

function ensureStopIdList(stopIds: string[]) {
  if (!Array.isArray(stopIds) || stopIds.length === 0) {
    throw new TripCommandValidationError('STOP_IDS_REQUIRED', 'Provide at least one stop id.', 'stopIds');
  }

  const normalized: string[] = [];
  for (const [index, stopId] of stopIds.entries()) {
    const trimmed = trimRequiredString(stopId, `stopIds[${index}]`, `stopIds[${index}]`);
    if (normalized.includes(trimmed)) {
      throw new TripCommandValidationError('DUPLICATE_STOP_ID', `Duplicate stop id '${trimmed}'.`, `stopIds[${index}]`);
    }
    normalized.push(trimmed);
  }

  return normalized;
}

async function findTripSummary(directory: TripDataServiceDependencies['directory'], tripId: string) {
  const trip = (await directory.listTrips()).find((candidate) => candidate.id === tripId);
  if (!trip) {
    throw new Error('Trip not found.');
  }
  return trip;
}

function normalizeDestinationLinks(destination: Destination): Destination {
  return {
    ...destination,
    research: {
      ...destination.research,
      links: sortResearchLinks(destination.research.links ?? []),
      bookReferences: destination.research.bookReferences ?? [],
      notes: destination.research.notes ?? '',
    },
  };
}

function normalizeOrderedDestinations(destinations: Destination[]) {
  return destinations.map((destination, order) =>
    destination.order === order
      ? normalizeDestinationLinks(destination)
      : normalizeDestinationLinks(
        updateDestination(destination, {
          order,
        }),
      ));
}

async function resolveStopLocation(
  draft: Pick<StopDraft, 'name' | 'place'>,
  dependencies: TripDataServiceDependencies,
) {
  if (dependencies.resolvePlace) {
    return dependencies.resolvePlace({
      place: draft.place,
      profile: 'stop',
      fallbackName: draft.name,
    });
  }

  if (!draft.place.coordinates) {
    throw new TripCommandValidationError(
      'PLACE_RESOLVER_REQUIRED',
      'A place resolver is required when coordinates are omitted.',
      'stop.place',
    );
  }

  return {
    coordinates: draft.place.coordinates,
    location: undefined,
  };
}

async function destinationFromDraft(
  draft: StopDraft,
  order: number,
  dependencies: TripDataServiceDependencies,
): Promise<Destination> {
  const resolved = await resolveStopLocation(draft, dependencies);
  const destination = createDestination({
    name: draft.name,
    coordinates: resolved.coordinates,
    location: resolved.location,
    order,
  });

  return updateDestination(destination, {
    timing: {
      ...destination.timing,
      expectedStayDays: draft.expectedStayDays ?? destination.timing.expectedStayDays,
    },
    research: {
      ...destination.research,
      notes: draft.notes ?? destination.research.notes,
    },
    tags: draft.tags ?? destination.tags,
  });
}

async function updateDestinationFromDraft(
  destination: Destination,
  draft: StopDraft,
  order: number,
  dependencies: TripDataServiceDependencies,
) {
  const resolved = await resolveStopLocation(draft, dependencies);

  return normalizeDestinationLinks(
    updateDestination(destination, {
      name: draft.name,
      coordinates: resolved.coordinates,
      location: resolved.location ?? destination.location,
      countryRegion: resolved.location?.countryName ?? destination.countryRegion,
      order,
      timing: {
        ...destination.timing,
        expectedStayDays: draft.expectedStayDays ?? destination.timing.expectedStayDays,
      },
      research: {
        ...destination.research,
        notes: draft.notes ?? destination.research.notes,
      },
      tags: draft.tags ?? destination.tags,
    }),
  );
}

async function updateDestinationFromPatch(
  destination: Destination,
  patch: StopPatch,
  dependencies: TripDataServiceDependencies,
) {
  let nextCoordinates = destination.coordinates;
  let nextLocation = destination.location;

  if (patch.place) {
    const resolved = await resolveStopLocation(
      {
        name: patch.name ?? destination.name,
        place: patch.place,
      },
      dependencies,
    );
    nextCoordinates = resolved.coordinates;
    nextLocation = resolved.location ?? destination.location;
  }

  return normalizeDestinationLinks(
    updateDestination(destination, {
      name: patch.name ?? destination.name,
      coordinates: nextCoordinates,
      location: nextLocation,
      countryRegion: nextLocation.countryName ?? destination.countryRegion,
      timing: {
        ...destination.timing,
        expectedStayDays: patch.expectedStayDays ?? destination.timing.expectedStayDays,
      },
      research: {
        ...destination.research,
        notes: patch.notes ?? destination.research.notes,
      },
      tags: patch.tags ?? destination.tags,
    }),
  );
}

async function planRouteLegs(input: {
  destinations: Destination[];
  currentRouteLegs: RouteLeg[];
  calculateRoute?: CalculateRoute;
}) {
  const routeLegs: RouteLeg[] = [];
  await reconcileAndSaveRouteLegs({
    destinations: input.destinations,
    currentRouteLegs: input.currentRouteLegs,
    calculateRoute: input.calculateRoute,
    repository: {
      async saveRouteLeg(routeLeg) {
        routeLegs.push(routeLeg);
      },
      async deleteRouteLeg() {
        return undefined;
      },
    },
  });

  return routeLegs;
}

function countRouteLegChanges(currentRouteLegs: RouteLeg[], nextRouteLegs: RouteLeg[]) {
  const currentById = new Map(currentRouteLegs.map((routeLeg) => [routeLeg.id, routeLeg]));

  return nextRouteLegs.filter((routeLeg) => {
    const current = currentById.get(routeLeg.id);
    if (!current) return true;
    return (
      current.updatedAt !== routeLeg.updatedAt ||
      current.originDestinationId !== routeLeg.originDestinationId ||
      current.targetDestinationId !== routeLeg.targetDestinationId ||
      current.status !== routeLeg.status ||
      current.routeKey !== routeLeg.routeKey ||
      current.distanceKm !== routeLeg.distanceKm ||
      current.travelTimeHours !== routeLeg.travelTimeHours
    );
  }).length;
}

async function saveStopsAndRouteLegs(input: {
  repository: TripRepository;
  currentRouteLegs: RouteLeg[];
  nextDestinations: Destination[];
  removedDestinationIds?: string[];
  calculateRoute?: CalculateRoute;
}) {
  for (const destination of input.nextDestinations) {
    await input.repository.saveDestination(destination);
  }

  for (const destinationId of input.removedDestinationIds ?? []) {
    await input.repository.deleteDestination(destinationId);
  }

  const routeLegs = await reconcileAndSaveRouteLegs({
    destinations: input.nextDestinations,
    currentRouteLegs: input.currentRouteLegs,
    repository: input.repository,
    calculateRoute: input.calculateRoute,
  });

  return {
    routeLegs,
    routesRecalculated: countRouteLegChanges(input.currentRouteLegs, routeLegs),
  };
}

function ensureConfirmed(
  options: CommandOptions | undefined,
  message: string,
): CommandFailure | null {
  if (options?.dryRun || options?.yes) return null;
  return commandError('CONFIRMATION_REQUIRED', message);
}

function validationErrorResult<T>(error: TripCommandValidationError): CommandResult<T> {
  return commandError(error.code, error.message, error.path);
}

function genericErrorResult<T>(error: unknown): CommandResult<T> {
  return commandError(
    'COMMAND_FAILED',
    error instanceof Error ? error.message : 'Command failed.',
  );
}

function notFoundResult<T>(entity: 'trip' | 'stop', id: string): CommandResult<T> {
  return commandError(
    entity === 'trip' ? 'TRIP_NOT_FOUND' : 'STOP_NOT_FOUND',
    entity === 'trip' ? `Trip '${id}' was not found.` : `Stop '${id}' was not found.`,
  );
}

async function withCommandHandling<T>(execute: () => Promise<CommandResult<T>>): Promise<CommandResult<T>> {
  try {
    return await execute();
  } catch (error) {
    if (error instanceof TripCommandValidationError) {
      return validationErrorResult(error);
    }

    if (error instanceof Error && error.message === 'Trip not found.') {
      return commandError('TRIP_NOT_FOUND', 'Trip not found.');
    }

    if (error instanceof Error && error.message === 'Stop not found.') {
      return commandError('STOP_NOT_FOUND', 'Stop not found.');
    }

    return genericErrorResult(error);
  }
}

export function createTripDataService(
  dependencies: TripDataServiceDependencies,
): TripDataService {
  return {
    async listTrips() {
      return withCommandHandling(async () => {
        const trips = await dependencies.directory.listTrips();
        const tripsWithCounts = await Promise.all(
          trips.map(async (trip) => {
            const stopCount = (await dependencies.createTripRepository(trip.id).listDestinations()).length;
            return { ...trip, stopCount };
          }),
        );

        return commandSuccess(
          `Loaded ${tripsWithCounts.length} trip${tripsWithCounts.length === 1 ? '' : 's'}.`,
          { trips: tripsWithCounts },
        );
      });
    },

    async getTrip(input) {
      return withCommandHandling(async () => {
        const tripId = trimRequiredString(input.tripId, 'Trip id', 'tripId');
        const trip = await findTripSummary(dependencies.directory, tripId);
        const repository = dependencies.createTripRepository(trip.id);
        const stops = normalizeOrderedDestinations(await repository.listDestinations());
        const routeLegs = await repository.listRouteLegs();
        const activitiesByStopId = input.includeActivities
          ? Object.fromEntries(
            await Promise.all(
              stops.map(async (stop) => [stop.id, await repository.listActivities(stop.id)] as const),
            ),
          )
          : undefined;

        return commandSuccess(`Loaded trip ${trip.name}.`, {
          trip: {
            trip,
            stops,
            routeLegs,
            ...(activitiesByStopId ? { activitiesByStopId } : {}),
          },
        });
      });
    },

    async createTrip(input, options) {
      return withCommandHandling(async () => {
        const name = trimRequiredString(input.name, 'Trip name', 'name');
        if (input.stops !== undefined && !Array.isArray(input.stops)) {
          throw new TripCommandValidationError('INVALID_STOPS', 'stops must be an array.', 'stops');
        }

        const stopDrafts = (input.stops ?? []).map((stop, index) => validateStopDraft(stop, `stops[${index}]`));
        const stops = await Promise.all(
          stopDrafts.map((stopDraft, index) => destinationFromDraft(stopDraft, index, dependencies)),
        );
        const routeLegs = await planRouteLegs({
          destinations: stops,
          currentRouteLegs: [],
          calculateRoute: dependencies.calculateRoute,
        });
        const changed = emptyChanged();
        changed.tripsCreated.push(name);
        changed.stopsAdded.push(...stops.map((stop) => stop.name));
        changed.routesRecalculated = countRouteLegChanges([], routeLegs);

        if (options?.dryRun) {
          return commandSuccess(`Would create trip ${name}.`, {
            trip: {
              id: 'dry-run-trip',
              name,
              description: '',
              createdAt: '',
              updatedAt: '',
            },
            stops,
            routeLegs,
            changed,
          });
        }

        const trip = await dependencies.directory.createTrip({ name });
        const repository = dependencies.createTripRepository(trip.id);
        for (const stop of stops) {
          await repository.saveDestination(stop);
        }
        for (const routeLeg of routeLegs) {
          await repository.saveRouteLeg(routeLeg);
        }

        return commandSuccess(`Created trip ${trip.name}.`, {
          trip,
          stops,
          routeLegs,
          changed,
        });
      });
    },

    async deleteTrip(input, options) {
      return withCommandHandling(async () => {
        const tripId = trimRequiredString(input.tripId, 'Trip id', 'tripId');
        const trip = await findTripSummary(dependencies.directory, tripId);
        const confirmation = ensureConfirmed(
          options,
          `Deleting trip ${trip.name} requires --yes or --dry-run.`,
        );
        if (confirmation) return confirmation;

        const changed = emptyChanged();
        changed.tripsDeleted.push(trip.name);

        if (options?.dryRun) {
          return commandSuccess(`Would delete trip ${trip.name}.`, { changed });
        }

        await dependencies.directory.deleteTrip(tripId);
        return commandSuccess(`Deleted trip ${trip.name}.`, { changed });
      });
    },

    async renameTrip(input, options) {
      return withCommandHandling(async () => {
        const tripId = trimRequiredString(input.tripId, 'Trip id', 'tripId');
        const name = trimRequiredString(input.name, 'Trip name', 'name');
        const trip = await findTripSummary(dependencies.directory, tripId);
        const changed = emptyChanged();

        if (options?.dryRun) {
          return commandSuccess(`Would rename trip ${trip.name} to ${name}.`, {
            trip: { ...trip, name },
            changed,
          });
        }

        const updatedTrip = await dependencies.directory.updateTrip(tripId, { name });
        return commandSuccess(`Renamed trip to ${updatedTrip.name}.`, {
          trip: updatedTrip,
          changed,
        });
      });
    },

    async replaceStops(input, options) {
      return withCommandHandling(async () => {
        const tripId = trimRequiredString(input.tripId, 'Trip id', 'tripId');
        await findTripSummary(dependencies.directory, tripId);
        const confirmation = ensureConfirmed(
          options,
          'Replacing stops requires --yes or --dry-run.',
        );
        if (confirmation) return confirmation;

        if (!Array.isArray(input.stops)) {
          throw new TripCommandValidationError('INVALID_STOPS', 'stops must be an array.', 'stops');
        }

        const repository = dependencies.createTripRepository(tripId);
        const currentStops = normalizeOrderedDestinations(await repository.listDestinations());
        const currentRouteLegs = await repository.listRouteLegs();
        const currentStopById = new Map(currentStops.map((stop) => [stop.id, stop]));
        const stopDrafts = input.stops.map((stop, index) => validateStopDraft(stop, `stops[${index}]`));
        const seenIds = new Set<string>();

        for (const [index, stopDraft] of stopDrafts.entries()) {
          if (!stopDraft.id) continue;
          if (seenIds.has(stopDraft.id)) {
            throw new TripCommandValidationError(
              'DUPLICATE_STOP_ID',
              `Duplicate stop id '${stopDraft.id}'.`,
              `stops[${index}].id`,
            );
          }
          seenIds.add(stopDraft.id);
        }

        const nextStops = normalizeOrderedDestinations(
          await Promise.all(
            stopDrafts.map(async (stopDraft, index) => {
              const existing = stopDraft.id ? currentStopById.get(stopDraft.id) : undefined;
              if (stopDraft.id && !existing) {
                throw new TripCommandValidationError(
                  'STOP_NOT_FOUND',
                  `Stop '${stopDraft.id}' was not found.`,
                  `stops[${index}].id`,
                );
              }
              return existing
                ? updateDestinationFromDraft(existing, stopDraft, index, dependencies)
                : destinationFromDraft(stopDraft, index, dependencies);
            }),
          ),
        );
        const removedStops = currentStops.filter((stop) => !nextStops.some((candidate) => candidate.id === stop.id));
        const changed = emptyChanged();
        changed.stopsAdded.push(
          ...nextStops
            .filter((stop) => !currentStopById.has(stop.id))
            .map((stop) => stop.name),
        );
        changed.stopsUpdated.push(
          ...nextStops
            .filter((stop) => currentStopById.has(stop.id))
            .map((stop) => stop.name),
        );
        changed.stopsDeleted.push(...removedStops.map((stop) => stop.name));

        if (options?.dryRun) {
          const nextRouteLegs = await planRouteLegs({
            destinations: nextStops,
            currentRouteLegs,
            calculateRoute: dependencies.calculateRoute,
          });
          changed.routesRecalculated = countRouteLegChanges(currentRouteLegs, nextRouteLegs);
          return commandSuccess(`Would replace ${currentStops.length} stop${currentStops.length === 1 ? '' : 's'}.`, {
            stops: nextStops,
            routeLegs: nextRouteLegs,
            changed,
          });
        }

        const saved = await saveStopsAndRouteLegs({
          repository,
          currentRouteLegs,
          nextDestinations: nextStops,
          removedDestinationIds: removedStops.map((stop) => stop.id),
          calculateRoute: dependencies.calculateRoute,
        });

        changed.routesRecalculated = saved.routesRecalculated;
        return commandSuccess(`Replaced stops for trip ${tripId}.`, {
          stops: nextStops,
          routeLegs: saved.routeLegs,
          changed,
        });
      });
    },

    async insertStop(input, options) {
      return withCommandHandling(async () => {
        const tripId = trimRequiredString(input.tripId, 'Trip id', 'tripId');
        await findTripSummary(dependencies.directory, tripId);
        const repository = dependencies.createTripRepository(tripId);
        const currentStops = normalizeOrderedDestinations(await repository.listDestinations());
        const currentRouteLegs = await repository.listRouteLegs();
        const stopDraft = validateStopDraft(input.stop, 'stop');

        if (input.afterStopId && input.beforeStopId) {
          const afterIndex = currentStops.findIndex((stop) => stop.id === input.afterStopId);
          const beforeIndex = currentStops.findIndex((stop) => stop.id === input.beforeStopId);
          if (afterIndex === -1) return notFoundResult('stop', input.afterStopId);
          if (beforeIndex === -1) return notFoundResult('stop', input.beforeStopId);
          if (beforeIndex !== afterIndex + 1) {
            return commandError(
              'INVALID_INSERT_POSITION',
              'afterStopId and beforeStopId must describe adjacent stops.',
            );
          }
        }

        let insertionIndex = currentStops.length;
        if (input.afterStopId) {
          const afterIndex = currentStops.findIndex((stop) => stop.id === input.afterStopId);
          if (afterIndex === -1) return notFoundResult('stop', input.afterStopId);
          insertionIndex = afterIndex + 1;
        } else if (input.beforeStopId) {
          const beforeIndex = currentStops.findIndex((stop) => stop.id === input.beforeStopId);
          if (beforeIndex === -1) return notFoundResult('stop', input.beforeStopId);
          insertionIndex = beforeIndex;
        }

        const insertedStop = await destinationFromDraft(stopDraft, insertionIndex, dependencies);
        const nextStops = normalizeOrderedDestinations([
          ...currentStops.slice(0, insertionIndex),
          insertedStop,
          ...currentStops.slice(insertionIndex),
        ]);
        const changed = emptyChanged();
        changed.stopsAdded.push(insertedStop.name);

        if (options?.dryRun) {
          const nextRouteLegs = await planRouteLegs({
            destinations: nextStops,
            currentRouteLegs,
            calculateRoute: dependencies.calculateRoute,
          });
          changed.routesRecalculated = countRouteLegChanges(currentRouteLegs, nextRouteLegs);
          return commandSuccess(`Would insert ${insertedStop.name}.`, {
            stop: insertedStop,
            stops: nextStops,
            routeLegs: nextRouteLegs,
            changed,
          });
        }

        const saved = await saveStopsAndRouteLegs({
          repository,
          currentRouteLegs,
          nextDestinations: nextStops,
          calculateRoute: dependencies.calculateRoute,
        });
        changed.routesRecalculated = saved.routesRecalculated;

        return commandSuccess(`Inserted ${insertedStop.name}.`, {
          stop: insertedStop,
          stops: nextStops,
          routeLegs: saved.routeLegs,
          changed,
        });
      });
    },

    async updateStop(input, options) {
      return withCommandHandling(async () => {
        const tripId = trimRequiredString(input.tripId, 'Trip id', 'tripId');
        await findTripSummary(dependencies.directory, tripId);
        const stopId = trimRequiredString(input.stopId, 'Stop id', 'stopId');
        const repository = dependencies.createTripRepository(tripId);
        const currentStops = normalizeOrderedDestinations(await repository.listDestinations());
        const currentRouteLegs = await repository.listRouteLegs();
        const stop = currentStops.find((candidate) => candidate.id === stopId);
        if (!stop) return notFoundResult('stop', stopId);

        const patch = validateStopPatch(input.patch, 'patch');
        const updatedStop = await updateDestinationFromPatch(stop, patch, dependencies);
        const nextStops = currentStops.map((candidate) => (candidate.id === stopId ? updatedStop : candidate));
        const changed = emptyChanged();
        changed.stopsUpdated.push(updatedStop.name);

        if (options?.dryRun) {
          const nextRouteLegs = await planRouteLegs({
            destinations: nextStops,
            currentRouteLegs,
            calculateRoute: dependencies.calculateRoute,
          });
          changed.routesRecalculated = countRouteLegChanges(currentRouteLegs, nextRouteLegs);
          return commandSuccess(`Would update ${updatedStop.name}.`, {
            stop: updatedStop,
            routeLegs: nextRouteLegs,
            changed,
          });
        }

        await repository.saveDestination(updatedStop);
        const savedRouteLegs = await reconcileAndSaveRouteLegs({
          destinations: nextStops,
          currentRouteLegs,
          repository,
          calculateRoute: dependencies.calculateRoute,
        });
        changed.routesRecalculated = countRouteLegChanges(currentRouteLegs, savedRouteLegs);

        return commandSuccess(`Updated ${updatedStop.name}.`, {
          stop: updatedStop,
          routeLegs: savedRouteLegs,
          changed,
        });
      });
    },

    async deleteStop(input, options) {
      return withCommandHandling(async () => {
        const tripId = trimRequiredString(input.tripId, 'Trip id', 'tripId');
        await findTripSummary(dependencies.directory, tripId);
        const stopId = trimRequiredString(input.stopId, 'Stop id', 'stopId');
        const repository = dependencies.createTripRepository(tripId);
        const currentStops = normalizeOrderedDestinations(await repository.listDestinations());
        const currentRouteLegs = await repository.listRouteLegs();
        const stop = currentStops.find((candidate) => candidate.id === stopId);
        if (!stop) return notFoundResult('stop', stopId);

        const confirmation = ensureConfirmed(
          options,
          `Deleting stop ${stop.name} requires --yes or --dry-run.`,
        );
        if (confirmation) return confirmation;

        const nextStops = normalizeOrderedDestinations(
          currentStops.filter((candidate) => candidate.id !== stopId),
        );
        const changed = emptyChanged();
        changed.stopsDeleted.push(stop.name);

        if (options?.dryRun) {
          const nextRouteLegs = await planRouteLegs({
            destinations: nextStops,
            currentRouteLegs,
            calculateRoute: dependencies.calculateRoute,
          });
          changed.routesRecalculated = countRouteLegChanges(currentRouteLegs, nextRouteLegs);
          return commandSuccess(`Would delete ${stop.name}.`, { changed });
        }

        const saved = await saveStopsAndRouteLegs({
          repository,
          currentRouteLegs,
          nextDestinations: nextStops,
          removedDestinationIds: [stopId],
          calculateRoute: dependencies.calculateRoute,
        });
        changed.routesRecalculated = saved.routesRecalculated;

        return commandSuccess(`Deleted ${stop.name}.`, { changed });
      });
    },

    async reorderStops(input, options) {
      return withCommandHandling(async () => {
        const tripId = trimRequiredString(input.tripId, 'Trip id', 'tripId');
        await findTripSummary(dependencies.directory, tripId);
        const orderedIds = ensureStopIdList(input.stopIds);
        const repository = dependencies.createTripRepository(tripId);
        const currentStops = normalizeOrderedDestinations(await repository.listDestinations());
        const currentRouteLegs = await repository.listRouteLegs();
        const currentById = new Map(currentStops.map((stop) => [stop.id, stop]));

        for (const stopId of orderedIds) {
          if (!currentById.has(stopId)) return notFoundResult('stop', stopId);
        }

        if (input.strict) {
          const currentIds = currentStops.map((stop) => stop.id);
          if (orderedIds.length !== currentIds.length || currentIds.some((stopId) => !orderedIds.includes(stopId))) {
            return commandError('STOP_ID_MISMATCH', 'Strict reorder must include every stop exactly once.');
          }
        }

        const requestedIds = new Set(orderedIds);
        const nextStops = normalizeOrderedDestinations([
          ...orderedIds.map((stopId) => currentById.get(stopId)).filter((stop): stop is Destination => Boolean(stop)),
          ...currentStops.filter((stop) => !requestedIds.has(stop.id)),
        ]);
        const changed = emptyChanged();
        changed.stopsUpdated.push(...nextStops.map((stop) => stop.name));

        if (options?.dryRun) {
          const nextRouteLegs = await planRouteLegs({
            destinations: nextStops,
            currentRouteLegs,
            calculateRoute: dependencies.calculateRoute,
          });
          changed.routesRecalculated = countRouteLegChanges(currentRouteLegs, nextRouteLegs);
          return commandSuccess('Would reorder stops.', {
            stops: nextStops,
            routeLegs: nextRouteLegs,
            changed,
          });
        }

        const saved = await saveStopsAndRouteLegs({
          repository,
          currentRouteLegs,
          nextDestinations: nextStops,
          calculateRoute: dependencies.calculateRoute,
        });
        changed.routesRecalculated = saved.routesRecalculated;

        return commandSuccess('Reordered stops.', {
          stops: nextStops,
          routeLegs: saved.routeLegs,
          changed,
        });
      });
    },

    async listActivities() {
      return unsupported('Activity commands land in Task 5.');
    },

    async createActivity() {
      return unsupported('Activity commands land in Task 5.');
    },

    async updateActivity() {
      return unsupported('Activity commands land in Task 5.');
    },

    async deleteActivity() {
      return unsupported('Activity commands land in Task 5.');
    },

    async reorderActivities() {
      return unsupported('Activity commands land in Task 5.');
    },

    async addStopLink() {
      return unsupported('Link commands land in Task 5.');
    },

    async deleteStopLink() {
      return unsupported('Link commands land in Task 5.');
    },

    async addActivityLink() {
      return unsupported('Link commands land in Task 5.');
    },

    async deleteActivityLink() {
      return unsupported('Link commands land in Task 5.');
    },
  };
}

export { emptyChanged };
