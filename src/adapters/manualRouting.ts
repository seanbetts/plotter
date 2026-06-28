import { createStraightLineGeometry } from '../domain/routeLegs';
import type { Coordinates } from '../domain/types';

export function buildManualRouteGeometry(origin: Coordinates, target: Coordinates) {
  return createStraightLineGeometry(origin, target);
}
