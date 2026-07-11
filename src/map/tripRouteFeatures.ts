import type { FeatureCollection, LineString } from 'geojson';
import type { Destination, RouteLeg } from '../domain/types';

export type RouteFeatureProperties = {
  id: string;
  type: RouteLeg['type'] | 'failed';
  status: RouteLeg['status'];
};

export type TripMapBounds = [[number, number], [number, number]];

function findDestination(destinations: Destination[], destinationId: string) {
  return destinations.find((destination) => destination.id === destinationId);
}

function straightLineGeometry(origin: Destination, target: Destination): LineString {
  return {
    type: 'LineString',
    coordinates: [
      [origin.coordinates.lng, origin.coordinates.lat],
      [target.coordinates.lng, target.coordinates.lat],
    ],
  };
}

function hasUsableLineString(geometry: RouteLeg['geometry']): geometry is LineString {
  return geometry?.type === 'LineString' && geometry.coordinates.length >= 2;
}

function normalizeLongitude(longitude: number) {
  if (longitude >= -180 && longitude <= 180) return longitude;
  return ((longitude + 180) % 360 + 360) % 360 - 180;
}

export function unwrapLongitudeForBounds(longitude: number, bounds: TripMapBounds) {
  const [west] = bounds[0];
  const [east] = bounds[1];
  let unwrapped = normalizeLongitude(longitude);

  while (unwrapped < west) unwrapped += 360;
  while (unwrapped > east) unwrapped -= 360;

  return unwrapped;
}

export function routeGeometryForLeg(destinations: Destination[], leg: RouteLeg): LineString | null {
  if (leg.type === 'driving-auto' && leg.status === 'ready' && hasUsableLineString(leg.geometry)) {
    return leg.geometry;
  }

  const origin = findDestination(destinations, leg.originDestinationId);
  const target = findDestination(destinations, leg.targetDestinationId);
  if (!origin || !target) return null;

  if (leg.type === 'shipping-manual') {
    return hasUsableLineString(leg.geometry) ? leg.geometry : straightLineGeometry(origin, target);
  }

  if (leg.status === 'failed') {
    return straightLineGeometry(origin, target);
  }

  return null;
}

function routeTypeForLeg(leg: RouteLeg): RouteFeatureProperties['type'] {
  return leg.status === 'failed' ? 'failed' : leg.type;
}

export function buildRenderableRouteFeatures(
  destinations: Destination[],
  routeLegs: RouteLeg[],
): FeatureCollection<LineString, RouteFeatureProperties> {
  return {
    type: 'FeatureCollection',
    features: routeLegs.flatMap((leg) => {
      const geometry = routeGeometryForLeg(destinations, leg);
      if (!geometry) return [];

      return [
        {
          type: 'Feature' as const,
          id: leg.id,
          geometry,
          properties: {
            id: leg.id,
            type: routeTypeForLeg(leg),
            status: leg.status,
          },
        },
      ];
    }),
  };
}

export function tripMapBounds(
  destinations: Destination[],
  routeLegs: RouteLeg[],
): TripMapBounds | null {
  const coordinates = [
    ...destinations.map((destination) => [destination.coordinates.lng, destination.coordinates.lat]),
    ...routeLegs.flatMap((leg) => routeGeometryForLeg(destinations, leg)?.coordinates ?? []),
  ];

  if (coordinates.length === 0) return null;

  const normalizedLongitudes = coordinates
    .map(([lng]) => normalizeLongitude(lng))
    .sort((left, right) => left - right);
  let largestGap = normalizedLongitudes[0] + 360 - normalizedLongitudes.at(-1)!;
  let largestGapStartIndex = normalizedLongitudes.length - 1;

  for (let index = 0; index < normalizedLongitudes.length - 1; index += 1) {
    const gap = normalizedLongitudes[index + 1] - normalizedLongitudes[index];
    if (gap > largestGap) {
      largestGap = gap;
      largestGapStartIndex = index;
    }
  }

  const minLng = normalizedLongitudes[(largestGapStartIndex + 1) % normalizedLongitudes.length];
  let maxLng = normalizedLongitudes[largestGapStartIndex];
  if (maxLng < minLng) maxLng += 360;

  const [, firstLat] = coordinates[0];
  let minLat = firstLat;
  let maxLat = firstLat;

  for (const [, lat] of coordinates.slice(1)) {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }

  return [[minLng, minLat], [maxLng, maxLat]];
}
