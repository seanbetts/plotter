import type { FeatureCollection, LineString } from 'geojson';
import type { Destination, RouteLeg, RouteSection } from '../domain/types';

export type RouteFeatureProperties = {
  id: string;
  type: 'drive' | 'manual' | 'failed';
  status: RouteLeg['status'];
  kind: 'road' | 'ferry' | 'manual' | 'failed';
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
  return Boolean(
    geometry?.type === 'LineString' &&
    geometry.coordinates.length >= 2 &&
    geometry.coordinates.every(
      (coordinate) =>
        coordinate.length >= 2 &&
        Number.isFinite(coordinate[0]) &&
        Number.isFinite(coordinate[1]),
    ),
  );
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
  if (
    leg.movement === 'drive' &&
    leg.calculation === 'automatic' &&
    (leg.status === 'ready' || leg.status === 'review-required') &&
    hasUsableLineString(leg.geometry)
  ) {
    return leg.geometry;
  }
  if (leg.movement === 'vehicle-shipping' && leg.calculation === 'manual' && hasUsableLineString(leg.geometry)) {
    return leg.geometry;
  }

  const origin = findDestination(destinations, leg.originDestinationId);
  const target = findDestination(destinations, leg.targetDestinationId);
  if (!origin || !target) return null;

  if (leg.movement === 'vehicle-shipping' && leg.calculation === 'manual') {
    return straightLineGeometry(origin, target);
  }

  if (leg.status === 'failed') {
    return straightLineGeometry(origin, target);
  }

  return null;
}

function routeTypeForLeg(leg: RouteLeg): RouteFeatureProperties['type'] {
  if (leg.status === 'failed') return 'failed';
  return leg.movement === 'vehicle-shipping' && leg.calculation === 'manual' ? 'manual' : 'drive';
}

function featureForGeometry(
  routeLeg: RouteLeg,
  geometry: LineString,
  kind: RouteFeatureProperties['kind'],
  sectionIndex?: number,
) {
  return {
    type: 'Feature' as const,
    id: sectionIndex === undefined ? routeLeg.id : `${routeLeg.id}:${kind}:${sectionIndex}`,
    geometry,
    properties: {
      id: routeLeg.id,
      type: routeTypeForLeg(routeLeg),
      status: routeLeg.status,
      kind,
    },
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasValidSections(sections: unknown, coordinateCount: number): sections is RouteSection[] {
  if (!Array.isArray(sections)) return false;
  let previousEndGeometryIndex = 0;

  for (const [index, section] of sections.entries()) {
    if (!isPlainObject(section)) return false;
    const kind = section.kind;
    const startGeometryIndex = section.startGeometryIndex;
    const endGeometryIndex = section.endGeometryIndex;
    const distanceKm = section.distanceKm;
    if (
      (kind !== 'road' && kind !== 'ferry') ||
      typeof startGeometryIndex !== 'number' ||
      typeof endGeometryIndex !== 'number' ||
      typeof distanceKm !== 'number' ||
      !Number.isFinite(startGeometryIndex) ||
      !Number.isFinite(endGeometryIndex) ||
      !Number.isInteger(startGeometryIndex) ||
      !Number.isInteger(endGeometryIndex) ||
      !Number.isFinite(distanceKm) ||
      distanceKm < 0 ||
      startGeometryIndex < 0 ||
      endGeometryIndex >= coordinateCount ||
      startGeometryIndex >= endGeometryIndex ||
      (index > 0 && startGeometryIndex < previousEndGeometryIndex)
    ) {
      return false;
    }

    previousEndGeometryIndex = endGeometryIndex;
  }

  return true;
}

function sectionFeatures(routeLeg: RouteLeg, geometry: LineString) {
  const coordinates = geometry.coordinates;
  const sections: unknown = routeLeg.sections ?? [];
  if (!hasValidSections(sections, coordinates.length) || sections.length === 0) {
    return [featureForGeometry(routeLeg, geometry, 'road')];
  }

  const features: ReturnType<typeof featureForGeometry>[] = [];
  let currentGeometryIndex = 0;
  let featureIndex = 0;

  for (const section of sections) {
    if (section.startGeometryIndex > currentGeometryIndex) {
      features.push(featureForGeometry(routeLeg, {
        type: 'LineString',
        coordinates: coordinates.slice(currentGeometryIndex, section.startGeometryIndex + 1),
      }, 'road', featureIndex));
      featureIndex += 1;
    }

    features.push(featureForGeometry(routeLeg, {
      type: 'LineString',
      coordinates: coordinates.slice(section.startGeometryIndex, section.endGeometryIndex + 1),
    }, section.kind, featureIndex));
    featureIndex += 1;
    currentGeometryIndex = section.endGeometryIndex;
  }

  if (currentGeometryIndex < coordinates.length - 1) {
    features.push(featureForGeometry(routeLeg, {
      type: 'LineString',
      coordinates: coordinates.slice(currentGeometryIndex),
    }, 'road', featureIndex));
  }

  return features;
}

export function buildRouteFeatures(
  routeLegs: RouteLeg[],
  destinations: Destination[] = [],
): FeatureCollection<LineString, RouteFeatureProperties> {
  return {
    type: 'FeatureCollection',
    features: routeLegs.flatMap((routeLeg) => {
      const geometry = routeGeometryForLeg(destinations, routeLeg);
      if (!geometry) return [];

      if (routeLeg.movement === 'vehicle-shipping' && routeLeg.calculation === 'manual') {
        return [featureForGeometry(routeLeg, geometry, 'manual')];
      }
      if (routeLeg.status === 'failed') {
        return [featureForGeometry(routeLeg, geometry, 'failed')];
      }

      return sectionFeatures(routeLeg, geometry);
    }),
  };
}

export function buildRenderableRouteFeatures(
  destinations: Destination[],
  routeLegs: RouteLeg[],
): FeatureCollection<LineString, RouteFeatureProperties> {
  return buildRouteFeatures(routeLegs, destinations);
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
