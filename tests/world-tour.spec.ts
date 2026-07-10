import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

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
  const liveMapBefore = await liveCanvas.evaluate((canvas: HTMLCanvasElement) => ({
    width: canvas.width,
    height: canvas.height,
    transform: getComputedStyle(canvas).transform,
  }));

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download trip map' }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe('Wild-Atlantic-Way.png');
  const bytes = await readFile((await download.path())!);
  expect(bytes.subarray(1, 4).toString()).toBe('PNG');
  expect(bytes.readUInt32BE(16)).toBe(1600);
  expect(bytes.readUInt32BE(20)).toBe(1000);

  const liveMapAfter = await liveCanvas.evaluate((canvas: HTMLCanvasElement) => ({
    width: canvas.width,
    height: canvas.height,
    transform: getComputedStyle(canvas).transform,
  }));
  expect(liveMapAfter).toEqual(liveMapBefore);
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
  const stopList = itinerary.locator('.stop-list');
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
