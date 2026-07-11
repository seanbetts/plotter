import type { FeatureCollection, LineString } from 'geojson';
import type {
  Coordinates,
  FerryPolicy,
  RouteSection,
  RouteWaypoint,
  TripRoutingVehicle,
  VehicleRestrictions,
} from '../domain/types';
import {
  dedupeRouteOptions,
  routeOptionFromCalculation,
  type RouteAvoidFeature,
  type RouteOption,
} from '../domain/routeOptions';
import { standardRoutingVehicle } from '../domain/vehiclePresets';

type OpenRouteServiceProfile = TripRoutingVehicle['profile'];

type CalculateRouteInput = {
  apiKey: string;
  origin: Coordinates;
  target: Coordinates;
  profile?: OpenRouteServiceProfile;
  routingVehicle?: TripRoutingVehicle;
  waypoints?: Array<Pick<RouteWaypoint, 'coordinates'>>;
  ferryPolicy?: FerryPolicy;
};

type CalculatedRoute = {
  distanceKm: number;
  travelTimeHours: number;
  geometry: LineString;
  provider: 'openrouteservice';
  profile: OpenRouteServiceProfile;
  sections: RouteSection[];
};

type OpenRouteServiceFeatureProperties = {
  summary?: {
    distance?: number;
    duration?: number;
  };
  extras?: {
    waycategory?: {
      values?: unknown;
    };
  };
};

type OpenRouteServiceFeatureCollection = FeatureCollection<LineString, OpenRouteServiceFeatureProperties>;

class OpenRouteServiceRouteCalculationError extends Error {
  constructor(public readonly status?: number) {
    super(`OpenRouteService route calculation failed${status ? ` (HTTP ${status})` : ''}`);
  }
}

const provider = 'openrouteservice';
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

function toOrsRestrictions(restrictions: VehicleRestrictions) {
  return Object.fromEntries(
    Object.entries(restrictions).map(([key, value]) => [key === 'axleLoad' ? 'axleload' : key, value]),
  );
}

function buildRoutingOptions(
  vehicle: TripRoutingVehicle,
  ferryPolicy: FerryPolicy,
  additionalAvoidFeature?: RouteAvoidFeature,
) {
  const options: Record<string, unknown> = {};
  const avoidFeatures = new Set<RouteAvoidFeature>();

  if (ferryPolicy === 'avoid') avoidFeatures.add('ferries');
  if (additionalAvoidFeature) avoidFeatures.add(additionalAvoidFeature);
  if (avoidFeatures.size > 0) options.avoid_features = [...avoidFeatures];

  if (vehicle.profile === 'driving-hgv') {
    options.vehicle_type = vehicle.vehicleType;
    options.profile_params = { restrictions: toOrsRestrictions(vehicle.restrictions) };
  }

  return Object.keys(options).length > 0 ? options : undefined;
}

function buildCoordinates(origin: Coordinates, waypoints: Array<Pick<RouteWaypoint, 'coordinates'>>, target: Coordinates) {
  return [origin, ...waypoints.map((waypoint) => waypoint.coordinates), target].map(toLngLat);
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
    Array.isArray(geometry.coordinates) &&
    geometry.coordinates.length >= 2
  );
}

function degreesToRadians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

function coordinatePairDistanceKm(left: number[], right: number[]) {
  const [leftLng, leftLat] = left;
  const [rightLng, rightLat] = right;
  if (
    typeof leftLng !== 'number' || typeof leftLat !== 'number' ||
    typeof rightLng !== 'number' || typeof rightLat !== 'number'
  ) {
    throw new Error('OpenRouteService returned an invalid route');
  }

  const earthRadiusKm = 6371;
  const latDelta = degreesToRadians(rightLat - leftLat);
  const lngDelta = degreesToRadians(rightLng - leftLng);
  const leftLatitude = degreesToRadians(leftLat);
  const rightLatitude = degreesToRadians(rightLat);
  const haversine =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(leftLatitude) * Math.cos(rightLatitude) * Math.sin(lngDelta / 2) ** 2;

  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function sectionDistanceKm(geometry: LineString, startGeometryIndex: number, endGeometryIndex: number) {
  let distanceKm = 0;
  for (let index = startGeometryIndex; index < endGeometryIndex; index += 1) {
    distanceKm += coordinatePairDistanceKm(geometry.coordinates[index], geometry.coordinates[index + 1]);
  }
  return Math.round(distanceKm * 10) / 10;
}

function parseWaycategoryRanges(values: unknown, lastGeometryIndex: number) {
  if (!Array.isArray(values)) {
    throw new Error('OpenRouteService returned an invalid route');
  }

  let previousEnd = -1;
  return values.map((value) => {
    if (!Array.isArray(value) || value.length !== 3) {
      throw new Error('OpenRouteService returned an invalid route');
    }

    const [startGeometryIndex, endGeometryIndex, category] = value;
    if (
      !Number.isInteger(startGeometryIndex) ||
      !Number.isInteger(endGeometryIndex) ||
      !Number.isInteger(category) ||
      startGeometryIndex < 0 ||
      startGeometryIndex >= endGeometryIndex ||
      endGeometryIndex > lastGeometryIndex ||
      startGeometryIndex < previousEnd
    ) {
      throw new Error('OpenRouteService returned an invalid route');
    }

    previousEnd = endGeometryIndex;
    return { startGeometryIndex, endGeometryIndex, category };
  });
}

function parseRouteSections(
  geometry: LineString,
  distanceKm: number,
  waycategory: { values?: unknown } | undefined,
): RouteSection[] {
  const lastGeometryIndex = geometry.coordinates.length - 1;
  if (!waycategory) {
    return [{ kind: 'road', startGeometryIndex: 0, endGeometryIndex: lastGeometryIndex, distanceKm }];
  }

  const ferryRanges = parseWaycategoryRanges(waycategory.values, lastGeometryIndex)
    .filter((range) => (range.category & 8) !== 0);
  const sections: RouteSection[] = [];
  let nextRoadStart = 0;

  for (const ferryRange of ferryRanges) {
    if (nextRoadStart < ferryRange.startGeometryIndex) {
      sections.push({
        kind: 'road',
        startGeometryIndex: nextRoadStart,
        endGeometryIndex: ferryRange.startGeometryIndex,
        distanceKm: sectionDistanceKm(geometry, nextRoadStart, ferryRange.startGeometryIndex),
      });
    }
    sections.push({
      kind: 'ferry',
      startGeometryIndex: ferryRange.startGeometryIndex,
      endGeometryIndex: ferryRange.endGeometryIndex,
      distanceKm: sectionDistanceKm(geometry, ferryRange.startGeometryIndex, ferryRange.endGeometryIndex),
    });
    nextRoadStart = ferryRange.endGeometryIndex;
  }

  if (nextRoadStart < lastGeometryIndex) {
    sections.push({
      kind: 'road',
      startGeometryIndex: nextRoadStart,
      endGeometryIndex: lastGeometryIndex,
      distanceKm: sectionDistanceKm(geometry, nextRoadStart, lastGeometryIndex),
    });
  }

  return sections;
}

function parseRouteFeature(feature: OpenRouteServiceFeatureCollection['features'][number]) {
  const geometry = feature.geometry;
  const summary = feature.properties?.summary;

  if (!isLineString(geometry) || typeof summary?.distance !== 'number' || typeof summary.duration !== 'number') {
    throw new Error('OpenRouteService returned an invalid route');
  }

  const distanceKm = summary.distance / 1000;

  return {
    distanceKm,
    travelTimeHours: summary.duration / 3600,
    geometry,
    sections: parseRouteSections(geometry, distanceKm, feature.properties?.extras?.waycategory),
  };
}

function parseRouteResponse(data: OpenRouteServiceFeatureCollection): Omit<CalculatedRoute, 'provider' | 'profile'> {
  const feature = data.features.at(0);

  if (!feature) {
    throw new Error('OpenRouteService returned an invalid route');
  }

  return parseRouteFeature(feature);
}

function isAuthFailure(error: unknown) {
  return error instanceof OpenRouteServiceRouteCalculationError && (error.status === 401 || error.status === 403);
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
    throw new OpenRouteServiceRouteCalculationError(response.status);
  }

  return (await response.json()) as OpenRouteServiceFeatureCollection;
}

export function calculateOpenRouteServiceRoute(
  input: CalculateRouteInput & { profile: 'driving-car'; routingVehicle?: undefined },
): Promise<CalculatedRoute & { profile: 'driving-car' }>;
export function calculateOpenRouteServiceRoute(input: CalculateRouteInput): Promise<CalculatedRoute>;
export async function calculateOpenRouteServiceRoute({
  apiKey,
  origin,
  target,
  routingVehicle = standardRoutingVehicle,
  waypoints = [],
  ferryPolicy = 'allow',
}: CalculateRouteInput): Promise<CalculatedRoute> {
  const trimmedApiKey = requireApiKey(apiKey);
  const resolvedVehicle = routingVehicle;
  const parsedRoute = parseRouteResponse(
    await postDirections({
      apiKey: trimmedApiKey,
      profile: resolvedVehicle.profile,
      body: {
        coordinates: buildCoordinates(origin, waypoints, target),
        extra_info: ['waycategory'],
        ...(buildRoutingOptions(resolvedVehicle, ferryPolicy)
          ? { options: buildRoutingOptions(resolvedVehicle, ferryPolicy) }
          : {}),
      },
    }),
  );

  return {
    ...parsedRoute,
    provider,
    profile: resolvedVehicle.profile,
  };
}

async function calculateProviderAlternativeOptions({
  apiKey,
  origin,
  target,
  profile,
  routingVehicle,
  waypoints,
  ferryPolicy,
}: Required<CalculateRouteInput>): Promise<RouteOption[]> {
  const data = await postDirections({
    apiKey,
    profile,
    body: {
      coordinates: buildCoordinates(origin, waypoints, target),
      alternative_routes: {
        target_count: maxRouteOptions,
        share_factor: 0.6,
        weight_factor: 2,
      },
      extra_info: ['waycategory'],
      ...(buildRoutingOptions(routingVehicle, ferryPolicy)
        ? { options: buildRoutingOptions(routingVehicle, ferryPolicy) }
        : {}),
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
      sections: route.sections,
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
  routingVehicle,
  waypoints,
  ferryPolicy,
  feature,
  label,
}: Required<CalculateRouteInput> & { feature: RouteAvoidFeature; label: string }) {
  const data = await postDirections({
    apiKey,
    profile,
    body: {
      coordinates: buildCoordinates(origin, waypoints, target),
      options: buildRoutingOptions(routingVehicle, ferryPolicy, feature),
      extra_info: ['waycategory'],
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
    sections: route.sections,
    provider,
    profile,
    variant: `avoid:${feature}`,
  });
}

export async function calculateOpenRouteServiceRouteOptions({
  apiKey,
  origin,
  target,
  routingVehicle = standardRoutingVehicle,
  waypoints = [],
  ferryPolicy = 'allow',
}: CalculateRouteInput): Promise<RouteOption[]> {
  const trimmedApiKey = requireApiKey(apiKey);
  const resolvedVehicle = routingVehicle;
  const options: RouteOption[] = [];

  try {
    options.push(
      ...(await calculateProviderAlternativeOptions({
        apiKey: trimmedApiKey,
        origin,
        target,
        profile: resolvedVehicle.profile,
        routingVehicle: resolvedVehicle,
        waypoints,
        ferryPolicy,
      })),
    );
  } catch (error) {
    if (isAuthFailure(error)) {
      throw error;
    }

    // The alternatives endpoint can fail for long routes; supported supplementals still get a chance below.
  }

  for (const supplemental of supplementalAvoidFeatures) {
    if (supplemental.feature === 'ferries' && ferryPolicy === 'require') continue;
    if (dedupeRouteOptions(options).length >= maxRouteOptions) break;

    try {
      options.push(
        await calculateAvoidFeatureOption({
          apiKey: trimmedApiKey,
          origin,
          target,
          profile: resolvedVehicle.profile,
          routingVehicle: resolvedVehicle,
          waypoints,
          ferryPolicy,
          ...supplemental,
        }),
      );
    } catch (error) {
      if (isAuthFailure(error)) {
        throw error;
      }

      // Failed supplemental options are hidden from the picker.
    }
  }

  return dedupeRouteOptions(options).slice(0, maxRouteOptions);
}
