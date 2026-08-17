import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { APIRequestContext, Locator, Page, Route } from '@playwright/test';
import { expect, gotoServiceApp, test } from './fixtures';

const execFileAsync = promisify(execFile);
const serviceBaseUrl = 'http://127.0.0.1:5175/';
const pixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const parisResult = {
  id: 'place.paris',
  text: 'Paris',
  place_name: 'Paris, France',
  center: [2.3522, 48.8566],
  properties: { country_code: 'fr' },
  context: [{ id: 'country.1', text: 'France', short_code: 'fr' }],
};

type Directory = {
  revision: number;
  trips: Array<{ id: string; name: string }>;
};

async function readDirectory(request: APIRequestContext): Promise<Directory> {
  const response = await request.get('/plotter/api/v1/trips');
  expect(response.ok(), await response.text()).toBe(true);
  return response.json() as Promise<Directory>;
}

async function renameTrip(
  request: APIRequestContext,
  tripId: string,
  name: string,
): Promise<void> {
  const directory = await readDirectory(request);
  const response = await request.patch(`/plotter/api/v1/trips/${encodeURIComponent(tripId)}`, {
    headers: { 'x-plotter-write': '1' },
    data: { expectedRevision: directory.revision, patch: { name } },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

async function installMapFakes(page: Page): Promise<void> {
  await page.route('https://api.maptiler.com/geocoding/**', async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      contentType: 'application/json',
      json: { features: url.pathname === '/geocoding/Paris.json' ? [parisResult] : [] },
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
}

async function addParisStop(page: Page): Promise<Locator> {
  const search = page.getByLabel('Search for a destination');
  await expect(page.getByRole('button', { name: /current trip: Untitled trip/i })).toBeVisible();
  await expect(page.getByText('No stops in this trip yet')).toBeVisible();
  await expect(search).toBeVisible();
  const geocodeResponsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/geocoding/Paris.json',
  );
  await search.fill('Paris');
  const geocodeResponse = await geocodeResponsePromise;
  expect(geocodeResponse.ok(), await geocodeResponse.text()).toBe(true);
  const saveResponsePromise = page.waitForResponse((response) =>
    response.request().method() === 'POST'
    && /\/api\/v1\/trips\/[^/]+\/mutations$/.test(new URL(response.url()).pathname),
  );
  await page.getByRole('option', { name: 'Paris, France' }).click();
  const saveResponse = await saveResponsePromise;
  expect(saveResponse.ok(), await saveResponse.text()).toBe(true);
  await expect(page.getByRole('button', { name: 'Paris, France' })).toBeVisible();

  const stopPanel = page.getByRole('complementary', { name: 'Paris profile' });
  if (!(await stopPanel.isVisible())) {
    await page.getByRole('button', { name: 'Paris, France' }).last().click();
  }
  await expect(stopPanel).toBeVisible();

  return stopPanel;
}

test('loads service-seeded trips in a fresh browser without creating IndexedDB', async ({
  page,
  request,
}) => {
  const mapTilerRequests: string[] = [];
  page.on('request', (browserRequest) => {
    if (browserRequest.url().includes('api.maptiler.com') || browserRequest.url().includes('parent-maptiler-secret')) {
      mapTilerRequests.push(browserRequest.url());
    }
  });
  await page.route('https://api.maptiler.com/**', (route) => route.abort('blockedbyclient'));
  const blankStyleRequest = page.waitForRequest('https://demotiles.maplibre.org/style.json');
  const directory = await readDirectory(request);
  const createResponse = await request.post('/plotter/api/v1/trips', {
    headers: { 'x-plotter-write': '1' },
    data: {
      expectedRevision: directory.revision,
      name: 'Fresh service trip',
    },
  });
  expect(createResponse.status(), await createResponse.text()).toBe(201);

  await page.goto('./');
  await blankStyleRequest;

  await expect(page.getByRole('button', { name: /current trip: Fresh service trip/i })).toBeVisible();
  expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
  expect(mapTilerRequests).toEqual([]);
});

test('invalidates the same trip across two browser contexts', async ({ browser }) => {
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  try {
    const firstPage = await firstContext.newPage();
    const secondPage = await secondContext.newPage();
    await Promise.all([installMapFakes(firstPage), installMapFakes(secondPage)]);
    await Promise.all([gotoServiceApp(firstPage), gotoServiceApp(secondPage)]);
    await Promise.all([
      expect(firstPage.getByRole('button', { name: /current trip: Untitled trip/i })).toBeVisible(),
      expect(secondPage.getByRole('button', { name: /current trip: Untitled trip/i })).toBeVisible(),
    ]);

    await addParisStop(firstPage);

    await expect(secondPage.getByRole('button', { name: 'Paris, France' })).toBeVisible();
  } finally {
    await Promise.all([firstContext.close(), secondContext.close()]);
  }
});

test('allows exactly one same-revision write and returns the exact stale 409', async ({ request }) => {
  const directory = await readDirectory(request);
  const write = (name: string) => request.post('/plotter/api/v1/trips', {
    headers: { 'x-plotter-write': '1' },
    data: { expectedRevision: directory.revision, name },
  });

  const responses = await Promise.all([write('Race winner A'), write('Race winner B')]);
  const statuses = responses.map((response) => response.status()).sort((left, right) => left - right);
  expect(statuses).toEqual([201, 409]);
  const conflict = responses.find((response) => response.status() === 409)!;
  expect(await conflict.json()).toEqual({
    status: 409,
    error: {
      code: 'conflict',
      message: 'Another device changed this data. Plotter reloaded the latest version.',
      currentRevision: directory.revision + 1,
    },
  });
});

test('renders a stale browser conflict inside the existing shell', async ({ page, request }, testInfo) => {
  await page.route('**/plotter/api/v1/events', (route) => route.abort('connectionrefused'));
  await page.goto('./');
  await expect(page.getByRole('button', { name: /current trip: Untitled trip/i })).toBeVisible();
  const directory = await readDirectory(request);
  await renameTrip(request, directory.trips[0]!.id, 'External trip name');

  await page.getByRole('button', { name: 'New trip' }).click();
  await page.getByLabel('Trip name').fill('Stale browser write');
  await page.getByRole('button', { name: 'Create trip' }).click();

  await expect(page.getByText('Another device changed this trip. Plotter reloaded the latest version.')).toBeVisible();
  await testInfo.attach('rendered-conflict', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

test('reconnects after a missed event and reconciles canonical revisions', async ({ page, request }) => {
  let blockedEventConnections = 0;
  const blockEvents = async (route: Route) => {
    blockedEventConnections += 1;
    await route.abort('connectionrefused');
  };
  await page.route('**/plotter/api/v1/events', blockEvents);
  await page.goto('./');
  await expect(page.getByRole('button', { name: /current trip: Untitled trip/i })).toBeVisible();
  const directory = await readDirectory(request);
  await renameTrip(request, directory.trips[0]!.id, 'Recovered after reconnect');
  expect(blockedEventConnections).toBeGreaterThanOrEqual(1);

  await page.unroute('**/plotter/api/v1/events', blockEvents);

  await expect(page.getByRole('button', { name: /current trip: Recovered after reconnect/i })).toBeVisible({
    timeout: 10_000,
  });
});

test('uses visibility reconciliation to recover an event missed while disconnected', async ({ page, request }) => {
  await page.route('**/plotter/api/v1/events', (route) => route.abort('connectionrefused'));
  await page.goto('./');
  await expect(page.getByRole('button', { name: /current trip: Untitled trip/i })).toBeVisible();
  const directory = await readDirectory(request);
  await renameTrip(request, directory.trips[0]!.id, 'Recovered on visibility');
  await expect(page.getByRole('button', { name: /current trip: Untitled trip/i })).toBeVisible();

  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

  await expect(page.getByRole('button', { name: /current trip: Recovered on visibility/i })).toBeVisible();
});

test('renders the exact service-unavailable state within the map shell', async ({ page }, testInfo) => {
  const unavailableTrips = async (route: Route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      json: {
        status: 503,
        error: { code: 'storage-unavailable', message: 'Plotter storage is unavailable.' },
      },
    });
  };
  await page.route('**/plotter/api/v1/trips', unavailableTrips);

  await page.goto('./');

  const stage = page.getByRole('region', { name: 'Plotter map workspace' });
  const alert = stage.getByRole('alert');
  await expect(alert.getByText('Trip storage unavailable')).toBeVisible();
  await expect(alert.getByText('Shared trip storage is unavailable.')).toBeVisible();
  const retry = alert.getByRole('button', { name: 'Retry' });
  await expect(retry).toBeVisible();
  const [stageBox, alertBox] = await Promise.all([stage.boundingBox(), alert.boundingBox()]);
  expect(stageBox).not.toBeNull();
  expect(alertBox).not.toBeNull();
  expect(alertBox!.x).toBeGreaterThanOrEqual(stageBox!.x);
  expect(alertBox!.y).toBeGreaterThanOrEqual(stageBox!.y);
  expect(alertBox!.x + alertBox!.width).toBeLessThanOrEqual(stageBox!.x + stageBox!.width);
  expect(alertBox!.y + alertBox!.height).toBeLessThanOrEqual(stageBox!.y + stageBox!.height);
  await testInfo.attach('service-unavailable', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });

  await page.unroute('**/plotter/api/v1/trips', unavailableTrips);
  const recoveredDirectory = page.waitForResponse((response) =>
    response.request().method() === 'GET'
    && new URL(response.url()).pathname === '/plotter/api/v1/trips'
    && response.ok(),
  );
  await retry.click();
  await recoveredDirectory;
  await expect(page.getByRole('button', { name: /current trip: Untitled trip/i })).toBeVisible();
  expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
});

test('uploads, streams, displays, and deletes service-owned media', async ({ page, request }) => {
  await installMapFakes(page);
  await page.goto('./');
  const stopPanel = await addParisStop(page);
  const uploadResponsePromise = page.waitForResponse((response) =>
    response.request().method() === 'POST'
    && /\/destinations\/[^/]+\/media$/.test(new URL(response.url()).pathname),
  );

  await stopPanel.getByLabel('Choose stop images file input').setInputFiles({
    name: 'pixel.png',
    mimeType: 'image/png',
    buffer: pixelPng,
  });
  const uploadResponse = await uploadResponsePromise;
  expect(uploadResponse.ok(), await uploadResponse.text()).toBe(true);
  const previewButton = stopPanel.getByRole('button', { name: 'Open full image' });
  await expect(previewButton).toBeVisible();
  const previewImage = previewButton.locator('img');
  await expect.poll(() => previewImage.evaluate((element: HTMLImageElement) => ({
    complete: element.complete,
    naturalWidth: element.naturalWidth,
  }))).toEqual({ complete: true, naturalWidth: 1 });
  const imageUrl = await previewImage.evaluate((element: HTMLImageElement) => element.src);
  expect(new URL(imageUrl).pathname).toMatch(/^\/plotter\/api\/v1\/media\/.+\/content$/);
  const mediaResponse = await request.get(imageUrl);
  expect(mediaResponse.status()).toBe(200);
  expect(mediaResponse.headers()['content-type']).toBe('image/png');
  expect(Buffer.from(await mediaResponse.body()).subarray(1, 4).toString()).toBe('PNG');

  await previewButton.click();
  const deleteResponsePromise = page.waitForResponse((response) =>
    response.request().method() === 'DELETE'
    && response.url().includes('/destination-media/'),
  );
  await page.getByRole('button', { name: 'Delete image' }).click();
  await page.getByRole('alertdialog', { name: 'Delete image confirmation' })
    .getByRole('button', { name: 'Delete image' })
    .click();
  const deleteResponse = await deleteResponsePromise;
  expect(deleteResponse.ok(), await deleteResponse.text()).toBe(true);
  await expect(previewButton).toHaveCount(0);
  expect((await request.get(imageUrl)).status()).toBe(404);
});

test('serves deterministic link, image-search, and remote-image fakes', async ({ page, request }) => {
  const previewResponse = await request.post('/plotter/api/v1/link-preview', {
    data: { url: 'https://example.com/menu' },
  });
  expect(previewResponse.ok(), await previewResponse.text()).toBe(true);
  expect(await previewResponse.json()).toEqual({
    preview: {
      url: 'https://example.com/menu',
      title: 'example.com',
      domain: 'example.com',
    },
  });

  const searchResponse = await request.post('/plotter/api/v1/image-search', {
    data: { query: 'mural', context: { stopName: 'Paris', countryName: 'France' } },
  });
  expect(searchResponse.ok(), await searchResponse.text()).toBe(true);
  const search = await searchResponse.json() as {
    results: Array<{ title: string; sourceName: string; thumbnailUrl: string; imageUrl: string }>;
  };
  expect(search.results).toHaveLength(1);
  expect(search.results[0]).toMatchObject({
    title: 'mural in Paris',
    sourceName: 'Local image search',
  });
  expect(search.results[0]!.thumbnailUrl).toBe(`${serviceBaseUrl}api/v1/e2e-provider/image.png`);
  expect(search.results[0]!.imageUrl).toBe(`${serviceBaseUrl}api/v1/e2e-provider/image.png`);
  const fakeImage = await request.get(search.results[0]!.imageUrl);
  expect(fakeImage.status()).toBe(200);
  expect(Buffer.from(await fakeImage.body())).toEqual(pixelPng);

  await installMapFakes(page);
  await page.goto('./');
  const stopPanel = await addParisStop(page);
  const linkForm = stopPanel.getByRole('form', { name: 'Add link' });
  await linkForm.getByLabel('Add link URL').fill('https://example.com/menu');
  await linkForm.getByRole('button', { name: 'Add link' }).click();
  await expect(stopPanel.locator('a[href="https://example.com/menu"]')).toContainText('example.com');
  await expect(stopPanel.getByRole('status', { name: 'Saved' })).toBeVisible();
  await stopPanel.getByLabel('Search web images').fill('mural');
  const importResponsePromise = page.waitForResponse((response) =>
    response.request().method() === 'POST' && response.url().endsWith('/media/import'),
  );
  await stopPanel.getByRole('option', { name: 'Import mural in Paris from Local image search' }).click();
  const importResponse = await importResponsePromise;
  expect(importResponse.ok(), await importResponse.text()).toBe(true);
  await expect(stopPanel.getByRole('button', { name: 'Open full image: mural in Paris' })).toBeVisible();
});

test('refreshes a browser after a CLI write through PLOTTER_BASE_URL', async ({ page, request }) => {
  await page.goto('./');
  await expect(page.getByRole('button', { name: /current trip: Untitled trip/i })).toBeVisible();
  const directory = await readDirectory(request);

  const cliEnvironment = { ...process.env };
  delete cliEnvironment.FORCE_COLOR;
  delete cliEnvironment.NO_COLOR;
  const { stdout, stderr } = await execFileAsync('npm', [
    'run',
    'trip',
    '--',
    'rename',
    '--trip-id',
    directory.trips[0]!.id,
    '--name',
    'CLI service trip',
    '--yes',
  ], {
    cwd: process.cwd(),
    env: { ...cliEnvironment, PLOTTER_BASE_URL: serviceBaseUrl },
  });

  expect(stderr).toBe('');
  expect(stdout).toContain('"summary":"Renamed trip to CLI service trip."');
  await expect(page.getByRole('button', { name: /current trip: CLI service trip/i })).toBeVisible();
});
