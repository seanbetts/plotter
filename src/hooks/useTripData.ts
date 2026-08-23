import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PlotterApiError } from '../api/client';
import { createActivity as createActivityModel } from '../domain/activities';
import { createDestination, updateDestination as patchDestination, withRoutingAnchor } from '../domain/destinations';
import {
  findBestDestinationInsertionIndex,
  planRouteLegReconciliation,
  reconcileReadyAutomaticRouteLegForCurrentIntent,
} from '../domain/routePlanner';
import { createRouteLeg } from '../domain/routeLegs';
import type { Activity, Coordinates, Destination, DestinationLocation, RouteCalculationMode, RouteLeg, RouteMovement, RoutingAnchor, TripRoutingVehicle } from '../domain/types';
import { standardRoutingVehicle } from '../domain/vehiclePresets';
import type { TripMutationDelta, TripRepository } from '../storage/tripRepository';
import { TripStorageConflictError, type TripSnapshot } from '../storage/revision';
import {
  calculateAutomaticRouteLegs,
  createRouteResultFingerprint,
  finalizeRouteLeg,
  hasFinalizedAutomaticRouteResult,
  hasPreservableDrivingRouteData,
  recalculateAutomaticRouteLegsForVehicle,
  type CalculateRoute,
  type RouteLegPatch,
} from '../tripCommands/routeOrchestration';

type AddDestinationInput = {
  name: string;
  countryRegion?: string;
  location?: DestinationLocation;
  coordinates: Coordinates;
};

type UseTripDataOptions = {
  calculateRoute?: CalculateRoute;
  routingVehicle?: TripRoutingVehicle;
};

type ApplyValidatedRouteLegResultInput = {
  routeLegId: string;
  expectedFingerprint: string;
  validatedRouteLeg: RouteLeg;
  destinationAnchorUpdates?: Array<{
    destinationId: string;
    anchor: RoutingAnchor;
  }>;
};

type DestinationRecipe = (currentDestinations: Destination[]) => Destination[];

type PendingTopologyMutation = {
  id: number;
  destinationIds: string[];
  applyRecipe: DestinationRecipe;
  fallbackDestinations: Destination[];
  fallbackRouteLegs: RouteLeg[];
  rollbackActivities: () => void;
};

class TripMutationPersistenceError extends Error {
  constructor(
    message: string,
    readonly priorDestinations: Destination[],
    readonly priorRouteLegs: RouteLeg[],
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

const createTimestamp = () => new Date().toISOString();
const allRouteMutationsQueueKey = '__all_route_mutations__';
const tripConflictMessage = 'Another device changed this trip. Plotter reloaded the latest version.';

function isTripStorageConflict(caught: unknown): boolean {
  if (caught instanceof TripStorageConflictError) return true;
  return caught instanceof Error && isTripStorageConflict(caught.cause);
}

function changedDestinationsByReference(currentDestinations: Destination[], nextDestinations: Destination[]) {
  const currentById = new Map(currentDestinations.map((destination) => [destination.id, destination]));
  return nextDestinations.filter((destination) => currentById.get(destination.id) !== destination);
}

function createTripMutationDelta(input: {
  priorDestinations: Destination[];
  nextDestinations: Destination[];
  priorRouteLegs: RouteLeg[];
  nextRouteLegs: RouteLeg[];
}): TripMutationDelta {
  const priorDestinationById = new Map(input.priorDestinations.map((destination) => [destination.id, destination]));
  const nextDestinationIds = new Set(input.nextDestinations.map(({ id }) => id));
  const priorRouteLegById = new Map(input.priorRouteLegs.map((routeLeg) => [routeLeg.id, routeLeg]));
  const nextRouteLegIds = new Set(input.nextRouteLegs.map(({ id }) => id));

  return {
    destinationsToUpsert: input.nextDestinations.filter(
      (destination) => priorDestinationById.get(destination.id) !== destination,
    ),
    destinationIdsToDelete: input.priorDestinations
      .filter(({ id }) => !nextDestinationIds.has(id))
      .map(({ id }) => id),
    routeLegsToUpsert: input.nextRouteLegs.filter(
      (routeLeg) => priorRouteLegById.get(routeLeg.id) !== routeLeg,
    ),
    routeLegIdsToDelete: input.priorRouteLegs
      .filter(({ id }) => !nextRouteLegIds.has(id))
      .map(({ id }) => id),
  };
}

function projectTopologyMutations(input: {
  destinations: Destination[];
  routeLegs: RouteLeg[];
  pendingMutations: PendingTopologyMutation[];
  routingVehicle: TripRoutingVehicle;
}) {
  let destinations = input.destinations;
  let routeLegs = input.routeLegs;
  for (const mutation of input.pendingMutations) {
    destinations = mutation.applyRecipe(destinations);
    routeLegs = planRouteLegReconciliation({
      destinations,
      currentRouteLegs: routeLegs,
      routingVehicle: input.routingVehicle,
    }).routeLegs;
  }
  return { destinations, routeLegs };
}

function entityRevisionsMatch<T extends { id: string; updatedAt: string }>(
  expected: T[],
  current: T[],
) {
  if (expected.length !== current.length) return false;
  const currentRevisionById = new Map(current.map((entity) => [entity.id, entity.updatedAt]));
  return expected.every((entity) => currentRevisionById.get(entity.id) === entity.updatedAt);
}

async function persistRouteCalculationBatch(input: {
  repository: TripRepository;
  priorDestinations: Destination[];
  priorRouteLegs: RouteLeg[];
  destinationsToSave: Destination[];
  routeLegsToSave: RouteLeg[];
  failurePrefix: string;
}) {
  try {
    for (const destination of input.destinationsToSave) {
      await input.repository.saveDestination(destination);
    }
    for (const routeLeg of input.routeLegsToSave) {
      await input.repository.saveRouteLeg(routeLeg);
    }
  } catch (caught) {
    const primaryMessage = caught instanceof Error ? caught.message : 'Unknown trip storage error';
    const priorRouteIds = new Set(input.priorRouteLegs.map((routeLeg) => routeLeg.id));
    const rollbackFailures: string[] = [];
    for (const routeLeg of input.routeLegsToSave) {
      if (priorRouteIds.has(routeLeg.id)) continue;
      try {
        await input.repository.deleteRouteLeg(routeLeg.id);
      } catch (rollbackError) {
        rollbackFailures.push(
          `route ${routeLeg.id} removal: ${rollbackError instanceof Error ? rollbackError.message : 'Unknown rollback error'}`,
        );
      }
    }
    for (const destination of input.priorDestinations) {
      try {
        await input.repository.saveDestination(destination);
      } catch (rollbackError) {
        rollbackFailures.push(
          `destination ${destination.id}: ${rollbackError instanceof Error ? rollbackError.message : 'Unknown rollback error'}`,
        );
      }
    }
    for (const routeLeg of input.priorRouteLegs) {
      try {
        await input.repository.saveRouteLeg(routeLeg);
      } catch (rollbackError) {
        rollbackFailures.push(
          `route ${routeLeg.id}: ${rollbackError instanceof Error ? rollbackError.message : 'Unknown rollback error'}`,
        );
      }
    }
    const rollbackMessage = rollbackFailures.length > 0
      ? `Rollback consistency failures: ${rollbackFailures.join('; ')}`
      : 'Previous destination and route snapshots were restored.';
    throw new Error(`${input.failurePrefix}: ${primaryMessage}. ${rollbackMessage}`, { cause: caught });
  }
}

async function reconcileLoadedRoutesForVehicle(input: {
  repository: TripRepository;
  destinations: Destination[];
  routeLegs: RouteLeg[];
  routingVehicle: TripRoutingVehicle;
  calculateRoute?: CalculateRoute;
  isCurrentReload: () => boolean;
}) {
  const destinationsById = new Map(
    input.destinations.map((destination) => [destination.id, destination]),
  );
  const invalidatedRouteLegs = input.routeLegs.map((routeLeg) => {
    const origin = destinationsById.get(routeLeg.originDestinationId);
    const target = destinationsById.get(routeLeg.targetDestinationId);
    if (!origin || !target) return routeLeg;
    return reconcileReadyAutomaticRouteLegForCurrentIntent(
      routeLeg,
      origin,
      target,
      input.routingVehicle,
    );
  });
  const staleRouteLegIndexes = new Set(
    invalidatedRouteLegs.flatMap((routeLeg, index) =>
      routeLeg !== input.routeLegs[index] ? [index] : []),
  );
  if (staleRouteLegIndexes.size === 0) {
    return { destinations: input.destinations, routeLegs: input.routeLegs };
  }

  const calculation = await calculateAutomaticRouteLegs({
    destinations: input.destinations,
    routeLegs: invalidatedRouteLegs,
    routingVehicle: input.routingVehicle,
    calculateRoute: input.calculateRoute,
  });

  if (!input.isCurrentReload()) return null;

  const nonDestructiveRouteLegs = calculation.routeLegs.map((routeLeg, index) => {
    const priorRouteLeg = input.routeLegs[index];
    if (
      staleRouteLegIndexes.has(index) &&
      priorRouteLeg?.status === 'ready' &&
      routeLeg.status !== 'ready' &&
      routeLeg.status !== 'review-required'
    ) {
      return priorRouteLeg;
    }
    return routeLeg;
  });

  const destinationsToSave = changedDestinationsByReference(input.destinations, calculation.destinations);
  const routeLegsToSave = nonDestructiveRouteLegs.filter(
    (routeLeg, index) => routeLeg !== input.routeLegs[index],
  );
  await persistRouteCalculationBatch({
    repository: input.repository,
    priorDestinations: structuredClone(input.destinations),
    priorRouteLegs: structuredClone(input.routeLegs),
    destinationsToSave,
    routeLegsToSave,
    failurePrefix: 'Unable to save reconciled routes',
  });

  if (!input.isCurrentReload()) return null;
  return { ...calculation, routeLegs: nonDestructiveRouteLegs };
}

export function useTripData(repository: TripRepository, options: UseTripDataOptions = {}) {
  const [repositoryGeneration, setRepositoryGeneration] = useState(0);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [routeLegs, setRouteLegs] = useState<RouteLeg[]>([]);
  const [activitiesByDestinationId, setActivitiesByDestinationId] = useState<Record<string, Activity[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [pendingTopologyMutationCount, setPendingTopologyMutationCount] = useState(0);
  const [revision, setRevision] = useState<number | null>(null);
  const destinationsRef = useRef<Destination[]>([]);
  const routeLegsRef = useRef<RouteLeg[]>([]);
  const activitiesByDestinationIdRef = useRef<Record<string, Activity[]>>({});
  const isMountedRef = useRef(false);
  const activeRepositoryTokenRef = useRef<object | null>(null);
  const reloadSequenceRef = useRef(0);
  const pendingTopologyMutationsRef = useRef<PendingTopologyMutation[]>([]);
  const nextTopologyMutationIdRef = useRef(0);
  const deferredReloadRef = useRef(false);
  const hasCompletedInitialLoadRef = useRef(false);
  const preserveConflictMessageRef = useRef(false);
  const routeLegMutationQueuesByGenerationRef = useRef(
    new Map<object, Map<string, Promise<void>>>(),
  );
  const calculateRoute = options.calculateRoute;
  const calculateRouteRef = useRef(calculateRoute);
  const routingVehicle = options.routingVehicle ?? standardRoutingVehicle;
  const routingVehicleRef = useRef(routingVehicle);
  const repositoryToken = useMemo(
    () => ({ repository, repositoryGeneration }),
    [repository, repositoryGeneration],
  );

  useLayoutEffect(() => {
    calculateRouteRef.current = calculateRoute;
  }, [calculateRoute]);

  useLayoutEffect(() => {
    routingVehicleRef.current = routingVehicle;
  }, [routingVehicle]);

  const replaceDestinations = useCallback((nextDestinations: Destination[]) => {
    destinationsRef.current = nextDestinations;
    setDestinations(nextDestinations);
  }, []);

  const replaceRouteLegs = useCallback((nextRouteLegs: RouteLeg[]) => {
    routeLegsRef.current = nextRouteLegs;
    setRouteLegs(nextRouteLegs);
  }, []);

  const updateRouteLegs = useCallback((updater: (current: RouteLeg[]) => RouteLeg[]) => {
    const nextRouteLegs = updater(routeLegsRef.current);
    routeLegsRef.current = nextRouteLegs;
    setRouteLegs(nextRouteLegs);
    return nextRouteLegs;
  }, []);

  const replaceActivitiesByDestinationId = useCallback((nextActivities: Record<string, Activity[]>) => {
    activitiesByDestinationIdRef.current = nextActivities;
    setActivitiesByDestinationId(nextActivities);
  }, []);

  const updateActivitiesByDestinationId = useCallback(
    (updater: (current: Record<string, Activity[]>) => Record<string, Activity[]>) => {
      const nextActivities = updater(activitiesByDestinationIdRef.current);
      activitiesByDestinationIdRef.current = nextActivities;
      setActivitiesByDestinationId(nextActivities);
      return nextActivities;
    },
    [],
  );

  const enqueueRouteLegMutations = useCallback(<T,>(
    routeLegIds: string[],
    mutation: () => Promise<T>,
  ) => {
    const generation = repositoryToken;
    let generationQueues = routeLegMutationQueuesByGenerationRef.current.get(generation);
    if (!generationQueues) {
      generationQueues = new Map<string, Promise<void>>();
      routeLegMutationQueuesByGenerationRef.current.set(generation, generationQueues);
    }
    const uniqueRouteLegIds = [...new Set([allRouteMutationsQueueKey, ...routeLegIds])].sort();
    const previousMutations = uniqueRouteLegIds.map(
      (routeLegId) => generationQueues.get(routeLegId) ?? Promise.resolve(),
    );
    const waitForPrevious = Promise.all(previousMutations).then(() => undefined, () => undefined);
    const queuedMutation = waitForPrevious.then(mutation, mutation);
    const queueTail = queuedMutation.then(() => undefined, () => undefined);
    for (const routeLegId of uniqueRouteLegIds) {
      generationQueues.set(routeLegId, queueTail);
    }
    void queueTail.then(() => {
      if (routeLegMutationQueuesByGenerationRef.current.get(generation) !== generationQueues) return;
      for (const routeLegId of uniqueRouteLegIds) {
        if (generationQueues.get(routeLegId) === queueTail) {
          generationQueues.delete(routeLegId);
        }
      }
      if (generationQueues.size === 0) {
        routeLegMutationQueuesByGenerationRef.current.delete(generation);
      }
    });
    return queuedMutation;
  }, [repositoryToken]);

  const enqueueRouteLegMutation = useCallback(<T,>(routeLegId: string, mutation: () => Promise<T>) =>
    enqueueRouteLegMutations([routeLegId], mutation), [enqueueRouteLegMutations]);

  useLayoutEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      reloadSequenceRef.current += 1;
    };
  }, []);

  useLayoutEffect(() => {
    let isCancelled = false;

    activeRepositoryTokenRef.current = repositoryToken;
    reloadSequenceRef.current += 1;
    pendingTopologyMutationsRef.current = [];
    deferredReloadRef.current = false;
    hasCompletedInitialLoadRef.current = false;

    const preserveConflictMessage = preserveConflictMessageRef.current;
    preserveConflictMessageRef.current = false;
    queueMicrotask(() => {
      if (isCancelled || activeRepositoryTokenRef.current !== repositoryToken) return;

      setPendingTopologyMutationCount(0);
      setIsLoading(true);
      if (!preserveConflictMessage) setMutationError(null);
    });

    return () => {
      isCancelled = true;
      if (activeRepositoryTokenRef.current === repositoryToken) {
        activeRepositoryTokenRef.current = null;
        reloadSequenceRef.current += 1;
      }
    };
  }, [repositoryToken]);

  const isActiveGeneration = useCallback(
    (generation: object) =>
      isMountedRef.current && activeRepositoryTokenRef.current === generation,
    [],
  );

  const resetAfterConflict = useCallback((caught: unknown, generation: object) => {
    if (!isTripStorageConflict(caught) || !isActiveGeneration(generation)) return false;
    activeRepositoryTokenRef.current = null;
    reloadSequenceRef.current += 1;
    pendingTopologyMutationsRef.current = [];
    routeLegMutationQueuesByGenerationRef.current.delete(generation);
    deferredReloadRef.current = false;
    hasCompletedInitialLoadRef.current = false;
    destinationsRef.current = [];
    routeLegsRef.current = [];
    activitiesByDestinationIdRef.current = {};
    setDestinations([]);
    setRouteLegs([]);
    setActivitiesByDestinationId({});
    setPendingTopologyMutationCount(0);
    setRevision(null);
    preserveConflictMessageRef.current = true;
    setMutationError(tripConflictMessage);
    setRepositoryGeneration((current) => current + 1);
    return true;
  }, [isActiveGeneration]);

  const startReload = useCallback(async (generation: object) => {
    if (!isActiveGeneration(generation)) return;

    const sequence = reloadSequenceRef.current + 1;
    reloadSequenceRef.current = sequence;
    const isCurrentReload = () =>
      isActiveGeneration(generation) && reloadSequenceRef.current === sequence;

    const isInitialLoad = !hasCompletedInitialLoadRef.current;
    let appliedRevision: number | null | undefined;
    if (isInitialLoad) setIsLoading(true);
    setError(null);
    try {
      const initialSnapshot: TripSnapshot | null = repository.loadSnapshot
        ? await repository.loadSnapshot()
        : null;
      const [initialDestinations, initialRouteLegs] = initialSnapshot
        ? [initialSnapshot.destinations, initialSnapshot.routeLegs]
        : await Promise.all([
            repository.listDestinations(),
            repository.listRouteLegs(),
          ]);

      if (!isCurrentReload()) return;

      const mustRefreshAfterWaiting = routeLegMutationQueuesByGenerationRef.current
        .get(generation)
        ?.has(allRouteMutationsQueueKey) ?? false;
      await enqueueRouteLegMutations([], async () => {
        if (!isCurrentReload()) return;

        const refreshedSnapshot = mustRefreshAfterWaiting && repository.loadSnapshot
          ? await repository.loadSnapshot()
          : null;
        const [loadedDestinations, loadedRouteLegs] = mustRefreshAfterWaiting
          ? refreshedSnapshot
            ? [refreshedSnapshot.destinations, refreshedSnapshot.routeLegs]
            : await Promise.all([
                repository.listDestinations(),
                repository.listRouteLegs(),
              ])
          : [initialDestinations, initialRouteLegs];
        if (!isCurrentReload()) return;

        const reconciled = await reconcileLoadedRoutesForVehicle({
          repository,
          destinations: loadedDestinations,
          routeLegs: loadedRouteLegs,
          routingVehicle: routingVehicleRef.current,
          calculateRoute: calculateRouteRef.current,
          isCurrentReload,
        });
        if (!reconciled || !isCurrentReload()) return;

        const authoritativeSnapshot = refreshedSnapshot ?? initialSnapshot;
        const loadedActivities = authoritativeSnapshot
          ? reconciled.destinations.map((destination) => [
              destination.id,
              authoritativeSnapshot.activities.filter((activity) => activity.destinationId === destination.id),
            ] as const)
          : await Promise.all(
              reconciled.destinations.map(async (destination) => [
                destination.id,
                await repository.listActivities(destination.id),
              ] as const),
            );
        if (!isCurrentReload()) return;

        replaceDestinations(reconciled.destinations);
        replaceRouteLegs(reconciled.routeLegs);
        replaceActivitiesByDestinationId(Object.fromEntries(loadedActivities));
        if (authoritativeSnapshot) setRevision(authoritativeSnapshot.revision);
        appliedRevision = authoritativeSnapshot?.revision ?? null;
      });
    } catch (caught) {
      if (!isCurrentReload()) return;

      const unavailable = caught instanceof PlotterApiError
        && (caught.status === undefined || caught.status === 503);
      setError(unavailable
        ? 'Shared trip storage is unavailable.'
        : caught instanceof Error ? caught.message : 'Unable to load trip data');
    }

    if (!isCurrentReload()) return;

    hasCompletedInitialLoadRef.current = true;
    setIsLoading(false);
    return appliedRevision;
  }, [
    enqueueRouteLegMutations,
    isActiveGeneration,
    replaceActivitiesByDestinationId,
    replaceDestinations,
    replaceRouteLegs,
    repository,
  ]);

  const reload = useCallback(async () => {
    if (pendingTopologyMutationsRef.current.length > 0) {
      deferredReloadRef.current = true;
      return;
    }
    return startReload(repositoryToken);
  }, [repositoryToken, startReload]);

  const applyDestinationRecipe = useCallback(
    async (applyRecipe: DestinationRecipe, generation: object) => {
      const [loadedDestinations, loadedRouteLegs] = await Promise.all([
        repository.listDestinations(),
        repository.listRouteLegs(),
      ]);
      const priorDestinations = loadedDestinations;
      const priorRouteLegs = loadedRouteLegs;
      if (!isActiveGeneration(generation)) {
        return { priorDestinations, priorRouteLegs, destinations: priorDestinations, routeLegs: priorRouteLegs };
      }
      const nextDestinations = applyRecipe(loadedDestinations);
      const currentVehicle = routingVehicleRef.current;
      const planned = planRouteLegReconciliation({
        destinations: nextDestinations,
        currentRouteLegs: loadedRouteLegs,
        routingVehicle: currentVehicle,
      });
      const calculation = await calculateAutomaticRouteLegs({
        destinations: nextDestinations,
        routeLegs: planned.routeLegs,
        routingVehicle: currentVehicle,
        calculateRoute,
      });
      if (!isActiveGeneration(generation)) {
        return { priorDestinations, priorRouteLegs, destinations: priorDestinations, routeLegs: priorRouteLegs };
      }
      try {
        await repository.applyTripMutation(createTripMutationDelta({
          priorDestinations,
          nextDestinations: calculation.destinations,
          priorRouteLegs,
          nextRouteLegs: calculation.routeLegs,
        }));
      } catch (caught) {
        throw new TripMutationPersistenceError(
          caught instanceof Error ? caught.message : 'Unable to apply trip mutation',
          priorDestinations,
          priorRouteLegs,
          { cause: caught },
        );
      }
      return {
        priorDestinations,
        priorRouteLegs,
        destinations: calculation.destinations,
        routeLegs: calculation.routeLegs,
      };
    },
    [calculateRoute, isActiveGeneration, repository],
  );

  const reconcilePersistedRouteLegs = useCallback(
    (applyRecipe: DestinationRecipe) => {
      const generation = repositoryToken;
      return enqueueRouteLegMutations([], async () => {
        const result = await applyDestinationRecipe(applyRecipe, generation);
        return { destinations: result.destinations, routeLegs: result.routeLegs };
      });
    },
    [applyDestinationRecipe, enqueueRouteLegMutations, repositoryToken],
  );

  const queueTopologyMutation = useCallback((operation: PendingTopologyMutation) => {
    const generation = repositoryToken;
    void enqueueRouteLegMutations([], async () => {
      let baseDestinations: Destination[];
      let baseRouteLegs: RouteLeg[];
      try {
        const result = await applyDestinationRecipe(operation.applyRecipe, generation);
        baseDestinations = result.destinations;
        baseRouteLegs = result.routeLegs;
      } catch (caught) {
        if (resetAfterConflict(caught, generation)) return;
        baseDestinations = caught instanceof TripMutationPersistenceError
          ? caught.priorDestinations
          : operation.fallbackDestinations;
        baseRouteLegs = caught instanceof TripMutationPersistenceError
          ? caught.priorRouteLegs
          : operation.fallbackRouteLegs;
        operation.rollbackActivities();
        if (isActiveGeneration(generation)) {
          setMutationError(caught instanceof Error ? caught.message : 'Unable to save stop changes');
        }
      }

      pendingTopologyMutationsRef.current = pendingTopologyMutationsRef.current.filter(
        ({ id }) => id !== operation.id,
      );
      setPendingTopologyMutationCount(pendingTopologyMutationsRef.current.length);
      if (!isActiveGeneration(generation)) return;

      const projected = projectTopologyMutations({
        destinations: baseDestinations,
        routeLegs: baseRouteLegs,
        pendingMutations: pendingTopologyMutationsRef.current,
        routingVehicle: routingVehicleRef.current,
      });
      replaceDestinations(projected.destinations);
      replaceRouteLegs(projected.routeLegs);

      if (pendingTopologyMutationsRef.current.length === 0 && deferredReloadRef.current) {
        deferredReloadRef.current = false;
        queueMicrotask(() => { void startReload(generation); });
      }
    });
  }, [
    applyDestinationRecipe,
    enqueueRouteLegMutations,
    isActiveGeneration,
    replaceDestinations,
    replaceRouteLegs,
    repositoryToken,
    resetAfterConflict,
    startReload,
  ]);

  useEffect(() => {
    const generation = repositoryToken;
    let isCancelled = false;

    queueMicrotask(() => {
      if (isCancelled || !isActiveGeneration(generation)) return;

      void startReload(generation);
    });

    return () => {
      isCancelled = true;
    };
  }, [isActiveGeneration, repositoryToken, startReload]);

  const actions = useMemo(
    () => {
      const generation = repositoryToken;
      const isActiveAction = () => isActiveGeneration(generation);

      const rawActions = {
        async addDestination(input: AddDestinationInput) {
          const destination = createDestination({
            ...input,
            order: 0,
          });
          if (!isActiveAction()) return destination;
          const priorDestinations = destinationsRef.current;
          const priorRouteLegs = routeLegsRef.current;
          const applyInsertion = (currentDestinations: Destination[]) => {
            const insertionIndex = findBestDestinationInsertionIndex(currentDestinations, input.coordinates);
            const nextDestinations = [...currentDestinations];
            nextDestinations.splice(insertionIndex, 0, destination);
            return nextDestinations.map((nextDestination, order) =>
              nextDestination.order === order ? nextDestination : patchDestination(nextDestination, { order }));
          };
          const optimisticDestinations = applyInsertion(priorDestinations);
          const optimisticPlan = planRouteLegReconciliation({
            destinations: optimisticDestinations,
            currentRouteLegs: priorRouteLegs,
            routingVehicle: routingVehicleRef.current,
          });
          setMutationError(null);
          replaceDestinations(optimisticDestinations);
          updateActivitiesByDestinationId((current) => ({
            ...current,
            [destination.id]: current[destination.id] ?? [],
          }));
          replaceRouteLegs(optimisticPlan.routeLegs);
          const operation: PendingTopologyMutation = {
            id: nextTopologyMutationIdRef.current + 1,
            destinationIds: [destination.id],
            applyRecipe: applyInsertion,
            fallbackDestinations: priorDestinations,
            fallbackRouteLegs: priorRouteLegs,
            rollbackActivities: () => updateActivitiesByDestinationId((current) => {
              const remaining = { ...current };
              delete remaining[destination.id];
              return remaining;
            }),
          };
          nextTopologyMutationIdRef.current = operation.id;
          pendingTopologyMutationsRef.current = [...pendingTopologyMutationsRef.current, operation];
          setPendingTopologyMutationCount(pendingTopologyMutationsRef.current.length);
          queueTopologyMutation(operation);
          return destination;
        },

        async updateDestination(
          destinationId: string,
          patch: Partial<Omit<Destination, 'id' | 'createdAt' | 'updatedAt'>>,
        ) {
          const existing = destinationsRef.current.find(
            (destination) => destination.id === destinationId,
          );
          if (!existing) return;
          if (!isActiveAction()) return;

          const persisted = await reconcilePersistedRouteLegs((currentDestinations) =>
            currentDestinations.map((destination) => destination.id === destinationId
              ? patchDestination(destination, patch)
              : destination));
          if (!isActiveAction()) return;

          replaceDestinations(persisted.destinations);
          replaceRouteLegs(persisted.routeLegs);
        },

        async deleteDestination(destinationId: string) {
          if (!isActiveAction()) return;
          const priorDestinations = destinationsRef.current;
          const priorRouteLegs = routeLegsRef.current;
          const deletedActivities = activitiesByDestinationIdRef.current[destinationId];
          const applyDeletion = (currentDestinations: Destination[]) =>
            currentDestinations
              .filter((destination) => destination.id !== destinationId)
              .map((destination, order) => destination.order === order ? destination : patchDestination(destination, { order }));
          const optimisticDestinations = applyDeletion(priorDestinations);
          const optimisticPlan = planRouteLegReconciliation({
            destinations: optimisticDestinations,
            currentRouteLegs: priorRouteLegs,
            routingVehicle: routingVehicleRef.current,
          });
          setMutationError(null);
          replaceDestinations(optimisticDestinations);
          updateActivitiesByDestinationId((current) => {
            const remaining = { ...current };
            delete remaining[destinationId];
            return remaining;
          });
          replaceRouteLegs(optimisticPlan.routeLegs);
          const operation: PendingTopologyMutation = {
            id: nextTopologyMutationIdRef.current + 1,
            destinationIds: [destinationId],
            applyRecipe: applyDeletion,
            fallbackDestinations: priorDestinations,
            fallbackRouteLegs: priorRouteLegs,
            rollbackActivities: () => {
              if (!deletedActivities) return;
              updateActivitiesByDestinationId((current) => ({
                ...current,
                [destinationId]: deletedActivities,
              }));
            },
          };
          nextTopologyMutationIdRef.current = operation.id;
          pendingTopologyMutationsRef.current = [...pendingTopologyMutationsRef.current, operation];
          setPendingTopologyMutationCount(pendingTopologyMutationsRef.current.length);
          queueTopologyMutation(operation);
        },

        async reorderDestinations(destinationIds: string[]) {
          const currentDestinations = destinationsRef.current;
          const requestedIds = new Set(destinationIds);
          const destinationsById = new Map(
            currentDestinations.map((destination) => [destination.id, destination]),
          );
          const orderedDestinations = [
            ...destinationIds
              .map((destinationId) => destinationsById.get(destinationId))
              .filter((destination): destination is Destination => destination !== undefined),
            ...currentDestinations.filter((destination) => !requestedIds.has(destination.id)),
          ].map((destination, order) => patchDestination(destination, { order }));

          if (!isActiveAction()) return;

          const priorDestinations = destinationsRef.current;
          const priorRouteLegs = routeLegsRef.current;
          const optimisticPlan = planRouteLegReconciliation({
            destinations: orderedDestinations,
            currentRouteLegs: priorRouteLegs,
            routingVehicle: routingVehicleRef.current,
          });
          replaceDestinations(orderedDestinations);
          replaceRouteLegs(optimisticPlan.routeLegs);
          let persisted: { destinations: Destination[]; routeLegs: RouteLeg[] };
          try {
            persisted = await reconcilePersistedRouteLegs((freshDestinations) => {
              const freshById = new Map(freshDestinations.map((destination) => [destination.id, destination]));
              const freshRequestedIds = new Set(destinationIds);
              return [
                ...destinationIds.map((destinationId) => freshById.get(destinationId)).filter((destination): destination is Destination => Boolean(destination)),
                ...freshDestinations.filter((destination) => !freshRequestedIds.has(destination.id)),
              ].map((destination, order) => patchDestination(destination, { order }));
            });
          } catch (caught) {
            if (isActiveAction()) {
              replaceDestinations(priorDestinations);
              replaceRouteLegs(priorRouteLegs);
            }
            throw caught;
          }
          if (!isActiveAction()) return;

          replaceDestinations(persisted.destinations);
          replaceRouteLegs(persisted.routeLegs);
        },

        async addRouteLeg(input: {
          originDestinationId: string;
          targetDestinationId: string;
          movement?: RouteMovement;
          calculation?: RouteCalculationMode;
          notes?: string;
        }) {
          const leg = createRouteLeg(input);
          if (!isActiveAction()) return leg;

          await enqueueRouteLegMutation(leg.id, () => repository.saveRouteLeg(leg));
          if (!isActiveAction()) return leg;

          updateRouteLegs((current) => [...current, leg]);
          return leg;
        },

        async updateRouteLeg(
          routeLegId: string,
          patch: RouteLegPatch,
        ) {
          return enqueueRouteLegMutation(routeLegId, async () => {
            const persistedRouteLegs = await repository.listRouteLegs();
            const existing = persistedRouteLegs.find((routeLeg) => routeLeg.id === routeLegId);
            if (!existing) return;
            const currentDestinations = destinationsRef.current;

            const updatedAt = createTimestamp();
            const mergedRouteLeg = {
              ...existing,
              ...patch,
              updatedAt,
            };
            const isIncompleteReadyDrivingPatch =
              patch.status === 'ready' &&
              mergedRouteLeg.movement === 'drive' &&
              mergedRouteLeg.calculation === 'automatic' &&
              !hasPreservableDrivingRouteData(patch);
            const routeLegForFinalization = isIncompleteReadyDrivingPatch
              ? {
                ...mergedRouteLeg,
                distanceKm: patch.distanceKm,
                travelTimeHours: patch.travelTimeHours,
                geometry: patch.geometry,
                provider: patch.provider,
                profile: patch.profile,
                routeKey: patch.routeKey,
                calculatedAt: patch.calculatedAt,
                error: patch.error,
              }
              : mergedRouteLeg;
            const pendingRouteLeg =
              routeLegForFinalization.movement === 'drive' &&
              routeLegForFinalization.calculation === 'automatic' &&
              !hasPreservableDrivingRouteData(routeLegForFinalization)
              ? {
                ...routeLegForFinalization,
                status: 'pending' as const,
                error: undefined,
                providerDiagnostic: undefined,
              }
              : routeLegForFinalization;

            if (pendingRouteLeg.status === 'pending') {
              updateRouteLegs((current) =>
                current.map((routeLeg) => (routeLeg.id === routeLegId ? pendingRouteLeg : routeLeg)),
              );
            }

            let calculatedDestinations = currentDestinations;
            let updated: RouteLeg;
            if (
              pendingRouteLeg.movement === 'drive' &&
              pendingRouteLeg.calculation === 'automatic' &&
              !hasPreservableDrivingRouteData(pendingRouteLeg)
            ) {
              const calculation = await calculateAutomaticRouteLegs({
                destinations: currentDestinations,
                routeLegs: [pendingRouteLeg],
                routingVehicle: routingVehicleRef.current,
                calculateRoute,
                retryFailed: true,
              });
              [updated] = calculation.routeLegs;
              calculatedDestinations = calculation.destinations;
            } else {
              updated = await finalizeRouteLeg({
                routeLeg: pendingRouteLeg,
                destinations: currentDestinations,
                routingVehicle: routingVehicleRef.current,
                calculateRoute,
              });
            }
            if (!isActiveAction()) return;

            const destinationsToSave = changedDestinationsByReference(currentDestinations, calculatedDestinations);
            await persistRouteCalculationBatch({
              repository,
              priorDestinations: currentDestinations,
              priorRouteLegs: persistedRouteLegs,
              destinationsToSave,
              routeLegsToSave: [updated],
              failurePrefix: 'Unable to save route update',
            });
            if (!isActiveAction()) return;

            if (destinationsToSave.length > 0) {
              replaceDestinations(calculatedDestinations);
            }
            updateRouteLegs((current) =>
              current.map((routeLeg) => (routeLeg.id === routeLegId ? updated : routeLeg)),
            );
          });
        },

        async applyValidatedRouteLegResult({
          routeLegId,
          expectedFingerprint,
          validatedRouteLeg,
          destinationAnchorUpdates = [],
        }: ApplyValidatedRouteLegResultInput) {
          return enqueueRouteLegMutation(routeLegId, async () => {
            const currentRouteLeg = routeLegsRef.current.find((routeLeg) => routeLeg.id === routeLegId);
            if (
              !currentRouteLeg ||
              createRouteResultFingerprint(currentRouteLeg, routingVehicleRef.current) !== expectedFingerprint
            ) {
              return false;
            }
            if (validatedRouteLeg.id !== routeLegId || !hasFinalizedAutomaticRouteResult(validatedRouteLeg)) {
              throw new Error('Validated route result is incomplete');
            }

            const updated = {
              ...currentRouteLeg,
              status: validatedRouteLeg.status,
              distanceKm: validatedRouteLeg.distanceKm,
              travelTimeHours: validatedRouteLeg.travelTimeHours,
              geometry: validatedRouteLeg.geometry,
              provider: validatedRouteLeg.provider,
              profile: validatedRouteLeg.profile,
              routeKey: validatedRouteLeg.routeKey,
              sections: validatedRouteLeg.sections,
              warnings: validatedRouteLeg.warnings,
              calculatedAt: validatedRouteLeg.calculatedAt,
              error: validatedRouteLeg.error,
              providerDiagnostic: validatedRouteLeg.providerDiagnostic,
              updatedAt: createTimestamp(),
            };
            if (!hasFinalizedAutomaticRouteResult(updated)) {
              throw new Error('Validated route result does not match current route intent');
            }

            const currentDestinations = destinationsRef.current;
            const currentRouteLegs = routeLegsRef.current;
            const destinationAnchorsById = new Map<string, RoutingAnchor[]>();
            for (const { destinationId, anchor } of destinationAnchorUpdates) {
              const anchors = destinationAnchorsById.get(destinationId) ?? [];
              anchors.push(anchor);
              destinationAnchorsById.set(destinationId, anchors);
            }
            const nextDestinations = destinationAnchorsById.size > 0
              ? currentDestinations.map((destination) => {
                  const anchors = destinationAnchorsById.get(destination.id) ?? [];
                  return anchors.reduce(withRoutingAnchor, destination);
                })
              : currentDestinations;
            const destinationsToSave = changedDestinationsByReference(currentDestinations, nextDestinations);
            const latestRouteLeg = routeLegsRef.current.find((routeLeg) => routeLeg.id === routeLegId);
            if (
              latestRouteLeg !== currentRouteLeg ||
              createRouteResultFingerprint(currentRouteLeg, routingVehicleRef.current) !== expectedFingerprint
            ) {
              return false;
            }

            await persistRouteCalculationBatch({
              repository,
              priorDestinations: currentDestinations,
              priorRouteLegs: currentRouteLegs,
              destinationsToSave,
              routeLegsToSave: [updated],
              failurePrefix: 'Unable to save selected route',
            });
            if (!isActiveAction()) return false;

            if (destinationsToSave.length > 0) {
              replaceDestinations(nextDestinations);
            }
            updateRouteLegs((current) =>
              current.map((routeLeg) => (routeLeg.id === routeLegId ? updated : routeLeg)),
            );
            return true;
          });
        },

        async deleteRouteLeg(routeLegId: string) {
          if (!isActiveAction()) return;

          await enqueueRouteLegMutation(routeLegId, async () => {
            await repository.deleteRouteLeg(routeLegId);
            if (!isActiveAction()) return;

            updateRouteLegs((current) => current.filter((leg) => leg.id !== routeLegId));
          });
        },

        async createActivity(input: {
          destinationId: string;
          title: string;
          order?: number;
          location?: Activity['location'];
        }) {
          if (!isActiveAction()) return createActivityModel(input);

          const create = () => repository.createActivity(input);
          const activity = pendingTopologyMutationsRef.current.some(
            ({ destinationIds }) => destinationIds.includes(input.destinationId),
          )
            ? await enqueueRouteLegMutations([], create)
            : await create();
          if (!isActiveAction()) return activity;

          updateActivitiesByDestinationId((current) => ({
            ...current,
            [activity.destinationId]: [...(current[activity.destinationId] ?? []), activity].sort(
              (left, right) =>
                left.order - right.order || left.createdAt.localeCompare(right.createdAt),
            ),
          }));
          return activity;
        },

        async updateActivity(
          activityId: string,
          patch: Partial<Omit<Activity, 'id' | 'destinationId' | 'createdAt' | 'updatedAt'>>,
        ) {
          if (!isActiveAction()) return;

          const updated = await repository.updateActivity(activityId, patch);
          if (!isActiveAction()) return updated;

          updateActivitiesByDestinationId((current) => ({
            ...current,
            [updated.destinationId]: (current[updated.destinationId] ?? []).map((activity) =>
              activity.id === activityId ? updated : activity,
            ),
          }));
          return updated;
        },

        async deleteActivity(activityId: string) {
          if (!isActiveAction()) return;

          let destinationId = '';
          for (const [candidateDestinationId, activities] of Object.entries(
            activitiesByDestinationIdRef.current,
          )) {
            if (activities.some((activity) => activity.id === activityId)) {
              destinationId = candidateDestinationId;
              break;
            }
          }

          await repository.deleteActivity(activityId);
          if (!isActiveAction() || !destinationId) return;

          updateActivitiesByDestinationId((current) => ({
            ...current,
            [destinationId]: (current[destinationId] ?? []).filter(
              (activity) => activity.id !== activityId,
            ),
          }));
        },

        async reorderActivities(destinationId: string, orderedActivityIds: string[]) {
          if (!isActiveAction()) {
            return activitiesByDestinationIdRef.current[destinationId] ?? [];
          }

          const orderedActivities = await repository.reorderActivities(
            destinationId,
            orderedActivityIds,
          );
          if (!isActiveAction()) return orderedActivities;

          updateActivitiesByDestinationId((current) => ({
            ...current,
            [destinationId]: orderedActivities,
          }));
          return orderedActivities;
        },

        async recalculateForVehicle(nextRoutingVehicle: TripRoutingVehicle) {
          if (!isActiveAction()) return;
          const expectedReloadSequence = reloadSequenceRef.current;

          await enqueueRouteLegMutations([], async () => {
            const isCurrentOperation = () =>
              isActiveAction() && reloadSequenceRef.current === expectedReloadSequence;
            if (!isCurrentOperation()) return;

            const [loadedDestinations, loadedRouteLegs] = await Promise.all([
              repository.listDestinations(),
              repository.listRouteLegs(),
            ]);
            if (!isCurrentOperation()) return;

            const priorDestinations = structuredClone(loadedDestinations);
            const priorRouteLegs = structuredClone(loadedRouteLegs);
            const invalidatedRouteLegs = recalculateAutomaticRouteLegsForVehicle({
              destinations: priorDestinations,
              routeLegs: priorRouteLegs,
              routingVehicle: nextRoutingVehicle,
            });
            const calculation = await calculateAutomaticRouteLegs({
              destinations: priorDestinations,
              routeLegs: invalidatedRouteLegs,
              routingVehicle: nextRoutingVehicle,
              calculateRoute,
              retryFailed: true,
            });
            if (!isCurrentOperation()) return;

            const [latestDestinations, latestRouteLegs] = await Promise.all([
              repository.listDestinations(),
              repository.listRouteLegs(),
            ]);
            if (
              !isCurrentOperation() ||
              !entityRevisionsMatch(priorDestinations, latestDestinations) ||
              !entityRevisionsMatch(priorRouteLegs, latestRouteLegs)
            ) return;

            const destinationsToSave = changedDestinationsByReference(
              priorDestinations,
              calculation.destinations,
            );
            await persistRouteCalculationBatch({
              repository,
              priorDestinations,
              priorRouteLegs,
              destinationsToSave,
              routeLegsToSave: calculation.routeLegs,
              failurePrefix: 'Unable to save recalculated routes',
            });
            if (!isCurrentOperation()) return;

            if (destinationsToSave.length > 0) {
              replaceDestinations(calculation.destinations);
            }
            replaceRouteLegs(calculation.routeLegs);
          });
        },

        reload,
      };
      const recoverAction = <Args extends unknown[], Result>(
        action: (...args: Args) => Promise<Result>,
      ) => async (...args: Args): Promise<Result> => {
        try {
          return await action(...args);
        } catch (caught) {
          if (resetAfterConflict(caught, generation)) return undefined as Result;
          throw caught;
        }
      };

      /* eslint-disable react-hooks/refs -- wrapped actions only read transient refs after user invocation */
      const recovered = {
        addDestination: recoverAction(rawActions.addDestination),
        updateDestination: recoverAction(rawActions.updateDestination),
        deleteDestination: recoverAction(rawActions.deleteDestination),
        reorderDestinations: recoverAction(rawActions.reorderDestinations),
        addRouteLeg: recoverAction(rawActions.addRouteLeg),
        updateRouteLeg: recoverAction(rawActions.updateRouteLeg),
        applyValidatedRouteLegResult: recoverAction(rawActions.applyValidatedRouteLegResult),
        deleteRouteLeg: recoverAction(rawActions.deleteRouteLeg),
        createActivity: recoverAction(rawActions.createActivity),
        updateActivity: recoverAction(rawActions.updateActivity),
        deleteActivity: recoverAction(rawActions.deleteActivity),
        reorderActivities: recoverAction(rawActions.reorderActivities),
        recalculateForVehicle: recoverAction(rawActions.recalculateForVehicle),
        reload: recoverAction(rawActions.reload),
      };
      /* eslint-enable react-hooks/refs */
      return recovered;
    },
    [
      calculateRoute,
      enqueueRouteLegMutation,
      enqueueRouteLegMutations,
      isActiveGeneration,
      queueTopologyMutation,
      reconcilePersistedRouteLegs,
      reload,
      replaceDestinations,
      replaceRouteLegs,
      repository,
      repositoryToken,
      resetAfterConflict,
      updateActivitiesByDestinationId,
      updateRouteLegs,
    ],
  );

  return {
    destinations,
    routeLegs,
    activitiesByDestinationId,
    isLoading,
    error,
    mutationError,
    revision,
    isMutatingStops: pendingTopologyMutationCount > 0,
    ...actions,
  };
}
