import { describe, expect, it } from 'vitest';
import { createActivity, updateActivity } from '../domain/activities';
import { createDestination, updateDestination } from '../domain/destinations';
import { createRouteLeg } from '../domain/routeLegs';
import { auditTripSnapshot } from './tripAudit';

describe('trip semantic audit', () => {
  it('reports remote activities, failed routes, implausible detours, and default home stays', () => {
    const home = updateDestination(createDestination({
      name: 'Home',
      coordinates: { lat: 51.0576, lng: -0.1342 },
      order: 0,
    }), {
      timing: {
        idealMonths: [],
        expectedStayDays: 3,
        provisionalStartDate: '',
        provisionalEndDate: '',
      },
    });
    const larvik = createDestination({
      name: 'Larvik',
      coordinates: { lat: 59.0533, lng: 10.0352 },
      order: 1,
    });
    const hirtshals = createDestination({
      name: 'Hirtshals',
      coordinates: { lat: 57.5881, lng: 9.9598 },
      order: 2,
    });
    const returnHome = updateDestination(createDestination({
      name: 'Home',
      coordinates: home.coordinates,
      order: 3,
    }), {
      timing: {
        idealMonths: [],
        expectedStayDays: 1,
        provisionalStartDate: '',
        provisionalEndDate: '',
      },
    });
    const remoteActivity = {
      ...updateActivity(createActivity({
        destinationId: larvik.id,
        title: 'Drive to A in Lofoten',
        location: {
          name: 'A',
          address: 'A, Lofoten',
          coordinates: { lat: 67.8804, lng: 12.9826 },
          sourceProvider: 'manual',
        },
      }), {}),
      id: 'drive-to-a',
    };
    const failedLeg = {
      ...createRouteLeg({
        originDestinationId: home.id,
        targetDestinationId: larvik.id,
        movement: 'drive', calculation: 'automatic',
        status: 'failed',
        error: 'OpenRouteService route calculation failed.',
        providerDiagnostic: {
          provider: 'openrouteservice',
          httpStatus: 404,
          code: 2010,
          providerMessage: 'Could not find routable point at specified coordinate 1.',
          coordinateIndex: 1,
          requestedProfile: 'driving-car',
          actualProfile: 'driving-car',
        },
      }),
      id: 'failed-leg',
    };
    const detourLeg = {
      ...createRouteLeg({
        originDestinationId: larvik.id,
        targetDestinationId: hirtshals.id,
        movement: 'drive', calculation: 'automatic',
        status: 'ready',
        distanceKm: 1084,
      }),
      id: 'larvik-hirtshals-auto',
    };

    const report = auditTripSnapshot({
      destinations: [home, larvik, hirtshals, returnHome],
      activities: [remoteActivity],
      routeLegs: [failedLeg, detourLeg],
    });

    expect(report.issues).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'ACTIVITY_DISTANCE_OUTLIER',
      activityId: 'drive-to-a',
      destination: {
        id: larvik.id,
        name: 'Larvik',
        coordinates: { lat: 59.0533, lng: 10.0352 },
        resolvedLabel: 'Larvik',
        sourceProvider: 'legacy',
      },
      activity: {
        id: 'drive-to-a',
        name: 'Drive to A in Lofoten',
        coordinates: { lat: 67.8804, lng: 12.9826 },
        resolvedLabel: 'A, Lofoten',
        sourceProvider: 'manual',
      },
    }));
    expect(report.issues).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'FAILED_ROUTE_LEG',
      routeLegId: 'failed-leg',
      providerDiagnostic: failedLeg.providerDiagnostic,
      origin: {
        id: home.id,
        name: 'Home',
        coordinates: { lat: 51.0576, lng: -0.1342 },
        resolvedLabel: 'Home',
        sourceProvider: 'legacy',
      },
      target: {
        id: larvik.id,
        name: 'Larvik',
        coordinates: { lat: 59.0533, lng: 10.0352 },
        resolvedLabel: 'Larvik',
        sourceProvider: 'legacy',
      },
    }));
    expect(report.issues).toContainEqual(expect.objectContaining({
      severity: 'warning',
      code: 'SUSPICIOUS_DETOUR',
      routeLegId: 'larvik-hirtshals-auto',
      origin: expect.objectContaining({ id: larvik.id, name: 'Larvik' }),
      target: expect.objectContaining({ id: hirtshals.id, name: 'Hirtshals' }),
    }));
    expect(report.issues).toContainEqual(expect.objectContaining({
      severity: 'warning',
      code: 'DEFAULT_STAY_AT_HOME_ANCHOR',
      destinationId: home.id,
      destination: expect.objectContaining({ id: home.id, name: 'Home' }),
    }));
    expect(report).toMatchObject({ errors: 2, warnings: 2 });
    expect(report.issues.every((issue) => issue.message.includes('undefined') === false)).toBe(true);
  });

  it('reports exact ferry contradiction and suspicious-detour codes with endpoint context', () => {
    const bremen = createDestination({
      name: 'Bremen',
      coordinates: { lat: 53.0793, lng: 8.8017 },
    });
    const hirtshals = createDestination({
      name: 'Hirtshals',
      coordinates: { lat: 57.5881, lng: 9.9598 },
    });
    const ferryFailure = {
      ...createRouteLeg({
        originDestinationId: bremen.id,
        targetDestinationId: hirtshals.id,
        movement: 'drive', calculation: 'automatic',
        status: 'failed',
        warnings: [{ code: 'FERRY_REQUIRED_NOT_FOUND', message: 'Required ferry section was not returned.' }],
        error: 'Required ferry section was not returned.',
      }),
      id: 'ferry-failure',
    };
    const suspiciousDetour = {
      ...createRouteLeg({
        originDestinationId: bremen.id,
        targetDestinationId: hirtshals.id,
        movement: 'drive', calculation: 'automatic',
        status: 'review-required',
        geometry: { type: 'LineString' as const, coordinates: [[8.8017, 53.0793], [9.9598, 57.5881]] },
        warnings: [{ code: 'SUSPICIOUS_DETOUR', message: 'Candidate route requires review.' }],
      }),
      id: 'suspicious-detour',
    };

    const report = auditTripSnapshot({
      destinations: [bremen, hirtshals],
      activities: [],
      routeLegs: [ferryFailure, suspiciousDetour],
    });

    expect(report.issues).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'FERRY_REQUIRED_NOT_FOUND',
      routeLegId: 'ferry-failure',
      origin: expect.objectContaining({ id: bremen.id, name: 'Bremen' }),
      target: expect.objectContaining({ id: hirtshals.id, name: 'Hirtshals' }),
    }));
    expect(report.issues).toContainEqual(expect.objectContaining({
      severity: 'warning',
      code: 'SUSPICIOUS_DETOUR',
      routeLegId: 'suspicious-detour',
      origin: expect.objectContaining({ id: bremen.id, name: 'Bremen' }),
      target: expect.objectContaining({ id: hirtshals.id, name: 'Hirtshals' }),
    }));
  });

  it('reports each ready-route recovery qualification with endpoint context', () => {
    const lillehammer = createDestination({
      name: 'Lillehammer',
      coordinates: { lat: 61.1153, lng: 10.4662 },
    });
    const oslo = createDestination({
      name: 'Oslo',
      coordinates: { lat: 59.9139, lng: 10.7522 },
    });
    const recoveredLeg = {
      ...createRouteLeg({
        originDestinationId: lillehammer.id,
        targetDestinationId: oslo.id,
        movement: 'drive', calculation: 'automatic',
        status: 'ready',
        warnings: [
          {
            code: 'VEHICLE_PROFILE_FALLBACK' as const,
            message: 'Truck dimensions were not validated.',
          },
          {
            code: 'ROUTING_ANCHOR_ADJUSTED' as const,
            message: 'Route target uses a routing point 1.6 km from the stop.',
          },
        ],
      }),
      id: 'fallback-leg',
    };

    const report = auditTripSnapshot({
      destinations: [lillehammer, oslo],
      activities: [],
      routeLegs: [recoveredLeg],
    });

    expect(report.issues).toContainEqual(expect.objectContaining({
      severity: 'warning',
      code: 'VEHICLE_PROFILE_FALLBACK',
      message: 'Truck dimensions were not validated.',
      routeLegId: 'fallback-leg',
      origin: expect.objectContaining({ name: 'Lillehammer' }),
      target: expect.objectContaining({ name: 'Oslo' }),
    }));
    expect(report.issues).toContainEqual(expect.objectContaining({
      severity: 'warning',
      code: 'ROUTING_ANCHOR_ADJUSTED',
      message: 'Route target uses a routing point 1.6 km from the stop.',
      routeLegId: 'fallback-leg',
      origin: expect.objectContaining({ name: 'Lillehammer' }),
      target: expect.objectContaining({ name: 'Oslo' }),
    }));
    expect(report).toMatchObject({ errors: 0, warnings: 2 });
  });

  it('does not report a detour for an approved manual shipping leg', () => {
    const larvik = createDestination({
      name: 'Larvik',
      coordinates: { lat: 59.0533, lng: 10.0352 },
    });
    const hirtshals = createDestination({
      name: 'Hirtshals',
      coordinates: { lat: 57.5881, lng: 9.9598 },
    });
    const ferry = createRouteLeg({
      originDestinationId: larvik.id,
      targetDestinationId: hirtshals.id,
      movement: 'vehicle-shipping', calculation: 'manual',
      status: 'manual',
      distanceKm: 1084,
    });

    const report = auditTripSnapshot({
      destinations: [larvik, hirtshals],
      activities: [],
      routeLegs: [ferry],
    });

    expect(report.issues.some((issue) => issue.code === 'SUSPICIOUS_DETOUR')).toBe(false);
  });
});
