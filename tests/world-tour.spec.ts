import { expect, test } from '@playwright/test';

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

  await whyItMatters.fill('Gateway from Europe toward Asia.');
  await profile.getByRole('button', { name: 'Save destination' }).click();

  await expect(whyItMatters).toHaveValue('Gateway from Europe toward Asia.');
});
