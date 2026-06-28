import type { Destination, RouteLeg } from '../domain/types';
import { createLegacyLocation } from '../domain/locations';
import type { TripDb } from './tripDb';

type LegacyRouteLeg = Omit<RouteLeg, 'type' | 'status'> & {
  type?: RouteLeg['type'] | 'driving' | 'ferry-shipping' | 'uncertain';
  status?: RouteLeg['status'];
};

function normalizeDestination(destination: Destination, index = 0): Destination {
  return {
    ...destination,
    countryRegion: destination.countryRegion ?? destination.location?.countryName ?? '',
    location:
      destination.location ??
      createLegacyLocation({
        name: destination.name,
        countryRegion: destination.countryRegion,
      }),
    order: Number.isFinite(destination.order) ? destination.order : index,
  };
}

function normalizeRouteLeg(routeLeg: LegacyRouteLeg): RouteLeg {
  const type = routeLeg.type === 'shipping-manual' || routeLeg.type === 'ferry-shipping' || routeLeg.type === 'uncertain'
    ? 'shipping-manual'
    : 'driving-auto';

  return {
    ...routeLeg,
    type,
    status: routeLeg.status ?? (type === 'shipping-manual' ? 'manual' : 'pending'),
    profile: routeLeg.profile ?? (type === 'driving-auto' ? 'driving-car' : undefined),
  };
}

export function createTripRepository(db: TripDb) {
  return {
    async listDestinations(): Promise<Destination[]> {
      const destinations = await db.destinations.toArray();

      return destinations
        .map((destination, index) => normalizeDestination(destination, index))
        .sort((left, right) => left.order - right.order || left.createdAt.localeCompare(right.createdAt));
    },

    async saveDestination(destination: Destination): Promise<void> {
      await db.destinations.put(destination);
    },

    async deleteDestination(destinationId: string): Promise<void> {
      await db.transaction('rw', db.destinations, db.routeLegs, async () => {
        await db.destinations.delete(destinationId);
        const attachedLegs = await db.routeLegs
          .where('originDestinationId')
          .equals(destinationId)
          .or('targetDestinationId')
          .equals(destinationId)
          .toArray();

        await db.routeLegs.bulkDelete(attachedLegs.map((leg) => leg.id));
      });
    },

    async listRouteLegs(): Promise<RouteLeg[]> {
      const routeLegs = await db.routeLegs.toArray();

      return routeLegs
        .map((routeLeg) => normalizeRouteLeg(routeLeg as LegacyRouteLeg))
        .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
    },

    async saveRouteLeg(routeLeg: RouteLeg): Promise<void> {
      await db.routeLegs.put(routeLeg);
    },

    async deleteRouteLeg(routeLegId: string): Promise<void> {
      await db.routeLegs.delete(routeLegId);
    },

    async replaceTripData(snapshot: {
      destinations: Destination[];
      routeLegs: RouteLeg[];
    }): Promise<void> {
      await db.transaction('rw', db.destinations, db.routeLegs, async () => {
        await db.destinations.clear();
        await db.routeLegs.clear();
        await db.destinations.bulkPut(snapshot.destinations.map((destination, index) => normalizeDestination(destination, index)));
        await db.routeLegs.bulkPut(snapshot.routeLegs);
      });
    },
  };
}
