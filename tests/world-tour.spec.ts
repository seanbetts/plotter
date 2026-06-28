import { expect, test } from '@playwright/test';

const appDbName = 'world-tour-planner';
const savedSummary = 'Gateway from Europe toward Asia.';
const istanbulResult = [
  {
    place_id: 7_457_330,
    display_name: 'Istanbul, Turkey',
    lat: '41.0082',
    lon: '28.9784',
  },
];

test('searches and saves an Istanbul destination profile', async ({ baseURL, context, page }) => {
  const origin = new URL(baseURL ?? 'http://127.0.0.1:5174').origin;
  const cdpSession = await context.newCDPSession(page);

  await cdpSession.send('Storage.clearDataForOrigin', {
    origin,
    storageTypes: 'indexeddb,local_storage',
  });

  await page.route('https://nominatim.openstreetmap.org/**', async (route) => {
    const url = new URL(route.request().url());

    expect(url.searchParams.get('q')).toBe('Istanbul');

    await route.fulfill({
      contentType: 'application/json',
      json: istanbulResult,
    });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await expect(page.getByLabel('Interactive world tour map')).toBeVisible();

  await page.getByLabel('Search for a destination').fill('Istanbul');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('button', { name: 'Add Istanbul, Turkey' }).click();

  const profile = page.getByLabel('Istanbul profile');

  if (!(await profile.isVisible())) {
    await page.getByRole('button', { name: 'Select Istanbul' }).click();
  }

  await expect(profile).toBeVisible();

  const whyItMatters = profile.getByLabel('Why it matters');

  await whyItMatters.fill(savedSummary);
  await profile.getByRole('button', { name: 'Save destination' }).click();

  await expect
    .poll(() =>
      page.evaluate(
        ({ dbName, destinationSummary }) =>
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
                      destination.why?.summary === destinationSummary,
                  ),
                );
              };
              transaction.oncomplete = () => db.close();
            };
          }),
        { dbName: appDbName, destinationSummary: savedSummary },
      ),
    )
    .toBe(true);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('Interactive world tour map')).toBeVisible();
  await page.getByRole('button', { name: 'Select Istanbul' }).click();

  await expect(profile).toBeVisible();
  await expect(whyItMatters).toHaveValue(savedSummary);
});
