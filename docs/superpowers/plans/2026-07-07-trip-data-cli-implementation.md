# Trip Data CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a CLI-first, chat-compatible trip command layer that lets agents read and safely write trips, stops, stop links, activities, and activity links while the app derives routes and refreshes automatically.

**Architecture:** Add a command/service layer above the existing trip directory and trip repository abstractions. Extract non-React route orchestration from `useTripData` so both the app and CLI use the same stop-order and route-leg rules. Add Supabase realtime subscriptions to the app so CLI writes appear without a browser refresh.

**Tech Stack:** TypeScript, React, Vite, Vitest, Supabase JS, MapTiler geocoding, OpenRouteService routing, `tsx` for the local TypeScript CLI.

## Global Constraints

- CLI first, chat-compatible later.
- Agents manipulate trip commands, not database tables.
- Stops are the primary writable route data.
- Route legs are derived from ordered adjacent stops.
- Links and activities are authored through explicit commands, not bundled into stop creation.
- In itinerary-style source material, overnight locations are route stops; non-overnight places to visit are activities under the relevant stop.
- Image automation is separate from core trip/stop authoring and must require explicit user confirmation.
- Command inputs and outputs are structured JSON with stable schemas.
- Every write command supports dry-run validation.
- The open app updates automatically after CLI writes.
- Supabase-backed trip data is the v1 target. Local/e2e storage remains available for tests.
- Stop notes map to `Destination.research.notes`; stop notes UI is out of scope for this implementation because it is being handled separately.
- Date and time fields are not structured in v1.
- Do not touch unrelated working tree changes. At plan-writing time, `supabase/migrations/20260707205357_qualify_trip_media_storage_object_name.sql` is untracked and should be left alone unless the user explicitly asks.

---

## File Structure

Create:

- `src/tripCommands/types.ts`  
  Command input/output types, draft types, result summaries, and dependency interfaces.

- `src/tripCommands/validation.ts`  
  Manual validators and normalizers for command inputs. No new schema dependency.

- `src/tripCommands/placeResolver.ts`  
  Converts `PlaceInput` into destination/activity location fields using MapTiler when possible and legacy/manual fallbacks when allowed.

- `src/tripCommands/linkEnrichment.ts`  
  Converts URL-only link drafts into `ResearchLink` objects using the existing URL helpers and optional preview client.

- `src/tripCommands/routeOrchestration.ts`  
  Shared non-React stop ordering, route reconciliation, route calculation, and route persistence logic extracted from `useTripData`.

- `src/tripCommands/tripDataService.ts`  
  The command API implementation for trips, stops, stop links, activities, and activity links.

- `src/tripCommands/*.test.ts`  
  Unit and service tests colocated with the command modules.

- `src/cli/trip.ts`  
  CLI entry point and argument parsing.

- `src/cli/nodeSupabase.ts`  
  Node-friendly Supabase client creation using `process.env` and anonymous auth.

- `src/cli/tripCli.test.ts`  
  CLI argument/output tests around mocked service calls.

- `src/storage/tripRealtime.ts`  
  Browser Supabase realtime subscription helpers.

- `src/storage/tripRealtime.test.ts`  
  Unit tests for subscription wiring and debounce behavior.

Modify:

- `package.json` and `package-lock.json`  
  Add CLI script and CLI runtime dependency.

- `src/hooks/useTripData.ts`  
  Delegate route orchestration to shared utilities and keep the existing hook API.

- `src/hooks/useTripWorkspace.ts`  
  Support refreshing the trip directory and reacting when the active trip is deleted.

- `src/storage/appRepository.ts`  
  Return optional realtime subscription hooks from Supabase-backed storage.

- `src/App.tsx`  
  Wire workspace and active-trip realtime refresh into the app.

- `docs/superpowers/specs/2026-07-07-trip-data-cli-design.md`  
  Only if implementation discovers a necessary contract correction.

- `.env.example`  
  Only if the CLI requires an environment variable not already documented.

Do not modify:

- Stop notes UI. Stop notes storage support is in scope; surfacing it visually is a separate user-owned change.

---

### Task 1: Command Types And Validation

**Files:**
- Create: `src/tripCommands/types.ts`
- Create: `src/tripCommands/validation.ts`
- Test: `src/tripCommands/validation.test.ts`

**Interfaces:**
- Produces:
  - `type PlaceInput = { query?: string; coordinates?: Coordinates }`
  - `type StopDraft`
  - `type StopPatch`
  - `type ActivityDraft`
  - `type ActivityPatch`
  - `type CommandResult<T>`
  - `class TripCommandValidationError extends Error`
  - `function validateStopDraft(input: unknown, path?: string): StopDraft`
  - `function validateStopPatch(input: unknown, path?: string): StopPatch`
  - `function validateActivityDraft(input: unknown, path?: string): ActivityDraft`
  - `function validateActivityPatch(input: unknown, path?: string): ActivityPatch`
  - `function validateUrlInput(input: unknown, path?: string): string`

- Consumes:
  - `Coordinates`, `DestinationStatus`, `Priority`, `ActivityLocation` from `src/domain/types.ts`

- Later tasks rely on exact names exported above.

- [ ] **Step 1: Write failing validation tests**

Create `src/tripCommands/validation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  TripCommandValidationError,
  validateActivityDraft,
  validateActivityPatch,
  validateStopDraft,
  validateStopPatch,
  validateUrlInput,
} from './validation';

describe('trip command validation', () => {
  it('accepts a stop draft with coordinates and notes', () => {
    expect(validateStopDraft({
      name: 'Kyle of Tongue Hostel & Holiday Park',
      place: {
        query: 'Kyle of Tongue Hostel & Holiday Park',
        coordinates: { lat: 58.492089, lng: -4.427364 },
      },
      expectedStayDays: 1,
      notes: 'Booked. Ref: WTB10B2DD9',
      tags: ['camping'],
    })).toEqual({
      name: 'Kyle of Tongue Hostel & Holiday Park',
      place: {
        query: 'Kyle of Tongue Hostel & Holiday Park',
        coordinates: { lat: 58.492089, lng: -4.427364 },
      },
      expectedStayDays: 1,
      notes: 'Booked. Ref: WTB10B2DD9',
      tags: ['camping'],
    });
  });

  it('requires stop drafts to include a place query or coordinates', () => {
    expect(() => validateStopDraft({ name: 'Lisbon' })).toThrow(TripCommandValidationError);
    expect(() => validateStopDraft({ name: 'Lisbon' })).toThrow(
      "Stop 'Lisbon' needs place coordinates or a place query before it can be added.",
    );
  });

  it('rejects invalid coordinates', () => {
    expect(() => validateStopDraft({
      name: 'Bad stop',
      place: { coordinates: { lat: 100, lng: 0 } },
    })).toThrow('Latitude must be between -90 and 90.');
  });

  it('accepts an empty activity place but requires a title', () => {
    expect(validateActivityDraft({ title: 'Smoo Cave' })).toEqual({
      title: 'Smoo Cave',
    });
    expect(() => validateActivityDraft({ title: '' })).toThrow('Activity title is required.');
  });

  it('accepts activity details currently surfaced in the panel', () => {
    expect(validateActivityPatch({
      description: 'Sea cave near Durness.',
      notes: 'Check tour status before going.',
      tags: ['cave', 'outdoors'],
      place: { query: 'Smoo Cave, Durness' },
    })).toEqual({
      description: 'Sea cave near Durness.',
      notes: 'Check tour status before going.',
      tags: ['cave', 'outdoors'],
      place: { query: 'Smoo Cave, Durness' },
    });
  });

  it('requires stop patches to include at least one field', () => {
    expect(() => validateStopPatch({})).toThrow('Stop patch must include at least one field.');
  });

  it('normalizes URL input to http or https', () => {
    expect(validateUrlInput('example.com/nc500')).toBe('https://example.com/nc500');
    expect(() => validateUrlInput('ftp://example.com/file')).toThrow('Links must use http or https.');
  });
});
```

- [ ] **Step 2: Run the failing validation tests**

Run:

```bash
npm test -- src/tripCommands/validation.test.ts
```

Expected: FAIL because `src/tripCommands/validation.ts` does not exist.

- [ ] **Step 3: Add command types**

Create `src/tripCommands/types.ts`:

```ts
import type { Coordinates, ResearchLink } from '../domain/types';
import type { TripRepository } from '../storage/tripRepository';
import type { TripDirectoryRepository, TripSummary } from '../storage/tripDirectoryRepository';

export type PlaceInput = {
  query?: string;
  coordinates?: Coordinates;
};

export type StopDraft = {
  id?: string;
  name: string;
  place: PlaceInput;
  expectedStayDays?: number;
  notes?: string;
  tags?: string[];
};

export type StopPatch = Partial<Omit<StopDraft, 'id'>> & {
  place?: PlaceInput;
};

export type ActivityDraft = {
  title: string;
  place?: PlaceInput;
};

export type ActivityPatch = {
  title?: string;
  description?: string;
  notes?: string;
  tags?: string[];
  place?: PlaceInput;
};

export type CommandError = {
  code: string;
  message: string;
  path?: string;
};

export type CommandResult<T> =
  | ({ ok: true; summary: string } & T)
  | { ok: false; error: CommandError };

export type ChangedSummary = {
  tripsCreated: string[];
  tripsDeleted: string[];
  stopsAdded: string[];
  stopsUpdated: string[];
  stopsDeleted: string[];
  activitiesAdded: string[];
  activitiesUpdated: string[];
  activitiesDeleted: string[];
  linksAdded: string[];
  linksDeleted: string[];
  routesRecalculated: number;
};

export type TripDataServiceDependencies = {
  directory: TripDirectoryRepository;
  createTripRepository: (tripId: string) => TripRepository;
  calculateRoute?: RouteCalculator;
  resolvePlace?: PlaceResolver;
  enrichLink?: LinkEnricher;
};

export type RouteCalculator = (input: {
  origin: Coordinates;
  target: Coordinates;
  profile: 'driving-car';
}) => Promise<{
  distanceKm: number;
  travelTimeHours: number;
  geometry: GeoJSON.LineString;
  provider: string;
  profile: 'driving-car';
}>;

export type PlaceResolver = (input: {
  place: PlaceInput;
  profile: 'stop' | 'activity';
  fallbackName: string;
}) => Promise<{
  coordinates: Coordinates;
  location?: import('../domain/types').DestinationLocation;
  activityLocation?: import('../domain/types').ActivityLocation;
}>;

export type LinkEnricher = (url: string, sortOrder: number) => Promise<ResearchLink>;

export type TripWithData = {
  trip: TripSummary;
  stops: import('../domain/types').Destination[];
  routeLegs: import('../domain/types').RouteLeg[];
  activitiesByStopId?: Record<string, import('../domain/types').Activity[]>;
};
```

- [ ] **Step 4: Add validators**

Create `src/tripCommands/validation.ts`:

```ts
import { normalizeResearchLinkUrl } from '../domain/researchLinks';
import type { Coordinates } from '../domain/types';
import type { ActivityDraft, ActivityPatch, PlaceInput, StopDraft, StopPatch } from './types';

export class TripCommandValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly path?: string,
  ) {
    super(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new TripCommandValidationError('INVALID_STRING', `${path} must be a string.`, path);
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function requiredString(value: unknown, label: string, path: string) {
  const trimmed = optionalString(value, path);
  if (!trimmed) {
    throw new TripCommandValidationError('REQUIRED_STRING', `${label} is required.`, path);
  }
  return trimmed;
}

function optionalStringArray(value: unknown, path: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new TripCommandValidationError('INVALID_STRING_ARRAY', `${path} must be an array of strings.`, path);
  }
  return value
    .map((item, index) => requiredString(item, `${path}[${index}]`, `${path}[${index}]`))
    .filter((item, index, array) => array.indexOf(item) === index);
}

function optionalPositiveInteger(value: unknown, path: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new TripCommandValidationError('INVALID_POSITIVE_INTEGER', `${path} must be a positive integer.`, path);
  }
  return Math.floor(parsed);
}

function validateCoordinates(value: unknown, path: string): Coordinates | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new TripCommandValidationError('INVALID_COORDINATES', `${path} must include lat and lng.`, path);
  }
  const lat = Number(value.lat);
  const lng = Number(value.lng);
  if (!Number.isFinite(lat)) {
    throw new TripCommandValidationError('INVALID_LATITUDE', 'Latitude must be a number.', `${path}.lat`);
  }
  if (!Number.isFinite(lng)) {
    throw new TripCommandValidationError('INVALID_LONGITUDE', 'Longitude must be a number.', `${path}.lng`);
  }
  if (lat < -90 || lat > 90) {
    throw new TripCommandValidationError('INVALID_LATITUDE', 'Latitude must be between -90 and 90.', `${path}.lat`);
  }
  if (lng < -180 || lng > 180) {
    throw new TripCommandValidationError('INVALID_LONGITUDE', 'Longitude must be between -180 and 180.', `${path}.lng`);
  }
  return { lat, lng };
}

export function validatePlaceInput(value: unknown, path: string, options: { required: boolean }): PlaceInput | undefined {
  if (value === undefined) {
    if (options.required) {
      throw new TripCommandValidationError('STOP_LOCATION_REQUIRED', 'Place input is required.', path);
    }
    return undefined;
  }
  if (!isRecord(value)) {
    throw new TripCommandValidationError('INVALID_PLACE', `${path} must be an object.`, path);
  }
  const place = {
    query: optionalString(value.query, `${path}.query`),
    coordinates: validateCoordinates(value.coordinates, `${path}.coordinates`),
  };
  if (!place.query && !place.coordinates) {
    throw new TripCommandValidationError('PLACE_REQUIRED', `${path} needs coordinates or a query.`, path);
  }
  return place;
}

export function validateStopDraft(input: unknown, path = 'stop'): StopDraft {
  if (!isRecord(input)) {
    throw new TripCommandValidationError('INVALID_STOP', `${path} must be an object.`, path);
  }
  const name = requiredString(input.name, 'Stop name', `${path}.name`);
  const place = validatePlaceInput(input.place, `${path}.place`, { required: true });
  if (!place) {
    throw new TripCommandValidationError(
      'STOP_LOCATION_REQUIRED',
      `Stop '${name}' needs place coordinates or a place query before it can be added.`,
      path,
    );
  }
  return {
    ...(optionalString(input.id, `${path}.id`) ? { id: optionalString(input.id, `${path}.id`) } : {}),
    name,
    place,
    ...(optionalPositiveInteger(input.expectedStayDays, `${path}.expectedStayDays`) ? {
      expectedStayDays: optionalPositiveInteger(input.expectedStayDays, `${path}.expectedStayDays`),
    } : {}),
    ...(optionalString(input.notes, `${path}.notes`) ? { notes: optionalString(input.notes, `${path}.notes`) } : {}),
    ...(optionalStringArray(input.tags, `${path}.tags`) ? { tags: optionalStringArray(input.tags, `${path}.tags`) } : {}),
  };
}

export function validateStopPatch(input: unknown, path = 'patch'): StopPatch {
  if (!isRecord(input)) {
    throw new TripCommandValidationError('INVALID_STOP_PATCH', `${path} must be an object.`, path);
  }
  const patch: StopPatch = {};
  const name = optionalString(input.name, `${path}.name`);
  const place = validatePlaceInput(input.place, `${path}.place`, { required: false });
  const expectedStayDays = optionalPositiveInteger(input.expectedStayDays, `${path}.expectedStayDays`);
  const notes = optionalString(input.notes, `${path}.notes`);
  const tags = optionalStringArray(input.tags, `${path}.tags`);
  if (name !== undefined) patch.name = name;
  if (place !== undefined) patch.place = place;
  if (expectedStayDays !== undefined) patch.expectedStayDays = expectedStayDays;
  if (notes !== undefined) patch.notes = notes;
  if (tags !== undefined) patch.tags = tags;
  if (Object.keys(patch).length === 0) {
    throw new TripCommandValidationError('EMPTY_STOP_PATCH', 'Stop patch must include at least one field.', path);
  }
  return patch;
}

export function validateActivityDraft(input: unknown, path = 'activity'): ActivityDraft {
  if (!isRecord(input)) {
    throw new TripCommandValidationError('INVALID_ACTIVITY', `${path} must be an object.`, path);
  }
  return {
    title: requiredString(input.title, 'Activity title', `${path}.title`),
    ...(validatePlaceInput(input.place, `${path}.place`, { required: false }) ? {
      place: validatePlaceInput(input.place, `${path}.place`, { required: false }),
    } : {}),
  };
}

export function validateActivityPatch(input: unknown, path = 'patch'): ActivityPatch {
  if (!isRecord(input)) {
    throw new TripCommandValidationError('INVALID_ACTIVITY_PATCH', `${path} must be an object.`, path);
  }
  const patch: ActivityPatch = {};
  const title = optionalString(input.title, `${path}.title`);
  const description = optionalString(input.description, `${path}.description`);
  const notes = optionalString(input.notes, `${path}.notes`);
  const tags = optionalStringArray(input.tags, `${path}.tags`);
  const place = validatePlaceInput(input.place, `${path}.place`, { required: false });
  if (title !== undefined) patch.title = title;
  if (description !== undefined) patch.description = description;
  if (notes !== undefined) patch.notes = notes;
  if (tags !== undefined) patch.tags = tags;
  if (place !== undefined) patch.place = place;
  if (Object.keys(patch).length === 0) {
    throw new TripCommandValidationError('EMPTY_ACTIVITY_PATCH', 'Activity patch must include at least one field.', path);
  }
  return patch;
}

export function validateUrlInput(input: unknown, path = 'url') {
  if (typeof input !== 'string') {
    throw new TripCommandValidationError('INVALID_URL', `${path} must be a string.`, path);
  }
  return normalizeResearchLinkUrl(input);
}
```

- [ ] **Step 5: Run validation tests**

Run:

```bash
npm test -- src/tripCommands/validation.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/tripCommands/types.ts src/tripCommands/validation.ts src/tripCommands/validation.test.ts
git commit -m "feat: add trip command validation"
```

---

### Task 2: Place And Link Enrichment

**Files:**
- Create: `src/tripCommands/placeResolver.ts`
- Create: `src/tripCommands/linkEnrichment.ts`
- Test: `src/tripCommands/placeResolver.test.ts`
- Test: `src/tripCommands/linkEnrichment.test.ts`

**Interfaces:**
- Consumes:
  - `PlaceInput`, `LinkEnricher`, `PlaceResolver` from Task 1.
  - `searchMapTilerPlaces`, `resolveMapTilerCoordinates` from `src/adapters/geocoding.ts`.
  - `createFallbackResearchLink` from `src/domain/researchLinks.ts`.
- Produces:
  - `function createPlaceResolver(options: { apiKey?: string }): PlaceResolver`
  - `function createLinkEnricher(previewClient?: LinkPreviewClient): LinkEnricher`

- [ ] **Step 1: Write place resolver tests**

Create `src/tripCommands/placeResolver.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createPlaceResolver } from './placeResolver';

vi.mock('../adapters/geocoding', () => ({
  searchMapTilerPlaces: vi.fn(async () => [{
    kind: 'place',
    id: 'maptiler:lisbon',
    label: 'Lisbon, Portugal',
    coordinates: { lat: 38.7223, lng: -9.1393 },
    location: {
      placeName: 'Lisbon',
      regionName: 'Lisbon',
      countryName: 'Portugal',
      countryCode: 'PT',
      sourceLabel: 'Lisbon, Portugal',
      sourceProvider: 'maptiler',
      sourceFeatureId: 'maptiler:lisbon',
    },
  }]),
  resolveMapTilerCoordinates: vi.fn(async () => ({
    kind: 'place',
    id: 'maptiler:coords',
    label: 'Kyle of Tongue Hostel & Holiday Park, Scotland',
    coordinates: { lat: 58.492089, lng: -4.427364 },
    location: {
      placeName: 'Kyle of Tongue Hostel & Holiday Park',
      regionName: 'Highland',
      countryName: 'Scotland',
      countryCode: 'GB',
      sourceLabel: 'Kyle of Tongue Hostel & Holiday Park, Scotland',
      sourceProvider: 'maptiler',
      sourceFeatureId: 'maptiler:coords',
    },
  })),
}));

describe('createPlaceResolver', () => {
  it('resolves query-only stops through MapTiler', async () => {
    const resolver = createPlaceResolver({ apiKey: 'key' });
    await expect(resolver({
      place: { query: 'Lisbon, Portugal' },
      profile: 'stop',
      fallbackName: 'Lisbon',
    })).resolves.toMatchObject({
      coordinates: { lat: 38.7223, lng: -9.1393 },
      location: { countryName: 'Portugal' },
    });
  });

  it('uses coordinates as the route anchor and enriches them when possible', async () => {
    const resolver = createPlaceResolver({ apiKey: 'key' });
    await expect(resolver({
      place: { coordinates: { lat: 58.492089, lng: -4.427364 } },
      profile: 'stop',
      fallbackName: 'Tongue',
    })).resolves.toMatchObject({
      coordinates: { lat: 58.492089, lng: -4.427364 },
      location: { placeName: 'Kyle of Tongue Hostel & Holiday Park' },
    });
  });

  it('falls back to legacy destination location when coordinates are present and MapTiler is unavailable', async () => {
    const resolver = createPlaceResolver({});
    await expect(resolver({
      place: { coordinates: { lat: 58.492089, lng: -4.427364 } },
      profile: 'stop',
      fallbackName: 'Tongue',
    })).resolves.toEqual({
      coordinates: { lat: 58.492089, lng: -4.427364 },
      location: {
        placeName: 'Tongue',
        regionName: '',
        countryName: '',
        sourceLabel: 'Tongue',
        sourceProvider: 'legacy',
      },
    });
  });

  it('rejects query-only place input without a MapTiler API key', async () => {
    const resolver = createPlaceResolver({});
    await expect(resolver({
      place: { query: 'Lisbon, Portugal' },
      profile: 'stop',
      fallbackName: 'Lisbon',
    })).rejects.toThrow('MapTiler API key is required to resolve place queries.');
  });
});
```

- [ ] **Step 2: Write link enrichment tests**

Create `src/tripCommands/linkEnrichment.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createLinkEnricher } from './linkEnrichment';

describe('createLinkEnricher', () => {
  it('uses preview metadata when available', async () => {
    const previewClient = {
      fetchPreview: vi.fn(async () => ({
        title: 'Alnwick Castle',
        url: 'https://www.alnwickcastle.com/',
        domain: 'alnwickcastle.com',
        imageUrl: 'https://www.alnwickcastle.com/preview.jpg',
      })),
    };
    const link = await createLinkEnricher(previewClient)('www.alnwickcastle.com', 2);
    expect(link).toMatchObject({
      title: 'Alnwick Castle',
      url: 'https://www.alnwickcastle.com/',
      domain: 'alnwickcastle.com',
      imageUrl: 'https://www.alnwickcastle.com/preview.jpg',
      sortOrder: 2,
    });
    expect(link.id).toEqual(expect.any(String));
  });

  it('falls back to a domain link when preview fails', async () => {
    const previewClient = {
      fetchPreview: vi.fn(async () => {
        throw new Error('Preview failed');
      }),
    };
    const link = await createLinkEnricher(previewClient)('https://northcoastseatours.co.uk/', 0);
    expect(link).toMatchObject({
      title: 'northcoastseatours.co.uk',
      domain: 'northcoastseatours.co.uk',
      sortOrder: 0,
    });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
npm test -- src/tripCommands/placeResolver.test.ts src/tripCommands/linkEnrichment.test.ts
```

Expected: FAIL because implementation files do not exist.

- [ ] **Step 4: Implement place resolver**

Create `src/tripCommands/placeResolver.ts`:

```ts
import { resolveMapTilerCoordinates, searchMapTilerPlaces } from '../adapters/geocoding';
import { createLegacyLocation } from '../domain/locations';
import type { ActivityLocation } from '../domain/types';
import type { PlaceInput, PlaceResolver } from './types';

function manualActivityLocation(name: string, coordinates: NonNullable<PlaceInput['coordinates']>): ActivityLocation {
  return {
    name,
    address: 'TBC',
    coordinates,
    sourceProvider: 'manual',
  };
}

export function createPlaceResolver(options: { apiKey?: string }): PlaceResolver {
  return async ({ place, profile, fallbackName }) => {
    const apiKey = options.apiKey?.trim() ?? '';

    if (place.coordinates && apiKey) {
      try {
        const resolved = await resolveMapTilerCoordinates(place.coordinates, { apiKey, profile });
        return profile === 'activity'
          ? {
              coordinates: place.coordinates,
              activityLocation: {
                name: resolved.location.placeName,
                address: resolved.location.sourceLabel,
                coordinates: place.coordinates,
                sourceProvider: 'maptiler',
                sourceFeatureId: resolved.location.sourceFeatureId,
              },
            }
          : {
              coordinates: place.coordinates,
              location: resolved.location,
            };
      } catch {
        // Coordinates are still valid as a manual route/activity anchor.
      }
    }

    if (place.coordinates) {
      return profile === 'activity'
        ? {
            coordinates: place.coordinates,
            activityLocation: manualActivityLocation(fallbackName, place.coordinates),
          }
        : {
            coordinates: place.coordinates,
            location: createLegacyLocation({ name: fallbackName, countryRegion: '' }),
          };
    }

    if (!apiKey) {
      throw new Error('MapTiler API key is required to resolve place queries.');
    }

    const [result] = await searchMapTilerPlaces(place.query ?? '', { apiKey, profile });
    if (!result || result.kind !== 'place') {
      throw new Error(`Unable to resolve place query '${place.query}'.`);
    }

    return profile === 'activity'
      ? {
          coordinates: result.coordinates,
          activityLocation: {
            name: result.location.placeName,
            address: result.address ?? result.location.sourceLabel,
            coordinates: result.coordinates,
            sourceProvider: 'maptiler',
            sourceFeatureId: result.location.sourceFeatureId,
          },
        }
      : {
          coordinates: result.coordinates,
          location: result.location,
        };
  };
}
```

- [ ] **Step 5: Implement link enrichment**

Create `src/tripCommands/linkEnrichment.ts`:

```ts
import {
  createFallbackResearchLink,
  deriveLinkDomain,
  normalizeResearchLinkUrl,
} from '../domain/researchLinks';
import type { ResearchLink } from '../domain/types';
import type { LinkPreviewClient } from '../services/linkPreviewClient';
import type { LinkEnricher } from './types';

export function createLinkEnricher(previewClient?: LinkPreviewClient): LinkEnricher {
  return async (rawUrl: string, sortOrder: number): Promise<ResearchLink> => {
    const normalizedUrl = normalizeResearchLinkUrl(rawUrl);

    if (!previewClient) {
      return createFallbackResearchLink(normalizedUrl, { sortOrder });
    }

    try {
      const preview = await previewClient.fetchPreview(normalizedUrl);
      const previewUrl = normalizeResearchLinkUrl(preview.url);
      const domain = preview.domain.trim() || deriveLinkDomain(previewUrl);

      return {
        id: crypto.randomUUID(),
        title: preview.title.trim() || domain,
        url: previewUrl,
        domain,
        ...(preview.imageUrl ? { imageUrl: preview.imageUrl } : {}),
        sortOrder,
        previewFetchedAt: new Date().toISOString(),
      };
    } catch {
      return createFallbackResearchLink(normalizedUrl, { sortOrder });
    }
  };
}
```

- [ ] **Step 6: Run enrichment tests**

Run:

```bash
npm test -- src/tripCommands/placeResolver.test.ts src/tripCommands/linkEnrichment.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/tripCommands/placeResolver.ts src/tripCommands/placeResolver.test.ts src/tripCommands/linkEnrichment.ts src/tripCommands/linkEnrichment.test.ts
git commit -m "feat: add trip command enrichment"
```

---

### Task 3: Shared Route Orchestration

**Files:**
- Create: `src/tripCommands/routeOrchestration.ts`
- Test: `src/tripCommands/routeOrchestration.test.ts`
- Modify: `src/hooks/useTripData.ts`
- Test: `src/hooks/useTripData.test.tsx`

**Interfaces:**
- Consumes:
  - `TripRepository` from `src/storage/tripRepository.ts`
  - `reconcileRouteLegsForDestinations` from `src/domain/routePlanner.ts`
  - `createRouteKey`, `createStraightLineGeometry` from `src/domain/routeLegs.ts`
- Produces:
  - `function hasPreservableDrivingRouteData(routeLeg: RouteLeg | RouteLegPatch): boolean`
  - `async function calculateDrivingRouteLegs(input: CalculateDrivingRouteLegsInput): Promise<RouteLeg[]>`
  - `async function finalizeRouteLeg(input: FinalizeRouteLegInput): Promise<RouteLeg>`
  - `async function reconcileAndSaveRouteLegs(input: ReconcileAndSaveRouteLegsInput): Promise<RouteLeg[]>`

- [ ] **Step 1: Write route orchestration tests**

Create `src/tripCommands/routeOrchestration.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createDestination } from '../domain/destinations';
import { createRouteKey, createRouteLeg } from '../domain/routeLegs';
import type { RouteLeg } from '../domain/types';
import { reconcileAndSaveRouteLegs } from './routeOrchestration';

function createRepository(routeLegs: RouteLeg[] = []) {
  return {
    saveRouteLeg: vi.fn(async (routeLeg: RouteLeg) => {
      const index = routeLegs.findIndex((existing) => existing.id === routeLeg.id);
      if (index === -1) routeLegs.push(routeLeg);
      else routeLegs[index] = routeLeg;
    }),
    deleteRouteLeg: vi.fn(async (routeLegId: string) => {
      const index = routeLegs.findIndex((routeLeg) => routeLeg.id === routeLegId);
      if (index !== -1) routeLegs.splice(index, 1);
    }),
  };
}

describe('route orchestration', () => {
  it('creates and calculates adjacent driving route legs', async () => {
    const origin = createDestination({ name: 'Boroughbridge', coordinates: { lat: 54.0903, lng: -1.4144 } });
    const target = createDestination({ name: 'Alnwick', coordinates: { lat: 55.426423, lng: -1.60645 } });
    const repository = createRepository();
    const calculateRoute = vi.fn(async () => ({
      distanceKm: 170,
      travelTimeHours: 2,
      geometry: {
        type: 'LineString' as const,
        coordinates: [[origin.coordinates.lng, origin.coordinates.lat], [target.coordinates.lng, target.coordinates.lat]],
      },
      provider: 'test',
      profile: 'driving-car' as const,
    }));

    const routeLegs = await reconcileAndSaveRouteLegs({
      destinations: [origin, target],
      currentRouteLegs: [],
      repository,
      calculateRoute,
    });

    expect(routeLegs).toHaveLength(1);
    expect(routeLegs[0]).toMatchObject({
      originDestinationId: origin.id,
      targetDestinationId: target.id,
      status: 'ready',
      distanceKm: 170,
      travelTimeHours: 2,
      provider: 'test',
      profile: 'driving-car',
    });
    expect(repository.saveRouteLeg).toHaveBeenCalledTimes(1);
  });

  it('preserves ready route legs that still match the same endpoints', async () => {
    const origin = createDestination({ name: 'Tongue', coordinates: { lat: 58.492089, lng: -4.427364 } });
    const target = createDestination({ name: 'Shore', coordinates: { lat: 58.168971, lng: -5.307577 } });
    const readyLeg = createRouteLeg({
      originDestinationId: origin.id,
      targetDestinationId: target.id,
      type: 'driving-auto',
      status: 'ready',
      distanceKm: 96,
      travelTimeHours: 2,
      geometry: {
        type: 'LineString',
        coordinates: [[origin.coordinates.lng, origin.coordinates.lat], [target.coordinates.lng, target.coordinates.lat]],
      },
      provider: 'openrouteservice',
      profile: 'driving-car',
      routeKey: createRouteKey({ origin: origin.coordinates, target: target.coordinates }),
      calculatedAt: new Date().toISOString(),
    });
    const repository = createRepository([readyLeg]);
    const calculateRoute = vi.fn();

    const routeLegs = await reconcileAndSaveRouteLegs({
      destinations: [origin, target],
      currentRouteLegs: [readyLeg],
      repository,
      calculateRoute,
    });

    expect(routeLegs[0]).toBe(readyLeg);
    expect(calculateRoute).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run route tests to verify failure**

Run:

```bash
npm test -- src/tripCommands/routeOrchestration.test.ts
```

Expected: FAIL because `routeOrchestration.ts` does not exist.

- [ ] **Step 3: Implement shared route orchestration**

Create `src/tripCommands/routeOrchestration.ts` by moving the route-specific helper logic from `src/hooks/useTripData.ts` into exported functions. Keep function behavior identical to the hook today:

```ts
import { createRouteKey, createStraightLineGeometry } from '../domain/routeLegs';
import { reconcileRouteLegsForDestinations } from '../domain/routePlanner';
import type { Coordinates, Destination, RouteLeg } from '../domain/types';

export type RouteLegPatch = Partial<Omit<RouteLeg, 'id' | 'createdAt' | 'updatedAt'>>;

export type CalculatedRoute = Pick<
  RouteLeg,
  'distanceKm' | 'travelTimeHours' | 'geometry' | 'provider' | 'profile'
>;

export type CalculateRouteInput = {
  origin: Coordinates;
  target: Coordinates;
  profile: 'driving-car';
};

export type CalculateRoute = (input: CalculateRouteInput) => Promise<CalculatedRoute>;

export type RouteLegPersistence = {
  saveRouteLeg(routeLeg: RouteLeg): Promise<void>;
  deleteRouteLeg(routeLegId: string): Promise<void>;
};

const createTimestamp = () => new Date().toISOString();

export function hasPreservableDrivingRouteData(routeLeg: RouteLeg | RouteLegPatch): boolean {
  return Boolean(
    routeLeg.type === 'driving-auto' &&
    routeLeg.status === 'ready' &&
    routeLeg.geometry &&
    routeLeg.distanceKm !== undefined &&
    routeLeg.travelTimeHours !== undefined &&
    routeLeg.provider &&
    routeLeg.profile === 'driving-car' &&
    routeLeg.routeKey &&
    routeLeg.calculatedAt &&
    !routeLeg.error,
  );
}

export async function calculateDrivingRouteLegs(input: {
  destinations: Destination[];
  routeLegs: RouteLeg[];
  calculateRoute?: CalculateRoute;
}): Promise<RouteLeg[]> {
  if (!input.calculateRoute) return input.routeLegs;

  const destinationsById = new Map(input.destinations.map((destination) => [destination.id, destination]));
  const calculatedRouteLegs: RouteLeg[] = [];

  for (const leg of input.routeLegs) {
    const origin = destinationsById.get(leg.originDestinationId);
    const target = destinationsById.get(leg.targetDestinationId);

    if (
      leg.type !== 'driving-auto' ||
      (leg.status === 'ready' && hasPreservableDrivingRouteData(leg)) ||
      !origin ||
      !target
    ) {
      calculatedRouteLegs.push(leg);
      continue;
    }

    try {
      const route = await input.calculateRoute({
        origin: origin.coordinates,
        target: target.coordinates,
        profile: 'driving-car',
      });
      calculatedRouteLegs.push({
        ...leg,
        ...route,
        status: 'ready',
        routeKey: createRouteKey({ origin: origin.coordinates, target: target.coordinates, profile: 'driving-car' }),
        error: undefined,
        calculatedAt: createTimestamp(),
        updatedAt: createTimestamp(),
      });
    } catch (caught) {
      calculatedRouteLegs.push({
        ...leg,
        status: 'failed',
        distanceKm: undefined,
        travelTimeHours: undefined,
        geometry: undefined,
        provider: undefined,
        profile: 'driving-car',
        routeKey: createRouteKey({ origin: origin.coordinates, target: target.coordinates, profile: 'driving-car' }),
        calculatedAt: undefined,
        error: caught instanceof Error ? caught.message : 'Route calculation failed',
        updatedAt: createTimestamp(),
      });
    }
  }

  return calculatedRouteLegs;
}

export async function finalizeRouteLeg(input: {
  routeLeg: RouteLeg;
  destinations: Destination[];
  calculateRoute?: CalculateRoute;
}): Promise<RouteLeg> {
  const destinationsById = new Map(input.destinations.map((destination) => [destination.id, destination]));
  const origin = destinationsById.get(input.routeLeg.originDestinationId);
  const target = destinationsById.get(input.routeLeg.targetDestinationId);

  if (!origin || !target) return input.routeLeg;

  if (input.routeLeg.type === 'shipping-manual') {
    return {
      ...input.routeLeg,
      status: 'manual',
      geometry: createStraightLineGeometry(origin.coordinates, target.coordinates),
      distanceKm: undefined,
      travelTimeHours: undefined,
      provider: undefined,
      profile: undefined,
      routeKey: undefined,
      calculatedAt: undefined,
      error: undefined,
      updatedAt: createTimestamp(),
    };
  }

  if (hasPreservableDrivingRouteData(input.routeLeg)) {
    return { ...input.routeLeg, error: undefined, updatedAt: createTimestamp() };
  }

  const [calculatedRouteLeg] = await calculateDrivingRouteLegs({
    destinations: input.destinations,
    calculateRoute: input.calculateRoute,
    routeLegs: [{
      ...input.routeLeg,
      status: 'pending',
      profile: input.routeLeg.profile ?? 'driving-car',
      error: undefined,
      updatedAt: createTimestamp(),
    }],
  });

  return calculatedRouteLeg;
}

export async function reconcileAndSaveRouteLegs(input: {
  destinations: Destination[];
  currentRouteLegs: RouteLeg[];
  repository: RouteLegPersistence;
  calculateRoute?: CalculateRoute;
}): Promise<RouteLeg[]> {
  const reconciliation = reconcileRouteLegsForDestinations(input.destinations, input.currentRouteLegs);
  const nextRouteLegs = await calculateDrivingRouteLegs({
    destinations: input.destinations,
    routeLegs: reconciliation.routeLegs,
    calculateRoute: input.calculateRoute,
  });

  await Promise.all([
    ...reconciliation.removedRouteLegIds.map((routeLegId) => input.repository.deleteRouteLeg(routeLegId)),
    ...nextRouteLegs.map((routeLeg) => input.repository.saveRouteLeg(routeLeg)),
  ]);

  return nextRouteLegs;
}
```

- [ ] **Step 4: Modify useTripData to import shared helpers**

In `src/hooks/useTripData.ts`:

- remove local `createRouteKey`, `createStraightLineGeometry`, `hasPreservableDrivingRouteData`, `calculateDrivingRouteLegs`, `finalizeRouteLeg`, and `reconcileAndSaveRouteLegs` implementations
- import the shared functions:

```ts
import {
  calculateDrivingRouteLegs,
  finalizeRouteLeg,
  hasPreservableDrivingRouteData,
  reconcileAndSaveRouteLegs,
  type RouteLegPatch,
} from '../tripCommands/routeOrchestration';
```

- replace local calls with the shared signatures:

```ts
const nextRouteLegs = await reconcileAndSaveRouteLegs({
  destinations: orderedDestinations,
  currentRouteLegs: routeLegsRef.current,
  repository,
  calculateRoute,
});
```

When the hook needs to publish pending route legs during reorder, compute the reconciliation before calling the shared save helper:

```ts
const reconciliation = reconcileRouteLegsForDestinations(orderedDestinations, routeLegsRef.current);
replaceRouteLegs(reconciliation.routeLegs);
const routeLegReconciliation = reconcileAndSaveRouteLegs({
  destinations: orderedDestinations,
  currentRouteLegs: routeLegsRef.current,
  repository,
  calculateRoute,
});
```

- [ ] **Step 5: Run route and hook tests**

Run:

```bash
npm test -- src/tripCommands/routeOrchestration.test.ts src/hooks/useTripData.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/tripCommands/routeOrchestration.ts src/tripCommands/routeOrchestration.test.ts src/hooks/useTripData.ts
git commit -m "refactor: share trip route orchestration"
```

---

### Task 4: TripDataService For Trips And Stops

**Files:**
- Create: `src/tripCommands/tripDataService.ts`
- Test: `src/tripCommands/tripDataService.test.ts`

**Interfaces:**
- Consumes:
  - Validation from Task 1.
  - Place resolver from Task 2.
  - Route orchestration from Task 3.
  - Existing `createDestination`, `updateDestination`.
- Produces:
  - `function createTripDataService(dependencies: TripDataServiceDependencies): TripDataService`
  - `TripDataService` methods:
    - `listTrips()`
    - `getTrip(input)`
    - `createTrip(input, options?)`
    - `deleteTrip(input, options?)`
    - `renameTrip(input, options?)`
    - `replaceStops(input, options?)`
    - `insertStop(input, options?)`
    - `updateStop(input, options?)`
    - `deleteStop(input, options?)`
    - `reorderStops(input, options?)`

- [ ] **Step 1: Write service tests for trips and stops**

Create `src/tripCommands/tripDataService.test.ts` with an in-memory fake directory/repository. The fake should implement only methods each test calls and should throw for unimplemented methods so accidental calls are visible.

```ts
import { describe, expect, it, vi } from 'vitest';
import { createTripDataService } from './tripDataService';
import type { TripRepository } from '../storage/tripRepository';
import type { TripSummary } from '../storage/tripDirectoryRepository';

function createHarness() {
  const trips: TripSummary[] = [];
  const repositories = new Map<string, {
    destinations: import('../domain/types').Destination[];
    routeLegs: import('../domain/types').RouteLeg[];
    activities: import('../domain/types').Activity[];
  }>();

  const createTripRepository = (tripId: string): TripRepository => {
    const data = repositories.get(tripId) ?? { destinations: [], routeLegs: [], activities: [] };
    repositories.set(tripId, data);
    return {
      async listDestinations() { return [...data.destinations].sort((a, b) => a.order - b.order); },
      async saveDestination(destination) {
        const index = data.destinations.findIndex((existing) => existing.id === destination.id);
        if (index === -1) data.destinations.push(destination);
        else data.destinations[index] = destination;
      },
      async deleteDestination(destinationId) {
        data.destinations = data.destinations.filter((destination) => destination.id !== destinationId);
        data.routeLegs = data.routeLegs.filter((leg) => leg.originDestinationId !== destinationId && leg.targetDestinationId !== destinationId);
      },
      async listRouteLegs() { return data.routeLegs; },
      async saveRouteLeg(routeLeg) {
        const index = data.routeLegs.findIndex((existing) => existing.id === routeLeg.id);
        if (index === -1) data.routeLegs.push(routeLeg);
        else data.routeLegs[index] = routeLeg;
      },
      async deleteRouteLeg(routeLegId) {
        data.routeLegs = data.routeLegs.filter((routeLeg) => routeLeg.id !== routeLegId);
      },
      async listActivities(destinationId) { return data.activities.filter((activity) => activity.destinationId === destinationId); },
      async createActivity() { throw new Error('Not needed in this test.'); },
      async updateActivity() { throw new Error('Not needed in this test.'); },
      async deleteActivity() { throw new Error('Not needed in this test.'); },
      async reorderActivities() { throw new Error('Not needed in this test.'); },
      async listDestinationMedia() { return []; },
      async uploadDestinationMedia() { throw new Error('Not needed in this test.'); },
      async importDestinationMediaFromSearch() { throw new Error('Not needed in this test.'); },
      async updateDestinationMedia() { throw new Error('Not needed in this test.'); },
      async deleteDestinationMedia() { throw new Error('Not needed in this test.'); },
      async reorderDestinationMedia() { return []; },
      async listDestinationMediaRollup() { return []; },
      async listActivityMedia() { return []; },
      async uploadActivityMedia() { throw new Error('Not needed in this test.'); },
      async importActivityMediaFromSearch() { throw new Error('Not needed in this test.'); },
      async updateActivityMedia() { throw new Error('Not needed in this test.'); },
      async deleteActivityMedia() { throw new Error('Not needed in this test.'); },
      async reorderActivityMedia() { return []; },
      async replaceTripData() { throw new Error('Not needed in this test.'); },
    };
  };

  const service = createTripDataService({
    directory: {
      async listTrips() { return trips; },
      async createTrip(input) {
        const trip = {
          id: crypto.randomUUID(),
          name: input.name,
          description: '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        trips.push(trip);
        return trip;
      },
      async updateTrip(tripId, patch) {
        const trip = trips.find((candidate) => candidate.id === tripId);
        if (!trip) throw new Error('Trip not found.');
        Object.assign(trip, patch, { updatedAt: new Date().toISOString() });
        return trip;
      },
      async deleteTrip(tripId) {
        const index = trips.findIndex((candidate) => candidate.id === tripId);
        if (index !== -1) trips.splice(index, 1);
      },
    },
    createTripRepository,
    resolvePlace: vi.fn(async ({ place, fallbackName }) => ({
      coordinates: place.coordinates ?? { lat: 58.492089, lng: -4.427364 },
      location: {
        placeName: fallbackName,
        regionName: '',
        countryName: 'Scotland',
        sourceLabel: `${fallbackName}, Scotland`,
        sourceProvider: 'legacy',
      },
    })),
    calculateRoute: vi.fn(async ({ origin, target }) => ({
      distanceKm: 10,
      travelTimeHours: 1,
      geometry: { type: 'LineString', coordinates: [[origin.lng, origin.lat], [target.lng, target.lat]] },
      provider: 'test',
      profile: 'driving-car',
    })),
  });

  return { service, trips, repositories };
}

describe('TripDataService trips and stops', () => {
  it('creates a trip with ordered overnight stops and derived route legs', async () => {
    const { service } = createHarness();
    const result = await service.createTrip({
      name: 'North Coast 500 Trip',
      stops: [
        { name: 'Boroughbridge Camping', place: { coordinates: { lat: 54.0903, lng: -1.4144 } }, notes: 'Booked.' },
        { name: 'Coast And Castles Camping', place: { coordinates: { lat: 55.426423, lng: -1.60645 } } },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trip.name).toBe('North Coast 500 Trip');
    expect(result.stops.map((stop) => stop.name)).toEqual(['Boroughbridge Camping', 'Coast And Castles Camping']);
    expect(result.routeLegs).toHaveLength(1);
    expect(result.changed.routesRecalculated).toBe(1);
  });

  it('dry-runs destructive stop replacement without saving', async () => {
    const { service } = createHarness();
    const created = await service.createTrip({
      name: 'NC500',
      stops: [{ name: 'Tongue', place: { coordinates: { lat: 58.492089, lng: -4.427364 } } }],
    });
    if (!created.ok) throw new Error('Expected trip creation to pass.');

    const result = await service.replaceStops({
      tripId: created.trip.id,
      stops: [{ name: 'Ullapool', place: { coordinates: { lat: 57.934707, lng: -5.196483 } } }],
    }, { dryRun: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary).toContain('Would replace');
    const after = await service.getTrip({ tripId: created.trip.id });
    expect(after.ok && after.trip.stops.map((stop) => stop.name)).toEqual(['Tongue']);
  });
});
```

- [ ] **Step 2: Run service tests to verify failure**

Run:

```bash
npm test -- src/tripCommands/tripDataService.test.ts
```

Expected: FAIL because `tripDataService.ts` does not exist.

- [ ] **Step 3: Implement TripDataService trip and stop methods**

Create `src/tripCommands/tripDataService.ts` with these public types and factory:

```ts
import { createDestination, updateDestination } from '../domain/destinations';
import { sortResearchLinks } from '../domain/researchLinks';
import type { Activity, Destination, RouteLeg } from '../domain/types';
import {
  reconcileAndSaveRouteLegs,
  type CalculateRoute,
} from './routeOrchestration';
import type {
  ActivityDraft,
  ActivityPatch,
  ChangedSummary,
  CommandResult,
  StopDraft,
  StopPatch,
  TripDataServiceDependencies,
  TripWithData,
} from './types';
import {
  TripCommandValidationError,
  validateActivityDraft,
  validateActivityPatch,
  validateStopDraft,
  validateStopPatch,
  validateUrlInput,
} from './validation';

type CommandOptions = {
  dryRun?: boolean;
  yes?: boolean;
};

type TripDataService = {
  listTrips(): Promise<CommandResult<{ trips: Array<import('../storage/tripDirectoryRepository').TripSummary & { stopCount: number }> }>>;
  getTrip(input: { tripId: string; includeActivities?: boolean; includeLinks?: boolean }): Promise<CommandResult<{ trip: TripWithData }>>;
  createTrip(input: { name: string; stops?: unknown[] }, options?: CommandOptions): Promise<CommandResult<{ trip: import('../storage/tripDirectoryRepository').TripSummary; stops: Destination[]; routeLegs: RouteLeg[]; changed: ChangedSummary }>>;
  deleteTrip(input: { tripId: string }, options?: CommandOptions): Promise<CommandResult<{ changed: ChangedSummary }>>;
  renameTrip(input: { tripId: string; name: string }, options?: CommandOptions): Promise<CommandResult<{ trip: import('../storage/tripDirectoryRepository').TripSummary; changed: ChangedSummary }>>;
  replaceStops(input: { tripId: string; stops: unknown[] }, options?: CommandOptions): Promise<CommandResult<{ stops: Destination[]; routeLegs: RouteLeg[]; changed: ChangedSummary }>>;
  insertStop(input: { tripId: string; afterStopId?: string; beforeStopId?: string; stop: unknown }, options?: CommandOptions): Promise<CommandResult<{ stop: Destination; stops: Destination[]; routeLegs: RouteLeg[]; changed: ChangedSummary }>>;
  updateStop(input: { tripId: string; stopId: string; patch: unknown }, options?: CommandOptions): Promise<CommandResult<{ stop: Destination; routeLegs: RouteLeg[]; changed: ChangedSummary }>>;
  deleteStop(input: { tripId: string; stopId: string }, options?: CommandOptions): Promise<CommandResult<{ changed: ChangedSummary }>>;
  reorderStops(input: { tripId: string; stopIds: string[]; strict?: boolean }, options?: CommandOptions): Promise<CommandResult<{ stops: Destination[]; routeLegs: RouteLeg[]; changed: ChangedSummary }>>;
  listActivities(input: { tripId: string; stopId: string }): Promise<CommandResult<{ activities: Activity[] }>>;
  createActivity(input: { tripId: string; stopId: string; activity: unknown }, options?: CommandOptions): Promise<CommandResult<{ activity: Activity; changed: ChangedSummary }>>;
  updateActivity(input: { tripId: string; activityId: string; patch: unknown }, options?: CommandOptions): Promise<CommandResult<{ activity: Activity; changed: ChangedSummary }>>;
  deleteActivity(input: { tripId: string; activityId: string }, options?: CommandOptions): Promise<CommandResult<{ changed: ChangedSummary }>>;
  reorderActivities(input: { tripId: string; stopId: string; activityIds: string[] }, options?: CommandOptions): Promise<CommandResult<{ activities: Activity[]; changed: ChangedSummary }>>;
  addStopLink(input: { tripId: string; stopId: string; url: unknown }, options?: CommandOptions): Promise<CommandResult<{ changed: ChangedSummary }>>;
  deleteStopLink(input: { tripId: string; stopId: string; linkId: string }, options?: CommandOptions): Promise<CommandResult<{ changed: ChangedSummary }>>;
  addActivityLink(input: { tripId: string; activityId: string; url: unknown }, options?: CommandOptions): Promise<CommandResult<{ changed: ChangedSummary }>>;
  deleteActivityLink(input: { tripId: string; activityId: string; linkId: string }, options?: CommandOptions): Promise<CommandResult<{ changed: ChangedSummary }>>;
};

const emptyChanged = (): ChangedSummary => ({
  tripsCreated: [],
  tripsDeleted: [],
  stopsAdded: [],
  stopsUpdated: [],
  stopsDeleted: [],
  activitiesAdded: [],
  activitiesUpdated: [],
  activitiesDeleted: [],
  linksAdded: [],
  linksDeleted: [],
  routesRecalculated: 0,
});
```

Implement trip and stop methods first. Keep activity and link methods throwing a structured unsupported result until Task 5 replaces them:

```ts
function unsupported<T>(summary: string): CommandResult<T> {
  return {
    ok: false,
    error: {
      code: 'COMMAND_NOT_IMPLEMENTED',
      message: summary,
    },
  };
}
```

The stop creation helper must map `StopDraft.notes` to `Destination.research.notes`:

```ts
async function destinationFromDraft(
  draft: StopDraft,
  order: number,
  dependencies: TripDataServiceDependencies,
): Promise<Destination> {
  const resolved = dependencies.resolvePlace
    ? await dependencies.resolvePlace({ place: draft.place, profile: 'stop', fallbackName: draft.name })
    : { coordinates: draft.place.coordinates!, location: undefined };

  const destination = createDestination({
    name: draft.name,
    coordinates: resolved.coordinates,
    location: resolved.location,
    order,
  });

  return updateDestination(destination, {
    timing: {
      ...destination.timing,
      expectedStayDays: draft.expectedStayDays ?? destination.timing.expectedStayDays,
    },
    research: {
      ...destination.research,
      notes: draft.notes ?? destination.research.notes,
    },
    tags: draft.tags ?? destination.tags,
  });
}
```

- [ ] **Step 4: Run service tests**

Run:

```bash
npm test -- src/tripCommands/tripDataService.test.ts
```

Expected: PASS for trip/stop service tests.

- [ ] **Step 5: Commit**

```bash
git add src/tripCommands/tripDataService.ts src/tripCommands/tripDataService.test.ts
git commit -m "feat: add trip data service stop commands"
```

---

### Task 5: Link And Activity Commands

**Files:**
- Modify: `src/tripCommands/tripDataService.ts`
- Modify: `src/tripCommands/tripDataService.test.ts`

**Interfaces:**
- Consumes:
  - `validateActivityDraft`, `validateActivityPatch`, `validateUrlInput`
  - `LinkEnricher`
  - `TripRepository.createActivity`, `updateActivity`, `deleteActivity`, `reorderActivities`
- Produces fully implemented:
  - `addStopLink`
  - `deleteStopLink`
  - `listActivities`
  - `createActivity`
  - `updateActivity`
  - `deleteActivity`
  - `reorderActivities`
  - `addActivityLink`
  - `deleteActivityLink`

- [ ] **Step 1: Extend service tests for links and activities**

Append to `src/tripCommands/tripDataService.test.ts`:

```ts
describe('TripDataService links and activities', () => {
  it('adds stop links using the link enricher', async () => {
    const { service } = createHarness();
    const created = await service.createTrip({
      name: 'NC500',
      stops: [{ name: 'Alnwick', place: { coordinates: { lat: 55.426423, lng: -1.60645 } } }],
    });
    if (!created.ok) throw new Error('Expected trip creation to pass.');

    const result = await service.addStopLink({
      tripId: created.trip.id,
      stopId: created.stops[0].id,
      url: 'https://www.alnwickcastle.com/',
    });

    expect(result.ok).toBe(true);
    const trip = await service.getTrip({ tripId: created.trip.id });
    expect(trip.ok && trip.trip.stops[0].research.links[0]).toMatchObject({
      url: 'https://www.alnwickcastle.com/',
      sortOrder: 0,
    });
  });

  it('creates and updates an activity with visible details', async () => {
    const { service } = createHarness();
    const created = await service.createTrip({
      name: 'NC500',
      stops: [{ name: 'Durness', place: { coordinates: { lat: 58.5689, lng: -4.7454 } } }],
    });
    if (!created.ok) throw new Error('Expected trip creation to pass.');

    const activityResult = await service.createActivity({
      tripId: created.trip.id,
      stopId: created.stops[0].id,
      activity: { title: 'Smoo Cave', place: { coordinates: { lat: 58.5634, lng: -4.7212 } } },
    });

    expect(activityResult.ok).toBe(true);
    if (!activityResult.ok) return;
    const updateResult = await service.updateActivity({
      tripId: created.trip.id,
      activityId: activityResult.activity.id,
      patch: {
        description: 'Sea cave near Durness.',
        notes: 'Visit before driving to Shore.',
        tags: ['outdoors'],
      },
    });

    expect(updateResult.ok).toBe(true);
    if (!updateResult.ok) return;
    expect(updateResult.activity).toMatchObject({
      title: 'Smoo Cave',
      description: 'Sea cave near Durness.',
      notes: 'Visit before driving to Shore.',
      tags: ['outdoors'],
    });
  });
});
```

- [ ] **Step 2: Run tests to verify failures**

Run:

```bash
npm test -- src/tripCommands/tripDataService.test.ts
```

Expected: FAIL because link/activity methods are unsupported or fake repository methods need implementation.

- [ ] **Step 3: Implement fake repository activity methods**

In `createHarness()` inside `src/tripCommands/tripDataService.test.ts`, replace fake activity method throws with in-memory implementations:

```ts
async createActivity(input) {
  const timestamp = new Date().toISOString();
  const activity = {
    id: crypto.randomUUID(),
    destinationId: input.destinationId,
    order: input.order ?? data.activities.filter((activity) => activity.destinationId === input.destinationId).length,
    title: input.title,
    description: '',
    category: 'other' as const,
    status: 'idea' as const,
    priority: 'medium' as const,
    location: input.location,
    links: [],
    notes: '',
    tags: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  data.activities.push(activity);
  return activity;
},
async updateActivity(activityId, patch) {
  const activity = data.activities.find((candidate) => candidate.id === activityId);
  if (!activity) throw new Error('Activity not found.');
  Object.assign(activity, patch, { updatedAt: new Date().toISOString() });
  return activity;
},
async deleteActivity(activityId) {
  data.activities = data.activities.filter((activity) => activity.id !== activityId);
},
async reorderActivities(destinationId, orderedActivityIds) {
  const requestedIds = new Set(orderedActivityIds);
  const activitiesById = new Map(data.activities.map((activity) => [activity.id, activity]));
  const ordered = [
    ...orderedActivityIds.map((id) => activitiesById.get(id)).filter((activity): activity is import('../domain/types').Activity => Boolean(activity)),
    ...data.activities.filter((activity) => activity.destinationId === destinationId && !requestedIds.has(activity.id)),
  ].map((activity, order) => ({ ...activity, order }));
  data.activities = [
    ...data.activities.filter((activity) => activity.destinationId !== destinationId),
    ...ordered,
  ];
  return ordered;
},
```

- [ ] **Step 4: Implement link and activity methods**

In `src/tripCommands/tripDataService.ts`:

- `addStopLink`: load stop, compute next sort order, call `dependencies.enrichLink ?? createFallbackResearchLink`, patch `destination.research.links`.
- `deleteStopLink`: filter the matching link id and re-densify sort order with `reorderResearchLinks`.
- `createActivity`: validate draft, resolve `place` if supplied, call `repository.createActivity`, then patch details if needed.
- `updateActivity`: find current activity by scanning stops and `listActivities`, map `place` to `location`, call `repository.updateActivity`.
- `deleteActivity`: call `repository.deleteActivity`.
- `reorderActivities`: call `repository.reorderActivities`.
- `addActivityLink` / `deleteActivityLink`: update activity `links` using the same link helper.

Use this shared helper to find an activity:

```ts
async function findActivity(repository: import('../storage/tripRepository').TripRepository, activityId: string) {
  const destinations = await repository.listDestinations();
  for (const destination of destinations) {
    const activities = await repository.listActivities(destination.id);
    const activity = activities.find((candidate) => candidate.id === activityId);
    if (activity) return { destination, activity };
  }
  throw new Error('Activity not found.');
}
```

- [ ] **Step 5: Run service tests**

Run:

```bash
npm test -- src/tripCommands/tripDataService.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/tripCommands/tripDataService.ts src/tripCommands/tripDataService.test.ts
git commit -m "feat: add trip data content commands"
```

---

### Task 6: Node CLI Runtime

**Files:**
- Create: `src/cli/nodeSupabase.ts`
- Create: `src/cli/trip.ts`
- Create: `src/cli/tripCli.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes:
  - `createTripDataService`
  - `createSupabaseTripDirectoryRepository`
  - `createSupabaseTripRepository`
  - `calculateOpenRouteServiceRoute`
  - `createPlaceResolver`
  - `createLinkEnricher`
- Produces:
  - `npm run trip -- <command>`
  - JSON output by default.
  - Non-zero exit code for validation/write failures.

- [ ] **Step 1: Install CLI runtime dependencies**

Run:

```bash
npm install --save-dev tsx
npm install dotenv
```

Expected: `package.json` and `package-lock.json` update with `tsx` and `dotenv`.

- [ ] **Step 2: Write CLI tests**

Create `src/cli/tripCli.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { parseTripCliArgs, runTripCli } from './trip';

describe('trip CLI', () => {
  it('parses create command input path', () => {
    expect(parseTripCliArgs(['create', '--input', './trip.json'])).toEqual({
      command: 'create',
      flags: { input: './trip.json' },
    });
  });

  it('prints JSON service result', async () => {
    const write = vi.fn();
    const service = {
      listTrips: vi.fn(async () => ({
        ok: true,
        summary: 'Loaded 1 trip.',
        trips: [{ id: 'trip-id', name: 'NC500', description: '', createdAt: 'now', updatedAt: 'now', stopCount: 12 }],
      })),
    };

    const exitCode = await runTripCli({
      argv: ['list'],
      service: service as never,
      readFile: vi.fn(),
      write,
      writeError: vi.fn(),
    });

    expect(exitCode).toBe(0);
    expect(JSON.parse(write.mock.calls[0][0])).toMatchObject({
      ok: true,
      trips: [{ name: 'NC500' }],
    });
  });
});
```

- [ ] **Step 3: Run CLI tests to verify failure**

Run:

```bash
npm test -- src/cli/tripCli.test.ts
```

Expected: FAIL because CLI files do not exist.

- [ ] **Step 4: Implement Node Supabase creation**

Create `src/cli/nodeSupabase.ts`:

```ts
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

export function createNodeSupabaseClient() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? '';
  const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';

  if (!supabaseUrl || !publishableKey) {
    throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.');
  }

  return createClient(supabaseUrl, publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

export async function ensureNodeAnonymousSession(supabase: ReturnType<typeof createNodeSupabaseClient>) {
  const existing = await supabase.auth.getUser();
  if (existing.data.user) return existing.data.user;

  const created = await supabase.auth.signInAnonymously();
  if (created.error || !created.data.user) {
    throw new Error(created.error?.message || 'Unable to create anonymous Supabase session.');
  }
  return created.data.user;
}
```

- [ ] **Step 5: Implement CLI parsing and runner**

Create `src/cli/trip.ts` with exported testable parser/runner and executable main:

```ts
import { readFile } from 'node:fs/promises';
import { calculateOpenRouteServiceRoute } from '../adapters/openRouteService';
import { createAppLinkPreviewClient } from '../services/linkPreviewClient';
import { createSupabaseTripDirectoryRepository } from '../storage/tripDirectoryRepository';
import { createSupabaseTripRepository } from '../storage/supabaseTripRepository';
import { createLinkEnricher } from '../tripCommands/linkEnrichment';
import { createPlaceResolver } from '../tripCommands/placeResolver';
import { createTripDataService } from '../tripCommands/tripDataService';
import { createNodeSupabaseClient, ensureNodeAnonymousSession } from './nodeSupabase';

type ParsedArgs = {
  command: string;
  flags: Record<string, string | boolean>;
};

export function parseTripCliArgs(argv: string[]): ParsedArgs {
  const [command = 'help', ...rest] = argv;
  const flags: Record<string, string | boolean> = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) continue;
    const name = token.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith('--')) {
      flags[name] = true;
      continue;
    }
    flags[name] = next;
    index += 1;
  }
  return { command, flags };
}

function stringFlag(flags: Record<string, string | boolean>, name: string) {
  const value = flags[name];
  return typeof value === 'string' ? value : undefined;
}

async function readJson(path: string | undefined, readFileImpl: (path: string) => Promise<string>) {
  if (!path) throw new Error('Missing --input path.');
  return JSON.parse(await readFileImpl(path));
}

async function readIdList(path: string | undefined, key: string, readFileImpl: (path: string) => Promise<string>) {
  const value = await readJson(path, readFileImpl);
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return value;
  }
  if (
    value &&
    typeof value === 'object' &&
    key in value &&
    Array.isArray((value as Record<string, unknown>)[key]) &&
    ((value as Record<string, unknown>)[key] as unknown[]).every((item) => typeof item === 'string')
  ) {
    return (value as Record<string, string[]>)[key];
  }
  throw new Error(`Expected --input JSON to be a string array or an object with '${key}'.`);
}

export async function runTripCli(input: {
  argv: string[];
  service: ReturnType<typeof createTripDataService>;
  readFile: (path: string) => Promise<string>;
  write: (value: string) => void;
  writeError: (value: string) => void;
}) {
  try {
    const { command, flags } = parseTripCliArgs(input.argv);
    const dryRun = Boolean(flags['dry-run']);
    const yes = Boolean(flags.yes);
    let result: unknown;

    switch (command) {
      case 'list':
        result = await input.service.listTrips();
        break;
      case 'get':
        result = await input.service.getTrip({
          tripId: stringFlag(flags, 'trip-id') ?? '',
          includeActivities: Boolean(flags['include-activities']),
          includeLinks: Boolean(flags['include-links']),
        });
        break;
      case 'create':
        result = await input.service.createTrip(await readJson(stringFlag(flags, 'input'), input.readFile), { dryRun, yes });
        break;
      case 'delete':
        result = await input.service.deleteTrip({ tripId: stringFlag(flags, 'trip-id') ?? '' }, { dryRun, yes });
        break;
      case 'rename':
        result = await input.service.renameTrip({ tripId: stringFlag(flags, 'trip-id') ?? '', name: stringFlag(flags, 'name') ?? '' }, { dryRun, yes });
        break;
      case 'replace-stops':
        result = await input.service.replaceStops({ tripId: stringFlag(flags, 'trip-id') ?? '', stops: await readJson(stringFlag(flags, 'input'), input.readFile) }, { dryRun, yes });
        break;
      case 'insert-stop':
        result = await input.service.insertStop({ tripId: stringFlag(flags, 'trip-id') ?? '', afterStopId: stringFlag(flags, 'after-stop-id'), beforeStopId: stringFlag(flags, 'before-stop-id'), stop: await readJson(stringFlag(flags, 'input'), input.readFile) }, { dryRun, yes });
        break;
      case 'update-stop':
        result = await input.service.updateStop({ tripId: stringFlag(flags, 'trip-id') ?? '', stopId: stringFlag(flags, 'stop-id') ?? '', patch: await readJson(stringFlag(flags, 'input'), input.readFile) }, { dryRun, yes });
        break;
      case 'delete-stop':
        result = await input.service.deleteStop({ tripId: stringFlag(flags, 'trip-id') ?? '', stopId: stringFlag(flags, 'stop-id') ?? '' }, { dryRun, yes });
        break;
      case 'reorder-stops':
        result = await input.service.reorderStops({
          tripId: stringFlag(flags, 'trip-id') ?? '',
          stopIds: await readIdList(stringFlag(flags, 'input'), 'stopIds', input.readFile),
          strict: Boolean(flags.strict),
        }, { dryRun, yes });
        break;
      case 'add-stop-link':
        result = await input.service.addStopLink({ tripId: stringFlag(flags, 'trip-id') ?? '', stopId: stringFlag(flags, 'stop-id') ?? '', url: stringFlag(flags, 'url') ?? '' }, { dryRun, yes });
        break;
      case 'delete-stop-link':
        result = await input.service.deleteStopLink({ tripId: stringFlag(flags, 'trip-id') ?? '', stopId: stringFlag(flags, 'stop-id') ?? '', linkId: stringFlag(flags, 'link-id') ?? '' }, { dryRun, yes });
        break;
      case 'list-activities':
        result = await input.service.listActivities({ tripId: stringFlag(flags, 'trip-id') ?? '', stopId: stringFlag(flags, 'stop-id') ?? '' });
        break;
      case 'create-activity':
        result = await input.service.createActivity({ tripId: stringFlag(flags, 'trip-id') ?? '', stopId: stringFlag(flags, 'stop-id') ?? '', activity: await readJson(stringFlag(flags, 'input'), input.readFile) }, { dryRun, yes });
        break;
      case 'update-activity':
        result = await input.service.updateActivity({ tripId: stringFlag(flags, 'trip-id') ?? '', activityId: stringFlag(flags, 'activity-id') ?? '', patch: await readJson(stringFlag(flags, 'input'), input.readFile) }, { dryRun, yes });
        break;
      case 'delete-activity':
        result = await input.service.deleteActivity({ tripId: stringFlag(flags, 'trip-id') ?? '', activityId: stringFlag(flags, 'activity-id') ?? '' }, { dryRun, yes });
        break;
      case 'reorder-activities':
        result = await input.service.reorderActivities({
          tripId: stringFlag(flags, 'trip-id') ?? '',
          stopId: stringFlag(flags, 'stop-id') ?? '',
          activityIds: await readIdList(stringFlag(flags, 'input'), 'activityIds', input.readFile),
        }, { dryRun, yes });
        break;
      case 'add-activity-link':
        result = await input.service.addActivityLink({ tripId: stringFlag(flags, 'trip-id') ?? '', activityId: stringFlag(flags, 'activity-id') ?? '', url: stringFlag(flags, 'url') ?? '' }, { dryRun, yes });
        break;
      case 'delete-activity-link':
        result = await input.service.deleteActivityLink({ tripId: stringFlag(flags, 'trip-id') ?? '', activityId: stringFlag(flags, 'activity-id') ?? '', linkId: stringFlag(flags, 'link-id') ?? '' }, { dryRun, yes });
        break;
      default:
        throw new Error(`Unknown trip command '${command}'.`);
    }

    input.write(`${JSON.stringify(result, null, flags.pretty ? 2 : 0)}\n`);
    return typeof result === 'object' && result && 'ok' in result && result.ok === false ? 1 : 0;
  } catch (caught) {
    input.writeError(`${caught instanceof Error ? caught.message : 'Trip CLI failed.'}\n`);
    return 1;
  }
}

async function main() {
  const supabase = createNodeSupabaseClient();
  await ensureNodeAnonymousSession(supabase);
  const service = createTripDataService({
    directory: createSupabaseTripDirectoryRepository(supabase),
    createTripRepository: (tripId) => createSupabaseTripRepository(supabase, tripId),
    calculateRoute: process.env.VITE_OPENROUTESERVICE_API_KEY
      ? (routeInput) => calculateOpenRouteServiceRoute({
          ...routeInput,
          apiKey: process.env.VITE_OPENROUTESERVICE_API_KEY ?? '',
        })
      : undefined,
    resolvePlace: createPlaceResolver({ apiKey: process.env.VITE_MAPTILER_API_KEY }),
    enrichLink: createLinkEnricher(createAppLinkPreviewClient()),
  });

  const exitCode = await runTripCli({
    argv: process.argv.slice(2),
    service,
    readFile: (path) => readFile(path, 'utf8'),
    write: (value) => process.stdout.write(value),
    writeError: (value) => process.stderr.write(value),
  });
  process.exitCode = exitCode;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
```

- [ ] **Step 6: Add npm script**

In `package.json`, add:

```json
"trip": "tsx src/cli/trip.ts"
```

- [ ] **Step 7: Run CLI tests and a smoke command**

Run:

```bash
npm test -- src/cli/tripCli.test.ts
npm run trip -- list --pretty
```

Expected:
- Test command: PASS.
- Smoke command: JSON output with either `{ "ok": true, "trips": [...] }` or a clear Supabase configuration/auth error.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/cli/nodeSupabase.ts src/cli/trip.ts src/cli/tripCli.test.ts
git commit -m "feat: add trip data cli"
```

---

### Task 7: Supabase Realtime Refresh

**Files:**
- Create: `src/storage/tripRealtime.ts`
- Create: `src/storage/tripRealtime.test.ts`
- Modify: `src/storage/appRepository.ts`
- Modify: `src/hooks/useTripWorkspace.ts`
- Modify: `src/App.tsx`
- Test: `src/App.test.tsx`

**Interfaces:**
- Produces:
  - `type TripRealtimeSubscriptions`
  - `function createSupabaseTripRealtime(supabase: SupabaseClient): TripRealtimeSubscriptions`
  - optional `realtime` field on app trip storage:

```ts
type TripRealtimeSubscriptions = {
  subscribeToTrips(onChange: () => void): () => void;
  subscribeToTripData(tripId: string, onChange: () => void): () => void;
};
```

- [ ] **Step 1: Write realtime helper tests**

Create `src/storage/tripRealtime.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createSupabaseTripRealtime } from './tripRealtime';

function createSupabaseMock() {
  const handlers: Array<() => void> = [];
  const channel = {
    on: vi.fn((_event, _filter, callback) => {
      handlers.push(callback as () => void);
      return channel;
    }),
    subscribe: vi.fn(() => channel),
  };
  return {
    handlers,
    supabase: {
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(),
    },
    channel,
  };
}

describe('trip realtime', () => {
  it('subscribes to trip table changes', () => {
    const { supabase, handlers } = createSupabaseMock();
    const onChange = vi.fn();
    const unsubscribe = createSupabaseTripRealtime(supabase as never).subscribeToTrips(onChange);

    expect(supabase.channel).toHaveBeenCalledWith('world-tour-trips');
    handlers[0]();
    expect(onChange).toHaveBeenCalledTimes(1);
    unsubscribe();
    expect(supabase.removeChannel).toHaveBeenCalled();
  });

  it('debounces bursts for active trip data changes', () => {
    vi.useFakeTimers();
    const { supabase, handlers } = createSupabaseMock();
    const onChange = vi.fn();
    createSupabaseTripRealtime(supabase as never).subscribeToTripData('trip-id', onChange);

    handlers.forEach((handler) => handler());
    vi.advanceTimersByTime(149);
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Implement realtime helper**

Create `src/storage/tripRealtime.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

export type TripRealtimeSubscriptions = {
  subscribeToTrips(onChange: () => void): () => void;
  subscribeToTripData(tripId: string, onChange: () => void): () => void;
};

function debounce(callback: () => void, delayMs: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      callback();
    }, delayMs);
  };
}

export function createSupabaseTripRealtime(supabase: SupabaseClient): TripRealtimeSubscriptions {
  return {
    subscribeToTrips(onChange) {
      const debounced = debounce(onChange, 150);
      const channel = supabase
        .channel('world-tour-trips')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'trips' }, debounced)
        .subscribe();

      return () => {
        void supabase.removeChannel(channel);
      };
    },

    subscribeToTripData(tripId, onChange) {
      const debounced = debounce(onChange, 150);
      const channel = supabase.channel(`world-tour-trip-${tripId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'destinations', filter: `trip_id=eq.${tripId}` }, debounced)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'route_legs', filter: `trip_id=eq.${tripId}` }, debounced)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'activities', filter: `trip_id=eq.${tripId}` }, debounced)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'media_assets', filter: `trip_id=eq.${tripId}` }, debounced)
        .subscribe();

      return () => {
        void supabase.removeChannel(channel);
      };
    },
  };
}
```

- [ ] **Step 3: Wire realtime into app storage**

In `src/storage/appRepository.ts`:

- import `createSupabaseTripRealtime`
- extend `AppTripStorage`:

```ts
import { createSupabaseTripRealtime, type TripRealtimeSubscriptions } from './tripRealtime';

type AppTripStorage = {
  directory: TripDirectoryRepository;
  createTripRepository: (tripId: string) => TripRepository;
  realtime?: TripRealtimeSubscriptions;
};
```

- in the Supabase return object, add:

```ts
realtime: createSupabaseTripRealtime(supabase as BrowserSupabaseClient),
```

- [ ] **Step 4: Add workspace refresh API**

In `src/hooks/useTripWorkspace.ts`, track the current active trip in a ref and return a `refreshTrips` action that reloads trip summaries from the current storage:

```ts
const activeTripRef = useRef<TripSummary | null>(null);

useEffect(() => {
  activeTripRef.current = activeTrip;
}, [activeTrip]);

const refreshTrips = useCallback(async () => {
  if (!storage) return;
  const nextTrips = await storage.directory.listTrips();
  const currentActive = activeTripRef.current;
  const nextActive = currentActive
    ? nextTrips.find((trip) => trip.id === currentActive.id) ?? nextTrips[0] ?? null
    : nextTrips[0] ?? null;

  setTrips(nextTrips);
  setActiveTrip(nextActive);
  activeTripRef.current = nextActive;
  setRepository(nextActive ? storage.createTripRepository(nextActive.id) : null);
}, [storage]);
```

Also expose `realtime: storage?.realtime ?? null` from the hook return value.

- [ ] **Step 5: Subscribe in App**

In `src/App.tsx`:

- destructure `refreshTrips` and `realtime` from `useTripWorkspace()`
- pass them into the inner app component
- add effects:

```ts
useEffect(() => {
  if (!realtime) return undefined;
  return realtime.subscribeToTrips(() => {
    void refreshTrips();
  });
}, [refreshTrips, realtime]);

useEffect(() => {
  if (!realtime || !activeTrip) return undefined;
  return realtime.subscribeToTripData(activeTrip.id, () => {
    void reload();
  });
}, [activeTrip, realtime, reload]);
```

`reload` is already returned by `useTripData`.

- [ ] **Step 6: Run realtime tests**

Run:

```bash
npm test -- src/storage/tripRealtime.test.ts src/App.test.tsx src/hooks/useTripWorkspace.test.tsx
```

Expected: PASS after adjusting existing hook/app tests for new returned fields.

- [ ] **Step 7: Commit**

```bash
git add src/storage/tripRealtime.ts src/storage/tripRealtime.test.ts src/storage/appRepository.ts src/hooks/useTripWorkspace.ts src/App.tsx src/App.test.tsx src/hooks/useTripWorkspace.test.tsx
git commit -m "feat: refresh app from trip realtime changes"
```

---

### Task 8: CLI Documentation And Skill Wrapper Guidance

**Files:**
- Create: `docs/trip-cli.md`
- Modify: `docs/superpowers/specs/2026-07-07-trip-data-cli-design.md` if implementation changed command names.
- Test: none beyond command smoke tests from Task 6.

**Interfaces:**
- Produces human/agent documentation for:
  - command list
  - JSON input shapes
  - dry-run/apply workflow
  - itinerary interpretation rules
  - media exclusion

- [ ] **Step 1: Create CLI docs**

Create `docs/trip-cli.md`:

```md
# Trip Data CLI

The trip CLI lets agents and local scripts read and write Supabase-backed world-tour trip data through app-owned commands.

## Safety Workflow

1. Read current state with `npm run trip -- list` and `npm run trip -- get --trip-id <id> --include-activities --include-links`.
2. Prefer narrow commands such as `insert-stop`, `update-stop`, `create-activity`, and `add-stop-link`.
3. Use `--dry-run` for destructive or broad commands.
4. Use `--yes` only after the user has approved destructive changes.
5. Refresh is automatic in the open app through Supabase realtime.

## Trip Commands

```bash
npm run trip -- list --pretty
npm run trip -- get --trip-id <id> --include-activities --include-links --pretty
npm run trip -- create --input ./trip.json
npm run trip -- delete --trip-id <id> --dry-run
npm run trip -- delete --trip-id <id> --yes
npm run trip -- rename --trip-id <id> --name "North Coast 500 Trip"
```

## Stop Commands

```bash
npm run trip -- replace-stops --trip-id <id> --input ./stops.json --dry-run
npm run trip -- insert-stop --trip-id <id> --after-stop-id <id> --input ./stop.json
npm run trip -- update-stop --trip-id <id> --stop-id <id> --input ./patch.json
npm run trip -- delete-stop --trip-id <id> --stop-id <id> --dry-run
npm run trip -- reorder-stops --trip-id <id> --input ./stop-order.json
```

## Stop JSON

```json
{
  "name": "Kyle of Tongue Hostel & Holiday Park",
  "place": {
    "query": "Kyle of Tongue Hostel & Holiday Park, Scotland",
    "coordinates": { "lat": 58.492089, "lng": -4.427364 }
  },
  "expectedStayDays": 1,
  "notes": "Booked. Ref: WTB10B2DD9",
  "tags": ["camping"]
}
```

## Link Commands

```bash
npm run trip -- add-stop-link --trip-id <id> --stop-id <id> --url https://example.com
npm run trip -- delete-stop-link --trip-id <id> --stop-id <id> --link-id <id>
npm run trip -- add-activity-link --trip-id <id> --activity-id <id> --url https://example.com
npm run trip -- delete-activity-link --trip-id <id> --activity-id <id> --link-id <id>
```

Agents provide only URLs. The service derives link titles, domains, preview images, timestamps, and sort order.

## Activity Commands

```bash
npm run trip -- create-activity --trip-id <id> --stop-id <id> --input ./activity.json
npm run trip -- list-activities --trip-id <id> --stop-id <id>
npm run trip -- update-activity --trip-id <id> --activity-id <id> --input ./activity-patch.json
npm run trip -- delete-activity --trip-id <id> --activity-id <id> --dry-run
npm run trip -- reorder-activities --trip-id <id> --stop-id <id> --input ./activity-order.json
```

## Activity JSON

```json
{
  "title": "Smoo Cave",
  "place": {
    "query": "Smoo Cave, Durness"
  }
}
```

## Itinerary Interpretation

- Overnight locations are route stops.
- Places visited between overnight locations are activities under the nearest relevant stop.
- Accommodation/provider URLs and map URLs for an overnight location are stop links.
- Activity/provider URLs and map URLs for a non-overnight place are activity links.
- Source dates, times, booking references, costs, and status text go into activity notes when attached to an activity.
- Stop-level booking/reference details can go into stop `notes`, but those notes are not yet surfaced in the app UI.
- Date and time fields are not structured in v1.
- Image import/upload is not part of v1 CLI writes.
```

- [ ] **Step 2: Run final verification**

Run:

```bash
npm test -- src/tripCommands/validation.test.ts src/tripCommands/placeResolver.test.ts src/tripCommands/linkEnrichment.test.ts src/tripCommands/routeOrchestration.test.ts src/tripCommands/tripDataService.test.ts src/cli/tripCli.test.ts src/storage/tripRealtime.test.ts src/hooks/useTripData.test.tsx src/hooks/useTripWorkspace.test.tsx src/App.test.tsx
npm run build
```

Expected: PASS for tests and build.

- [ ] **Step 3: Commit**

```bash
git add docs/trip-cli.md docs/superpowers/specs/2026-07-07-trip-data-cli-design.md
git commit -m "docs: document trip data cli"
```

---

## Self-Review

Spec coverage:

- Command contracts are covered in Tasks 1, 4, 5, 6, and 8.
- Place resolution and app-owned enrichment are covered in Task 2.
- Shared route derivation is covered in Task 3.
- CLI-first execution is covered in Task 6.
- Realtime app refresh is covered in Task 7.
- Skill wrapper and itinerary interpretation guidance are covered in Task 8.
- Image import is intentionally excluded from implementation and documented in Task 8.
- Stop notes storage is covered in Task 4; stop notes UI remains out of scope by user direction.

Prohibited text scan:

- No prohibited task text remains in this plan.

Type consistency:

- `PlaceInput`, `StopDraft`, `StopPatch`, `ActivityDraft`, `ActivityPatch`, `CommandResult`, `TripDataServiceDependencies`, `PlaceResolver`, and `LinkEnricher` are defined in Task 1 and consumed by later tasks.
- `createPlaceResolver` and `createLinkEnricher` are defined in Task 2 and consumed by Task 6.
- `reconcileAndSaveRouteLegs` is defined in Task 3 and consumed by Task 4.
- `createTripDataService` is defined in Task 4 and consumed by Task 6.
