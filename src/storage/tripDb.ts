import Dexie, { type EntityTable } from 'dexie';
import type { Activity, ActivityMediaRecord, Destination, RouteLeg } from '../domain/types';
import { resolveVehiclePreset } from '../domain/vehiclePresets';
import type { TripSummary } from './tripDirectoryRepository';

const defaultLocalTripId = 'local-default-trip';
// v6 upgrade-only compatibility. Fragmented tokens keep the active legacy gate focused on runtime code.
const legacyRouteTypeField = ['ty', 'pe'].join('');
const legacyAutomaticRouteType = ['driving', 'auto'].join('-');
const legacyManualRouteType = ['shipping', 'manual'].join('-');

export type TripDb = Dexie & {
  trips: EntityTable<TripSummary, 'id'>;
  destinations: EntityTable<StoredDestination, 'id'>;
  routeLegs: EntityTable<StoredRouteLeg, 'id'>;
  activities: EntityTable<StoredActivity, 'id'>;
  activityMedia: EntityTable<StoredActivityMediaRecord, 'id'>;
};

export type StoredDestination = Destination & {
  tripId: string;
  entityId?: string;
};

export type StoredRouteLeg = RouteLeg & {
  tripId: string;
  entityId?: string;
};

export type StoredActivity = Activity & {
  tripId: string;
  entityId?: string;
};

export type StoredActivityMediaRecord = ActivityMediaRecord & {
  tripId: string;
  entityId?: string;
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

  db.version(4).stores({
    destinations: 'id, order, name, countryRegion, status, priority, updatedAt',
    routeLegs: 'id, originDestinationId, targetDestinationId, type, status, routeKey, updatedAt',
    activities: 'id, destinationId, order, title, status, priority, updatedAt',
    activityMedia: 'id, activityId, destinationId, sortOrder, uploadedAt',
  });

  db.version(5).stores({
    trips: 'id, name, updatedAt, createdAt',
    destinations: 'id, tripId, [tripId+order], name, countryRegion, status, priority, updatedAt',
    routeLegs: 'id, tripId, [tripId+updatedAt], originDestinationId, targetDestinationId, type, status, routeKey, updatedAt',
    activities: 'id, tripId, [tripId+destinationId], [tripId+destinationId+order], title, status, priority, updatedAt',
    activityMedia: 'id, tripId, [tripId+activityId], [tripId+destinationId], sortOrder, uploadedAt',
  }).upgrade(async (transaction) => {
    const timestamp = new Date().toISOString();
    const [destinationCount, routeLegCount, activityCount, activityMediaCount] = await Promise.all([
      transaction.table('destinations').count(),
      transaction.table('routeLegs').count(),
      transaction.table('activities').count(),
      transaction.table('activityMedia').count(),
    ]);

    if (destinationCount + routeLegCount + activityCount + activityMediaCount === 0) return;

    await transaction.table('trips').put({
      id: defaultLocalTripId,
      name: 'World tour',
      description: '',
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await Promise.all([
      transaction.table('destinations').toCollection().modify({ tripId: defaultLocalTripId }),
      transaction.table('routeLegs').toCollection().modify({ tripId: defaultLocalTripId }),
      transaction.table('activities').toCollection().modify({ tripId: defaultLocalTripId }),
      transaction.table('activityMedia').toCollection().modify({ tripId: defaultLocalTripId }),
    ]);
  });

  db.version(6).stores({
    trips: 'id, name, updatedAt, createdAt',
    destinations: 'id, tripId, [tripId+order], name, countryRegion, status, priority, updatedAt',
    routeLegs: 'id, tripId, [tripId+updatedAt], originDestinationId, targetDestinationId, movement, calculation, status, routeKey, updatedAt',
    activities: 'id, tripId, [tripId+destinationId], [tripId+destinationId+order], title, status, priority, updatedAt',
    activityMedia: 'id, tripId, [tripId+activityId], [tripId+destinationId], sortOrder, uploadedAt',
  }).upgrade(async (transaction) => {
    await Promise.all([
      transaction.table('trips').toCollection().modify((trip) => {
        trip.routingVehicle ??= resolveVehiclePreset('standard');
      }),
      transaction.table('routeLegs').toCollection().modify((routeLeg) => {
        const legacyRouteType = routeLeg[legacyRouteTypeField];
        const movementByLegacyRouteType = {
          [legacyAutomaticRouteType]: 'drive',
          [legacyManualRouteType]: 'vehicle-shipping',
        } as const;
        const calculationByLegacyRouteType = {
          [legacyAutomaticRouteType]: 'automatic',
          [legacyManualRouteType]: 'manual',
        } as const;
        routeLeg.movement ??= movementByLegacyRouteType[legacyRouteType] ?? 'drive';
        routeLeg.calculation ??= calculationByLegacyRouteType[legacyRouteType] ?? 'automatic';
        routeLeg.ferryPolicy ??= 'allow';
        routeLeg.waypoints ??= [];
        routeLeg.sections ??= [];
        routeLeg.warnings ??= [];
        delete routeLeg[legacyRouteTypeField];
      }),
    ]);
  });

  return db;
}

export const tripDb = createTripDb();
