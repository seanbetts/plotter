import { describe, expect, it, vi } from 'vitest';
import { createDestination } from '../domain/destinations';
import { createRouteKey, createRouteLeg } from '../domain/routeLegs';
import type { RouteLeg } from '../domain/types';
import { reconcileAndSaveRouteLegs } from './routeOrchestration';

function createRepository(routeLegs: RouteLeg[] = []) {
  return {
    saveRouteLeg: vi.fn(async (routeLeg: RouteLeg) => {
      const index = routeLegs.findIndex((existing) => existing.id === routeLeg.id);
      if (index === -1) routeLegs.push(routeLeg);
      else routeLegs[index] = routeLeg;
    }),
    deleteRouteLeg: vi.fn(async (routeLegId: string) => {
      const index = routeLegs.findIndex((routeLeg) => routeLeg.id === routeLegId);
      if (index !== -1) routeLegs.splice(index, 1);
    }),
  };
}

describe('route orchestration', () => {
  it('creates and calculates adjacent driving route legs', async () => {
    const origin = createDestination({
      name: 'Boroughbridge',
      coordinates: { lat: 54.0903, lng: -1.4144 },
    });
    const target = createDestination({
      name: 'Alnwick',
      coordinates: { lat: 55.426423, lng: -1.60645 },
    });
    const repository = createRepository();
    const calculateRoute = vi.fn(async () => ({
      distanceKm: 170,
      travelTimeHours: 2,
      geometry: {
        type: 'LineString' as const,
        coordinates: [
          [origin.coordinates.lng, origin.coordinates.lat],
          [target.coordinates.lng, target.coordinates.lat],
        ],
      },
      provider: 'test',
      profile: 'driving-car' as const,
    }));

    const routeLegs = await reconcileAndSaveRouteLegs({
      destinations: [origin, target],
      currentRouteLegs: [],
      repository,
      calculateRoute,
    });

    expect(routeLegs).toHaveLength(1);
    expect(routeLegs[0]).toMatchObject({
      originDestinationId: origin.id,
      targetDestinationId: target.id,
      status: 'ready',
      distanceKm: 170,
      travelTimeHours: 2,
      provider: 'test',
      profile: 'driving-car',
    });
    expect(repository.saveRouteLeg).toHaveBeenCalledTimes(1);
  });

  it('preserves ready route legs that still match the same endpoints', async () => {
    const origin = createDestination({
      name: 'Tongue',
      coordinates: { lat: 58.492089, lng: -4.427364 },
    });
    const target = createDestination({
      name: 'Shore',
      coordinates: { lat: 58.168971, lng: -5.307577 },
    });
    const readyLeg = createRouteLeg({
      originDestinationId: origin.id,
      targetDestinationId: target.id,
      type: 'driving-auto',
      status: 'ready',
      distanceKm: 96,
      travelTimeHours: 2,
      geometry: {
        type: 'LineString',
        coordinates: [
          [origin.coordinates.lng, origin.coordinates.lat],
          [target.coordinates.lng, target.coordinates.lat],
        ],
      },
      provider: 'openrouteservice',
      profile: 'driving-car',
      routeKey: createRouteKey({ origin: origin.coordinates, target: target.coordinates }),
      calculatedAt: new Date().toISOString(),
    });
    const repository = createRepository([readyLeg]);
    const calculateRoute = vi.fn();

    const routeLegs = await reconcileAndSaveRouteLegs({
      destinations: [origin, target],
      currentRouteLegs: [readyLeg],
      repository,
      calculateRoute,
    });

    expect(routeLegs[0]).toBe(readyLeg);
    expect(calculateRoute).not.toHaveBeenCalled();
  });

  it('does not retry failed route legs during ordinary reconciliation', async () => {
    const origin = createDestination({
      name: 'Ghent',
      coordinates: { lat: 51.0538, lng: 3.725 },
    });
    const middle = createDestination({
      name: 'Hamburg',
      coordinates: { lat: 53.5502, lng: 10.0013 },
    });
    const target = createDestination({
      name: 'Copenhagen',
      coordinates: { lat: 55.6761, lng: 12.5683 },
    });
    const failedLeg = createRouteLeg({
      originDestinationId: origin.id,
      targetDestinationId: middle.id,
      type: 'driving-auto',
      status: 'failed',
      error: 'Load failed',
      routeKey: createRouteKey({ origin: origin.coordinates, target: middle.coordinates }),
    });
    const repository = createRepository([failedLeg]);
    const calculateRoute = vi.fn(async ({ origin: routeOrigin, target: routeTarget }) => ({
      distanceKm: 330,
      travelTimeHours: 4.5,
      geometry: {
        type: 'LineString' as const,
        coordinates: [
          [routeOrigin.lng, routeOrigin.lat],
          [routeTarget.lng, routeTarget.lat],
        ],
      },
      provider: 'test',
      profile: 'driving-car' as const,
    }));

    const routeLegs = await reconcileAndSaveRouteLegs({
      destinations: [origin, middle, target],
      currentRouteLegs: [failedLeg],
      repository,
      calculateRoute,
    });

    expect(calculateRoute).toHaveBeenCalledTimes(1);
    expect(calculateRoute).toHaveBeenCalledWith({
      origin: middle.coordinates,
      target: target.coordinates,
      profile: 'driving-car',
    });
    expect(routeLegs[0]).toBe(failedLeg);
    expect(routeLegs[0]).toMatchObject({ status: 'failed', error: 'Load failed' });
    expect(routeLegs[1]).toMatchObject({ status: 'ready' });
  });
});
