import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createActivity as createActivityModel } from '../domain/activities';
import { createDestination, updateDestination as patchDestination } from '../domain/destinations';
import { findBestDestinationInsertionIndex, planRouteLegReconciliation } from '../domain/routePlanner';
import { createRouteLeg } from '../domain/routeLegs';
import type { Activity, Coordinates, Destination, DestinationLocation, RouteLeg, RouteLegType, TripRoutingVehicle } from '../domain/types';
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
  const routeReconciliationQueueRef = useRef<Promise<void>>(Promise.resolve());
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
    const uniqueRouteLegIds = [...new Set(routeLegIds)].sort();
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
    (nextDestinations: Destination[], planned = planRouteLegReconciliation({
      destinations: nextDestinations,
      currentRouteLegs: routeLegsRef.current,
      routingVehicle,
    })) => {
      const generation = repositoryToken;
      const reconcile = async () => {
        if (!isActiveGeneration(generation)) return routeLegsRef.current;

        const persistedRouteLegs = await repository.listRouteLegs();
        if (!isActiveGeneration(generation)) return routeLegsRef.current;

        const nextRouteLegs = await calculateAutomaticRouteLegs({
          destinations: nextDestinations,
          routeLegs: planned.routeLegs,
          routingVehicle,
          calculateRoute,
        });
        const plannedIds = new Set(planned.routeLegs.map((routeLeg) => routeLeg.id));
        const removedRouteLegIds = new Set([
          ...planned.removedRouteLegIds,
          ...persistedRouteLegs.filter((routeLeg) => !plannedIds.has(routeLeg.id)).map((routeLeg) => routeLeg.id),
        ]);
        return enqueueRouteLegMutations([
          ...removedRouteLegIds,
          ...nextRouteLegs.map((routeLeg) => routeLeg.id),
        ], async () => {
          if (!isActiveGeneration(generation)) return routeLegsRef.current;
          for (const routeLegId of removedRouteLegIds) {
            await repository.deleteRouteLeg(routeLegId);
          }
          for (const routeLeg of nextRouteLegs) {
            await repository.saveRouteLeg(routeLeg);
          }
          return nextRouteLegs;
        });
      };
      const queuedReconciliation = routeReconciliationQueueRef.current.then(reconcile, reconcile);
      routeReconciliationQueueRef.current = queuedReconciliation.then(
        () => undefined,
        () => undefined,
      );
      return queuedReconciliation;
    },
    [calculateRoute, enqueueRouteLegMutations, isActiveGeneration, repository, repositoryToken, routingVehicle],
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
          const planned = planRouteLegReconciliation({
            destinations: orderedDestinations,
            currentRouteLegs: routeLegsRef.current,
            routingVehicle,
          });

          await Promise.all(
            orderedDestinations.map((orderedDestination) =>
              repository.saveDestination(orderedDestination),
            ),
          );
          if (!isActiveAction()) return destination;

          replaceDestinations(orderedDestinations);
          updateActivitiesByDestinationId((current) => ({
            ...current,
            [destination.id]: current[destination.id] ?? [],
          }));
          const nextRouteLegs = await reconcilePersistedRouteLegs(orderedDestinations, planned);
          if (!isActiveAction()) return destination;

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
          const planned = planRouteLegReconciliation({
            destinations: nextDestinations,
            currentRouteLegs: routeLegsRef.current,
            routingVehicle,
          });

          await repository.saveDestination(updated);
          if (!isActiveAction()) return;

          replaceDestinations(nextDestinations);
          const nextRouteLegs = await reconcilePersistedRouteLegs(nextDestinations, planned);
          if (!isActiveAction()) return;

          replaceRouteLegs(nextRouteLegs);
        },

        async deleteDestination(destinationId: string) {
          if (!isActiveAction()) return;

          const nextDestinations = destinationsRef.current.filter((destination) => destination.id !== destinationId);
          const attachedRouteLegIds = routeLegsRef.current
            .filter(
              (routeLeg) =>
                routeLeg.originDestinationId === destinationId ||
                routeLeg.targetDestinationId === destinationId,
            )
            .map((routeLeg) => routeLeg.id);
          const planned = planRouteLegReconciliation({
            destinations: nextDestinations,
            currentRouteLegs: routeLegsRef.current,
            routingVehicle,
          });

          await enqueueRouteLegMutations(attachedRouteLegIds, () => repository.deleteDestination(destinationId));
          if (!isActiveAction()) return;

          replaceDestinations(nextDestinations);
          updateActivitiesByDestinationId((current) => {
            const remaining = { ...current };
            delete remaining[destinationId];
            return remaining;
          });
          updateRouteLegs((current) =>
            current.filter(
              (leg) =>
                leg.originDestinationId !== destinationId &&
                leg.targetDestinationId !== destinationId,
            ),
          );
          const nextRouteLegs = await reconcilePersistedRouteLegs(nextDestinations, planned);
          if (!isActiveAction()) return;

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

          const previousRouteLegs = routeLegsRef.current;
          const reconciliation = planRouteLegReconciliation({
            destinations: orderedDestinations,
            currentRouteLegs: previousRouteLegs,
            routingVehicle,
          });
          replaceDestinations(orderedDestinations);
          replaceRouteLegs(reconciliation.routeLegs);
          const saveDestinations = Promise.all(
            orderedDestinations.map((destination) => repository.saveDestination(destination)),
          );
          await saveDestinations;
          if (!isActiveAction()) return;

          const routeLegReconciliation = reconcilePersistedRouteLegs(orderedDestinations, reconciliation).then((nextRouteLegs) => {
            if (!isActiveAction()) return routeLegsRef.current;

            replaceRouteLegs(nextRouteLegs);
            return nextRouteLegs;
          });
          await routeLegReconciliation;
        },

        async addRouteLeg(input: {
          originDestinationId: string;
          targetDestinationId: string;
          type: RouteLegType;
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
            const existing = routeLegsRef.current.find((routeLeg) => routeLeg.id === routeLegId);
            if (!existing) return;

            const updatedAt = createTimestamp();
            const mergedRouteLeg = {
              ...existing,
              ...patch,
              updatedAt,
            };
            const isIncompleteReadyDrivingPatch =
              patch.status === 'ready' &&
              mergedRouteLeg.type === 'driving-auto' &&
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
              routeLegForFinalization.type === 'driving-auto' &&
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
                );
              }

              throw new Error(
                `Unable to save recalculated routes: ${primaryMessage}. Previous route legs were restored.`,
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
      routingVehicle,
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
