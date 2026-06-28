# MapTiler Location Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Nominatim/manual search with live MapTiler search, direct lat/lng entry, and a small editable-stop-name location taxonomy.

**Architecture:** The domain model separates a user's editable stop name from the geocoded location fields. The geocoding adapter owns MapTiler request/response mapping plus local lat/lng detection. The toolbar becomes an accessible debounced combobox that searches as the user types and resolves coordinate-only input only after selection.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Dexie, MapTiler Geocoding API.

---

## File Structure

- Modify `src/domain/types.ts`: add `DestinationLocation`, attach it to `Destination`, update destination create input usage.
- Modify `src/domain/destinations.ts`: accept `location`, derive legacy fallback location when only `countryRegion` is provided.
- Create `src/domain/locations.ts`: format stop labels and build legacy fallback location objects.
- Modify `src/domain/destinations.test.ts`: cover new structured location and editable name separation.
- Modify `src/adapters/geocoding.ts`: replace Nominatim with MapTiler search, coordinate parsing, MapTiler feature mapping, and reverse-geocode normalization.
- Modify `src/adapters/geocoding.test.ts`: replace Nominatim tests with MapTiler place, coordinate, reverse-geocode, and blank-query tests.
- Modify `src/components/TopToolbar.tsx`: replace button-driven search with a debounced combobox and keyboard navigation.
- Modify `src/components/TopToolbar.test.tsx`: cover live search, stale responses, keyboard selection, click selection, and coordinate selection.
- Modify `src/components/DestinationProfile.tsx`: add editable stop name field and display formatted location.
- Modify `src/components/DestinationProfile.test.tsx`: cover renaming a stop without changing location data.
- Modify `src/components/ItineraryPanel.tsx` and `src/components/RouteLegEditor.tsx`: use location formatter instead of `countryRegion`.
- Modify `src/App.tsx`: wire `VITE_MAPTILER_API_KEY`, `searchMapTilerPlaces`, and selected-result resolution.
- Modify `src/storage/tripDb.ts`: add a version 3 schema index for `location.countryName` if useful.
- Modify `src/storage/tripRepository.ts`: normalize legacy destinations missing `location`.
- Modify `src/storage/tripRepository.test.ts`: verify legacy normalization.
- Modify `src/domain/snapshots.ts` and `src/domain/snapshots.test.ts`: keep imports tolerant of old snapshots.

---

### Task 1: Domain Location Taxonomy

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/domain/destinations.ts`
- Create: `src/domain/locations.ts`
- Test: `src/domain/destinations.test.ts`

- [ ] **Step 1: Add the failing domain tests**

Replace the first test in `src/domain/destinations.test.ts` with this version, then add the formatter test below it:

```ts
import { describe, expect, it } from 'vitest';
import { createDestination, updateDestination } from './destinations';
import { formatDestinationLocation } from './locations';

describe('destination helpers', () => {
  it('creates a destination with structured location fields', () => {
    const destination = createDestination({
      name: 'Balcombe',
      coordinates: { lat: 51.0576, lng: -0.1342 },
      location: {
        placeName: 'Balcombe',
        regionName: 'West Sussex',
        countryName: 'United Kingdom',
        countryCode: 'gb',
        sourceLabel: 'Balcombe, West Sussex, England, United Kingdom',
        sourceProvider: 'maptiler',
        sourceFeatureId: 'maptiler-balcombe',
      },
    });

    expect(destination.name).toBe('Balcombe');
    expect(destination.location.placeName).toBe('Balcombe');
    expect(destination.location.regionName).toBe('West Sussex');
    expect(destination.location.countryName).toBe('United Kingdom');
    expect(destination.countryRegion).toBe('United Kingdom');
    expect(destination.status).toBe('idea');
    expect(destination.priority).toBe('medium');
    expect(destination.order).toBe(0);
    expect(destination.timing.expectedStayDays).toBe(3);
    expect(destination.why.summary).toBe('');
    expect(destination.media).toEqual([]);
    expect(destination.research.links).toEqual([]);
    expect(destination.activities.items).toEqual([]);
    expect(destination.routeContext.notes).toBe('');
    expect(destination.tags).toEqual([]);
  });

  it('formats editable stop names separately from geocoded location names', () => {
    const destination = createDestination({
      name: 'Home',
      coordinates: { lat: 51.0576, lng: -0.1342 },
      location: {
        placeName: 'Balcombe',
        regionName: 'West Sussex',
        countryName: 'United Kingdom',
        countryCode: 'gb',
        sourceLabel: 'Balcombe, West Sussex, England, United Kingdom',
        sourceProvider: 'maptiler',
      },
    });

    expect(formatDestinationLocation(destination)).toBe('Home, Balcombe, West Sussex, United Kingdom');
  });

  // Keep the existing update and explicit-order tests below this line.
});
```

- [ ] **Step 2: Run the domain test to verify it fails**

Run:

```bash
npm test -- src/domain/destinations.test.ts
```

Expected: FAIL because `DestinationLocation` and `formatDestinationLocation` do not exist yet.

- [ ] **Step 3: Add location types**

In `src/domain/types.ts`, add this type after `Coordinates`:

```ts
export type DestinationLocation = {
  placeName: string;
  regionName: string;
  countryName: string;
  countryCode?: string;
  sourceLabel: string;
  sourceProvider: 'maptiler' | 'legacy';
  sourceFeatureId?: string;
};
```

Then add this field to `Destination` after `coordinates`:

```ts
  location: DestinationLocation;
```

- [ ] **Step 4: Add location helpers**

Create `src/domain/locations.ts`:

```ts
import type { Destination, DestinationLocation } from './types';

export function createLegacyLocation(input: {
  name: string;
  countryRegion?: string;
}): DestinationLocation {
  const countryName = input.countryRegion?.trim() ?? '';

  return {
    placeName: input.name,
    regionName: '',
    countryName,
    sourceLabel: [input.name, countryName].filter(Boolean).join(', '),
    sourceProvider: 'legacy',
  };
}

export function formatLocationParts(location: DestinationLocation): string {
  return [location.placeName, location.regionName, location.countryName].filter(Boolean).join(', ');
}

export function formatDestinationLocation(destination: Destination): string {
  const locationParts = formatLocationParts(destination.location);

  if (!locationParts || destination.name === destination.location.placeName) {
    return locationParts || destination.name;
  }

  return [destination.name, locationParts].filter(Boolean).join(', ');
}
```

- [ ] **Step 5: Update destination creation**

In `src/domain/destinations.ts`, import `DestinationLocation` and `createLegacyLocation`:

```ts
import type { Coordinates, Destination, DestinationLocation } from './types';
import { createLegacyLocation } from './locations';
```

Update `CreateDestinationInput`:

```ts
type CreateDestinationInput = {
  name: string;
  countryRegion?: string;
  location?: DestinationLocation;
  coordinates: Coordinates;
  order?: number;
};
```

Add `location` to the returned destination:

```ts
    countryRegion: input.location?.countryName || input.countryRegion || '',
    coordinates: input.coordinates,
    location: input.location ?? createLegacyLocation({
      name: input.name,
      countryRegion: input.countryRegion,
    }),
```

- [ ] **Step 6: Run the domain test to verify it passes**

Run:

```bash
npm test -- src/domain/destinations.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/domain/types.ts src/domain/destinations.ts src/domain/locations.ts src/domain/destinations.test.ts
git commit -m "feat: add structured stop location taxonomy"
```

---

### Task 2: MapTiler Geocoding And Coordinate Parsing

**Files:**
- Modify: `src/adapters/geocoding.ts`
- Test: `src/adapters/geocoding.test.ts`

- [ ] **Step 1: Replace adapter tests with MapTiler tests**

Replace `src/adapters/geocoding.test.ts` with:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  parseCoordinateQuery,
  resolveMapTilerCoordinates,
  searchMapTilerPlaces,
} from './geocoding';

describe('geocoding adapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps MapTiler place results into the app taxonomy', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        features: [
          {
            id: 'place.123',
            text: 'Balcombe',
            place_name: 'Balcombe, West Sussex, England, United Kingdom',
            center: [-0.1342, 51.0576],
            place_type: ['place'],
            properties: { country_code: 'gb' },
            context: [
              { id: 'county.1', text: 'West Sussex' },
              { id: 'country.1', text: 'United Kingdom', short_code: 'gb' },
            ],
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const results = await searchMapTilerPlaces('Balcombe', { apiKey: 'test-key' });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('https://api.maptiler.com/geocoding/Balcombe.json'),
      expect.any(Object),
    );
    expect(results).toEqual([
      {
        kind: 'place',
        id: 'place.123',
        label: 'Balcombe, West Sussex, England, United Kingdom',
        coordinates: { lat: 51.0576, lng: -0.1342 },
        location: {
          placeName: 'Balcombe',
          regionName: 'West Sussex',
          countryName: 'United Kingdom',
          countryCode: 'gb',
          sourceLabel: 'Balcombe, West Sussex, England, United Kingdom',
          sourceProvider: 'maptiler',
          sourceFeatureId: 'place.123',
        },
      },
    ]);
  });

  it('returns a local coordinate result without fetching while typing coordinates', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const results = await searchMapTilerPlaces('51.0576, -0.1342', { apiKey: 'test-key' });

    expect(results).toEqual([
      {
        kind: 'coordinates',
        id: 'coordinates:51.0576,-0.1342',
        label: 'Use coordinates 51.0576, -0.1342',
        coordinates: { lat: 51.0576, lng: -0.1342 },
      },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('parses common lat/lng formats', () => {
    expect(parseCoordinateQuery('51.0576, -0.1342')).toEqual({ lat: 51.0576, lng: -0.1342 });
    expect(parseCoordinateQuery('51.0576 -0.1342')).toEqual({ lat: 51.0576, lng: -0.1342 });
    expect(parseCoordinateQuery('91, 0')).toBeNull();
    expect(parseCoordinateQuery('0, 181')).toBeNull();
    expect(parseCoordinateQuery('Paris')).toBeNull();
  });

  it('reverse geocodes selected coordinates into the app taxonomy', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          features: [
            {
              id: 'reverse.123',
              text: 'Balcombe',
              place_name: 'Balcombe, West Sussex, England, United Kingdom',
              center: [-0.1342, 51.0576],
              place_type: ['place'],
              properties: { country_code: 'gb' },
              context: [
                { id: 'county.1', text: 'West Sussex' },
                { id: 'country.1', text: 'United Kingdom', short_code: 'gb' },
              ],
            },
          ],
        }),
      }),
    );

    const result = await resolveMapTilerCoordinates(
      { lat: 51.0576, lng: -0.1342 },
      { apiKey: 'test-key' },
    );

    expect(result.location.placeName).toBe('Balcombe');
    expect(result.location.regionName).toBe('West Sussex');
    expect(result.location.countryName).toBe('United Kingdom');
  });

  it('returns no results and skips fetch for a blank query', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const results = await searchMapTilerPlaces('   ', { apiKey: 'test-key' });

    expect(results).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects when MapTiler returns a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

    await expect(searchMapTilerPlaces('Istanbul', { apiKey: 'test-key' })).rejects.toThrow(
      'Place search failed',
    );
  });
});
```

- [ ] **Step 2: Run adapter tests to verify they fail**

Run:

```bash
npm test -- src/adapters/geocoding.test.ts
```

Expected: FAIL because MapTiler functions do not exist.

- [ ] **Step 3: Implement MapTiler adapter**

Replace `src/adapters/geocoding.ts` with:

```ts
import type { Coordinates, DestinationLocation } from '../domain/types';

export type PlaceSearchResult =
  | {
      kind: 'place';
      id: string;
      label: string;
      coordinates: Coordinates;
      location: DestinationLocation;
    }
  | {
      kind: 'coordinates';
      id: string;
      label: string;
      coordinates: Coordinates;
    };

type SearchOptions = {
  apiKey: string;
  signal?: AbortSignal;
};

type MapTilerContextItem = {
  id?: string;
  text?: string;
  short_code?: string;
};

type MapTilerFeature = {
  id?: string;
  text?: string;
  place_name?: string;
  center?: [number, number];
  place_type?: string[];
  properties?: {
    country_code?: string;
  };
  context?: MapTilerContextItem[];
};

type MapTilerResponse = {
  features?: MapTilerFeature[];
};

const mapTilerBaseUrl = 'https://api.maptiler.com/geocoding';
const usefulTypes = ['place', 'locality', 'municipality', 'region', 'subregion', 'county'];

export function parseCoordinateQuery(query: string): Coordinates | null {
  const match = query
    .trim()
    .match(/^(-?\d+(?:\.\d+)?)\s*(?:,|\s)\s*(-?\d+(?:\.\d+)?)$/);

  if (!match) return null;

  const lat = Number(match[1]);
  const lng = Number(match[2]);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  return { lat, lng };
}

export async function searchMapTilerPlaces(
  query: string,
  options: SearchOptions,
): Promise<PlaceSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const coordinates = parseCoordinateQuery(trimmed);
  if (coordinates) {
    return [
      {
        kind: 'coordinates',
        id: `coordinates:${coordinates.lat},${coordinates.lng}`,
        label: `Use coordinates ${coordinates.lat}, ${coordinates.lng}`,
        coordinates,
      },
    ];
  }

  const url = new URL(`${mapTilerBaseUrl}/${encodeURIComponent(trimmed)}.json`);
  url.searchParams.set('key', options.apiKey);
  url.searchParams.set('limit', '6');
  url.searchParams.set('autocomplete', 'true');
  url.searchParams.set('types', usefulTypes.join(','));

  const response = await fetch(url.toString(), { signal: options.signal });
  if (!response.ok) {
    throw new Error('Place search failed');
  }

  return mapMapTilerFeatures(await response.json());
}

export async function resolveMapTilerCoordinates(
  coordinates: Coordinates,
  options: SearchOptions,
): Promise<Extract<PlaceSearchResult, { kind: 'place' }>> {
  const url = new URL(`${mapTilerBaseUrl}/${coordinates.lng},${coordinates.lat}.json`);
  url.searchParams.set('key', options.apiKey);
  url.searchParams.set('limit', '1');
  url.searchParams.set('types', usefulTypes.join(','));

  const response = await fetch(url.toString(), { signal: options.signal });
  if (!response.ok) {
    throw new Error('Coordinate lookup failed');
  }

  const [result] = mapMapTilerFeatures(await response.json());
  if (!result || result.kind !== 'place') {
    throw new Error('No location found for coordinates');
  }

  return result;
}

function mapMapTilerFeatures(responseJson: MapTilerResponse): PlaceSearchResult[] {
  return (responseJson.features ?? []).flatMap((feature) => {
    const center = feature.center;
    if (!center || center.length !== 2) return [];

    return [
      {
        kind: 'place' as const,
        id: feature.id ?? feature.place_name ?? `${center[1]},${center[0]}`,
        label: feature.place_name ?? feature.text ?? 'Unnamed place',
        coordinates: { lat: center[1], lng: center[0] },
        location: mapFeatureLocation(feature),
      },
    ];
  });
}

function mapFeatureLocation(feature: MapTilerFeature): DestinationLocation {
  const context = feature.context ?? [];
  const country = findContext(context, 'country');
  const region = findContext(context, 'county') ?? findContext(context, 'region') ?? findContext(context, 'subregion');
  const countryCode = feature.properties?.country_code ?? country?.short_code;

  return {
    placeName: feature.text ?? feature.place_name?.split(',')[0]?.trim() ?? 'Unnamed place',
    regionName: region?.text ?? '',
    countryName: country?.text ?? '',
    countryCode,
    sourceLabel: feature.place_name ?? feature.text ?? 'Unnamed place',
    sourceProvider: 'maptiler',
    sourceFeatureId: feature.id,
  };
}

function findContext(context: MapTilerContextItem[], type: string): MapTilerContextItem | undefined {
  return context.find((item) => item.id?.startsWith(`${type}.`));
}
```

- [ ] **Step 4: Run adapter tests to verify they pass**

Run:

```bash
npm test -- src/adapters/geocoding.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/geocoding.ts src/adapters/geocoding.test.ts
git commit -m "feat: switch geocoding adapter to MapTiler"
```

---

### Task 3: Live Search Combobox

**Files:**
- Modify: `src/components/TopToolbar.tsx`
- Test: `src/components/TopToolbar.test.tsx`

- [ ] **Step 1: Replace toolbar tests for live search behavior**

Update the first toolbar test in `src/components/TopToolbar.test.tsx` to use live search without pressing a button:

```ts
it('shows live search results and adds the selected result', async () => {
  vi.useFakeTimers();
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const onAddDestination = vi.fn();
  render(
    <TopToolbar
      onAddDestination={onAddDestination}
      onExport={vi.fn()}
      onImportText={vi.fn()}
      resolveSearchResult={vi.fn(async (result) => result)}
      searchPlaces={vi.fn().mockResolvedValue([
        {
          kind: 'place',
          id: 'place-1',
          label: 'Balcombe, West Sussex, England, United Kingdom',
          coordinates: { lat: 51.0576, lng: -0.1342 },
          location: {
            placeName: 'Balcombe',
            regionName: 'West Sussex',
            countryName: 'United Kingdom',
            countryCode: 'gb',
            sourceLabel: 'Balcombe, West Sussex, England, United Kingdom',
            sourceProvider: 'maptiler',
            sourceFeatureId: 'place-1',
          },
        },
      ])}
    />,
  );

  await user.type(screen.getByLabelText('Search for a destination'), 'Balcombe');
  vi.advanceTimersByTime(300);

  await waitFor(() =>
    expect(screen.getByRole('option', { name: 'Balcombe, West Sussex, England, United Kingdom' })).toBeInTheDocument(),
  );
  await user.keyboard('{ArrowDown}{Enter}');

  expect(onAddDestination).toHaveBeenCalledWith({
    name: 'Balcombe',
    location: {
      placeName: 'Balcombe',
      regionName: 'West Sussex',
      countryName: 'United Kingdom',
      countryCode: 'gb',
      sourceLabel: 'Balcombe, West Sussex, England, United Kingdom',
      sourceProvider: 'maptiler',
      sourceFeatureId: 'place-1',
    },
    coordinates: { lat: 51.0576, lng: -0.1342 },
  });
  expect(screen.getByLabelText('Search for a destination')).toHaveValue('');
  vi.useRealTimers();
});
```

Add a coordinate selection test:

```ts
it('resolves a selected coordinate result before adding it', async () => {
  vi.useFakeTimers();
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const onAddDestination = vi.fn();
  const coordinateResult = {
    kind: 'coordinates' as const,
    id: 'coordinates:51.0576,-0.1342',
    label: 'Use coordinates 51.0576, -0.1342',
    coordinates: { lat: 51.0576, lng: -0.1342 },
  };

  render(
    <TopToolbar
      onAddDestination={onAddDestination}
      onExport={vi.fn()}
      onImportText={vi.fn()}
      searchPlaces={vi.fn().mockResolvedValue([coordinateResult])}
      resolveSearchResult={vi.fn(async () => ({
        kind: 'place',
        id: 'reverse-1',
        label: 'Balcombe, West Sussex, England, United Kingdom',
        coordinates: { lat: 51.0576, lng: -0.1342 },
        location: {
          placeName: 'Balcombe',
          regionName: 'West Sussex',
          countryName: 'United Kingdom',
          countryCode: 'gb',
          sourceLabel: 'Balcombe, West Sussex, England, United Kingdom',
          sourceProvider: 'maptiler',
          sourceFeatureId: 'reverse-1',
        },
      }))}
    />,
  );

  await user.type(screen.getByLabelText('Search for a destination'), '51.0576, -0.1342');
  vi.advanceTimersByTime(300);
  await user.keyboard('{ArrowDown}{Enter}');

  expect(onAddDestination).toHaveBeenCalledWith(
    expect.objectContaining({
      name: 'Balcombe',
      coordinates: { lat: 51.0576, lng: -0.1342 },
    }),
  );
  vi.useRealTimers();
});
```

- [ ] **Step 2: Run toolbar tests to verify they fail**

Run:

```bash
npm test -- src/components/TopToolbar.test.tsx
```

Expected: FAIL because `resolveSearchResult`, live debounce, and combobox roles are not implemented.

- [ ] **Step 3: Update toolbar props and state**

In `src/components/TopToolbar.tsx`, update imports and props:

```ts
import { Download, Upload } from 'lucide-react';
import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import type { PlaceSearchResult } from '../adapters/geocoding';
import type { Coordinates, DestinationLocation } from '../domain/types';

type AddDestinationInput = {
  name: string;
  location: DestinationLocation;
  coordinates: Coordinates;
};

type TopToolbarProps = {
  searchPlaces: (query: string) => Promise<PlaceSearchResult[]>;
  resolveSearchResult: (result: PlaceSearchResult) => Promise<Extract<PlaceSearchResult, { kind: 'place' }>>;
  onAddDestination: (input: AddDestinationInput) => Promise<void> | void;
  onExport: () => void;
  onImportText: (text: string) => Promise<void> | void;
};
```

Replace `nameFromLabel` with:

```ts
const liveSearchDelayMs = 300;

function addInputFromResult(result: Extract<PlaceSearchResult, { kind: 'place' }>): AddDestinationInput {
  return {
    name: result.location.placeName,
    location: result.location,
    coordinates: result.coordinates,
  };
}
```

- [ ] **Step 4: Implement debounced live search**

Inside `TopToolbar`, add:

```ts
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const searchTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (searchTimerRef.current !== null) {
      window.clearTimeout(searchTimerRef.current);
    }

    const trimmed = query.trim();
    if (!trimmed) {
      latestSearchId.current += 1;
      setResults([]);
      setHighlightedIndex(-1);
      setIsSearching(false);
      return;
    }

    searchTimerRef.current = window.setTimeout(() => {
      void handleSearch(trimmed);
    }, liveSearchDelayMs);

    return () => {
      if (searchTimerRef.current !== null) {
        window.clearTimeout(searchTimerRef.current);
      }
    };
  }, [query]);
```

Update `handleSearch` to accept `nextQuery: string` and remove the button-triggered usage:

```ts
  async function handleSearch(nextQuery: string) {
    const searchId = latestSearchId.current + 1;
    latestSearchId.current = searchId;
    setIsSearching(true);
    setError(null);
    try {
      const nextResults = await searchPlaces(nextQuery);
      if (searchId !== latestSearchId.current) return;
      setResults(nextResults);
      setHighlightedIndex(nextResults.length > 0 ? 0 : -1);
    } catch (caught) {
      if (searchId !== latestSearchId.current) return;
      setResults([]);
      setHighlightedIndex(-1);
      setError(caught instanceof Error ? caught.message : 'Search failed');
    } finally {
      if (searchId === latestSearchId.current) {
        setIsSearching(false);
      }
    }
  }
```

- [ ] **Step 5: Implement keyboard selection**

Add this handler inside `TopToolbar`:

```ts
  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setResults([]);
      setHighlightedIndex(-1);
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightedIndex((current) => Math.min(current + 1, results.length - 1));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightedIndex((current) => Math.max(current - 1, 0));
      return;
    }

    if (event.key === 'Enter' && highlightedIndex >= 0 && results[highlightedIndex]) {
      event.preventDefault();
      void handleSelectResult(results[highlightedIndex]);
    }
  }
```

Update `handleSelectResult`:

```ts
  async function handleSelectResult(result: PlaceSearchResult) {
    setError(null);
    try {
      const resolvedResult = await resolveSearchResult(result);
      await onAddDestination(addInputFromResult(resolvedResult));
      setQuery('');
      setResults([]);
      setHighlightedIndex(-1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to add destination');
    }
  }
```

- [ ] **Step 6: Replace search markup with combobox markup**

In the JSX, replace the search group with:

```tsx
      <div className="search-group">
        <label className="sr-only" htmlFor="destination-search">
          Search for a destination
        </label>
        <input
          id="destination-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleSearchKeyDown}
          placeholder="Search places or paste lat/lng"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={results.length > 0}
          aria-controls="destination-search-results"
          aria-activedescendant={highlightedIndex >= 0 ? `destination-result-${results[highlightedIndex]?.id}` : undefined}
        />
      </div>
```

Replace result markup with:

```tsx
      {results.length > 0 ? (
        <div id="destination-search-results" className="search-results" role="listbox">
          {results.map((result, index) => (
            <button
              id={`destination-result-${result.id}`}
              key={result.id}
              type="button"
              role="option"
              aria-selected={index === highlightedIndex}
              className={index === highlightedIndex ? 'is-highlighted' : undefined}
              onMouseEnter={() => setHighlightedIndex(index)}
              onClick={() => void handleSelectResult(result)}
            >
              {result.label}
            </button>
          ))}
        </div>
      ) : null}
```

- [ ] **Step 7: Run toolbar tests**

Run:

```bash
npm test -- src/components/TopToolbar.test.tsx
```

Expected: PASS after updating older button-search tests to live-search equivalents.

- [ ] **Step 8: Commit**

```bash
git add src/components/TopToolbar.tsx src/components/TopToolbar.test.tsx
git commit -m "feat: add live location search combobox"
```

---

### Task 4: App Wiring And Destination Name Editing

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/DestinationProfile.tsx`
- Test: `src/components/DestinationProfile.test.tsx`
- Test: `src/App.test.tsx`

- [ ] **Step 1: Add destination profile rename test**

In `src/components/DestinationProfile.test.tsx`, add:

```ts
it('saves an edited stop name without changing location fields', async () => {
  const user = userEvent.setup();
  const destination = createDestination({
    name: 'Balcombe',
    coordinates: { lat: 51.0576, lng: -0.1342 },
    location: {
      placeName: 'Balcombe',
      regionName: 'West Sussex',
      countryName: 'United Kingdom',
      countryCode: 'gb',
      sourceLabel: 'Balcombe, West Sussex, England, United Kingdom',
      sourceProvider: 'maptiler',
    },
  });
  const onUpdate = vi.fn();

  render(<DestinationProfile destination={destination} onUpdate={onUpdate} onClose={vi.fn()} />);

  const input = screen.getByLabelText('Stop name');
  await user.clear(input);
  await user.type(input, 'Home');
  await user.click(screen.getByRole('button', { name: 'Save destination' }));

  expect(onUpdate).toHaveBeenCalledWith(
    destination.id,
    expect.objectContaining({
      name: 'Home',
      location: destination.location,
    }),
  );
});
```

- [ ] **Step 2: Run profile tests to verify they fail**

Run:

```bash
npm test -- src/components/DestinationProfile.test.tsx
```

Expected: FAIL because there is no `Stop name` field.

- [ ] **Step 3: Add stop name to profile form state**

In `src/components/DestinationProfile.tsx`, add `name` to `DestinationFormState`:

```ts
  name: string;
```

Add it to `createFormState`:

```ts
  name: destination.name,
```

In `handleSave`, include:

```ts
        name: form.name.trim() || destination.name,
        location: destination.location,
```

Add this label near the top of the form after the profile header:

```tsx
      <label>
        Stop name
        <input value={form.name} onChange={(event) => updateForm({ name: event.target.value })} />
      </label>
```

- [ ] **Step 4: Update profile header display**

Import the formatter:

```ts
import { formatLocationParts } from '../domain/locations';
```

Replace:

```tsx
          <p>{destination.countryRegion || 'Unassigned region'}</p>
```

with:

```tsx
          <p>{formatLocationParts(destination.location) || 'Unassigned location'}</p>
```

- [ ] **Step 5: Wire MapTiler in the app**

In `src/App.tsx`, replace the geocoding import:

```ts
import {
  resolveMapTilerCoordinates,
  searchMapTilerPlaces,
  type PlaceSearchResult,
} from './adapters/geocoding';
```

Add:

```ts
const mapTilerApiKey = import.meta.env.VITE_MAPTILER_API_KEY ?? '';
```

Inside `App`, add:

```ts
  const searchPlaces = useCallback(
    (query: string) => searchMapTilerPlaces(query, { apiKey: mapTilerApiKey }),
    [],
  );

  const resolveSearchResult = useCallback(async (result: PlaceSearchResult) => {
    if (result.kind === 'place') return result;

    return resolveMapTilerCoordinates(result.coordinates, { apiKey: mapTilerApiKey });
  }, []);
```

Update `TopToolbar` props:

```tsx
              searchPlaces={searchPlaces}
              resolveSearchResult={resolveSearchResult}
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
npm test -- src/components/DestinationProfile.test.tsx src/App.test.tsx
```

Expected: PASS after updating app mocks from `searchNominatimPlaces` to the new MapTiler adapter names.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx src/App.test.tsx src/components/DestinationProfile.tsx src/components/DestinationProfile.test.tsx
git commit -m "feat: edit stop names independently of location"
```

---

### Task 5: Legacy Data Normalization And Display Cleanup

**Files:**
- Modify: `src/storage/tripRepository.ts`
- Modify: `src/storage/tripRepository.test.ts`
- Modify: `src/domain/snapshots.ts`
- Modify: `src/domain/snapshots.test.ts`
- Modify: `src/components/ItineraryPanel.tsx`
- Modify: `src/components/RouteLegEditor.tsx`

- [ ] **Step 1: Add repository legacy normalization test**

In `src/storage/tripRepository.test.ts`, extend the existing legacy test assertions:

```ts
    expect(destination.location).toEqual({
      placeName: 'Legacy stop',
      regionName: '',
      countryName: '',
      sourceLabel: 'Legacy stop',
      sourceProvider: 'legacy',
    });
```

Add a second legacy destination with `countryRegion: 'Turkey'` and assert `countryName` is `Turkey`.

- [ ] **Step 2: Run repository test to verify it fails**

Run:

```bash
npm test -- src/storage/tripRepository.test.ts
```

Expected: FAIL because `normalizeDestination` only normalizes order.

- [ ] **Step 3: Normalize legacy destinations**

In `src/storage/tripRepository.ts`, import:

```ts
import { createLegacyLocation } from '../domain/locations';
```

Replace `normalizeDestination` with:

```ts
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
```

- [ ] **Step 4: Use formatted labels in itinerary and route components**

In `src/components/ItineraryPanel.tsx`, import:

```ts
import { formatDestinationLocation, formatLocationParts } from '../domain/locations';
```

Replace stop primary display with `destination.name`, and replace the secondary region display with:

```tsx
<small>{formatLocationParts(destination.location) || 'Unassigned location'}</small>
```

In `src/components/RouteLegEditor.tsx`, import:

```ts
import { formatDestinationLocation } from '../domain/locations';
```

Replace:

```ts
return `${destination.name} - ${destination.countryRegion || 'Unassigned region'}`;
```

with:

```ts
return formatDestinationLocation(destination);
```

- [ ] **Step 5: Update snapshot parsing to normalize destinations**

In `src/domain/snapshots.ts`, import:

```ts
import { createLegacyLocation } from './locations';
```

Add:

```ts
function normalizeSnapshotDestination(destination: Destination): Destination {
  return {
    ...destination,
    countryRegion: destination.countryRegion ?? destination.location?.countryName ?? '',
    location:
      destination.location ??
      createLegacyLocation({
        name: destination.name,
        countryRegion: destination.countryRegion,
      }),
  };
}
```

Update returned destinations:

```ts
    destinations: (value.destinations as Destination[]).map(normalizeSnapshotDestination),
```

- [ ] **Step 6: Run compatibility tests**

Run:

```bash
npm test -- src/storage/tripRepository.test.ts src/domain/snapshots.test.ts src/components/RouteLegEditor.test.tsx
```

Expected: PASS after adjusting expected labels in component tests.

- [ ] **Step 7: Commit**

```bash
git add src/storage/tripRepository.ts src/storage/tripRepository.test.ts src/domain/snapshots.ts src/domain/snapshots.test.ts src/components/ItineraryPanel.tsx src/components/RouteLegEditor.tsx src/components/RouteLegEditor.test.tsx
git commit -m "fix: normalize legacy stop locations"
```

---

### Task 6: Final Verification

**Files:**
- Modify only if test failures reveal missed references.

- [ ] **Step 1: Search for stale Nominatim and countryRegion display usage**

Run:

```bash
rg -n "Nominatim|searchNominatimPlaces|countryRegion|Search\"" src tests
```

Expected: no Nominatim references. `countryRegion` may remain only in type compatibility, legacy normalization, and legacy tests.

- [ ] **Step 2: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 4: Run build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 5: Manual browser verification**

Run:

```bash
npm run dev
```

Expected: Vite prints a local URL, usually `http://127.0.0.1:5173/`.

Verify:

- Typing `Balcombe` shows live results without pressing Search.
- Arrow keys highlight results.
- Enter selects the highlighted result.
- Typing `51.0576, -0.1342` shows a coordinate result immediately.
- Selecting coordinates creates a stop after reverse geocoding.
- Opening the stop profile and changing `Balcombe` to `Home` displays `Home` as the stop name while keeping `Balcombe, West Sussex, United Kingdom` as the location.

- [ ] **Step 6: Commit final fixes**

```bash
git add src tests docs
git commit -m "test: verify MapTiler location search"
```

---

## Self-Review

- Spec coverage: The plan covers MapTiler live place search, direct lat/lng entry, dropping what3words, small four-level taxonomy, editable stop names, selection without a Search button, keyboard navigation, and legacy import/storage compatibility.
- Placeholder scan: No TBD/TODO placeholders remain.
- Type consistency: `DestinationLocation`, `PlaceSearchResult`, `searchMapTilerPlaces`, `resolveMapTilerCoordinates`, and formatter names are used consistently across tasks.
