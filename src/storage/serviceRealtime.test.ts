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
  it('shares one hosted-path EventSource, filters duplicate revisions, and closes it once', () => {
    const harness = createEventSourceHarness();
    const realtime = createServiceRealtime({
      baseUrl: '/plotter/',
      client: createClient(),
      createEventSource: harness.createEventSource,
    });
    const directoryRevisions: number[] = [];
    const tripRevisions: number[] = [];

    const unsubscribeDirectory = realtime.subscribeToDirectory((revision) => directoryRevisions.push(revision));
    const unsubscribeTrip = realtime.subscribeToTrip('trip-1', (revision) => tripRevisions.push(revision));

    expect(harness.createEventSource).toHaveBeenCalledTimes(1);
    expect(harness.createEventSource).toHaveBeenCalledWith('/plotter/api/v1/events');

    harness.emit({ scope: 'directory', revision: 4 });
    harness.emit({ scope: 'directory', revision: 4 });
    harness.emit({ scope: 'directory', revision: 3 });
    harness.emit({ scope: 'trip', tripId: 'trip-1', revision: 7 });
    harness.emit({ scope: 'trip', tripId: 'trip-2', revision: 9 });
    harness.emit({ scope: 'trip', tripId: 'trip-1', revision: 6 });
    harness.emitRaw('{');
    harness.emit({ scope: 'trip', tripId: 'trip-1', revision: -1 });

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
    harness.emit({ scope: 'directory', revision: 1 });
    expect(onDirectory).toHaveBeenCalledTimes(1);

    unsubscribeFirst();
    harness.emit({ scope: 'directory', revision: 2 });
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
    const directoryRevisions: number[] = [];
    const tripRevisions: number[] = [];
    realtime.subscribeToDirectory((revision) => directoryRevisions.push(revision));
    realtime.subscribeToTrip('trip-1', (revision) => tripRevisions.push(revision));

    await realtime.reconcile();

    expect(client.request).toHaveBeenCalledWith('/api/v1/trips');
    expect(client.request).toHaveBeenCalledWith('/api/v1/trips/trip-1');
    expect(directoryRevisions).toEqual([8]);
    expect(tripRevisions).toEqual([13]);
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
    await vi.waitFor(() => expect(onDirectory).toHaveBeenCalledWith(8));
    harness.open();
    await vi.waitFor(() => expect(onDirectory).toHaveBeenCalledTimes(2));
  });
});
