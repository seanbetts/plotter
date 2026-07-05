import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createActivity as createActivityModel } from '../domain/activities';
import { createDestination, updateDestination as patchDestination } from '../domain/destinations';
import { findBestDestinationInsertionIndex, reconcileRouteLegsForDestinations } from '../domain/routePlanner';
import { createRouteLeg, createStraightLineGeometry } from '../domain/routeLegs';
import type { Activity, Coordinates, Destination, DestinationLocation, RouteLeg, RouteLegType } from '../domain/types';
import type { TripRepository } from '../storage/tripRepository';


type AddDestinationInput = {
  name: string;
  countryRegion?: string;
  location?: DestinationLocation;
  coordinates: Coordinates;
};

type CalculatedRoute = Pick<
  RouteLeg,
  'distanceKm' | 'travelTimeHours' | 'geometry' | 'provider' | 'profile'
>;

type CalculateRouteInput = {
  origin: Coordinates;
  target: Coordinates;
  profile: 'driving-car';
};

type UseTripDataOptions = {
  calculateRoute?: (input: CalculateRouteInput) => Promise<CalculatedRoute>;
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
  const calculateRoute = options.calculateRoute;
  const repositoryToken = useMemo(() => ({ repository }), [repository]);

  const replaceDestinations = useCallback((nextDestinations: Destination[]) => {
    destinationsRef.current = nextDestinations;
    setDestinations(nextDestinations);
  }, []);

  const updateDestinations = useCallback((updater: (current: Destination[]) => Destination[]) => {
    const nextDestinations = updater(destinationsRef.current);
    destinationsRef.current = nextDestinations;
    setDestinations(nextDestinations);
    return nextDestinations;
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
      const calculateDrivingRouteLegs = async (
        nextDestinations: Destination[],
        nextRouteLegs: RouteLeg[],
      ) => {
        if (!calculateRoute) return nextRouteLegs;

        const destinationsById = new Map(
          nextDestinations.map((destination) => [destination.id, destination]),
        );
        const calculatedRouteLegs: RouteLeg[] = [];

        for (const leg of nextRouteLegs) {
          const origin = destinationsById.get(leg.originDestinationId);
          const target = destinationsById.get(leg.targetDestinationId);

          if (
            leg.type !== 'driving-auto' ||
            leg.status === 'ready' ||
            !origin ||
            !target
          ) {
            calculatedRouteLegs.push(leg);
            continue;
          }

          try {
            const route = await calculateRoute({
              origin: origin.coordinates,
              target: target.coordinates,
              profile: 'driving-car',
            });
            calculatedRouteLegs.push({
              ...leg,
              ...route,
              status: 'ready',
              error: undefined,
              calculatedAt: createTimestamp(),
              updatedAt: createTimestamp(),
            });
          } catch (caught) {
            calculatedRouteLegs.push({
              ...leg,
              status: 'failed',
              error: caught instanceof Error ? caught.message : 'Route calculation failed',
              updatedAt: createTimestamp(),
            });
          }
        }

        return calculatedRouteLegs;
      };

      const finalizeRouteLeg = async (routeLeg: RouteLeg, nextDestinations: Destination[]) => {
        const destinationsById = new Map(
          nextDestinations.map((destination) => [destination.id, destination]),
        );
        const origin = destinationsById.get(routeLeg.originDestinationId);
        const target = destinationsById.get(routeLeg.targetDestinationId);

        if (!origin || !target) return routeLeg;

        if (routeLeg.type === 'shipping-manual') {
          return {
            ...routeLeg,
            status: 'manual',
            geometry: createStraightLineGeometry(origin.coordinates, target.coordinates),
            distanceKm: undefined,
            travelTimeHours: undefined,
            provider: undefined,
            profile: undefined,
            routeKey: undefined,
            calculatedAt: undefined,
            error: undefined,
            updatedAt: createTimestamp(),
          } satisfies RouteLeg;
        }

        if (
          routeLeg.type === 'driving-auto' &&
          routeLeg.status === 'ready' &&
          routeLeg.geometry &&
          routeLeg.distanceKm !== undefined &&
          routeLeg.travelTimeHours !== undefined &&
          routeLeg.provider &&
          routeLeg.profile &&
          routeLeg.routeKey &&
          routeLeg.calculatedAt
        ) {
          return {
            ...routeLeg,
            error: undefined,
            updatedAt: createTimestamp(),
          } satisfies RouteLeg;
        }

        const [calculatedRouteLeg] = await calculateDrivingRouteLegs(nextDestinations, [
          {
            ...routeLeg,
            status: 'pending',
            profile: routeLeg.profile ?? 'driving-car',
            error: undefined,
            updatedAt: createTimestamp(),
          },
        ]);
        return calculatedRouteLeg;
      };

      const reconcileAndSaveRouteLegs = async (
        nextDestinations: Destination[],
        currentRouteLegs: RouteLeg[],
        options: { publishPendingRouteLegs?: boolean } = {},
      ) => {
        const reconciliation = reconcileRouteLegsForDestinations(
          nextDestinations,
          currentRouteLegs,
        );

        if (options.publishPendingRouteLegs && isActiveAction()) {
          replaceRouteLegs(reconciliation.routeLegs);
        }

        const nextRouteLegs = await calculateDrivingRouteLegs(
          nextDestinations,
          reconciliation.routeLegs,
        );

        await Promise.all([
          ...reconciliation.removedRouteLegIds.map((routeLegId) =>
            repository.deleteRouteLeg(routeLegId),
          ),
          ...nextRouteLegs.map((routeLeg) => repository.saveRouteLeg(routeLeg)),
        ]);

        if (!isActiveAction()) return currentRouteLegs;

        replaceRouteLegs(nextRouteLegs);
        return nextRouteLegs;
      };

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
          await reconcileAndSaveRouteLegs(orderedDestinations, routeLegsRef.current);
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

          await repository.saveDestination(updated);
          if (!isActiveAction()) return;

          const nextDestinations = updateDestinations((current) =>
            current.map((destination) => (destination.id === destinationId ? updated : destination)),
          );
          await reconcileAndSaveRouteLegs(nextDestinations, routeLegsRef.current);
        },

        async deleteDestination(destinationId: string) {
          if (!isActiveAction()) return;

          await repository.deleteDestination(destinationId);
          if (!isActiveAction()) return;

          const nextDestinations = updateDestinations((current) =>
            current.filter((destination) => destination.id !== destinationId),
          );
          updateActivitiesByDestinationId((current) => {
            const remaining = { ...current };
            delete remaining[destinationId];
            return remaining;
          });
          const remainingRouteLegs = updateRouteLegs((current) =>
            current.filter(
              (leg) =>
                leg.originDestinationId !== destinationId &&
                leg.targetDestinationId !== destinationId,
            ),
          );
          await reconcileAndSaveRouteLegs(nextDestinations, remainingRouteLegs);
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

          replaceDestinations(orderedDestinations);
          const routeLegReconciliation = reconcileAndSaveRouteLegs(
            orderedDestinations,
            routeLegsRef.current,
            { publishPendingRouteLegs: true },
          );

          const saveDestinations = Promise.all(
            orderedDestinations.map((destination) => repository.saveDestination(destination)),
          );
          await Promise.all([saveDestinations, routeLegReconciliation]);
        },

        async addRouteLeg(input: {
          originDestinationId: string;
          targetDestinationId: string;
          type: RouteLegType;
          notes?: string;
        }) {
          const leg = createRouteLeg(input);
          if (!isActiveAction()) return leg;

          await repository.saveRouteLeg(leg);
          if (!isActiveAction()) return leg;

          updateRouteLegs((current) => [...current, leg]);
          return leg;
        },

        async updateRouteLeg(
          routeLegId: string,
          patch: Partial<Omit<RouteLeg, 'id' | 'createdAt' | 'updatedAt'>>,
        ) {
          const existing = routeLegsRef.current.find((routeLeg) => routeLeg.id === routeLegId);
          if (!existing) return;

          const updated = await finalizeRouteLeg(
            {
              ...existing,
              ...patch,
              updatedAt: createTimestamp(),
            },
            destinationsRef.current,
          );
          if (!isActiveAction()) return;

          await repository.saveRouteLeg(updated);
          if (!isActiveAction()) return;

          updateRouteLegs((current) =>
            current.map((routeLeg) => (routeLeg.id === routeLegId ? updated : routeLeg)),
          );
        },

        async deleteRouteLeg(routeLegId: string) {
          if (!isActiveAction()) return;

          await repository.deleteRouteLeg(routeLegId);
          if (!isActiveAction()) return;

          updateRouteLegs((current) => current.filter((leg) => leg.id !== routeLegId));
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

        reload,
      };
    },
    [
      calculateRoute,
      isActiveGeneration,
      reload,
      replaceDestinations,
      replaceRouteLegs,
      repository,
      repositoryToken,
      updateActivitiesByDestinationId,
      updateDestinations,
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
