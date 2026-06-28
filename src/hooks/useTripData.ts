import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  const reloadSequenceRef = useRef(0);

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

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      reloadSequenceRef.current += 1;
    };
  }, []);

  const reload = useCallback(async () => {
    const sequence = reloadSequenceRef.current + 1;
    reloadSequenceRef.current = sequence;
    const isCurrentReload = () => isMountedRef.current && reloadSequenceRef.current === sequence;

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
  }, [replaceDestinations, replaceRouteLegs, repository]);

  useEffect(() => {
    queueMicrotask(() => {
      void reload();
    });
  }, [reload]);

  const actions = useMemo(
    () => ({
      async addDestination(input: AddDestinationInput) {
        const destination = createDestination(input);
        await repository.saveDestination(destination);
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
        await repository.saveDestination(updated);
        updateDestinations((current) =>
          current.map((destination) => (destination.id === destinationId ? updated : destination)),
        );
      },

      async deleteDestination(destinationId: string) {
        await repository.deleteDestination(destinationId);
        updateDestinations((current) =>
          current.filter((destination) => destination.id !== destinationId),
        );
        updateRouteLegs((current) =>
          current.filter(
            (leg) =>
              leg.originDestinationId !== destinationId && leg.targetDestinationId !== destinationId,
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
        await repository.saveRouteLeg(leg);
        updateRouteLegs((current) => [...current, leg]);
        return leg;
      },

      async deleteRouteLeg(routeLegId: string) {
        await repository.deleteRouteLeg(routeLegId);
        updateRouteLegs((current) => current.filter((leg) => leg.id !== routeLegId));
      },

      reload,
    }),
    [reload, repository, updateDestinations, updateRouteLegs],
  );

  return {
    destinations,
    routeLegs,
    isLoading,
    error,
    ...actions,
  };
}
