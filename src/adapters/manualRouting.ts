import type { LineString } from 'geojson';
import { createStraightLineGeometry } from '../domain/routeLegs';
import type { Coordinates } from '../domain/types';

export function buildManualRouteGeometry(origin: Coordinates, target: Coordinates): LineString {
  return createStraightLineGeometry(origin, target);
}
