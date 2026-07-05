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

  await stopPanel.getByLabel('Search for an activity').fill(activityTitle);
  await stopPanel.getByRole('button', { name: 'Add activity' }).click();

  const activitySelect = stopPanel.getByRole('button', { name: `Select activity ${activityTitle}` });
  await expect(activitySelect).toBeVisible();
  await activitySelect.click();

  const activityPanel = page.getByRole('complementary', { name: `${activityTitle} activity` });
  await expect(activityPanel).toBeVisible();
  await expect(stopPanel).toBeVisible();
  await expect(activityPanel.getByRole('region', { name: 'Activity images' })).toBeVisible();

  const activityBox = await activityPanel.boundingBox();
  const stopBox = await stopPanel.boundingBox();
  if (!activityBox || !stopBox) {
    throw new Error('Expected activity and stop panels to have layout boxes.');
  }

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
