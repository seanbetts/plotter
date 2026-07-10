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
        type: 'driving-auto',
        status: 'failed',
        error: 'OpenRouteService route calculation failed.',
      }),
      id: 'failed-leg',
    };
    const detourLeg = {
      ...createRouteLeg({
        originDestinationId: larvik.id,
        targetDestinationId: hirtshals.id,
        type: 'driving-auto',
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
      severity: 'error',
      code: 'AUTO_ROUTE_DETOUR',
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
    expect(report).toMatchObject({ errors: 3, warnings: 1 });
    expect(report.issues.every((issue) => issue.message.includes('undefined') === false)).toBe(true);
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
      type: 'shipping-manual',
      status: 'manual',
      distanceKm: 1084,
    });

    const report = auditTripSnapshot({
      destinations: [larvik, hirtshals],
      activities: [],
      routeLegs: [ferry],
    });

    expect(report.issues.some((issue) => issue.code === 'AUTO_ROUTE_DETOUR')).toBe(false);
  });
});
