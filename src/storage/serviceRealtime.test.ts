import { describe, expect, it, vi } from 'vitest';
import type { PlotterApiClient } from '../api/client';
import { createServiceRealtime } from './serviceRealtime';

type EventListener = (event: MessageEvent<string>) => void;

function createEventSourceHarness() {
  const listeners = new Map<string, Set<EventListener>>();
  const source = {
    close: vi.fn(),
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      const typeListeners = listeners.get(type) ?? new Set<EventListener>();
      typeListeners.add(listener);
      listeners.set(type, typeListeners);
    }),
    removeEventListener: vi.fn((type: string, listener: EventListener) => {
      listeners.get(type)?.delete(listener);
    }),
    onopen: null as (() => void) | null,
  };
  const createEventSource = vi.fn(() => source);

  return {
    source,
    createEventSource,
    open() { source.onopen?.(); },
    emit(value: unknown) {
      const event = new MessageEvent('revision', { data: JSON.stringify(value) });
      listeners.get('revision')?.forEach((listener) => listener(event));
    },
    emitRaw(data: string) {
      const event = new MessageEvent('revision', { data });
      listeners.get('revision')?.forEach((listener) => listener(event));
    },
  };
}

function createClient(): PlotterApiClient {
  return {
    request: vi.fn(async (path: string) => {
      if (path === '/api/v1/trips') return { revision: 8, trips: [] };
      if (path === '/api/v1/trips/trip-1') {
        return { revision: 13, destinations: [], routeLegs: [], activities: [] };
      }
      throw new Error(`Unexpected request: ${path}`);
    }) as PlotterApiClient['request'],
    upload: vi.fn(),
  };
}

describe('service realtime', () => {
  it('forces reset reloads across lower revisions and ignores stale events from retired epochs', () => {
    const harness = createEventSourceHarness();
    const realtime = createServiceRealtime({
      baseUrl: '/',
      client: createClient(),
      createEventSource: harness.createEventSource,
    });
    const directoryInvalidations: unknown[] = [];
    const removedTripInvalidations: unknown[] = [];
    realtime.subscribeToDirectory((invalidation: unknown) => directoryInvalidations.push(invalidation));
    realtime.subscribeToTrip(
      'trip-removed',
      (invalidation: unknown) => removedTripInvalidations.push(invalidation),
    );

    harness.emit({
      kind: 'revision', epoch: '00000000-0000-4000-8000-000000000001',
      scope: 'directory', revision: 10,
    });
    harness.emit({
      kind: 'restore-reset', epoch: '00000000-0000-4000-8000-000000000002',
      scope: 'directory',
    });
    harness.emit({
      kind: 'restore-reset', epoch: '00000000-0000-4000-8000-000000000002',
      scope: 'directory',
    });
    harness.emit({
      kind: 'restore-reset', epoch: '00000000-0000-4000-8000-000000000002',
      scope: 'trip', tripId: 'trip-removed',
    });
    harness.emit({
      kind: 'revision', epoch: '00000000-0000-4000-8000-000000000001',
      scope: 'directory', revision: 11,
    });
    harness.emit({
      kind: 'revision', epoch: '00000000-0000-4000-8000-000000000002',
      scope: 'directory', revision: 3,
    });

    expect(directoryInvalidations).toEqual([
      10,
      { kind: 'restore-reset', resetId: '00000000-0000-4000-8000-000000000002' },
      3,
    ]);
    expect(removedTripInvalidations).toEqual([
      { kind: 'restore-reset', resetId: '00000000-0000-4000-8000-000000000002' },
    ]);
  });

  it('rejects non-exact revision and restore-reset wire payloads', () => {
    const harness = createEventSourceHarness();
    const realtime = createServiceRealtime({
      baseUrl: '/', client: createClient(), createEventSource: harness.createEventSource,
    });
    const invalidations: unknown[] = [];
    realtime.subscribeToDirectory((invalidation: unknown) => invalidations.push(invalidation));

    harness.emit({
      kind: 'revision', epoch: '00000000-0000-4000-8000-000000000001',
      scope: 'directory', revision: 1, extra: true,
    });
    harness.emit({
      kind: 'restore-reset', epoch: 'not-an-epoch', scope: 'directory',
    });
    harness.emit({
      kind: 'restore-reset', epoch: '00000000-0000-4000-8000-000000000001',
      scope: 'directory', revision: 0,
    });

    expect(invalidations).toEqual([]);
  });

  it('shares one hosted-path EventSource, filters duplicate revisions, and closes it once', () => {
    const harness = createEventSourceHarness();
    const realtime = createServiceRealtime({
      baseUrl: '/plotter/',
      client: createClient(),
      createEventSource: harness.createEventSource,
    });
    const directoryRevisions: unknown[] = [];
    const tripRevisions: unknown[] = [];

    const unsubscribeDirectory = realtime.subscribeToDirectory((revision) => directoryRevisions.push(revision));
    const unsubscribeTrip = realtime.subscribeToTrip('trip-1', (revision) => tripRevisions.push(revision));

    expect(harness.createEventSource).toHaveBeenCalledTimes(1);
    expect(harness.createEventSource).toHaveBeenCalledWith('/plotter/api/v1/events');

    const epoch = '00000000-0000-4000-8000-000000000001';
    harness.emit({ kind: 'revision', epoch, scope: 'directory', revision: 4 });
    harness.emit({ kind: 'revision', epoch, scope: 'directory', revision: 4 });
    harness.emit({ kind: 'revision', epoch, scope: 'directory', revision: 3 });
    harness.emit({ kind: 'revision', epoch, scope: 'trip', tripId: 'trip-1', revision: 7 });
    harness.emit({ kind: 'revision', epoch, scope: 'trip', tripId: 'trip-2', revision: 9 });
    harness.emit({ kind: 'revision', epoch, scope: 'trip', tripId: 'trip-1', revision: 6 });
    harness.emitRaw('{');
    harness.emit({ kind: 'revision', epoch, scope: 'trip', tripId: 'trip-1', revision: -1 });

    expect(directoryRevisions).toEqual([4]);
    expect(tripRevisions).toEqual([7]);

    unsubscribeDirectory();
    expect(harness.source.close).not.toHaveBeenCalled();
    unsubscribeTrip();
    unsubscribeTrip();
    expect(harness.source.close).toHaveBeenCalledTimes(1);
  });

  it('keeps duplicate callback registrations independently disposable', () => {
    const harness = createEventSourceHarness();
    const realtime = createServiceRealtime({
      baseUrl: '/',
      client: createClient(),
      createEventSource: harness.createEventSource,
    });
    const onDirectory = vi.fn();

    const unsubscribeFirst = realtime.subscribeToDirectory(onDirectory);
    const unsubscribeSecond = realtime.subscribeToDirectory(onDirectory);
    const epoch = '00000000-0000-4000-8000-000000000001';
    harness.emit({ kind: 'revision', epoch, scope: 'directory', revision: 1 });
    expect(onDirectory).toHaveBeenCalledTimes(1);

    unsubscribeFirst();
    harness.emit({ kind: 'revision', epoch, scope: 'directory', revision: 2 });
    expect(onDirectory).toHaveBeenCalledTimes(2);
    expect(harness.source.close).not.toHaveBeenCalled();

    unsubscribeSecond();
    expect(harness.source.close).toHaveBeenCalledTimes(1);
  });

  it('reconciles the directory and every subscribed trip against authoritative snapshots', async () => {
    const harness = createEventSourceHarness();
    const client = createClient();
    const realtime = createServiceRealtime({
      baseUrl: '/',
      client,
      createEventSource: harness.createEventSource,
    });
    const directoryRevisions: unknown[] = [];
    const tripRevisions: unknown[] = [];
    realtime.subscribeToDirectory((revision) => directoryRevisions.push(revision));
    realtime.subscribeToTrip('trip-1', (revision) => tripRevisions.push(revision));

    await realtime.reconcile();

    expect(client.request).toHaveBeenCalledWith('/api/v1/trips');
    expect(client.request).toHaveBeenCalledWith('/api/v1/trips/trip-1');
    expect(directoryRevisions).toEqual([{ kind: 'restore-reset', resetId: 'reconcile-1' }]);
    expect(tripRevisions).toEqual([{ kind: 'restore-reset', resetId: 'reconcile-1' }]);
  });

  it('still resets the directory and other trips when a removed subscribed trip returns 404', async () => {
    const client: PlotterApiClient = {
      request: vi.fn(async (path: string) => {
        if (path === '/api/v1/trips') return { revision: 3, trips: [] };
        if (path === '/api/v1/trips/trip-present') {
          return { revision: 5, destinations: [], routeLegs: [], activities: [] };
        }
        if (path === '/api/v1/trips/trip-removed') throw new Error('HTTP 404');
        throw new Error(`Unexpected request: ${path}`);
      }) as PlotterApiClient['request'],
      upload: vi.fn(),
    };
    const realtime = createServiceRealtime({
      baseUrl: '/', client, createEventSource: createEventSourceHarness().createEventSource,
    });
    const directory = vi.fn();
    const present = vi.fn();
    const removed = vi.fn();
    realtime.subscribeToDirectory(directory);
    realtime.subscribeToTrip('trip-present', present);
    realtime.subscribeToTrip('trip-removed', removed);

    await expect(realtime.reconcile()).resolves.toBeUndefined();

    expect(directory).toHaveBeenCalledWith({ kind: 'restore-reset', resetId: 'reconcile-1' });
    expect(present).toHaveBeenCalledWith({ kind: 'restore-reset', resetId: 'reconcile-1' });
    expect(removed).not.toHaveBeenCalled();
  });

  it('does not let one subscribed trip network failure suppress successful reconciliation', async () => {
    const client: PlotterApiClient = {
      request: vi.fn(async (path: string) => {
        if (path === '/api/v1/trips') return { revision: 7, trips: [] };
        if (path === '/api/v1/trips/trip-present') {
          return { revision: 9, destinations: [], routeLegs: [], activities: [] };
        }
        if (path === '/api/v1/trips/trip-offline') throw new TypeError('network unavailable');
        throw new Error(`Unexpected request: ${path}`);
      }) as PlotterApiClient['request'],
      upload: vi.fn(),
    };
    const realtime = createServiceRealtime({
      baseUrl: '/', client, createEventSource: createEventSourceHarness().createEventSource,
    });
    const directory = vi.fn();
    const present = vi.fn();
    const offline = vi.fn();
    realtime.subscribeToDirectory(directory);
    realtime.subscribeToTrip('trip-present', present);
    realtime.subscribeToTrip('trip-offline', offline);

    await expect(realtime.reconcile()).resolves.toBeUndefined();

    expect(directory).toHaveBeenCalledWith({ kind: 'restore-reset', resetId: 'reconcile-1' });
    expect(present).toHaveBeenCalledWith({ kind: 'restore-reset', resetId: 'reconcile-1' });
    expect(offline).not.toHaveBeenCalled();
  });

  it('publishes the authoritative directory reset before a slow trip request settles', async () => {
    let rejectSlowTrip: ((error: Error) => void) | undefined;
    const slowTrip = new Promise<never>((_resolve, reject) => { rejectSlowTrip = reject; });
    const client: PlotterApiClient = {
      request: vi.fn(async (path: string) => {
        if (path === '/api/v1/trips') return { revision: 11, trips: [] };
        if (path === '/api/v1/trips/trip-slow') return slowTrip;
        throw new Error(`Unexpected request: ${path}`);
      }) as PlotterApiClient['request'],
      upload: vi.fn(),
    };
    const realtime = createServiceRealtime({
      baseUrl: '/', client, createEventSource: createEventSourceHarness().createEventSource,
    });
    const directory = vi.fn();
    realtime.subscribeToDirectory(directory);
    realtime.subscribeToTrip('trip-slow', vi.fn());

    const reconciliation = realtime.reconcile();
    await vi.waitFor(() => expect(client.request).toHaveBeenCalledTimes(2));
    const publishedBeforeTripSettled = directory.mock.calls.length > 0;
    rejectSlowTrip?.(new Error('eventual timeout'));
    await reconciliation;

    expect(publishedBeforeTripSettled).toBe(true);
  });

  it('reconciles after EventSource opens so reconnects recover missed events', async () => {
    const harness = createEventSourceHarness();
    const client = createClient();
    const realtime = createServiceRealtime({
      baseUrl: '/',
      client,
      createEventSource: harness.createEventSource,
    });
    const onDirectory = vi.fn();
    realtime.subscribeToDirectory(onDirectory);

    harness.open();
    await vi.waitFor(() => expect(onDirectory).toHaveBeenCalledWith({
      kind: 'restore-reset', resetId: 'reconcile-1',
    }));
    harness.open();
    await vi.waitFor(() => expect(onDirectory).toHaveBeenCalledTimes(2));
    expect(onDirectory).toHaveBeenLastCalledWith({ kind: 'restore-reset', resetId: 'reconcile-2' });
  });
});
