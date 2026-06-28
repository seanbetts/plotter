import { expect, test } from '@playwright/test';

test('loads the world tour planner shell', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByLabel('World tour map workspace')).toBeVisible();
  await expect(page.getByText('World Tour Planner')).toBeVisible();
});
