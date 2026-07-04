# Personal Multi-Trip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add personal multi-trip storage and selection with create, rename, delete, remembered selection, and trip-scoped itinerary data.

**Architecture:** Add an explicit trip directory repository for trip metadata and lifecycle operations. Keep `TripRepository` scoped to one trip by passing a trip id into Supabase and local repository constructors, then let the app shell own the active trip and rebuild trip data state when it changes.

**Tech Stack:** React 19, TypeScript, Vitest/Testing Library, Playwright, Dexie IndexedDB, Supabase Postgres + Storage, existing CSS in `src/styles.css`.

---

## File Structure

- Create `src/storage/tripDirectoryRepository.ts`: shared trip metadata types plus Supabase and local directory implementations.
- Modify `src/storage/tripDb.ts`: add `trips`, trip-scoped destination records, route-leg records, activities, and activity media records.
- Modify `src/storage/tripRepository.ts`: accept a trip id and filter all local destination, route-leg, activity, destination-media, rollup, and activity-media work by trip.
- Modify `src/storage/tripRepository.test.ts`: prove local trip isolation and local directory lifecycle behavior.
- Modify `src/storage/supabaseTripRepository.ts`: require an explicit trip id and remove hidden trip discovery.
- Modify `src/storage/supabaseTripRepository.test.ts`: cover explicit trip ids and remove planning-count selection expectations.
- Modify `src/storage/appRepository.ts`: replace single-repository bootstrap with app storage bootstrap that returns a directory plus a trip-repository factory.
- Modify `src/storage/appRepository.test.ts`: cover app storage bootstrap and e2e-local storage.
- Create `src/hooks/useTripWorkspace.ts`: load trips, restore selection, create repositories, and expose select/create/rename/delete actions.
- Create `src/hooks/useTripWorkspace.test.tsx`: cover boot flow and trip lifecycle state.
- Create `src/components/TripSelector.tsx`: top-left dropdown for selecting, creating, renaming, and deleting trips.
- Create `src/components/TripSelector.test.tsx`: component interaction coverage.
- Modify `src/App.tsx`: use trip workspace state, render selector above the itinerary panel, and clear transient trip UI on switch.
- Modify `src/App.test.tsx`: update storage mocks and add trip switching behavior tests.
- Modify `src/styles.css`: style the trip selector and left-side workspace stack.
- Modify `tests/world-tour.spec.ts`: add an e2e smoke test for creating and switching trips under `VITE_TRIP_STORAGE=e2e-local`.

---

### Task 1: Add Trip Directory Repository Contracts

**Files:**
- Create: `src/storage/tripDirectoryRepository.ts`
- Test: `src/storage/supabaseTripRepository.test.ts`

- [ ] **Step 1: Write failing Supabase directory tests**

Add this import block to `src/storage/supabaseTripRepository.test.ts`:

```ts
import { createSupabaseTripDirectoryRepository } from './tripDirectoryRepository';
```

Add these tests near the storage repository tests:

```ts
describe('supabase trip directory repository', () => {
  it('lists trips ordered by update time', async () => {
    const rows = [
      {
        id: crypto.randomUUID(),
        owner_user_id: crypto.randomUUID(),
        name: 'Japan',
        description: 'Cherry blossom route',
        created_at: '2026-07-01T12:00:00.000Z',
        updated_at: '2026-07-02T12:00:00.000Z',
      },
    ];
    const orderCreatedAt = vi.fn(async () => ({ data: rows, error: null }));
    const orderUpdatedAt = vi.fn(() => ({ order: orderCreatedAt }));
    const supabase = {
      from: vi.fn((tableName: string) => {
        expect(tableName).toBe('trips');
        return {
          select: vi.fn(() => ({
            order: orderUpdatedAt,
          })),
        };
      }),
    };
    const repository = createSupabaseTripDirectoryRepository(supabase as never);

    await expect(repository.listTrips()).resolves.toEqual([
      {
        id: rows[0].id,
        name: 'Japan',
        description: 'Cherry blossom route',
        createdAt: '2026-07-01T12:00:00.000Z',
        updatedAt: '2026-07-02T12:00:00.000Z',
      },
    ]);
    expect(orderUpdatedAt).toHaveBeenCalledWith('updated_at', { ascending: false });
    expect(orderCreatedAt).toHaveBeenCalledWith('created_at', { ascending: false });
  });

  it('creates a trip for the current Supabase user', async () => {
    const userId = crypto.randomUUID();
    const row = {
      id: crypto.randomUUID(),
      owner_user_id: userId,
      name: 'South America',
      description: '',
      created_at: '2026-07-03T12:00:00.000Z',
      updated_at: '2026-07-03T12:00:00.000Z',
    };
    const insert = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn(async () => ({ data: row, error: null })),
      })),
    }));
    const supabase = {
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: userId } }, error: null })),
      },
      from: vi.fn(() => ({ insert })),
    };
    const repository = createSupabaseTripDirectoryRepository(supabase as never);

    await expect(repository.createTrip({ name: 'South America' })).resolves.toMatchObject({
      id: row.id,
      name: 'South America',
    });
    expect(insert).toHaveBeenCalledWith({
      owner_user_id: userId,
      name: 'South America',
      description: '',
    });
  });

  it('renames a trip', async () => {
    const tripId = crypto.randomUUID();
    const row = {
      id: tripId,
      owner_user_id: crypto.randomUUID(),
      name: 'Renamed trip',
      description: 'Updated',
      created_at: '2026-07-01T12:00:00.000Z',
      updated_at: '2026-07-03T12:00:00.000Z',
    };
    const eq = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn(async () => ({ data: row, error: null })),
      })),
    }));
    const update = vi.fn(() => ({ eq }));
    const supabase = {
      from: vi.fn(() => ({ update })),
    };
    const repository = createSupabaseTripDirectoryRepository(supabase as never);

    await expect(repository.updateTrip(tripId, {
      name: 'Renamed trip',
      description: 'Updated',
    })).resolves.toMatchObject({
      id: tripId,
      name: 'Renamed trip',
      description: 'Updated',
    });
    expect(update).toHaveBeenCalledWith({ name: 'Renamed trip', description: 'Updated' });
    expect(eq).toHaveBeenCalledWith('id', tripId);
  });

  it('removes storage objects before deleting a trip row', async () => {
    const tripId = crypto.randomUUID();
    const remove = vi.fn(async () => ({ data: [], error: null }));
    const deleteEq = vi.fn(async () => ({ error: null }));
    const supabase = {
      storage: {
        from: vi.fn(() => ({ remove })),
      },
      from: vi.fn((tableName: string) => {
        if (tableName === 'media_assets') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(async () => ({
                data: [
                  { bucket_id: 'trip-media', object_path: `${tripId}/stop/a.webp` },
                  { bucket_id: 'trip-media', object_path: `${tripId}/stop/b.webp` },
                ],
                error: null,
              })),
            })),
          };
        }

        if (tableName === 'trips') {
          return {
            delete: vi.fn(() => ({
              eq: deleteEq,
            })),
          };
        }

        throw new Error(`Unexpected table ${tableName}`);
      }),
    };
    const repository = createSupabaseTripDirectoryRepository(supabase as never);

    await repository.deleteTrip(tripId);

    expect(supabase.storage.from).toHaveBeenCalledWith('trip-media');
    expect(remove).toHaveBeenCalledWith([`${tripId}/stop/a.webp`, `${tripId}/stop/b.webp`]);
    expect(deleteEq).toHaveBeenCalledWith('id', tripId);
  });

  it('does not delete the trip row when storage cleanup fails', async () => {
    const tripId = crypto.randomUUID();
    const deleteTrip = vi.fn();
    const supabase = {
      storage: {
        from: vi.fn(() => ({
          remove: vi.fn(async () => ({
            data: null,
            error: { message: 'Storage remove failed' },
          })),
        })),
      },
      from: vi.fn((tableName: string) => {
        if (tableName === 'media_assets') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(async () => ({
                data: [{ bucket_id: 'trip-media', object_path: `${tripId}/stop/a.webp` }],
                error: null,
              })),
            })),
          };
        }

        if (tableName === 'trips') {
          return { delete: deleteTrip };
        }

        throw new Error(`Unexpected table ${tableName}`);
      }),
    };
    const repository = createSupabaseTripDirectoryRepository(supabase as never);

    await expect(repository.deleteTrip(tripId)).rejects.toThrow('Storage remove failed');
    expect(deleteTrip).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```bash
npm test -- src/storage/supabaseTripRepository.test.ts
```

Expected: FAIL because `src/storage/tripDirectoryRepository.ts` does not exist.

- [ ] **Step 3: Create the shared directory repository**

Create `src/storage/tripDirectoryRepository.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { TripDb } from './tripDb';

export type TripSummary = {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
};

export type TripDirectoryRepository = {
  listTrips(): Promise<TripSummary[]>;
  createTrip(input: { name: string }): Promise<TripSummary>;
  updateTrip(tripId: string, patch: { name?: string; description?: string }): Promise<TripSummary>;
  deleteTrip(tripId: string): Promise<void>;
};

type SupabaseTripRow = {
  id: string;
  owner_user_id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
};

type SupabaseMediaReferenceRow = {
  bucket_id: string;
  object_path: string;
};

type SupabaseResponse<T> = {
  data: T | null;
  error: { message: string } | null;
};

type SupabaseWriteResponse = {
  error: { message: string } | null;
};

function assertNoSupabaseError<T>(response: SupabaseResponse<T>, fallbackMessage: string): T {
  if (response.error) {
    throw new Error(response.error.message || fallbackMessage);
  }

  if (response.data === null) {
    throw new Error(fallbackMessage);
  }

  return response.data;
}

function assertSupabaseWriteSucceeded(response: SupabaseWriteResponse, fallbackMessage: string) {
  if (response.error) {
    throw new Error(response.error.message || fallbackMessage);
  }
}

function tripFromSupabaseRow(row: SupabaseTripRow): TripSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function createTimestamp() {
  return new Date().toISOString();
}

export function createSupabaseTripDirectoryRepository(
  supabase: SupabaseClient,
): TripDirectoryRepository {
  return {
    async listTrips() {
      const rows = assertNoSupabaseError<SupabaseTripRow[]>(
        await supabase
          .from('trips')
          .select('id, owner_user_id, name, description, created_at, updated_at')
          .order('updated_at', { ascending: false })
          .order('created_at', { ascending: false }),
        'Unable to load trips.',
      );

      return rows.map(tripFromSupabaseRow);
    },

    async createTrip(input) {
      const userResponse = await supabase.auth.getUser();
      const user = userResponse.data.user;
      if (userResponse.error || !user) {
        throw new Error(userResponse.error?.message || 'Sign in before creating a trip.');
      }

      const row = assertNoSupabaseError<SupabaseTripRow>(
        await supabase
          .from('trips')
          .insert({
            owner_user_id: user.id,
            name: input.name,
            description: '',
          })
          .select('id, owner_user_id, name, description, created_at, updated_at')
          .single(),
        'Unable to create trip.',
      );

      return tripFromSupabaseRow(row);
    },

    async updateTrip(tripId, patch) {
      const row = assertNoSupabaseError<SupabaseTripRow>(
        await supabase
          .from('trips')
          .update(patch)
          .eq('id', tripId)
          .select('id, owner_user_id, name, description, created_at, updated_at')
          .single(),
        'Unable to update trip.',
      );

      return tripFromSupabaseRow(row);
    },

    async deleteTrip(tripId) {
      const mediaRows = assertNoSupabaseError<SupabaseMediaReferenceRow[]>(
        await supabase
          .from('media_assets')
          .select('bucket_id, object_path')
          .eq('trip_id', tripId),
        'Unable to load trip media before deletion.',
      );
      const pathsByBucket = new Map<string, string[]>();

      for (const row of mediaRows) {
        pathsByBucket.set(row.bucket_id, [
          ...(pathsByBucket.get(row.bucket_id) ?? []),
          row.object_path,
        ]);
      }

      for (const [bucketId, objectPaths] of pathsByBucket) {
        assertSupabaseWriteSucceeded(
          await supabase.storage.from(bucketId).remove(objectPaths),
          'Unable to remove trip media.',
        );
      }

      assertSupabaseWriteSucceeded(
        await supabase.from('trips').delete().eq('id', tripId),
        'Unable to delete trip.',
      );
    },
  };
}

export function createLocalTripDirectoryRepository(db: TripDb): TripDirectoryRepository {
  return {
    async listTrips() {
      return (await db.trips.toArray()).sort(
        (left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) ||
          right.createdAt.localeCompare(left.createdAt),
      );
    },

    async createTrip(input) {
      const timestamp = createTimestamp();
      const trip: TripSummary = {
        id: crypto.randomUUID(),
        name: input.name,
        description: '',
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      await db.trips.put(trip);
      return trip;
    },

    async updateTrip(tripId, patch) {
      const existing = await db.trips.get(tripId);
      if (!existing) {
        throw new Error('Trip not found.');
      }

      const updated: TripSummary = {
        ...existing,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        updatedAt: createTimestamp(),
      };

      await db.trips.put(updated);
      return updated;
    },

    async deleteTrip(tripId) {
      await db.transaction('rw', db.trips, db.destinations, db.routeLegs, db.activities, db.activityMedia, async () => {
        await db.trips.delete(tripId);
        await db.destinations.where('tripId').equals(tripId).delete();
        await db.routeLegs.where('tripId').equals(tripId).delete();
        await db.activities.where('tripId').equals(tripId).delete();
        await db.activityMedia.where('tripId').equals(tripId).delete();
      });
    },
  };
}
```

- [ ] **Step 4: Run the focused tests and verify pass**

Run:

```bash
npm test -- src/storage/supabaseTripRepository.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/storage/tripDirectoryRepository.ts src/storage/supabaseTripRepository.test.ts
git commit -m "feat: add trip directory repository"
```

---

### Task 2: Make Supabase Trip Repository Explicitly Trip-Scoped

**Files:**
- Modify: `src/storage/supabaseTripRepository.ts`
- Modify: `src/storage/supabaseTripRepository.test.ts`

- [ ] **Step 1: Replace the hidden trip-selection test**

Remove the test named `uses the visible trip with planning data instead of a newer empty anonymous trip` from `src/storage/supabaseTripRepository.test.ts`.

Add this test in its place:

```ts
it('loads only destinations for the explicit trip id', async () => {
  const tripId = crypto.randomUUID();
  const destination = createDestination({
    name: 'Kyoto',
    coordinates: { lat: 35.6764, lng: 139.65 },
  });
  const destinationRow = destinationToSupabaseRow(destination, tripId);
  const eq = vi.fn(() => ({
    order: vi.fn(() => ({
      order: vi.fn(async () => ({ data: [destinationRow], error: null })),
    })),
  }));
  const supabase = {
    from: vi.fn((tableName: string) => {
      if (tableName !== 'destinations') {
        throw new Error(`Unexpected table ${tableName}`);
      }

      return {
        select: vi.fn(() => ({ eq })),
      };
    }),
  };
  const repository = createSupabaseTripRepository(supabase as never, tripId);

  await expect(repository.listDestinations()).resolves.toEqual([destination]);
  expect(eq).toHaveBeenCalledWith('trip_id', tripId);
  expect(supabase.from).not.toHaveBeenCalledWith('trips');
});
```

Update existing tests that construct `createSupabaseTripRepository(supabase as never)` so they pass the `tripId` already declared in each test:

```ts
const repository = createSupabaseTripRepository(supabase as never, tripId);
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```bash
npm test -- src/storage/supabaseTripRepository.test.ts
```

Expected: FAIL because `createSupabaseTripRepository` still accepts only the Supabase client and still queries `trips`.

- [ ] **Step 3: Refactor the Supabase trip repository constructor**

Modify the constructor and remove `SupabaseTripRow`, `SupabaseTripReferenceRow`, `chooseTripWithPlanningData`, and `getActiveTripId` from `src/storage/supabaseTripRepository.ts`.

Use this constructor shape:

```ts
export function createSupabaseTripRepository(
  supabase: SupabaseClient,
  tripId: string,
): TripRepository {
```

Inside every repository method, remove:

```ts
const tripId = await getActiveTripId();
```

and use the constructor `tripId` directly. For example:

```ts
async listDestinations() {
  const rows = assertNoSupabaseError<SupabaseDestinationRow[]>(
    await supabase
      .from('destinations')
      .select('*')
      .eq('trip_id', tripId)
      .order('stop_order', { ascending: true })
      .order('created_at', { ascending: true }),
    'Unable to load destinations.',
  );

  return rows.map(destinationFromSupabaseRow);
},
```

`uploadDestinationMedia` should still call `supabase.auth.getUser()` for `uploaded_by`, but it should not query or create trips.

- [ ] **Step 4: Run the focused tests**

Run:

```bash
npm test -- src/storage/supabaseTripRepository.test.ts
```

Expected: PASS. `npm run build` is intentionally run after app storage bootstrap is updated in Task 4 because the old app bootstrap still calls the Supabase trip repository without a trip id at this point.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/storage/supabaseTripRepository.ts src/storage/supabaseTripRepository.test.ts
git commit -m "refactor: scope supabase trip repository by trip id"
```

---

### Task 3: Add Trip-Scoped Local Storage

**Files:**
- Modify: `src/storage/tripDb.ts`
- Modify: `src/storage/tripRepository.ts`
- Modify: `src/storage/tripRepository.test.ts`

- [ ] **Step 1: Write failing local isolation tests**

In `src/storage/tripRepository.test.ts`, add the directory import:

```ts
import { createLocalTripDirectoryRepository } from './tripDirectoryRepository';
```

Change the helper to accept a trip id:

```ts
function createTestRepository(tripId = 'local-default-trip') {
  const name = `world-tour-test-${crypto.randomUUID()}`;
  const db = createTripDb(name);
  testDatabases.push({ db, name });

  return createTripRepository(db, tripId);
}
```

Add these tests:

```ts
it('keeps local destinations isolated by trip id', async () => {
  const name = `world-tour-test-${crypto.randomUUID()}`;
  const db = createTripDb(name);
  testDatabases.push({ db, name });
  const firstTrip = createTripRepository(db, 'trip-one');
  const secondTrip = createTripRepository(db, 'trip-two');
  const firstDestination = createDestination({
    name: 'Lisbon',
    coordinates: { lat: 38.7223, lng: -9.1393 },
  });
  const secondDestination = createDestination({
    name: 'Seoul',
    coordinates: { lat: 37.5665, lng: 126.978 },
  });

  await firstTrip.saveDestination(firstDestination);
  await secondTrip.saveDestination(secondDestination);

  expect((await firstTrip.listDestinations()).map((destination) => destination.name)).toEqual(['Lisbon']);
  expect((await secondTrip.listDestinations()).map((destination) => destination.name)).toEqual(['Seoul']);
});

it('creates, renames, lists, and deletes local trips', async () => {
  const name = `world-tour-test-${crypto.randomUUID()}`;
  const db = createTripDb(name);
  testDatabases.push({ db, name });
  const directory = createLocalTripDirectoryRepository(db);

  const trip = await directory.createTrip({ name: 'Alps' });
  await expect(directory.listTrips()).resolves.toEqual([trip]);

  const renamed = await directory.updateTrip(trip.id, { name: 'Alps winter' });
  expect(renamed.name).toBe('Alps winter');

  await directory.deleteTrip(trip.id);
  await expect(directory.listTrips()).resolves.toEqual([]);
});

it('deletes local trip contents when deleting a trip', async () => {
  const name = `world-tour-test-${crypto.randomUUID()}`;
  const db = createTripDb(name);
  testDatabases.push({ db, name });
  const directory = createLocalTripDirectoryRepository(db);
  const trip = await directory.createTrip({ name: 'Atlas' });
  const repository = createTripRepository(db, trip.id);
  const destination = createDestination({
    name: 'Marrakesh',
    coordinates: { lat: 31.6295, lng: -7.9811 },
  });

  await repository.saveDestination(destination);
  await directory.deleteTrip(trip.id);

  await expect(repository.listDestinations()).resolves.toEqual([]);
});
```

- [ ] **Step 2: Run local storage tests and verify failure**

Run:

```bash
npm test -- src/storage/tripRepository.test.ts
```

Expected: FAIL because `TripDb` has no `trips` table and destinations, route legs, activities, and activity media are not trip-scoped.

- [ ] **Step 3: Extend the Dexie schema**

Modify `src/storage/tripDb.ts`:

```ts
import Dexie, { type EntityTable } from 'dexie';
import type { Activity, ActivityMediaRecord, Destination, RouteLeg } from '../domain/types';
import type { TripSummary } from './tripDirectoryRepository';

export type StoredDestination = Destination & {
  tripId: string;
};

export type StoredRouteLeg = RouteLeg & {
  tripId: string;
};

export type StoredActivity = Activity & {
  tripId: string;
};

export type StoredActivityMediaRecord = ActivityMediaRecord & {
  tripId: string;
};

export type TripDb = Dexie & {
  trips: EntityTable<TripSummary, 'id'>;
  destinations: EntityTable<StoredDestination, 'id'>;
  routeLegs: EntityTable<StoredRouteLeg, 'id'>;
  activities: EntityTable<StoredActivity, 'id'>;
  activityMedia: EntityTable<StoredActivityMediaRecord, 'id'>;
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
  });

  return db;
}

export const tripDb = createTripDb();
```

- [ ] **Step 4: Scope local repository operations by trip id**

Modify the local repository signature in `src/storage/tripRepository.ts`:

```ts
const defaultLocalTripId = 'local-default-trip';

export function createTripRepository(db: TripDb, tripId = defaultLocalTripId): TripRepository {
```

Use `tripId` for all local reads and writes:

```ts
const destinations = await db.destinations.where('tripId').equals(tripId).toArray();
```

```ts
await db.destinations.put({ ...destination, tripId });
```

```ts
const routeLegs = await db.routeLegs.where('tripId').equals(tripId).toArray();
```

```ts
await db.routeLegs.put({ ...routeLeg, tripId });
```

Scope activity reads and writes the same way:

```ts
const activities = await db.activities
  .where('[tripId+destinationId]')
  .equals([tripId, destinationId])
  .toArray();
```

```ts
await db.activities.put({ ...activity, tripId });
```

```ts
const activity = await db.activities.get(activityId);
if (!activity || activity.tripId !== tripId) {
  throw new Error('Activity not found.');
}
```

Scope activity media reads and writes by `tripId` as well:

```ts
const activityMedia = await db.activityMedia
  .where('[tripId+activityId]')
  .equals([tripId, activityId])
  .toArray();
```

```ts
await db.activityMedia.put({ ...mediaRecord, tripId });
```

For deletes, add trip filtering:

```ts
await db.destinations.where({ tripId, id: destinationId }).delete();
```

Dexie compound object filtering is not configured for `{ tripId, id }`, so use this safe two-step form instead:

```ts
const destination = await db.destinations.get(destinationId);
if (destination?.tripId === tripId) {
  await db.destinations.delete(destinationId);
}
```

Use the same guard for route-leg deletion:

```ts
const routeLeg = await db.routeLegs.get(routeLegId);
if (routeLeg?.tripId === tripId) {
  await db.routeLegs.delete(routeLegId);
}
```

In `deleteDestination`, only bulk-delete attached legs, activities, and activity media from this trip:

```ts
const attachedLegs = (await db.routeLegs.where('tripId').equals(tripId).toArray()).filter(
  (leg) =>
    leg.originDestinationId === destinationId ||
    leg.targetDestinationId === destinationId,
);
const attachedActivities = await db.activities
  .where('[tripId+destinationId]')
  .equals([tripId, destinationId])
  .toArray();
const attachedActivityMedia = await db.activityMedia
  .where('[tripId+destinationId]')
  .equals([tripId, destinationId])
  .toArray();
```

In `replaceTripData`, clear only the selected trip:

```ts
const existingDestinations = await db.destinations.where('tripId').equals(tripId).toArray();
const existingRouteLegs = await db.routeLegs.where('tripId').equals(tripId).toArray();
const existingActivities = await db.activities.where('tripId').equals(tripId).toArray();
const existingActivityMedia = await db.activityMedia.where('tripId').equals(tripId).toArray();
await db.destinations.bulkDelete(existingDestinations.map((destination) => destination.id));
await db.routeLegs.bulkDelete(existingRouteLegs.map((routeLeg) => routeLeg.id));
await db.activities.bulkDelete(existingActivities.map((activity) => activity.id));
await db.activityMedia.bulkDelete(existingActivityMedia.map((mediaItem) => mediaItem.id));
await db.destinations.bulkPut(snapshot.destinations.map((destination, index) => ({
  ...normalizeDestination(destination, index),
  tripId,
})));
await db.routeLegs.bulkPut(snapshot.routeLegs.map((routeLeg) => ({ ...routeLeg, tripId })));
if (snapshot.activities) {
  await db.activities.bulkPut(snapshot.activities.map((activity) => ({ ...activity, tripId })));
}
```

For destination media methods and destination media rollups, get the destination and reject cross-trip access:

```ts
const destination = await db.destinations.get(destinationId);
if (!destination || destination.tripId !== tripId) {
  throw new Error('Destination not found.');
}
```

For `listDestinationMediaRollup`, use the trip-scoped destination media, trip-scoped activities, and trip-scoped activity media. Do not call unscoped Dexie queries inside the rollup path.

- [ ] **Step 5: Run local tests**

Run:

```bash
npm test -- src/storage/tripRepository.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/storage/tripDb.ts src/storage/tripRepository.ts src/storage/tripRepository.test.ts
git commit -m "feat: scope local trip storage"
```

---

### Task 4: Replace App Repository Bootstrap With App Trip Storage

**Files:**
- Modify: `src/storage/appRepository.ts`
- Modify: `src/storage/appRepository.test.ts`

- [ ] **Step 1: Write failing app storage bootstrap tests**

In `src/storage/appRepository.test.ts`, update imports:

```ts
import {
  createAppTripStorage,
  ensureAnonymousSession,
  selectedTripStorageKey,
} from './appRepository';
```

Add this test:

```ts
it('returns a trip directory and explicit Supabase trip repository factory', async () => {
  const user = { id: crypto.randomUUID() };
  const supabase = {
    auth: {
      getUser: vi.fn(async () => ({ data: { user }, error: null })),
      signInAnonymously: vi.fn(),
    },
  };
  const createSupabaseDirectory = vi.fn(() => ({
    listTrips: vi.fn(),
    createTrip: vi.fn(),
    updateTrip: vi.fn(),
    deleteTrip: vi.fn(),
  }));
  const createSupabaseRepository = vi.fn(() => createMockRepository());

  const storage = await createAppTripStorage({
    isSupabaseConfigured: true,
    createSupabaseClient: () => supabase,
    createSupabaseDirectory,
    createSupabaseRepository,
  });

  expect(createSupabaseDirectory).toHaveBeenCalledWith(supabase);
  storage.createTripRepository('trip-1');
  expect(createSupabaseRepository).toHaveBeenCalledWith(supabase, 'trip-1');
});
```

Add this e2e-local test:

```ts
it('returns local directory and trip repository factory for e2e-local mode', async () => {
  const localRepository = createMockRepository();
  const localDirectory = {
    listTrips: vi.fn(),
    createTrip: vi.fn(),
    updateTrip: vi.fn(),
    deleteTrip: vi.fn(),
  };
  const createSupabaseClient = vi.fn();

  const storage = await createAppTripStorage({
    isSupabaseConfigured: false,
    tripStorageMode: 'e2e-local',
    localRepository,
    localDirectory,
    createSupabaseClient,
  });

  expect(storage.directory).toBe(localDirectory);
  expect(storage.createTripRepository('trip-1')).toBe(localRepository);
  expect(createSupabaseClient).not.toHaveBeenCalled();
});
```

Add this storage-key assertion:

```ts
it('exports the selected trip storage key used by the app shell', () => {
  expect(selectedTripStorageKey).toBe('world-tour:selected-trip-id');
});
```

- [ ] **Step 2: Run app repository tests and verify failure**

Run:

```bash
npm test -- src/storage/appRepository.test.ts
```

Expected: FAIL because `createAppTripStorage` and `selectedTripStorageKey` do not exist.

- [ ] **Step 3: Implement app trip storage bootstrap**

Modify `src/storage/appRepository.ts` around the existing bootstrap function:

```ts
import {
  createLocalTripDirectoryRepository,
  createSupabaseTripDirectoryRepository,
  type TripDirectoryRepository,
} from './tripDirectoryRepository';
```

Add these exported types and constants:

```ts
export const selectedTripStorageKey = 'world-tour:selected-trip-id';

type AppTripStorage = {
  directory: TripDirectoryRepository;
  createTripRepository: (tripId: string) => TripRepository;
};
```

Update `CreateAppTripRepositoryOptions` into `CreateAppTripStorageOptions`:

```ts
type CreateAppTripStorageOptions = {
  isSupabaseConfigured?: boolean;
  tripStorageMode?: string;
  localRepository?: TripRepository;
  localDirectory?: TripDirectoryRepository;
  createLocalRepository?: (tripId: string) => TripRepository;
  createSupabaseClient?: () => SupabaseAuthClient;
  createSupabaseDirectory?: (supabase: SupabaseAuthClient) => TripDirectoryRepository;
  createSupabaseRepository?: (supabase: SupabaseAuthClient, tripId: string) => TripRepository;
  storage?: MigrationStorage;
};
```

Add the new function:

```ts
export async function createAppTripStorage(
  options: CreateAppTripStorageOptions = {},
): Promise<AppTripStorage> {
  const isSupabaseConfigured = options.isSupabaseConfigured ?? defaultIsSupabaseConfigured;
  const tripStorageMode = options.tripStorageMode ?? import.meta.env.VITE_TRIP_STORAGE;
  const createLocalRepository =
    options.createLocalRepository ??
    ((tripId: string) => options.localRepository ?? createTripRepository(tripDb, tripId));
  const localDirectory =
    options.localDirectory ?? createLocalTripDirectoryRepository(tripDb);

  if (tripStorageMode === 'e2e-local') {
    return {
      directory: localDirectory,
      createTripRepository: createLocalRepository,
    };
  }

  if (!isSupabaseConfigured) {
    throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.');
  }

  const createSupabaseClient = options.createSupabaseClient ?? createBrowserSupabaseClient;
  const supabase = createSupabaseClient();
  await ensureAnonymousSession(supabase);

  return {
    directory: options.createSupabaseDirectory
      ? options.createSupabaseDirectory(supabase)
      : createSupabaseTripDirectoryRepository(supabase as BrowserSupabaseClient),
    createTripRepository: (tripId: string) =>
      options.createSupabaseRepository
        ? options.createSupabaseRepository(supabase, tripId)
        : createSupabaseTripRepository(supabase as BrowserSupabaseClient, tripId),
  };
}
```

Keep `ensureAnonymousSession` exported. Remove `migrateLocalTripDataOnce` and `migrationKeyForUser`; selected-trip boot no longer migrates local data automatically. Keep this compatibility wrapper until `App.tsx` moves to `useTripWorkspace` in Task 7:

```ts
export async function createAppTripRepository() {
  const storage = await createAppTripStorage();
  const trips = await storage.directory.listTrips();
  const trip = trips[0] ?? await storage.directory.createTrip({ name: 'World tour' });
  return storage.createTripRepository(trip.id);
}
```

- [ ] **Step 4: Run app repository tests**

Run:

```bash
npm test -- src/storage/appRepository.test.ts
```

Expected: PASS. The old local-to-cloud migration test should be removed because personal multi-trip boot no longer migrates local data into an automatically chosen cloud trip.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/storage/appRepository.ts src/storage/appRepository.test.ts
git commit -m "refactor: bootstrap trip storage directory"
```

---

### Task 5: Add Trip Workspace Hook

**Files:**
- Create: `src/hooks/useTripWorkspace.ts`
- Create: `src/hooks/useTripWorkspace.test.tsx`

- [ ] **Step 1: Write hook tests for boot and lifecycle**

Create `src/hooks/useTripWorkspace.test.tsx`:

```ts
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TripRepository } from '../storage/tripRepository';
import type { TripDirectoryRepository, TripSummary } from '../storage/tripDirectoryRepository';
import { selectedTripStorageKey } from '../storage/appRepository';
import { useTripWorkspace } from './useTripWorkspace';

function createTrip(name: string, id = crypto.randomUUID()): TripSummary {
  return {
    id,
    name,
    description: '',
    createdAt: '2026-07-03T10:00:00.000Z',
    updatedAt: '2026-07-03T10:00:00.000Z',
  };
}

function createRepository(): TripRepository {
  return {
    listDestinations: vi.fn(async () => []),
    saveDestination: vi.fn(),
    deleteDestination: vi.fn(),
    listActivities: vi.fn(async () => []),
    createActivity: vi.fn(),
    updateActivity: vi.fn(),
    deleteActivity: vi.fn(),
    reorderActivities: vi.fn(),
    listDestinationMedia: vi.fn(async () => []),
    uploadDestinationMedia: vi.fn(),
    updateDestinationMedia: vi.fn(),
    deleteDestinationMedia: vi.fn(),
    reorderDestinationMedia: vi.fn(),
    listDestinationMediaRollup: vi.fn(async () => []),
    listActivityMedia: vi.fn(async () => []),
    uploadActivityMedia: vi.fn(),
    updateActivityMedia: vi.fn(),
    deleteActivityMedia: vi.fn(),
    reorderActivityMedia: vi.fn(),
    listRouteLegs: vi.fn(async () => []),
    saveRouteLeg: vi.fn(),
    deleteRouteLeg: vi.fn(),
    replaceTripData: vi.fn(),
  };
}

function createStorage(initialTrips: TripSummary[]) {
  let trips = [...initialTrips];
  const directory: TripDirectoryRepository = {
    listTrips: vi.fn(async () => trips),
    createTrip: vi.fn(async ({ name }) => {
      const trip = createTrip(name);
      trips = [trip, ...trips];
      return trip;
    }),
    updateTrip: vi.fn(async (tripId, patch) => {
      trips = trips.map((trip) =>
        trip.id === tripId
          ? { ...trip, ...patch, updatedAt: '2026-07-03T11:00:00.000Z' }
          : trip,
      );
      return trips.find((trip) => trip.id === tripId)!;
    }),
    deleteTrip: vi.fn(async (tripId) => {
      trips = trips.filter((trip) => trip.id !== tripId);
    }),
  };
  const createTripRepository = vi.fn(() => createRepository());

  return {
    storage: {
      directory,
      createTripRepository,
    },
    directory,
    createTripRepository,
  };
}

describe('useTripWorkspace', () => {
  it('restores a remembered selected trip', async () => {
    const remembered = createTrip('Remembered trip', 'remembered-trip');
    const other = createTrip('Other trip', 'other-trip');
    const localStorage = {
      getItem: vi.fn(() => remembered.id),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    const { storage, createTripRepository } = createStorage([other, remembered]);

    const { result } = renderHook(() =>
      useTripWorkspace({
        createStorage: async () => storage,
        localStorage,
      }),
    );

    await waitFor(() => expect(result.current.activeTrip?.id).toBe(remembered.id));
    expect(createTripRepository).toHaveBeenCalledWith(remembered.id);
  });

  it('creates World tour when no trips exist', async () => {
    const localStorage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    const { storage, directory } = createStorage([]);

    const { result } = renderHook(() =>
      useTripWorkspace({
        createStorage: async () => storage,
        localStorage,
      }),
    );

    await waitFor(() => expect(result.current.activeTrip?.name).toBe('World tour'));
    expect(directory.createTrip).toHaveBeenCalledWith({ name: 'World tour' });
    expect(localStorage.setItem).toHaveBeenCalledWith(
      selectedTripStorageKey,
      result.current.activeTrip!.id,
    );
  });

  it('selects, creates, renames, and deletes trips', async () => {
    const first = createTrip('First', 'first-trip');
    const second = createTrip('Second', 'second-trip');
    const localStorage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    const { storage } = createStorage([first, second]);

    const { result } = renderHook(() =>
      useTripWorkspace({
        createStorage: async () => storage,
        localStorage,
      }),
    );

    await waitFor(() => expect(result.current.activeTrip?.id).toBe(first.id));

    await act(async () => {
      await result.current.selectTrip(second.id);
    });
    expect(result.current.activeTrip?.id).toBe(second.id);

    await act(async () => {
      await result.current.createTrip('Third');
    });
    expect(result.current.activeTrip?.name).toBe('Third');

    await act(async () => {
      await result.current.renameActiveTrip('Renamed third');
    });
    expect(result.current.activeTrip?.name).toBe('Renamed third');

    await act(async () => {
      await result.current.deleteTrip(result.current.activeTrip!.id);
    });
    expect(result.current.activeTrip).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run hook tests and verify failure**

Run:

```bash
npm test -- src/hooks/useTripWorkspace.test.tsx
```

Expected: FAIL because `useTripWorkspace` does not exist.

- [ ] **Step 3: Implement the hook**

Create `src/hooks/useTripWorkspace.ts`:

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createAppTripStorage,
  selectedTripStorageKey,
} from '../storage/appRepository';
import type { TripRepository } from '../storage/tripRepository';
import type { TripDirectoryRepository, TripSummary } from '../storage/tripDirectoryRepository';

type AppTripStorage = {
  directory: TripDirectoryRepository;
  createTripRepository: (tripId: string) => TripRepository;
};

type LocalStorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

type UseTripWorkspaceOptions = {
  createStorage?: () => Promise<AppTripStorage>;
  localStorage?: LocalStorageLike;
};

type RepositoryError = {
  title: string;
  message: string;
};

function formatRepositoryError(caught: unknown): RepositoryError {
  const message = caught instanceof Error ? caught.message : 'Unable to prepare trip storage';

  if (message.includes('Supabase is not configured')) {
    return {
      title: 'Supabase is not configured',
      message: 'Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.',
    };
  }

  if (message.includes('row-level security') || message.includes('permission denied')) {
    return {
      title: 'Supabase permission denied',
      message,
    };
  }

  return {
    title: 'Trip storage unavailable',
    message,
  };
}

function chooseInitialTrip(trips: TripSummary[], storedTripId: string | null) {
  return trips.find((trip) => trip.id === storedTripId) ?? trips[0] ?? null;
}

export function useTripWorkspace(options: UseTripWorkspaceOptions = {}) {
  const createStorage = options.createStorage ?? createAppTripStorage;
  const localStorage = options.localStorage ?? window.localStorage;
  const [storage, setStorage] = useState<AppTripStorage | null>(null);
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [activeTrip, setActiveTrip] = useState<TripSummary | null>(null);
  const [repository, setRepository] = useState<TripRepository | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<RepositoryError | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const generationRef = useRef(0);

  const activateTrip = useCallback((nextStorage: AppTripStorage, nextTrip: TripSummary) => {
    localStorage.setItem(selectedTripStorageKey, nextTrip.id);
    setActiveTrip(nextTrip);
    setRepository(nextStorage.createTripRepository(nextTrip.id));
  }, [localStorage]);

  useEffect(() => {
    let isCancelled = false;

    async function loadWorkspace() {
      setIsLoading(true);
      setError(null);
      try {
        const nextStorage = await createStorage();
        let nextTrips = await nextStorage.directory.listTrips();
        let selectedTrip = chooseInitialTrip(
          nextTrips,
          localStorage.getItem(selectedTripStorageKey),
        );

        if (!selectedTrip) {
          selectedTrip = await nextStorage.directory.createTrip({ name: 'World tour' });
          nextTrips = [selectedTrip];
        }

        if (isCancelled) return;

        setStorage(nextStorage);
        setTrips(nextTrips);
        activateTrip(nextStorage, selectedTrip);
      } catch (caught) {
        if (isCancelled) return;

        setError(formatRepositoryError(caught));
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadWorkspace();

    return () => {
      isCancelled = true;
    };
  }, [activateTrip, createStorage, localStorage]);

  const selectTrip = useCallback(async (tripId: string) => {
    if (!storage) return;

    const nextTrip = trips.find((trip) => trip.id === tripId);
    if (!nextTrip) return;

    generationRef.current += 1;
    setActionError(null);
    activateTrip(storage, nextTrip);
  }, [activateTrip, storage, trips]);

  const createTrip = useCallback(async (name: string) => {
    if (!storage) return;

    setActionError(null);
    try {
      const nextTrip = await storage.directory.createTrip({ name });
      const nextTrips = [nextTrip, ...trips];
      setTrips(nextTrips);
      generationRef.current += 1;
      activateTrip(storage, nextTrip);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Unable to create trip');
    }
  }, [activateTrip, storage, trips]);

  const renameActiveTrip = useCallback(async (name: string) => {
    if (!storage || !activeTrip) return;

    setActionError(null);
    try {
      const updatedTrip = await storage.directory.updateTrip(activeTrip.id, { name });
      setTrips((current) =>
        current.map((trip) => (trip.id === updatedTrip.id ? updatedTrip : trip)),
      );
      setActiveTrip(updatedTrip);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Unable to rename trip');
    }
  }, [activeTrip, storage]);

  const deleteTrip = useCallback(async (tripId: string) => {
    if (!storage) return;

    setActionError(null);
    try {
      await storage.directory.deleteTrip(tripId);
      let nextTrips = trips.filter((trip) => trip.id !== tripId);

      if (nextTrips.length === 0) {
        const replacementTrip = await storage.directory.createTrip({ name: 'World tour' });
        nextTrips = [replacementTrip];
      }

      setTrips(nextTrips);
      const nextTrip = nextTrips[0];
      generationRef.current += 1;
      activateTrip(storage, nextTrip);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Unable to delete trip');
    }
  }, [activateTrip, storage, trips]);

  return useMemo(() => ({
    trips,
    activeTrip,
    repository,
    isLoading,
    error,
    actionError,
    selectTrip,
    createTrip,
    renameActiveTrip,
    deleteTrip,
  }), [
    actionError,
    activeTrip,
    createTrip,
    deleteTrip,
    error,
    isLoading,
    repository,
    renameActiveTrip,
    selectTrip,
    trips,
  ]);
}
```

- [ ] **Step 4: Run hook tests**

Run:

```bash
npm test -- src/hooks/useTripWorkspace.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/hooks/useTripWorkspace.ts src/hooks/useTripWorkspace.test.tsx
git commit -m "feat: add trip workspace hook"
```

---

### Task 6: Add Trip Selector Component

**Files:**
- Create: `src/components/TripSelector.tsx`
- Create: `src/components/TripSelector.test.tsx`

- [ ] **Step 1: Write component tests**

Create `src/components/TripSelector.test.tsx`:

```ts
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { TripSummary } from '../storage/tripDirectoryRepository';
import { TripSelector } from './TripSelector';

const trips: TripSummary[] = [
  {
    id: 'trip-one',
    name: 'World tour',
    description: '',
    createdAt: '2026-07-01T10:00:00.000Z',
    updatedAt: '2026-07-01T10:00:00.000Z',
  },
  {
    id: 'trip-two',
    name: 'Japan winter',
    description: '',
    createdAt: '2026-07-02T10:00:00.000Z',
    updatedAt: '2026-07-02T10:00:00.000Z',
  },
];

function renderSelector(overrides: Partial<Parameters<typeof TripSelector>[0]> = {}) {
  const props = {
    trips,
    activeTrip: trips[0],
    actionError: null,
    onSelectTrip: vi.fn(),
    onCreateTrip: vi.fn(),
    onRenameActiveTrip: vi.fn(),
    onDeleteTrip: vi.fn(),
    ...overrides,
  };
  render(<TripSelector {...props} />);
  return props;
}

describe('TripSelector', () => {
  it('selects another trip', async () => {
    const props = renderSelector();

    await userEvent.click(screen.getByRole('button', { name: /current trip/i }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Japan winter' }));

    expect(props.onSelectTrip).toHaveBeenCalledWith('trip-two');
  });

  it('creates a named trip', async () => {
    const props = renderSelector();

    await userEvent.click(screen.getByRole('button', { name: /current trip/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'New trip' }));
    await userEvent.type(screen.getByLabelText('Trip name'), 'South America');
    await userEvent.click(screen.getByRole('button', { name: 'Create trip' }));

    expect(props.onCreateTrip).toHaveBeenCalledWith('South America');
  });

  it('renames the active trip', async () => {
    const props = renderSelector();

    await userEvent.click(screen.getByRole('button', { name: /current trip/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename trip' }));
    await userEvent.clear(screen.getByLabelText('Trip name'));
    await userEvent.type(screen.getByLabelText('Trip name'), 'Renamed tour');
    await userEvent.click(screen.getByRole('button', { name: 'Save name' }));

    expect(props.onRenameActiveTrip).toHaveBeenCalledWith('Renamed tour');
  });

  it('requires delete confirmation that names the trip', async () => {
    const props = renderSelector();

    await userEvent.click(screen.getByRole('button', { name: /current trip/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete trip' }));

    expect(screen.getByRole('dialog', { name: 'Delete trip' })).toHaveTextContent('World tour');
    await userEvent.click(screen.getByRole('button', { name: 'Delete World tour' }));

    expect(props.onDeleteTrip).toHaveBeenCalledWith('trip-one');
  });
});
```

- [ ] **Step 2: Run component tests and verify failure**

Run:

```bash
npm test -- src/components/TripSelector.test.tsx
```

Expected: FAIL because `TripSelector` does not exist.

- [ ] **Step 3: Implement the trip selector**

Create `src/components/TripSelector.tsx`:

```tsx
import { ChevronDown, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { TripSummary } from '../storage/tripDirectoryRepository';

type TripSelectorProps = {
  trips: TripSummary[];
  activeTrip: TripSummary | null;
  actionError: string | null;
  onSelectTrip: (tripId: string) => void;
  onCreateTrip: (name: string) => Promise<void> | void;
  onRenameActiveTrip: (name: string) => Promise<void> | void;
  onDeleteTrip: (tripId: string) => Promise<void> | void;
};

type DialogMode = 'create' | 'rename' | 'delete' | null;

export function TripSelector({
  trips,
  activeTrip,
  actionError,
  onSelectTrip,
  onCreateTrip,
  onRenameActiveTrip,
  onDeleteTrip,
}: TripSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [tripName, setTripName] = useState('');
  const selectorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return undefined;

    const handleWindowPointerDown = (event: PointerEvent) => {
      if (selectorRef.current?.contains(event.target as Node)) return;

      setIsOpen(false);
    };
    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        setDialogMode(null);
      }
    };

    window.addEventListener('pointerdown', handleWindowPointerDown);
    window.addEventListener('keydown', handleWindowKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handleWindowPointerDown);
      window.removeEventListener('keydown', handleWindowKeyDown);
    };
  }, [isOpen]);

  const openDialog = (mode: DialogMode) => {
    setDialogMode(mode);
    setTripName(mode === 'rename' ? activeTrip?.name ?? '' : '');
  };

  const submitName = async () => {
    const trimmedName = tripName.trim();
    if (!trimmedName) return;

    if (dialogMode === 'create') {
      await onCreateTrip(trimmedName);
    }

    if (dialogMode === 'rename') {
      await onRenameActiveTrip(trimmedName);
    }

    setDialogMode(null);
    setIsOpen(false);
  };

  const confirmDelete = async () => {
    if (!activeTrip) return;

    await onDeleteTrip(activeTrip.id);
    setDialogMode(null);
    setIsOpen(false);
  };

  return (
    <div className="trip-selector" ref={selectorRef}>
      <button
        type="button"
        className="trip-selector__trigger"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={`Current trip: ${activeTrip?.name ?? 'Loading trips'}`}
        onClick={() => setIsOpen((current) => !current)}
      >
        <span>{activeTrip?.name ?? 'Loading trips'}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>

      {isOpen ? (
        <div className="trip-selector__menu" role="menu" aria-label="Trips">
          <div className="trip-selector__list">
            {trips.map((trip) => (
              <button
                key={trip.id}
                type="button"
                role="menuitemradio"
                aria-checked={trip.id === activeTrip?.id}
                className={trip.id === activeTrip?.id ? 'is-active' : undefined}
                onClick={() => {
                  onSelectTrip(trip.id);
                  setIsOpen(false);
                }}
              >
                {trip.name}
              </button>
            ))}
          </div>
          <div className="trip-selector__actions">
            <button type="button" role="menuitem" onClick={() => openDialog('create')}>
              <Plus size={16} aria-hidden="true" />
              <span>New trip</span>
            </button>
            <button type="button" role="menuitem" disabled={!activeTrip} onClick={() => openDialog('rename')}>
              <Pencil size={16} aria-hidden="true" />
              <span>Rename trip</span>
            </button>
            <button type="button" role="menuitem" disabled={!activeTrip} onClick={() => openDialog('delete')}>
              <Trash2 size={16} aria-hidden="true" />
              <span>Delete trip</span>
            </button>
          </div>
          {actionError ? <p className="trip-selector__error">{actionError}</p> : null}
        </div>
      ) : null}

      {dialogMode === 'create' || dialogMode === 'rename' ? (
        <section className="trip-selector__dialog" role="dialog" aria-modal="true" aria-label={dialogMode === 'create' ? 'New trip' : 'Rename trip'}>
          <label htmlFor="trip-selector-name">Trip name</label>
          <input
            id="trip-selector-name"
            value={tripName}
            onChange={(event) => setTripName(event.target.value)}
          />
          <div className="trip-selector__dialog-actions">
            <button type="button" onClick={() => setDialogMode(null)}>
              Cancel
            </button>
            <button type="button" onClick={() => void submitName()}>
              {dialogMode === 'create' ? 'Create trip' : 'Save name'}
            </button>
          </div>
        </section>
      ) : null}

      {dialogMode === 'delete' && activeTrip ? (
        <section className="trip-selector__dialog" role="dialog" aria-modal="true" aria-label="Delete trip">
          <p>Delete {activeTrip.name}?</p>
          <div className="trip-selector__dialog-actions">
            <button type="button" onClick={() => setDialogMode(null)}>
              Cancel
            </button>
            <button type="button" onClick={() => void confirmDelete()}>
              Delete {activeTrip.name}
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run component tests**

Run:

```bash
npm test -- src/components/TripSelector.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/components/TripSelector.tsx src/components/TripSelector.test.tsx
git commit -m "feat: add trip selector"
```

---

### Task 7: Integrate Trip Workspace Into App

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Update App tests for trip workspace**

In `src/App.test.tsx`, replace the `createAppTripRepository` mock with a `useTripWorkspace` mock:

```ts
import { useTripWorkspace } from './hooks/useTripWorkspace';
```

```ts
vi.mock('./hooks/useTripWorkspace', () => ({
  useTripWorkspace: vi.fn(),
}));
```

Add a helper near `repositoryMock`:

```ts
const tripsMock = [
  {
    id: 'trip-one',
    name: 'World tour',
    description: '',
    createdAt: '2026-07-01T10:00:00.000Z',
    updatedAt: '2026-07-01T10:00:00.000Z',
  },
  {
    id: 'trip-two',
    name: 'Japan winter',
    description: '',
    createdAt: '2026-07-02T10:00:00.000Z',
    updatedAt: '2026-07-02T10:00:00.000Z',
  },
];

function mockTripWorkspace(overrides: Partial<ReturnType<typeof useTripWorkspace>> = {}) {
  vi.mocked(useTripWorkspace).mockReturnValue({
    trips: tripsMock,
    activeTrip: tripsMock[0],
    repository: repositoryMock,
    isLoading: false,
    error: null,
    actionError: null,
    selectTrip: vi.fn(),
    createTrip: vi.fn(),
    renameActiveTrip: vi.fn(),
    deleteTrip: vi.fn(),
    ...overrides,
  });
}
```

Keep the current expanded `repositoryMock` methods for activities, destination media rollups, and activity media. Do not replace it with the smaller pre-activity-media mock from older tests.

In `beforeEach`, call:

```ts
mockTripWorkspace();
```

Replace tests that set `vi.mocked(createAppTripRepository)` with explicit `mockTripWorkspace` calls. For the storage bootstrap error test, use:

```ts
mockTripWorkspace({
  repository: null,
  error: {
    title: 'Trip storage unavailable',
    message: 'Unable to create an anonymous Supabase session.',
  },
});
```

For the Supabase setup guidance test, use:

```ts
mockTripWorkspace({
  repository: null,
  error: {
    title: 'Supabase is not configured',
    message: 'Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.',
  },
});
```

Add this trip-switching test:

```ts
it('renders the trip selector above the stop panel and clears selected stop when the active trip changes', async () => {
  const firstDestination = createDestination({
    name: 'Paris',
    coordinates: { lat: 48.8566, lng: 2.3522 },
  });
  repositoryMock.initialDestinations = Promise.resolve([firstDestination]);
  const { rerender } = render(<App />);

  await waitFor(() => expect(screen.queryByText('Loading trip data')).not.toBeInTheDocument());
  await userEvent.click(await screen.findByRole('button', { name: 'Select Paris' }));
  expect(screen.getByRole('complementary', { name: 'Paris profile' })).toBeInTheDocument();

  mockTripWorkspace({
    trips: tripsMock,
    activeTrip: tripsMock[1],
    repository: repositoryMock,
    isLoading: false,
    error: null,
    actionError: null,
    selectTrip: vi.fn(),
    createTrip: vi.fn(),
    renameActiveTrip: vi.fn(),
    deleteTrip: vi.fn(),
  });
  rerender(<App />);

  expect(screen.getByRole('button', { name: /current trip: Japan winter/i })).toBeInTheDocument();
  expect(screen.queryByRole('complementary', { name: 'Paris profile' })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run App tests and verify failure**

Run:

```bash
npm test -- src/App.test.tsx
```

Expected: FAIL because `App` still calls the old repository bootstrap and does not render `TripSelector`.

- [ ] **Step 3: Use trip workspace in App**

In `src/App.tsx`, remove `createAppTripRepository` and repository boot state. Import the hook and selector:

```ts
import { TripSelector } from './components/TripSelector';
import { useTripWorkspace } from './hooks/useTripWorkspace';
```

Replace `App` with:

```tsx
export default function App() {
  const {
    trips,
    activeTrip,
    repository,
    isLoading,
    error,
    actionError,
    selectTrip,
    createTrip,
    renameActiveTrip,
    deleteTrip,
  } = useTripWorkspace();

  if (!repository) {
    return (
      <main className="app-shell">
        <section className="map-stage" aria-label="World tour map workspace">
          <MapCanvas
            destinations={[]}
            routeLegs={[]}
            selectedDestinationId={null}
            onSelectDestination={() => undefined}
          />
          <div
            className={error ? 'app-status app-status-error' : 'app-status'}
            role={error ? 'alert' : 'status'}
          >
            {error ? (
              <>
                <strong>{error.title}</strong>
                <span>{error.message}</span>
              </>
            ) : (
              'Loading trip data'
            )}
          </div>
        </section>
      </main>
    );
  }

  return (
    <TripWorkspace
      key={activeTrip?.id}
      repository={repository}
      trips={trips}
      activeTrip={activeTrip}
      tripActionError={actionError}
      onSelectTrip={selectTrip}
      onCreateTrip={createTrip}
      onRenameActiveTrip={renameActiveTrip}
      onDeleteTrip={deleteTrip}
      isTripWorkspaceLoading={isLoading}
    />
  );
}
```

Update `TripWorkspace` props:

```ts
function TripWorkspace({
  repository,
  trips,
  activeTrip,
  tripActionError,
  onSelectTrip,
  onCreateTrip,
  onRenameActiveTrip,
  onDeleteTrip,
  isTripWorkspaceLoading,
}: {
  repository: TripRepository;
  trips: TripSummary[];
  activeTrip: TripSummary | null;
  tripActionError: string | null;
  onSelectTrip: (tripId: string) => void;
  onCreateTrip: (name: string) => Promise<void> | void;
  onRenameActiveTrip: (name: string) => Promise<void> | void;
  onDeleteTrip: (tripId: string) => Promise<void> | void;
  isTripWorkspaceLoading: boolean;
}) {
```

Import `TripSummary`:

```ts
import type { TripSummary } from './storage/tripDirectoryRepository';
```

Render the selector above `ItineraryPanel` while leaving `TopToolbar`, `ActivityPanel`, `DestinationProfile`, and `DestinationImagePreviewModal` wired as they are in the current file:

```tsx
<div className="workspace-left-stack">
  <TripSelector
    trips={trips}
    activeTrip={activeTrip}
    actionError={tripActionError}
    onSelectTrip={onSelectTrip}
    onCreateTrip={onCreateTrip}
    onRenameActiveTrip={onRenameActiveTrip}
    onDeleteTrip={onDeleteTrip}
  />
  <ItineraryPanel
    destinations={destinations}
    routeLegs={routeLegs}
    selectedDestinationId={selectedDestinationId}
    onSelectDestination={handleSelectDestination}
    onDeleteDestination={(destinationId) => void handleDeleteDestination(destinationId)}
    onReorderDestinations={(destinationIds) => void reorderDestinations(destinationIds)}
    onUpdateRouteLeg={(routeLegId, patch) => void updateRouteLeg(routeLegId, patch)}
  />
</div>
```

Remove the standalone `ItineraryPanel` render that the stack replaces.

Do not remove the existing `workspace-panels` block. It owns the selected `ActivityPanel`, `DestinationProfile`, destination media rollup, activity media, and `DestinationImagePreviewModal` behavior added by the activity media work.

Set interaction locking to include workspace loading:

```ts
const isInteractionLocked = isLoading || isTripWorkspaceLoading;
```

The `key={activeTrip?.id}` on `TripWorkspace` resets selected destination and pending map-stop state when the active trip changes.

- [ ] **Step 4: Add CSS for the left stack and selector**

Add to `src/styles.css`:

```css
.workspace-left-stack {
  position: absolute;
  inset: 16px auto 16px 16px;
  z-index: 5;
  display: flex;
  width: min(360px, calc(100vw - 32px));
  flex-direction: column;
  gap: 10px;
  pointer-events: none;
}

.workspace-left-stack .itinerary-panel {
  position: static;
  width: 100%;
  max-height: min(58vh, calc(100vh - 88px));
}

.workspace-left-stack > * {
  pointer-events: auto;
}

.trip-selector {
  position: relative;
}

.trip-selector__trigger {
  display: flex;
  width: 100%;
  min-height: 42px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid var(--border-control);
  border-radius: var(--radius-panel);
  background: var(--surface-overlay-menu);
  color: var(--color-text);
  padding: 0 12px;
  box-shadow: var(--shadow-panel);
}

.trip-selector__trigger span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.trip-selector__menu,
.trip-selector__dialog {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  z-index: 20;
  width: 100%;
  border: 1px solid var(--border-control);
  border-radius: var(--radius-panel);
  background: var(--surface-overlay-menu);
  box-shadow: var(--shadow-panel);
  padding: 8px;
}

.trip-selector__list,
.trip-selector__actions,
.trip-selector__dialog-actions {
  display: grid;
  gap: 4px;
}

.trip-selector__list button,
.trip-selector__actions button,
.trip-selector__dialog-actions button {
  display: flex;
  min-height: 36px;
  align-items: center;
  gap: 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text);
  padding: 0 8px;
  text-align: left;
}

.trip-selector__list button:hover,
.trip-selector__list button.is-active,
.trip-selector__actions button:hover {
  background: var(--surface-action-subtle);
}

.trip-selector__dialog {
  display: grid;
  gap: 10px;
}

.trip-selector__dialog input {
  min-height: 38px;
  border: 1px solid var(--border-control);
  border-radius: var(--radius-control);
  padding: 0 10px;
}

.trip-selector__error {
  margin: 8px 4px 0;
  color: var(--color-danger);
  font-size: 0.875rem;
}

@media (max-width: 760px) {
  .workspace-left-stack {
    inset: 12px 12px auto;
    width: auto;
  }

  .workspace-left-stack .itinerary-panel {
    max-height: var(--mobile-itinerary-panel-clearance);
  }
}
```

- [ ] **Step 5: Run App tests and build**

Run:

```bash
npm test -- src/App.test.tsx
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/App.tsx src/App.test.tsx src/styles.css
git commit -m "feat: integrate trip selector"
```

---

### Task 8: Add E2E Trip Switching Coverage

**Files:**
- Modify: `tests/world-tour.spec.ts`

- [ ] **Step 1: Add an e2e test for create and switch**

In `tests/world-tour.spec.ts`, add a test after the app-shell load test:

```ts
test('creates and switches personal trips without Supabase', async ({ baseURL, context, page }) => {
  const origin = new URL(baseURL ?? 'http://127.0.0.1:5174').origin;
  const cdpSession = await context.newCDPSession(page);

  await cdpSession.send('Storage.clearDataForOrigin', {
    origin,
    storageTypes: 'indexeddb',
  });

  await page.route('https://api.maptiler.com/geocoding/**', async (route) => {
    const url = new URL(route.request().url());
    const query = decodeURIComponent(url.pathname.replace('/geocoding/', '').replace('.json', ''));
    const features = query === 'Kyoto'
      ? [
          {
            id: 'place.kyoto',
            text: 'Kyoto',
            place_name: 'Kyoto, Japan',
            center: [135.7681, 35.0116],
            properties: { country_code: 'jp' },
            context: [{ id: 'country.1', text: 'Japan', short_code: 'jp' }],
          },
        ]
      : [];

    await route.fulfill({
      contentType: 'application/json',
      json: { features },
    });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('Search for a destination')).toBeVisible();

  await page.getByRole('button', { name: /current trip/i }).click();
  await page.getByRole('menuitem', { name: 'New trip' }).click();
  await page.getByLabel('Trip name').fill('Japan winter');
  await page.getByRole('button', { name: 'Create trip' }).click();

  await expect(page.getByRole('button', { name: /current trip: Japan winter/i })).toBeVisible();

  await page.getByLabel('Search for a destination').fill('Kyoto');
  await page.getByRole('option').first().click();
  await expect(page.getByRole('button', { name: /Kyoto/ })).toBeVisible();

  await page.getByRole('button', { name: /current trip/i }).click();
  await page.getByRole('menuitemradio', { name: 'World tour' }).click();

  await expect(page.getByRole('button', { name: /current trip: World tour/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Kyoto/ })).toHaveCount(0);

  await page.getByRole('button', { name: /current trip/i }).click();
  await page.getByRole('menuitemradio', { name: 'Japan winter' }).click();

  await expect(page.getByRole('button', { name: /Kyoto/ })).toBeVisible();
});
```

- [ ] **Step 2: Run e2e tests**

Run:

```bash
npm run test:e2e
```

Expected: PASS. Playwright starts and stops its own `127.0.0.1:5174` server with `VITE_TRIP_STORAGE=e2e-local`.

- [ ] **Step 3: Run full verification**

Run:

```bash
npm test
npm run build
npm run test:e2e
```

Expected: all commands pass.

- [ ] **Step 4: Commit**

Run:

```bash
git add tests/world-tour.spec.ts
git commit -m "test: cover personal trip switching"
```

---

## Self-Review

Spec coverage:

- Selecting, creating, renaming, deleting, and remembering trips are covered by Tasks 1, 5, 6, 7, and 8.
- Explicit trip identity and removal of hidden discovery are covered by Task 2.
- Supabase storage cleanup before trip deletion is covered by Task 1.
- Local e2e isolation with trip-scoped data is covered by Task 3 and Task 8.
- UI placement above the itinerary panel is covered by Task 7.
- Error handling is covered by Task 5 hook state and Task 6 selector display.
- Accessibility is covered through button/menu/dialog roles in Task 6 and component tests.

Verification commands:

```bash
npm test
npm run build
npm run test:e2e
```

The plan intentionally keeps users, sharing, import/export, duplication, and recovery out of scope.
