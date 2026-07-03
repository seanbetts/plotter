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

  const tagInput = profile.getByLabel('Add tag');

  for (const tag of savedTags) {
    const existingTag = profile.getByRole('button', { name: `Remove tag ${tag}` });
    if (await existingTag.isVisible()) {
      await existingTag.click();
    }
  }

  for (const tag of savedTags) {
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
