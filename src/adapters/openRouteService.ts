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
