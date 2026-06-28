import type { FeatureCollection, LineString } from 'geojson';
import type { Coordinates } from '../domain/types';

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

function toLngLat(coordinates: Coordinates) {
  return [coordinates.lng, coordinates.lat];
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

function parseRouteResponse(data: OpenRouteServiceFeatureCollection): Omit<CalculatedRoute, 'provider' | 'profile'> {
  const feature = data.features.at(0);
  const geometry = feature?.geometry;
  const summary = feature?.properties?.summary;

  if (!feature || !isLineString(geometry) || typeof summary?.distance !== 'number' || typeof summary.duration !== 'number') {
    throw new Error('OpenRouteService returned an invalid route');
  }

  return {
    distanceKm: summary.distance / 1000,
    travelTimeHours: summary.duration / 3600,
    geometry,
  };
}

export async function calculateOpenRouteServiceRoute({
  apiKey,
  origin,
  target,
  profile = defaultProfile,
}: CalculateRouteInput): Promise<CalculatedRoute> {
  const trimmedApiKey = apiKey.trim();

  if (!trimmedApiKey) {
    throw new Error('OpenRouteService API key is required');
  }

  const response = await fetch(`${endpointBaseUrl}/${profile}/geojson`, {
    method: 'POST',
    headers: {
      Authorization: trimmedApiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      coordinates: [toLngLat(origin), toLngLat(target)],
    }),
  });

  if (!response.ok) {
    throw new Error('OpenRouteService route calculation failed');
  }

  const parsedRoute = parseRouteResponse((await response.json()) as OpenRouteServiceFeatureCollection);

  return {
    ...parsedRoute,
    provider,
    profile,
  };
}
