# Stop Activities Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the activity data foundation and a basic ordered activity list inside each stop profile.

**Architecture:** Activities become first-class child records linked to destinations, while stops remain the only route anchors. Phase 1 adds the domain model, repository storage, Supabase persistence, hook state/actions, and a simple ordered list UI; media rollups and map focus pins are covered by follow-up plans after this slice lands.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Dexie, Supabase, Vite.

---

## Scope

This plan implements Phase 1 from `docs/superpowers/specs/2026-07-03-stop-activities-design.md`.

Included:

- Activity domain type and helpers.
- IndexedDB/Dexie activity storage.
- Supabase `activities` table and repository mapping.
- `useTripData` activity state and mutations.
- Basic ordered activity list in `DestinationProfile`.
- Activity add, rename, reorder up/down, select, and delete.

Deferred to follow-up plans:

- Activity image ownership and stop carousel rollups.
- Activity detail side panel.
- Activity coordinates and map pins.
- Stop focus viewport behavior.

## File Structure

- `src/domain/types.ts`: add `Activity`, `ActivityCategory`, `ActivityStatus`, and activity location/data types.
- `src/domain/activities.ts`: create/update/reorder helpers for activities.
- `src/domain/activities.test.ts`: domain helper coverage.
- `src/storage/tripDb.ts`: add Dexie `activities` table and version.
- `src/storage/tripRepository.ts`: extend repository interface and IndexedDB implementation.
- `src/storage/tripRepository.test.ts`: local repository activity CRUD and destination-delete cascade behavior.
- `supabase/migrations/20260703120000_add_stop_activities.sql`: create Supabase activities table, trigger, indexes, grants, and policies.
- `src/storage/supabaseTripRepository.ts`: Supabase row mapping and repository methods.
- `src/storage/supabaseTripRepository.test.ts`: Supabase activity mapping/list/save/delete tests.
- `src/hooks/useTripData.ts`: load activities and expose activity actions.
- `src/hooks/useTripData.test.tsx`: hook-level activity mutations.
- `src/components/ActivityList.tsx`: focused stop activity list component.
- `src/components/ActivityList.test.tsx`: list interaction tests.
- `src/components/DestinationProfile.tsx`: host `ActivityList` below stop tags.
- `src/components/DestinationProfile.test.tsx`: integration test that the stop profile renders activities.
- `src/App.tsx`: pass selected stop activities and activity actions into `DestinationProfile`.
- `src/App.test.tsx`: update repository mock to satisfy the expanded repository interface.
- `src/styles.css`: activity list styles.

---

### Task 1: Activity Domain Model

**Files:**
- Modify: `src/domain/types.ts`
- Create: `src/domain/activities.ts`
- Test: `src/domain/activities.test.ts`

- [ ] **Step 1: Write the failing domain tests**

Create `src/domain/activities.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createActivity, reorderActivities, updateActivity } from './activities';

describe('activities', () => {
  it('creates an activity with defaults for a destination', () => {
    vi.setSystemTime(new Date('2026-07-03T12:00:00.000Z'));

    const activity = createActivity({
      destinationId: 'destination-1',
      title: 'Louvre',
      order: 2,
    });

    expect(activity).toMatchObject({
      destinationId: 'destination-1',
      order: 2,
      title: 'Louvre',
      description: '',
      category: 'other',
      status: 'idea',
      priority: 'medium',
      links: [],
      notes: '',
      tags: [],
      createdAt: '2026-07-03T12:00:00.000Z',
      updatedAt: '2026-07-03T12:00:00.000Z',
    });
    expect(activity.id).toEqual(expect.any(String));

    vi.useRealTimers();
  });

  it('updates an activity timestamp after patching fields', () => {
    const activity = createActivity({
      destinationId: 'destination-1',
      title: 'Bakery crawl',
      order: 0,
    });

    const updated = updateActivity(activity, {
      title: 'Morning bakery crawl',
      tags: ['food'],
    });

    expect(updated).toMatchObject({
      id: activity.id,
      destinationId: 'destination-1',
      title: 'Morning bakery crawl',
      tags: ['food'],
    });
    expect(updated.createdAt).toBe(activity.createdAt);
    expect(Date.parse(updated.updatedAt)).toBeGreaterThanOrEqual(Date.parse(activity.updatedAt));
  });

  it('reorders activities by requested ids and preserves missing activities after requested ids', () => {
    const first = createActivity({ destinationId: 'destination-1', title: 'First', order: 0 });
    const second = createActivity({ destinationId: 'destination-1', title: 'Second', order: 1 });
    const third = createActivity({ destinationId: 'destination-1', title: 'Third', order: 2 });

    const reordered = reorderActivities([first, second, third], [third.id, first.id]);

    expect(reordered.map((activity) => activity.title)).toEqual(['Third', 'First', 'Second']);
    expect(reordered.map((activity) => activity.order)).toEqual([0, 1, 2]);
  });
});
```

- [ ] **Step 2: Run the domain test and verify it fails**

Run:

```bash
npm test -- src/domain/activities.test.ts
```

Expected: FAIL because `src/domain/activities.ts` does not exist yet.

- [ ] **Step 3: Add activity types**

In `src/domain/types.ts`, replace the existing `ActivityItem` type with the richer activity model while leaving `Destination.activities.items` in place as a legacy bridge:

```ts
export type ActivityCategory =
  | 'food'
  | 'culture'
  | 'outdoors'
  | 'street-art'
  | 'ski'
  | 'detour'
  | 'logistics'
  | 'other';

export type ActivityStatus = 'idea' | 'planned' | 'booked' | 'done' | 'skipped';

export type ActivityLocation = {
  name: string;
  address: string;
  coordinates?: Coordinates;
  sourceProvider?: 'maptiler' | 'manual';
  sourceFeatureId?: string;
};

export type Activity = {
  id: string;
  destinationId: string;
  order: number;
  title: string;
  description: string;
  category: ActivityCategory;
  status: ActivityStatus;
  priority: Priority;
  location?: ActivityLocation;
  links: ResearchLink[];
  notes: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

export type ActivityItem = {
  id: string;
  label: string;
  category: ActivityCategory;
  notes: string;
};
```

- [ ] **Step 4: Add activity domain helpers**

Create `src/domain/activities.ts`:

```ts
import type { Activity } from './types';

type CreateActivityInput = {
  destinationId: string;
  title: string;
  order?: number;
};

type ActivityPatch = Partial<Omit<Activity, 'id' | 'destinationId' | 'createdAt' | 'updatedAt'>>;

const nowIso = () => new Date().toISOString();
const createId = () => crypto.randomUUID();
const nextIsoAfter = (timestamp: string) => {
  const now = nowIso();

  if (now !== timestamp) {
    return now;
  }

  return new Date(Date.parse(timestamp) + 1).toISOString();
};

export function createActivity(input: CreateActivityInput): Activity {
  const timestamp = nowIso();

  return {
    id: createId(),
    destinationId: input.destinationId,
    order: input.order ?? 0,
    title: input.title,
    description: '',
    category: 'other',
    status: 'idea',
    priority: 'medium',
    links: [],
    notes: '',
    tags: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function updateActivity(activity: Activity, patch: ActivityPatch): Activity {
  return {
    ...activity,
    ...patch,
    updatedAt: nextIsoAfter(activity.updatedAt),
  };
}

export function reorderActivities(activities: Activity[], orderedActivityIds: string[]): Activity[] {
  const requestedIds = new Set(orderedActivityIds);
  const activitiesById = new Map(activities.map((activity) => [activity.id, activity]));
  const orderedActivities = [
    ...orderedActivityIds
      .map((activityId) => activitiesById.get(activityId))
      .filter((activity): activity is Activity => activity !== undefined),
    ...activities.filter((activity) => !requestedIds.has(activity.id)),
  ];

  return orderedActivities.map((activity, order) =>
    activity.order === order ? activity : updateActivity(activity, { order }),
  );
}
```

- [ ] **Step 5: Run the domain test and verify it passes**

Run:

```bash
npm test -- src/domain/activities.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/domain/types.ts src/domain/activities.ts src/domain/activities.test.ts
git commit -m "feat: add activity domain model"
```

---

### Task 2: Local Repository Activity Storage

**Files:**
- Modify: `src/storage/tripDb.ts`
- Modify: `src/storage/tripRepository.ts`
- Modify: `src/storage/tripRepository.test.ts`

- [ ] **Step 1: Add failing repository tests**

Append these tests to `src/storage/tripRepository.test.ts`:

```ts
  it('creates, lists, updates, reorders, and deletes activities for a destination', async () => {
    const repository = createTestRepository();
    const destination = createDestination({
      name: 'Paris',
      coordinates: { lat: 48.8566, lng: 2.3522 },
    });

    await repository.saveDestination(destination);

    const louvre = await repository.createActivity({
      destinationId: destination.id,
      title: 'Louvre',
    });
    const bakery = await repository.createActivity({
      destinationId: destination.id,
      title: 'Bakery crawl',
    });

    expect((await repository.listActivities(destination.id)).map((activity) => activity.title)).toEqual([
      'Louvre',
      'Bakery crawl',
    ]);

    await repository.updateActivity(louvre.id, { title: 'Morning Louvre' });
    expect((await repository.listActivities(destination.id))[0].title).toBe('Morning Louvre');

    await repository.reorderActivities(destination.id, [bakery.id, louvre.id]);
    expect((await repository.listActivities(destination.id)).map((activity) => activity.title)).toEqual([
      'Bakery crawl',
      'Morning Louvre',
    ]);

    await repository.deleteActivity(bakery.id);
    expect((await repository.listActivities(destination.id)).map((activity) => activity.title)).toEqual([
      'Morning Louvre',
    ]);
  });

  it('deletes activities when their destination is deleted', async () => {
    const repository = createTestRepository();
    const destination = createDestination({
      name: 'Paris',
      coordinates: { lat: 48.8566, lng: 2.3522 },
    });

    await repository.saveDestination(destination);
    await repository.createActivity({
      destinationId: destination.id,
      title: 'Louvre',
    });

    await repository.deleteDestination(destination.id);

    expect(await repository.listActivities(destination.id)).toEqual([]);
  });
```

- [ ] **Step 2: Run the repository tests and verify they fail**

Run:

```bash
npm test -- src/storage/tripRepository.test.ts
```

Expected: FAIL because the repository does not expose activity methods.

- [ ] **Step 3: Add activities to Dexie**

Modify `src/storage/tripDb.ts`:

```ts
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
```

- [ ] **Step 4: Extend the local repository**

Modify imports and `TripRepository` in `src/storage/tripRepository.ts`:

```ts
import { createActivity, reorderActivities as reorderActivityModels, updateActivity as patchActivity } from '../domain/activities';
import type { Activity, Destination, MediaItem, RouteLeg } from '../domain/types';
```

Add these methods to `TripRepository` before media methods:

```ts
listActivities(destinationId: string): Promise<Activity[]>;
createActivity(input: {
  destinationId: string;
  title: string;
  order?: number;
}): Promise<Activity>;
updateActivity(
  activityId: string,
  patch: Partial<Omit<Activity, 'id' | 'destinationId' | 'createdAt' | 'updatedAt'>>,
): Promise<Activity>;
deleteActivity(activityId: string): Promise<void>;
reorderActivities(destinationId: string, orderedActivityIds: string[]): Promise<Activity[]>;
```

Update `deleteDestination` so the Dexie transaction includes activities:

```ts
await db.transaction('rw', db.destinations, db.routeLegs, db.activities, async () => {
  await db.destinations.delete(destinationId);
  await db.activities.where('destinationId').equals(destinationId).delete();
  const attachedLegs = await db.routeLegs
    .where('originDestinationId')
    .equals(destinationId)
    .or('targetDestinationId')
    .equals(destinationId)
    .toArray();

  await db.routeLegs.bulkDelete(attachedLegs.map((leg) => leg.id));
});
```

Add these implementation methods before `listDestinationMedia`:

```ts
async listActivities(destinationId: string): Promise<Activity[]> {
  return (await db.activities.where('destinationId').equals(destinationId).toArray()).sort(
    (left, right) => left.order - right.order || left.createdAt.localeCompare(right.createdAt),
  );
},

async createActivity(input: {
  destinationId: string;
  title: string;
  order?: number;
}): Promise<Activity> {
  const existingActivities = await this.listActivities(input.destinationId);
  const activity = createActivity({
    ...input,
    order: input.order ?? existingActivities.length,
  });

  await db.activities.put(activity);
  return activity;
},

async updateActivity(
  activityId: string,
  patch: Partial<Omit<Activity, 'id' | 'destinationId' | 'createdAt' | 'updatedAt'>>,
): Promise<Activity> {
  const existing = await db.activities.get(activityId);
  if (!existing) {
    throw new Error('Activity not found.');
  }

  const updated = patchActivity(existing, patch);
  await db.activities.put(updated);
  return updated;
},

async deleteActivity(activityId: string): Promise<void> {
  await db.activities.delete(activityId);
},

async reorderActivities(destinationId: string, orderedActivityIds: string[]): Promise<Activity[]> {
  const currentActivities = await this.listActivities(destinationId);
  const orderedActivities = reorderActivityModels(currentActivities, orderedActivityIds);

  await db.activities.bulkPut(orderedActivities);
  return orderedActivities;
},
```

Update `replaceTripData` to preserve the current behavior while allowing activity snapshots:

```ts
replaceTripData(snapshot: {
  destinations: Destination[];
  routeLegs: RouteLeg[];
  activities?: Activity[];
}): Promise<void>;
```

Implementation:

```ts
async replaceTripData(snapshot: {
  destinations: Destination[];
  routeLegs: RouteLeg[];
  activities?: Activity[];
}): Promise<void> {
  await db.transaction('rw', db.destinations, db.routeLegs, db.activities, async () => {
    await db.destinations.clear();
    await db.routeLegs.clear();
    await db.activities.clear();
    await db.destinations.bulkPut(snapshot.destinations.map((destination, index) => normalizeDestination(destination, index)));
    await db.routeLegs.bulkPut(snapshot.routeLegs);
    if (snapshot.activities) {
      await db.activities.bulkPut(snapshot.activities);
    }
  });
},
```

- [ ] **Step 5: Run the repository tests and verify they pass**

Run:

```bash
npm test -- src/storage/tripRepository.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add src/storage/tripDb.ts src/storage/tripRepository.ts src/storage/tripRepository.test.ts
git commit -m "feat: store activities locally"
```

---

### Task 3: Supabase Activity Persistence

**Files:**
- Create: `supabase/migrations/20260703120000_add_stop_activities.sql`
- Modify: `src/storage/supabaseTripRepository.ts`
- Modify: `src/storage/supabaseTripRepository.test.ts`
- Modify: `src/storage/appRepository.test.ts`
- Modify: `src/App.test.tsx`

- [ ] **Step 1: Add the Supabase migration**

Create `supabase/migrations/20260703120000_add_stop_activities.sql`:

```sql
create table public.activities (
  id uuid primary key,
  trip_id uuid not null references public.trips(id) on delete cascade,
  destination_id uuid not null,
  activity_order integer not null default 0,
  title text not null,
  description text not null default '',
  category text not null default 'other' check (category in ('food', 'culture', 'outdoors', 'street-art', 'ski', 'detour', 'logistics', 'other')),
  status text not null default 'idea' check (status in ('idea', 'planned', 'booked', 'done', 'skipped')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'must-do')),
  location jsonb,
  links jsonb not null default '[]'::jsonb,
  notes text not null default '',
  tags text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (trip_id, destination_id)
    references public.destinations(trip_id, id)
    on delete cascade,
  unique (trip_id, destination_id, id)
);

create index activities_trip_destination_order_idx
  on public.activities(trip_id, destination_id, activity_order, created_at);

create index activities_trip_updated_at_idx
  on public.activities(trip_id, updated_at);

create trigger set_activities_updated_at
before update on public.activities
for each row execute function public.set_updated_at();

alter table public.activities enable row level security;

grant select, insert, update, delete on table public.activities to authenticated;
grant select, insert, update, delete on table public.activities to service_role;

create policy "Trip owners can view activities"
on public.activities
for select
to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.trips
    where trips.id = activities.trip_id
      and trips.owner_user_id = (select auth.uid())
  )
);

create policy "Trip owners can create activities"
on public.activities
for insert
to authenticated
with check (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.trips
    where trips.id = activities.trip_id
      and trips.owner_user_id = (select auth.uid())
  )
);

create policy "Trip owners can update activities"
on public.activities
for update
to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.trips
    where trips.id = activities.trip_id
      and trips.owner_user_id = (select auth.uid())
  )
)
with check (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.trips
    where trips.id = activities.trip_id
      and trips.owner_user_id = (select auth.uid())
  )
);

create policy "Trip owners can delete activities"
on public.activities
for delete
to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.trips
    where trips.id = activities.trip_id
      and trips.owner_user_id = (select auth.uid())
  )
);
```

- [ ] **Step 2: Add failing Supabase repository tests**

In `src/storage/supabaseTripRepository.test.ts`, import the new mapper after it exists in the implementation step. Add these tests before the media tests:

```ts
it('lists activities for a destination ordered by activity_order', async () => {
  const tripId = crypto.randomUUID();
  const destinationId = crypto.randomUUID();
  const rows = [
    {
      id: crypto.randomUUID(),
      trip_id: tripId,
      destination_id: destinationId,
      activity_order: 0,
      title: 'Louvre',
      description: '',
      category: 'culture',
      status: 'idea',
      priority: 'medium',
      location: null,
      links: [],
      notes: '',
      tags: [],
      created_at: '2026-07-03T12:00:00.000Z',
      updated_at: '2026-07-03T12:00:00.000Z',
    },
    {
      id: crypto.randomUUID(),
      trip_id: tripId,
      destination_id: destinationId,
      activity_order: 1,
      title: 'Bakery crawl',
      description: '',
      category: 'food',
      status: 'planned',
      priority: 'high',
      location: null,
      links: [],
      notes: 'Find a good morning route.',
      tags: ['food'],
      created_at: '2026-07-03T12:05:00.000Z',
      updated_at: '2026-07-03T12:05:00.000Z',
    },
  ];
  const createdOrder = vi.fn(async () => ({ data: rows, error: null }));
  const activityOrder = vi.fn(() => ({ order: createdOrder }));
  const destinationEq = vi.fn(() => ({ order: activityOrder }));
  const tripEq = vi.fn(() => ({ eq: destinationEq }));
  const supabase = {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: crypto.randomUUID() } },
        error: null,
      })),
    },
    from: vi.fn((tableName: string) => {
      if (tableName === 'trips') {
        return createTripsTableMock([
          { id: tripId, owner_user_id: crypto.randomUUID(), name: 'World tour' },
        ]);
      }

      if (tableName === 'activities') {
        return {
          select: vi.fn(() => ({ eq: tripEq })),
        };
      }

      throw new Error(`Unexpected table ${tableName}`);
    }),
  };
  const repository = createSupabaseTripRepository(supabase as never);

  await expect(repository.listActivities(destinationId)).resolves.toEqual([
    expect.objectContaining({ id: rows[0].id, title: 'Louvre', order: 0 }),
    expect.objectContaining({ id: rows[1].id, title: 'Bakery crawl', order: 1 }),
  ]);
  expect(tripEq).toHaveBeenCalledWith('trip_id', tripId);
  expect(destinationEq).toHaveBeenCalledWith('destination_id', destinationId);
  expect(activityOrder).toHaveBeenCalledWith('activity_order', { ascending: true });
  expect(createdOrder).toHaveBeenCalledWith('created_at', { ascending: true });
});

it('creates an activity scoped to the active trip and destination', async () => {
  const tripId = crypto.randomUUID();
  const destinationId = crypto.randomUUID();
  const activityId = crypto.randomUUID();
  const activityInsert = vi.fn((row) => ({
    select: vi.fn(() => ({
      single: vi.fn(async () => ({
        data: {
          id: activityId,
          ...row,
          created_at: '2026-07-03T12:00:00.000Z',
          updated_at: '2026-07-03T12:00:00.000Z',
        },
        error: null,
      })),
    })),
  }));
  const supabase = {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: crypto.randomUUID() } },
        error: null,
      })),
    },
    from: vi.fn((tableName: string) => {
      if (tableName === 'trips') {
        return createTripsTableMock([
          { id: tripId, owner_user_id: crypto.randomUUID(), name: 'World tour' },
        ]);
      }

      if (tableName === 'activities') {
        return { insert: activityInsert };
      }

      throw new Error(`Unexpected table ${tableName}`);
    }),
  };
  const repository = createSupabaseTripRepository(supabase as never);

  const activity = await repository.createActivity({
    destinationId,
    title: 'Louvre',
    order: 3,
  });

  expect(activityInsert).toHaveBeenCalledWith(
    expect.objectContaining({
      trip_id: tripId,
      destination_id: destinationId,
      activity_order: 3,
      title: 'Louvre',
      category: 'other',
      status: 'idea',
      priority: 'medium',
    }),
  );
  expect(activity).toEqual(expect.objectContaining({ id: activityId, title: 'Louvre', order: 3 }));
});

it('updates and deletes activities through Supabase', async () => {
  const tripId = crypto.randomUUID();
  const destinationId = crypto.randomUUID();
  const activityId = crypto.randomUUID();
  const updatedRow = {
    id: activityId,
    trip_id: tripId,
    destination_id: destinationId,
    activity_order: 0,
    title: 'Morning Louvre',
    description: '',
    category: 'culture',
    status: 'planned',
    priority: 'high',
    location: null,
    links: [],
    notes: '',
    tags: [],
    created_at: '2026-07-03T12:00:00.000Z',
    updated_at: '2026-07-03T12:05:00.000Z',
  };
  const updateIdEq = vi.fn(() => ({
    select: vi.fn(() => ({
      single: vi.fn(async () => ({ data: updatedRow, error: null })),
    })),
  }));
  const updateTripEq = vi.fn(() => ({ eq: updateIdEq }));
  const activityUpdate = vi.fn(() => ({ eq: updateTripEq }));
  const deleteIdEq = vi.fn(async () => ({ error: null }));
  const deleteTripEq = vi.fn(() => ({ eq: deleteIdEq }));
  const activityDelete = vi.fn(() => ({ eq: deleteTripEq }));
  const supabase = {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: crypto.randomUUID() } },
        error: null,
      })),
    },
    from: vi.fn((tableName: string) => {
      if (tableName === 'trips') {
        return createTripsTableMock([
          { id: tripId, owner_user_id: crypto.randomUUID(), name: 'World tour' },
        ]);
      }

      if (tableName === 'activities') {
        return {
          update: activityUpdate,
          delete: activityDelete,
        };
      }

      throw new Error(`Unexpected table ${tableName}`);
    }),
  };
  const repository = createSupabaseTripRepository(supabase as never);

  await expect(repository.updateActivity(activityId, {
    title: 'Morning Louvre',
    category: 'culture',
    status: 'planned',
    priority: 'high',
  })).resolves.toEqual(expect.objectContaining({
    id: activityId,
    title: 'Morning Louvre',
    category: 'culture',
    status: 'planned',
    priority: 'high',
  }));
  await repository.deleteActivity(activityId);

  expect(activityUpdate).toHaveBeenCalledWith({
    title: 'Morning Louvre',
    category: 'culture',
    status: 'planned',
    priority: 'high',
  });
  expect(updateTripEq).toHaveBeenCalledWith('trip_id', tripId);
  expect(updateIdEq).toHaveBeenCalledWith('id', activityId);
  expect(deleteTripEq).toHaveBeenCalledWith('trip_id', tripId);
  expect(deleteIdEq).toHaveBeenCalledWith('id', activityId);
});
```

- [ ] **Step 3: Add Supabase row mapping**

In `src/storage/supabaseTripRepository.ts`, import activity helpers and types:

```ts
import { createActivity } from '../domain/activities';
import type {
  Activity,
  ActivityCategory,
  ActivityLocation,
  ActivityStatus,
  Destination,
  MediaItem,
  Priority,
  RouteLeg,
} from '../domain/types';
```

Add the row type:

```ts
type SupabaseActivityRow = {
  id: string;
  trip_id: string;
  destination_id: string;
  activity_order: number;
  title: string;
  description: string;
  category: ActivityCategory;
  status: ActivityStatus;
  priority: Priority;
  location: ActivityLocation | null;
  links: Activity['links'];
  notes: string;
  tags: string[];
  created_at: string;
  updated_at: string;
};
```

Add mapping helpers:

```ts
function activityFromSupabaseRow(row: SupabaseActivityRow): Activity {
  return {
    id: row.id,
    destinationId: row.destination_id,
    order: row.activity_order,
    title: row.title,
    description: row.description,
    category: row.category,
    status: row.status,
    priority: row.priority,
    location: row.location ?? undefined,
    links: row.links,
    notes: row.notes,
    tags: row.tags,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function activityToSupabasePatch(
  patch: Partial<Omit<Activity, 'id' | 'destinationId' | 'createdAt' | 'updatedAt'>>,
) {
  return {
    ...(patch.order === undefined ? {} : { activity_order: patch.order }),
    ...(patch.title === undefined ? {} : { title: patch.title }),
    ...(patch.description === undefined ? {} : { description: patch.description }),
    ...(patch.category === undefined ? {} : { category: patch.category }),
    ...(patch.status === undefined ? {} : { status: patch.status }),
    ...(patch.priority === undefined ? {} : { priority: patch.priority }),
    ...(patch.location === undefined ? {} : { location: patch.location }),
    ...(patch.links === undefined ? {} : { links: patch.links }),
    ...(patch.notes === undefined ? {} : { notes: patch.notes }),
    ...(patch.tags === undefined ? {} : { tags: patch.tags }),
  };
}
```

- [ ] **Step 4: Add Supabase activity methods**

In the object returned by `createSupabaseTripRepository`, add methods before media methods:

```ts
async listActivities(destinationId) {
  const tripId = await getActiveTripId();
  const rows = assertNoSupabaseError<SupabaseActivityRow[]>(
    await supabase
      .from('activities')
      .select('*')
      .eq('trip_id', tripId)
      .eq('destination_id', destinationId)
      .order('activity_order', { ascending: true })
      .order('created_at', { ascending: true }),
    'Unable to load activities.',
  );

  return rows.map(activityFromSupabaseRow);
},

async createActivity(input) {
  const tripId = await getActiveTripId();
  const activity = createActivity(input);
  const row = assertNoSupabaseError<SupabaseActivityRow>(
    await supabase
      .from('activities')
      .insert({
        id: activity.id,
        trip_id: tripId,
        destination_id: activity.destinationId,
        activity_order: activity.order,
        title: activity.title,
        description: activity.description,
        category: activity.category,
        status: activity.status,
        priority: activity.priority,
        location: activity.location ?? null,
        links: activity.links,
        notes: activity.notes,
        tags: activity.tags,
      })
      .select('*')
      .single(),
    'Unable to create activity.',
  );

  return activityFromSupabaseRow(row);
},

async updateActivity(activityId, patch) {
  const tripId = await getActiveTripId();
  const row = assertNoSupabaseError<SupabaseActivityRow>(
    await supabase
      .from('activities')
      .update(activityToSupabasePatch(patch))
      .eq('trip_id', tripId)
      .eq('id', activityId)
      .select('*')
      .single(),
    'Unable to update activity.',
  );

  return activityFromSupabaseRow(row);
},

async deleteActivity(activityId) {
  const tripId = await getActiveTripId();
  assertSupabaseWriteSucceeded(
    await supabase
      .from('activities')
      .delete()
      .eq('trip_id', tripId)
      .eq('id', activityId),
    'Unable to delete activity.',
  );
},

async reorderActivities(destinationId, orderedActivityIds) {
  const currentActivities = await this.listActivities(destinationId);
  const orderedActivities = reorderActivityModels(currentActivities, orderedActivityIds);
  const tripId = await getActiveTripId();

  await Promise.all(
    orderedActivities.map((activity) =>
      assertSupabaseWriteSucceeded(
        supabase
          .from('activities')
          .update({ activity_order: activity.order })
          .eq('trip_id', tripId)
          .eq('id', activity.id),
        'Unable to reorder activities.',
      ),
    ),
  );

  return orderedActivities;
},
```

Also import `reorderActivities as reorderActivityModels` from `src/domain/activities.ts`.

- [ ] **Step 5: Update test mocks for the expanded repository interface**

In `src/App.test.tsx`, `src/storage/appRepository.test.ts`, and any other repository mocks, add:

```ts
listActivities: vi.fn(async () => []),
createActivity: vi.fn(),
updateActivity: vi.fn(),
deleteActivity: vi.fn(),
reorderActivities: vi.fn(),
```

- [ ] **Step 6: Run storage tests and typecheck**

Run:

```bash
npm test -- src/storage/supabaseTripRepository.test.ts src/storage/appRepository.test.ts
npm run build
```

Expected: PASS for tests and build.

- [ ] **Step 7: Commit Task 3**

```bash
git add supabase/migrations/20260703120000_add_stop_activities.sql src/storage/supabaseTripRepository.ts src/storage/supabaseTripRepository.test.ts src/storage/appRepository.test.ts src/App.test.tsx
git commit -m "feat: persist activities in supabase"
```

---

### Task 4: Hook Activity State And Mutations

**Files:**
- Modify: `src/hooks/useTripData.ts`
- Modify: `src/hooks/useTripData.test.tsx`

- [ ] **Step 1: Add failing hook tests**

Add tests to `src/hooks/useTripData.test.tsx`:

```ts
it('loads activities for loaded destinations', async () => {
  const repository = createTestRepository();
  const destination = createDestination({
    name: 'Paris',
    coordinates: { lat: 48.8566, lng: 2.3522 },
  });

  await repository.saveDestination(destination);
  await repository.createActivity({
    destinationId: destination.id,
    title: 'Louvre',
  });

  const { result } = renderHook(() => useTripData(repository));

  await waitFor(() => expect(result.current.isLoading).toBe(false));

  expect(result.current.activitiesByDestinationId[destination.id].map((activity) => activity.title)).toEqual([
    'Louvre',
  ]);
});

it('adds, updates, reorders, and deletes activities through hook actions', async () => {
  const repository = createTestRepository();
  const { result } = renderHook(() => useTripData(repository));

  await waitFor(() => expect(result.current.isLoading).toBe(false));

  let destinationId = '';
  await act(async () => {
    const destination = await result.current.addDestination({
      name: 'Paris',
      countryRegion: 'France',
      coordinates: { lat: 48.8566, lng: 2.3522 },
    });
    destinationId = destination.id;
  });

  let louvreId = '';
  let bakeryId = '';
  await act(async () => {
    const louvre = await result.current.createActivity({
      destinationId,
      title: 'Louvre',
    });
    const bakery = await result.current.createActivity({
      destinationId,
      title: 'Bakery crawl',
    });
    louvreId = louvre.id;
    bakeryId = bakery.id;
  });

  await act(async () => {
    await result.current.updateActivity(louvreId, { title: 'Morning Louvre' });
    await result.current.reorderActivities(destinationId, [bakeryId, louvreId]);
  });

  expect(result.current.activitiesByDestinationId[destinationId].map((activity) => activity.title)).toEqual([
    'Bakery crawl',
    'Morning Louvre',
  ]);

  await act(async () => {
    await result.current.deleteActivity(bakeryId);
  });

  expect(result.current.activitiesByDestinationId[destinationId].map((activity) => activity.title)).toEqual([
    'Morning Louvre',
  ]);
});
```

- [ ] **Step 2: Run hook tests and verify they fail**

Run:

```bash
npm test -- src/hooks/useTripData.test.tsx
```

Expected: FAIL because `useTripData` does not expose activity state/actions.

- [ ] **Step 3: Add activity state to `useTripData`**

In `src/hooks/useTripData.ts`, import `Activity`:

```ts
import type { Activity, Coordinates, Destination, DestinationLocation, RouteLeg, RouteLegType } from '../domain/types';
```

Add state near destinations and route legs:

```ts
const [activitiesByDestinationId, setActivitiesByDestinationId] = useState<Record<string, Activity[]>>({});
const activitiesByDestinationIdRef = useRef<Record<string, Activity[]>>({});

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
```

- [ ] **Step 4: Load activities with destinations**

In `startReload`, after loading destinations and route legs, load activities for each destination:

```ts
const [loadedDestinations, loadedRouteLegs] = await Promise.all([
  repository.listDestinations(),
  repository.listRouteLegs(),
]);
const loadedActivities = await Promise.all(
  loadedDestinations.map(async (destination) => [
    destination.id,
    await repository.listActivities(destination.id),
  ] as const),
);
const nextActivitiesByDestinationId = Object.fromEntries(loadedActivities);
```

Before setting `isLoading(false)`, publish:

```ts
replaceActivitiesByDestinationId(nextActivitiesByDestinationId);
```

- [ ] **Step 5: Add hook activity actions**

Inside the actions object returned from `useMemo`, add:

```ts
async createActivity(input: { destinationId: string; title: string; order?: number }) {
  const activity = await repository.createActivity(input);
  if (!isActiveAction()) return activity;

  updateActivitiesByDestinationId((current) => ({
    ...current,
    [activity.destinationId]: [...(current[activity.destinationId] ?? []), activity].sort(
      (left, right) => left.order - right.order || left.createdAt.localeCompare(right.createdAt),
    ),
  }));
  return activity;
},

async updateActivity(
  activityId: string,
  patch: Partial<Omit<Activity, 'id' | 'destinationId' | 'createdAt' | 'updatedAt'>>,
) {
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
  let destinationId = '';
  for (const [candidateDestinationId, activities] of Object.entries(activitiesByDestinationIdRef.current)) {
    if (activities.some((activity) => activity.id === activityId)) {
      destinationId = candidateDestinationId;
      break;
    }
  }

  await repository.deleteActivity(activityId);
  if (!isActiveAction() || !destinationId) return;

  updateActivitiesByDestinationId((current) => ({
    ...current,
    [destinationId]: (current[destinationId] ?? []).filter((activity) => activity.id !== activityId),
  }));
},

async reorderActivities(destinationId: string, orderedActivityIds: string[]) {
  const orderedActivities = await repository.reorderActivities(destinationId, orderedActivityIds);
  if (!isActiveAction()) return orderedActivities;

  updateActivitiesByDestinationId((current) => ({
    ...current,
    [destinationId]: orderedActivities,
  }));
  return orderedActivities;
},
```

Add `replaceActivitiesByDestinationId` to the `startReload` callback dependency list. Add `updateActivitiesByDestinationId` to the actions `useMemo` dependency list. Do not add `activitiesByDestinationId` to the actions `useMemo` dependency list, because the actions read current activity state through `activitiesByDestinationIdRef`.

- [ ] **Step 6: Clear activities when deleting a destination**

In `deleteDestination`, after destination state updates:

```ts
updateActivitiesByDestinationId((current) => {
  const { [destinationId]: _removed, ...remaining } = current;
  return remaining;
});
```

- [ ] **Step 7: Return activity state**

At the bottom of `useTripData`, return:

```ts
return {
  destinations,
  routeLegs,
  activitiesByDestinationId,
  isLoading,
  error,
  ...actions,
};
```

- [ ] **Step 8: Run hook tests and verify they pass**

Run:

```bash
npm test -- src/hooks/useTripData.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit Task 4**

```bash
git add src/hooks/useTripData.ts src/hooks/useTripData.test.tsx
git commit -m "feat: expose activity state from trip data hook"
```

---

### Task 5: Basic Activity List UI

**Files:**
- Create: `src/components/ActivityList.tsx`
- Create: `src/components/ActivityList.test.tsx`
- Modify: `src/components/DestinationProfile.tsx`
- Modify: `src/components/DestinationProfile.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Add failing `ActivityList` tests**

Create `src/components/ActivityList.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createActivity } from '../domain/activities';
import { ActivityList } from './ActivityList';

describe('ActivityList', () => {
  it('renders an empty state and adds an activity', () => {
    const onCreateActivity = vi.fn();

    render(
      <ActivityList
        activities={[]}
        selectedActivityId={null}
        onSelectActivity={vi.fn()}
        onCreateActivity={onCreateActivity}
        onUpdateActivity={vi.fn()}
        onDeleteActivity={vi.fn()}
        onReorderActivities={vi.fn()}
      />,
    );

    expect(screen.getByText('No activities yet')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('New activity title'), {
      target: { value: 'Louvre' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add activity' }));

    expect(onCreateActivity).toHaveBeenCalledWith('Louvre');
  });

  it('selects, renames, reorders, and deletes activities', () => {
    const louvre = createActivity({ destinationId: 'destination-1', title: 'Louvre', order: 0 });
    const bakery = createActivity({ destinationId: 'destination-1', title: 'Bakery crawl', order: 1 });
    const onSelectActivity = vi.fn();
    const onUpdateActivity = vi.fn();
    const onDeleteActivity = vi.fn();
    const onReorderActivities = vi.fn();

    render(
      <ActivityList
        activities={[louvre, bakery]}
        selectedActivityId={bakery.id}
        onSelectActivity={onSelectActivity}
        onCreateActivity={vi.fn()}
        onUpdateActivity={onUpdateActivity}
        onDeleteActivity={onDeleteActivity}
        onReorderActivities={onReorderActivities}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Select activity Louvre' }));
    expect(onSelectActivity).toHaveBeenCalledWith(louvre.id);

    fireEvent.change(screen.getByDisplayValue('Louvre'), {
      target: { value: 'Morning Louvre' },
    });
    expect(onUpdateActivity).toHaveBeenCalledWith(louvre.id, { title: 'Morning Louvre' });

    fireEvent.click(screen.getByRole('button', { name: 'Move Bakery crawl up' }));
    expect(onReorderActivities).toHaveBeenCalledWith([bakery.id, louvre.id]);

    fireEvent.click(screen.getByRole('button', { name: 'Delete Bakery crawl' }));
    expect(onDeleteActivity).toHaveBeenCalledWith(bakery.id);
  });
});
```

- [ ] **Step 2: Run the component test and verify it fails**

Run:

```bash
npm test -- src/components/ActivityList.test.tsx
```

Expected: FAIL because `ActivityList` does not exist yet.

- [ ] **Step 3: Create `ActivityList`**

Create `src/components/ActivityList.tsx`:

```tsx
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { Activity } from '../domain/types';

type ActivityListProps = {
  activities: Activity[];
  selectedActivityId: string | null;
  onSelectActivity: (activityId: string) => void;
  onCreateActivity: (title: string) => void;
  onUpdateActivity: (activityId: string, patch: Partial<Pick<Activity, 'title'>>) => void;
  onDeleteActivity: (activityId: string) => void;
  onReorderActivities: (orderedActivityIds: string[]) => void;
};

function moveActivityId(activityIds: string[], activityId: string, direction: -1 | 1) {
  const currentIndex = activityIds.indexOf(activityId);
  const nextIndex = currentIndex + direction;

  if (currentIndex === -1 || nextIndex < 0 || nextIndex >= activityIds.length) {
    return activityIds;
  }

  const nextActivityIds = [...activityIds];
  const [movedActivityId] = nextActivityIds.splice(currentIndex, 1);
  nextActivityIds.splice(nextIndex, 0, movedActivityId);
  return nextActivityIds;
}

export function ActivityList({
  activities,
  selectedActivityId,
  onSelectActivity,
  onCreateActivity,
  onUpdateActivity,
  onDeleteActivity,
  onReorderActivities,
}: ActivityListProps) {
  const [newActivityTitle, setNewActivityTitle] = useState('');
  const orderedActivityIds = activities.map((activity) => activity.id);

  const submitNewActivity = () => {
    const title = newActivityTitle.trim();
    if (!title) return;

    onCreateActivity(title);
    setNewActivityTitle('');
  };

  return (
    <section className="activity-list-section" aria-label="Activities">
      <div className="activity-list-header">
        <h2>Activities</h2>
      </div>

      {activities.length === 0 ? (
        <p className="activity-empty-state">No activities yet</p>
      ) : (
        <ol className="activity-list">
          {activities.map((activity, index) => {
            const isSelected = activity.id === selectedActivityId;

            return (
              <li key={activity.id} className={isSelected ? 'activity-row is-selected' : 'activity-row'}>
                <button
                  type="button"
                  className="activity-select"
                  aria-label={`Select activity ${activity.title}`}
                  aria-current={isSelected ? 'true' : undefined}
                  onClick={() => onSelectActivity(activity.id)}
                >
                  <span>{String(index + 1).padStart(2, '0')}</span>
                </button>
                <input
                  aria-label={`Activity title ${activity.title}`}
                  value={activity.title}
                  onChange={(event) => onUpdateActivity(activity.id, { title: event.target.value })}
                />
                <button
                  type="button"
                  aria-label={`Move ${activity.title} up`}
                  disabled={index === 0}
                  onClick={() => onReorderActivities(moveActivityId(orderedActivityIds, activity.id, -1))}
                >
                  <ArrowUp size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label={`Move ${activity.title} down`}
                  disabled={index === activities.length - 1}
                  onClick={() => onReorderActivities(moveActivityId(orderedActivityIds, activity.id, 1))}
                >
                  <ArrowDown size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${activity.title}`}
                  onClick={() => onDeleteActivity(activity.id)}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ol>
      )}

      <div className="activity-add-row">
        <input
          aria-label="New activity title"
          placeholder="Add activity"
          value={newActivityTitle}
          onChange={(event) => setNewActivityTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submitNewActivity();
            }
          }}
        />
        <button type="button" aria-label="Add activity" onClick={submitNewActivity}>
          <Plus size={15} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run `ActivityList` tests and verify they pass**

Run:

```bash
npm test -- src/components/ActivityList.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Wire activities into `DestinationProfile`**

In `src/components/DestinationProfile.tsx`, import `ActivityList` and `Activity`:

```ts
import { ActivityList } from './ActivityList';
import type { Activity, Destination } from '../domain/types';
```

Update props:

```ts
type DestinationProfileProps = {
  destination: Destination;
  activities: Activity[];
  selectedActivityId: string | null;
  stopNumber?: number;
  onSelectActivity: (activityId: string) => void;
  onCreateActivity: (destinationId: string, title: string) => Promise<void> | void;
  onUpdateActivity: (activityId: string, patch: Partial<Pick<Activity, 'title'>>) => Promise<void> | void;
  onDeleteActivity: (activityId: string) => Promise<void> | void;
  onReorderActivities: (destinationId: string, orderedActivityIds: string[]) => Promise<void> | void;
  onUpdate: (destinationId: string, patch: DestinationPatch) => Promise<void> | void;
  onClose: () => void;
};
```

Pass the new props through `DestinationProfile` into `DestinationProfileForm`.

Add this below the tag editor in the returned JSX:

```tsx
<ActivityList
  activities={activities}
  selectedActivityId={selectedActivityId}
  onSelectActivity={onSelectActivity}
  onCreateActivity={(title) => void onCreateActivity(destination.id, title)}
  onUpdateActivity={(activityId, patch) => void onUpdateActivity(activityId, patch)}
  onDeleteActivity={(activityId) => void onDeleteActivity(activityId)}
  onReorderActivities={(orderedActivityIds) => void onReorderActivities(destination.id, orderedActivityIds)}
/>
```

- [ ] **Step 6: Update `App` wiring**

In `src/App.tsx`, destructure hook activity state and actions:

```ts
activitiesByDestinationId,
createActivity,
updateActivity,
deleteActivity,
reorderActivities,
```

Add state in `TripWorkspace`:

```ts
const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null);
```

When selected destination changes, clear invalid activity selection:

```ts
useEffect(() => {
  if (!selectedDestinationId) {
    setSelectedActivityId(null);
    return;
  }

  const selectedActivities = activitiesByDestinationId[selectedDestinationId] ?? [];
  if (selectedActivityId && !selectedActivities.some((activity) => activity.id === selectedActivityId)) {
    setSelectedActivityId(null);
  }
}, [activitiesByDestinationId, selectedActivityId, selectedDestinationId]);
```

Pass props into `DestinationProfile`:

```tsx
activities={selectedDestination ? activitiesByDestinationId[selectedDestination.id] ?? [] : []}
selectedActivityId={selectedActivityId}
onSelectActivity={setSelectedActivityId}
onCreateActivity={async (destinationId, title) => {
  const activity = await createActivity({ destinationId, title });
  setSelectedActivityId(activity.id);
}}
onUpdateActivity={updateActivity}
onDeleteActivity={async (activityId) => {
  await deleteActivity(activityId);
  setSelectedActivityId((current) => (current === activityId ? null : current));
}}
onReorderActivities={reorderActivities}
```

- [ ] **Step 7: Add basic styles**

In `src/styles.css`, add:

```css
.activity-list-section {
  display: grid;
  gap: 10px;
  margin-top: 18px;
}

.activity-list-header h2 {
  font-size: 0.8rem;
  font-weight: 700;
  margin: 0;
  text-transform: uppercase;
}

.activity-empty-state {
  color: var(--color-text-muted);
  font-size: 0.85rem;
  margin: 0;
}

.activity-list {
  display: grid;
  gap: 8px;
  list-style: none;
  margin: 0;
  padding: 0;
}

.activity-row,
.activity-add-row {
  align-items: center;
  display: grid;
  gap: 6px;
  grid-template-columns: auto 1fr auto auto auto;
}

.activity-row input,
.activity-add-row input {
  min-width: 0;
}

.activity-row.is-selected {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

.activity-select span {
  font-variant-numeric: tabular-nums;
}

.activity-add-row {
  grid-template-columns: 1fr auto;
}
```

- [ ] **Step 8: Update profile tests**

In existing `DestinationProfile` tests, add required props to render calls by creating a helper:

```ts
function renderDestinationProfile(
  destination: Destination,
  overrides: Partial<React.ComponentProps<typeof DestinationProfile>> = {},
) {
  return render(
    <DestinationProfile
      destination={destination}
      activities={[]}
      selectedActivityId={null}
      onSelectActivity={vi.fn()}
      onCreateActivity={vi.fn()}
      onUpdateActivity={vi.fn()}
      onDeleteActivity={vi.fn()}
      onReorderActivities={vi.fn()}
      onUpdate={vi.fn()}
      onClose={vi.fn()}
      {...overrides}
    />,
  );
}
```

Add a focused integration test:

```tsx
it('renders activities inside the stop profile', () => {
  const destination = createDestination({
    name: 'Paris',
    coordinates: { lat: 48.8566, lng: 2.3522 },
  });
  const activity = createActivity({
    destinationId: destination.id,
    title: 'Louvre',
    order: 0,
  });

  renderDestinationProfile(destination, { activities: [activity] });

  expect(screen.getByRole('heading', { name: 'Activities' })).toBeInTheDocument();
  expect(screen.getByDisplayValue('Louvre')).toBeInTheDocument();
});
```

Import `createActivity` in the test file.

- [ ] **Step 9: Run component and app tests**

Run:

```bash
npm test -- src/components/ActivityList.test.tsx src/components/DestinationProfile.test.tsx src/App.test.tsx
```

Expected: PASS.

- [ ] **Step 10: Commit Task 5**

```bash
git add src/components/ActivityList.tsx src/components/ActivityList.test.tsx src/components/DestinationProfile.tsx src/components/DestinationProfile.test.tsx src/App.tsx src/App.test.tsx src/styles.css
git commit -m "feat: add stop activity list"
```

---

### Task 6: Final Verification

**Files:**
- No new files.

- [ ] **Step 1: Run the focused test suite**

Run:

```bash
npm test -- src/domain/activities.test.ts src/storage/tripRepository.test.ts src/storage/supabaseTripRepository.test.ts src/hooks/useTripData.test.tsx src/components/ActivityList.test.tsx src/components/DestinationProfile.test.tsx src/App.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run full tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Run lint and build**

Run:

```bash
npm run lint
npm run build
```

Expected: PASS for both commands.

- [ ] **Step 4: Browser smoke check**

Run the app:

```bash
npm run dev -- --port 5174 --strictPort
```

Open `http://127.0.0.1:5174`.

Verify:

- Selecting a stop opens its stop profile.
- The profile shows an `Activities` section.
- Adding an activity creates a row and selects it.
- Renaming an activity updates the row.
- Move up/down changes only activity order.
- Deleting an activity removes only that activity.
- Stop order and route legs do not change while activity rows are manipulated.

- [ ] **Step 5: Commit final fixes if verification required changes**

If any verification step required code changes:

```bash
git add <changed-files>
git commit -m "fix: stabilize stop activities phase 1"
```

If no code changes were required, do not create an empty commit.
