import {
  expect,
  test as base,
  type APIRequestContext,
  type Page,
  type Response,
} from '@playwright/test';

export async function gotoServiceApp(
  page: Page,
  options?: Parameters<Page['goto']>[1],
) {
  let eventStreamGeneration = 0;
  let responseSequence = 0;
  let settled = false;
  let finishReconciliation!: () => void;
  let failReconciliation!: (error: Error) => void;
  const reconciliationFinished = new Promise<void>((resolve, reject) => {
    finishReconciliation = resolve;
    failReconciliation = reject;
  });
  const boundaries = new Map<string, {
    eventStreamGeneration: number;
    directoryResponseSequence?: number;
    selectedTripId?: string;
    tripResponseSequences: Map<string, number>;
  }>();
  const appliedDirectories: Array<{
    responseSequence: number;
    selectedTripId: string;
  }> = [];
  const appliedTrips: Array<{
    responseSequence: number;
    tripId: string;
  }> = [];
  const boundary = (reconciliationId: string, generation: number) => {
    const existing = boundaries.get(reconciliationId);
    if (existing) return existing;
    const created = {
      eventStreamGeneration: generation,
      tripResponseSequences: new Map<string, number>(),
    };
    boundaries.set(reconciliationId, created);
    return created;
  };
  const tryFinish = (reconciliationId: string) => {
    const candidate = boundaries.get(reconciliationId);
    if (
      !candidate?.selectedTripId
      || candidate.eventStreamGeneration !== eventStreamGeneration
      || candidate.directoryResponseSequence === undefined
    ) return;
    const tripResponseSequence = candidate.tripResponseSequences.get(candidate.selectedTripId);
    if (tripResponseSequence === undefined) return;
    const appliedDirectory = appliedDirectories.find((response) =>
      response.selectedTripId === candidate.selectedTripId
      && response.responseSequence > candidate.directoryResponseSequence!,
    );
    if (!appliedDirectory) return;
    const appliedTrip = appliedTrips.find((response) =>
      response.tripId === candidate.selectedTripId
      && response.responseSequence > tripResponseSequence
      && response.responseSequence > appliedDirectory.responseSequence,
    );
    if (!appliedTrip) return;
    settled = true;
    finishReconciliation();
  };
  const tryFinishCurrentBoundaries = () => {
    boundaries.forEach((_candidate, reconciliationId) => tryFinish(reconciliationId));
  };
  const selectedTripFromDirectory = async (response: Response) => {
    const directory = await response.json() as { trips?: Array<{ id?: unknown }> };
    if (!Array.isArray(directory.trips) || directory.trips.length !== 1) {
      throw new Error('Plotter E2E readiness requires exactly one selected service trip.');
    }
    const selectedTripId = directory.trips[0]?.id;
    if (typeof selectedTripId !== 'string' || selectedTripId.length === 0) {
      throw new Error('Plotter E2E readiness received an invalid selected trip identity.');
    }
    return selectedTripId;
  };
  const recordReconciliationDirectory = async (
    response: Response,
    reconciliationId: string,
    generation: number,
    sequence: number,
  ) => {
    try {
      const selectedTripId = await selectedTripFromDirectory(response);
      const candidate = boundary(reconciliationId, generation);
      candidate.directoryResponseSequence = sequence;
      candidate.selectedTripId = selectedTripId;
      tryFinish(reconciliationId);
    } catch (error) {
      if (!settled) failReconciliation(error instanceof Error ? error : new Error(String(error)));
    }
  };
  const recordAppliedDirectory = async (response: Response, sequence: number) => {
    try {
      appliedDirectories.push({
        responseSequence: sequence,
        selectedTripId: await selectedTripFromDirectory(response),
      });
      tryFinishCurrentBoundaries();
    } catch (error) {
      if (!settled) failReconciliation(error instanceof Error ? error : new Error(String(error)));
    }
  };
  const onResponse = (response: Response) => {
    if (response.request().method() !== 'GET' || !response.ok()) return;
    const pathname = new URL(response.url()).pathname;
    if (pathname === '/plotter/api/v1/events') {
      eventStreamGeneration += 1;
      return;
    }
    if (eventStreamGeneration === 0) return;
    const sequence = ++responseSequence;
    const reconciliationId = response.request().headers()['x-plotter-reconciliation'];
    if (pathname === '/plotter/api/v1/trips') {
      if (reconciliationId) {
        boundary(reconciliationId, eventStreamGeneration).directoryResponseSequence = sequence;
        void recordReconciliationDirectory(
          response,
          reconciliationId,
          eventStreamGeneration,
          sequence,
        );
      } else {
        void recordAppliedDirectory(response, sequence);
      }
      return;
    }
    const tripMatch = pathname.match(/^\/plotter\/api\/v1\/trips\/([^/]+)$/);
    if (!tripMatch) return;
    const tripId = decodeURIComponent(tripMatch[1]!);
    if (reconciliationId) {
      boundary(reconciliationId, eventStreamGeneration).tripResponseSequences.set(tripId, sequence);
      tryFinish(reconciliationId);
    } else {
      appliedTrips.push({ responseSequence: sequence, tripId });
      tryFinishCurrentBoundaries();
    }
  };
  page.on('response', onResponse);
  try {
    const navigation = await page.goto('./', options);
    await reconciliationFinished;
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    }));
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
