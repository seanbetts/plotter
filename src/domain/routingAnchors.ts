import type { Coordinates, RoutingAnchor, RoutingAnchorProfile } from './types';

export const routingAnchorMaxDistanceKm = 2;
export const routingAnchorDistanceToleranceKm = 0.05;

export type ValidatedRoutingAnchor = {
  anchor: RoutingAnchor;
  actualSnapDistanceKm: number;
};

function coordinatesAreFiniteAndBounded(coordinates: Coordinates | undefined) {
  return Boolean(
    coordinates &&
    Number.isFinite(coordinates.lat) &&
    Number.isFinite(coordinates.lng) &&
    coordinates.lat >= -90 &&
    coordinates.lat <= 90 &&
    coordinates.lng >= -180 &&
    coordinates.lng <= 180,
  );
}

function degreesToRadians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

export function coordinateDistanceKm(left: Coordinates, right: Coordinates) {
  const earthRadiusKm = 6371;
  const latDelta = degreesToRadians(right.lat - left.lat);
  const lngDelta = degreesToRadians(right.lng - left.lng);
  const leftLatitude = degreesToRadians(left.lat);
  const rightLatitude = degreesToRadians(right.lat);
  const haversine =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(leftLatitude) * Math.cos(rightLatitude) * Math.sin(lngDelta / 2) ** 2;

  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function validateRoutingAnchor(input: {
  anchor: RoutingAnchor | undefined;
  canonicalCoordinates: Coordinates;
  profile: RoutingAnchorProfile;
}): ValidatedRoutingAnchor | undefined {
  const { anchor, canonicalCoordinates, profile } = input;
  if (
    !anchor ||
    anchor.provider !== 'openrouteservice' ||
    anchor.profile !== profile ||
    !coordinatesAreFiniteAndBounded(canonicalCoordinates) ||
    !coordinatesAreFiniteAndBounded(anchor.originalCoordinates) ||
    !coordinatesAreFiniteAndBounded(anchor.coordinates) ||
    anchor.originalCoordinates.lat !== canonicalCoordinates.lat ||
    anchor.originalCoordinates.lng !== canonicalCoordinates.lng ||
    !Number.isFinite(anchor.snapDistanceKm) ||
    anchor.snapDistanceKm < 0
  ) {
    return undefined;
  }

  const actualSnapDistanceKm = coordinateDistanceKm(canonicalCoordinates, anchor.coordinates);
  if (
    !Number.isFinite(actualSnapDistanceKm) ||
    actualSnapDistanceKm > routingAnchorMaxDistanceKm ||
    Math.abs(actualSnapDistanceKm - anchor.snapDistanceKm) > routingAnchorDistanceToleranceKm + Number.EPSILON
  ) {
    return undefined;
  }

  return { anchor, actualSnapDistanceKm };
}
