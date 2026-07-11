import type { LineString } from 'geojson';
import type {
  Coordinates,
  FerryPolicy,
  RouteLeg,
  RouteSection,
  RouteWarning,
  RoutingAnchor,
  TripRoutingVehicle,
} from './types';
import { createRouteKey } from './routeLegs';
import { standardRoutingVehicle } from './vehiclePresets';

export type RouteOptionSource =
  | 'recommended'
  | 'provider-alternative'
  | 'avoid-feature'
  | 'adjusted-endpoint'
  | 'profile-fallback';
export type RouteAvoidFeature = 'highways' | 'ferries' | 'tollways';
export type RouteOptionEndpointAnchors = { origin?: RoutingAnchor; target?: RoutingAnchor };

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
  warnings: RouteWarning[];
  endpointAnchors: RouteOptionEndpointAnchors;
};

type CreateRouteOptionKeyInput = {
  origin: Coordinates;
  target: Coordinates;
  profile?: string;
  routingVehicle?: TripRoutingVehicle;
  waypoints?: Coordinates[];
  ferryPolicy?: FerryPolicy;
  providerOptions?: Record<string, unknown>;
  variant: string;
  warnings?: RouteWarning[];
  endpointAnchors?: RouteOptionEndpointAnchors;
};

type RouteOptionFromCalculationInput = CreateRouteOptionKeyInput &
  Omit<RouteOption, 'routeKey' | 'warnings' | 'endpointAnchors'> &
  Partial<Pick<RouteOption, 'warnings' | 'endpointAnchors'>>;

export type RouteLegOptionPatch = Partial<Omit<RouteLeg, 'id' | 'createdAt' | 'updatedAt'>>;

function coordinatePairKey(coordinate: number[]) {
  const [lng, lat] = coordinate;
  return `${lng.toFixed(5)},${lat.toFixed(5)}`;
}

function geometryKey(geometry: LineString) {
  return geometry.coordinates.map(coordinatePairKey).join('|');
}

function coordinateKey(coordinates: Coordinates) {
  return { lat: coordinates.lat, lng: coordinates.lng };
}

function routeOptionAnchorKey(anchor: RoutingAnchor | undefined) {
  if (!anchor) return null;
  return {
    profile: anchor.profile,
    coordinates: coordinateKey(anchor.coordinates),
    originalCoordinates: coordinateKey(anchor.originalCoordinates),
    snapDistanceKm: anchor.snapDistanceKm,
    provider: anchor.provider,
  };
}

function recoveryProviderOptions(input: {
  providerOptions: Record<string, unknown>;
  profile?: string;
  variant: string;
  warnings?: RouteWarning[];
  endpointAnchors?: RouteOptionEndpointAnchors;
}) {
  const warningCodes = (input.warnings ?? []).map((warning) => warning.code).sort();
  const endpointAnchors = input.endpointAnchors ?? {};
  const hasRecoveryMetadata =
    warningCodes.length > 0 ||
    endpointAnchors.origin ||
    endpointAnchors.target ||
    input.variant === 'adjusted-endpoint' ||
    input.variant === 'profile-fallback';

  if (!hasRecoveryMetadata) return input.providerOptions;

  return {
    ...input.providerOptions,
    recovery: {
      variant: input.variant,
      actualProfile: input.profile ?? null,
      warningCodes,
      endpointAnchors: {
        origin: routeOptionAnchorKey(endpointAnchors.origin),
        target: routeOptionAnchorKey(endpointAnchors.target),
      },
    },
  };
}

function routeOptionInformationRank(option: RouteOption) {
  const sourceRank: Record<RouteOptionSource, number> = {
    'provider-alternative': 1,
    'avoid-feature': 1,
    recommended: 1,
    'adjusted-endpoint': 2,
    'profile-fallback': 3,
  };

  return (
    sourceRank[option.source] * 100 +
    option.warnings.length * 10 +
    (option.endpointAnchors.origin ? 1 : 0) +
    (option.endpointAnchors.target ? 1 : 0)
  );
}

export function createRouteOptionKey({
  origin,
  target,
  profile,
  routingVehicle = standardRoutingVehicle,
  waypoints = [],
  ferryPolicy = 'allow',
  providerOptions = {},
  variant,
  warnings = [],
  endpointAnchors = {},
}: CreateRouteOptionKeyInput) {
  return createRouteKey({
    origin,
    target,
    profile,
    routingVehicle,
    waypoints,
    ferryPolicy,
    providerOptions: recoveryProviderOptions({
      providerOptions,
      profile,
      variant,
      warnings,
      endpointAnchors,
    }),
    variant,
  });
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
    warnings: input.warnings ?? [],
    endpointAnchors: input.endpointAnchors ?? {},
    routeKey: createRouteOptionKey({
      origin: input.origin,
      target: input.target,
      profile: input.profile,
      routingVehicle: input.routingVehicle,
      waypoints: input.waypoints,
      ferryPolicy: input.ferryPolicy,
      providerOptions: input.providerOptions,
      variant: input.variant,
      warnings: input.warnings,
      endpointAnchors: input.endpointAnchors,
    }),
  };
}

export function dedupeRouteOptions(options: RouteOption[]) {
  const dedupedOptions: RouteOption[] = [];

  for (const option of options) {
    const optionGeometryKey = geometryKey(option.geometry);
    const existingIndex = dedupedOptions.findIndex((existing) =>
      geometryKey(existing.geometry) === optionGeometryKey || existing.routeKey === option.routeKey);

    if (existingIndex !== -1) {
      if (routeOptionInformationRank(option) > routeOptionInformationRank(dedupedOptions[existingIndex])) {
        dedupedOptions[existingIndex] = option;
      }
      continue;
    }

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
    movement: 'drive',
    calculation: 'automatic',
    status: 'ready',
    distanceKm: option.distanceKm,
    travelTimeHours: option.travelTimeHours,
    geometry: option.geometry,
    provider: option.provider,
    profile: option.profile,
    routeKey: option.routeKey,
    sections: option.sections,
    warnings: option.warnings,
    calculatedAt,
    error: undefined,
  };
}
