# Search Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build shared MapTiler search profiles for macro stop search and micro activity search, then wire them into the top toolbar and stop-panel activity flow.

**Architecture:** `src/adapters/geocoding.ts` becomes the single search entry point with `stop` and `activity` profiles, richer normalized result data, and optional proximity distance. `SearchCombobox` owns debounced combobox behavior so the top toolbar and activity list can share search mechanics while rendering different result rows. Activity creation accepts optional location data so activity search selections can create location-aware child activities.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, MapTiler Geocoding API, existing trip repository hooks.

---

## File Structure

- Modify `src/adapters/geocoding.ts`: add search profiles, profile-specific MapTiler types, richer result normalization, proximity request support, and distance calculation.
- Modify `src/adapters/geocoding.test.ts`: cover stop/activity type filters, Sagres-style `municipal_district`, richer fields, coordinates, and distance.
- Create `src/components/SearchCombobox.tsx`: reusable debounced combobox state, stale-response protection, keyboard navigation, clear button, status, and error rendering.
- Create `src/components/SearchCombobox.test.tsx`: cover stale responses, keyboard selection, clear behavior, Escape cancellation, and render-prop display.
- Modify `src/components/TopToolbar.tsx`: replace local combobox state with `SearchCombobox` configured for simple stop result display.
- Modify `src/components/TopToolbar.test.tsx`: keep top-toolbar behavior coverage and assert no badges render for macro search results.
- Modify `src/domain/activities.ts`: allow optional activity location when creating activities.
- Modify `src/domain/activities.test.ts`: cover location-aware activity creation.
- Modify `src/storage/tripRepository.ts`: add optional `location` to `createActivity` input and persist it in local storage.
- Modify `src/storage/tripRepository.test.ts`: cover local activity creation with location.
- Modify `src/storage/supabaseTripRepository.ts`: pass optional activity location through Supabase create.
- Modify `src/storage/supabaseTripRepository.test.ts`: cover Supabase insert row includes location.
- Modify `src/hooks/useTripData.ts`: add optional location to `createActivity` action input.
- Modify `src/hooks/useTripData.test.tsx`: cover forwarding activity location to the repository.
- Modify `src/components/ActivityList.tsx`: replace the plain add-activity input with an activity search combobox plus a manual fallback typed title path.
- Modify `src/components/ActivityList.test.tsx`: cover activity search badges/context/distance and manual title creation.
- Modify `src/components/DestinationProfile.tsx`: pass activity search props and destination coordinates into `ActivityList`.
- Modify `src/components/DestinationProfile.test.tsx`: update existing activity creation expectations to the new `{ title, location }` input shape.
- Modify `src/App.tsx`: create activity-profile search and coordinate resolution callbacks, then pass them to the selected destination profile.
- Modify `src/App.test.tsx`: cover selecting an activity search result creates and selects a location-aware activity.
- Modify `src/styles.css`: style shared combobox states and activity-specific result badges without changing unrelated stylesheet work.

### Task 1: Add Search Profiles And Rich Result Normalization

**Files:**
- Modify: `src/adapters/geocoding.ts`
- Modify: `src/adapters/geocoding.test.ts`

- [ ] **Step 1: Write failing tests for stop and activity profile request types**

Add these tests inside `describe('geocoding adapter', () => { ... })` in `src/adapters/geocoding.test.ts`:

```ts
  it('uses macro stop result types without countries or landforms', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ features: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await searchMapTilerPlaces('Sagres', { apiKey: 'test-key', profile: 'stop' });

    const requestedUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(requestedUrl.searchParams.get('types')).toBe(
      [
        'place',
        'locality',
        'municipality',
        'municipal_district',
        'joint_municipality',
        'joint_submunicipality',
        'county',
        'subregion',
        'region',
      ].join(','),
    );
    expect(requestedUrl.searchParams.get('types')).not.toContain('country');
    expect(requestedUrl.searchParams.get('types')).not.toContain('major_landform');
  });

  it('uses micro activity result types and proximity bias', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ features: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await searchMapTilerPlaces('Louvre', {
      apiKey: 'test-key',
      profile: 'activity',
      proximity: { lat: 48.8566, lng: 2.3522 },
    });

    const requestedUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(requestedUrl.searchParams.get('types')).toBe(
      ['poi', 'address', 'road', 'neighbourhood', 'place', 'locality'].join(','),
    );
    expect(requestedUrl.searchParams.get('proximity')).toBe('2.3522,48.8566');
  });
```

- [ ] **Step 2: Run adapter tests and verify failure**

Run:

```bash
npm test -- src/adapters/geocoding.test.ts
```

Expected: FAIL because `SearchOptions` does not accept `profile` or `proximity`, and the adapter still uses the old `usefulTypes` array.

- [ ] **Step 3: Add profile types and request type mapping**

In `src/adapters/geocoding.ts`, replace the current `SearchOptions` and `usefulTypes` declarations with:

```ts
export type SearchProfile = 'stop' | 'activity';

type SearchOptions = {
  apiKey: string;
  profile?: SearchProfile;
  proximity?: Coordinates;
  signal?: AbortSignal;
};

const placeTypesByProfile: Record<SearchProfile, string[]> = {
  stop: [
    'place',
    'locality',
    'municipality',
    'municipal_district',
    'joint_municipality',
    'joint_submunicipality',
    'county',
    'subregion',
    'region',
  ],
  activity: ['poi', 'address', 'road', 'neighbourhood', 'place', 'locality'],
};

function getSearchProfile(options: SearchOptions): SearchProfile {
  return options.profile ?? 'stop';
}
```

Update `searchMapTilerPlaces` request construction:

```ts
  const profile = getSearchProfile(options);
  const url = new URL(`${mapTilerBaseUrl}/${encodeURIComponent(trimmed)}.json`);
  url.searchParams.set('key', options.apiKey);
  url.searchParams.set('limit', '6');
  url.searchParams.set('autocomplete', 'true');
  url.searchParams.set('types', placeTypesByProfile[profile].join(','));
  if (options.proximity) {
    url.searchParams.set('proximity', `${options.proximity.lng},${options.proximity.lat}`);
  }
```

Update `resolveMapTilerCoordinates` to use the selected profile types:

```ts
  const profile = getSearchProfile(options);
  const url = new URL(`${mapTilerBaseUrl}/${coordinates.lng},${coordinates.lat}.json`);
  url.searchParams.set('key', options.apiKey);
  url.searchParams.set('limit', '1');
  url.searchParams.set('types', placeTypesByProfile[profile].join(','));
```

- [ ] **Step 4: Run adapter tests and verify the new profile request tests pass**

Run:

```bash
npm test -- src/adapters/geocoding.test.ts
```

Expected: PASS for the new request type tests, with possible failures only from later rich-result expectations that have not been added yet.

- [ ] **Step 5: Write failing tests for richer MapTiler fields and activity distance**

Add this test to `src/adapters/geocoding.test.ts`:

```ts
  it('preserves MapTiler metadata and computes distance from proximity', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          features: [
            {
              id: 'poi.123',
              text: 'Louvre Museum',
              place_name: 'Louvre Museum, Rue de Rivoli, 75001 Paris, France',
              matching_text: 'Musee du Louvre',
              matching_place_name: 'Musee du Louvre, Paris, France',
              center: [2.3364, 48.8606],
              bbox: [2.333, 48.858, 2.34, 48.863],
              relevance: 0.98,
              place_type: ['poi'],
              place_type_name: ['Museum'],
              address: 'Rue de Rivoli',
              properties: { country_code: 'fr' },
              context: [
                { id: 'place.1', text: 'Paris' },
                { id: 'region.1', text: 'Ile-de-France' },
                { id: 'country.1', text: 'France', short_code: 'fr' },
              ],
            },
          ],
        }),
      }),
    );

    const [result] = await searchMapTilerPlaces('Louvre', {
      apiKey: 'test-key',
      profile: 'activity',
      proximity: { lat: 48.8566, lng: 2.3522 },
    });

    expect(result).toMatchObject({
      kind: 'place',
      id: 'poi.123',
      label: 'Louvre Museum, Rue de Rivoli, 75001 Paris, France',
      placeTypes: ['poi'],
      placeTypeNames: ['Museum'],
      address: 'Rue de Rivoli',
      bbox: [2.333, 48.858, 2.34, 48.863],
      relevance: 0.98,
      matchingText: 'Musee du Louvre',
      matchingPlaceName: 'Musee du Louvre, Paris, France',
      location: {
        placeName: 'Louvre Museum',
        regionName: 'Ile-de-France',
        countryName: 'France',
        countryCode: 'fr',
      },
    });
    expect(result.kind === 'place' ? result.context : []).toEqual([
      { id: 'place.1', text: 'Paris' },
      { id: 'region.1', text: 'Ile-de-France' },
      { id: 'country.1', text: 'France', shortCode: 'fr' },
    ]);
    expect(result.kind === 'place' ? result.distanceFromProximityKm : undefined).toBeCloseTo(1.3, 1);
  });
```

Add this test for the Sagres regression:

```ts
  it('maps municipal district results such as Sagres, Portugal', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          features: [
            {
              id: 'municipal_district.123',
              text: 'Sagres',
              place_name: 'Sagres, Portugal',
              center: [-8.9419, 37.0078],
              place_type: ['municipal_district'],
              place_type_name: ['Civil parish'],
              context: [
                { id: 'municipality.1', text: 'Vila do Bispo' },
                { id: 'county.1', text: 'Faro' },
                { id: 'country.1', text: 'Portugal', short_code: 'pt' },
              ],
            },
          ],
        }),
      }),
    );

    const [result] = await searchMapTilerPlaces('Sagres', {
      apiKey: 'test-key',
      profile: 'stop',
    });

    expect(result).toMatchObject({
      kind: 'place',
      id: 'municipal_district.123',
      label: 'Sagres, Portugal',
      coordinates: { lat: 37.0078, lng: -8.9419 },
      placeTypes: ['municipal_district'],
      placeTypeNames: ['Civil parish'],
      location: {
        placeName: 'Sagres',
        regionName: 'Faro',
        countryName: 'Portugal',
      },
    });
  });
```

- [ ] **Step 6: Run adapter tests and verify failure**

Run:

```bash
npm test -- src/adapters/geocoding.test.ts
```

Expected: FAIL because `PlaceSearchResult` does not expose rich MapTiler fields, context normalization, or distance.

- [ ] **Step 7: Extend adapter types and feature mapping**

In `src/adapters/geocoding.ts`, add these exported types above `PlaceSearchResult`:

```ts
export type PlaceSearchContextItem = {
  id?: string;
  text: string;
  shortCode?: string;
};

type PlaceSearchMetadata = {
  placeTypes: string[];
  placeTypeNames: string[];
  address?: string;
  bbox?: [number, number, number, number];
  relevance?: number;
  context: PlaceSearchContextItem[];
  matchingPlaceName?: string;
  matchingText?: string;
  distanceFromProximityKm?: number;
};
```

Update `PlaceSearchResult`:

```ts
export type PlaceSearchResult =
  | ({
      kind: 'place';
      id: string;
      label: string;
      coordinates: Coordinates;
      location: DestinationLocation;
    } & PlaceSearchMetadata)
  | {
      kind: 'coordinates';
      id: string;
      label: string;
      coordinates: Coordinates;
      distanceFromProximityKm?: number;
    };
```

Extend `MapTilerFeature`:

```ts
type MapTilerFeature = {
  id?: string;
  text?: string;
  place_name?: string;
  matching_text?: string;
  matching_place_name?: string;
  address?: string;
  center?: [number, number];
  bbox?: [number, number, number, number];
  relevance?: number;
  place_type?: string[];
  place_type_name?: string[];
  properties?: {
    country_code?: string;
  };
  context?: MapTilerContextItem[];
};
```

Change `mapMapTilerFeatures` to accept proximity:

```ts
function mapMapTilerFeatures(
  responseJson: MapTilerResponse,
  options: { proximity?: Coordinates } = {},
): PlaceSearchResult[] {
  return (responseJson.features ?? []).flatMap((feature) => {
    const center = feature.center;
    if (!center || center.length !== 2) return [];

    const coordinates = { lat: center[1], lng: center[0] };

    return [
      {
        kind: 'place' as const,
        id: feature.id ?? feature.place_name ?? `${center[1]},${center[0]}`,
        label: feature.place_name ?? feature.text ?? 'Unnamed place',
        coordinates,
        location: mapFeatureLocation(feature),
        placeTypes: feature.place_type ?? [],
        placeTypeNames: feature.place_type_name ?? [],
        address: feature.address,
        bbox: feature.bbox,
        relevance: feature.relevance,
        context: mapFeatureContext(feature.context ?? []),
        matchingPlaceName: feature.matching_place_name,
        matchingText: feature.matching_text,
        distanceFromProximityKm: options.proximity
          ? calculateDistanceKm(options.proximity, coordinates)
          : undefined,
      },
    ];
  });
}
```

Update callers:

```ts
  return mapMapTilerFeatures(await response.json(), { proximity: options.proximity });
```

and:

```ts
  const [result] = mapMapTilerFeatures(await response.json(), { proximity: options.proximity });
```

Add helpers near `findContext`:

```ts
function mapFeatureContext(context: MapTilerContextItem[]): PlaceSearchContextItem[] {
  return context
    .filter((item) => item.text)
    .map((item) => ({
      id: item.id,
      text: item.text ?? '',
      shortCode: item.short_code,
    }));
}

function calculateDistanceKm(from: Coordinates, to: Coordinates): number {
  const earthRadiusKm = 6371;
  const fromLat = degreesToRadians(from.lat);
  const toLat = degreesToRadians(to.lat);
  const deltaLat = degreesToRadians(to.lat - from.lat);
  const deltaLng = degreesToRadians(to.lng - from.lng);
  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(fromLat) * Math.cos(toLat) *
      Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function degreesToRadians(value: number): number {
  return value * Math.PI / 180;
}
```

For coordinate results, include distance when proximity is supplied:

```ts
    return [
      {
        kind: 'coordinates',
        id: `coordinates:${coordinates.lat},${coordinates.lng}`,
        label: `Use coordinates ${coordinates.lat}, ${coordinates.lng}`,
        coordinates,
        distanceFromProximityKm: options.proximity
          ? calculateDistanceKm(options.proximity, coordinates)
          : undefined,
      },
    ];
```

- [ ] **Step 8: Run adapter tests and commit**

Run:

```bash
npm test -- src/adapters/geocoding.test.ts
```

Expected: PASS.

Commit:

```bash
git add src/adapters/geocoding.ts src/adapters/geocoding.test.ts
git commit -m "feat: add search profiles"
```

### Task 2: Extract A Reusable Search Combobox

**Files:**
- Create: `src/components/SearchCombobox.tsx`
- Create: `src/components/SearchCombobox.test.tsx`
- Modify: `src/components/TopToolbar.tsx`
- Modify: `src/components/TopToolbar.test.tsx`

- [ ] **Step 1: Write tests for shared combobox behavior**

Create `src/components/SearchCombobox.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SearchCombobox } from './SearchCombobox';

type Result = {
  id: string;
  label: string;
  title: string;
  subtitle: string;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function renderSearchCombobox(input: {
  search?: (query: string) => Promise<Result[]>;
  onSelect?: (result: Result) => Promise<unknown> | unknown;
} = {}) {
  return render(
    <SearchCombobox<Result>
      label="Search test places"
      placeholder="Search places"
      inputId="test-search"
      resultsId="test-search-results"
      search={input.search ?? vi.fn().mockResolvedValue([])}
      getResultId={(result) => result.id}
      getResultLabel={(result) => result.label}
      onSelectResult={input.onSelect ?? vi.fn()}
      renderResult={(result) => (
        <>
          <span>{result.title}</span>
          <span>{result.subtitle}</span>
        </>
      )}
    />,
  );
}

describe('SearchCombobox', () => {
  it('searches, renders results, and selects the highlighted result', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const search = vi.fn().mockResolvedValue([
      { id: 'paris', label: 'Paris, France', title: 'Paris', subtitle: 'France' },
    ]);
    renderSearchCombobox({ search, onSelect });

    await user.type(screen.getByLabelText('Search test places'), 'Paris');

    await waitFor(() => expect(search).toHaveBeenCalledWith('Paris'));
    expect(await screen.findByRole('option', { name: 'Paris, France' })).toBeInTheDocument();

    await user.keyboard('{ArrowDown}{Enter}');

    expect(onSelect).toHaveBeenCalledWith({
      id: 'paris',
      label: 'Paris, France',
      title: 'Paris',
      subtitle: 'France',
    });
    expect(screen.getByLabelText('Search test places')).toHaveValue('');
  });

  it('ignores stale search responses', async () => {
    const user = userEvent.setup();
    const first = deferred<Result[]>();
    const second = deferred<Result[]>();
    const search = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    renderSearchCombobox({ search });

    const input = screen.getByLabelText('Search test places');
    await user.type(input, 'Paris');
    await waitFor(() => expect(search).toHaveBeenCalledWith('Paris'));
    await user.clear(input);
    await user.type(input, 'Seoul');
    await waitFor(() => expect(search).toHaveBeenCalledWith('Seoul'));

    first.resolve([{ id: 'paris', label: 'Paris, France', title: 'Paris', subtitle: 'France' }]);
    await waitFor(() => expect(screen.getByText('Searching...')).toBeInTheDocument());
    expect(screen.queryByRole('option', { name: 'Paris, France' })).not.toBeInTheDocument();

    second.resolve([{ id: 'seoul', label: 'Seoul, South Korea', title: 'Seoul', subtitle: 'South Korea' }]);
    expect(await screen.findByRole('option', { name: 'Seoul, South Korea' })).toBeInTheDocument();
  });

  it('clears query, results, and errors', async () => {
    const user = userEvent.setup();
    const search = vi.fn()
      .mockResolvedValueOnce([{ id: 'paris', label: 'Paris, France', title: 'Paris', subtitle: 'France' }])
      .mockRejectedValueOnce(new Error('Search unavailable'));
    renderSearchCombobox({ search });

    const input = screen.getByLabelText('Search test places');
    await user.type(input, 'Paris');
    await screen.findByRole('option', { name: 'Paris, France' });
    await user.clear(input);
    await user.type(input, 'Ankara');
    await screen.findByText('Search unavailable');
    await user.click(screen.getByRole('button', { name: 'Clear search' }));

    expect(input).toHaveValue('');
    expect(screen.queryByText('Search unavailable')).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Paris, France' })).not.toBeInTheDocument();
  });

  it('cancels Escape when clearing an active search', async () => {
    const user = userEvent.setup();
    const onAncestorKeyDown = vi.fn();
    const search = vi.fn().mockResolvedValue([
      { id: 'paris', label: 'Paris, France', title: 'Paris', subtitle: 'France' },
    ]);
    render(
      <div onKeyDown={onAncestorKeyDown}>
        <SearchCombobox<Result>
          label="Search test places"
          placeholder="Search places"
          inputId="test-search"
          resultsId="test-search-results"
          search={search}
          getResultId={(result) => result.id}
          getResultLabel={(result) => result.label}
          onSelectResult={vi.fn()}
          renderResult={(result) => <span>{result.title}</span>}
        />
      </div>,
    );

    const input = screen.getByLabelText('Search test places');
    await user.type(input, 'Paris');
    await screen.findByRole('option', { name: 'Paris, France' });
    onAncestorKeyDown.mockClear();

    const wasNotCanceled = fireEvent.keyDown(input, { key: 'Escape', code: 'Escape' });

    expect(wasNotCanceled).toBe(false);
    expect(onAncestorKeyDown).not.toHaveBeenCalled();
    expect(input).toHaveValue('');
  });
});
```

- [ ] **Step 2: Run combobox tests and verify failure**

Run:

```bash
npm test -- src/components/SearchCombobox.test.tsx
```

Expected: FAIL because `SearchCombobox.tsx` does not exist.

- [ ] **Step 3: Create `SearchCombobox`**

Create `src/components/SearchCombobox.tsx`:

```tsx
import { Search, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

type SearchComboboxProps<Result> = {
  label: string;
  placeholder: string;
  inputId: string;
  resultsId: string;
  className?: string;
  clearLabel?: string;
  search: (query: string) => Promise<Result[]>;
  getResultId: (result: Result) => string;
  getResultLabel: (result: Result) => string;
  onSelectResult: (result: Result) => Promise<unknown> | unknown;
  renderResult: (result: Result, state: { isHighlighted: boolean }) => ReactNode;
};

const liveSearchDelayMs = 300;

export function SearchCombobox<Result>({
  label,
  placeholder,
  inputId,
  resultsId,
  className = 'search-group',
  clearLabel = 'Clear search',
  search,
  getResultId,
  getResultLabel,
  onSelectResult,
  renderResult,
}: SearchComboboxProps<Result>) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestSearchId = useRef(0);
  const searchTimerRef = useRef<number | null>(null);

  const handleSearch = useCallback(
    async (nextQuery: string) => {
      const searchId = latestSearchId.current + 1;
      latestSearchId.current = searchId;
      setIsSearching(true);
      setError(null);
      try {
        const nextResults = await search(nextQuery);
        if (searchId !== latestSearchId.current) return;
        setResults(nextResults);
        setHighlightedIndex(-1);
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
    },
    [search],
  );

  useEffect(() => {
    if (searchTimerRef.current !== null) {
      window.clearTimeout(searchTimerRef.current);
    }

    const trimmed = query.trim();
    if (!trimmed) {
      latestSearchId.current += 1;
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
  }, [handleSearch, query]);

  function clearSearch() {
    latestSearchId.current += 1;
    setQuery('');
    setResults([]);
    setHighlightedIndex(-1);
    setIsSearching(false);
    setError(null);
  }

  async function selectResult(result: Result) {
    setError(null);
    try {
      await onSelectResult(result);
      clearSearch();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to select result');
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      clearSearch();
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
      void selectResult(results[highlightedIndex]);
    }
  }

  const activeResultId =
    highlightedIndex >= 0 && results[highlightedIndex]
      ? `${resultsId}-${getResultId(results[highlightedIndex])}`
      : undefined;

  return (
    <div className={className}>
      <label className="sr-only" htmlFor={inputId}>
        {label}
      </label>
      <div className="search-input-shell">
        <Search className="search-input-icon" size={18} aria-hidden="true" />
        <input
          id={inputId}
          value={query}
          onChange={(event) => {
            const nextQuery = event.target.value;
            setQuery(nextQuery);
            if (!nextQuery.trim()) {
              latestSearchId.current += 1;
              setResults([]);
              setHighlightedIndex(-1);
              setIsSearching(false);
            }
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={results.length > 0}
          aria-controls={resultsId}
          aria-activedescendant={activeResultId}
        />
        {query ? (
          <button type="button" className="search-clear" aria-label={clearLabel} onClick={clearSearch}>
            <X size={16} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {isSearching ? <div className="toolbar-status">Searching...</div> : null}
      {error ? <div className="toolbar-error">{error}</div> : null}
      {results.length > 0 ? (
        <div id={resultsId} className="search-results" role="listbox">
          {results.map((result, index) => {
            const isHighlighted = index === highlightedIndex;
            const resultId = `${resultsId}-${getResultId(result)}`;
            return (
              <button
                id={resultId}
                key={resultId}
                type="button"
                role="option"
                aria-label={getResultLabel(result)}
                aria-selected={isHighlighted}
                className={isHighlighted ? 'is-highlighted' : undefined}
                onMouseEnter={() => setHighlightedIndex(index)}
                onClick={() => void selectResult(result)}
              >
                {renderResult(result, { isHighlighted })}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run combobox tests and verify pass**

Run:

```bash
npm test -- src/components/SearchCombobox.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Refactor `TopToolbar` to use `SearchCombobox`**

In `src/components/TopToolbar.tsx`, remove local `query`, `results`, `highlightedIndex`, `isSearching`, `error`, `latestSearchId`, `searchTimerRef`, `handleSearch`, `handleQueryChange`, `handleClearSearch`, and `handleSearchKeyDown` state/helpers.

Keep `addInputFromResult` and `formatSearchResult`, then render:

```tsx
    <header className="top-toolbar" aria-label="Map planning tools">
      <SearchCombobox<PlaceSearchResult>
        label="Search for a destination"
        placeholder="Find a city, town, or region"
        inputId="destination-search"
        resultsId="destination-search-results"
        clearLabel="Clear destination search"
        search={searchPlaces}
        getResultId={(result) => result.id}
        getResultLabel={(result) => result.label}
        onSelectResult={async (result) => {
          const resolvedResult = await resolveSearchResult(result);
          await onAddDestination(addInputFromResult(resolvedResult));
        }}
        renderResult={(result) => {
          const formattedResult = formatSearchResult(result);
          return (
            <>
              <span className="search-result-title">{formattedResult.title}</span>
              <span className="search-result-subtitle">{formattedResult.subtitle}</span>
            </>
          );
        }}
      />
    </header>
```

Import `SearchCombobox`:

```ts
import { SearchCombobox } from './SearchCombobox';
```

Remove now-unused imports from `lucide-react` and React hooks.

- [ ] **Step 6: Update top toolbar tests for new placeholder and no badges**

In `src/components/TopToolbar.test.tsx`, update the placeholder assertion:

```ts
expect(screen.getByPlaceholderText('Find a city, town, or region')).toBeInTheDocument();
```

Add this test:

```tsx
  it('renders simple stop results without type badges', async () => {
    const user = userEvent.setup();
    const searchPlaces = vi.fn().mockResolvedValue([
      {
        ...balcombeResult,
        placeTypes: ['municipal_district'],
        placeTypeNames: ['Civil parish'],
      },
    ]);

    render(
      <TopToolbar
        onAddDestination={vi.fn()}
        resolveSearchResult={vi.fn(async (result) => result as Extract<PlaceSearchResult, { kind: 'place' }>)}
        searchPlaces={searchPlaces}
      />,
    );

    await user.type(screen.getByLabelText('Search for a destination'), 'Sagres');

    expect(await screen.findByRole('option', { name: 'Balcombe, West Sussex, England, United Kingdom' })).toBeInTheDocument();
    expect(screen.queryByText('Civil parish')).not.toBeInTheDocument();
  });
```

- [ ] **Step 7: Run component tests and commit**

Run:

```bash
npm test -- src/components/SearchCombobox.test.tsx src/components/TopToolbar.test.tsx
```

Expected: PASS.

Commit:

```bash
git add src/components/SearchCombobox.tsx src/components/SearchCombobox.test.tsx src/components/TopToolbar.tsx src/components/TopToolbar.test.tsx
git commit -m "refactor: share search combobox"
```

### Task 3: Let Activities Be Created With Location Data

**Files:**
- Modify: `src/domain/activities.ts`
- Modify: `src/domain/activities.test.ts`
- Modify: `src/storage/tripRepository.ts`
- Modify: `src/storage/tripRepository.test.ts`
- Modify: `src/storage/supabaseTripRepository.ts`
- Modify: `src/storage/supabaseTripRepository.test.ts`
- Modify: `src/hooks/useTripData.ts`
- Modify: `src/hooks/useTripData.test.tsx`

- [ ] **Step 1: Add failing domain test for activity location creation**

In `src/domain/activities.test.ts`, add:

```ts
  it('creates an activity with optional location data', () => {
    const activity = createActivity({
      destinationId: 'destination-1',
      title: 'Louvre Museum',
      location: {
        name: 'Louvre Museum',
        address: 'Rue de Rivoli',
        coordinates: { lat: 48.8606, lng: 2.3364 },
        sourceProvider: 'maptiler',
        sourceFeatureId: 'poi.123',
      },
    });

    expect(activity.location).toEqual({
      name: 'Louvre Museum',
      address: 'Rue de Rivoli',
      coordinates: { lat: 48.8606, lng: 2.3364 },
      sourceProvider: 'maptiler',
      sourceFeatureId: 'poi.123',
    });
  });
```

- [ ] **Step 2: Run domain activity tests and verify failure**

Run:

```bash
npm test -- src/domain/activities.test.ts
```

Expected: FAIL because `CreateActivityInput` does not accept `location` and `createActivity` does not set it.

- [ ] **Step 3: Update activity creation model**

In `src/domain/activities.ts`, import `ActivityLocation`:

```ts
import type { Activity, ActivityLocation } from './types';
```

Update `CreateActivityInput`:

```ts
type CreateActivityInput = {
  destinationId: string;
  title: string;
  order?: number;
  location?: ActivityLocation;
};
```

Add `location` to the created activity after `priority`:

```ts
    location: input.location,
```

- [ ] **Step 4: Run domain activity tests and verify pass**

Run:

```bash
npm test -- src/domain/activities.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add repository and hook tests for location forwarding**

In `src/storage/tripRepository.test.ts`, add or update a create-activity test:

```ts
  it('creates a local activity with location data', async () => {
    const repository = createTripRepository();
    const destination = await repository.saveDestination(createDestination({
      name: 'Paris',
      countryRegion: 'France',
      coordinates: { lat: 48.8566, lng: 2.3522 },
    }));

    const activity = await repository.createActivity({
      destinationId: destination.id,
      title: 'Louvre Museum',
      location: {
        name: 'Louvre Museum',
        address: 'Rue de Rivoli',
        coordinates: { lat: 48.8606, lng: 2.3364 },
        sourceProvider: 'maptiler',
        sourceFeatureId: 'poi.123',
      },
    });

    expect(activity.location).toEqual({
      name: 'Louvre Museum',
      address: 'Rue de Rivoli',
      coordinates: { lat: 48.8606, lng: 2.3364 },
      sourceProvider: 'maptiler',
      sourceFeatureId: 'poi.123',
    });
  });
```

Use the existing local repository helper already used by the other `tripRepository.test.ts` activity tests in this file. Keep the expectation exactly on `activity.location`.

In `src/hooks/useTripData.test.tsx`, add a test near existing activity action tests:

```ts
  it('forwards activity location through createActivity', async () => {
    const repository = createRepositoryMock();
    const activity = createActivityModel({
      destinationId: 'destination-1',
      title: 'Louvre Museum',
      location: {
        name: 'Louvre Museum',
        address: 'Rue de Rivoli',
        coordinates: { lat: 48.8606, lng: 2.3364 },
        sourceProvider: 'maptiler',
        sourceFeatureId: 'poi.123',
      },
    });
    repository.createActivity.mockResolvedValue(activity);

    const { result } = renderHook(() => useTripData(repository));

    await act(async () => {
      await result.current.createActivity({
        destinationId: 'destination-1',
        title: 'Louvre Museum',
        location: activity.location,
      });
    });

    expect(repository.createActivity).toHaveBeenCalledWith({
      destinationId: 'destination-1',
      title: 'Louvre Museum',
      location: activity.location,
    });
  });
```

In `src/storage/supabaseTripRepository.test.ts`, add a mapper-level assertion to the existing `maps activities to and from Supabase rows` test. That test already builds an activity with `location`, calls `activityToSupabaseRow`, and round-trips through `activityFromSupabaseRow`. Add this assertion to its `expect(row).toMatchObject({ ... })` block:

```ts
      location: activity.location,
```

Then add this create-path test near `creates activities through Supabase using active trip scope`:

```ts
  it('inserts activity location when creating a Supabase activity', async () => {
    const tripId = crypto.randomUUID();
    const destinationId = crypto.randomUUID();
    const insertedRows: unknown[] = [];
    const insert = vi.fn((row: unknown) => {
      insertedRows.push(row);
      return {
        select: vi.fn(() => ({
          single: vi.fn(async () => ({
            data: {
              ...(row as Record<string, unknown>),
              created_at: '2026-07-04T10:00:00.000Z',
              updated_at: '2026-07-04T10:00:00.000Z',
            },
            error: null,
          })),
        })),
      };
    });
    const select = vi.fn(() => ({
      eq: vi.fn(() => ({
        order: vi.fn(async () => ({
          data: [],
          error: null,
        })),
      })),
    }));
    const supabase = {
      from: vi.fn((tableName: string) => {
        if (tableName === 'activities') return { insert, select };
        return { select };
      }),
    };
    const repository = createSupabaseTripRepository(supabase as never, tripId);

    await repository.createActivity({
      destinationId,
      title: 'Louvre Museum',
      location: {
        name: 'Louvre Museum',
        address: 'Rue de Rivoli',
        coordinates: { lat: 48.8606, lng: 2.3364 },
        sourceProvider: 'maptiler',
        sourceFeatureId: 'poi.123',
      },
    });

    expect(insertedRows[0]).toMatchObject({
      trip_id: tripId,
      destination_id: destinationId,
      title: 'Louvre Museum',
      location: {
        name: 'Louvre Museum',
        address: 'Rue de Rivoli',
        coordinates: { lat: 48.8606, lng: 2.3364 },
        sourceProvider: 'maptiler',
        sourceFeatureId: 'poi.123',
      },
    });
  });
```

- [ ] **Step 6: Run repository and hook tests and verify failure**

Run:

```bash
npm test -- src/storage/tripRepository.test.ts src/storage/supabaseTripRepository.test.ts src/hooks/useTripData.test.tsx
```

Expected: FAIL because create-activity input types and persistence code do not yet accept location.

- [ ] **Step 7: Update local repository create input and persistence**

In `src/storage/tripRepository.ts`, update `TripRepository.createActivity` input:

```ts
  createActivity(input: {
    destinationId: string;
    title: string;
    order?: number;
    location?: Activity['location'];
  }): Promise<Activity>;
```

Update the local repository implementation call to `createActivity`:

```ts
      const activity = createActivity({
        destinationId: input.destinationId,
        title: input.title,
        order,
        location: input.location,
      });
```

- [ ] **Step 8: Update Supabase repository create input and row mapping**

In `src/storage/supabaseTripRepository.ts`, update the public `createActivity(input)` implementation so the created model receives location:

```ts
      const activity = createActivity({
        destinationId: input.destinationId,
        title: input.title,
        order,
        location: input.location,
      });
```

Ensure the inserted row uses `activityToSupabaseRow(activity, tripId)`. In `createActivity`, build the insert payload with:

```ts
const row = activityToSupabaseRow(activity, tripId);
```

Then pass `row` to the Supabase insert call:

```ts
const { data, error } = await supabase
  .from('activities')
  .insert(row)
  .select()
  .single();
```

- [ ] **Step 9: Update `useTripData` create action type**

In `src/hooks/useTripData.ts`, update the create action signature:

```ts
        async createActivity(input: {
          destinationId: string;
          title: string;
          order?: number;
          location?: Activity['location'];
        }) {
```

No further implementation changes should be needed if the action already forwards `input` to `repository.createActivity(input)`.

- [ ] **Step 10: Run all activity data tests and commit**

Run:

```bash
npm test -- src/domain/activities.test.ts src/storage/tripRepository.test.ts src/storage/supabaseTripRepository.test.ts src/hooks/useTripData.test.tsx
```

Expected: PASS.

Commit:

```bash
git add src/domain/activities.ts src/domain/activities.test.ts src/storage/tripRepository.ts src/storage/tripRepository.test.ts src/storage/supabaseTripRepository.ts src/storage/supabaseTripRepository.test.ts src/hooks/useTripData.ts src/hooks/useTripData.test.tsx
git commit -m "feat: create activities with locations"
```

### Task 4: Add Activity Search UI In The Stop Panel

**Files:**
- Modify: `src/components/ActivityList.tsx`
- Modify: `src/components/ActivityList.test.tsx`
- Modify: `src/components/DestinationProfile.tsx`
- Modify: `src/components/DestinationProfile.test.tsx`

- [ ] **Step 1: Add failing ActivityList tests for search result rendering and manual fallback**

In `src/components/ActivityList.test.tsx`, add imports:

```ts
import type { PlaceSearchResult } from '../adapters/geocoding';
```

Add a reusable Louvre result:

```ts
const louvreSearchResult = {
  kind: 'place',
  id: 'poi.123',
  label: 'Louvre Museum, Rue de Rivoli, 75001 Paris, France',
  coordinates: { lat: 48.8606, lng: 2.3364 },
  location: {
    placeName: 'Louvre Museum',
    regionName: 'Ile-de-France',
    countryName: 'France',
    countryCode: 'fr',
    sourceLabel: 'Louvre Museum, Rue de Rivoli, 75001 Paris, France',
    sourceProvider: 'maptiler',
    sourceFeatureId: 'poi.123',
  },
  placeTypes: ['poi'],
  placeTypeNames: ['Museum'],
  address: 'Rue de Rivoli',
  context: [
    { id: 'place.1', text: 'Paris' },
    { id: 'country.1', text: 'France', shortCode: 'fr' },
  ],
  distanceFromProximityKm: 1.3,
} satisfies Extract<PlaceSearchResult, { kind: 'place' }>;
```

Add tests:

```tsx
  it('renders activity search results with badges, context, and distance', async () => {
    const user = userEvent.setup();
    const searchActivities = vi.fn().mockResolvedValue([louvreSearchResult]);
    const onCreateActivity = vi.fn();

    render(
      <ActivityList
        activities={[]}
        selectedActivityId={null}
        onSelectActivity={vi.fn()}
        onCreateActivity={onCreateActivity}
        onDeleteActivity={vi.fn()}
        onReorderActivities={vi.fn()}
        searchActivities={searchActivities}
      />,
    );

    await user.type(screen.getByLabelText('Search for an activity'), 'Louvre');

    expect(await screen.findByRole('option', { name: louvreSearchResult.label })).toBeInTheDocument();
    expect(screen.getByText('Museum')).toBeInTheDocument();
    expect(screen.getByText('Rue de Rivoli')).toBeInTheDocument();
    expect(screen.getByText('1.3 km')).toBeInTheDocument();
  });

  it('creates a located activity from a selected search result', async () => {
    const user = userEvent.setup();
    const searchActivities = vi.fn().mockResolvedValue([louvreSearchResult]);
    const onCreateActivity = vi.fn();

    render(
      <ActivityList
        activities={[]}
        selectedActivityId={null}
        onSelectActivity={vi.fn()}
        onCreateActivity={onCreateActivity}
        onDeleteActivity={vi.fn()}
        onReorderActivities={vi.fn()}
        searchActivities={searchActivities}
      />,
    );

    await user.type(screen.getByLabelText('Search for an activity'), 'Louvre');
    await screen.findByRole('option', { name: louvreSearchResult.label });
    await user.keyboard('{ArrowDown}{Enter}');

    expect(onCreateActivity).toHaveBeenCalledWith({
      title: 'Louvre Museum',
      location: {
        name: 'Louvre Museum',
        address: 'Rue de Rivoli',
        coordinates: { lat: 48.8606, lng: 2.3364 },
        sourceProvider: 'maptiler',
        sourceFeatureId: 'poi.123',
      },
    });
  });

  it('keeps manual activity title creation from the search field', async () => {
    const user = userEvent.setup();
    const onCreateActivity = vi.fn();

    render(
      <ActivityList
        activities={[]}
        selectedActivityId={null}
        onSelectActivity={vi.fn()}
        onCreateActivity={onCreateActivity}
        onDeleteActivity={vi.fn()}
        onReorderActivities={vi.fn()}
        searchActivities={vi.fn().mockResolvedValue([])}
      />,
    );

    await user.type(screen.getByLabelText('Search for an activity'), 'Bakery crawl');
    await user.click(screen.getByRole('button', { name: 'Add activity' }));

    expect(onCreateActivity).toHaveBeenCalledWith({ title: 'Bakery crawl' });
  });
```

- [ ] **Step 2: Run ActivityList tests and verify failure**

Run:

```bash
npm test -- src/components/ActivityList.test.tsx
```

Expected: FAIL because `ActivityList` does not accept `searchActivities` and still uses `New activity title`.

- [ ] **Step 3: Update ActivityList props and creation input**

In `src/components/ActivityList.tsx`, import search types and combobox:

```ts
import type { PlaceSearchResult } from '../adapters/geocoding';
import type { Activity, ActivityLocation } from '../domain/types';
import { SearchCombobox } from './SearchCombobox';
```

Replace `onCreateActivity` prop:

```ts
  onCreateActivity: (input: { title: string; location?: ActivityLocation }) => Promise<unknown> | unknown;
  searchActivities: (query: string) => Promise<PlaceSearchResult[]>;
```

Add helpers above `ActivityList`:

```ts
function activityLocationFromSearchResult(
  result: Extract<PlaceSearchResult, { kind: 'place' }>,
): ActivityLocation {
  return {
    name: result.location.placeName,
    address: result.address ?? result.location.sourceLabel,
    coordinates: result.coordinates,
    sourceProvider: 'maptiler',
    sourceFeatureId: result.location.sourceFeatureId,
  };
}

function formatActivitySearchContext(result: PlaceSearchResult): string {
  if (result.kind === 'coordinates') return `${result.coordinates.lat}, ${result.coordinates.lng}`;
  return result.address || result.location.sourceLabel;
}

function formatDistance(distanceKm: number | undefined): string {
  if (distanceKm === undefined) return '';
  if (distanceKm < 10) return `${distanceKm.toFixed(1)} km`;
  return `${Math.round(distanceKm)} km`;
}

function formatTypeBadge(result: PlaceSearchResult): string {
  if (result.kind === 'coordinates') return 'Coordinates';
  return result.placeTypeNames[0] || result.placeTypes[0] || 'Place';
}
```

Update `submitNewActivity`:

```ts
  async function submitNewActivity() {
    const title = newActivityTitle.trim();
    if (!title) return;

    setMutationError('');
    try {
      await Promise.resolve(onCreateActivity({ title }));
      setNewActivityTitle('');
    } catch {
      setMutationError('Unable to update activities.');
    }
  }
```

Add handler:

```ts
  async function createActivityFromSearchResult(result: PlaceSearchResult) {
    if (result.kind === 'coordinates') {
      await onCreateActivity({
        title: `Coordinates ${result.coordinates.lat}, ${result.coordinates.lng}`,
        location: {
          name: `Coordinates ${result.coordinates.lat}, ${result.coordinates.lng}`,
          address: '',
          coordinates: result.coordinates,
          sourceProvider: 'manual',
        },
      });
      return;
    }

    await onCreateActivity({
      title: result.location.placeName,
      location: activityLocationFromSearchResult(result),
    });
  }
```

- [ ] **Step 4: Replace the add row input with activity search combobox**

In `ActivityList` JSX, replace the `<input aria-label="New activity title" ... />` inside `.activity-add-row` with:

```tsx
        <SearchCombobox<PlaceSearchResult>
          label="Search for an activity"
          placeholder="Find a place, venue, or address"
          inputId="activity-search"
          resultsId="activity-search-results"
          className="activity-search-group"
          search={searchActivities}
          getResultId={(result) => result.id}
          getResultLabel={(result) => result.label}
          onSelectResult={createActivityFromSearchResult}
          renderResult={(result) => {
            const distance = formatDistance(result.distanceFromProximityKm);
            return (
              <>
                <span className="search-result-title">{result.kind === 'place' ? result.location.placeName : 'Use coordinates'}</span>
                <span className="activity-search-meta">
                  <span className="activity-search-badge">{formatTypeBadge(result)}</span>
                  <span className="search-result-subtitle">{formatActivitySearchContext(result)}</span>
                  {distance ? <span className="activity-search-distance">{distance}</span> : null}
                </span>
              </>
            );
          }}
        />
```

Keep the existing plus button, but change the manual title source to use the search query. Add controlled-query props to `SearchCombobox`:

```ts
  value?: string;
  onValueChange?: (value: string) => void;
```

Then in `SearchCombobox`, use:

```ts
  const [internalQuery, setInternalQuery] = useState('');
  const query = value ?? internalQuery;
  const setQueryValue = onValueChange ?? setInternalQuery;
```

Replace `setQuery(...)` calls with `setQueryValue(...)`.

Use the controlled value in `ActivityList`:

```tsx
          value={newActivityTitle}
          onValueChange={setNewActivityTitle}
```

Update `SearchCombobox.test.tsx` with this controlled-value test:

```tsx
  it('supports controlled query state', async () => {
    const user = userEvent.setup();
    function ControlledSearch() {
      const [value, setValue] = useState('');
      return (
        <>
          <SearchCombobox<Result>
            label="Search test places"
            placeholder="Search places"
            inputId="test-search"
            resultsId="test-search-results"
            value={value}
            onValueChange={setValue}
            search={vi.fn().mockResolvedValue([])}
            getResultId={(result) => result.id}
            getResultLabel={(result) => result.label}
            onSelectResult={vi.fn()}
            renderResult={(result) => <span>{result.title}</span>}
          />
          <output aria-label="Current search">{value}</output>
        </>
      );
    }

    render(<ControlledSearch />);

    await user.type(screen.getByLabelText('Search test places'), 'Bakery');

    expect(screen.getByLabelText('Current search')).toHaveTextContent('Bakery');
  });
```

Add `useState` to the React import in `SearchCombobox.test.tsx`:

```ts
import { useState } from 'react';
```

- [ ] **Step 5: Update DestinationProfile props**

In `src/components/DestinationProfile.tsx`, import `ActivityLocation` and `PlaceSearchResult`:

```ts
import type { Activity, ActivityLocation, Destination, MediaItem, MediaRollupItem } from '../domain/types';
import type { PlaceSearchResult } from '../adapters/geocoding';
```

Update props:

```ts
  onCreateActivity: (
    destinationId: string,
    input: { title: string; location?: ActivityLocation },
  ) => Promise<void> | void;
  searchActivities: (query: string) => Promise<PlaceSearchResult[]>;
```

Update `ActivityList` usage:

```tsx
        onCreateActivity={(input) => onCreateActivity(destination.id, input)}
        searchActivities={searchActivities}
```

- [ ] **Step 6: Run ActivityList and DestinationProfile tests and commit**

Run:

```bash
npm test -- src/components/SearchCombobox.test.tsx src/components/ActivityList.test.tsx src/components/DestinationProfile.test.tsx
```

Expected: PASS after updating any existing tests that still query `New activity title` to use `Search for an activity`.

Commit:

```bash
git add src/components/SearchCombobox.tsx src/components/SearchCombobox.test.tsx src/components/ActivityList.tsx src/components/ActivityList.test.tsx src/components/DestinationProfile.tsx src/components/DestinationProfile.test.tsx
git commit -m "feat: add activity search field"
```

### Task 5: Wire Search Profiles Through App

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/components/TopToolbar.test.tsx`

- [ ] **Step 1: Add failing App test for activity search creation**

In `src/App.test.tsx`, add this test near the existing activity tests:

```tsx
  it('creates and selects an activity from stop-panel search', async () => {
    const user = userEvent.setup();
    const destination = createDestination({
      name: 'Paris',
      countryRegion: 'France',
      coordinates: { lat: 48.8566, lng: 2.3522 },
    });
    const louvre = createActivity({
      destinationId: destination.id,
      title: 'Louvre Museum',
      location: {
        name: 'Louvre Museum',
        address: 'Rue de Rivoli',
        coordinates: { lat: 48.8606, lng: 2.3364 },
        sourceProvider: 'maptiler',
        sourceFeatureId: 'poi.123',
      },
    });
    repositoryMock.initialDestinations = Promise.resolve([destination]);
    repositoryMock.listActivities.mockResolvedValue([]);
    repositoryMock.createActivity.mockResolvedValue(louvre);
    vi.mocked(searchMapTilerPlaces).mockResolvedValue([
      {
        kind: 'place',
        id: 'poi.123',
        label: 'Louvre Museum, Rue de Rivoli, 75001 Paris, France',
        coordinates: { lat: 48.8606, lng: 2.3364 },
        location: {
          placeName: 'Louvre Museum',
          regionName: 'Ile-de-France',
          countryName: 'France',
          countryCode: 'fr',
          sourceLabel: 'Louvre Museum, Rue de Rivoli, 75001 Paris, France',
          sourceProvider: 'maptiler',
          sourceFeatureId: 'poi.123',
        },
        placeTypes: ['poi'],
        placeTypeNames: ['Museum'],
        address: 'Rue de Rivoli',
        context: [],
        distanceFromProximityKm: 1.3,
      },
    ]);

    render(<App />);

    await waitFor(() => expect(screen.queryByText('Loading trip data')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Paris, France' }));
    await user.type(screen.getByLabelText('Search for an activity'), 'Louvre');
    await screen.findByRole('option', { name: 'Louvre Museum, Rue de Rivoli, 75001 Paris, France' });
    await user.keyboard('{ArrowDown}{Enter}');

    expect(searchMapTilerPlaces).toHaveBeenCalledWith('Louvre', {
      apiKey: expect.any(String),
      profile: 'activity',
      proximity: { lat: 48.8566, lng: 2.3522 },
    });
    expect(repositoryMock.createActivity).toHaveBeenCalledWith({
      destinationId: destination.id,
      title: 'Louvre Museum',
      location: louvre.location,
    });
    expect(await screen.findByRole('complementary', { name: 'Louvre Museum activity' })).toBeInTheDocument();
  });
```

Update the existing stop search App test to assert stop profile:

```ts
expect(searchMapTilerPlaces).toHaveBeenCalledWith('Kyoto', {
  apiKey: expect.any(String),
  profile: 'stop',
});
```

- [ ] **Step 2: Run App test and verify failure**

Run:

```bash
npm test -- src/App.test.tsx
```

Expected: FAIL because `App` still calls `searchMapTilerPlaces(query, { apiKey })` and `handleCreateActivity` still accepts a title string.

- [ ] **Step 3: Update App search callbacks**

In `src/App.tsx`, replace the current `searchPlaces` callback with:

```ts
  const searchStopPlaces = useCallback(
    (query: string) => searchMapTilerPlaces(query, { apiKey: mapTilerApiKey, profile: 'stop' }),
    [],
  );
```

Add activity search:

```ts
  const searchActivityPlaces = useCallback(
    (query: string) =>
      searchMapTilerPlaces(query, {
        apiKey: mapTilerApiKey,
        profile: 'activity',
        proximity: selectedDestination?.coordinates,
      }),
    [selectedDestination?.coordinates],
  );
```

Update `resolveSearchResult`:

```ts
  const resolveSearchResult = useCallback(
    (result: Awaited<ReturnType<typeof searchMapTilerPlaces>>[number]) => {
      if (result.kind === 'place') return Promise.resolve(result);

      return resolveMapTilerCoordinates(result.coordinates, {
        apiKey: mapTilerApiKey,
        profile: 'stop',
      });
    },
    [],
  );
```

Use `searchStopPlaces` when rendering `TopToolbar`:

```tsx
              searchPlaces={searchStopPlaces}
```

- [ ] **Step 4: Update App activity creation handler**

In `src/App.tsx`, import `ActivityLocation` if not already available from the existing type import:

```ts
import type { Activity, ActivityLocation, Coordinates, Destination, DestinationLocation, MediaRollupItem } from './domain/types';
```

Update `handleCreateActivity`:

```ts
  const handleCreateActivity = useCallback(
    async (destinationId: string, input: { title: string; location?: ActivityLocation }) => {
      const activity = await createActivity({
        destinationId,
        title: input.title,
        location: input.location,
      });
      setSelectedActivityId(activity.id);
    },
    [createActivity],
  );
```

Pass activity search to `DestinationProfile`:

```tsx
              searchActivities={searchActivityPlaces}
```

- [ ] **Step 5: Update App tests for existing manual activity flow**

In `src/App.test.tsx`, change existing manual creation expectations from:

```ts
expect(repositoryMock.createActivity).toHaveBeenCalledWith({
  destinationId: destination.id,
  title: 'Bakery crawl',
});
```

to:

```ts
expect(repositoryMock.createActivity).toHaveBeenCalledWith({
  destinationId: destination.id,
  title: 'Bakery crawl',
  location: undefined,
});
```

Keep the explicit `location: undefined` expectation. `handleCreateActivity` should always pass the same object shape to the repository:

```ts
      const activity = await createActivity({
        destinationId,
        title: input.title,
        location: input.location,
      });
```

- [ ] **Step 6: Run App and toolbar tests and commit**

Run:

```bash
npm test -- src/App.test.tsx src/components/TopToolbar.test.tsx
```

Expected: PASS.

Commit:

```bash
git add src/App.tsx src/App.test.tsx src/components/TopToolbar.test.tsx
git commit -m "feat: wire stop and activity search profiles"
```

### Task 6: Style Activity Search And Verify End To End

**Files:**
- Modify: `src/styles.css`

- [ ] **Step 1: Add activity search CSS**

In `src/styles.css`, add styles near the existing `.search-*` rules:

```css
.activity-search-group {
  position: relative;
  min-width: 0;
  flex: 1 1 auto;
}

.activity-search-group .search-results {
  left: 0;
  right: 0;
  top: calc(100% + 6px);
}

.activity-search-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: var(--color-text-muted);
  font-size: 0.8rem;
}

.activity-search-badge {
  flex: 0 0 auto;
  border: 1px solid var(--color-border-subtle);
  border-radius: 999px;
  padding: 1px 6px;
  color: var(--color-text);
  font-size: 0.72rem;
  line-height: 1.4;
}

.activity-search-distance {
  flex: 0 0 auto;
  color: var(--color-text-muted);
}
```

Use the exact variables shown above. They already match the existing stylesheet token names used around the current search/profile styles.

- [ ] **Step 2: Run focused tests**

Run:

```bash
npm test -- src/adapters/geocoding.test.ts src/components/SearchCombobox.test.tsx src/components/TopToolbar.test.tsx src/components/ActivityList.test.tsx src/components/DestinationProfile.test.tsx src/App.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run e2e smoke coverage**

Run:

```bash
npm run test:e2e
```

Expected: PASS. Remember Playwright owns a disposable Vite server on `127.0.0.1:5174` and stops it when done.

- [ ] **Step 4: Commit final styling and verification changes**

Commit:

```bash
git add src/styles.css
git commit -m "style: polish activity search results"
```

## Plan Self-Review

- Spec coverage: Task 1 covers central MapTiler profiles, no country/landform, Sagres via `municipal_district`, richer result fields, and distance. Task 2 covers shared combobox mechanics. Task 3 carries activity location through data layers. Task 4 creates the activity search UI with badges only in the stop panel. Task 5 wires both app search surfaces through the central search module. Task 6 covers styling and final verification.
- Placeholder scan: no `TBD`, `TODO`, or unspecified test steps remain. Supabase create-path coverage now uses an explicit mock in the plan rather than relying on unnamed file-local helpers.
- Type consistency: `SearchProfile`, `PlaceSearchResult`, `ActivityLocation`, `searchMapTilerPlaces`, and `resolveMapTilerCoordinates` are introduced before later tasks rely on them.
