import { expect, test } from '@playwright/test';
import type { BrowserContext, Locator, Page } from '@playwright/test';

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

async function clearIndexedDb(baseURL: string | undefined, context: BrowserContext, page: Page) {
  const origin = new URL(baseURL ?? 'http://127.0.0.1:5174').origin;
  const cdpSession = await context.newCDPSession(page);

  await cdpSession.send('Storage.clearDataForOrigin', {
    origin,
    storageTypes: 'indexeddb',
  });
}

async function createParisStop(page: Page) {
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

  return stopPanel;
}

async function addLink(stopPanel: Locator, rawUrl: string) {
  const linkForm = stopPanel.getByRole('form', { name: 'Add link' });

  await linkForm.getByLabel('Add link URL').fill(rawUrl);
  await linkForm.getByRole('button', { name: 'Add' }).click();
  await expect(linkForm.getByLabel('Add link URL')).not.toBeDisabled();
}

test('renders stop link preview cards with fallback metadata and card-level reordering', async ({ baseURL, context, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await clearIndexedDb(baseURL, context, page);

  const stopPanel = await createParisStop(page);
  const linksRegion = stopPanel.getByRole('region', { name: 'Links' });

  await addLink(stopPanel, 'https://example.com/menu');

  const menuLink = linksRegion.locator('a[href="https://example.com/menu"]');
  await expect(menuLink).toHaveAttribute('href', 'https://example.com/menu');
  await expect(menuLink).toHaveAttribute('target', '_blank');
  await expect(menuLink).toContainText('example.com');

  const menuCard = menuLink.locator('xpath=ancestor::article[1]');
  await expect(menuCard).toHaveAttribute('draggable', 'true');
  await expect(menuCard.getByRole('button', { name: 'Delete example.com' })).toBeVisible();
  await expect(menuCard.getByRole('button', { name: /^(Edit|Open|Notes|Category)\b/i })).toHaveCount(0);
  await expect(menuCard.getByRole('button', { name: /^Drag\b/i })).toHaveCount(0);

  await addLink(stopPanel, 'https://example.com/tickets');

  const grid = linksRegion.locator('.link-preview-grid');
  const gridTemplateColumns = await grid.evaluate((element) => getComputedStyle(element).gridTemplateColumns);
  expect(gridTemplateColumns.trim().split(/\s+/)).toHaveLength(2);

  const ticketsLink = linksRegion.locator('a[href="https://example.com/tickets"]');
  const ticketsCard = ticketsLink.locator('xpath=ancestor::article[1]');

  await expect(ticketsCard).toHaveAttribute('draggable', 'true');
  await expect(linksRegion.getByRole('button', { name: /^Drag\b/i })).toHaveCount(0);

  const beforeBoxes = await Promise.all([menuCard.boundingBox(), ticketsCard.boundingBox()]);
  if (!beforeBoxes[0] || !beforeBoxes[1]) {
    throw new Error('Expected link preview cards to have layout boxes.');
  }
  expect(Math.abs(beforeBoxes[0].y - beforeBoxes[1].y)).toBeLessThanOrEqual(2);
  expect(beforeBoxes[0].x).toBeLessThan(beforeBoxes[1].x);

  await menuCard.dragTo(ticketsCard, {
    targetPosition: {
      x: beforeBoxes[1].width - 4,
      y: beforeBoxes[1].height / 2,
    },
  });

  await expect.poll(async () =>
    linksRegion.locator('.link-preview-card__link').evaluateAll((links) =>
      links.map((link) => link.getAttribute('href')),
    ),
  ).toEqual(['https://example.com/tickets', 'https://example.com/menu']);
});
