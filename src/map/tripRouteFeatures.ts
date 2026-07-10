import type { FeatureCollection, LineString } from 'geojson';
import type { Destination, RouteLeg } from '../domain/types';

export type RouteFeatureProperties = {
  id: string;
  type: RouteLeg['type'] | 'failed';
  status: RouteLeg['status'];
};

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
): [[number, number], [number, number]] | null {
  const coordinates = [
    ...destinations.map((destination) => [destination.coordinates.lng, destination.coordinates.lat]),
    ...routeLegs.flatMap((leg) => routeGeometryForLeg(destinations, leg)?.coordinates ?? []),
  ];

  if (coordinates.length === 0) return null;

  const [firstLng, firstLat] = coordinates[0];
  let minLng = firstLng;
  let minLat = firstLat;
  let maxLng = firstLng;
  let maxLat = firstLat;

  for (const [lng, lat] of coordinates.slice(1)) {
    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
  }

  return [[minLng, minLat], [maxLng, maxLat]];
}
