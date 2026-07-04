import Dexie, { type EntityTable } from 'dexie';
import type { Activity, Destination, RouteLeg } from '../domain/types';

export type TripDb = Dexie & {
  destinations: EntityTable<Destination, 'id'>;
  routeLegs: EntityTable<RouteLeg, 'id'>;
  activities: EntityTable<Activity, 'id'>;
};

export function createTripDb(name = 'world-tour-planner'): TripDb {
  const db = new Dexie(name) as TripDb;

  db.version(1).stores({
    destinations: 'id, name, countryRegion, status, priority, updatedAt',
    routeLegs: 'id, originDestinationId, targetDestinationId, type, updatedAt',
  });

  db.version(2).stores({
    destinations: 'id, order, name, countryRegion, status, priority, updatedAt',
    routeLegs: 'id, originDestinationId, targetDestinationId, type, status, routeKey, updatedAt',
  });

  db.version(3).stores({
    destinations: 'id, order, name, countryRegion, status, priority, updatedAt',
    routeLegs: 'id, originDestinationId, targetDestinationId, type, status, routeKey, updatedAt',
    activities: 'id, destinationId, order, title, status, priority, updatedAt',
  });

  return db;
}

export const tripDb = createTripDb();
