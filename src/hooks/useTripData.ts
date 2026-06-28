import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createDestination, updateDestination as patchDestination } from '../domain/destinations';
import { createRouteLeg } from '../domain/routeLegs';
import type { Coordinates, Destination, RouteLeg, RouteLegType } from '../domain/types';
import type { createTripRepository } from '../storage/tripRepository';

type TripRepository = ReturnType<typeof createTripRepository>;

type AddDestinationInput = {
  name: string;
  countryRegion?: string;
  coordinates: Coordinates;
};

export function useTripData(repository: TripRepository) {
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [routeLegs, setRouteLegs] = useState<RouteLeg[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const destinationsRef = useRef<Destination[]>([]);
  const routeLegsRef = useRef<RouteLeg[]>([]);
  const isMountedRef = useRef(false);
  const activeRepositoryTokenRef = useRef<object | null>(null);
  const reloadSequenceRef = useRef(0);
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

      return {
        async addDestination(input: AddDestinationInput) {
          const destination = createDestination(input);
          if (!isActiveAction()) return destination;

          await repository.saveDestination(destination);
          if (!isActiveAction()) return destination;

          updateDestinations((current) => [...current, destination]);
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

          updateDestinations((current) =>
            current.map((destination) => (destination.id === destinationId ? updated : destination)),
          );
        },

        async deleteDestination(destinationId: string) {
          if (!isActiveAction()) return;

          await repository.deleteDestination(destinationId);
          if (!isActiveAction()) return;

          updateDestinations((current) =>
            current.filter((destination) => destination.id !== destinationId),
          );
          updateRouteLegs((current) =>
            current.filter(
              (leg) =>
                leg.originDestinationId !== destinationId &&
                leg.targetDestinationId !== destinationId,
            ),
          );
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

        async deleteRouteLeg(routeLegId: string) {
          if (!isActiveAction()) return;

          await repository.deleteRouteLeg(routeLegId);
          if (!isActiveAction()) return;

          updateRouteLegs((current) => current.filter((leg) => leg.id !== routeLegId));
        },

        reload,
      };
    },
    [isActiveGeneration, reload, repository, repositoryToken, updateDestinations, updateRouteLegs],
  );

  return {
    destinations,
    routeLegs,
    isLoading,
    error,
    ...actions,
  };
}
