import { useCallback, useEffect, useMemo, useState } from 'react';
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

  const reload = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [loadedDestinations, loadedRouteLegs] = await Promise.all([
        repository.listDestinations(),
        repository.listRouteLegs(),
      ]);
      setDestinations(loadedDestinations);
      setRouteLegs(loadedRouteLegs);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load trip data');
    } finally {
      setIsLoading(false);
    }
  }, [repository]);

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
        setDestinations((current) => [...current, destination]);
        return destination;
      },

      async updateDestination(
        destinationId: string,
        patch: Partial<Omit<Destination, 'id' | 'createdAt' | 'updatedAt'>>,
      ) {
        const existing = destinations.find((destination) => destination.id === destinationId);
        if (!existing) return;
        const updated = patchDestination(existing, patch);
        await repository.saveDestination(updated);
        setDestinations((current) =>
          current.map((destination) => (destination.id === destinationId ? updated : destination)),
        );
      },

      async deleteDestination(destinationId: string) {
        await repository.deleteDestination(destinationId);
        setDestinations((current) =>
          current.filter((destination) => destination.id !== destinationId),
        );
        setRouteLegs((current) =>
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
        setRouteLegs((current) => [...current, leg]);
        return leg;
      },

      async deleteRouteLeg(routeLegId: string) {
        await repository.deleteRouteLeg(routeLegId);
        setRouteLegs((current) => current.filter((leg) => leg.id !== routeLegId));
      },

      reload,
    }),
    [destinations, reload, repository],
  );

  return {
    destinations,
    routeLegs,
    isLoading,
    error,
    ...actions,
  };
}
