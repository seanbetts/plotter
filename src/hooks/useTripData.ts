import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createDestination, updateDestination as patchDestination } from '../domain/destinations';
import { findBestDestinationInsertionIndex, reconcileRouteLegsForDestinations } from '../domain/routePlanner';
import { createRouteLeg, createStraightLineGeometry } from '../domain/routeLegs';
import type { Coordinates, Destination, DestinationLocation, RouteLeg, RouteLegType } from '../domain/types';
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
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const destinationsRef = useRef<Destination[]>([]);
  const routeLegsRef = useRef<RouteLeg[]>([]);
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

      replaceDestinations(loadedDestinations);
      replaceRouteLegs(loadedRouteLegs);
    } catch (caught) {
      if (!isCurrentReload()) return;

      setError(caught instanceof Error ? caught.message : 'Unable to load trip data');
    }

    if (!isCurrentReload()) return;

    setIsLoading(false);
  }, [isActiveGeneration, replaceDestinations, replaceRouteLegs, repository]);

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
      updateDestinations,
      updateRouteLegs,
    ],
  );

  return {
    destinations,
    routeLegs,
    isLoading,
    error,
    ...actions,
  };
}
