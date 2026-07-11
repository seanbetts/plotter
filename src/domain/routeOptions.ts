import type { LineString } from 'geojson';
import type { Coordinates, RouteLeg, RouteSection } from './types';

export type RouteOptionSource = 'recommended' | 'provider-alternative' | 'avoid-feature';
export type RouteAvoidFeature = 'highways' | 'ferries' | 'tollways';

export type RouteOption = {
  id: string;
  label: string;
  source: RouteOptionSource;
  distanceKm: number;
  travelTimeHours: number;
  geometry: LineString;
  sections: RouteSection[];
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
    sections: input.sections,
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
  if (!option.sections) {
    throw new Error('Route option sections are required');
  }

  return {
    type: 'driving-auto',
    status: 'ready',
    distanceKm: option.distanceKm,
    travelTimeHours: option.travelTimeHours,
    geometry: option.geometry,
    provider: option.provider,
    profile: option.profile,
    routeKey: option.routeKey,
    sections: option.sections,
    calculatedAt,
    error: undefined,
  };
}
