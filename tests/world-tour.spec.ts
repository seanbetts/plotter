import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';

async function stableCanvasPixels(canvas: Locator) {
  let previousHash: string | null = null;
  let matchingSamples = 0;
  let stablePixelHash = '';

  await expect.poll(async () => {
    stablePixelHash = await canvas.evaluate(async (element: HTMLCanvasElement) => {
      const bytes = new TextEncoder().encode(element.toDataURL('image/png'));
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    });
    matchingSamples = stablePixelHash === previousHash ? matchingSamples + 1 : 1;
    previousHash = stablePixelHash;
    return matchingSamples;
  }, {
    message: 'live map canvas pixels should settle for five consecutive samples',
    timeout: 15_000,
    intervals: [250, 500],
  }).toBeGreaterThanOrEqual(5);

  return stablePixelHash;
}

const savedTags = ['gateway', 'asia'];
const istanbulResult = [
  {
    id: 'place.istanbul',
    text: 'Istanbul',
    place_name: 'Istanbul, Turkey',
    center: [28.9784, 41.0082],
    properties: { country_code: 'tr' },
    context: [{ id: 'country.1', text: 'Turkey', short_code: 'tr' }],
  },
];

const parisResult = [
  {
    id: 'place.paris',
    text: 'Paris',
    place_name: 'Paris, France',
    center: [2.3522, 48.8566],
    properties: { country_code: 'fr' },
    context: [{ id: 'country.1', text: 'France', short_code: 'fr' }],
  },
];

async function seedNordkappExpedition(page: Page) {
  const timestamp = '2026-07-11T10:00:00.000Z';
  const tripId = await page.evaluate(async () => {
    const request = indexedDB.open('world-tour-planner');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = db.transaction('trips', 'readonly');
    const tripsRequest = transaction.objectStore('trips').getAll();
    const trips = await new Promise<Array<{ id: string; name: string }>>((resolve, reject) => {
      tripsRequest.onsuccess = () => resolve(tripsRequest.result);
      tripsRequest.onerror = () => reject(tripsRequest.error);
    });
    db.close();

    const trip = trips.find((candidate) => candidate.name === 'Nordkapp Expedition');
    if (!trip) throw new Error('Nordkapp Expedition trip was not created.');
    return trip.id;
  });

  const location = (placeName: string, countryName: string, countryCode: string) => ({
    placeName,
    regionName: '',
    countryName,
    countryCode,
    sourceLabel: `${placeName}, ${countryName}`,
    sourceProvider: 'maptiler' as const,
  });
  const destination = (
    id: string,
    name: string,
    countryName: string,
    countryCode: string,
    order: number,
    coordinates: { lat: number; lng: number },
  ) => ({
    id: `${tripId}:${id}`,
    entityId: id,
    tripId,
    name,
    countryRegion: countryName,
    coordinates,
    location: location(name, countryName, countryCode),
    order,
    status: 'planned',
    priority: 'medium',
    timing: { idealMonths: [], expectedStayDays: 2, provisionalStartDate: '', provisionalEndDate: '' },
    why: { summary: '', highlights: '', personalRationale: '' },
    media: [],
    research: { notes: '', links: [], bookReferences: [] },
    activities: { items: [] },
    routeContext: { previousNextNotes: '', drivingNotes: '', borderShippingNotes: '', notes: '' },
    tags: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const hamburg = destination('hamburg', 'Hamburg', 'Germany', 'de', 0, { lat: 53.5511, lng: 9.9937 });
  const hirtshals = destination('hirtshals', 'Hirtshals', 'Denmark', 'dk', 1, { lat: 57.5881, lng: 9.9592 });
  const nordkapp = destination('nordkapp', 'Nordkapp', 'Norway', 'no', 2, { lat: 71.1725, lng: 25.784 });
  const routeLegs = [
    {
      id: `${tripId}:hamburg-hirtshals`,
      entityId: 'hamburg-hirtshals',
      tripId,
      originDestinationId: 'hamburg',
      targetDestinationId: 'hirtshals',
      movement: 'drive',
      calculation: 'automatic',
      ferryPolicy: 'allow',
      waypoints: [],
      sections: [{ kind: 'road', startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 520 }],
      warnings: [],
      status: 'ready',
      distanceKm: 520,
      travelTimeHours: 6.5,
      geometry: { type: 'LineString', coordinates: [[9.9937, 53.5511], [9.9592, 57.5881]] },
      provider: 'openrouteservice',
      profile: 'driving-hgv',
      routeKey: 'hamburg-hirtshals',
      calculatedAt: timestamp,
      notes: '',
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: `${tripId}:hirtshals-nordkapp`,
      entityId: 'hirtshals-nordkapp',
      tripId,
      originDestinationId: 'hirtshals',
      targetDestinationId: 'nordkapp',
      movement: 'drive',
      calculation: 'automatic',
      ferryPolicy: 'require',
      waypoints: [{
        id: 'waypoint-bodo',
        order: 0,
        name: 'Bodø ferry terminal',
        coordinates: { lat: 67.2804, lng: 14.4049 },
        location: location('Bodø ferry terminal', 'Norway', 'no'),
        notes: 'Required ferry connection.',
        links: [],
      }],
      sections: [
        { kind: 'road', startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 850 },
        { kind: 'ferry', startGeometryIndex: 1, endGeometryIndex: 2, distanceKm: 95 },
        { kind: 'road', startGeometryIndex: 2, endGeometryIndex: 3, distanceKm: 1_250 },
      ],
      warnings: [{ code: 'SUSPICIOUS_DETOUR', message: 'Route is much longer than expected.' }],
      status: 'review-required',
      distanceKm: 2_195,
      travelTimeHours: 32,
      geometry: {
        type: 'LineString',
        coordinates: [[9.9592, 57.5881], [12.5, 65], [14.4049, 67.2804], [25.784, 71.1725]],
      },
      provider: 'openrouteservice',
      profile: 'driving-hgv',
      routeKey: 'hirtshals-nordkapp-required-ferry',
      calculatedAt: timestamp,
      notes: 'Keep the ferry connection.',
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ];

  await page.evaluate(async ({ destinations, routeLegs }) => {
    const request = indexedDB.open('world-tour-planner');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = db.transaction(['destinations', 'routeLegs'], 'readwrite');
    for (const record of destinations) transaction.objectStore('destinations').put(record);
    for (const record of routeLegs) transaction.objectStore('routeLegs').put(record);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    db.close();
  }, { destinations: [hamburg, hirtshals, nordkapp], routeLegs });
}

test('preserves Nordkapp routing intent and calculates both legs around an ordinary map stop', async ({ baseURL, context, page }) => {
  const origin = new URL(baseURL ?? 'http://127.0.0.1:5174').origin;
  const cdpSession = await context.newCDPSession(page);
  await cdpSession.send('Storage.clearDataForOrigin', { origin, storageTypes: 'indexeddb' });

  await page.route('https://api.maptiler.com/geocoding/**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: {
        features: [{
          id: 'place-map-stop',
          text: 'Aalborg',
          place_name: 'Aalborg, Denmark',
          center: [9.9217, 57.0488],
          properties: { country_code: 'dk' },
          context: [{ id: 'country.1', text: 'Denmark', short_code: 'dk' }],
        }],
      },
    });
  });
  await page.route('https://demotiles.maplibre.org/style.json', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: {
        version: 8,
        name: 'E2E blank map',
        sources: {},
        layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#dce7e7' } }],
      },
    });
  });
  const calculatedCoordinatePairs: number[][][] = [];
  await page.route('https://api.openrouteservice.org/v2/directions/**', async (route) => {
    const body = route.request().postDataJSON() as { coordinates: number[][] };
    calculatedCoordinatePairs.push(body.coordinates);
    const isExceptionalRoute = body.coordinates.length === 3;
    await route.fulfill({
      contentType: 'application/json',
      json: {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          properties: {
            summary: {
              distance: isExceptionalRoute ? 10_000_000 : 180_000,
              duration: isExceptionalRoute ? 144_000 : 10_800,
            },
            ...(isExceptionalRoute
              ? { extras: { waycategory: { values: [[1, 2, 8]] } } }
              : {}),
          },
          geometry: { type: 'LineString', coordinates: body.coordinates },
        }],
      },
    });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('Search for a destination')).toBeVisible();
  await page.getByRole('button', { name: 'New trip' }).click();
  await page.getByLabel('Trip name').fill('Nordkapp Expedition');
  await page.getByRole('button', { name: 'Create trip' }).click();
  await page.getByRole('button', { name: /current trip: Nordkapp Expedition/i }).click();
  await page.getByRole('menuitem', { name: 'Edit Nordkapp Expedition' }).click();
  await page.getByRole('button', { name: 'Expedition truck' }).click();
  await expect(page.getByRole('button', { name: 'Expedition truck' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Save trip' }).click();

  await seedNordkappExpedition(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: /current trip: Nordkapp Expedition/i })).toBeVisible();
  await expect(page.getByLabel('Route includes a ferry')).toBeVisible();
  await expect(page.getByLabel('1 route waypoint')).toBeVisible();
  await expect(page.getByLabel(/Route requires review/)).toBeVisible();

  await expect(page.getByRole('dialog', { name: /route settings/i })).toHaveCount(0);
  const mapContainer = page.getByTestId('map-container');
  await page.waitForTimeout(1_000);
  for (let zoomStep = 0; zoomStep < 3; zoomStep += 1) {
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await page.waitForTimeout(200);
  }
  const mapBox = await mapContainer.boundingBox();
  const hirtshalsLabel = page.getByRole('button', { name: 'Open Hirtshals stop details' });
  const hamburgLabel = page.getByRole('button', { name: 'Open Hamburg stop details' });
  await expect(hirtshalsLabel).toBeVisible();
  const hirtshalsLabelBox = await hirtshalsLabel.boundingBox();
  const hamburgLabelBox = await hamburgLabel.boundingBox();
  const hirtshalsLabelIsAbove = await hirtshalsLabel.evaluate((element) =>
    element.classList.contains('map-label-position-above'),
  );
  const hamburgLabelIsAbove = await hamburgLabel.evaluate((element) =>
    element.classList.contains('map-label-position-above'),
  );
  if (!mapBox || !hirtshalsLabelBox || !hamburgLabelBox) {
    throw new Error('Expected the map and projected route labels to have layout boxes.');
  }
  const projectedPoint = (
    box: NonNullable<typeof hirtshalsLabelBox>,
    isAbove: boolean,
  ) => ({
    x: box.x + box.width / 2,
    y: isAbove ? box.y + box.height + 14 : box.y - 14,
  });
  const hirtshalsPoint = projectedPoint(hirtshalsLabelBox, hirtshalsLabelIsAbove);
  const hamburgPoint = projectedPoint(hamburgLabelBox, hamburgLabelIsAbove);
  const directionLength = Math.hypot(hamburgPoint.x - hirtshalsPoint.x, hamburgPoint.y - hirtshalsPoint.y);
  const insertionPoint = {
    x: hirtshalsPoint.x + ((hamburgPoint.x - hirtshalsPoint.x) / directionLength) * 120,
    y: hirtshalsPoint.y + ((hamburgPoint.y - hirtshalsPoint.y) / directionLength) * 120,
  };
  const calculationCountBeforeInsertion = calculatedCoordinatePairs.length;
  await mapContainer.evaluate((element, point) => {
    element.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: point.clientX,
      clientY: point.clientY,
    }));
  }, {
    clientX: Math.round(insertionPoint.x),
    clientY: Math.round(insertionPoint.y),
  });
  await page.getByRole('menuitem', { name: 'Add stop here' }).click();
  const addStopDialog = page.getByRole('dialog', { name: 'Add stop from map' });
  await expect(addStopDialog).toBeVisible();
  await expect(addStopDialog.getByRole('heading', { name: 'Aalborg' })).toBeVisible();
  await addStopDialog.getByRole('button', { name: 'Add stop', exact: true }).click();

  await expect(page.getByRole('button', { name: 'Aalborg, Denmark' })).toBeVisible();
  await expect.poll(() =>
    calculatedCoordinatePairs
      .slice(calculationCountBeforeInsertion)
      .filter((coordinates) => coordinates.length === 2).length,
  ).toBeGreaterThanOrEqual(2);
  const adjacentCalculations = calculatedCoordinatePairs
    .slice(calculationCountBeforeInsertion)
    .filter((coordinates) => coordinates.length === 2);
  expect(adjacentCalculations.length).toBeGreaterThanOrEqual(2);
  expect(adjacentCalculations.every((coordinates) => coordinates.length === 2)).toBe(true);
  const readInsertedStopLegs = () => page.evaluate(async () => {
    const request = indexedDB.open('world-tour-planner');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = db.transaction(['destinations', 'routeLegs'], 'readonly');
    const destinationsRequest = transaction.objectStore('destinations').getAll();
    const routeLegsRequest = transaction.objectStore('routeLegs').getAll();
    const [destinations, routeLegs] = await Promise.all([
      new Promise<Array<{ entityId?: string; name: string }>>((resolve, reject) => {
        destinationsRequest.onsuccess = () => resolve(destinationsRequest.result);
        destinationsRequest.onerror = () => reject(destinationsRequest.error);
      }),
      new Promise<Array<{
        originDestinationId: string;
        targetDestinationId: string;
        movement: string;
        calculation?: string;
        status: string;
        provider?: string;
      }>>((resolve, reject) => {
        routeLegsRequest.onsuccess = () => resolve(routeLegsRequest.result);
        routeLegsRequest.onerror = () => reject(routeLegsRequest.error);
      }),
    ]);
    db.close();
    const aalborg = destinations.find((destination) => destination.name === 'Aalborg');
    if (!aalborg?.entityId) throw new Error('Expected persisted Aalborg stop.');
    const namesById = new Map(destinations.map((destination) => [destination.entityId, destination.name]));
    return routeLegs.filter((leg) =>
      leg.originDestinationId === aalborg.entityId || leg.targetDestinationId === aalborg.entityId,
    ).map((leg) => ({
      ...leg,
      originName: namesById.get(leg.originDestinationId),
      targetName: namesById.get(leg.targetDestinationId),
    })).sort((left) => left.originName === 'Hamburg' ? -1 : 1);
  });
  await expect.poll(async () => (await readInsertedStopLegs()).length).toBe(2);
  const insertedStopLegs = await readInsertedStopLegs();
  expect(insertedStopLegs).toHaveLength(2);
  expect(insertedStopLegs).toEqual([
    expect.objectContaining({
      originName: 'Hamburg',
      targetName: 'Aalborg',
      movement: 'drive',
      calculation: 'automatic',
      status: 'ready',
      provider: 'openrouteservice',
    }),
    expect.objectContaining({
      originName: 'Aalborg',
      targetName: 'Hirtshals',
      movement: 'drive',
      calculation: 'automatic',
      status: 'ready',
      provider: 'openrouteservice',
    }),
  ]);
  await expect(page.getByRole('dialog', { name: /route settings/i })).toHaveCount(0);
  await expect(page.getByLabel('Route includes a ferry')).toBeVisible();
  await expect(page.getByLabel('1 route waypoint')).toBeVisible();
  await expect(page.getByLabel(/Route requires review/)).toBeVisible();
});

test('downloads a map-only PNG', async ({ baseURL, context, page }) => {
  const origin = new URL(baseURL ?? 'http://127.0.0.1:5174').origin;
  const cdpSession = await context.newCDPSession(page);
  const galwayResult = [
    {
      id: 'place.galway',
      text: 'Galway',
      place_name: 'Galway, Ireland',
      center: [-9.0568, 53.2707],
      properties: { country_code: 'ie' },
      context: [{ id: 'country.1', text: 'Ireland', short_code: 'ie' }],
    },
  ];
  const corkResult = [
    {
      id: 'place.cork',
      text: 'Cork',
      place_name: 'Cork, Ireland',
      center: [-8.4756, 51.8985],
      properties: { country_code: 'ie' },
      context: [{ id: 'country.1', text: 'Ireland', short_code: 'ie' }],
    },
  ];

  await cdpSession.send('Storage.clearDataForOrigin', {
    origin,
    storageTypes: 'indexeddb',
  });

  await page.route('https://api.maptiler.com/geocoding/**', async (route) => {
    const url = new URL(route.request().url());
    const features = url.pathname === '/geocoding/Galway.json'
      ? galwayResult
      : url.pathname === '/geocoding/Cork.json'
        ? corkResult
        : [];

    await route.fulfill({
      contentType: 'application/json',
      json: { features },
    });
  });
  await page.route('https://api.openrouteservice.org/v2/directions/**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {
              summary: {
                distance: 210_000,
                duration: 10_800,
              },
            },
            geometry: {
              type: 'LineString',
              coordinates: [
                [-9.0568, 53.2707],
                [-9.8, 52.7],
                [-8.4756, 51.8985],
              ],
            },
          },
        ],
      },
    });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const searchInput = page.getByLabel('Search for a destination');
  await expect(searchInput).toBeVisible();

  await page.getByRole('button', { name: 'New trip' }).click();
  await page.getByLabel('Trip name').fill('Wild Atlantic Way');
  await page.getByRole('button', { name: 'Create trip' }).click();
  await expect(page.getByRole('button', { name: /current trip: Wild Atlantic Way/i })).toBeVisible();

  await searchInput.fill('Galway');
  await page.getByRole('option', { name: 'Galway, Ireland' }).click();
  await expect(searchInput).toHaveValue('');
  await searchInput.fill('Cork');
  await page.getByRole('option', { name: 'Cork, Ireland' }).click();
  await expect(page.getByText('130 mi')).toBeVisible();

  const liveCanvas = page.locator('.maplibregl-canvas').first();
  const liveMapBefore = await stableCanvasPixels(liveCanvas);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download trip map' }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe('Wild-Atlantic-Way.png');
  const bytes = await readFile((await download.path())!);
  expect(bytes.subarray(1, 4).toString()).toBe('PNG');
  expect(bytes.readUInt32BE(16)).toBe(1600);
  expect(bytes.readUInt32BE(20)).toBe(1000);

  const liveMapAfter = await stableCanvasPixels(liveCanvas);
  expect(liveMapAfter).toBe(liveMapBefore);
});

test('keeps the itinerary title row visible while scrolling the stop list', async ({ baseURL, context, page }) => {
  const origin = new URL(baseURL ?? 'http://127.0.0.1:5174').origin;
  const cdpSession = await context.newCDPSession(page);
  const destinations = Array.from({ length: 12 }, (_, index) => {
    const stopNumber = index + 1;

    return {
      id: `place.stop-${stopNumber}`,
      text: `Stop ${stopNumber}`,
      place_name: `Stop ${stopNumber}, Test Country`,
      center: [-4 + index, 50 + index * 0.25],
      properties: { country_code: 'tc' },
      context: [{ id: 'country.1', text: 'Test Country', short_code: 'tc' }],
    };
  });

  await cdpSession.send('Storage.clearDataForOrigin', {
    origin,
    storageTypes: 'indexeddb',
  });

  await page.route('https://api.maptiler.com/geocoding/**', async (route) => {
    const url = new URL(route.request().url());
    const query = decodeURIComponent(url.pathname.replace('/geocoding/', '').replace('.json', ''));
    const destination = destinations.find((candidate) => candidate.text === query);

    await route.fulfill({
      contentType: 'application/json',
      json: { features: destination ? [destination] : [] },
    });
  });
  await page.route('https://api.openrouteservice.org/v2/directions/**', async (route) => {
    const request = route.request();
    const body = request.postDataJSON() as { coordinates?: [number, number][] } | null;
    const coordinates = body?.coordinates ?? [
      [0, 0],
      [1, 1],
    ];

    await route.fulfill({
      contentType: 'application/json',
      json: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {
              summary: {
                distance: 120_000,
                duration: 7_200,
              },
            },
            geometry: {
              type: 'LineString',
              coordinates,
            },
          },
        ],
      },
    });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const searchInput = page.getByLabel('Search for a destination');
  await expect(searchInput).toBeVisible();

  for (const destination of destinations) {
    await searchInput.fill(destination.text);
    await page.getByRole('option', { name: destination.place_name }).click();
    await expect(searchInput).toHaveValue('');
  }

  const itinerary = page.getByRole('complementary', { name: 'Itinerary' });
  const header = itinerary.locator('.itinerary-panel-header');
  await expect(header).toBeVisible();

  await itinerary.evaluate((element) => {
    const stopListElement = element.querySelector<HTMLElement>('.stop-list');
    element.scrollTop = element.scrollHeight;
    if (stopListElement) {
      stopListElement.scrollTop = stopListElement.scrollHeight;
    }
  });

  const metrics = await itinerary.evaluate((element) => {
    const stopListElement = element.querySelector<HTMLElement>('.stop-list');
    const headerElement = element.querySelector<HTMLElement>('.itinerary-panel-header');

    if (!headerElement || !stopListElement) {
      throw new Error('Expected itinerary header and stop list to exist.');
    }

    const panelRect = element.getBoundingClientRect();
    const headerRect = headerElement.getBoundingClientRect();

    return {
      panelTop: panelRect.top,
      panelBottom: panelRect.bottom,
      headerTop: headerRect.top,
      headerBottom: headerRect.bottom,
      panelScrollTop: element.scrollTop,
      stopListScrollTop: stopListElement.scrollTop,
      panelScrollHeight: element.scrollHeight,
      panelClientHeight: element.clientHeight,
      stopListScrollHeight: stopListElement.scrollHeight,
      stopListClientHeight: stopListElement.clientHeight,
    };
  });

  expect(
    metrics.panelScrollHeight > metrics.panelClientHeight ||
      metrics.stopListScrollHeight > metrics.stopListClientHeight,
  ).toBe(true);
  expect(metrics.panelScrollTop + metrics.stopListScrollTop).toBeGreaterThan(0);
  expect(metrics.headerTop).toBeGreaterThanOrEqual(metrics.panelTop);
  expect(metrics.headerBottom).toBeLessThanOrEqual(metrics.panelBottom);
  await expect(page.getByRole('heading', { name: 'Itinerary' })).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Collapse itinerary panel' })).toBeInViewport();
});

test('creates and switches personal trips without Supabase', async ({ baseURL, context, page }) => {
  const origin = new URL(baseURL ?? 'http://127.0.0.1:5174').origin;
  const cdpSession = await context.newCDPSession(page);

  await cdpSession.send('Storage.clearDataForOrigin', {
    origin,
    storageTypes: 'indexeddb',
  });

  await page.route('https://api.maptiler.com/geocoding/**', async (route) => {
    const url = new URL(route.request().url());
    const query = decodeURIComponent(url.pathname.replace('/geocoding/', '').replace('.json', ''));
    const features = query === 'Kyoto'
      ? [
          {
            id: 'place.kyoto',
            text: 'Kyoto',
            place_name: 'Kyoto, Japan',
            center: [135.7681, 35.0116],
            properties: { country_code: 'jp' },
            context: [{ id: 'country.1', text: 'Japan', short_code: 'jp' }],
          },
        ]
      : [];

    await route.fulfill({
      contentType: 'application/json',
      json: { features },
    });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('Search for a destination')).toBeVisible();

  await page.getByRole('button', { name: 'New trip' }).click();
  await page.getByLabel('Trip name').fill('Japan winter');
  await page.getByRole('button', { name: 'Create trip' }).click();

  await expect(page.getByRole('button', { name: /current trip: Japan winter/i })).toBeVisible();

  await page.getByLabel('Search for a destination').fill('Kyoto');
  await page.getByRole('option', { name: 'Kyoto, Japan' }).click();
  await expect(page.getByRole('button', { name: 'Kyoto, Japan' })).toBeVisible();

  await page.getByRole('button', { name: /current trip/i }).click();
  await page.getByRole('menuitemradio', { name: 'World tour' }).click();

  await expect(page.getByRole('button', { name: /current trip: World tour/i })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Kyoto, Japan' })).toHaveCount(0);

  await page.getByRole('button', { name: /current trip/i }).click();
  await page.getByRole('menuitemradio', { name: 'Japan winter' }).click();

  await expect(page.getByRole('button', { name: 'Kyoto, Japan' })).toBeVisible();
});

test('searches and saves an Istanbul destination profile', async ({ baseURL, context, page }) => {
  const origin = new URL(baseURL ?? 'http://127.0.0.1:5174').origin;
  const cdpSession = await context.newCDPSession(page);

  await cdpSession.send('Storage.clearDataForOrigin', {
    origin,
    storageTypes: 'indexeddb',
  });

  await page.route('https://api.maptiler.com/geocoding/**', async (route) => {
    const url = new URL(route.request().url());

    expect(url.pathname).toBe('/geocoding/Istanbul.json');

    await route.fulfill({
      contentType: 'application/json',
      json: { features: istanbulResult },
    });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await expect(page.getByLabel('Interactive world tour map')).toBeVisible();

  await page.getByLabel('Search for a destination').fill('Istanbul');
  await page.getByRole('option', { name: 'Istanbul, Turkey' }).click();

  const profile = page.getByLabel('Istanbul profile');

  if (!(await profile.isVisible())) {
    await page.getByRole('button', { name: 'Istanbul, Turkey' }).last().click();
  }

  await expect(profile).toBeVisible();

  for (const tag of savedTags) {
    const existingTag = profile.getByRole('button', { name: `Remove tag ${tag}` });
    if (await existingTag.isVisible()) {
      await existingTag.click();
    }
  }

  for (const tag of savedTags) {
    await profile.getByRole('button', { name: 'Add tag' }).click();
    const tagInput = profile.getByRole('textbox', { name: 'Add tag' });
    await tagInput.fill(tag);
    await tagInput.press('Enter');
  }
  await expect(profile.getByRole('status', { name: 'Saved' })).toBeVisible();
  for (const tag of savedTags) {
    await expect(profile.getByRole('button', { name: `Remove tag ${tag}` })).toBeVisible();
  }

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('Interactive world tour map')).toBeVisible();
  await page.getByRole('button', { name: 'Istanbul, Turkey' }).last().click();

  await expect(profile).toBeVisible();
  for (const tag of savedTags) {
    await expect(profile.getByRole('button', { name: `Remove tag ${tag}` })).toBeVisible();
  }
});

test('adds a stop from the map context menu', async ({ page }) => {
  await page.route('https://api.maptiler.com/geocoding/**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        features: [
          {
            id: 'place-map-click',
            text: 'Map stop',
            place_name: 'Map stop, Test Region',
            center: [0, 0],
            context: [
              { id: 'region.1', text: 'Test Region' },
              { id: 'country.1', text: 'Test Country', short_code: 'tc' },
            ],
          },
        ],
      }),
    });
  });

  await page.goto('/');

  await expect(page.getByLabel('Interactive world tour map')).toBeVisible();
  await expect(page.getByLabel('Search for a destination')).toBeVisible();
  const mapContainer = page.getByTestId('map-container');
  await expect(mapContainer).toBeVisible();
  await mapContainer.click({
    button: 'right',
    position: { x: 360, y: 260 },
  });
  await page.getByRole('menuitem', { name: 'Add stop here' }).click();

  const mapStopDialog = page.getByRole('dialog', { name: 'Add stop from map' });
  await expect(mapStopDialog).toBeVisible();
  await expect(mapStopDialog.getByRole('heading', { name: 'Map stop' })).toBeVisible();
  await expect(mapStopDialog.getByText('Map stop, Test Region, Test Country')).toBeVisible();
  const addStopButton = page.getByRole('button', { name: 'Add stop', exact: true });
  await expect(addStopButton).toBeEnabled();
  await addStopButton.click();

  await expect(page.getByRole('complementary', { name: 'Map stop profile' })).toBeVisible();
});

test('opens an activity panel with image region beside the selected stop', async ({ baseURL, context, page }) => {
  const origin = new URL(baseURL ?? 'http://127.0.0.1:5174').origin;
  const cdpSession = await context.newCDPSession(page);
  const activityTitle = 'Morning Louvre';

  await cdpSession.send('Storage.clearDataForOrigin', {
    origin,
    storageTypes: 'indexeddb',
  });

  await page.route('https://api.maptiler.com/geocoding/**', async (route) => {
    const url = new URL(route.request().url());

    await route.fulfill({
      contentType: 'application/json',
      json: { features: url.pathname === '/geocoding/Paris.json' ? parisResult : [] },
    });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await expect(page.getByLabel('Interactive world tour map')).toBeVisible();
  await expect(page.getByLabel('Search for a destination')).toBeVisible();
  await page.getByLabel('Search for a destination').fill('Paris');
  await page.getByRole('option', { name: 'Paris, France' }).click();

  const stopPanel = page.getByRole('complementary', { name: 'Paris profile' });

  if (!(await stopPanel.isVisible())) {
    await page.getByRole('button', { name: 'Paris, France' }).last().click();
  }

  await expect(stopPanel).toBeVisible();

  const activitySearchInput = stopPanel.getByLabel('Search for an activity');
  await activitySearchInput.fill(activityTitle);
  await activitySearchInput.press('Enter');

  const activitySelect = stopPanel.getByRole('button', { name: `Select activity ${activityTitle}` });
  await expect(activitySelect).toBeVisible();
  await expect(activitySelect).toHaveAttribute('aria-current', 'true');

  const activityPanel = page.getByRole('complementary', { name: `${activityTitle} activity` });
  await expect(activityPanel).toBeVisible();
  await expect(stopPanel).toBeVisible();
  await expect(activityPanel.getByRole('region', { name: 'Activity images' })).toBeVisible();

  let openedFileChooser = false;
  page.on('filechooser', () => {
    openedFileChooser = true;
  });

  await activityPanel.getByLabel('Search web images').fill('mural');
  await activityPanel.getByRole('option', { name: 'Import mural in Morning Louvre from Local image search' }).click();

  await expect(activityPanel.getByRole('button', { name: 'Open full image: mural in Morning Louvre' })).toBeVisible();
  expect(openedFileChooser).toBe(false);

  const activityBox = await activityPanel.boundingBox();
  const stopBox = await stopPanel.boundingBox();
  if (!activityBox || !stopBox) {
    throw new Error('Expected activity and stop panels to have layout boxes.');
  }

  expect(activityBox.width).toBe(stopBox.width);
  expect(activityBox.x + activityBox.width).toBeLessThanOrEqual(stopBox.x);
});

test('imports a web image result into a stop carousel', async ({ baseURL, context, page }) => {
  const origin = new URL(baseURL ?? 'http://127.0.0.1:5174').origin;
  const cdpSession = await context.newCDPSession(page);

  await cdpSession.send('Storage.clearDataForOrigin', {
    origin,
    storageTypes: 'indexeddb',
  });

  await page.route('https://api.maptiler.com/geocoding/**', async (route) => {
    const url = new URL(route.request().url());

    expect(url.pathname).toBe('/geocoding/Paris.json');

    await route.fulfill({
      contentType: 'application/json',
      json: { features: parisResult },
    });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await expect(page.getByLabel('Interactive world tour map')).toBeVisible();
  await expect(page.getByLabel('Search for a destination')).toBeVisible();
  await page.getByLabel('Search for a destination').fill('Paris');
  await page.getByRole('option', { name: 'Paris, France' }).click();

  const stopPanel = page.getByRole('complementary', { name: 'Paris profile' });

  if (!(await stopPanel.isVisible())) {
    await page.getByRole('button', { name: 'Paris, France' }).last().click();
  }

  await expect(stopPanel).toBeVisible();

  await stopPanel.getByLabel('Search web images').fill('mural');
  await stopPanel.getByRole('option', { name: 'Import mural in Paris from Local image search' }).click();

  await expect(stopPanel.getByRole('button', { name: 'Open full image: mural in Paris' })).toBeVisible();
});
