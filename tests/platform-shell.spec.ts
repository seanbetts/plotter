import { expect, test } from '@playwright/test';

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

  await page.getByRole('button', { name: 'Dark colour mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-lwp-colour-mode', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-lwp-colour-mode', 'dark');
  await expect(page.getByRole('button', { name: /current trip:/i })).toHaveText(currentTripName ?? '');

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

    await expect(page.getByLabel('Search for a destination')).toBeVisible();
    await expect(page.getByRole('button', { name: /current trip:/i })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Itinerary' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Zoom in' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Zoom out' })).toBeVisible();

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
