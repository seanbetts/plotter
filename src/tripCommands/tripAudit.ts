import { coordinateDistanceKm } from '../domain/routePlanner';
import type { Activity, Destination, RouteLeg } from '../domain/types';

export type TripAuditSeverity = 'error' | 'warning';

export type TripAuditIssue = {
  severity: TripAuditSeverity;
  code:
    | 'ACTIVITY_DISTANCE_OUTLIER'
    | 'FAILED_ROUTE_LEG'
    | 'AUTO_ROUTE_DETOUR'
    | 'DEFAULT_STAY_AT_HOME_ANCHOR';
  message: string;
  destinationId?: string;
  activityId?: string;
  routeLegId?: string;
  originDestinationId?: string;
  targetDestinationId?: string;
};

export type TripAuditReport = {
  errors: number;
  warnings: number;
  issues: TripAuditIssue[];
};

export function auditTripSnapshot(input: {
  destinations: Destination[];
  activities: Activity[];
  routeLegs: RouteLeg[];
}): TripAuditReport {
  const issues: TripAuditIssue[] = [];
  const destinationsById = new Map(input.destinations.map((destination) => [destination.id, destination]));

  for (const activity of input.activities) {
    const destination = destinationsById.get(activity.destinationId);
    const activityCoordinates = activity.location?.coordinates;
    if (!destination || !activityCoordinates) continue;

    const distance = coordinateDistanceKm(destination.coordinates, activityCoordinates);
    if (distance > 250) {
      issues.push({
        severity: 'error',
        code: 'ACTIVITY_DISTANCE_OUTLIER',
        message: `Activity ${activity.title} is ${Math.round(distance)} km from its parent stop ${destination.name}.`,
        destinationId: destination.id,
        activityId: activity.id,
      });
    }
  }

  for (const routeLeg of input.routeLegs) {
    const origin = destinationsById.get(routeLeg.originDestinationId);
    const target = destinationsById.get(routeLeg.targetDestinationId);
    const endpointNames = `${origin?.name ?? routeLeg.originDestinationId} to ${target?.name ?? routeLeg.targetDestinationId}`;

    if (routeLeg.type === 'driving-auto' && routeLeg.status === 'failed') {
      issues.push({
        severity: 'error',
        code: 'FAILED_ROUTE_LEG',
        message: `Driving route ${endpointNames} failed${routeLeg.error ? `: ${routeLeg.error}` : '.'}`,
        routeLegId: routeLeg.id,
        originDestinationId: routeLeg.originDestinationId,
        targetDestinationId: routeLeg.targetDestinationId,
      });
    }

    if (
      routeLeg.type === 'driving-auto'
      && routeLeg.distanceKm !== undefined
      && routeLeg.distanceKm > 250
      && origin
      && target
    ) {
      const directDistance = coordinateDistanceKm(origin.coordinates, target.coordinates);
      if (routeLeg.distanceKm > directDistance * 4) {
        issues.push({
          severity: 'error',
          code: 'AUTO_ROUTE_DETOUR',
          message: `Automatic driving route ${endpointNames} is ${Math.round(routeLeg.distanceKm)} km, more than four times the ${Math.round(directDistance)} km direct distance.`,
          routeLegId: routeLeg.id,
          originDestinationId: routeLeg.originDestinationId,
          targetDestinationId: routeLeg.targetDestinationId,
        });
      }
    }
  }

  if (input.destinations.length > 1) {
    const first = input.destinations[0];
    const last = input.destinations[input.destinations.length - 1];
    if (coordinateDistanceKm(first.coordinates, last.coordinates) < 0.1) {
      for (const destination of [first, last]) {
        if (destination.timing.expectedStayDays === 3) {
          issues.push({
            severity: 'warning',
            code: 'DEFAULT_STAY_AT_HOME_ANCHOR',
            message: `Home anchor ${destination.name} has the domain default stay of three days; confirm that duration is intentional.`,
            destinationId: destination.id,
          });
        }
      }
    }
  }

  return {
    errors: issues.filter((issue) => issue.severity === 'error').length,
    warnings: issues.filter((issue) => issue.severity === 'warning').length,
    issues,
  };
}
