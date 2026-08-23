import { readFile } from 'node:fs/promises';
import { validateLocalWebContext } from '@local-web/ui';
import type { APIRequestContext, Download, Page } from '@playwright/test';
import { expect, gotoServiceApp, test } from './fixtures';

const CLOSED_EXPORT_CSP = "default-src 'none'; connect-src 'none'; img-src 'none'; font-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; script-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";

type ContextDocument = {
  schema: string;
  context: { dataRevision: string };
  sensitivity: { classification: string; notice: string };
  data: {
    activeContext: {
      selectedDestination: { id: string; name: string } | null;
      selectedActivity: { id: string; title: string; destinationId: string } | null;
      visibleDetailContext: string;
    };
    trip: Record<string, unknown>;
    destinations: Array<Record<string, unknown>>;
    activities: Array<Record<string, unknown>>;
    routeLegs: Array<Record<string, unknown>>;
  };
  provenance: { sources: Array<{ label: string; revision: string | null }> };
  omissions: string[];
};

async function seedContextTrip(request: APIRequestContext) {
  const timestamp = '2026-08-23T12:00:00.000Z';
  const directoryResponse = await request.get('/plotter/api/v1/trips');
  expect(directoryResponse.ok()).toBe(true);
  const directory = await directoryResponse.json() as {
    revision: number;
    trips: Array<{ id: string }>;
  };
  expect(directory.trips).toHaveLength(1);
  const tripId = directory.trips[0]!.id;
  const updateResponse = await request.patch(`/plotter/api/v1/trips/${encodeURIComponent(tripId)}`, {
    headers: { 'x-plotter-write': '1' },
    data: {
      expectedRevision: directory.revision,
      patch: {
        name: 'Northern context loop',
        description: 'A winter route with recorded ferry research.',
        routingVehicle: {
          preset: 'large-camper',
          profile: 'driving-hgv',
          vehicleType: 'hgv',
          restrictions: { length: 7.5, height: 3.2, weight: 5 },
        },
      },
    },
  });
  expect(updateResponse.ok(), await updateResponse.text()).toBe(true);

  const location = (placeName: string, regionName: string) => ({
    placeName,
    regionName,
    countryName: 'Norway',
    countryCode: 'no',
    sourceLabel: `${placeName}, Norway`,
    sourceProvider: 'maptiler' as const,
  });
  const destination = (
    id: string,
    name: string,
    order: number,
    coordinates: { lat: number; lng: number },
  ) => ({
    id,
    name,
    countryRegion: 'Norway',
    coordinates,
    routingAnchors: {
      'driving-hgv': {
        profile: 'driving-hgv',
        coordinates,
        originalCoordinates: coordinates,
        snapDistanceKm: 0.25,
        provider: 'openrouteservice',
        resolvedAt: timestamp,
      },
    },
    location: location(name, order === 0 ? 'Troms' : 'Finnmark'),
    order,
    status: order === 0 ? 'confirmed' : 'planned',
    priority: order === 0 ? 'must-do' : 'high',
    timing: {
      idealMonths: ['January'],
      expectedStayDays: order === 0 ? 3 : 2,
      provisionalStartDate: order === 0 ? '2027-01-10' : '2027-01-14',
      provisionalEndDate: order === 0 ? '2027-01-13' : '2027-01-16',
    },
    why: {
      summary: order === 0 ? 'Arctic city base' : 'Northern plateau base',
      highlights: order === 0 ? 'Aurora and cable car' : 'Winter light',
      personalRationale: order === 0 ? 'A practical first northern stop.' : '',
    },
    media: order === 0 ? [{
      id: 'private-photo',
      url: 'http://127.0.0.1:5175/api/v1/private-image',
      previewUrl: 'blob:private-preview',
      fullUrl: 'file:///Users/example/private/tromso.jpg',
      caption: 'Private photo',
      credit: 'Personal',
      bucketId: 'private-bucket',
      objectPath: 'private/object.jpg',
    }] : [],
    research: {
      notes: order === 0 ? 'Check winter timetables.' : '',
      links: order === 0 ? [{
        id: 'ferry-research',
        title: 'Official ferry timetable',
        url: 'https://research.example/ferry',
        domain: 'research.example',
        imageUrl: 'https://private-media.invalid/ferry.jpg',
        sortOrder: 0,
        previewFetchedAt: timestamp,
      }] : [],
      bookReferences: order === 0 ? [{
        id: 'arctic-book',
        source: 'Other',
        reference: 'Arctic routes, p. 42',
        note: 'Winter access notes',
      }] : [],
    },
    activities: { items: [] },
    routeContext: {
      previousNextNotes: order === 0 ? 'Arrive from Narvik.' : '',
      drivingNotes: order === 0 ? 'Expect winter roads.' : '',
      borderShippingNotes: '',
      notes: order === 0 ? 'Fuel before departure.' : '',
    },
    tags: order === 0 ? ['arctic', 'winter'] : [],
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const tromso = destination('tromso', 'Tromso', 0, { lat: 69.6492, lng: 18.9553 });
  const alta = destination('alta', 'Alta', 1, { lat: 69.9689, lng: 23.2716 });
  const activity = {
    id: 'fjellheisen',
    destinationId: 'tromso',
    order: 0,
    title: 'Fjellheisen sunset',
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
      id: 'tickets',
      title: 'Official tickets',
      url: 'https://research.example/tickets',
      domain: 'research.example',
      imageUrl: 'https://private-media.invalid/activity.jpg',
      sortOrder: 0,
    }],
    notes: 'Book the sunset slot.',
    tags: ['viewpoint'],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const routeLeg = {
    id: 'tromso-alta',
    originDestinationId: 'tromso',
    targetDestinationId: 'alta',
    movement: 'drive',
    calculation: 'automatic',
    ferryPolicy: 'require',
    waypoints: [{
      id: 'fuel-stop',
      order: 0,
      name: 'Fuel stop',
      coordinates: { lat: 69.7, lng: 19.1 },
      location: location('Fuel stop', 'Troms'),
      notes: 'Top up before the plateau.',
      links: [],
    }],
    sections: [{ kind: 'road', startGeometryIndex: 0, endGeometryIndex: 2, distanceKm: 305 }],
    warnings: [{ code: 'FERRY_REQUIRED_NOT_FOUND', message: 'Review ferry availability.' }],
    status: 'review-required',
    distanceKm: 305,
    travelTimeHours: 5.5,
    geometry: { type: 'LineString', coordinates: [[18.9553, 69.6492], [23.2716, 69.9689]] },
    provider: 'openrouteservice',
    profile: 'driving-hgv',
    routeKey: 'provider-request-secret',
    calculatedAt: timestamp,
    error: '/Users/example/private/provider-error.json',
    providerDiagnostic: {
      provider: 'openrouteservice',
      httpStatus: 400,
      providerMessage: 'private-provider-response',
    },
    notes: 'Confirm the winter ferry.',
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const snapshotResponse = await request.get(`/plotter/api/v1/trips/${encodeURIComponent(tripId)}`);
  expect(snapshotResponse.ok()).toBe(true);
  const snapshot = await snapshotResponse.json() as { revision: number };
  const seedResponse = await request.post(`/plotter/api/v1/trips/${encodeURIComponent(tripId)}/mutations`, {
    headers: { 'x-plotter-write': '1' },
    data: {
      expectedRevision: snapshot.revision,
      mutation: {
        type: 'replace-trip-data',
        snapshot: { destinations: [tromso, alta], routeLegs: [routeLeg], activities: [activity] },
      },
    },
  });
  expect(seedResponse.ok(), await seedResponse.text()).toBe(true);

  const expectedContextResponse = await request.get(
    `/plotter/api/v1/trips/${encodeURIComponent(tripId)}/context`,
  );
  expect(expectedContextResponse.ok()).toBe(true);
  const expectedSnapshot = await expectedContextResponse.json() as {
    directoryRevision: number;
    tripRevision: number;
  };
  return { tripId, expectedSnapshot };
}

async function readContextDownload(download: Download) {
  const path = await download.path();
  if (!path) throw new Error('Context download did not produce a local artifact.');
  const bytes = await readFile(path);
  const html = bytes.toString('utf8');
  const jsonMatch = html.match(
    /<script type="application\/json" data-context-export-json>([\s\S]*?)<\/script>/,
  );
  if (!jsonMatch?.[1]) throw new Error('Context download did not contain its JSON payload.');
  return {
    byteLength: bytes.byteLength,
    html,
    context: JSON.parse(jsonMatch[1]) as ContextDocument,
  };
}

async function downloadContext(page: Page) {
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export context' }).click();
  return readContextDownload(await downloadPromise);
}

test('downloads one closed, coherent trip context snapshot without provider traffic', async ({ page, request }) => {
  const { tripId, expectedSnapshot } = await seedContextTrip(request);
  const navigation = await gotoServiceApp(page, { waitUntil: 'domcontentloaded' });
  expect(navigation?.ok()).toBe(true);
  await expect(page.getByRole('button', { name: 'Export context' })).toBeVisible();
  await expect(page.getByRole('button', { name: /current trip: Northern context loop/i })).toBeVisible();

  const observedRequests: string[] = [];
  const onRequest = (requestEvent: { url(): string }) => observedRequests.push(requestEvent.url());
  page.on('request', onRequest);
  const first = await downloadContext(page);
  page.off('request', onRequest);

  expect(first.byteLength).toBeLessThan(5 * 1024 * 1024);
  expect(validateLocalWebContext(first.context)).toBe(first.context);
  expect(first.context).toMatchObject({
    schema: 'local-web-context/v1',
    context: {
      dataRevision: `trip:${expectedSnapshot.tripRevision};directory:${expectedSnapshot.directoryRevision}`,
    },
    sensitivity: {
      classification: 'sensitive',
      notice: expect.stringContaining('personal travel plans'),
    },
    data: {
      activeContext: {
        selectedDestination: null,
        selectedActivity: null,
        visibleDetailContext: 'trip',
      },
      trip: {
        id: tripId,
        name: 'Northern context loop',
        destinationCount: 2,
        activityCount: 1,
        routeLegCount: 1,
        totalKnownDistanceKm: 305,
        totalKnownTravelTimeHours: 5.5,
      },
      destinations: [
        expect.objectContaining({
          id: 'tromso',
          name: 'Tromso',
          research: expect.objectContaining({
            notes: 'Check winter timetables.',
            links: [expect.objectContaining({ url: 'https://research.example/ferry' })],
          }),
        }),
        expect.objectContaining({ id: 'alta', name: 'Alta' }),
      ],
      activities: [expect.objectContaining({
        id: 'fjellheisen',
        title: 'Fjellheisen sunset',
        notes: 'Book the sunset slot.',
      })],
      routeLegs: [expect.objectContaining({
        id: 'tromso-alta',
        ferryPolicy: 'require',
        distanceKm: 305,
        warnings: [{ code: 'FERRY_REQUIRED_NOT_FOUND', message: 'Review ferry availability.', context: null }],
      })],
    },
  });
  expect(first.context.provenance.sources).toEqual(expect.arrayContaining([
    expect.objectContaining({ label: 'Trip directory', revision: String(expectedSnapshot.directoryRevision) }),
    expect.objectContaining({ label: 'Active trip', revision: String(expectedSnapshot.tripRevision) }),
  ]));
  expect(first.context.omissions).toEqual(expect.arrayContaining([
    expect.stringContaining('all media and map images'),
    expect.stringContaining('full route geometry'),
    expect.stringContaining('Supabase and migration data'),
    expect.stringContaining('service ports, hostnames and serving origins'),
  ]));

  const contextRequests = observedRequests.filter((url) => (
    new URL(url).pathname === `/plotter/api/v1/trips/${encodeURIComponent(tripId)}/context`
  ));
  const externalRequests = observedRequests.filter((url) => new URL(url).origin !== 'http://127.0.0.1:5174');
  expect(contextRequests).toHaveLength(1);
  expect(externalRequests).toEqual([]);

  const cspMatch = first.html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
  expect(cspMatch?.[1]).toBe(CLOSED_EXPORT_CSP);
  expect(first.html).toContain('This is a static snapshot. Changes do not sync to the source app.');
  const serialized = JSON.stringify(first.context);
  expect(serialized).not.toMatch(/(?:provider-request-secret|private-provider-response|private-media|private-bucket|private\/object|blob:private|127\.0\.0\.1|file:\/\/|\/Users\/|supabase\.co|anon-key)/i);
  expect(serialized).not.toMatch(/"(?:media|routingAnchors|geometry|routeKey|providerDiagnostic|error|imageUrl|thumbnailUrl|previewUrl|fullUrl|bucketId|objectPath)"\s*:/i);

  await page.getByRole('button', { name: 'Open Tromso stop details' }).click();
  const activitySelection = page.getByRole('button', { name: 'Select activity Fjellheisen sunset' });
  await activitySelection.focus();
  await activitySelection.press('Enter');
  await expect(page.getByRole('complementary', { name: 'Fjellheisen sunset activity' })).toBeVisible();
  const secondObservedRequests: string[] = [];
  const onSecondRequest = (requestEvent: { url(): string }) => secondObservedRequests.push(requestEvent.url());
  page.on('request', onSecondRequest);
  const second = await downloadContext(page);
  page.off('request', onSecondRequest);

  expect(secondObservedRequests.filter((url) => (
    new URL(url).pathname === `/plotter/api/v1/trips/${encodeURIComponent(tripId)}/context`
  ))).toHaveLength(1);
  expect(secondObservedRequests.filter((url) => new URL(url).origin !== 'http://127.0.0.1:5174')).toEqual([]);
  expect(second.context.data.activeContext).toEqual({
    route: '/plotter',
    trip: { id: tripId, name: 'Northern context loop' },
    selectedDestination: { id: 'tromso', name: 'Tromso' },
    selectedActivity: { id: 'fjellheisen', title: 'Fjellheisen sunset', destinationId: 'tromso' },
    itineraryCollapsed: false,
    visibleDetailContext: 'activity',
  });
  expect(second.context.data.trip).toEqual(first.context.data.trip);
  expect(second.context.data.destinations).toEqual(first.context.data.destinations);
  expect(second.context.data.activities).toEqual(first.context.data.activities);
  expect(second.context.data.routeLegs).toEqual(first.context.data.routeLegs);
});
