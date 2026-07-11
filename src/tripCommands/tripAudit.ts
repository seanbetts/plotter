import { coordinateDistanceKm } from '../domain/routePlanner';
import type { Activity, Destination, RouteLeg, RouteProviderDiagnostic } from '../domain/types';

export type TripAuditSeverity = 'error' | 'warning';

export type TripAuditLocationContext = {
  id: string;
  name: string;
  coordinates: Destination['coordinates'];
  resolvedLabel: string;
  sourceProvider?: string;
};

export type TripAuditIssue = {
  severity: TripAuditSeverity;
  code:
    | 'ACTIVITY_DISTANCE_OUTLIER'
    | 'FAILED_ROUTE_LEG'
    | 'FERRY_REQUIRED_NOT_FOUND'
    | 'FERRY_AVOIDED_BUT_FOUND'
    | 'SUSPICIOUS_DETOUR'
    | 'ROUTING_ANCHOR_ADJUSTED'
    | 'VEHICLE_PROFILE_FALLBACK'
    | 'DEFAULT_STAY_AT_HOME_ANCHOR';
  message: string;
  destinationId?: string;
  activityId?: string;
  routeLegId?: string;
  originDestinationId?: string;
  targetDestinationId?: string;
  destination?: TripAuditLocationContext;
  activity?: TripAuditLocationContext;
  origin?: TripAuditLocationContext;
  target?: TripAuditLocationContext;
  providerDiagnostic?: RouteProviderDiagnostic;
};

export type TripAuditReport = {
  errors: number;
  warnings: number;
  issues: TripAuditIssue[];
};

function destinationContext(destination: Destination): TripAuditLocationContext {
  return {
    id: destination.id,
    name: destination.name,
    coordinates: destination.coordinates,
    resolvedLabel: destination.location.sourceLabel,
    sourceProvider: destination.location.sourceProvider,
  };
}

function activityContext(activity: Activity): TripAuditLocationContext | undefined {
  const location = activity.location;
  if (!location?.coordinates) return undefined;

  return {
    id: activity.id,
    name: activity.title,
    coordinates: location.coordinates,
    resolvedLabel: location.address,
    ...(location.sourceProvider ? { sourceProvider: location.sourceProvider } : {}),
  };
}

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
        destination: destinationContext(destination),
        activity: activityContext(activity),
      });
    }
  }

  for (const routeLeg of input.routeLegs) {
    const origin = destinationsById.get(routeLeg.originDestinationId);
    const target = destinationsById.get(routeLeg.targetDestinationId);
    const endpointNames = `${origin?.name ?? routeLeg.originDestinationId} to ${target?.name ?? routeLeg.targetDestinationId}`;

    const ferryContradiction = routeLeg.warnings?.find((warning) => (
      warning.code === 'FERRY_REQUIRED_NOT_FOUND' || warning.code === 'FERRY_AVOIDED_BUT_FOUND'
    ));
    const ferryContradictionCode = ferryContradiction?.code === 'FERRY_REQUIRED_NOT_FOUND'
      || ferryContradiction?.code === 'FERRY_AVOIDED_BUT_FOUND'
      ? ferryContradiction.code
      : undefined;
    const suspiciousDetour = routeLeg.warnings?.find((warning) => warning.code === 'SUSPICIOUS_DETOUR');

    if (routeLeg.movement === 'drive' && routeLeg.calculation === 'automatic' && routeLeg.status === 'failed') {
      issues.push({
        severity: 'error',
        code: ferryContradictionCode ?? 'FAILED_ROUTE_LEG',
        message: ferryContradiction?.message
          ?? `Driving route ${endpointNames} failed${routeLeg.error ? `: ${routeLeg.error}` : '.'}`,
        routeLegId: routeLeg.id,
        originDestinationId: routeLeg.originDestinationId,
        targetDestinationId: routeLeg.targetDestinationId,
        ...(routeLeg.providerDiagnostic ? { providerDiagnostic: routeLeg.providerDiagnostic } : {}),
        ...(origin ? { origin: destinationContext(origin) } : {}),
        ...(target ? { target: destinationContext(target) } : {}),
      });
    }

    if (routeLeg.movement === 'drive' && routeLeg.calculation === 'automatic' && routeLeg.status === 'review-required' && suspiciousDetour) {
      issues.push({
        severity: 'warning',
        code: 'SUSPICIOUS_DETOUR',
        message: suspiciousDetour.message,
        routeLegId: routeLeg.id,
        originDestinationId: routeLeg.originDestinationId,
        targetDestinationId: routeLeg.targetDestinationId,
        ...(origin ? { origin: destinationContext(origin) } : {}),
        ...(target ? { target: destinationContext(target) } : {}),
      });
    }

    if (routeLeg.movement === 'drive' && routeLeg.calculation === 'automatic' && routeLeg.status === 'ready') {
      for (const warning of routeLeg.warnings ?? []) {
        if (warning.code !== 'ROUTING_ANCHOR_ADJUSTED' && warning.code !== 'VEHICLE_PROFILE_FALLBACK') {
          continue;
        }

        issues.push({
          severity: 'warning',
          code: warning.code,
          message: warning.message,
          routeLegId: routeLeg.id,
          originDestinationId: routeLeg.originDestinationId,
          targetDestinationId: routeLeg.targetDestinationId,
          ...(origin ? { origin: destinationContext(origin) } : {}),
          ...(target ? { target: destinationContext(target) } : {}),
        });
      }
    }

    if (
      routeLeg.movement === 'drive'
      && routeLeg.calculation === 'automatic'
      && routeLeg.distanceKm !== undefined
      && routeLeg.distanceKm > 250
      && origin
      && target
    ) {
      const directDistance = coordinateDistanceKm(origin.coordinates, target.coordinates);
      if (routeLeg.distanceKm > directDistance * 2 && routeLeg.distanceKm - directDistance >= 500) {
        issues.push({
          severity: 'warning',
          code: 'SUSPICIOUS_DETOUR',
          message: `Automatic driving route ${endpointNames} is ${Math.round(routeLeg.distanceKm)} km versus ${Math.round(directDistance)} km direct and requires review.`,
          routeLegId: routeLeg.id,
          originDestinationId: routeLeg.originDestinationId,
          targetDestinationId: routeLeg.targetDestinationId,
          origin: destinationContext(origin),
          target: destinationContext(target),
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
            destination: destinationContext(destination),
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
