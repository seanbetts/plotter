# World Tour Planner PoC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local, map-first proof of concept where the user can add destinations to a world map, edit structured destination profiles, connect stops with route legs, and persist/export the trip data.

**Architecture:** Use a Vite React TypeScript app with focused domain modules, a Dexie IndexedDB persistence layer, and React state hooks that keep the map, profile panel, route legs, and itinerary list in sync. MapLibre renders the custom map surface while geocoding and routing sit behind small adapters so providers can change without rewriting UI code.

**Tech Stack:** Vite, React, TypeScript, MapLibre GL JS, Dexie, Vitest, React Testing Library, Playwright, lucide-react.

---

## File Structure

- `package.json`: npm scripts and runtime/test dependencies.
- `index.html`: Vite app entry document.
- `vite.config.ts`: Vite and Vitest configuration.
- `tsconfig.json`, `tsconfig.node.json`: TypeScript configuration.
- `playwright.config.ts`: browser smoke-test configuration.
- `src/main.tsx`: React mount point.
- `src/App.tsx`: top-level app shell and state orchestration.
- `src/styles.css`: global app styling and map/profile visual system.
- `src/domain/types.ts`: shared domain types.
- `src/domain/destinations.ts`: destination factory and update helpers.
- `src/domain/routeLegs.ts`: route-leg factory and GeoJSON helpers.
- `src/domain/snapshots.ts`: JSON import/export snapshot helpers.
- `src/storage/tripDb.ts`: Dexie schema and database instance factory.
- `src/storage/tripRepository.ts`: persistence functions for destinations, route legs, and snapshots.
- `src/adapters/geocoding.ts`: provider-neutral place-search contract and Nominatim implementation.
- `src/adapters/manualRouting.ts`: route geometry helper for manual/approximate route legs.
- `src/hooks/useTripData.ts`: React hook for loading and mutating local trip data.
- `src/components/MapCanvas.tsx`: MapLibre setup, pins, route lines, and pin-drop handling.
- `src/components/TopToolbar.tsx`: search, add mode, import/export, and map actions.
- `src/components/DestinationProfile.tsx`: structured destination profile editor.
- `src/components/ItineraryPanel.tsx`: secondary stop/route list.
- `src/components/RouteLegEditor.tsx`: route-leg creation and type controls.
- `src/test/setup.ts`: test environment setup.
- `src/**/*.test.ts`, `src/**/*.test.tsx`: unit and component tests.
- `tests/world-tour.spec.ts`: Playwright smoke test.

---

## Task 1: Scaffold The Vite React Project

**Files:**
- Create: `package.json`
- Create: `index.html`
- Create: `vite.config.ts`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `playwright.config.ts`
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `src/styles.css`
- Create: `src/test/setup.ts`

- [ ] **Step 1: Create the Vite app**

Run:

```bash
npm create vite@latest . -- --template react-ts
```

Expected: Vite creates `package.json`, `index.html`, `src/main.tsx`, `src/App.tsx`, and TypeScript config files in the project root.

- [ ] **Step 2: Install runtime and test dependencies**

Run:

```bash
npm install maplibre-gl dexie lucide-react
npm install --save-dev vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event playwright @playwright/test fake-indexeddb
```

Expected: dependencies are added to `package.json` and `package-lock.json`.

- [ ] **Step 3: Replace `package.json` scripts**

Set the scripts block to:

```json
{
  "dev": "vite --host 127.0.0.1",
  "build": "tsc -b && vite build",
  "lint": "eslint .",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:e2e": "playwright test"
}
```

Expected: `npm run test`, `npm run build`, and `npm run test:e2e` are available.

- [ ] **Step 4: Configure Vitest**

Update `vite.config.ts` to include:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    globals: true,
  },
});
```

- [ ] **Step 5: Add test setup**

Create `src/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
```

- [ ] **Step 6: Add Playwright config**

Create `playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
```

- [ ] **Step 7: Replace starter app with a neutral shell**

Create `src/App.tsx`:

```tsx
import './styles.css';

export default function App() {
  return (
    <main className="app-shell">
      <section className="map-stage" aria-label="World tour map workspace">
        <div className="empty-map-state">World Tour Planner</div>
      </section>
    </main>
  );
}
```

Create `src/styles.css`:

```css
* {
  box-sizing: border-box;
}

html,
body,
#root {
  width: 100%;
  height: 100%;
  margin: 0;
}

body {
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
    sans-serif;
  color: #f5efe3;
  background: #111814;
}

button,
input,
textarea,
select {
  font: inherit;
}

.app-shell {
  min-height: 100%;
  background: #111814;
}

.map-stage {
  position: relative;
  min-height: 100vh;
  overflow: hidden;
}

.empty-map-state {
  display: grid;
  min-height: 100vh;
  place-items: center;
  color: #f5efe3;
  letter-spacing: 0;
}
```

- [ ] **Step 8: Verify scaffold**

Run:

```bash
npm run test
npm run build
```

Expected: both commands exit with code 0.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json index.html vite.config.ts tsconfig.json tsconfig.node.json playwright.config.ts src
git commit -m "chore: scaffold world tour app"
```

---

## Task 2: Add Domain Types And Helpers

**Files:**
- Create: `src/domain/types.ts`
- Create: `src/domain/destinations.ts`
- Create: `src/domain/routeLegs.ts`
- Create: `src/domain/destinations.test.ts`
- Create: `src/domain/routeLegs.test.ts`

- [ ] **Step 1: Write failing destination tests**

Create `src/domain/destinations.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createDestination, updateDestination } from './destinations';

describe('destination helpers', () => {
  it('creates a destination with consistent structured profile fields', () => {
    const destination = createDestination({
      name: 'Cappadocia',
      coordinates: { lat: 38.6431, lng: 34.8289 },
      countryRegion: 'Turkey',
    });

    expect(destination.name).toBe('Cappadocia');
    expect(destination.countryRegion).toBe('Turkey');
    expect(destination.status).toBe('idea');
    expect(destination.priority).toBe('medium');
    expect(destination.timing.expectedStayDays).toBe(3);
    expect(destination.why.summary).toBe('');
    expect(destination.media).toEqual([]);
    expect(destination.research.links).toEqual([]);
    expect(destination.activities.items).toEqual([]);
    expect(destination.routeContext.notes).toBe('');
    expect(destination.tags).toEqual([]);
  });

  it('updates nested profile sections without dropping existing data', () => {
    const destination = createDestination({
      name: 'Queenstown',
      coordinates: { lat: -45.0312, lng: 168.6626 },
      countryRegion: 'New Zealand',
    });

    const updated = updateDestination(destination, {
      timing: { ...destination.timing, expectedStayDays: 7 },
      why: { ...destination.why, summary: 'Southern Alps base for skiing and roads.' },
      tags: ['ski', 'mountains'],
    });

    expect(updated.id).toBe(destination.id);
    expect(updated.timing.expectedStayDays).toBe(7);
    expect(updated.why.summary).toContain('Southern Alps');
    expect(updated.tags).toEqual(['ski', 'mountains']);
    expect(updated.updatedAt).not.toBe(destination.updatedAt);
  });
});
```

- [ ] **Step 2: Write failing route-leg tests**

Create `src/domain/routeLegs.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createRouteLeg, createStraightLineGeometry } from './routeLegs';

describe('route leg helpers', () => {
  it('creates a manual route leg between two destinations', () => {
    const leg = createRouteLeg({
      originDestinationId: 'origin-1',
      targetDestinationId: 'target-1',
      type: 'uncertain',
    });

    expect(leg.originDestinationId).toBe('origin-1');
    expect(leg.targetDestinationId).toBe('target-1');
    expect(leg.type).toBe('uncertain');
    expect(leg.notes).toBe('');
  });

  it('creates GeoJSON line geometry in longitude latitude order', () => {
    const geometry = createStraightLineGeometry(
      { lat: 51.5072, lng: -0.1276 },
      { lat: 41.0082, lng: 28.9784 },
    );

    expect(geometry.type).toBe('LineString');
    expect(geometry.coordinates).toEqual([
      [-0.1276, 51.5072],
      [28.9784, 41.0082],
    ]);
  });
});
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
npm run test -- src/domain/destinations.test.ts src/domain/routeLegs.test.ts
```

Expected: FAIL because `src/domain/destinations.ts` and `src/domain/routeLegs.ts` do not exist.

- [ ] **Step 4: Add domain types**

Create `src/domain/types.ts`:

```ts
import type { LineString } from 'geojson';

export type Coordinates = {
  lat: number;
  lng: number;
};

export type DestinationStatus = 'idea' | 'planned' | 'confirmed' | 'visited';
export type Priority = 'low' | 'medium' | 'high' | 'must-do';
export type RouteLegType = 'driving' | 'ferry-shipping' | 'uncertain';

export type MediaItem = {
  id: string;
  url: string;
  caption: string;
  credit: string;
};

export type ResearchLink = {
  id: string;
  title: string;
  url: string;
};

export type BookReference = {
  id: string;
  source: 'World Atlas of Street Art' | "Lonely Planet's Where to Go When" | 'Powder' | 'Other';
  reference: string;
  note: string;
};

export type ActivityItem = {
  id: string;
  label: string;
  category: 'food' | 'culture' | 'outdoors' | 'street-art' | 'ski' | 'detour' | 'other';
  notes: string;
};

export type Destination = {
  id: string;
  name: string;
  countryRegion: string;
  coordinates: Coordinates;
  status: DestinationStatus;
  priority: Priority;
  timing: {
    idealMonths: string[];
    expectedStayDays: number;
    provisionalStartDate: string;
    provisionalEndDate: string;
  };
  why: {
    summary: string;
    highlights: string;
    personalRationale: string;
  };
  media: MediaItem[];
  research: {
    notes: string;
    links: ResearchLink[];
    bookReferences: BookReference[];
  };
  activities: {
    items: ActivityItem[];
  };
  routeContext: {
    previousNextNotes: string;
    drivingNotes: string;
    borderShippingNotes: string;
    notes: string;
  };
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

export type RouteLeg = {
  id: string;
  originDestinationId: string;
  targetDestinationId: string;
  type: RouteLegType;
  distanceKm?: number;
  travelTimeHours?: number;
  geometry?: LineString;
  notes: string;
  createdAt: string;
  updatedAt: string;
};
```

- [ ] **Step 5: Add destination helpers**

Create `src/domain/destinations.ts`:

```ts
import type { Coordinates, Destination } from './types';

type CreateDestinationInput = {
  name: string;
  countryRegion?: string;
  coordinates: Coordinates;
};

const nowIso = () => new Date().toISOString();
const createId = () => crypto.randomUUID();

export function createDestination(input: CreateDestinationInput): Destination {
  const timestamp = nowIso();

  return {
    id: createId(),
    name: input.name,
    countryRegion: input.countryRegion ?? '',
    coordinates: input.coordinates,
    status: 'idea',
    priority: 'medium',
    timing: {
      idealMonths: [],
      expectedStayDays: 3,
      provisionalStartDate: '',
      provisionalEndDate: '',
    },
    why: {
      summary: '',
      highlights: '',
      personalRationale: '',
    },
    media: [],
    research: {
      notes: '',
      links: [],
      bookReferences: [],
    },
    activities: {
      items: [],
    },
    routeContext: {
      previousNextNotes: '',
      drivingNotes: '',
      borderShippingNotes: '',
      notes: '',
    },
    tags: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function updateDestination(
  destination: Destination,
  patch: Partial<Omit<Destination, 'id' | 'createdAt' | 'updatedAt'>>,
): Destination {
  return {
    ...destination,
    ...patch,
    updatedAt: nowIso(),
  };
}
```

- [ ] **Step 6: Add route-leg helpers**

Create `src/domain/routeLegs.ts`:

```ts
import type { LineString } from 'geojson';
import type { Coordinates, RouteLeg, RouteLegType } from './types';

type CreateRouteLegInput = {
  originDestinationId: string;
  targetDestinationId: string;
  type: RouteLegType;
  distanceKm?: number;
  travelTimeHours?: number;
  geometry?: LineString;
  notes?: string;
};

const nowIso = () => new Date().toISOString();
const createId = () => crypto.randomUUID();

export function createStraightLineGeometry(origin: Coordinates, target: Coordinates): LineString {
  return {
    type: 'LineString',
    coordinates: [
      [origin.lng, origin.lat],
      [target.lng, target.lat],
    ],
  };
}

export function createRouteLeg(input: CreateRouteLegInput): RouteLeg {
  const timestamp = nowIso();

  return {
    id: createId(),
    originDestinationId: input.originDestinationId,
    targetDestinationId: input.targetDestinationId,
    type: input.type,
    distanceKm: input.distanceKm,
    travelTimeHours: input.travelTimeHours,
    geometry: input.geometry,
    notes: input.notes ?? '',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
```

- [ ] **Step 7: Verify domain tests pass**

Run:

```bash
npm run test -- src/domain/destinations.test.ts src/domain/routeLegs.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/domain
git commit -m "feat: add trip domain model"
```

---

## Task 3: Add IndexedDB Persistence

**Files:**
- Create: `src/storage/tripDb.ts`
- Create: `src/storage/tripRepository.ts`
- Create: `src/storage/tripRepository.test.ts`

- [ ] **Step 1: Write failing repository tests**

Create `src/storage/tripRepository.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { createDestination } from '../domain/destinations';
import { createRouteLeg } from '../domain/routeLegs';
import { createTripDb } from './tripDb';
import { createTripRepository } from './tripRepository';

describe('trip repository', () => {
  beforeEach(async () => {
    await indexedDB.deleteDatabase('world-tour-test');
  });

  it('creates, lists, updates, and deletes destinations', async () => {
    const db = createTripDb('world-tour-test');
    const repository = createTripRepository(db);
    const destination = createDestination({
      name: 'Lake Bled',
      countryRegion: 'Slovenia',
      coordinates: { lat: 46.3683, lng: 14.1146 },
    });

    await repository.saveDestination(destination);
    expect(await repository.listDestinations()).toHaveLength(1);

    await repository.saveDestination({ ...destination, name: 'Bled' });
    expect((await repository.listDestinations())[0].name).toBe('Bled');

    await repository.deleteDestination(destination.id);
    expect(await repository.listDestinations()).toEqual([]);
  });

  it('deletes route legs attached to a deleted destination', async () => {
    const db = createTripDb('world-tour-test');
    const repository = createTripRepository(db);
    const origin = createDestination({
      name: 'Istanbul',
      coordinates: { lat: 41.0082, lng: 28.9784 },
    });
    const target = createDestination({
      name: 'Tbilisi',
      coordinates: { lat: 41.7151, lng: 44.8271 },
    });
    const leg = createRouteLeg({
      originDestinationId: origin.id,
      targetDestinationId: target.id,
      type: 'driving',
    });

    await repository.saveDestination(origin);
    await repository.saveDestination(target);
    await repository.saveRouteLeg(leg);
    await repository.deleteDestination(origin.id);

    expect(await repository.listRouteLegs()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm run test -- src/storage/tripRepository.test.ts
```

Expected: FAIL because storage modules do not exist.

- [ ] **Step 3: Create the Dexie database**

Create `src/storage/tripDb.ts`:

```ts
import Dexie, { type EntityTable } from 'dexie';
import type { Destination, RouteLeg } from '../domain/types';

export type TripDb = Dexie & {
  destinations: EntityTable<Destination, 'id'>;
  routeLegs: EntityTable<RouteLeg, 'id'>;
};

export function createTripDb(name = 'world-tour-planner'): TripDb {
  const db = new Dexie(name) as TripDb;

  db.version(1).stores({
    destinations: 'id, name, countryRegion, status, priority, updatedAt',
    routeLegs: 'id, originDestinationId, targetDestinationId, type, updatedAt',
  });

  return db;
}

export const tripDb = createTripDb();
```

- [ ] **Step 4: Create repository functions**

Create `src/storage/tripRepository.ts`:

```ts
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
  };
}
```

- [ ] **Step 5: Verify repository tests pass**

Run:

```bash
npm run test -- src/storage/tripRepository.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/storage
git commit -m "feat: persist trip data locally"
```

---

## Task 4: Add Snapshot Import And Export

**Files:**
- Create: `src/domain/snapshots.ts`
- Create: `src/domain/snapshots.test.ts`
- Modify: `src/storage/tripRepository.ts`
- Modify: `src/storage/tripRepository.test.ts`

- [ ] **Step 1: Write failing snapshot tests**

Create `src/domain/snapshots.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createDestination } from './destinations';
import { createRouteLeg } from './routeLegs';
import { parseTripSnapshot, serializeTripSnapshot } from './snapshots';

describe('trip snapshots', () => {
  it('serializes and parses destinations and route legs', () => {
    const origin = createDestination({
      name: 'Meteora',
      coordinates: { lat: 39.7217, lng: 21.6306 },
    });
    const target = createDestination({
      name: 'Cappadocia',
      coordinates: { lat: 38.6431, lng: 34.8289 },
    });
    const leg = createRouteLeg({
      originDestinationId: origin.id,
      targetDestinationId: target.id,
      type: 'driving',
    });

    const json = serializeTripSnapshot({
      destinations: [origin, target],
      routeLegs: [leg],
    });
    const parsed = parseTripSnapshot(json);

    expect(parsed.destinations.map((destination) => destination.name)).toEqual([
      'Meteora',
      'Cappadocia',
    ]);
    expect(parsed.routeLegs[0].type).toBe('driving');
  });

  it('rejects invalid snapshot JSON', () => {
    expect(() => parseTripSnapshot('{"destinations":[]}')).toThrow(
      'Trip snapshot must include destinations and routeLegs arrays',
    );
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm run test -- src/domain/snapshots.test.ts
```

Expected: FAIL because `src/domain/snapshots.ts` does not exist.

- [ ] **Step 3: Add snapshot helpers**

Create `src/domain/snapshots.ts`:

```ts
import type { Destination, RouteLeg } from './types';

export type TripSnapshot = {
  version: 1;
  exportedAt: string;
  destinations: Destination[];
  routeLegs: RouteLeg[];
};

export type TripSnapshotInput = {
  destinations: Destination[];
  routeLegs: RouteLeg[];
};

export function serializeTripSnapshot(input: TripSnapshotInput): string {
  const snapshot: TripSnapshot = {
    version: 1,
    exportedAt: new Date().toISOString(),
    destinations: input.destinations,
    routeLegs: input.routeLegs,
  };

  return JSON.stringify(snapshot, null, 2);
}

export function parseTripSnapshot(json: string): TripSnapshot {
  const value = JSON.parse(json) as Partial<TripSnapshot>;

  if (!Array.isArray(value.destinations) || !Array.isArray(value.routeLegs)) {
    throw new Error('Trip snapshot must include destinations and routeLegs arrays');
  }

  return {
    version: 1,
    exportedAt: typeof value.exportedAt === 'string' ? value.exportedAt : new Date().toISOString(),
    destinations: value.destinations as Destination[],
    routeLegs: value.routeLegs as RouteLeg[],
  };
}
```

- [ ] **Step 4: Add repository snapshot methods**

Update `src/storage/tripRepository.ts` so `createTripRepository` includes:

```ts
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
```

Place the method after `deleteRouteLeg`.

- [ ] **Step 5: Extend repository tests**

Add this test to `src/storage/tripRepository.test.ts`:

```ts
  it('replaces all trip data from a snapshot', async () => {
    const db = createTripDb('world-tour-test');
    const repository = createTripRepository(db);
    const oldDestination = createDestination({
      name: 'Old stop',
      coordinates: { lat: 0, lng: 0 },
    });
    const newDestination = createDestination({
      name: 'New stop',
      coordinates: { lat: 1, lng: 1 },
    });

    await repository.saveDestination(oldDestination);
    await repository.replaceTripData({
      destinations: [newDestination],
      routeLegs: [],
    });

    expect((await repository.listDestinations()).map((destination) => destination.name)).toEqual([
      'New stop',
    ]);
  });
```

- [ ] **Step 6: Verify snapshot tests pass**

Run:

```bash
npm run test -- src/domain/snapshots.test.ts src/storage/tripRepository.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/domain/snapshots.ts src/domain/snapshots.test.ts src/storage/tripRepository.ts src/storage/tripRepository.test.ts
git commit -m "feat: add trip data import export"
```

---

## Task 5: Add React Trip Data Hook

**Files:**
- Create: `src/hooks/useTripData.ts`
- Create: `src/hooks/useTripData.test.tsx`

- [ ] **Step 1: Write failing hook tests**

Create `src/hooks/useTripData.test.tsx`:

```tsx
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTripDb } from '../storage/tripDb';
import { createTripRepository } from '../storage/tripRepository';
import { useTripData } from './useTripData';

describe('useTripData', () => {
  beforeEach(async () => {
    await indexedDB.deleteDatabase('world-tour-hook-test');
  });

  it('adds, updates, and deletes a destination', async () => {
    const repository = createTripRepository(createTripDb('world-tour-hook-test'));
    const { result } = renderHook(() => useTripData(repository));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.addDestination({
        name: 'Durmitor',
        countryRegion: 'Montenegro',
        coordinates: { lat: 43.1306, lng: 19.0342 },
      });
    });

    expect(result.current.destinations[0].name).toBe('Durmitor');

    await act(async () => {
      await result.current.updateDestination(result.current.destinations[0].id, {
        tags: ['mountains'],
      });
    });

    expect(result.current.destinations[0].tags).toEqual(['mountains']);

    await act(async () => {
      await result.current.deleteDestination(result.current.destinations[0].id);
    });

    expect(result.current.destinations).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm run test -- src/hooks/useTripData.test.tsx
```

Expected: FAIL because `src/hooks/useTripData.ts` does not exist.

- [ ] **Step 3: Add the hook**

Create `src/hooks/useTripData.ts`:

```ts
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
    void reload();
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
```

- [ ] **Step 4: Verify hook tests pass**

Run:

```bash
npm run test -- src/hooks/useTripData.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks
git commit -m "feat: add trip data react hook"
```

---

## Task 6: Add Geocoding And Manual Routing Adapters

**Files:**
- Create: `src/adapters/geocoding.ts`
- Create: `src/adapters/geocoding.test.ts`
- Create: `src/adapters/manualRouting.ts`
- Create: `src/adapters/manualRouting.test.ts`

- [ ] **Step 1: Write failing adapter tests**

Create `src/adapters/geocoding.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchNominatimPlaces } from './geocoding';

describe('geocoding adapter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps Nominatim results into place search results', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            place_id: 1,
            display_name: 'Istanbul, Turkey',
            lat: '41.0082',
            lon: '28.9784',
          },
        ],
      }),
    );

    const results = await searchNominatimPlaces('Istanbul');

    expect(results).toEqual([
      {
        id: '1',
        label: 'Istanbul, Turkey',
        coordinates: { lat: 41.0082, lng: 28.9784 },
        countryRegion: 'Turkey',
      },
    ]);
  });
});
```

Create `src/adapters/manualRouting.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildManualRouteGeometry } from './manualRouting';

describe('manual routing adapter', () => {
  it('returns straight-line geometry between coordinates', () => {
    const geometry = buildManualRouteGeometry(
      { lat: 51.5072, lng: -0.1276 },
      { lat: 48.8566, lng: 2.3522 },
    );

    expect(geometry.coordinates).toEqual([
      [-0.1276, 51.5072],
      [2.3522, 48.8566],
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm run test -- src/adapters/geocoding.test.ts src/adapters/manualRouting.test.ts
```

Expected: FAIL because adapter modules do not exist.

- [ ] **Step 3: Add geocoding adapter**

Create `src/adapters/geocoding.ts`:

```ts
import type { Coordinates } from '../domain/types';

export type PlaceSearchResult = {
  id: string;
  label: string;
  coordinates: Coordinates;
  countryRegion: string;
};

type NominatimResult = {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
};

export async function searchNominatimPlaces(query: string): Promise<PlaceSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(
      trimmed,
    )}`,
  );

  if (!response.ok) {
    throw new Error('Place search failed');
  }

  const results = (await response.json()) as NominatimResult[];

  return results.map((result) => {
    const labelParts = result.display_name.split(',').map((part) => part.trim());
    const countryRegion = labelParts.at(-1) ?? '';

    return {
      id: String(result.place_id),
      label: result.display_name,
      coordinates: {
        lat: Number(result.lat),
        lng: Number(result.lon),
      },
      countryRegion,
    };
  });
}
```

- [ ] **Step 4: Add manual routing adapter**

Create `src/adapters/manualRouting.ts`:

```ts
import { createStraightLineGeometry } from '../domain/routeLegs';
import type { Coordinates } from '../domain/types';

export function buildManualRouteGeometry(origin: Coordinates, target: Coordinates) {
  return createStraightLineGeometry(origin, target);
}
```

- [ ] **Step 5: Verify adapter tests pass**

Run:

```bash
npm run test -- src/adapters/geocoding.test.ts src/adapters/manualRouting.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/adapters
git commit -m "feat: add place and route adapters"
```

---

## Task 7: Add Map Canvas

**Files:**
- Create: `src/components/MapCanvas.tsx`
- Create: `src/components/MapCanvas.test.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Write failing MapCanvas tests**

Create `src/components/MapCanvas.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Destination, RouteLeg } from '../domain/types';
import { MapCanvas } from './MapCanvas';

vi.mock('maplibre-gl', () => ({
  default: {
    Map: vi.fn(() => ({
      on: vi.fn(),
      off: vi.fn(),
      remove: vi.fn(),
      addControl: vi.fn(),
      getSource: vi.fn(),
      addSource: vi.fn(),
      addLayer: vi.fn(),
      getLayer: vi.fn(),
      setData: vi.fn(),
      fitBounds: vi.fn(),
      project: vi.fn(() => ({ x: 120, y: 80 })),
    })),
    NavigationControl: vi.fn(),
  },
}));

describe('MapCanvas', () => {
  const destination: Destination = {
    id: 'dest-1',
    name: 'Cappadocia',
    countryRegion: 'Turkey',
    coordinates: { lat: 38.6431, lng: 34.8289 },
    status: 'idea',
    priority: 'medium',
    timing: { idealMonths: [], expectedStayDays: 3, provisionalStartDate: '', provisionalEndDate: '' },
    why: { summary: '', highlights: '', personalRationale: '' },
    media: [],
    research: { notes: '', links: [], bookReferences: [] },
    activities: { items: [] },
    routeContext: { previousNextNotes: '', drivingNotes: '', borderShippingNotes: '', notes: '' },
    tags: [],
    createdAt: '2026-06-28T00:00:00.000Z',
    updatedAt: '2026-06-28T00:00:00.000Z',
  };

  it('renders destination pins as accessible buttons', () => {
    render(
      <MapCanvas
        destinations={[destination]}
        routeLegs={[]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
        onDropPin={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Select Cappadocia' })).toBeInTheDocument();
  });

  it('renders the empty planning map label with no destinations', () => {
    render(
      <MapCanvas
        destinations={[]}
        routeLegs={[] as RouteLeg[]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
        onDropPin={vi.fn()}
      />,
    );

    expect(screen.getByText('Blank planning map')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm run test -- src/components/MapCanvas.test.tsx
```

Expected: FAIL because `MapCanvas.tsx` does not exist.

- [ ] **Step 3: Add MapCanvas component**

Create `src/components/MapCanvas.tsx`:

```tsx
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useMemo, useRef } from 'react';
import type { Destination, RouteLeg } from '../domain/types';

type MapCanvasProps = {
  destinations: Destination[];
  routeLegs: RouteLeg[];
  selectedDestinationId: string | null;
  onSelectDestination: (destinationId: string) => void;
  onDropPin: (coordinates: { lat: number; lng: number }) => void;
};

const styleUrl = 'https://demotiles.maplibre.org/style.json';

export function MapCanvas({
  destinations,
  routeLegs,
  selectedDestinationId,
  onSelectDestination,
  onDropPin,
}: MapCanvasProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: styleUrl,
      center: [18, 24],
      zoom: 1.4,
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    map.on('dblclick', (event) => {
      onDropPin({ lat: event.lngLat.lat, lng: event.lngLat.lng });
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [onDropPin]);

  const routeCount = useMemo(() => routeLegs.length, [routeLegs.length]);

  const routeSegments = useMemo(
    () =>
      routeLegs
        .map((leg) => {
          const origin = destinations.find((destination) => destination.id === leg.originDestinationId);
          const target = destinations.find((destination) => destination.id === leg.targetDestinationId);
          if (!origin || !target) return null;

          return {
            id: leg.id,
            type: leg.type,
            x1: ((origin.coordinates.lng + 180) / 360) * 100,
            y1: ((90 - origin.coordinates.lat) / 180) * 100,
            x2: ((target.coordinates.lng + 180) / 360) * 100,
            y2: ((90 - target.coordinates.lat) / 180) * 100,
          };
        })
        .filter((segment): segment is NonNullable<typeof segment> => segment !== null),
    [destinations, routeLegs],
  );

  return (
    <section className="map-canvas" aria-label="Interactive world tour map">
      <div ref={mapContainerRef} className="maplibre-container" data-testid="map-container" />
      {destinations.length === 0 ? (
        <div className="map-empty-label">Blank planning map</div>
      ) : null}
      <svg className="route-layer" aria-label="Route legs">
        {routeSegments.map((segment) => (
          <line
            key={segment.id}
            className={`route-line route-line-${segment.type}`}
            x1={`${segment.x1}%`}
            y1={`${segment.y1}%`}
            x2={`${segment.x2}%`}
            y2={`${segment.y2}%`}
          />
        ))}
      </svg>
      <div className="pin-layer" aria-label="Destination pins">
        {destinations.map((destination) => (
          <button
            key={destination.id}
            type="button"
            className={`map-pin ${destination.id === selectedDestinationId ? 'is-selected' : ''}`}
            aria-label={`Select ${destination.name}`}
            onClick={() => onSelectDestination(destination.id)}
            style={{
              left: `${((destination.coordinates.lng + 180) / 360) * 100}%`,
              top: `${((90 - destination.coordinates.lat) / 180) * 100}%`,
            }}
          >
            <span />
          </button>
        ))}
      </div>
      <div className="map-route-count" aria-live="polite">
        {routeCount} route {routeCount === 1 ? 'leg' : 'legs'}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Add map styles**

Append to `src/styles.css`:

```css
.map-canvas {
  position: absolute;
  inset: 0;
  background: #14201a;
}

.maplibre-container {
  position: absolute;
  inset: 0;
}

.map-empty-label {
  position: absolute;
  left: 50%;
  top: 50%;
  z-index: 2;
  transform: translate(-50%, -50%);
  color: rgba(245, 239, 227, 0.8);
  font-size: 0.95rem;
  letter-spacing: 0;
  pointer-events: none;
}

.pin-layer {
  position: absolute;
  inset: 0;
  z-index: 4;
  pointer-events: none;
}

.route-layer {
  position: absolute;
  inset: 0;
  z-index: 3;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.route-line {
  fill: none;
  stroke-width: 3;
  stroke-linecap: round;
  opacity: 0.9;
}

.route-line-driving {
  stroke: #e9b44c;
}

.route-line-ferry-shipping {
  stroke: #7ec8e3;
  stroke-dasharray: 8 9;
}

.route-line-uncertain {
  stroke: #f5efe3;
  stroke-dasharray: 3 8;
  opacity: 0.72;
}

.map-pin {
  position: absolute;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid rgba(17, 24, 20, 0.85);
  border-radius: 50%;
  background: #e9b44c;
  box-shadow: 0 0 0 4px rgba(233, 180, 76, 0.18), 0 8px 22px rgba(0, 0, 0, 0.35);
  cursor: pointer;
  pointer-events: auto;
  transform: translate(-50%, -50%);
}

.map-pin.is-selected {
  background: #f7f0d0;
  box-shadow: 0 0 0 5px rgba(247, 240, 208, 0.22), 0 10px 26px rgba(0, 0, 0, 0.4);
}

.map-pin span {
  display: block;
  width: 6px;
  height: 6px;
  margin: 7px auto;
  border-radius: 50%;
  background: #111814;
}

.map-route-count {
  position: absolute;
  right: 18px;
  bottom: 18px;
  z-index: 5;
  padding: 8px 10px;
  border: 1px solid rgba(245, 239, 227, 0.16);
  border-radius: 6px;
  color: #f5efe3;
  background: rgba(17, 24, 20, 0.78);
  backdrop-filter: blur(12px);
  font-size: 0.8rem;
}
```

- [ ] **Step 5: Verify MapCanvas tests pass**

Run:

```bash
npm run test -- src/components/MapCanvas.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/MapCanvas.tsx src/components/MapCanvas.test.tsx src/styles.css
git commit -m "feat: add map canvas"
```

---

## Task 8: Add Destination Search And Creation Flow

**Files:**
- Create: `src/components/TopToolbar.tsx`
- Create: `src/components/TopToolbar.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Write failing toolbar tests**

Create `src/components/TopToolbar.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TopToolbar } from './TopToolbar';

describe('TopToolbar', () => {
  it('searches places and adds the selected result', async () => {
    const onAddDestination = vi.fn();
    render(
      <TopToolbar
        onAddDestination={onAddDestination}
        onExport={vi.fn()}
        onImportText={vi.fn()}
        searchPlaces={vi.fn().mockResolvedValue([
          {
            id: 'place-1',
            label: 'Istanbul, Turkey',
            countryRegion: 'Turkey',
            coordinates: { lat: 41.0082, lng: 28.9784 },
          },
        ])}
      />,
    );

    await userEvent.type(screen.getByLabelText('Search for a destination'), 'Istanbul');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add Istanbul, Turkey' })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Add Istanbul, Turkey' }));

    expect(onAddDestination).toHaveBeenCalledWith({
      name: 'Istanbul',
      countryRegion: 'Turkey',
      coordinates: { lat: 41.0082, lng: 28.9784 },
    });
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm run test -- src/components/TopToolbar.test.tsx
```

Expected: FAIL because `TopToolbar.tsx` does not exist.

- [ ] **Step 3: Add toolbar component**

Create `src/components/TopToolbar.tsx`:

```tsx
import { Download, Search, Upload } from 'lucide-react';
import { useState } from 'react';
import type { PlaceSearchResult } from '../adapters/geocoding';
import type { Coordinates } from '../domain/types';

type TopToolbarProps = {
  searchPlaces: (query: string) => Promise<PlaceSearchResult[]>;
  onAddDestination: (input: {
    name: string;
    countryRegion: string;
    coordinates: Coordinates;
  }) => Promise<void> | void;
  onExport: () => void;
  onImportText: (text: string) => Promise<void> | void;
};

function nameFromLabel(label: string) {
  return label.split(',')[0]?.trim() || label;
}

export function TopToolbar({ searchPlaces, onAddDestination, onExport, onImportText }: TopToolbarProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch() {
    setIsSearching(true);
    setError(null);
    try {
      setResults(await searchPlaces(query));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Search failed');
    } finally {
      setIsSearching(false);
    }
  }

  async function handleImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    await onImportText(await file.text());
    event.target.value = '';
  }

  return (
    <header className="top-toolbar" aria-label="Map planning tools">
      <div className="search-group">
        <label className="sr-only" htmlFor="destination-search">
          Search for a destination
        </label>
        <input
          id="destination-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search places"
        />
        <button type="button" onClick={handleSearch}>
          <Search size={16} aria-hidden="true" />
          Search
        </button>
      </div>
      <button type="button" className="icon-action" onClick={onExport} aria-label="Export trip data">
        <Download size={17} aria-hidden="true" />
      </button>
      <label className="icon-action file-action" aria-label="Import trip data">
        <Upload size={17} aria-hidden="true" />
        <input type="file" accept="application/json" onChange={handleImport} />
      </label>
      {isSearching ? <div className="toolbar-status">Searching...</div> : null}
      {error ? <div className="toolbar-error">{error}</div> : null}
      {results.length > 0 ? (
        <div className="search-results">
          {results.map((result) => (
            <button
              key={result.id}
              type="button"
              onClick={() =>
                onAddDestination({
                  name: nameFromLabel(result.label),
                  countryRegion: result.countryRegion,
                  coordinates: result.coordinates,
                })
              }
              aria-label={`Add ${result.label}`}
            >
              {result.label}
            </button>
          ))}
        </div>
      ) : null}
    </header>
  );
}
```

- [ ] **Step 4: Add toolbar styles**

Append to `src/styles.css`:

```css
.top-toolbar {
  position: absolute;
  top: 16px;
  left: 16px;
  z-index: 10;
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.search-group {
  display: flex;
  gap: 8px;
  padding: 8px;
  border: 1px solid rgba(245, 239, 227, 0.14);
  border-radius: 8px;
  background: rgba(17, 24, 20, 0.82);
  backdrop-filter: blur(16px);
}

.search-group input {
  width: min(34vw, 340px);
  min-width: 180px;
  border: 1px solid rgba(245, 239, 227, 0.16);
  border-radius: 6px;
  padding: 9px 10px;
  color: #f5efe3;
  background: rgba(255, 255, 255, 0.07);
}

.search-group button,
.icon-action,
.search-results button {
  border: 1px solid rgba(245, 239, 227, 0.14);
  border-radius: 6px;
  color: #f5efe3;
  background: rgba(245, 239, 227, 0.1);
  cursor: pointer;
}

.search-group button,
.icon-action {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 9px 11px;
}

.file-action input {
  position: fixed;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.search-results {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  display: grid;
  width: min(48vw, 460px);
  overflow: hidden;
  border: 1px solid rgba(245, 239, 227, 0.14);
  border-radius: 8px;
  background: rgba(17, 24, 20, 0.92);
  backdrop-filter: blur(16px);
}

.search-results button {
  padding: 10px 12px;
  border-width: 0 0 1px;
  border-radius: 0;
  text-align: left;
}

.toolbar-status,
.toolbar-error {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  padding: 8px 10px;
  border-radius: 6px;
  background: rgba(17, 24, 20, 0.88);
}

.toolbar-error {
  color: #ffcfba;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
}
```

- [ ] **Step 5: Verify toolbar tests pass**

Run:

```bash
npm run test -- src/components/TopToolbar.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/TopToolbar.tsx src/components/TopToolbar.test.tsx src/styles.css
git commit -m "feat: add destination search toolbar"
```

---

## Task 9: Add Destination Profile Editor

**Files:**
- Create: `src/components/DestinationProfile.tsx`
- Create: `src/components/DestinationProfile.test.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Write failing profile tests**

Create `src/components/DestinationProfile.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createDestination } from '../domain/destinations';
import { DestinationProfile } from './DestinationProfile';

describe('DestinationProfile', () => {
  it('edits destination summary, timing, and tags', async () => {
    const destination = createDestination({
      name: 'Samarkand',
      countryRegion: 'Uzbekistan',
      coordinates: { lat: 39.6542, lng: 66.9597 },
    });
    const onUpdate = vi.fn();

    render(<DestinationProfile destination={destination} onUpdate={onUpdate} onClose={vi.fn()} />);

    await userEvent.type(screen.getByLabelText('Why it matters'), 'Silk Road architecture.');
    await userEvent.clear(screen.getByLabelText('Expected stay days'));
    await userEvent.type(screen.getByLabelText('Expected stay days'), '5');
    await userEvent.type(screen.getByLabelText('Tags'), 'silk-road, city');
    await userEvent.click(screen.getByRole('button', { name: 'Save destination' }));

    expect(onUpdate).toHaveBeenCalledWith(destination.id, expect.objectContaining({
      timing: expect.objectContaining({ expectedStayDays: 5 }),
      why: expect.objectContaining({ summary: 'Silk Road architecture.' }),
      tags: ['silk-road', 'city'],
    }));
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm run test -- src/components/DestinationProfile.test.tsx
```

Expected: FAIL because `DestinationProfile.tsx` does not exist.

- [ ] **Step 3: Add profile editor**

Create `src/components/DestinationProfile.tsx`:

```tsx
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Destination } from '../domain/types';

type DestinationProfileProps = {
  destination: Destination;
  onUpdate: (
    destinationId: string,
    patch: Partial<Omit<Destination, 'id' | 'createdAt' | 'updatedAt'>>,
  ) => Promise<void> | void;
  onClose: () => void;
};

function tagsToText(tags: string[]) {
  return tags.join(', ');
}

function textToTags(value: string) {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function DestinationProfile({ destination, onUpdate, onClose }: DestinationProfileProps) {
  const [summary, setSummary] = useState(destination.why.summary);
  const [highlights, setHighlights] = useState(destination.why.highlights);
  const [personalRationale, setPersonalRationale] = useState(destination.why.personalRationale);
  const [expectedStayDays, setExpectedStayDays] = useState(String(destination.timing.expectedStayDays));
  const [idealMonths, setIdealMonths] = useState(destination.timing.idealMonths.join(', '));
  const [researchNotes, setResearchNotes] = useState(destination.research.notes);
  const [activityNotes, setActivityNotes] = useState(
    destination.activities.items.map((item) => item.label).join(', '),
  );
  const [routeNotes, setRouteNotes] = useState(destination.routeContext.notes);
  const [tags, setTags] = useState(tagsToText(destination.tags));

  useEffect(() => {
    setSummary(destination.why.summary);
    setHighlights(destination.why.highlights);
    setPersonalRationale(destination.why.personalRationale);
    setExpectedStayDays(String(destination.timing.expectedStayDays));
    setIdealMonths(destination.timing.idealMonths.join(', '));
    setResearchNotes(destination.research.notes);
    setActivityNotes(destination.activities.items.map((item) => item.label).join(', '));
    setRouteNotes(destination.routeContext.notes);
    setTags(tagsToText(destination.tags));
  }, [destination]);

  async function handleSave() {
    await onUpdate(destination.id, {
      timing: {
        ...destination.timing,
        idealMonths: textToTags(idealMonths),
        expectedStayDays: Number(expectedStayDays) || 1,
      },
      why: {
        summary,
        highlights,
        personalRationale,
      },
      research: {
        ...destination.research,
        notes: researchNotes,
      },
      activities: {
        items: textToTags(activityNotes).map((label) => ({
          id: crypto.randomUUID(),
          label,
          category: 'other',
          notes: '',
        })),
      },
      routeContext: {
        ...destination.routeContext,
        notes: routeNotes,
      },
      tags: textToTags(tags),
    });
  }

  return (
    <aside className="destination-profile" aria-label={`${destination.name} profile`}>
      <div className="profile-header">
        <div>
          <p>{destination.countryRegion || 'Unassigned region'}</p>
          <h1>{destination.name}</h1>
        </div>
        <button type="button" onClick={onClose} aria-label="Close destination profile">
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      <label>
        Why it matters
        <textarea value={summary} onChange={(event) => setSummary(event.target.value)} />
      </label>
      <label>
        Highlights
        <textarea value={highlights} onChange={(event) => setHighlights(event.target.value)} />
      </label>
      <label>
        Personal rationale
        <textarea
          value={personalRationale}
          onChange={(event) => setPersonalRationale(event.target.value)}
        />
      </label>
      <label>
        Expected stay days
        <input
          type="number"
          min="1"
          value={expectedStayDays}
          onChange={(event) => setExpectedStayDays(event.target.value)}
        />
      </label>
      <label>
        Ideal months
        <input value={idealMonths} onChange={(event) => setIdealMonths(event.target.value)} />
      </label>
      <label>
        Research notes
        <textarea value={researchNotes} onChange={(event) => setResearchNotes(event.target.value)} />
      </label>
      <label>
        Activities
        <textarea value={activityNotes} onChange={(event) => setActivityNotes(event.target.value)} />
      </label>
      <label>
        Route notes
        <textarea value={routeNotes} onChange={(event) => setRouteNotes(event.target.value)} />
      </label>
      <label>
        Tags
        <input value={tags} onChange={(event) => setTags(event.target.value)} />
      </label>

      <button type="button" className="primary-action" onClick={handleSave}>
        Save destination
      </button>
    </aside>
  );
}
```

- [ ] **Step 4: Add profile styles**

Append to `src/styles.css`:

```css
.destination-profile {
  position: absolute;
  top: 16px;
  right: 16px;
  bottom: 16px;
  z-index: 12;
  display: grid;
  width: min(430px, calc(100vw - 32px));
  align-content: start;
  gap: 12px;
  overflow: auto;
  padding: 18px;
  border: 1px solid rgba(245, 239, 227, 0.16);
  border-radius: 8px;
  background: rgba(17, 24, 20, 0.9);
  backdrop-filter: blur(18px);
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.35);
}

.profile-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.profile-header p {
  margin: 0 0 4px;
  color: rgba(245, 239, 227, 0.64);
  font-size: 0.78rem;
}

.profile-header h1 {
  margin: 0;
  font-size: 1.45rem;
  line-height: 1.15;
}

.profile-header button,
.primary-action {
  border: 1px solid rgba(245, 239, 227, 0.16);
  border-radius: 6px;
  color: #f5efe3;
  background: rgba(245, 239, 227, 0.1);
  cursor: pointer;
}

.profile-header button {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
}

.destination-profile label {
  display: grid;
  gap: 6px;
  color: rgba(245, 239, 227, 0.74);
  font-size: 0.82rem;
}

.destination-profile input,
.destination-profile textarea {
  width: 100%;
  border: 1px solid rgba(245, 239, 227, 0.15);
  border-radius: 6px;
  padding: 9px 10px;
  color: #f5efe3;
  background: rgba(255, 255, 255, 0.07);
}

.destination-profile textarea {
  min-height: 72px;
  resize: vertical;
}

.primary-action {
  padding: 11px 12px;
  background: #e9b44c;
  color: #111814;
}
```

- [ ] **Step 5: Verify profile tests pass**

Run:

```bash
npm run test -- src/components/DestinationProfile.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/DestinationProfile.tsx src/components/DestinationProfile.test.tsx src/styles.css
git commit -m "feat: add destination profile editor"
```

---

## Task 10: Add Route Leg Editor And Itinerary Panel

**Files:**
- Create: `src/components/RouteLegEditor.tsx`
- Create: `src/components/ItineraryPanel.tsx`
- Create: `src/components/RouteLegEditor.test.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Write failing route editor test**

Create `src/components/RouteLegEditor.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createDestination } from '../domain/destinations';
import { RouteLegEditor } from './RouteLegEditor';

describe('RouteLegEditor', () => {
  it('creates a ferry/shipping route leg between two destinations', async () => {
    const origin = createDestination({ name: 'Panama City', coordinates: { lat: 8.9824, lng: -79.5199 } });
    const target = createDestination({ name: 'Cartagena', coordinates: { lat: 10.391, lng: -75.4794 } });
    const onCreateRouteLeg = vi.fn();

    render(
      <RouteLegEditor
        destinations={[origin, target]}
        onCreateRouteLeg={onCreateRouteLeg}
      />,
    );

    await userEvent.selectOptions(screen.getByLabelText('Origin'), origin.id);
    await userEvent.selectOptions(screen.getByLabelText('Target'), target.id);
    await userEvent.selectOptions(screen.getByLabelText('Leg type'), 'ferry-shipping');
    await userEvent.type(screen.getByLabelText('Route notes'), 'Darién Gap shipping leg.');
    await userEvent.click(screen.getByRole('button', { name: 'Add route leg' }));

    expect(onCreateRouteLeg).toHaveBeenCalledWith({
      originDestinationId: origin.id,
      targetDestinationId: target.id,
      type: 'ferry-shipping',
      notes: 'Darién Gap shipping leg.',
    });
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm run test -- src/components/RouteLegEditor.test.tsx
```

Expected: FAIL because `RouteLegEditor.tsx` does not exist.

- [ ] **Step 3: Add route editor**

Create `src/components/RouteLegEditor.tsx`:

```tsx
import { useState } from 'react';
import type { Destination, RouteLegType } from '../domain/types';

type RouteLegEditorProps = {
  destinations: Destination[];
  onCreateRouteLeg: (input: {
    originDestinationId: string;
    targetDestinationId: string;
    type: RouteLegType;
    notes: string;
  }) => Promise<void> | void;
};

export function RouteLegEditor({ destinations, onCreateRouteLeg }: RouteLegEditorProps) {
  const [originDestinationId, setOriginDestinationId] = useState('');
  const [targetDestinationId, setTargetDestinationId] = useState('');
  const [type, setType] = useState<RouteLegType>('driving');
  const [notes, setNotes] = useState('');

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!originDestinationId || !targetDestinationId || originDestinationId === targetDestinationId) return;
    await onCreateRouteLeg({ originDestinationId, targetDestinationId, type, notes });
    setNotes('');
  }

  return (
    <form className="route-leg-editor" onSubmit={handleSubmit}>
      <label>
        Origin
        <select value={originDestinationId} onChange={(event) => setOriginDestinationId(event.target.value)}>
          <option value="">Choose origin</option>
          {destinations.map((destination) => (
            <option key={destination.id} value={destination.id}>
              {destination.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Target
        <select value={targetDestinationId} onChange={(event) => setTargetDestinationId(event.target.value)}>
          <option value="">Choose target</option>
          {destinations.map((destination) => (
            <option key={destination.id} value={destination.id}>
              {destination.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Leg type
        <select value={type} onChange={(event) => setType(event.target.value as RouteLegType)}>
          <option value="driving">Driving</option>
          <option value="ferry-shipping">Ferry/shipping</option>
          <option value="uncertain">Uncertain/manual</option>
        </select>
      </label>
      <label>
        Route notes
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
      </label>
      <button type="submit">Add route leg</button>
    </form>
  );
}
```

- [ ] **Step 4: Add itinerary panel**

Create `src/components/ItineraryPanel.tsx`:

```tsx
import type { Destination, RouteLeg } from '../domain/types';
import { RouteLegEditor } from './RouteLegEditor';

type ItineraryPanelProps = {
  destinations: Destination[];
  routeLegs: RouteLeg[];
  selectedDestinationId: string | null;
  onSelectDestination: (destinationId: string) => void;
  onCreateRouteLeg: Parameters<typeof RouteLegEditor>[0]['onCreateRouteLeg'];
};

export function ItineraryPanel({
  destinations,
  routeLegs,
  selectedDestinationId,
  onSelectDestination,
  onCreateRouteLeg,
}: ItineraryPanelProps) {
  return (
    <aside className="itinerary-panel" aria-label="Itinerary">
      <h2>Stops</h2>
      <div className="stop-list">
        {destinations.length === 0 ? <p>Add your first destination from the map search.</p> : null}
        {destinations.map((destination, index) => (
          <button
            key={destination.id}
            type="button"
            className={destination.id === selectedDestinationId ? 'is-selected' : ''}
            onClick={() => onSelectDestination(destination.id)}
          >
            <span>{String(index + 1).padStart(2, '0')}</span>
            <strong>{destination.name}</strong>
            <small>{destination.countryRegion || 'Unassigned region'}</small>
          </button>
        ))}
      </div>
      <h2>Routes</h2>
      <p className="route-summary">{routeLegs.length} route {routeLegs.length === 1 ? 'leg' : 'legs'}</p>
      <RouteLegEditor destinations={destinations} onCreateRouteLeg={onCreateRouteLeg} />
    </aside>
  );
}
```

- [ ] **Step 5: Add itinerary styles**

Append to `src/styles.css`:

```css
.itinerary-panel {
  position: absolute;
  left: 16px;
  bottom: 16px;
  z-index: 9;
  display: grid;
  width: min(360px, calc(100vw - 32px));
  max-height: 46vh;
  gap: 12px;
  overflow: auto;
  padding: 14px;
  border: 1px solid rgba(245, 239, 227, 0.14);
  border-radius: 8px;
  background: rgba(17, 24, 20, 0.84);
  backdrop-filter: blur(16px);
}

.itinerary-panel h2 {
  margin: 0;
  font-size: 0.92rem;
}

.stop-list {
  display: grid;
  gap: 7px;
}

.stop-list button {
  display: grid;
  grid-template-columns: 34px 1fr;
  gap: 2px 8px;
  padding: 9px;
  border: 1px solid rgba(245, 239, 227, 0.12);
  border-radius: 6px;
  color: #f5efe3;
  background: rgba(255, 255, 255, 0.06);
  text-align: left;
  cursor: pointer;
}

.stop-list button.is-selected {
  border-color: rgba(233, 180, 76, 0.72);
}

.stop-list span {
  grid-row: span 2;
  color: rgba(245, 239, 227, 0.48);
}

.stop-list small {
  color: rgba(245, 239, 227, 0.55);
}

.route-leg-editor {
  display: grid;
  gap: 9px;
}

.route-leg-editor label {
  display: grid;
  gap: 5px;
  color: rgba(245, 239, 227, 0.7);
  font-size: 0.78rem;
}

.route-leg-editor select,
.route-leg-editor textarea {
  border: 1px solid rgba(245, 239, 227, 0.15);
  border-radius: 6px;
  padding: 8px;
  color: #f5efe3;
  background: rgba(255, 255, 255, 0.07);
}

.route-leg-editor button {
  padding: 9px 10px;
  border: 1px solid rgba(245, 239, 227, 0.15);
  border-radius: 6px;
  color: #111814;
  background: #e9b44c;
  cursor: pointer;
}

.route-summary {
  margin: 0;
  color: rgba(245, 239, 227, 0.62);
}
```

- [ ] **Step 6: Verify route editor test passes**

Run:

```bash
npm run test -- src/components/RouteLegEditor.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/RouteLegEditor.tsx src/components/RouteLegEditor.test.tsx src/components/ItineraryPanel.tsx src/styles.css
git commit -m "feat: add itinerary and route editor"
```

---

## Task 11: Wire The App Together

**Files:**
- Modify: `src/App.tsx`
- Create: `src/App.test.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Write failing app integration test**

Create `src/App.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import App from './App';

vi.mock('./adapters/geocoding', () => ({
  searchNominatimPlaces: vi.fn().mockResolvedValue([
    {
      id: 'istanbul',
      label: 'Istanbul, Turkey',
      countryRegion: 'Turkey',
      coordinates: { lat: 41.0082, lng: 28.9784 },
    },
  ]),
}));

vi.mock('maplibre-gl', () => ({
  default: {
    Map: vi.fn(() => ({
      on: vi.fn(),
      off: vi.fn(),
      remove: vi.fn(),
      addControl: vi.fn(),
    })),
    NavigationControl: vi.fn(),
  },
}));

describe('App', () => {
  it('adds a searched destination and opens its profile', async () => {
    render(<App />);
    await waitFor(() => expect(screen.queryByText('Loading trip data')).not.toBeInTheDocument());

    await userEvent.type(screen.getByLabelText('Search for a destination'), 'Istanbul');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Add Istanbul, Turkey' }));
    await userEvent.click(screen.getByRole('button', { name: 'Select Istanbul' }));

    expect(screen.getByRole('complementary', { name: 'Istanbul profile' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm run test -- src/App.test.tsx
```

Expected: FAIL because `App.tsx` is still the neutral shell.

- [ ] **Step 3: Wire app state, map, toolbar, profile, and itinerary**

Replace `src/App.tsx` with:

```tsx
import { useMemo, useState } from 'react';
import { searchNominatimPlaces } from './adapters/geocoding';
import { parseTripSnapshot, serializeTripSnapshot } from './domain/snapshots';
import type { Coordinates, Destination } from './domain/types';
import { DestinationProfile } from './components/DestinationProfile';
import { ItineraryPanel } from './components/ItineraryPanel';
import { MapCanvas } from './components/MapCanvas';
import { TopToolbar } from './components/TopToolbar';
import { useTripData } from './hooks/useTripData';
import { tripDb } from './storage/tripDb';
import { createTripRepository } from './storage/tripRepository';
import './styles.css';

const repository = createTripRepository(tripDb);

export default function App() {
  const tripData = useTripData(repository);
  const [selectedDestinationId, setSelectedDestinationId] = useState<string | null>(null);

  const selectedDestination = useMemo(
    () =>
      selectedDestinationId
        ? tripData.destinations.find((destination) => destination.id === selectedDestinationId) ?? null
        : null,
    [selectedDestinationId, tripData.destinations],
  );

  async function handleAddDestination(input: {
    name: string;
    countryRegion?: string;
    coordinates: Coordinates;
  }) {
    const destination = await tripData.addDestination(input);
    setSelectedDestinationId(destination.id);
  }

  async function handleImportText(text: string) {
    const snapshot = parseTripSnapshot(text);
    await repository.replaceTripData(snapshot);
    await tripData.reload();
    setSelectedDestinationId(snapshot.destinations[0]?.id ?? null);
  }

  function handleExport() {
    const json = serializeTripSnapshot({
      destinations: tripData.destinations,
      routeLegs: tripData.routeLegs,
    });
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'world-tour-planner.json';
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="app-shell">
      <section className="map-stage" aria-label="World tour map workspace">
        <MapCanvas
          destinations={tripData.destinations}
          routeLegs={tripData.routeLegs}
          selectedDestinationId={selectedDestinationId}
          onSelectDestination={setSelectedDestinationId}
          onDropPin={(coordinates) =>
            void handleAddDestination({
              name: `Dropped pin ${tripData.destinations.length + 1}`,
              coordinates,
            })
          }
        />
        <TopToolbar
          searchPlaces={searchNominatimPlaces}
          onAddDestination={handleAddDestination}
          onExport={handleExport}
          onImportText={handleImportText}
        />
        <ItineraryPanel
          destinations={tripData.destinations}
          routeLegs={tripData.routeLegs}
          selectedDestinationId={selectedDestinationId}
          onSelectDestination={setSelectedDestinationId}
          onCreateRouteLeg={tripData.addRouteLeg}
        />
        {selectedDestination ? (
          <DestinationProfile
            destination={selectedDestination as Destination}
            onUpdate={tripData.updateDestination}
            onClose={() => setSelectedDestinationId(null)}
          />
        ) : null}
        {tripData.isLoading ? <div className="app-status">Loading trip data</div> : null}
        {tripData.error ? <div className="app-error">{tripData.error}</div> : null}
      </section>
    </main>
  );
}
```

- [ ] **Step 4: Add app status styles**

Append to `src/styles.css`:

```css
.app-status,
.app-error {
  position: absolute;
  right: 18px;
  top: 18px;
  z-index: 20;
  padding: 9px 11px;
  border: 1px solid rgba(245, 239, 227, 0.14);
  border-radius: 6px;
  background: rgba(17, 24, 20, 0.88);
}

.app-error {
  color: #ffcfba;
}

@media (max-width: 760px) {
  .top-toolbar {
    right: 12px;
    left: 12px;
    flex-wrap: wrap;
  }

  .search-group {
    flex: 1 1 100%;
  }

  .search-group input {
    width: 100%;
    min-width: 0;
  }

  .itinerary-panel {
    right: 12px;
    left: 12px;
    width: auto;
    max-height: 34vh;
  }

  .destination-profile {
    inset: 12px;
    width: auto;
  }
}
```

- [ ] **Step 5: Verify app integration test passes**

Run:

```bash
npm run test -- src/App.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Run full unit/component suite**

Run:

```bash
npm run test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx src/App.test.tsx src/styles.css
git commit -m "feat: wire map planning workspace"
```

---

## Task 12: Add Browser Smoke Test And Visual Verification

**Files:**
- Create: `tests/world-tour.spec.ts`
- Modify: `.gitignore`

- [ ] **Step 1: Add Playwright smoke test**

Create `tests/world-tour.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

test('adds a destination and edits its profile', async ({ page }) => {
  await page.route('https://nominatim.openstreetmap.org/**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([
        {
          place_id: 1,
          display_name: 'Istanbul, Turkey',
          lat: '41.0082',
          lon: '28.9784',
        },
      ]),
    });
  });

  await page.goto('/');

  await expect(page.getByLabel('Interactive world tour map')).toBeVisible();
  await page.getByLabel('Search for a destination').fill('Istanbul');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('button', { name: 'Add Istanbul, Turkey' }).click();
  await page.getByRole('button', { name: 'Select Istanbul' }).click();
  await expect(page.getByRole('complementary', { name: 'Istanbul profile' })).toBeVisible();
  await page.getByLabel('Why it matters').fill('Gateway from Europe toward Asia.');
  await page.getByRole('button', { name: 'Save destination' }).click();
  await expect(page.getByLabel('Why it matters')).toHaveValue('Gateway from Europe toward Asia.');
});
```

- [ ] **Step 2: Ensure Playwright output is ignored**

Add these lines to `.gitignore`:

```gitignore
test-results/
playwright-report/
```

- [ ] **Step 3: Run all automated checks**

Run:

```bash
npm run test
npm run build
npm run test:e2e
```

Expected: all commands exit with code 0.

- [ ] **Step 4: Start local dev server for manual review**

Run:

```bash
npm run dev
```

Expected: Vite serves the app at `http://127.0.0.1:5173`.

- [ ] **Step 5: Manual verification checklist**

Open `http://127.0.0.1:5173` and verify:

- The first screen is the map workspace, not a landing page.
- The map pans and zooms.
- Search can add a destination.
- Double-clicking the map creates a dropped-pin destination.
- Clicking a pin opens the structured destination profile.
- Saving profile edits persists after reload.
- Two destinations can be connected with a route leg.
- Driving, ferry/shipping, and uncertain route leg choices are available.
- The itinerary panel remains secondary to the map.
- The layout remains usable around `390px` wide and desktop width.

- [ ] **Step 6: Commit**

```bash
git add tests/world-tour.spec.ts .gitignore
git commit -m "test: add world tour smoke test"
```

---

## Self-Review

Spec coverage:

- Blank map, pan, and zoom: Task 7 and Task 12.
- Custom look and feel: Tasks 7 through 11 add the initial visual system; Task 12 verifies layout manually.
- Add destination by search or pin: Tasks 8 and 11.
- Local destination storage: Tasks 3 and 5.
- Structured destination profile: Tasks 2 and 9.
- Route legs and route types: Tasks 2 and 10.
- Secondary itinerary view: Task 10.
- JSON import/export: Tasks 4, 8, and 11.
- API adapters: Task 6.
- Automated verification: Tasks 2 through 12.

Intentional PoC limits:

- The plan uses approximate manual route lines first.
- The plan stores image fields in the destination model but does not add binary image upload in this first pass.
- The first map style uses MapLibre demo tiles, with custom pins, panels, and route styling as the immediate visual surface.
