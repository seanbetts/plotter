import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createActivity as createActivityModel } from '../domain/activities';
import { createDestination, updateDestination as patchDestination } from '../domain/destinations';
import { findBestDestinationInsertionIndex, planRouteLegReconciliation } from '../domain/routePlanner';
import { createRouteLeg } from '../domain/routeLegs';
import type { Activity, Coordinates, Destination, DestinationLocation, RouteCalculationMode, RouteLeg, RouteMovement, TripRoutingVehicle } from '../domain/types';
import { standardRoutingVehicle } from '../domain/vehiclePresets';
import type { TripRepository } from '../storage/tripRepository';
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
};

const createTimestamp = () => new Date().toISOString();

export function useTripData(repository: TripRepository, options: UseTripDataOptions = {}) {
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [routeLegs, setRouteLegs] = useState<RouteLeg[]>([]);
  const [activitiesByDestinationId, setActivitiesByDestinationId] = useState<Record<string, Activity[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const destinationsRef = useRef<Destination[]>([]);
  const routeLegsRef = useRef<RouteLeg[]>([]);
  const activitiesByDestinationIdRef = useRef<Record<string, Activity[]>>({});
  const isMountedRef = useRef(false);
  const activeRepositoryTokenRef = useRef<object | null>(null);
  const reloadSequenceRef = useRef(0);
  const routeLegMutationQueuesRef = useRef(new Map<string, Promise<void>>());
  const calculateRoute = options.calculateRoute;
  const routingVehicle = options.routingVehicle ?? standardRoutingVehicle;
  const routingVehicleRef = useRef(routingVehicle);
  const repositoryToken = useMemo(() => ({ repository }), [repository]);

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
    const uniqueRouteLegIds = [...new Set(['__all_route_mutations__', ...routeLegIds])].sort();
    const previousMutations = uniqueRouteLegIds.map(
      (routeLegId) => routeLegMutationQueuesRef.current.get(routeLegId) ?? Promise.resolve(),
    );
    const waitForPrevious = Promise.all(previousMutations).then(() => undefined, () => undefined);
    const queuedMutation = waitForPrevious.then(mutation, mutation);
    const queueTail = queuedMutation.then(() => undefined, () => undefined);
    for (const routeLegId of uniqueRouteLegIds) {
      routeLegMutationQueuesRef.current.set(routeLegId, queueTail);
    }
    void queueTail.then(() => {
      for (const routeLegId of uniqueRouteLegIds) {
        if (routeLegMutationQueuesRef.current.get(routeLegId) === queueTail) {
          routeLegMutationQueuesRef.current.delete(routeLegId);
        }
      }
    });
    return queuedMutation;
  }, []);

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
    activeRepositoryTokenRef.current = repositoryToken;
    reloadSequenceRef.current += 1;

    return () => {
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

  const startReload = useCallback(async (generation: object) => {
    if (!isActiveGeneration(generation)) return;

    const sequence = reloadSequenceRef.current + 1;
    reloadSequenceRef.current = sequence;
    const isCurrentReload = () =>
      isActiveGeneration(generation) && reloadSequenceRef.current === sequence;

    setIsLoading(true);
    setError(null);
    try {
      const [loadedDestinations, loadedRouteLegs] = await Promise.all([
        repository.listDestinations(),
        repository.listRouteLegs(),
      ]);

      if (!isCurrentReload()) return;

      const loadedActivities = await Promise.all(
        loadedDestinations.map(async (destination) => [
          destination.id,
          await repository.listActivities(destination.id),
        ] as const),
      );
      const nextActivitiesByDestinationId = Object.fromEntries(loadedActivities);

      if (!isCurrentReload()) return;

      replaceDestinations(loadedDestinations);
      replaceRouteLegs(loadedRouteLegs);
      replaceActivitiesByDestinationId(nextActivitiesByDestinationId);
    } catch (caught) {
      if (!isCurrentReload()) return;

      setError(caught instanceof Error ? caught.message : 'Unable to load trip data');
    }

    if (!isCurrentReload()) return;

    setIsLoading(false);
  }, [
    isActiveGeneration,
    replaceActivitiesByDestinationId,
    replaceDestinations,
    replaceRouteLegs,
    repository,
  ]);

  const reload = useCallback(async () => {
    await startReload(repositoryToken);
  }, [repositoryToken, startReload]);

  const reconcilePersistedRouteLegs = useCallback(
    (nextDestinations: Destination[]) => {
      const generation = repositoryToken;
      return enqueueRouteLegMutations([], async () => {
        if (!isActiveGeneration(generation)) return routeLegsRef.current;

        const [loadedDestinations, loadedRouteLegs] = await Promise.all([
          repository.listDestinations(),
          repository.listRouteLegs(),
        ]);
        const priorDestinations = structuredClone(loadedDestinations);
        const persistedRouteLegs = structuredClone(loadedRouteLegs);
        if (!isActiveGeneration(generation)) return routeLegsRef.current;
        const currentVehicle = routingVehicleRef.current;
        const planned = planRouteLegReconciliation({
          destinations: nextDestinations,
          currentRouteLegs: persistedRouteLegs,
          routingVehicle: currentVehicle,
        });
        const nextRouteLegs = await calculateAutomaticRouteLegs({
          destinations: nextDestinations,
          routeLegs: planned.routeLegs,
          routingVehicle: currentVehicle,
          calculateRoute,
        });
        const nextDestinationIds = new Set(nextDestinations.map(({ id }) => id));
        const nextRouteLegIds = new Set(nextRouteLegs.map(({ id }) => id));

        try {
          for (const destination of nextDestinations) await repository.saveDestination(destination);
          for (const destination of priorDestinations) {
            if (!nextDestinationIds.has(destination.id)) await repository.deleteDestination(destination.id);
          }
          for (const routeLeg of persistedRouteLegs) {
            if (!nextRouteLegIds.has(routeLeg.id)) await repository.deleteRouteLeg(routeLeg.id);
          }
          for (const routeLeg of nextRouteLegs) await repository.saveRouteLeg(routeLeg);
        } catch (caught) {
          const primaryMessage = caught instanceof Error ? caught.message : 'Unknown trip storage error';
          const priorDestinationIds = new Set(priorDestinations.map(({ id }) => id));
          const priorRouteLegIds = new Set(persistedRouteLegs.map(({ id }) => id));
          const rollbackOperations: Array<{ label: string; operation: () => Promise<void> }> = [
            ...nextDestinations
              .filter(({ id }) => !priorDestinationIds.has(id))
              .map(({ id }) => ({ label: `destination ${id} removal`, operation: () => repository.deleteDestination(id) })),
            ...priorDestinations.map((destination) => ({
              label: `destination ${destination.id} restore`, operation: () => repository.saveDestination(destination),
            })),
            ...nextRouteLegs
              .filter(({ id }) => !priorRouteLegIds.has(id))
              .map(({ id }) => ({ label: `route ${id} removal`, operation: () => repository.deleteRouteLeg(id) })),
            ...persistedRouteLegs.map((routeLeg) => ({
              label: `route ${routeLeg.id} restore`, operation: () => repository.saveRouteLeg(routeLeg),
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
        return nextRouteLegs;
      });
    },
    [calculateRoute, enqueueRouteLegMutations, isActiveGeneration, repository, repositoryToken],
  );

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

      return {
        async addDestination(input: AddDestinationInput) {
          const insertionIndex = findBestDestinationInsertionIndex(
            destinationsRef.current,
            input.coordinates,
          );
          const destination = createDestination({
            ...input,
            order: insertionIndex,
          });
          if (!isActiveAction()) return destination;

          const nextDestinations = [...destinationsRef.current];
          nextDestinations.splice(insertionIndex, 0, destination);
          const orderedDestinations = nextDestinations.map((nextDestination, order) =>
            nextDestination.order === order
              ? nextDestination
              : patchDestination(nextDestination, { order }),
          );
          const nextRouteLegs = await reconcilePersistedRouteLegs(orderedDestinations);
          if (!isActiveAction()) return destination;

          replaceDestinations(orderedDestinations);
          updateActivitiesByDestinationId((current) => ({
            ...current,
            [destination.id]: current[destination.id] ?? [],
          }));
          replaceRouteLegs(nextRouteLegs);
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
          const updated = patchDestination(existing, patch);
          if (!isActiveAction()) return;

          const nextDestinations = destinationsRef.current.map((destination) =>
            destination.id === destinationId ? updated : destination,
          );
          const nextRouteLegs = await reconcilePersistedRouteLegs(nextDestinations);
          if (!isActiveAction()) return;

          replaceDestinations(nextDestinations);
          replaceRouteLegs(nextRouteLegs);
        },

        async deleteDestination(destinationId: string) {
          if (!isActiveAction()) return;

          const nextDestinations = destinationsRef.current.filter((destination) => destination.id !== destinationId);
          const nextRouteLegs = await reconcilePersistedRouteLegs(nextDestinations);
          if (!isActiveAction()) return;

          replaceDestinations(nextDestinations);
          updateActivitiesByDestinationId((current) => {
            const remaining = { ...current };
            delete remaining[destinationId];
            return remaining;
          });
          replaceRouteLegs(nextRouteLegs);
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
          let nextRouteLegs: RouteLeg[];
          try {
            nextRouteLegs = await reconcilePersistedRouteLegs(orderedDestinations);
          } catch (caught) {
            if (isActiveAction()) {
              replaceDestinations(priorDestinations);
              replaceRouteLegs(priorRouteLegs);
            }
            throw caught;
          }
          if (!isActiveAction()) return;

          replaceRouteLegs(nextRouteLegs);
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
              }
              : routeLegForFinalization;

            if (pendingRouteLeg.status === 'pending') {
              updateRouteLegs((current) =>
                current.map((routeLeg) => (routeLeg.id === routeLegId ? pendingRouteLeg : routeLeg)),
              );
            }

            const updated = await finalizeRouteLeg({
              routeLeg: pendingRouteLeg,
              destinations: destinationsRef.current,
              routingVehicle: routingVehicleRef.current,
              calculateRoute,
            });
            if (!isActiveAction()) return;

            await repository.saveRouteLeg(updated);
            if (!isActiveAction()) return;

            updateRouteLegs((current) =>
              current.map((routeLeg) => (routeLeg.id === routeLegId ? updated : routeLeg)),
            );
          });
        },

        async applyValidatedRouteLegResult({
          routeLegId,
          expectedFingerprint,
          validatedRouteLeg,
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
              updatedAt: createTimestamp(),
            };
            if (!hasFinalizedAutomaticRouteResult(updated)) {
              throw new Error('Validated route result does not match current route intent');
            }

            const latestRouteLeg = routeLegsRef.current.find((routeLeg) => routeLeg.id === routeLegId);
            if (
              latestRouteLeg !== currentRouteLeg ||
              createRouteResultFingerprint(currentRouteLeg, routingVehicleRef.current) !== expectedFingerprint
            ) {
              return false;
            }

            await repository.saveRouteLeg(updated);
            if (!isActiveAction()) return false;

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

          const activity = await repository.createActivity(input);
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

          const priorRouteLegs = structuredClone(routeLegsRef.current);
          const invalidatedRouteLegs = recalculateAutomaticRouteLegsForVehicle({
            destinations: destinationsRef.current,
            routeLegs: priorRouteLegs,
            routingVehicle: nextRoutingVehicle,
          });
          const recalculatedRouteLegs = await calculateAutomaticRouteLegs({
            destinations: destinationsRef.current,
            routeLegs: invalidatedRouteLegs,
            routingVehicle: nextRoutingVehicle,
            calculateRoute,
            retryFailed: true,
          });
          if (!isActiveAction()) return;

          await enqueueRouteLegMutations([
            ...priorRouteLegs.map((routeLeg) => routeLeg.id),
            ...recalculatedRouteLegs.map((routeLeg) => routeLeg.id),
          ], async () => {
            try {
              for (const routeLeg of recalculatedRouteLegs) {
                await repository.saveRouteLeg(routeLeg);
              }
            } catch (caught) {
              const primaryMessage = caught instanceof Error ? caught.message : 'Unknown route storage error';
              const rollbackResults = await Promise.allSettled(
                priorRouteLegs.map((routeLeg) => repository.saveRouteLeg(routeLeg)),
              );
              const rollbackMessages = rollbackResults.flatMap((result, index) =>
                result.status === 'rejected'
                  ? [`${priorRouteLegs[index].id}: ${result.reason instanceof Error ? result.reason.message : 'Unknown rollback error'}`]
                  : [],
              );

              if (rollbackMessages.length > 0) {
                throw new Error(
                  `Unable to save recalculated routes: ${primaryMessage}. Route rollback failed: ${rollbackMessages.join('; ')}`,
                  { cause: caught },
                );
              }

              throw new Error(
                `Unable to save recalculated routes: ${primaryMessage}. Previous route legs were restored.`,
                { cause: caught },
              );
            }
            if (!isActiveAction()) return;

            replaceRouteLegs(recalculatedRouteLegs);
          });
        },

        reload,
      };
    },
    [
      calculateRoute,
      enqueueRouteLegMutation,
      enqueueRouteLegMutations,
      isActiveGeneration,
      reconcilePersistedRouteLegs,
      reload,
      replaceDestinations,
      replaceRouteLegs,
      repository,
      repositoryToken,
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
    ...actions,
  };
}
