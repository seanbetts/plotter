# Route Alternatives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add an icon-triggered route alternatives picker for each driving route row, calculating a small set of provider-backed options on demand and saving the selected option onto the existing route leg.

**Architecture:** Keep the existing adjacent-stop `RouteLeg` as the single persisted active route. Add a small domain route-option model, extend the OpenRouteService adapter to return normalized options, and wire an icon-only pencil button from `ItineraryPanel` to an `App`-owned route alternatives panel. Selecting an option updates the existing leg fields without creating stops, child legs, or persisted discarded alternatives.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, lucide-react, OpenRouteService Directions GeoJSON, existing `TripRepository` persistence.

---

## File Structure

- Create `src/domain/routeOptions.ts`: route option types, route option keying, dedupe logic, and conversion from a selected option into a route-leg patch.
- Create `src/domain/routeOptions.test.ts`: focused tests for route option normalization, dedupe, and applying a selected option.
- Modify `src/adapters/openRouteService.ts`: keep `calculateOpenRouteServiceRoute`, add `calculateOpenRouteServiceRouteOptions`, and share response parsing.
- Modify `src/adapters/openRouteService.test.ts`: add tests for `alternative_routes`, `avoid_features`, failed supplemental hiding, and malformed responses.
- Modify `src/hooks/useTripData.ts`: preserve a ready driving route patch with selected geometry instead of recalculating it immediately.
- Modify `src/hooks/useTripData.test.tsx`: cover selected alternative persistence through `updateRouteLeg`.
- Modify `src/components/ItineraryPanel.tsx`: add a pencil icon-only route edit button to inline driving route rows.
- Modify `src/components/ItineraryPanel.test.tsx`: cover the pencil button label, tooltip, and callback.
- Create `src/components/RouteAlternativesPanel.tsx`: display loading, empty, error, and option selection states for one route leg.
- Create `src/components/RouteAlternativesPanel.test.tsx`: cover route options UI behavior in isolation.
- Modify `src/App.tsx`: own route alternatives panel state, calculate options on demand, and save selected options through `updateRouteLeg`.
- Modify `src/App.test.tsx`: cover the integrated route alternatives flow with mocked options.
- Modify `src/styles.css`: add stable layout styles for the pencil button and alternatives panel.
- Do not modify `tests/world-tour.spec.ts` in this implementation. The deterministic App/component coverage is the verification surface for v1 route alternatives.

---

### Task 1: Add Route Option Domain Helpers

**Files:**
- Create: `src/domain/routeOptions.ts`
- Create: `src/domain/routeOptions.test.ts`
- Modify: none

- [x] **Step 1: Write the failing route option tests**

Create `src/domain/routeOptions.test.ts`:

```ts
import type { LineString } from 'geojson';
import { describe, expect, it } from 'vitest';
import { createRouteLeg } from './routeLegs';
import {
  createRouteOptionKey,
  dedupeRouteOptions,
  routeLegPatchFromRouteOption,
  routeOptionFromCalculation,
} from './routeOptions';

describe('route option helpers', () => {
  const origin = { lat: 51.5072, lng: -0.1276 };
  const target = { lat: 48.8566, lng: 2.3522 };
  const directGeometry: LineString = {
    type: 'LineString',
    coordinates: [
      [-0.1276, 51.5072],
      [2.3522, 48.8566],
    ],
  };
  const avoidHighwaysGeometry: LineString = {
    type: 'LineString',
    coordinates: [
      [-0.1276, 51.5072],
      [0.4, 50.8],
      [2.3522, 48.8566],
    ],
  };

  it('creates stable route option keys from coordinates, profile, and variant', () => {
    expect(
      createRouteOptionKey({
        origin,
        target,
        profile: 'driving-car',
        variant: 'avoid:highways',
      }),
    ).toBe('driving-car:-0.12762,51.50720:2.35220,48.85660:avoid:highways');
  });

  it('normalizes calculated route options with labels and provider metadata', () => {
    const option = routeOptionFromCalculation({
      id: 'recommended',
      label: 'Recommended',
      source: 'recommended',
      origin,
      target,
      distanceKm: 458.25,
      travelTimeHours: 5,
      geometry: directGeometry,
      provider: 'openrouteservice',
      profile: 'driving-car',
      variant: 'recommended',
    });

    expect(option).toEqual({
      id: 'recommended',
      label: 'Recommended',
      source: 'recommended',
      distanceKm: 458.25,
      travelTimeHours: 5,
      geometry: directGeometry,
      provider: 'openrouteservice',
      profile: 'driving-car',
      routeKey: 'driving-car:-0.12760,51.50720:2.35220,48.85660:recommended',
    });
  });

  it('deduplicates options with the same geometry while preserving order', () => {
    const recommended = routeOptionFromCalculation({
      id: 'recommended',
      label: 'Recommended',
      source: 'recommended',
      origin,
      target,
      distanceKm: 458.25,
      travelTimeHours: 5,
      geometry: directGeometry,
      provider: 'openrouteservice',
      profile: 'driving-car',
      variant: 'recommended',
    });
    const duplicate = routeOptionFromCalculation({
      id: 'alternative-1',
      label: 'Alternative 1',
      source: 'provider-alternative',
      origin,
      target,
      distanceKm: 458.26,
      travelTimeHours: 5.01,
      geometry: directGeometry,
      provider: 'openrouteservice',
      profile: 'driving-car',
      variant: 'alternative-1',
    });
    const avoidHighways = routeOptionFromCalculation({
      id: 'avoid-highways',
      label: 'Avoid highways',
      source: 'avoid-feature',
      origin,
      target,
      distanceKm: 520,
      travelTimeHours: 6.4,
      geometry: avoidHighwaysGeometry,
      provider: 'openrouteservice',
      profile: 'driving-car',
      variant: 'avoid:highways',
    });

    expect(dedupeRouteOptions([recommended, duplicate, avoidHighways])).toEqual([
      recommended,
      avoidHighways,
    ]);
  });

  it('creates a route-leg patch from the selected option', () => {
    const routeLeg = createRouteLeg({
      originDestinationId: 'origin-id',
      targetDestinationId: 'target-id',
      type: 'driving-auto',
      status: 'ready',
      distanceKm: 458.25,
      travelTimeHours: 5,
      geometry: directGeometry,
      provider: 'openrouteservice',
      profile: 'driving-car',
      routeKey: 'old-key',
    });
    const option = routeOptionFromCalculation({
      id: 'avoid-highways',
      label: 'Avoid highways',
      source: 'avoid-feature',
      origin,
      target,
      distanceKm: 520,
      travelTimeHours: 6.4,
      geometry: avoidHighwaysGeometry,
      provider: 'openrouteservice',
      profile: 'driving-car',
      variant: 'avoid:highways',
    });

    expect(routeLegPatchFromRouteOption(option, '2026-07-04T12:00:00.000Z')).toEqual({
      type: 'driving-auto',
      status: 'ready',
      distanceKm: 520,
      travelTimeHours: 6.4,
      geometry: avoidHighwaysGeometry,
      provider: 'openrouteservice',
      profile: 'driving-car',
      routeKey: option.routeKey,
      calculatedAt: '2026-07-04T12:00:00.000Z',
      error: undefined,
    });
    expect(routeLeg.type).toBe('driving-auto');
  });
});
```

- [x] **Step 2: Run the route option tests to verify they fail**

Run:

```bash
npm run test -- src/domain/routeOptions.test.ts
```

Expected: FAIL because `src/domain/routeOptions.ts` does not exist.

- [x] **Step 3: Implement the route option helpers**

Create `src/domain/routeOptions.ts`:

```ts
import type { LineString } from 'geojson';
import type { Coordinates, RouteLeg } from './types';

export type RouteOptionSource = 'recommended' | 'provider-alternative' | 'avoid-feature';
export type RouteAvoidFeature = 'highways' | 'ferries' | 'tollways';

export type RouteOption = {
  id: string;
  label: string;
  source: RouteOptionSource;
  distanceKm: number;
  travelTimeHours: number;
  geometry: LineString;
  provider: string;
  profile: string;
  routeKey: string;
};

type CreateRouteOptionKeyInput = {
  origin: Coordinates;
  target: Coordinates;
  profile: string;
  variant: string;
};

type RouteOptionFromCalculationInput = CreateRouteOptionKeyInput &
  Omit<RouteOption, 'routeKey'>;

export type RouteLegOptionPatch = Partial<Omit<RouteLeg, 'id' | 'createdAt' | 'updatedAt'>>;

function coordinateKey(coordinates: Coordinates) {
  return `${coordinates.lng.toFixed(5)},${coordinates.lat.toFixed(5)}`;
}

function coordinatePairKey(coordinate: number[]) {
  const [lng, lat] = coordinate;
  return `${lng.toFixed(5)},${lat.toFixed(5)}`;
}

function geometryKey(geometry: LineString) {
  return geometry.coordinates.map(coordinatePairKey).join('|');
}

export function createRouteOptionKey({
  origin,
  target,
  profile,
  variant,
}: CreateRouteOptionKeyInput) {
  return `${profile}:${coordinateKey(origin)}:${coordinateKey(target)}:${variant}`;
}

export function routeOptionFromCalculation(input: RouteOptionFromCalculationInput): RouteOption {
  return {
    id: input.id,
    label: input.label,
    source: input.source,
    distanceKm: input.distanceKm,
    travelTimeHours: input.travelTimeHours,
    geometry: input.geometry,
    provider: input.provider,
    profile: input.profile,
    routeKey: createRouteOptionKey({
      origin: input.origin,
      target: input.target,
      profile: input.profile,
      variant: input.variant,
    }),
  };
}

export function dedupeRouteOptions(options: RouteOption[]) {
  const seenGeometryKeys = new Set<string>();
  const seenRouteKeys = new Set<string>();
  const dedupedOptions: RouteOption[] = [];

  for (const option of options) {
    const optionGeometryKey = geometryKey(option.geometry);
    if (seenGeometryKeys.has(optionGeometryKey) || seenRouteKeys.has(option.routeKey)) {
      continue;
    }

    seenGeometryKeys.add(optionGeometryKey);
    seenRouteKeys.add(option.routeKey);
    dedupedOptions.push(option);
  }

  return dedupedOptions;
}

export function routeLegPatchFromRouteOption(
  option: RouteOption,
  calculatedAt = new Date().toISOString(),
): RouteLegOptionPatch {
  return {
    type: 'driving-auto',
    status: 'ready',
    distanceKm: option.distanceKm,
    travelTimeHours: option.travelTimeHours,
    geometry: option.geometry,
    provider: option.provider,
    profile: option.profile,
    routeKey: option.routeKey,
    calculatedAt,
    error: undefined,
  };
}
```

- [x] **Step 4: Run the route option tests to verify they pass**

Run:

```bash
npm run test -- src/domain/routeOptions.test.ts
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/domain/routeOptions.ts src/domain/routeOptions.test.ts
git commit -m "feat: add route option helpers"
```

---

### Task 2: Extend OpenRouteService With Route Options

**Files:**
- Modify: `src/adapters/openRouteService.ts`
- Modify: `src/adapters/openRouteService.test.ts`
- Test: `src/adapters/openRouteService.test.ts`

- [x] **Step 1: Add failing adapter tests for alternatives and supplemental avoid-feature routes**

Append these tests inside the existing `describe('OpenRouteService adapter', () => { ... })` block in `src/adapters/openRouteService.test.ts`:

```ts
  it('requests provider alternatives and normalizes returned route options', async () => {
    const recommendedGeometry: LineString = {
      type: 'LineString',
      coordinates: [
        [-0.1276, 51.5072],
        [2.3522, 48.8566],
      ],
    };
    const alternativeGeometry: LineString = {
      type: 'LineString',
      coordinates: [
        [-0.1276, 51.5072],
        [0.1, 50.9],
        [2.3522, 48.8566],
      ],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: recommendedGeometry,
              properties: { summary: { distance: 458_250, duration: 18_000 } },
            },
            {
              type: 'Feature',
              geometry: alternativeGeometry,
              properties: { summary: { distance: 492_000, duration: 20_700 } },
            },
          ],
        }),
      })
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          type: 'FeatureCollection',
          features: [],
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const options = await calculateOpenRouteServiceRouteOptions({
      apiKey: 'ors-key',
      origin: { lat: 51.5072, lng: -0.1276 },
      target: { lat: 48.8566, lng: 2.3522 },
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.openrouteservice.org/v2/directions/driving-car/geojson',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          coordinates: [
            [-0.1276, 51.5072],
            [2.3522, 48.8566],
          ],
          alternative_routes: {
            target_count: 3,
            share_factor: 0.6,
            weight_factor: 2,
          },
        }),
      }),
    );
    expect(options).toMatchObject([
      {
        id: 'recommended',
        label: 'Recommended',
        source: 'recommended',
        distanceKm: 458.25,
        travelTimeHours: 5,
        geometry: recommendedGeometry,
      },
      {
        id: 'alternative-1',
        label: 'Alternative 1',
        source: 'provider-alternative',
        distanceKm: 492,
        travelTimeHours: 5.75,
        geometry: alternativeGeometry,
      },
    ]);
  });

  it('supplements with supported avoid-feature routes and hides failed supplemental requests', async () => {
    const recommendedGeometry: LineString = {
      type: 'LineString',
      coordinates: [
        [-0.1276, 51.5072],
        [2.3522, 48.8566],
      ],
    };
    const avoidHighwaysGeometry: LineString = {
      type: 'LineString',
      coordinates: [
        [-0.1276, 51.5072],
        [0.6, 50.6],
        [2.3522, 48.8566],
      ],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: recommendedGeometry,
              properties: { summary: { distance: 458_250, duration: 18_000 } },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: avoidHighwaysGeometry,
              properties: { summary: { distance: 520_000, duration: 23_040 } },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          type: 'FeatureCollection',
          features: [],
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const options = await calculateOpenRouteServiceRouteOptions({
      apiKey: 'ors-key',
      origin: { lat: 51.5072, lng: -0.1276 },
      target: { lat: 48.8566, lng: 2.3522 },
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.openrouteservice.org/v2/directions/driving-car/geojson',
      expect.objectContaining({
        body: JSON.stringify({
          coordinates: [
            [-0.1276, 51.5072],
            [2.3522, 48.8566],
          ],
          options: {
            avoid_features: ['highways'],
          },
        }),
      }),
    );
    expect(options.map((option) => option.label)).toEqual(['Recommended', 'Avoid highways']);
  });

  it('requires an API key before route options requests', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      calculateOpenRouteServiceRouteOptions({
        apiKey: '',
        origin: { lat: 51.5072, lng: -0.1276 },
        target: { lat: 48.8566, lng: 2.3522 },
      }),
    ).rejects.toThrow('OpenRouteService API key is required');
    expect(fetchMock).not.toHaveBeenCalled();
  });
```

Update the import at the top of the test file:

```ts
import {
  calculateOpenRouteServiceRoute,
  calculateOpenRouteServiceRouteOptions,
} from './openRouteService';
```

- [x] **Step 2: Run adapter tests to verify they fail**

Run:

```bash
npm run test -- src/adapters/openRouteService.test.ts
```

Expected: FAIL because `calculateOpenRouteServiceRouteOptions` is not exported.

- [x] **Step 3: Implement route options in the OpenRouteService adapter**

Modify `src/adapters/openRouteService.ts` to this shape, preserving the existing single-route export:

```ts
import type { FeatureCollection, LineString } from 'geojson';
import type { Coordinates } from '../domain/types';
import {
  dedupeRouteOptions,
  routeOptionFromCalculation,
  type RouteAvoidFeature,
  type RouteOption,
} from '../domain/routeOptions';

type OpenRouteServiceProfile = 'driving-car';

type CalculateRouteInput = {
  apiKey: string;
  origin: Coordinates;
  target: Coordinates;
  profile?: OpenRouteServiceProfile;
};

type CalculatedRoute = {
  distanceKm: number;
  travelTimeHours: number;
  geometry: LineString;
  provider: 'openrouteservice';
  profile: OpenRouteServiceProfile;
};

type OpenRouteServiceFeatureProperties = {
  summary?: {
    distance?: number;
    duration?: number;
  };
};

type OpenRouteServiceFeatureCollection = FeatureCollection<LineString, OpenRouteServiceFeatureProperties>;

const provider = 'openrouteservice';
const defaultProfile: OpenRouteServiceProfile = 'driving-car';
const endpointBaseUrl = 'https://api.openrouteservice.org/v2/directions';
const maxRouteOptions = 3;
const supplementalAvoidFeatures: Array<{ feature: RouteAvoidFeature; label: string }> = [
  { feature: 'highways', label: 'Avoid highways' },
  { feature: 'ferries', label: 'Avoid ferries' },
  { feature: 'tollways', label: 'Avoid tollways' },
];

function toLngLat(coordinates: Coordinates) {
  return [coordinates.lng, coordinates.lat];
}

function requireApiKey(apiKey: string) {
  const trimmedApiKey = apiKey.trim();

  if (!trimmedApiKey) {
    throw new Error('OpenRouteService API key is required');
  }

  return trimmedApiKey;
}

function isLineString(geometry: unknown): geometry is LineString {
  return (
    typeof geometry === 'object' &&
    geometry !== null &&
    'type' in geometry &&
    geometry.type === 'LineString' &&
    'coordinates' in geometry &&
    Array.isArray(geometry.coordinates)
  );
}

function parseRouteFeature(feature: OpenRouteServiceFeatureCollection['features'][number]) {
  const geometry = feature.geometry;
  const summary = feature.properties?.summary;

  if (!isLineString(geometry) || typeof summary?.distance !== 'number' || typeof summary.duration !== 'number') {
    throw new Error('OpenRouteService returned an invalid route');
  }

  return {
    distanceKm: summary.distance / 1000,
    travelTimeHours: summary.duration / 3600,
    geometry,
  };
}

function parseRouteResponse(data: OpenRouteServiceFeatureCollection): Omit<CalculatedRoute, 'provider' | 'profile'> {
  const feature = data.features.at(0);

  if (!feature) {
    throw new Error('OpenRouteService returned an invalid route');
  }

  return parseRouteFeature(feature);
}

async function postDirections({
  apiKey,
  profile,
  body,
}: {
  apiKey: string;
  profile: OpenRouteServiceProfile;
  body: Record<string, unknown>;
}) {
  const response = await fetch(`${endpointBaseUrl}/${profile}/geojson`, {
    method: 'POST',
    headers: {
      Authorization: apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error('OpenRouteService route calculation failed');
  }

  return (await response.json()) as OpenRouteServiceFeatureCollection;
}

export async function calculateOpenRouteServiceRoute({
  apiKey,
  origin,
  target,
  profile = defaultProfile,
}: CalculateRouteInput): Promise<CalculatedRoute> {
  const trimmedApiKey = requireApiKey(apiKey);
  const parsedRoute = parseRouteResponse(
    await postDirections({
      apiKey: trimmedApiKey,
      profile,
      body: {
        coordinates: [toLngLat(origin), toLngLat(target)],
      },
    }),
  );

  return {
    ...parsedRoute,
    provider,
    profile,
  };
}

async function calculateProviderAlternativeOptions({
  apiKey,
  origin,
  target,
  profile,
}: Required<CalculateRouteInput>): Promise<RouteOption[]> {
  const data = await postDirections({
    apiKey,
    profile,
    body: {
      coordinates: [toLngLat(origin), toLngLat(target)],
      alternative_routes: {
        target_count: maxRouteOptions,
        share_factor: 0.6,
        weight_factor: 2,
      },
    },
  });

  return data.features.slice(0, maxRouteOptions).map((feature, index) => {
    const route = parseRouteFeature(feature);
    const isRecommended = index === 0;

    return routeOptionFromCalculation({
      id: isRecommended ? 'recommended' : `alternative-${index}`,
      label: isRecommended ? 'Recommended' : `Alternative ${index}`,
      source: isRecommended ? 'recommended' : 'provider-alternative',
      origin,
      target,
      distanceKm: route.distanceKm,
      travelTimeHours: route.travelTimeHours,
      geometry: route.geometry,
      provider,
      profile,
      variant: isRecommended ? 'recommended' : `alternative-${index}`,
    });
  });
}

async function calculateAvoidFeatureOption({
  apiKey,
  origin,
  target,
  profile,
  feature,
  label,
}: Required<CalculateRouteInput> & { feature: RouteAvoidFeature; label: string }) {
  const data = await postDirections({
    apiKey,
    profile,
    body: {
      coordinates: [toLngLat(origin), toLngLat(target)],
      options: {
        avoid_features: [feature],
      },
    },
  });
  const route = parseRouteResponse(data);

  return routeOptionFromCalculation({
    id: `avoid-${feature}`,
    label,
    source: 'avoid-feature',
    origin,
    target,
    distanceKm: route.distanceKm,
    travelTimeHours: route.travelTimeHours,
    geometry: route.geometry,
    provider,
    profile,
    variant: `avoid:${feature}`,
  });
}

export async function calculateOpenRouteServiceRouteOptions({
  apiKey,
  origin,
  target,
  profile = defaultProfile,
}: CalculateRouteInput): Promise<RouteOption[]> {
  const trimmedApiKey = requireApiKey(apiKey);
  const options: RouteOption[] = [];

  try {
    options.push(
      ...(await calculateProviderAlternativeOptions({
        apiKey: trimmedApiKey,
        origin,
        target,
        profile,
      })),
    );
  } catch {
    // The alternatives endpoint can fail for long routes; supported supplementals still get a chance below.
  }

  for (const supplemental of supplementalAvoidFeatures) {
    if (options.length >= maxRouteOptions) break;

    try {
      options.push(
        await calculateAvoidFeatureOption({
          apiKey: trimmedApiKey,
          origin,
          target,
          profile,
          ...supplemental,
        }),
      );
    } catch {
      // Failed supplemental options are hidden from the picker.
    }
  }

  return dedupeRouteOptions(options).slice(0, maxRouteOptions);
}
```

- [x] **Step 4: Run adapter and route option tests**

Run:

```bash
npm run test -- src/domain/routeOptions.test.ts src/adapters/openRouteService.test.ts
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/adapters/openRouteService.ts src/adapters/openRouteService.test.ts src/domain/routeOptions.ts src/domain/routeOptions.test.ts
git commit -m "feat: calculate route alternatives"
```

---

### Task 3: Preserve Selected Ready Route Geometry In Trip Data

**Files:**
- Modify: `src/hooks/useTripData.ts`
- Modify: `src/hooks/useTripData.test.tsx`
- Test: `src/hooks/useTripData.test.tsx`

- [x] **Step 1: Add a failing hook test for applying a selected alternative**

Add this test near the existing route calculation tests in `src/hooks/useTripData.test.tsx`:

```ts
  it('saves selected ready route geometry without recalculating it', async () => {
    const repository = createTestRepository();
    const calculateRoute = vi.fn().mockResolvedValue({
      distanceKm: 123.4,
      travelTimeHours: 2.5,
      geometry: {
        type: 'LineString',
        coordinates: [
          [19.0342, 43.1306],
          [18.7712, 42.4247],
        ],
      },
      provider: 'openrouteservice',
      profile: 'driving-car',
    });
    const selectedGeometry = {
      type: 'LineString' as const,
      coordinates: [
        [19.0342, 43.1306],
        [18.9, 42.9],
        [18.7712, 42.4247],
      ],
    };
    const { result } = renderHook(() => useTripData(repository, { calculateRoute }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.addDestination({
        name: 'Durmitor',
        countryRegion: 'Montenegro',
        coordinates: { lat: 43.1306, lng: 19.0342 },
      });
      await result.current.addDestination({
        name: 'Kotor',
        countryRegion: 'Montenegro',
        coordinates: { lat: 42.4247, lng: 18.7712 },
      });
    });

    const [routeLeg] = result.current.routeLegs;
    calculateRoute.mockClear();

    await act(async () => {
      await result.current.updateRouteLeg(routeLeg.id, {
        type: 'driving-auto',
        status: 'ready',
        distanceKm: 140,
        travelTimeHours: 3.1,
        geometry: selectedGeometry,
        provider: 'openrouteservice',
        profile: 'driving-car',
        routeKey: 'selected-alternative-key',
        calculatedAt: '2026-07-04T12:00:00.000Z',
        error: undefined,
      });
    });

    expect(calculateRoute).not.toHaveBeenCalled();
    expect(result.current.routeLegs[0]).toMatchObject({
      id: routeLeg.id,
      type: 'driving-auto',
      status: 'ready',
      distanceKm: 140,
      travelTimeHours: 3.1,
      geometry: selectedGeometry,
      routeKey: 'selected-alternative-key',
      error: undefined,
    });
  });
```

- [x] **Step 2: Run the hook test to verify it fails**

Run:

```bash
npm run test -- src/hooks/useTripData.test.tsx -t "saves selected ready route geometry"
```

Expected: FAIL because `finalizeRouteLeg` recalculates ready driving patches.

- [x] **Step 3: Preserve selected ready geometry in `finalizeRouteLeg`**

In `src/hooks/useTripData.ts`, add this branch immediately before `const [calculatedRouteLeg] = await calculateDrivingRouteLegs(...)` inside `finalizeRouteLeg`:

```ts
        if (
          routeLeg.type === 'driving-auto' &&
          routeLeg.status === 'ready' &&
          routeLeg.geometry &&
          routeLeg.distanceKm !== undefined &&
          routeLeg.travelTimeHours !== undefined &&
          routeLeg.provider &&
          routeLeg.profile &&
          routeLeg.routeKey
        ) {
          return {
            ...routeLeg,
            error: undefined,
            updatedAt: createTimestamp(),
          } satisfies RouteLeg;
        }
```

The surrounding code should read:

```ts
        if (routeLeg.type === 'shipping-manual') {
          return {
            ...routeLeg,
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
          } satisfies RouteLeg;
        }

        if (
          routeLeg.type === 'driving-auto' &&
          routeLeg.status === 'ready' &&
          routeLeg.geometry &&
          routeLeg.distanceKm !== undefined &&
          routeLeg.travelTimeHours !== undefined &&
          routeLeg.provider &&
          routeLeg.profile &&
          routeLeg.routeKey
        ) {
          return {
            ...routeLeg,
            error: undefined,
            updatedAt: createTimestamp(),
          } satisfies RouteLeg;
        }

        const [calculatedRouteLeg] = await calculateDrivingRouteLegs(nextDestinations, [
          {
            ...routeLeg,
            status: 'pending',
            profile: routeLeg.profile ?? 'driving-car',
            error: undefined,
            updatedAt: createTimestamp(),
          },
        ]);
```

- [x] **Step 4: Run hook tests**

Run:

```bash
npm run test -- src/hooks/useTripData.test.tsx
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/hooks/useTripData.ts src/hooks/useTripData.test.tsx
git commit -m "feat: preserve selected route alternatives"
```

---

### Task 4: Add Pencil Route Edit Button To Inline Route Rows

**Files:**
- Modify: `src/components/ItineraryPanel.tsx`
- Modify: `src/components/ItineraryPanel.test.tsx`
- Modify: `src/styles.css`
- Test: `src/components/ItineraryPanel.test.tsx`

- [x] **Step 1: Write the failing ItineraryPanel test**

Add this test to `src/components/ItineraryPanel.test.tsx`:

```ts
  it('shows an icon-only edit route button for driving route rows', async () => {
    const user = userEvent.setup();
    const origin = createDestination({
      name: 'Bilbao',
      countryRegion: 'Spain',
      coordinates: { lat: 43.263, lng: -2.935 },
      order: 0,
    });
    const target = createDestination({
      name: 'Porto',
      countryRegion: 'Portugal',
      coordinates: { lat: 41.1579, lng: -8.6291 },
      order: 1,
    });
    const routeLeg: RouteLeg = {
      id: 'route-bilbao-porto',
      originDestinationId: origin.id,
      targetDestinationId: target.id,
      type: 'driving-auto',
      status: 'ready',
      distanceKm: 457,
      travelTimeHours: 5.8,
      geometry: {
        type: 'LineString',
        coordinates: [
          [-2.935, 43.263],
          [-8.6291, 41.1579],
        ],
      },
      provider: 'openrouteservice',
      profile: 'driving-car',
      routeKey: 'driving-car:-2.93500,43.26300:-8.62910,41.15790',
      notes: '',
      createdAt: '2026-07-04T12:00:00.000Z',
      updatedAt: '2026-07-04T12:00:00.000Z',
    };
    const onEditRouteLeg = vi.fn();

    render(
      <ItineraryPanel
        destinations={[origin, target]}
        routeLegs={[routeLeg]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
        onDeleteDestination={vi.fn()}
        onReorderDestinations={vi.fn()}
        onUpdateRouteLeg={vi.fn()}
        onEditRouteLeg={onEditRouteLeg}
      />,
    );

    const editButton = screen.getByRole('button', {
      name: 'Edit route from Bilbao to Porto',
    });

    expect(editButton).toHaveAttribute('title', 'Edit route');
    expect(editButton).not.toHaveTextContent('Edit');

    await user.click(editButton);

    expect(onEditRouteLeg).toHaveBeenCalledWith('route-bilbao-porto');
  });
```

The test will require `onEditRouteLeg` in existing `ItineraryPanel` renders. For every existing `ItineraryPanel` render in `src/components/ItineraryPanel.test.tsx`, add:

```tsx
        onEditRouteLeg={vi.fn()}
```

- [x] **Step 2: Run the component test to verify it fails**

Run:

```bash
npm run test -- src/components/ItineraryPanel.test.tsx -t "icon-only edit route"
```

Expected: FAIL because `onEditRouteLeg` is not a supported prop and the pencil button is missing.

- [x] **Step 3: Add the prop and pencil button**

In `src/components/ItineraryPanel.tsx`, update imports:

```ts
import { Car, GripVertical, Pencil, RefreshCw, Ship, Signpost, Trash2 } from 'lucide-react';
```

Update `ItineraryPanelProps`:

```ts
  onEditRouteLeg: (routeLegId: string) => void;
```

Update the component parameter list:

```ts
  onEditRouteLeg,
```

Inside the inline route leg markup, after the route type button and before `inline-route-metrics`, insert:

```tsx
                    {routeLeg.type === 'driving-auto' ? (
                      <button
                        type="button"
                        className="inline-route-edit"
                        aria-label={`Edit route from ${destination.name} to ${nextDestination.name}`}
                        title="Edit route"
                        onClick={() => onEditRouteLeg(routeLeg.id)}
                      >
                        <Pencil size={15} aria-hidden="true" />
                      </button>
                    ) : null}
```

- [x] **Step 4: Add stable icon button styles**

Add this CSS near the existing `.inline-route-*` rules in `src/styles.css`:

```css
.inline-route-edit {
  align-items: center;
  appearance: none;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  color: var(--color-text-muted);
  cursor: pointer;
  display: inline-flex;
  flex: 0 0 30px;
  height: 30px;
  justify-content: center;
  padding: 0;
  width: 30px;
}

.inline-route-edit:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
```

- [x] **Step 5: Run ItineraryPanel tests**

Run:

```bash
npm run test -- src/components/ItineraryPanel.test.tsx src/components/RouteLegEditor.test.tsx
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/components/ItineraryPanel.tsx src/components/ItineraryPanel.test.tsx src/components/RouteLegEditor.test.tsx src/styles.css
git commit -m "feat: add route edit button"
```

---

### Task 5: Build The Route Alternatives Panel

**Files:**
- Create: `src/components/RouteAlternativesPanel.tsx`
- Create: `src/components/RouteAlternativesPanel.test.tsx`
- Modify: `src/styles.css`
- Test: `src/components/RouteAlternativesPanel.test.tsx`

- [x] **Step 1: Write failing panel component tests**

Create `src/components/RouteAlternativesPanel.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LineString } from 'geojson';
import { describe, expect, it, vi } from 'vitest';
import type { RouteOption } from '../domain/routeOptions';
import { RouteAlternativesPanel } from './RouteAlternativesPanel';

describe('RouteAlternativesPanel', () => {
  const baseGeometry: LineString = {
    type: 'LineString',
    coordinates: [
      [-2.935, 43.263],
      [-8.6291, 41.1579],
    ],
  };
  const options: RouteOption[] = [
    {
      id: 'recommended',
      label: 'Recommended',
      source: 'recommended',
      distanceKm: 457,
      travelTimeHours: 5.8,
      geometry: baseGeometry,
      provider: 'openrouteservice',
      profile: 'driving-car',
      routeKey: 'recommended-key',
    },
    {
      id: 'avoid-highways',
      label: 'Avoid highways',
      source: 'avoid-feature',
      distanceKm: 520,
      travelTimeHours: 7.1,
      geometry: {
        type: 'LineString',
        coordinates: [
          [-2.935, 43.263],
          [-5.1, 42.2],
          [-8.6291, 41.1579],
        ],
      },
      provider: 'openrouteservice',
      profile: 'driving-car',
      routeKey: 'avoid-highways-key',
    },
  ];

  it('shows loading state for one route leg', () => {
    render(
      <RouteAlternativesPanel
        originName="Bilbao"
        targetName="Porto"
        status="loading"
        options={[]}
        selectedOptionId={null}
        onSelectOption={vi.fn()}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'Edit route from Bilbao to Porto' })).toBeInTheDocument();
    expect(screen.getByText('Calculating route options')).toBeInTheDocument();
  });

  it('shows route options and confirms the selected option', async () => {
    const user = userEvent.setup();
    const onSelectOption = vi.fn();
    const onConfirm = vi.fn();

    render(
      <RouteAlternativesPanel
        originName="Bilbao"
        targetName="Porto"
        status="ready"
        options={options}
        selectedOptionId="recommended"
        onSelectOption={onSelectOption}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('Recommended')).toBeInTheDocument();
    expect(screen.getByText('Avoid highways')).toBeInTheDocument();
    expect(screen.getByText('284 mi')).toBeInTheDocument();
    expect(screen.getByText('5.8 hr')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Avoid highways 323 mi 7.1 hr' }));
    expect(onSelectOption).toHaveBeenCalledWith('avoid-highways');

    await user.click(screen.getByRole('button', { name: 'Use selected route' }));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('shows an empty state when no route options are available', () => {
    render(
      <RouteAlternativesPanel
        originName="Bilbao"
        targetName="Porto"
        status="empty"
        options={[]}
        selectedOptionId={null}
        onSelectOption={vi.fn()}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('No alternate routes found for this leg.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use selected route' })).toBeDisabled();
  });
});
```

- [x] **Step 2: Run panel tests to verify they fail**

Run:

```bash
npm run test -- src/components/RouteAlternativesPanel.test.tsx
```

Expected: FAIL because `RouteAlternativesPanel.tsx` does not exist.

- [x] **Step 3: Implement the panel**

Create `src/components/RouteAlternativesPanel.tsx`:

```tsx
import type { RouteOption } from '../domain/routeOptions';

type RouteAlternativesPanelStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error' | 'saving';

type RouteAlternativesPanelProps = {
  originName: string;
  targetName: string;
  status: RouteAlternativesPanelStatus;
  options: RouteOption[];
  selectedOptionId: string | null;
  error?: string | null;
  onSelectOption: (optionId: string) => void;
  onConfirm: () => void;
  onClose: () => void;
};

const kmToMiles = 0.621371;

function formatDistanceMiles(distanceKm: number) {
  return `${Math.round(distanceKm * kmToMiles).toLocaleString()} mi`;
}

function formatDurationHours(travelTimeHours: number) {
  return `${travelTimeHours.toFixed(1)} hr`;
}

export function RouteAlternativesPanel({
  originName,
  targetName,
  status,
  options,
  selectedOptionId,
  error,
  onSelectOption,
  onConfirm,
  onClose,
}: RouteAlternativesPanelProps) {
  const dialogTitle = `Edit route from ${originName} to ${targetName}`;
  const canConfirm = Boolean(selectedOptionId) && status !== 'loading' && status !== 'saving' && options.length > 0;

  return (
    <section className="route-alternatives-panel" role="dialog" aria-modal="true" aria-label={dialogTitle}>
      <header className="route-alternatives-header">
        <div>
          <h2>{dialogTitle}</h2>
          <p>Choose which calculated route should be used for this leg.</p>
        </div>
        <button type="button" className="route-alternatives-close" aria-label="Close route options" onClick={onClose}>
          ×
        </button>
      </header>

      {status === 'loading' ? <p role="status">Calculating route options</p> : null}
      {status === 'error' && error ? <p role="alert">{error}</p> : null}
      {status === 'empty' ? <p>No alternate routes found for this leg.</p> : null}

      {options.length > 0 ? (
        <fieldset className="route-alternatives-options">
          <legend>Route options</legend>
          {options.map((option) => {
            const distance = formatDistanceMiles(option.distanceKm);
            const duration = formatDurationHours(option.travelTimeHours);

            return (
              <label key={option.id} className="route-alternative-option">
                <input
                  type="radio"
                  name="route-alternative"
                  checked={selectedOptionId === option.id}
                  onChange={() => onSelectOption(option.id)}
                />
                <span>
                  <strong>{option.label}</strong>
                  <small>
                    {distance} {duration}
                  </small>
                </span>
              </label>
            );
          })}
        </fieldset>
      ) : null}

      <footer className="route-alternatives-actions">
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button type="button" disabled={!canConfirm} onClick={onConfirm}>
          {status === 'saving' ? 'Saving route' : 'Use selected route'}
        </button>
      </footer>
    </section>
  );
}
```

- [x] **Step 4: Add panel styles**

Add to `src/styles.css` near other panel/modal styles:

```css
.route-alternatives-panel {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  box-shadow: 0 18px 44px rgb(15 23 42 / 0.22);
  display: grid;
  gap: 16px;
  inset: auto 24px 24px auto;
  max-width: min(420px, calc(100vw - 32px));
  padding: 18px;
  position: fixed;
  width: 420px;
  z-index: 20;
}

.route-alternatives-header {
  align-items: flex-start;
  display: flex;
  gap: 12px;
  justify-content: space-between;
}

.route-alternatives-header h2 {
  font-size: 1rem;
  margin: 0;
}

.route-alternatives-header p {
  color: var(--color-text-muted);
  font-size: 0.875rem;
  margin: 4px 0 0;
}

.route-alternatives-close {
  align-items: center;
  appearance: none;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--color-text-muted);
  cursor: pointer;
  display: inline-flex;
  flex: 0 0 32px;
  font-size: 1.25rem;
  height: 32px;
  justify-content: center;
  padding: 0;
  width: 32px;
}

.route-alternatives-options {
  border: 0;
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
}

.route-alternatives-options legend {
  font-size: 0.75rem;
  font-weight: 700;
  margin-bottom: 8px;
  text-transform: uppercase;
}

.route-alternative-option {
  align-items: center;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  gap: 10px;
  padding: 10px;
}

.route-alternative-option span {
  display: grid;
  gap: 2px;
}

.route-alternative-option small {
  color: var(--color-text-muted);
}

.route-alternatives-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
```

- [x] **Step 5: Run panel tests**

Run:

```bash
npm run test -- src/components/RouteAlternativesPanel.test.tsx
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/components/RouteAlternativesPanel.tsx src/components/RouteAlternativesPanel.test.tsx src/styles.css
git commit -m "feat: add route alternatives panel"
```

---

### Task 6: Wire Route Alternatives Through App

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Test: `src/App.test.tsx`

- [x] **Step 1: Add a failing integrated App test**

In `src/App.test.tsx`, add this import near the geocoding adapter import:

```ts
import {
  calculateOpenRouteServiceRoute,
  calculateOpenRouteServiceRouteOptions,
} from './adapters/openRouteService';
```

Add this module mock after the existing geocoding mock:

```ts
vi.mock('./adapters/openRouteService', () => ({
  calculateOpenRouteServiceRoute: vi.fn(async () => ({
    distanceKm: 160,
    travelTimeHours: 2.25,
    geometry: {
      type: 'LineString',
      coordinates: [
        [28.9784, 41.0082],
        [44.8271, 41.7151],
      ],
    },
    provider: 'openrouteservice',
    profile: 'driving-car',
  })),
  calculateOpenRouteServiceRouteOptions: vi.fn(async () => [
    {
      id: 'recommended',
      label: 'Recommended',
      source: 'recommended',
      distanceKm: 160,
      travelTimeHours: 2.25,
      geometry: {
        type: 'LineString',
        coordinates: [
          [28.9784, 41.0082],
          [44.8271, 41.7151],
        ],
      },
      provider: 'openrouteservice',
      profile: 'driving-car',
      routeKey: 'recommended-route-key',
    },
    {
      id: 'avoid-highways',
      label: 'Avoid highways',
      source: 'avoid-feature',
      distanceKm: 220,
      travelTimeHours: 3.4,
      geometry: {
        type: 'LineString',
        coordinates: [
          [28.9784, 41.0082],
          [34.5, 40.9],
          [44.8271, 41.7151],
        ],
      },
      provider: 'openrouteservice',
      profile: 'driving-car',
      routeKey: 'avoid-highways-route-key',
    },
  ]),
}));
```

In `beforeEach`, after the geocoding mock resets, add:

```ts
    vi.mocked(calculateOpenRouteServiceRoute).mockClear();
    vi.mocked(calculateOpenRouteServiceRouteOptions).mockClear();
```

Add this test near the route behavior tests:

```tsx
  it('opens route alternatives from the route row and saves the selected option', async () => {
    const user = userEvent.setup();
    vi.mocked(searchMapTilerPlaces)
      .mockResolvedValueOnce([
        createPlaceSearchResult({
          id: 'place-istanbul',
          label: 'Istanbul, Turkey',
          placeName: 'Istanbul',
          regionName: '',
          countryName: 'Turkey',
          coordinates: { lat: 41.0082, lng: 28.9784 },
        }),
      ])
      .mockResolvedValueOnce([
        createPlaceSearchResult({
          id: 'place-tbilisi',
          label: 'Tbilisi, Georgia',
          placeName: 'Tbilisi',
          regionName: '',
          countryName: 'Georgia',
          coordinates: { lat: 41.7151, lng: 44.8271 },
        }),
      ]);

    render(<App />);

    await waitFor(() => expect(screen.queryByText('Loading trip data')).not.toBeInTheDocument());

    await user.type(screen.getByLabelText('Search for a destination'), 'Istanbul');
    await user.click(await screen.findByRole('option', { name: 'Istanbul, Turkey' }));
    await user.clear(screen.getByLabelText('Search for a destination'));
    await user.type(screen.getByLabelText('Search for a destination'), 'Tbilisi');
    await user.click(await screen.findByRole('option', { name: 'Tbilisi, Georgia' }));

    const editRouteButton = await screen.findByRole('button', {
      name: /Edit route from Istanbul to Tbilisi/,
    });
    await user.click(editRouteButton);

    expect(await screen.findByRole('dialog', { name: /Edit route from Istanbul to Tbilisi/ })).toBeInTheDocument();
    expect(await screen.findByText('Avoid highways')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Avoid highways 137 mi 3.4 hr' }));
    await user.click(screen.getByRole('button', { name: 'Use selected route' }));

    await waitFor(() =>
      expect(repositoryMock.saveRouteLeg).toHaveBeenLastCalledWith(
        expect.objectContaining({
          routeKey: 'avoid-highways-route-key',
          distanceKm: 220,
          travelTimeHours: 3.4,
          status: 'ready',
        }),
      ),
    );
  });
```

- [x] **Step 2: Run the integrated App test to verify it fails**

Run:

```bash
npm run test -- src/App.test.tsx -t "opens route alternatives"
```

Expected: FAIL because App does not pass `onEditRouteLeg`, does not calculate route options, and does not render `RouteAlternativesPanel`.

- [x] **Step 3: Add App state and route option wiring**

In `src/App.tsx`, update imports:

```ts
import { calculateOpenRouteServiceRoute, calculateOpenRouteServiceRouteOptions } from './adapters/openRouteService';
import { RouteAlternativesPanel } from './components/RouteAlternativesPanel';
import { routeLegPatchFromRouteOption, type RouteOption } from './domain/routeOptions';
```

Add state in `TripWorkspace`:

```ts
  const [routeAlternativesState, setRouteAlternativesState] = useState<{
    routeLegId: string;
    status: 'loading' | 'ready' | 'empty' | 'error' | 'saving';
    options: RouteOption[];
    selectedOptionId: string | null;
    error: string | null;
  } | null>(null);
```

Add helpers in `TripWorkspace` after `handleDeleteDestination`:

```ts
  const routeLegsById = useMemo(
    () => new Map(routeLegs.map((routeLeg) => [routeLeg.id, routeLeg])),
    [routeLegs],
  );
  const destinationsById = useMemo(
    () => new Map(destinations.map((destination) => [destination.id, destination])),
    [destinations],
  );
  const activeRouteAlternativesLeg = routeAlternativesState
    ? routeLegsById.get(routeAlternativesState.routeLegId) ?? null
    : null;
  const activeRouteAlternativesOrigin = activeRouteAlternativesLeg
    ? destinationsById.get(activeRouteAlternativesLeg.originDestinationId) ?? null
    : null;
  const activeRouteAlternativesTarget = activeRouteAlternativesLeg
    ? destinationsById.get(activeRouteAlternativesLeg.targetDestinationId) ?? null
    : null;

  const openRouteAlternatives = useCallback(
    async (routeLegId: string) => {
      const routeLeg = routeLegsById.get(routeLegId);
      if (!routeLeg || routeLeg.type !== 'driving-auto') return;

      const origin = destinationsById.get(routeLeg.originDestinationId);
      const target = destinationsById.get(routeLeg.targetDestinationId);
      if (!origin || !target) return;

      setRouteAlternativesState({
        routeLegId,
        status: 'loading',
        options: [],
        selectedOptionId: null,
        error: null,
      });

      try {
        const options = await calculateOpenRouteServiceRouteOptions({
          apiKey: openRouteServiceApiKey,
          origin: origin.coordinates,
          target: target.coordinates,
          profile: 'driving-car',
        });

        setRouteAlternativesState((current) =>
          current?.routeLegId === routeLegId
            ? {
                routeLegId,
                status: options.length > 0 ? 'ready' : 'empty',
                options,
                selectedOptionId: options[0]?.id ?? null,
                error: null,
              }
            : current,
        );
      } catch (caught) {
        setRouteAlternativesState((current) =>
          current?.routeLegId === routeLegId
            ? {
                ...current,
                status: 'error',
                options: [],
                selectedOptionId: null,
                error: caught instanceof Error ? caught.message : 'Unable to calculate route options',
              }
            : current,
        );
      }
    },
    [destinationsById, routeLegsById],
  );

  const closeRouteAlternatives = useCallback(() => {
    setRouteAlternativesState(null);
  }, []);

  const selectRouteAlternative = useCallback((optionId: string) => {
    setRouteAlternativesState((current) =>
      current ? { ...current, selectedOptionId: optionId } : current,
    );
  }, []);

  const confirmRouteAlternative = useCallback(async () => {
    if (!routeAlternativesState || !routeAlternativesState.selectedOptionId) return;

    const selectedOption = routeAlternativesState.options.find(
      (option) => option.id === routeAlternativesState.selectedOptionId,
    );
    if (!selectedOption) return;

    setRouteAlternativesState((current) => (current ? { ...current, status: 'saving' } : current));

    try {
      await updateRouteLeg(
        routeAlternativesState.routeLegId,
        routeLegPatchFromRouteOption(selectedOption),
      );
      setRouteAlternativesState(null);
    } catch (caught) {
      setRouteAlternativesState((current) =>
        current
          ? {
              ...current,
              status: 'error',
              error: caught instanceof Error ? caught.message : 'Unable to save selected route',
            }
          : current,
      );
    }
  }, [routeAlternativesState, updateRouteLeg]);
```

Pass the callback into `ItineraryPanel`:

```tsx
          onEditRouteLeg={openRouteAlternatives}
```

Render the panel near the end of `TripWorkspace` JSX, before preview modals:

```tsx
      {routeAlternativesState && activeRouteAlternativesOrigin && activeRouteAlternativesTarget ? (
        <RouteAlternativesPanel
          originName={activeRouteAlternativesOrigin.name}
          targetName={activeRouteAlternativesTarget.name}
          status={routeAlternativesState.status}
          options={routeAlternativesState.options}
          selectedOptionId={routeAlternativesState.selectedOptionId}
          error={routeAlternativesState.error}
          onSelectOption={selectRouteAlternative}
          onConfirm={confirmRouteAlternative}
          onClose={closeRouteAlternatives}
        />
      ) : null}
```

- [x] **Step 4: Run App test**

Run:

```bash
npm run test -- src/App.test.tsx -t "opens route alternatives"
```

Expected: PASS.

- [x] **Step 5: Run route-related component tests**

Run:

```bash
npm run test -- src/App.test.tsx src/components/ItineraryPanel.test.tsx src/components/RouteAlternativesPanel.test.tsx src/hooks/useTripData.test.tsx
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/App.tsx src/App.test.tsx src/components/ItineraryPanel.tsx src/components/RouteAlternativesPanel.tsx src/domain/routeOptions.ts
git commit -m "feat: wire route alternatives picker"
```

---

### Task 7: Full Verification

**Files:**
- Modify: none
- Test: focused Vitest suites, full Vitest suite, lint, build

- [x] **Step 1: Run focused tests**

Run:

```bash
npm run test -- src/domain/routeOptions.test.ts src/adapters/openRouteService.test.ts src/hooks/useTripData.test.tsx src/components/ItineraryPanel.test.tsx src/components/RouteAlternativesPanel.test.tsx src/App.test.tsx
```

Expected: PASS.

- [x] **Step 2: Run full verification**

Run:

```bash
npm run lint
npm run test
npm run build
```

Expected: all commands PASS.

- [x] **Step 3: Confirm the working tree state**

Run:

```bash
git status --short
```

Expected: no uncommitted changes. If verification exposed a failure, return to the task that introduced the failing behavior, fix it there, rerun that task's focused tests, and commit the fix with that task's files.

---

## Self-Review Notes

- Spec coverage: The plan keeps adjacent route legs as the source of truth, adds an icon-only pencil, calculates options on demand, hides failed supplementals, uses provider-backed labels, saves the selected option onto the existing leg, and leaves the current route unchanged on cancel/failure.
- Type consistency: `RouteOption`, `RouteAvoidFeature`, `routeLegPatchFromRouteOption`, and `calculateOpenRouteServiceRouteOptions` are introduced before any later task uses them.
- Scope: Discarded alternatives are not persisted. Map preview is not required for v1; the panel selection flow is enough to choose and save one active geometry.
- External API references used for this plan: OpenRouteService documents `alternative_routes` as `target_count`, `share_factor`, and `weight_factor`; OpenRouteService routing options document `options.avoid_features` with `highways`, `ferries`, and `tollways` support for driving profiles.

## Implementation Status

Completed in `5866e2e feat: wire route alternatives picker`.
