import { createActivity as createDomainActivity, reorderActivities as reorderActivityModels, updateActivity as updateDomainActivity } from '../domain/activities';
import { createDestination, updateDestination } from '../domain/destinations';
import { createFallbackResearchLink, normalizeResearchLinkUrl, reorderResearchLinks, sortResearchLinks } from '../domain/researchLinks';
import { createStraightLineGeometry } from '../domain/routeLegs';
import { planRouteLegReconciliation, reconcileRouteLegsForDestinations } from '../domain/routePlanner';
import type { Activity, Destination, ResearchLink, RouteLeg, RouteWaypoint, VehiclePreset } from '../domain/types';
import { resolveVehiclePreset, standardRoutingVehicle } from '../domain/vehiclePresets';
import type { TripSummary } from '../storage/tripDirectoryRepository';
import type { TripRepository } from '../storage/tripRepository';
import {
  calculateAutomaticRouteLegs,
  recalculateAutomaticRouteLegsForVehicle,
  reconcileAndSaveRouteLegs,
  type CalculateRoute,
} from './routeOrchestration';
import { auditTripSnapshot, type TripAuditReport } from './tripAudit';
import { materializeTripManifest } from './tripManifest';
import type {
  ChangedSummary,
  CommandResult,
  StopDraft,
  StopPatch,
  TripDataServiceDependencies,
  TripManifestDraft,
  TripWithData,
} from './types';
import {
  TripCommandValidationError,
  validateActivityDraft,
  validateActivityPatch,
  validateRouteLegIntentPatch,
  validateStopDraft,
  validateStopPatch,
  validateTripManifest,
  validateUrlInput,
  validateVehiclePreset,
} from './validation';

export type CommandOptions = {
  dryRun?: boolean;
  yes?: boolean;
};

export type TripDataService = {
  listTrips(): Promise<CommandResult<{ trips: Array<TripSummary & { stopCount: number }> }>>;
  getTrip(input: { tripId: string; includeActivities?: boolean; includeLinks?: boolean }): Promise<CommandResult<{ trip: TripWithData }>>;
  auditTrip(input: { tripId: string }): Promise<CommandResult<{ audit: TripAuditReport }>>;
  recalculateFailedRoutes(input: { tripId: string }): Promise<CommandResult<{
    routeLegs: RouteLeg[];
    failedRoutesBefore: number;
    failedRoutesAfter: number;
    recalculatedRoutes: Array<{
      routeLegId: string;
      originName: string;
      targetName: string;
      status: RouteLeg['status'];
    }>;
    changed: ChangedSummary;
  }>>;
  setVehicle(input: { tripId: string; preset: VehiclePreset }, options?: CommandOptions): Promise<CommandResult<{
    trip: TripSummary;
    routeLegs: RouteLeg[];
    changed: ChangedSummary;
  }>>;
  updateRouteLeg(input: { tripId: string; routeLegId: string; patch: unknown }, options?: CommandOptions): Promise<CommandResult<{
    routeLeg: RouteLeg;
    changed: ChangedSummary;
  }>>;
  createTrip(input: { name: string; stops?: unknown[] } | TripManifestDraft, options?: CommandOptions): Promise<CommandResult<{ trip: TripSummary; stops: Destination[]; activities: Activity[]; routeLegs: RouteLeg[]; changed: ChangedSummary; audit?: TripAuditReport }>>;
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

function commandError<T>(
  code: string,
  message: string,
  path?: string,
  details?: { audit?: TripAuditReport },
): CommandResult<T> {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(path ? { path } : {}),
      ...(details ? { details } : {}),
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

function reportFromIssues(issues: TripAuditReport['issues']): TripAuditReport {
  return {
    errors: issues.filter((issue) => issue.severity === 'error').length,
    warnings: issues.filter((issue) => issue.severity === 'warning').length,
    issues,
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

function ensureActivityIdList(activityIds: string[]) {
  if (!Array.isArray(activityIds) || activityIds.length === 0) {
    throw new TripCommandValidationError('ACTIVITY_IDS_REQUIRED', 'Provide at least one activity id.', 'activityIds');
  }

  const normalized: string[] = [];
  for (const [index, activityId] of activityIds.entries()) {
    const trimmed = trimRequiredString(activityId, `activityIds[${index}]`, `activityIds[${index}]`);
    if (normalized.includes(trimmed)) {
      throw new TripCommandValidationError(
        'DUPLICATE_ACTIVITY_ID',
        `Duplicate activity id '${trimmed}'.`,
        `activityIds[${index}]`,
      );
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

function comparableLinkUrl(url: string) {
  return normalizeResearchLinkUrl(url).replace(/\/$/, '');
}

function hasResearchLinkUrl(links: ResearchLink[], url: string) {
  const candidateUrl = comparableLinkUrl(url);
  return links.some((link) => comparableLinkUrl(link.url) === candidateUrl);
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

function omitStopLinks(stop: Destination): Destination {
  return {
    ...stop,
    research: {
      ...stop.research,
      links: [],
    },
  };
}

function omitActivityLinks(activity: Activity): Activity {
  return {
    ...activity,
    links: [],
  };
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

function fallbackActivityLocation(
  title: string,
  coordinates: NonNullable<NonNullable<Activity['location']>['coordinates']>,
): NonNullable<Activity['location']> {
  return {
    name: title,
    address: 'TBC',
    coordinates,
    sourceProvider: 'manual',
  };
}

async function resolveActivityLocation(
  draft: Pick<Activity, 'title'> & { place: NonNullable<import('./types').ActivityDraft['place']> },
  dependencies: TripDataServiceDependencies,
  path: string,
) {
  if (dependencies.resolvePlace) {
    const resolved = await dependencies.resolvePlace({
      place: draft.place,
      profile: 'activity',
      fallbackName: draft.title,
    });

    return resolved.activityLocation
      ?? (resolved.coordinates ? fallbackActivityLocation(draft.title, resolved.coordinates) : undefined);
  }

  if (!draft.place.coordinates) {
    throw new TripCommandValidationError(
      'PLACE_RESOLVER_REQUIRED',
      'A place resolver is required when coordinates are omitted.',
      path,
    );
  }

  return fallbackActivityLocation(draft.title, draft.place.coordinates);
}

async function routeWaypointsFromDrafts(
  drafts: NonNullable<ReturnType<typeof validateRouteLegIntentPatch>['waypoints']>,
  dependencies: TripDataServiceDependencies,
): Promise<RouteWaypoint[]> {
  return Promise.all(drafts.map(async (draft, order) => {
    const resolved = dependencies.resolvePlace
      ? await dependencies.resolvePlace({ place: draft.place, profile: 'stop', fallbackName: draft.name })
      : draft.place.coordinates
        ? { coordinates: draft.place.coordinates }
        : (() => { throw new TripCommandValidationError('PLACE_RESOLVER_REQUIRED', 'A place resolver is required when coordinates are omitted.', `patch.waypoints[${order}].place`); })();
    const links = await Promise.all(draft.links.map((url, sortOrder) => (
      dependencies.enrichLink
        ? dependencies.enrichLink(url, sortOrder)
        : Promise.resolve(createFallbackResearchLink(url, { sortOrder }))
    )));
    return {
      id: crypto.randomUUID(),
      order,
      name: draft.name,
      coordinates: resolved.coordinates,
      location: resolved.location ?? {
        placeName: draft.name,
        regionName: '',
        countryName: '',
        sourceLabel: draft.name,
        sourceProvider: 'legacy',
      },
      notes: draft.notes ?? '',
      links,
    };
  }));
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
  routingVehicle?: TripSummary['routingVehicle'];
  calculateRoute?: CalculateRoute;
}) {
  const planned = planRouteLegReconciliation({
    destinations: input.destinations,
    currentRouteLegs: input.currentRouteLegs,
    routingVehicle: input.routingVehicle ?? standardRoutingVehicle,
  });
  const routeLegs: RouteLeg[] = [];
  await reconcileAndSaveRouteLegs({
    destinations: input.destinations,
    currentRouteLegs: planned.routeLegs,
    routingVehicle: input.routingVehicle ?? standardRoutingVehicle,
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
  applyRecipe: (currentDestinations: Destination[]) => Destination[] | Promise<Destination[]>;
  getRoutingVehicle: () => Promise<TripSummary['routingVehicle']>;
  calculateRoute?: CalculateRoute;
}) {
  const [loadedDestinations, loadedRouteLegs] = await Promise.all([
    input.repository.listDestinations(),
    input.repository.listRouteLegs(),
  ]);
  const priorDestinations = structuredClone(loadedDestinations);
  const currentRouteLegs = structuredClone(loadedRouteLegs);
  const nextDestinations = await input.applyRecipe(priorDestinations);
  const routingVehicle = await input.getRoutingVehicle();
  const planned = planRouteLegReconciliation({
    destinations: nextDestinations,
    currentRouteLegs,
    routingVehicle,
  });
  const routeLegs = await calculateAutomaticRouteLegs({
    destinations: nextDestinations,
    routeLegs: planned.routeLegs,
    routingVehicle,
    calculateRoute: input.calculateRoute,
  });
  const nextDestinationIds = new Set(nextDestinations.map(({ id }) => id));
  const nextRouteIds = new Set(routeLegs.map(({ id }) => id));
  const removedDestinationIds = priorDestinations
    .filter(({ id }) => !nextDestinationIds.has(id))
    .map(({ id }) => id);
  const commitDestinationDeletion = input.repository.prepareDestinationDeletion
    ? await input.repository.prepareDestinationDeletion(removedDestinationIds)
    : async () => {
        if (input.repository.deleteDestinations) await input.repository.deleteDestinations(removedDestinationIds);
        else for (const destinationId of removedDestinationIds) await input.repository.deleteDestination(destinationId);
      };

  try {
    for (const destination of nextDestinations) await input.repository.saveDestination(destination);
    for (const routeLeg of currentRouteLegs) {
      if (!nextRouteIds.has(routeLeg.id)) await input.repository.deleteRouteLeg(routeLeg.id);
    }
    for (const routeLeg of routeLegs) await input.repository.saveRouteLeg(routeLeg);
  } catch (caught) {
    const primaryMessage = caught instanceof Error ? caught.message : 'Unknown trip storage error';
    const priorDestinationIds = new Set(priorDestinations.map(({ id }) => id));
    const priorRouteIds = new Set(currentRouteLegs.map(({ id }) => id));
    const rollbackOperations: Array<{ label: string; operation: () => Promise<void> }> = [
      ...nextDestinations.filter(({ id }) => !priorDestinationIds.has(id)).map(({ id }) => ({
        label: `destination ${id} removal`, operation: () => input.repository.deleteDestination(id),
      })),
      ...priorDestinations.map((destination) => ({
        label: `destination ${destination.id} restore`, operation: () => input.repository.saveDestination(destination),
      })),
      ...routeLegs.filter(({ id }) => !priorRouteIds.has(id)).map(({ id }) => ({
        label: `route ${id} removal`, operation: () => input.repository.deleteRouteLeg(id),
      })),
      ...currentRouteLegs.map((routeLeg) => ({
        label: `route ${routeLeg.id} restore`, operation: () => input.repository.saveRouteLeg(routeLeg),
      })),
    ];
    const rollbackFailures: string[] = [];
    for (const { label, operation } of rollbackOperations) {
      try { await operation(); } catch (rollbackError) {
        rollbackFailures.push(`${label}: ${rollbackError instanceof Error ? rollbackError.message : 'Unknown rollback error'}`);
      }
    }
    const rollbackMessage = rollbackFailures.length > 0
      ? `Rollback consistency failures: ${rollbackFailures.join('; ')}`
      : 'Previous destination and route snapshots were restored.';
    throw new Error(`Unable to persist trip snapshot: ${primaryMessage}. ${rollbackMessage}`, { cause: caught });
  }
  await commitDestinationDeletion();

  return {
    destinations: nextDestinations,
    routeLegs,
    routesRecalculated: countRouteLegChanges(currentRouteLegs, routeLegs),
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

async function findActivity(repository: TripRepository, activityId: string) {
  const destinations = await repository.listDestinations();
  for (const destination of destinations) {
    const activities = await repository.listActivities(destination.id);
    const activity = activities.find((candidate) => candidate.id === activityId);
    if (activity) return { destination, activity };
  }
  throw new Error('Activity not found.');
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

    if (error instanceof Error && error.message === 'Activity not found.') {
      return commandError('ACTIVITY_NOT_FOUND', 'Activity not found.');
    }

    return genericErrorResult(error);
  }
}

export function createTripDataService(
  dependencies: TripDataServiceDependencies,
): TripDataService {
  const tripMutationQueues = new Map<string, Promise<void>>();
  const enqueueTripMutation = <T,>(tripId: string, mutation: () => Promise<T>) => {
    const previous = tripMutationQueues.get(tripId) ?? Promise.resolve();
    const queued = previous.then(mutation, mutation);
    const tail = queued.then(() => undefined, () => undefined);
    tripMutationQueues.set(tripId, tail);
    void tail.then(() => {
      if (tripMutationQueues.get(tripId) === tail) tripMutationQueues.delete(tripId);
    });
    return queued;
  };

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
        const stops = normalizeOrderedDestinations(await repository.listDestinations())
          .map((stop) => (input.includeLinks ? stop : omitStopLinks(stop)));
        const routeLegs = await repository.listRouteLegs();
        const activitiesByStopId = input.includeActivities
          ? Object.fromEntries(
            await Promise.all(
              stops.map(async (stop) => {
                const activities = await repository.listActivities(stop.id);
                return [
                  stop.id,
                  input.includeLinks ? activities : activities.map(omitActivityLinks),
                ] as const;
              }),
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

    async auditTrip(input) {
      return withCommandHandling(async () => {
        const tripId = trimRequiredString(input.tripId, 'Trip id', 'tripId');
        const trip = await findTripSummary(dependencies.directory, tripId);
        const repository = dependencies.createTripRepository(trip.id);
        const destinations = normalizeOrderedDestinations(await repository.listDestinations());
        const [routeLegs, activitiesByStop] = await Promise.all([
          repository.listRouteLegs(),
          Promise.all(destinations.map((destination) => repository.listActivities(destination.id))),
        ]);
        const audit = auditTripSnapshot({
          destinations,
          routeLegs,
          activities: activitiesByStop.flat(),
        });

        return commandSuccess(
          `Audited trip ${trip.name}: ${audit.errors} errors, ${audit.warnings} warnings.`,
          { audit },
        );
      });
    },

    async recalculateFailedRoutes(input) {
      return withCommandHandling(async () => {
        const tripId = trimRequiredString(input.tripId, 'Trip id', 'tripId');
        return enqueueTripMutation(tripId, async () => {
        const trip = await findTripSummary(dependencies.directory, tripId);
        const repository = dependencies.createTripRepository(trip.id);
        const [destinations, currentRouteLegs] = await Promise.all([
          repository.listDestinations(),
          repository.listRouteLegs(),
        ]);
        const reconciliation = reconcileRouteLegsForDestinations(
          destinations,
          currentRouteLegs,
          trip.routingVehicle,
        );
        const failedRoutesBefore = currentRouteLegs.filter((routeLeg) => (
          routeLeg.movement === 'drive' && routeLeg.calculation === 'automatic' && routeLeg.status === 'failed'
        )).length;
        const routeLegsToCalculate = reconciliation.routeLegs.filter((routeLeg) => (
          routeLeg.movement === 'drive' &&
          routeLeg.calculation === 'automatic' &&
          (routeLeg.status === 'failed' || routeLeg.status === 'pending')
        ));
        const recalculatedRouteLegs = await calculateAutomaticRouteLegs({
          destinations,
          routeLegs: routeLegsToCalculate,
          routingVehicle: trip.routingVehicle,
          calculateRoute: dependencies.calculateRoute,
          retryFailed: true,
        });
        const recalculatedById = new Map(recalculatedRouteLegs.map((routeLeg) => [routeLeg.id, routeLeg]));
        const changedRouteLegs = recalculatedRouteLegs.filter((routeLeg, index) => (
          routeLeg !== routeLegsToCalculate[index]
        ));
        await Promise.all([
          ...reconciliation.removedRouteLegIds.map((routeLegId) => repository.deleteRouteLeg(routeLegId)),
          ...changedRouteLegs.map((routeLeg) => repository.saveRouteLeg(routeLeg)),
        ]);

        const routeLegs = reconciliation.routeLegs.map((routeLeg) => recalculatedById.get(routeLeg.id) ?? routeLeg);
        const destinationsById = new Map(destinations.map((destination) => [destination.id, destination]));
        const recalculatedRoutes = recalculatedRouteLegs.map((routeLeg) => ({
          routeLegId: routeLeg.id,
          originName: destinationsById.get(routeLeg.originDestinationId)?.name ?? routeLeg.originDestinationId,
          targetName: destinationsById.get(routeLeg.targetDestinationId)?.name ?? routeLeg.targetDestinationId,
          status: routeLeg.status,
        }));
        const failedRoutesAfter = routeLegs.filter((routeLeg) => (
          routeLeg.movement === 'drive' && routeLeg.calculation === 'automatic' && routeLeg.status === 'failed'
        )).length;
        const changed = emptyChanged();
        changed.routesRecalculated = changedRouteLegs.length;

        return commandSuccess(
          `Recalculated ${changedRouteLegs.length} failed route${changedRouteLegs.length === 1 ? '' : 's'} for ${trip.name}; ${failedRoutesAfter} remain failed.`,
          {
            routeLegs,
            failedRoutesBefore,
            failedRoutesAfter,
            recalculatedRoutes,
            changed,
          },
        );
        });
      });
    },

    async setVehicle(input, options) {
      return withCommandHandling(async () => {
        const tripId = trimRequiredString(input.tripId, 'Trip id', 'tripId');
        return enqueueTripMutation(tripId, async () => {
        const preset = validateVehiclePreset(input.preset, 'preset');
        const trip = await findTripSummary(dependencies.directory, tripId);
        const confirmation = ensureConfirmed(
          options,
          'Changing trip vehicle requires --yes or --dry-run.',
        );
        if (confirmation) return confirmation;
        const repository = dependencies.createTripRepository(trip.id);
        const [destinations, currentRouteLegs] = await Promise.all([
          repository.listDestinations(),
          repository.listRouteLegs(),
        ]);
        const routingVehicle = resolveVehiclePreset(preset);
        const invalidatedRouteLegs = recalculateAutomaticRouteLegsForVehicle({
          destinations,
          routeLegs: currentRouteLegs,
          routingVehicle,
        });
        const routeLegs = await calculateAutomaticRouteLegs({
          destinations,
          routeLegs: invalidatedRouteLegs,
          routingVehicle,
          calculateRoute: dependencies.calculateRoute,
          retryFailed: true,
        });
        const changed = emptyChanged();
        changed.routesRecalculated = countRouteLegChanges(currentRouteLegs, routeLegs);
        const nextTrip = { ...trip, routingVehicle };

        if (options?.dryRun) {
          return commandSuccess(`Would set vehicle for ${trip.name} to ${preset}.`, {
            trip: nextTrip,
            routeLegs,
            changed,
          });
        }

        const priorTrip = structuredClone(trip);
        const priorRouteLegs = structuredClone(currentRouteLegs);
        let metadataUpdateAttempted = false;
        try {
          for (const routeLeg of routeLegs) {
            await repository.saveRouteLeg(routeLeg);
          }
          metadataUpdateAttempted = true;
          const persistedTrip = await dependencies.directory.updateTrip(trip.id, { routingVehicle });
          return commandSuccess(`Set vehicle for ${trip.name} to ${preset}.`, {
            trip: persistedTrip,
            routeLegs,
            changed,
          });
        } catch (storageError) {
          const rollbackErrors: string[] = [];
          for (const priorRouteLeg of priorRouteLegs) {
            try {
              await repository.saveRouteLeg(priorRouteLeg);
            } catch (rollbackError) {
              rollbackErrors.push(
                `route leg ${priorRouteLeg.id}: ${rollbackError instanceof Error ? rollbackError.message : 'unknown rollback failure'}`,
              );
            }
          }
          if (metadataUpdateAttempted) {
            try {
              await dependencies.directory.updateTrip(trip.id, {
                name: priorTrip.name,
                description: priorTrip.description,
                routingVehicle: priorTrip.routingVehicle,
              });
            } catch (rollbackError) {
              rollbackErrors.push(
                `trip vehicle: ${rollbackError instanceof Error ? rollbackError.message : 'unknown rollback failure'}`,
              );
            }
          }
          if (rollbackErrors.length > 0) {
            const primaryMessage = storageError instanceof Error ? storageError.message : 'Vehicle storage update failed.';
            throw new Error(
              `${primaryMessage} Rollback failed; trip consistency may require repair. ${rollbackErrors.join('; ')}`,
              { cause: storageError },
            );
          }
          throw storageError;
        }
        });
      });
    },

    async updateRouteLeg(input, options) {
      return withCommandHandling(async () => {
        const tripId = trimRequiredString(input.tripId, 'Trip id', 'tripId');
        const routeLegId = trimRequiredString(input.routeLegId, 'Route leg id', 'routeLegId');
        const patch = validateRouteLegIntentPatch(input.patch);
        return enqueueTripMutation(tripId, async () => {
        const trip = await findTripSummary(dependencies.directory, tripId);
        const repository = dependencies.createTripRepository(trip.id);
        const [destinations, routeLegs] = await Promise.all([
          repository.listDestinations(),
          repository.listRouteLegs(),
        ]);
        const routeLeg = routeLegs.find((candidate) => candidate.id === routeLegId);
        if (!routeLeg) {
          return commandError('ROUTE_LEG_NOT_FOUND', `Route leg '${routeLegId}' was not found.`, 'routeLegId');
        }
        const movement = patch.movement ?? routeLeg.movement;
        const calculation = patch.calculation ?? routeLeg.calculation;
        if (!((movement === 'drive' && calculation === 'automatic') || (movement === 'vehicle-shipping' && calculation === 'manual'))) {
          throw new TripCommandValidationError('UNSUPPORTED_ROUTE_INTENT', 'patch uses an unsupported movement and calculation pair.', 'patch');
        }
        const waypoints = patch.waypoints
          ? await routeWaypointsFromDrafts(patch.waypoints, dependencies)
          : routeLeg.waypoints ?? [];
        const isManualVehicleShipping = movement === 'vehicle-shipping' && calculation === 'manual';
        const origin = destinations.find((destination) => destination.id === routeLeg.originDestinationId);
        const target = destinations.find((destination) => destination.id === routeLeg.targetDestinationId);
        let nextRouteLeg: RouteLeg = {
          ...routeLeg,
          movement,
          calculation,
          ferryPolicy: patch.ferryPolicy ?? routeLeg.ferryPolicy ?? 'allow',
          waypoints,
          notes: patch.notes ?? routeLeg.notes,
          status: isManualVehicleShipping ? 'manual' : 'pending',
          distanceKm: undefined,
          travelTimeHours: undefined,
          geometry: isManualVehicleShipping && origin && target
            ? createStraightLineGeometry(origin.coordinates, target.coordinates)
            : undefined,
          provider: undefined,
          profile: isManualVehicleShipping ? undefined : trip.routingVehicle.profile,
          routeKey: undefined,
          calculatedAt: undefined,
          sections: [],
          warnings: [],
          error: undefined,
          updatedAt: new Date().toISOString(),
        };
        if (!isManualVehicleShipping) {
          [nextRouteLeg] = await calculateAutomaticRouteLegs({
            destinations,
            routeLegs: [nextRouteLeg],
            routingVehicle: trip.routingVehicle,
            calculateRoute: dependencies.calculateRoute,
            retryFailed: true,
          });
        }
        const changed = emptyChanged();
        changed.routesRecalculated = 1;
        if (!options?.dryRun) {
          await repository.saveRouteLeg(nextRouteLeg);
        }
        return commandSuccess(
          `${options?.dryRun ? 'Would update' : 'Updated'} route leg ${routeLegId}.`,
          { routeLeg: nextRouteLeg, changed },
        );
        });
      });
    },

    async createTrip(input, options) {
      return withCommandHandling(async () => {
        if ('manifestVersion' in input) {
          const manifest = validateTripManifest(input);
          const materialized = await materializeTripManifest(manifest, dependencies);
          const audit = auditTripSnapshot({
            destinations: materialized.destinations,
            activities: materialized.activities,
            routeLegs: materialized.routeLegs,
          });
          const blockingIssues = audit.issues.filter((issue) => issue.code === 'ACTIVITY_DISTANCE_OUTLIER');
          if (blockingIssues.length > 0) {
            return commandError(
              'TRIP_AUDIT_FAILED',
              'Trip manifest has semantic audit errors.',
              'manifest',
              { audit: reportFromIssues(blockingIssues) },
            );
          }

          if (options?.dryRun) {
            return commandSuccess(`Would create trip ${manifest.name}.`, {
              trip: {
                id: 'dry-run-trip',
                name: manifest.name,
                description: '',
                routingVehicle: materialized.routingVehicle,
                createdAt: '',
                updatedAt: '',
              },
              stops: materialized.destinations,
              activities: materialized.activities,
              routeLegs: materialized.routeLegs,
              changed: materialized.changed,
              audit,
            });
          }

          const trip = await dependencies.directory.createTrip({
            name: manifest.name,
            routingVehicle: materialized.routingVehicle,
          });
          const repository = dependencies.createTripRepository(trip.id);
          try {
            await repository.replaceTripData({
              destinations: materialized.destinations,
              activities: materialized.activities,
              routeLegs: materialized.routeLegs,
            });
          } catch (persistenceError) {
            try {
              await dependencies.directory.deleteTrip(trip.id);
            } catch {
              // Preserve the bulk persistence error that caused the cleanup.
            }
            throw persistenceError;
          }

          return commandSuccess(`Created trip ${trip.name}.`, {
            trip,
            stops: materialized.destinations,
            activities: materialized.activities,
            routeLegs: materialized.routeLegs,
            changed: materialized.changed,
            audit,
          });
        }

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
              routingVehicle: standardRoutingVehicle,
              createdAt: '',
              updatedAt: '',
            },
            stops,
            activities: [],
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
          activities: [],
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
        const trip = await findTripSummary(dependencies.directory, tripId);
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
            routingVehicle: trip.routingVehicle,
            calculateRoute: dependencies.calculateRoute,
          });
          changed.routesRecalculated = countRouteLegChanges(currentRouteLegs, nextRouteLegs);
          return commandSuccess(`Would replace ${currentStops.length} stop${currentStops.length === 1 ? '' : 's'}.`, {
            stops: nextStops,
            routeLegs: nextRouteLegs,
            changed,
          });
        }

        const saved = await enqueueTripMutation(tripId, () => saveStopsAndRouteLegs({
          repository,
          applyRecipe: () => nextStops,
          getRoutingVehicle: async () => (await findTripSummary(dependencies.directory, tripId)).routingVehicle,
          calculateRoute: dependencies.calculateRoute,
        }));

        changed.routesRecalculated = saved.routesRecalculated;
        return commandSuccess(`Replaced stops for trip ${tripId}.`, {
          stops: saved.destinations,
          routeLegs: saved.routeLegs,
          changed,
        });
      });
    },

    async insertStop(input, options) {
      return withCommandHandling(async () => {
        const tripId = trimRequiredString(input.tripId, 'Trip id', 'tripId');
        const trip = await findTripSummary(dependencies.directory, tripId);
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
            routingVehicle: trip.routingVehicle,
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

        const saved = await enqueueTripMutation(tripId, () => saveStopsAndRouteLegs({
          repository,
          applyRecipe: (freshStops) => {
            let freshInsertionIndex = freshStops.length;
            if (input.afterStopId) {
              const index = freshStops.findIndex(({ id }) => id === input.afterStopId);
              if (index === -1) throw new Error('Stop not found.');
              freshInsertionIndex = index + 1;
            } else if (input.beforeStopId) {
              const index = freshStops.findIndex(({ id }) => id === input.beforeStopId);
              if (index === -1) throw new Error('Stop not found.');
              freshInsertionIndex = index;
            }
            return normalizeOrderedDestinations([
              ...freshStops.slice(0, freshInsertionIndex), insertedStop, ...freshStops.slice(freshInsertionIndex),
            ]);
          },
          getRoutingVehicle: async () => (await findTripSummary(dependencies.directory, tripId)).routingVehicle,
          calculateRoute: dependencies.calculateRoute,
        }));
        changed.routesRecalculated = saved.routesRecalculated;

        return commandSuccess(`Inserted ${insertedStop.name}.`, {
          stop: insertedStop,
          stops: saved.destinations,
          routeLegs: saved.routeLegs,
          changed,
        });
      });
    },

    async updateStop(input, options) {
      return withCommandHandling(async () => {
        const tripId = trimRequiredString(input.tripId, 'Trip id', 'tripId');
        const trip = await findTripSummary(dependencies.directory, tripId);
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
            routingVehicle: trip.routingVehicle,
            calculateRoute: dependencies.calculateRoute,
          });
          changed.routesRecalculated = countRouteLegChanges(currentRouteLegs, nextRouteLegs);
          return commandSuccess(`Would update ${updatedStop.name}.`, {
            stop: updatedStop,
            routeLegs: nextRouteLegs,
            changed,
          });
        }

        const saved = await enqueueTripMutation(tripId, () => saveStopsAndRouteLegs({
          repository,
          applyRecipe: async (freshStops) => {
            const freshStop = freshStops.find(({ id }) => id === stopId);
            if (!freshStop) throw new Error('Stop not found.');
            const freshUpdatedStop = await updateDestinationFromPatch(freshStop, patch, dependencies);
            return freshStops.map((candidate) => candidate.id === stopId ? freshUpdatedStop : candidate);
          },
          getRoutingVehicle: async () => (await findTripSummary(dependencies.directory, tripId)).routingVehicle,
          calculateRoute: dependencies.calculateRoute,
        }));
        changed.routesRecalculated = saved.routesRecalculated;

        const savedStop = saved.destinations.find(({ id }) => id === stopId)!;
        return commandSuccess(`Updated ${savedStop.name}.`, {
          stop: savedStop,
          routeLegs: saved.routeLegs,
          changed,
        });
      });
    },

    async deleteStop(input, options) {
      return withCommandHandling(async () => {
        const tripId = trimRequiredString(input.tripId, 'Trip id', 'tripId');
        const trip = await findTripSummary(dependencies.directory, tripId);
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
            routingVehicle: trip.routingVehicle,
            calculateRoute: dependencies.calculateRoute,
          });
          changed.routesRecalculated = countRouteLegChanges(currentRouteLegs, nextRouteLegs);
          return commandSuccess(`Would delete ${stop.name}.`, { changed });
        }

        const saved = await enqueueTripMutation(tripId, () => saveStopsAndRouteLegs({
          repository,
          applyRecipe: (freshStops) => normalizeOrderedDestinations(
            freshStops.filter((candidate) => candidate.id !== stopId),
          ),
          getRoutingVehicle: async () => (await findTripSummary(dependencies.directory, tripId)).routingVehicle,
          calculateRoute: dependencies.calculateRoute,
        }));
        changed.routesRecalculated = saved.routesRecalculated;

        return commandSuccess(`Deleted ${stop.name}.`, { changed });
      });
    },

    async reorderStops(input, options) {
      return withCommandHandling(async () => {
        const tripId = trimRequiredString(input.tripId, 'Trip id', 'tripId');
        const trip = await findTripSummary(dependencies.directory, tripId);
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
            routingVehicle: trip.routingVehicle,
            calculateRoute: dependencies.calculateRoute,
          });
          changed.routesRecalculated = countRouteLegChanges(currentRouteLegs, nextRouteLegs);
          return commandSuccess('Would reorder stops.', {
            stops: nextStops,
            routeLegs: nextRouteLegs,
            changed,
          });
        }

        const saved = await enqueueTripMutation(tripId, () => saveStopsAndRouteLegs({
          repository,
          applyRecipe: (freshStops) => {
            const freshById = new Map(freshStops.map((stop) => [stop.id, stop]));
            const freshRequestedIds = new Set(orderedIds);
            return normalizeOrderedDestinations([
              ...orderedIds.map((id) => freshById.get(id)).filter((stop): stop is Destination => Boolean(stop)),
              ...freshStops.filter((stop) => !freshRequestedIds.has(stop.id)),
            ]);
          },
          getRoutingVehicle: async () => (await findTripSummary(dependencies.directory, tripId)).routingVehicle,
          calculateRoute: dependencies.calculateRoute,
        }));
        changed.routesRecalculated = saved.routesRecalculated;

        return commandSuccess('Reordered stops.', {
          stops: saved.destinations,
          routeLegs: saved.routeLegs,
          changed,
        });
      });
    },

    async listActivities(input) {
      return withCommandHandling(async () => {
        const tripId = trimRequiredString(input.tripId, 'Trip id', 'tripId');
        await findTripSummary(dependencies.directory, tripId);
        const stopId = trimRequiredString(input.stopId, 'Stop id', 'stopId');
        const repository = dependencies.createTripRepository(tripId);
        const stop = (await repository.listDestinations()).find((candidate) => candidate.id === stopId);
        if (!stop) return notFoundResult('stop', stopId);

        const activities = await repository.listActivities(stopId);
        return commandSuccess(
          `Loaded ${activities.length} activit${activities.length === 1 ? 'y' : 'ies'} for ${stop.name}.`,
          { activities },
        );
      });
    },

    async createActivity(input, options) {
      return withCommandHandling(async () => {
        const tripId = trimRequiredString(input.tripId, 'Trip id', 'tripId');
        await findTripSummary(dependencies.directory, tripId);
        const stopId = trimRequiredString(input.stopId, 'Stop id', 'stopId');
        const repository = dependencies.createTripRepository(tripId);
        const stop = (await repository.listDestinations()).find((candidate) => candidate.id === stopId);
        if (!stop) return notFoundResult('stop', stopId);

        const draft = validateActivityDraft(input.activity, 'activity');
        const location = draft.place
          ? await resolveActivityLocation({ title: draft.title, place: draft.place }, dependencies, 'activity.place')
          : undefined;
        const changed = emptyChanged();
        changed.activitiesAdded.push(draft.title);

        if (options?.dryRun) {
          return commandSuccess(`Would create activity ${draft.title}.`, {
            activity: createDomainActivity({
              destinationId: stopId,
              title: draft.title,
              order: (await repository.listActivities(stopId)).length,
              ...(location ? { location } : {}),
            }),
            changed,
          });
        }

        const activity = await repository.createActivity({
          destinationId: stopId,
          title: draft.title,
          ...(location ? { location } : {}),
        });

        return commandSuccess(`Created activity ${activity.title}.`, {
          activity,
          changed,
        });
      });
    },

    async updateActivity(input, options) {
      return withCommandHandling(async () => {
        const tripId = trimRequiredString(input.tripId, 'Trip id', 'tripId');
        await findTripSummary(dependencies.directory, tripId);
        const activityId = trimRequiredString(input.activityId, 'Activity id', 'activityId');
        const repository = dependencies.createTripRepository(tripId);
        const { activity } = await findActivity(repository, activityId);
        const patch = validateActivityPatch(input.patch, 'patch');

        const updatePatch: Partial<Omit<Activity, 'id' | 'destinationId' | 'createdAt' | 'updatedAt'>> = {};
        if (patch.title !== undefined) updatePatch.title = patch.title;
        if (patch.description !== undefined) updatePatch.description = patch.description;
        if (patch.notes !== undefined) updatePatch.notes = patch.notes;
        if (patch.tags !== undefined) updatePatch.tags = patch.tags;
        if (patch.place !== undefined) {
          updatePatch.location = await resolveActivityLocation(
            {
              title: patch.title ?? activity.title,
              place: patch.place,
            },
            dependencies,
            'patch.place',
          );
        }

        const changed = emptyChanged();
        changed.activitiesUpdated.push(patch.title ?? activity.title);

        if (options?.dryRun) {
          return commandSuccess(`Would update activity ${activity.title}.`, {
            activity: updateDomainActivity(activity, updatePatch),
            changed,
          });
        }

        const updatedActivity = await repository.updateActivity(activityId, updatePatch);
        return commandSuccess(`Updated activity ${updatedActivity.title}.`, {
          activity: updatedActivity,
          changed,
        });
      });
    },

    async deleteActivity(input, options) {
      return withCommandHandling(async () => {
        const tripId = trimRequiredString(input.tripId, 'Trip id', 'tripId');
        await findTripSummary(dependencies.directory, tripId);
        const activityId = trimRequiredString(input.activityId, 'Activity id', 'activityId');
        const repository = dependencies.createTripRepository(tripId);
        const { activity } = await findActivity(repository, activityId);
        const confirmation = ensureConfirmed(
          options,
          `Deleting activity ${activity.title} requires --yes or --dry-run.`,
        );
        if (confirmation) return confirmation;

        const changed = emptyChanged();
        changed.activitiesDeleted.push(activity.title);

        if (options?.dryRun) {
          return commandSuccess(`Would delete activity ${activity.title}.`, { changed });
        }

        await repository.deleteActivity(activityId);
        return commandSuccess(`Deleted activity ${activity.title}.`, { changed });
      });
    },

    async reorderActivities(input, options) {
      return withCommandHandling(async () => {
        const tripId = trimRequiredString(input.tripId, 'Trip id', 'tripId');
        await findTripSummary(dependencies.directory, tripId);
        const stopId = trimRequiredString(input.stopId, 'Stop id', 'stopId');
        const repository = dependencies.createTripRepository(tripId);
        const stop = (await repository.listDestinations()).find((candidate) => candidate.id === stopId);
        if (!stop) return notFoundResult('stop', stopId);
        const activities = await repository.listActivities(stopId);
        const activitiesById = new Map(activities.map((activity) => [activity.id, activity]));
        const normalizedActivityIds = ensureActivityIdList(input.activityIds);

        for (const [index, activityId] of normalizedActivityIds.entries()) {
          if (!activitiesById.has(activityId)) {
            return commandError('ACTIVITY_NOT_FOUND', `Activity '${activityId}' was not found.`, `activityIds[${index}]`);
          }
        }

        const changed = emptyChanged();

        if (options?.dryRun) {
          const reordered = reorderActivityModels(activities, normalizedActivityIds);
          changed.activitiesUpdated.push(...reordered.map((activity) => activity.title));
          return commandSuccess(`Would reorder activities for ${stop.name}.`, {
            activities: reordered,
            changed,
          });
        }

        const reordered = await repository.reorderActivities(stopId, normalizedActivityIds);
        changed.activitiesUpdated.push(...reordered.map((activity) => activity.title));
        return commandSuccess(`Reordered activities for ${stop.name}.`, {
          activities: reordered,
          changed,
        });
      });
    },

    async addStopLink(input, options) {
      return withCommandHandling(async () => {
        const tripId = trimRequiredString(input.tripId, 'Trip id', 'tripId');
        await findTripSummary(dependencies.directory, tripId);
        const stopId = trimRequiredString(input.stopId, 'Stop id', 'stopId');
        const url = validateUrlInput(input.url, 'url');
        const repository = dependencies.createTripRepository(tripId);
        const stop = normalizeDestinationLinks(
          (await repository.listDestinations()).find((candidate) => candidate.id === stopId)
          ?? (() => {
            throw new Error('Stop not found.');
          })(),
        );
        const changed = emptyChanged();
        if (hasResearchLinkUrl(stop.research.links, url)) {
          return commandSuccess(`Link already exists on ${stop.name}.`, { changed });
        }

        const nextLink = await (dependencies.enrichLink ?? (async (linkUrl, sortOrder) => createFallbackResearchLink(linkUrl, { sortOrder })))(
          url,
          stop.research.links.length,
        );
        if (hasResearchLinkUrl(stop.research.links, nextLink.url)) {
          return commandSuccess(`Link already exists on ${stop.name}.`, { changed });
        }

        const nextStop = normalizeDestinationLinks(
          updateDestination(stop, {
            research: {
              ...stop.research,
              links: [...stop.research.links, nextLink],
            },
          }),
        );
        changed.linksAdded.push(nextLink.url);

        if (options?.dryRun) {
          return commandSuccess(`Would add link to ${stop.name}.`, { changed });
        }

        await repository.saveDestination(nextStop);
        return commandSuccess(`Added link to ${stop.name}.`, { changed });
      });
    },

    async deleteStopLink(input, options) {
      return withCommandHandling(async () => {
        const tripId = trimRequiredString(input.tripId, 'Trip id', 'tripId');
        await findTripSummary(dependencies.directory, tripId);
        const stopId = trimRequiredString(input.stopId, 'Stop id', 'stopId');
        const linkId = trimRequiredString(input.linkId, 'Link id', 'linkId');
        const repository = dependencies.createTripRepository(tripId);
        const stop = normalizeDestinationLinks(
          (await repository.listDestinations()).find((candidate) => candidate.id === stopId)
          ?? (() => {
            throw new Error('Stop not found.');
          })(),
        );
        const removedLink = stop.research.links.find((link) => link.id === linkId);
        if (!removedLink) {
          return commandError('LINK_NOT_FOUND', `Link '${linkId}' was not found.`, 'linkId');
        }

        const nextLinks = reorderResearchLinks(
          stop.research.links.filter((link) => link.id !== linkId),
          stop.research.links.filter((link) => link.id !== linkId).map((link) => link.id),
        );
        const nextStop = normalizeDestinationLinks(
          updateDestination(stop, {
            research: {
              ...stop.research,
              links: nextLinks,
            },
          }),
        );
        const changed = emptyChanged();
        changed.linksDeleted.push(removedLink.url);

        if (options?.dryRun) {
          return commandSuccess(`Would delete link from ${stop.name}.`, { changed });
        }

        await repository.saveDestination(nextStop);
        return commandSuccess(`Deleted link from ${stop.name}.`, { changed });
      });
    },

    async addActivityLink(input, options) {
      return withCommandHandling(async () => {
        const tripId = trimRequiredString(input.tripId, 'Trip id', 'tripId');
        await findTripSummary(dependencies.directory, tripId);
        const activityId = trimRequiredString(input.activityId, 'Activity id', 'activityId');
        const url = validateUrlInput(input.url, 'url');
        const repository = dependencies.createTripRepository(tripId);
        const { activity } = await findActivity(repository, activityId);
        const changed = emptyChanged();
        if (hasResearchLinkUrl(activity.links, url)) {
          return commandSuccess(`Link already exists on activity ${activity.title}.`, { changed });
        }

        const nextLink = await (dependencies.enrichLink ?? (async (linkUrl, sortOrder) => createFallbackResearchLink(linkUrl, { sortOrder })))(
          url,
          activity.links.length,
        );
        if (hasResearchLinkUrl(activity.links, nextLink.url)) {
          return commandSuccess(`Link already exists on activity ${activity.title}.`, { changed });
        }

        const nextLinks = sortResearchLinks([...activity.links, nextLink]);
        changed.linksAdded.push(nextLink.url);

        if (options?.dryRun) {
          return commandSuccess(`Would add link to activity ${activity.title}.`, {
            changed,
          });
        }

        await repository.updateActivity(activityId, { links: nextLinks });
        return commandSuccess(`Added link to activity ${activity.title}.`, { changed });
      });
    },

    async deleteActivityLink(input, options) {
      return withCommandHandling(async () => {
        const tripId = trimRequiredString(input.tripId, 'Trip id', 'tripId');
        await findTripSummary(dependencies.directory, tripId);
        const activityId = trimRequiredString(input.activityId, 'Activity id', 'activityId');
        const linkId = trimRequiredString(input.linkId, 'Link id', 'linkId');
        const repository = dependencies.createTripRepository(tripId);
        const { activity } = await findActivity(repository, activityId);
        const removedLink = activity.links.find((link) => link.id === linkId);
        if (!removedLink) {
          return commandError('LINK_NOT_FOUND', `Link '${linkId}' was not found.`, 'linkId');
        }

        const remainingLinks = activity.links.filter((link) => link.id !== linkId);
        const nextLinks = reorderResearchLinks(remainingLinks, remainingLinks.map((link) => link.id));
        const changed = emptyChanged();
        changed.linksDeleted.push(removedLink.url);

        if (options?.dryRun) {
          return commandSuccess(`Would delete link from activity ${activity.title}.`, { changed });
        }

        await repository.updateActivity(activityId, { links: nextLinks });
        return commandSuccess(`Deleted link from activity ${activity.title}.`, { changed });
      });
    },
  };
}

export { emptyChanged };
