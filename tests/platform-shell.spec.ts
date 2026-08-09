import { expect, test, type Locator, type Page } from '@playwright/test';

type Box = NonNullable<Awaited<ReturnType<Locator['boundingBox']>>>;

async function expectFullyInsideViewport(page: Page, locator: Locator) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.y).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 1);
  return box!;
}

async function expectActionablePointsTopmost(locator: Locator) {
  const sampledPointsAreTopmost = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const samples = [
      [0.25, 0.25],
      [0.75, 0.25],
      [0.5, 0.5],
      [0.25, 0.75],
      [0.75, 0.75],
    ];
    return samples.map(([xRatio, yRatio]) => {
      const stack = document.elementsFromPoint(rect.left + rect.width * xRatio, rect.top + rect.height * yRatio);
      const controlIndex = stack.indexOf(element);
      if (controlIndex < 0) return false;
      return stack.slice(0, controlIndex).every((candidate) => element.contains(candidate));
    });
  });
  expect(sampledPointsAreTopmost).toEqual([true, true, true, true, true]);
}

function expectBoxInsideBox(inner: Box, outer: Box) {
  expect(inner.x).toBeGreaterThanOrEqual(outer.x - 1);
  expect(inner.y).toBeGreaterThanOrEqual(outer.y - 1);
  expect(inner.x + inner.width).toBeLessThanOrEqual(outer.x + outer.width + 1);
  expect(inner.y + inner.height).toBeLessThanOrEqual(outer.y + outer.height + 1);
}

test('serves the shared fallback theme and persists colour mode without changing the trip', async ({ page, request }) => {
  const themeResponse = await request.get('/_local-web/platform/theme.css');
  expect(themeResponse.status()).toBe(200);
  expect(await themeResponse.text()).toContain('--lwp-colour-canvas');

  await page.goto('/');
  await expect(page.getByLabel('Search for a destination')).toBeVisible();

  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.getByRole('navigation', { name: 'Location' })).toHaveCount(1);
  await expect(page.getByRole('group', { name: 'Colour mode' })).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Plotter', exact: true })).toHaveCount(0);

  const currentTripButton = page.getByRole('button', { name: /current trip:/i });
  const currentTripName = await currentTripButton.textContent();
  expect(currentTripName?.trim()).toBeTruthy();

  await page.getByRole('button', { name: 'Dark colour mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-lwp-colour-mode', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-lwp-colour-mode', 'dark');
  await expect(page.getByRole('button', { name: /current trip:/i })).toHaveText(currentTripName!);

  await page.getByRole('button', { name: 'Light colour mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-lwp-colour-mode', 'light');

  await page.getByRole('button', { name: 'System colour mode' }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-lwp-colour-mode');
});

const requiredViewports = [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
  { width: 320, height: 568 },
] as const;

for (const viewport of requiredViewports) {
  test(`fills the platform main track and keeps controls visible at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');

    const actionableControls = [
      page.getByLabel('Search for a destination'),
      page.getByRole('button', { name: 'Download trip map' }),
      page.getByRole('button', { name: /current trip:/i }),
      page.getByRole('button', { name: 'Zoom in' }),
      page.getByRole('button', { name: 'Zoom out' }),
    ];
    for (const control of actionableControls) {
      await expectFullyInsideViewport(page, control);
      await expectActionablePointsTopmost(control);
    }
    await expectFullyInsideViewport(page, page.getByRole('complementary', { name: 'Itinerary' }));

    const emptyPanelBox = await page.locator('.app-status-panel--empty').boundingBox();
    expect(emptyPanelBox).not.toBeNull();
    for (const zoomControl of [
      page.getByRole('button', { name: 'Zoom in' }),
      page.getByRole('button', { name: 'Zoom out' }),
    ]) {
      const zoomBox = await zoomControl.boundingBox();
      expect(zoomBox).not.toBeNull();
      const overlapsHorizontally = emptyPanelBox!.x < zoomBox!.x + zoomBox!.width
        && emptyPanelBox!.x + emptyPanelBox!.width > zoomBox!.x;
      const overlapsVertically = emptyPanelBox!.y < zoomBox!.y + zoomBox!.height
        && emptyPanelBox!.y + emptyPanelBox!.height > zoomBox!.y;
      expect(overlapsHorizontally && overlapsVertically).toBe(false);
    }

    const mainBox = await page.locator('#lwp-main').boundingBox();
    const stageBox = await page.getByRole('region', { name: 'Plotter map workspace' }).boundingBox();
    expect(mainBox).not.toBeNull();
    expect(stageBox).not.toBeNull();
    expect(Math.abs(stageBox!.x - mainBox!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(stageBox!.y - mainBox!.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(stageBox!.width - mainBox!.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(stageBox!.height - mainBox!.height)).toBeLessThanOrEqual(1);

    const overflow = await page.evaluate(() => ({
      horizontal: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      vertical: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    }));
    expect(overflow.horizontal).toBeLessThanOrEqual(1);
    expect(overflow.vertical).toBeLessThanOrEqual(1);
  });
}

test('contains every media-preview action within the platform main track in light and dark modes', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.route('https://api.maptiler.com/geocoding/**', async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      contentType: 'application/json',
      json: {
        features: url.pathname === '/geocoding/Paris.json'
          ? [{
              id: 'place.paris',
              text: 'Paris',
              place_name: 'Paris, France',
              center: [2.3522, 48.8566],
              properties: { country_code: 'fr' },
              context: [{ id: 'country.1', text: 'France', short_code: 'fr' }],
            }]
          : [],
      },
    });
  });

  await page.goto('/');
  const search = page.getByLabel('Search for a destination');
  await expect(search).toBeVisible();
  await search.fill('Paris');
  await page.getByRole('option', { name: 'Paris, France' }).click();

  const stopPanel = page.getByRole('complementary', { name: 'Paris profile' });
  if (!(await stopPanel.isVisible())) {
    await page.getByRole('button', { name: 'Paris, France' }).last().click();
  }
  await expect(stopPanel).toBeVisible();
  await stopPanel.getByLabel('Search web images').fill('mural');
  await stopPanel.getByRole('option', { name: 'Import mural in Paris from Local image search' }).click();
  await stopPanel.getByRole('button', { name: 'Open full image: mural in Paris' }).click();

  const main = page.locator('#lwp-main');
  const preview = page.getByRole('dialog', { name: 'Image preview' });
  const actions = [
    page.getByRole('button', { name: 'Close image preview' }),
    page.getByRole('button', { name: 'Previous full image' }),
    page.getByRole('button', { name: 'Next full image' }),
    page.getByRole('button', { name: 'Delete image' }),
  ];

  for (const mode of ['Light', 'Dark'] as const) {
    await page.getByRole('button', { name: `${mode} colour mode` }).click();
    const mainBox = await main.boundingBox();
    const previewBox = await preview.boundingBox();
    expect(mainBox).not.toBeNull();
    expect(previewBox).not.toBeNull();
    expectBoxInsideBox(previewBox!, mainBox!);
    for (const action of actions) {
      const actionBox = await expectFullyInsideViewport(page, action);
      expectBoxInsideBox(actionBox, mainBox!);
      await expectActionablePointsTopmost(action);
    }
  }
});
