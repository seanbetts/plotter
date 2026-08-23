import { validateLocalWebContext } from '@local-web/ui';
import { describe, expect, it, vi } from 'vitest';
import type { PlotterApiClient } from './api/client';
import type { TripContextReadResponse } from './api/contracts';
import { createPlotterContextExportBuilder } from './contextExport';

const OBSERVED_AT = '2026-08-23T18:00:00.000Z';

function tripContextSnapshot(): TripContextReadResponse {
  return {
    directoryRevision: 7,
    tripRevision: 12,
    trip: {
      id: 'trip-north',
      name: 'Northern loop',
      description: 'Follow winter light and ferry crossings.',
      createdAt: '2026-08-01T09:00:00.000Z',
      updatedAt: '2026-08-22T16:30:00.000Z',
      routingVehicle: {
        preset: 'large-camper',
        profile: 'driving-car',
        restrictions: { length: 7.5, height: 3.2, weight: 5 },
      },
    },
    destinations: [{
      id: 'destination-tromso',
      name: 'Tromso',
      countryRegion: 'Troms, Norway',
      coordinates: { lat: 69.6492, lng: 18.9553 },
      location: {
        placeName: 'Tromso',
        regionName: 'Troms',
        countryName: 'Norway',
        countryCode: 'NO',
        sourceLabel: 'Tromso, Norway',
        sourceProvider: 'maptiler',
        sourceFeatureId: 'place.tromso',
      },
      order: 0,
      status: 'planned',
      priority: 'must-do',
      timing: {
        idealMonths: ['January', 'February'],
        expectedStayDays: 3,
        provisionalStartDate: '2027-01-10',
        provisionalEndDate: '2027-01-13',
      },
      why: {
        summary: 'Arctic city base',
        highlights: 'Aurora and cable car',
        personalRationale: 'A practical first northern stop.',
      },
      research: {
        notes: 'Check winter timetables.',
        links: [{
          id: 'link-ferry',
          title: 'Ferry timetable',
          url: 'https://research.example/ferry',
          domain: 'research.example',
          sortOrder: 0,
          previewFetchedAt: '2026-08-20T09:00:00.000Z',
        }],
        bookReferences: [{
          id: 'book-1',
          source: 'Other',
          reference: 'Arctic routes, p. 42',
          note: 'Winter access notes',
        }],
      },
      routeContext: {
        previousNextNotes: 'Arrive from Narvik.',
        drivingNotes: 'Expect winter roads.',
        borderShippingNotes: '',
        notes: 'Fuel before departure.',
      },
      tags: ['arctic', 'winter'],
      createdAt: '2026-08-02T09:00:00.000Z',
      updatedAt: '2026-08-21T10:00:00.000Z',
    }, {
      id: 'destination-alta',
      name: 'Alta',
      countryRegion: 'Finnmark, Norway',
      coordinates: { lat: 69.9689, lng: 23.2716 },
      location: {
        placeName: 'Alta',
        regionName: 'Finnmark',
        countryName: 'Norway',
        sourceLabel: 'Alta, Norway',
        sourceProvider: 'legacy',
      },
      order: 1,
      status: 'idea',
      priority: 'medium',
      timing: {
        idealMonths: [],
        expectedStayDays: 2,
        provisionalStartDate: '',
        provisionalEndDate: '',
      },
      why: { summary: '', highlights: '', personalRationale: '' },
      research: { notes: '', links: [], bookReferences: [] },
      routeContext: {
        previousNextNotes: '',
        drivingNotes: '',
        borderShippingNotes: '',
        notes: '',
      },
      tags: [],
      createdAt: '2026-08-03T09:00:00.000Z',
      updatedAt: '2026-08-03T09:00:00.000Z',
    }],
    activities: [{
      id: 'activity-cable-car',
      destinationId: 'destination-tromso',
      order: 0,
      title: 'Fjellheisen',
      description: 'Cable car viewpoint',
      category: 'outdoors',
      status: 'booked',
      priority: 'high',
      location: {
        name: 'Fjellheisen',
        address: 'Sollivegen 12',
        coordinates: { lat: 69.6389, lng: 18.9675 },
        sourceProvider: 'maptiler',
        sourceFeatureId: 'poi.fjellheisen',
      },
      links: [{
        id: 'link-tickets',
        title: 'Official tickets',
        url: 'https://research.example/tickets',
        domain: 'research.example',
        sortOrder: 0,
      }],
      notes: 'Book the sunset slot.',
      tags: ['viewpoint'],
      createdAt: '2026-08-10T10:00:00.000Z',
      updatedAt: '2026-08-20T10:00:00.000Z',
    }],
    routeLegs: [{
      id: 'leg-tromso-alta',
      originDestinationId: 'destination-tromso',
      targetDestinationId: 'destination-alta',
      movement: 'drive',
      calculation: 'automatic',
      ferryPolicy: 'require',
      waypoints: [{
        id: 'waypoint-fuel',
        order: 0,
        name: 'Fuel stop',
        coordinates: { lat: 69.7, lng: 19.1 },
        location: {
          placeName: 'Fuel stop',
          regionName: 'Troms',
          countryName: 'Norway',
          sourceLabel: 'Fuel stop',
          sourceProvider: 'legacy',
        },
        notes: 'Top up before the plateau.',
        links: [],
      }],
      sections: [
        { kind: 'road', startGeometryIndex: 0, endGeometryIndex: 10, distanceKm: 280 },
        { kind: 'ferry', startGeometryIndex: 10, endGeometryIndex: 12, distanceKm: 25 },
      ],
      warnings: [{
        code: 'FERRY_REQUIRED_NOT_FOUND',
        message: 'Review ferry availability.',
      }],
      status: 'review-required',
      distanceKm: 305,
      travelTimeHours: 5.5,
      provider: 'openrouteservice',
      profile: 'driving-car',
      calculatedAt: '2026-08-21T11:00:00.000Z',
      notes: 'Confirm the winter ferry.',
      createdAt: '2026-08-11T10:00:00.000Z',
      updatedAt: '2026-08-21T11:00:00.000Z',
    }, {
      id: 'leg-alta-return',
      originDestinationId: 'destination-alta',
      targetDestinationId: 'destination-tromso',
      movement: 'vehicle-shipping',
      calculation: 'manual',
      ferryPolicy: 'allow',
      waypoints: [],
      sections: [],
      warnings: [],
      status: 'manual',
      notes: '',
      createdAt: '2026-08-12T10:00:00.000Z',
      updatedAt: '2026-08-12T10:00:00.000Z',
    }],
  };
}

function clientReturning(snapshot = tripContextSnapshot()) {
  return testClient(async () => snapshot);
}

function testClient(request: () => Promise<unknown>) {
  const requestMock = vi.fn(request);
  return {
    request: requestMock,
    upload: vi.fn(),
  } as unknown as PlotterApiClient & { request: typeof requestMock };
}

describe('Plotter context export', () => {
  it('builds one valid sensitive active-trip snapshot with cancellable trip-first provenance', async () => {
    const client = clientReturning();
    const signal = new AbortController().signal;
    const buildContextExport = createPlotterContextExportBuilder({
      client,
      activeTripId: 'trip-north',
      selectedDestinationId: 'destination-tromso',
      selectedActivityId: 'activity-cable-car',
      itineraryCollapsed: false,
      now: () => new Date(OBSERVED_AT),
    });

    const context = await buildContextExport({ signal });

    expect(validateLocalWebContext(context)).toBe(context);
    expect(client.request).toHaveBeenCalledTimes(1);
    expect(client.request).toHaveBeenCalledWith('/api/v1/trips/trip-north/context', { signal });
    expect(context).toMatchObject({
      schema: 'local-web-context/v1',
      app: {
        id: 'plotter',
        name: 'Plotter',
        version: '0.0.0',
        sourceRevision: 'unknown',
      },
      context: {
        title: 'Trip: Northern loop',
        activeRoute: '/plotter',
        generatedAt: OBSERVED_AT,
        observedAt: OBSERVED_AT,
        dataRevision: 'trip:12;directory:7',
      },
      sensitivity: {
        classification: 'sensitive',
        notice: 'This document contains personal travel plans. Share it deliberately.',
      },
      provenance: {
        sources: expect.arrayContaining([
          expect.objectContaining({
            label: 'Canonical Plotter service snapshot',
            observedAt: OBSERVED_AT,
            revision: 'trip:12;directory:7',
          }),
          expect.objectContaining({ label: 'Trip directory', revision: '7' }),
          expect.objectContaining({ label: 'Active trip', revision: '12' }),
        ]),
      },
    });
  });

  it('maps ordered trip evidence and keeps unknown values and prohibited details out', async () => {
    const buildContextExport = createPlotterContextExportBuilder({
      client: clientReturning(),
      activeTripId: 'trip-north',
      selectedDestinationId: 'destination-tromso',
      selectedActivityId: 'activity-cable-car',
      itineraryCollapsed: false,
      now: () => new Date(OBSERVED_AT),
    });

    const context = await buildContextExport({ signal: new AbortController().signal });

    expect(context.summary).toContain('2 destinations');
    expect(context.summary).toContain('1 activity');
    expect(context.summary).toContain('2 route legs');
    expect(context.data).toMatchObject({
      trip: {
        id: 'trip-north',
        name: 'Northern loop',
        description: 'Follow winter light and ferry crossings.',
        routingVehicle: {
          preset: 'large-camper',
          profile: 'driving-car',
          vehicleType: null,
          restrictions: { length: 7.5, height: 3.2, weight: 5 },
        },
        destinationCount: 2,
        activityCount: 1,
        routeLegCount: 2,
        totalKnownDistanceKm: 305,
        totalKnownTravelTimeHours: 5.5,
        countriesRegions: ['Troms, Norway', 'Finnmark, Norway'],
        provisionalDateRange: { start: '2027-01-10', end: '2027-01-13' },
      },
      destinations: [
        expect.objectContaining({
          id: 'destination-tromso',
          name: 'Tromso',
          order: 0,
          status: 'planned',
          priority: 'must-do',
          coordinates: { lat: 69.6492, lng: 18.9553 },
          location: expect.objectContaining({ countryCode: 'NO', sourceFeatureId: 'place.tromso' }),
          timing: expect.objectContaining({
            provisionalStartDate: '2027-01-10',
            provisionalEndDate: '2027-01-13',
          }),
          rationale: expect.objectContaining({
            personal: 'A practical first northern stop.',
          }),
          research: expect.objectContaining({
            notes: 'Check winter timetables.',
            links: [expect.objectContaining({
              title: 'Ferry timetable',
              domain: 'research.example',
              url: 'https://research.example/ferry',
              order: 0,
              previewFetchedAt: '2026-08-20T09:00:00.000Z',
            })],
          }),
          routeContext: expect.objectContaining({ drivingNotes: 'Expect winter roads.' }),
        }),
        expect.objectContaining({
          id: 'destination-alta',
          name: 'Alta',
          order: 1,
          timing: expect.objectContaining({
            provisionalStartDate: null,
            provisionalEndDate: null,
          }),
        }),
      ],
      activities: [expect.objectContaining({
        id: 'activity-cable-car',
        destinationId: 'destination-tromso',
        destinationName: 'Tromso',
        title: 'Fjellheisen',
        status: 'booked',
        priority: 'high',
        location: expect.objectContaining({ address: 'Sollivegen 12' }),
        notes: 'Book the sunset slot.',
        links: [expect.objectContaining({
          title: 'Official tickets',
          domain: 'research.example',
          url: 'https://research.example/tickets',
        })],
      })],
      routeLegs: [
        expect.objectContaining({
          id: 'leg-tromso-alta',
          origin: { id: 'destination-tromso', name: 'Tromso' },
          destination: { id: 'destination-alta', name: 'Alta' },
          movement: 'drive',
          calculation: 'automatic',
          ferryPolicy: 'require',
          status: 'review-required',
          distanceKm: 305,
          travelTimeHours: 5.5,
          sections: [{ kind: 'road', distanceKm: 280 }, { kind: 'ferry', distanceKm: 25 }],
          warnings: [{ code: 'FERRY_REQUIRED_NOT_FOUND', message: 'Review ferry availability.', context: null }],
          notes: 'Confirm the winter ferry.',
        }),
        expect.objectContaining({
          id: 'leg-alta-return',
          movement: 'vehicle-shipping',
          calculation: 'manual',
          status: 'manual',
          distanceKm: null,
          travelTimeHours: null,
          calculatedAt: null,
        }),
      ],
    });
    expect(context.decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        statement: expect.stringContaining('Tromso'),
        reasoning: 'A practical first northern stop.',
      }),
      expect.objectContaining({
        statement: expect.stringContaining('Fjellheisen'),
        reasoning: 'Book the sunset slot.',
      }),
      expect.objectContaining({
        statement: expect.stringContaining('leg-tromso-alta'),
        reasoning: 'Confirm the winter ferry.',
      }),
      expect.objectContaining({
        statement: expect.stringContaining('leg-alta-return'),
        reasoning: 'The choice is recorded but its rationale is not.',
      }),
    ]));
    expect(context.caveats).toEqual(expect.arrayContaining([
      expect.stringContaining('Failed, manual or review-required'),
      expect.stringContaining('Research links are not revalidated'),
    ]));
    expect(context.omissions).toEqual(expect.arrayContaining([
      expect.stringContaining('all media and map images'),
      expect.stringContaining('full route geometry'),
      expect.stringContaining('Supabase and migration data'),
      expect.stringContaining('service ports, hostnames and serving origins'),
    ]));
    const serialized = JSON.stringify(context);
    expect(serialized).not.toMatch(/"(?:startGeometryIndex|endGeometryIndex|geometry|routeKey|providerDiagnostic|imageUrl|thumbnailUrl|previewUrl|fullUrl|bucketId|objectPath)"\s*:/i);
    expect(serialized).not.toMatch(/(?:file:\/\/|\/(?:Users|home|private|tmp|var|Volumes)\/|[a-z]:\\)/i);
  });

  it('sanitizes non-cancellation failures from the context snapshot request', async () => {
    const client = testClient(async () => {
        throw new Error('SQLite failed at /Users/example/private/plotter.sqlite3 with provider-key');
    });
    const buildContextExport = createPlotterContextExportBuilder({
      client,
      activeTripId: 'trip-north',
      selectedDestinationId: null,
      selectedActivityId: null,
      itineraryCollapsed: false,
    });

    let caught: unknown;
    try {
      await buildContextExport({ signal: new AbortController().signal });
    } catch (error) {
      caught = error;
    }

    expect(caught).toEqual(new Error('Plotter context could not load the active trip snapshot.'));
    expect(String(caught)).not.toMatch(/Users|sqlite|provider-key/i);
  });

  it('preserves cancellation from the shared export action', async () => {
    const aborted = new DOMException('The operation was aborted.', 'AbortError');
    const client = testClient(async () => { throw aborted; });
    const controller = new AbortController();
    const buildContextExport = createPlotterContextExportBuilder({
      client,
      activeTripId: 'trip-north',
      selectedDestinationId: null,
      selectedActivityId: null,
      itineraryCollapsed: false,
    });

    await expect(buildContextExport({ signal: controller.signal })).rejects.toBe(aborted);
    expect(client.request).toHaveBeenCalledWith('/api/v1/trips/trip-north/context', {
      signal: controller.signal,
    });
  });

  it('changes only active context when the stable destination and activity selection changes', async () => {
    const first = await createPlotterContextExportBuilder({
      client: clientReturning(),
      activeTripId: 'trip-north',
      selectedDestinationId: 'destination-tromso',
      selectedActivityId: 'activity-cable-car',
      itineraryCollapsed: false,
      now: () => new Date(OBSERVED_AT),
    })({ signal: new AbortController().signal });
    const second = await createPlotterContextExportBuilder({
      client: clientReturning(),
      activeTripId: 'trip-north',
      selectedDestinationId: 'destination-alta',
      selectedActivityId: null,
      itineraryCollapsed: true,
      now: () => new Date(OBSERVED_AT),
    })({ signal: new AbortController().signal });

    expect(first.data.trip).toEqual(second.data.trip);
    expect(first.data.destinations).toEqual(second.data.destinations);
    expect(first.data.activities).toEqual(second.data.activities);
    expect(first.data.routeLegs).toEqual(second.data.routeLegs);
    expect(first.data.activeContext).toMatchObject({
      selectedDestination: { id: 'destination-tromso', name: 'Tromso' },
      selectedActivity: {
        id: 'activity-cable-car',
        title: 'Fjellheisen',
        destinationId: 'destination-tromso',
      },
      itineraryCollapsed: false,
      visibleDetailContext: 'activity',
    });
    expect(second.data.activeContext).toMatchObject({
      selectedDestination: { id: 'destination-alta', name: 'Alta' },
      selectedActivity: null,
      itineraryCollapsed: true,
      visibleDetailContext: 'destination',
    });
  });
});
