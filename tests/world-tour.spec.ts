import { expect, test } from '@playwright/test';

const appDbName = 'world-tour-planner';
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
    storageTypes: 'indexeddb,local_storage',
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
    await page.getByRole('button', { name: 'Istanbul, Turkey' }).click();
  }

  await expect(profile).toBeVisible();

  const tagInput = profile.getByLabel('Add tag');

  for (const tag of savedTags) {
    await tagInput.fill(tag);
    await tagInput.press('Enter');
  }
  await expect(profile.getByRole('status', { name: 'Saved' })).toBeVisible();

  await expect
    .poll(() =>
      page.evaluate(
        ({ dbName, expectedTags }) =>
          new Promise<boolean>((resolve, reject) => {
            const request = indexedDB.open(dbName);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              const db = request.result;
              const transaction = db.transaction('destinations', 'readonly');
              const getAllRequest = transaction.objectStore('destinations').getAll();

              getAllRequest.onerror = () => reject(getAllRequest.error);
              getAllRequest.onsuccess = () => {
                resolve(
                  getAllRequest.result.some(
                    (destination) =>
                      destination.name === 'Istanbul' &&
                      JSON.stringify(destination.tags) === JSON.stringify(expectedTags),
                  ),
                );
              };
              transaction.oncomplete = () => db.close();
            };
          }),
        { dbName: appDbName, expectedTags: savedTags },
      ),
    )
    .toBe(true);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('Interactive world tour map')).toBeVisible();
  await page.getByRole('button', { name: 'Istanbul, Turkey' }).click();

  await expect(profile).toBeVisible();
  for (const tag of savedTags) {
    await expect(profile.getByRole('button', { name: `Remove tag ${tag}` })).toBeVisible();
  }
});
