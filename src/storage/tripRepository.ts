import type { Destination, RouteLeg } from '../domain/types';
import type { TripDb } from './tripDb';

export function createTripRepository(db: TripDb) {
  return {
    async listDestinations(): Promise<Destination[]> {
      return db.destinations.orderBy('updatedAt').toArray();
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
      return db.routeLegs.orderBy('updatedAt').toArray();
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
        await db.destinations.bulkPut(snapshot.destinations);
        await db.routeLegs.bulkPut(snapshot.routeLegs);
      });
    },
  };
}
