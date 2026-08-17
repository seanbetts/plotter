import { expect, test as base, type APIRequestContext, type Page } from '@playwright/test';

export async function gotoServiceApp(
  page: Page,
  options?: Parameters<Page['goto']>[1],
) {
  let eventStreamOpened = false;
  let reconciliationDirectoryRead = false;
  let tripReadsAfterReconciliation = 0;
  let finishReconciliation!: () => void;
  const reconciliationFinished = new Promise<void>((resolve) => {
    finishReconciliation = resolve;
  });
  const onResponse = (response: Awaited<ReturnType<Page['waitForResponse']>>) => {
    if (response.request().method() !== 'GET' || !response.ok()) return;
    const pathname = new URL(response.url()).pathname;
    if (pathname === '/plotter/api/v1/events') {
      eventStreamOpened = true;
      return;
    }
    if (eventStreamOpened && pathname === '/plotter/api/v1/trips') {
      reconciliationDirectoryRead = true;
      tripReadsAfterReconciliation = 0;
      return;
    }
    if (reconciliationDirectoryRead && /^\/plotter\/api\/v1\/trips\/[^/]+$/.test(pathname)) {
      tripReadsAfterReconciliation += 1;
      if (tripReadsAfterReconciliation >= 2) finishReconciliation();
    }
  };
  page.on('response', onResponse);
  try {
    const navigation = await page.goto('./', options);
    await reconciliationFinished;
    return navigation;
  } finally {
    page.off('response', onResponse);
  }
}

async function resetService(request: APIRequestContext) {
  const directoryResponse = await request.get('/plotter/api/v1/trips');
  if (!directoryResponse.ok()) {
    throw new Error(`Unable to reset Plotter E2E storage (${directoryResponse.status()}).`);
  }
  const directory = await directoryResponse.json() as {
    revision: number;
    trips: Array<{ id: string }>;
  };
  let revision = directory.revision;
  for (const trip of directory.trips) {
    const deleteResponse = await request.delete(`/plotter/api/v1/trips/${encodeURIComponent(trip.id)}`, {
      headers: { 'x-plotter-write': '1' },
      data: { expectedRevision: revision },
    });
    if (!deleteResponse.ok()) {
      throw new Error(`Unable to delete a disposable Plotter trip (${deleteResponse.status()}).`);
    }
    revision = (await deleteResponse.json() as { revision: number }).revision;
  }
  const createResponse = await request.post('/plotter/api/v1/trips', {
    headers: { 'x-plotter-write': '1' },
    data: { expectedRevision: revision, name: 'Untitled trip' },
  });
  if (createResponse.status() !== 201) {
    throw new Error(`Unable to seed the disposable Plotter trip (${createResponse.status()}).`);
  }
}

export const test = base.extend<{ e2eMapStyle: void; serviceReset: void }>({
  e2eMapStyle: [async ({ page }, use) => {
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
    await use();
  }, { auto: true }],
  serviceReset: [async ({ request }, use) => {
    await resetService(request);
    await use();
  }, { auto: true }],
});

export { expect };
