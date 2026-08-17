import type { DirectoryReadResponse, TripReadResponse } from '../api/contracts';
import type { PlotterApiClient } from '../api/client';
import type { RevisionEvent } from './revision';

export type ServiceRealtimeSubscriptions = {
  subscribeToDirectory(onInvalidate: (revision: number) => void): () => void;
  subscribeToTrip(tripId: string, onInvalidate: (revision: number) => void): () => void;
  reconcile(): Promise<void>;
};

type RevisionMessageListener = (event: MessageEvent<string>) => void;

type EventSourceLike = {
  addEventListener(type: 'revision', listener: RevisionMessageListener): void;
  removeEventListener(type: 'revision', listener: RevisionMessageListener): void;
  close(): void;
  onopen: (() => void) | null;
};

export type CreateServiceRealtimeOptions = {
  baseUrl: string;
  client: PlotterApiClient;
  createEventSource?: (url: string) => EventSourceLike;
};

export function createServiceRealtime(
  options: CreateServiceRealtimeOptions,
): ServiceRealtimeSubscriptions {
  const directorySubscribers = new Set<(revision: number) => void>();
  const tripSubscribers = new Map<string, Set<(revision: number) => void>>();
  const latestStreamRevision = new Map<string, number>();
  const createEventSource = options.createEventSource
    ?? ((url: string) => new EventSource(url) as unknown as EventSourceLike);
  let source: EventSourceLike | null = null;

  function revisionKey(event: RevisionEvent): string {
    return event.scope === 'directory' ? 'directory' : `trip:${event.tripId}`;
  }

  function validRevision(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  }

  function parseRevisionEvent(data: string): RevisionEvent | null {
    let value: unknown;
    try {
      value = JSON.parse(data);
    } catch {
      return null;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (record.scope === 'directory' && validRevision(record.revision)) {
      return { scope: 'directory', revision: record.revision };
    }
    if (
      record.scope === 'trip'
      && typeof record.tripId === 'string'
      && record.tripId.length > 0
      && validRevision(record.revision)
    ) {
      return { scope: 'trip', tripId: record.tripId, revision: record.revision };
    }
    return null;
  }

  function publish(event: RevisionEvent): void {
    if (event.scope === 'directory') {
      directorySubscribers.forEach((subscriber) => subscriber(event.revision));
      return;
    }
    tripSubscribers.get(event.tripId)?.forEach((subscriber) => subscriber(event.revision));
  }

  const onRevision = (message: MessageEvent<string>) => {
    const event = parseRevisionEvent(message.data);
    if (!event) return;
    const key = revisionKey(event);
    const priorRevision = latestStreamRevision.get(key);
    if (priorRevision !== undefined && event.revision <= priorRevision) return;
    latestStreamRevision.set(key, event.revision);
    publish(event);
  };

  function eventUrl(): string {
    const basePath = options.baseUrl === '/' ? '' : options.baseUrl.replace(/\/+$/, '');
    if (!options.baseUrl.startsWith('/')) {
      const url = new URL(options.baseUrl);
      url.pathname = `${url.pathname.replace(/\/+$/, '')}/api/v1/events`;
      return url.toString();
    }
    return `${basePath}/api/v1/events`;
  }

  function ensureSource(): void {
    if (source) return;
    const nextSource = createEventSource(eventUrl());
    nextSource.addEventListener('revision', onRevision);
    nextSource.onopen = () => { void reconcile().catch(() => undefined); };
    source = nextSource;
  }

  function hasSubscribers(): boolean {
    if (directorySubscribers.size > 0) return true;
    return [...tripSubscribers.values()].some((subscribers) => subscribers.size > 0);
  }

  function closeIfUnused(): void {
    if (!source || hasSubscribers()) return;
    const closingSource = source;
    source = null;
    closingSource.onopen = null;
    closingSource.removeEventListener('revision', onRevision);
    closingSource.close();
    latestStreamRevision.clear();
  }

  async function reconcile(): Promise<void> {
    const tripIds = [...tripSubscribers.keys()];
    const [directory, ...trips] = await Promise.all([
      options.client.request<DirectoryReadResponse>('/api/v1/trips'),
      ...tripIds.map((tripId) =>
        options.client.request<TripReadResponse>(`/api/v1/trips/${encodeURIComponent(tripId)}`)),
    ]);
    if (!validRevision(directory.revision)) throw new Error('Plotter service returned an invalid revision.');
    publish({ scope: 'directory', revision: directory.revision });
    trips.forEach((trip, index) => {
      if (!validRevision(trip.revision)) throw new Error('Plotter service returned an invalid revision.');
      publish({ scope: 'trip', tripId: tripIds[index], revision: trip.revision });
    });
  }

  return {
    subscribeToDirectory(onInvalidate) {
      directorySubscribers.add(onInvalidate);
      ensureSource();
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        directorySubscribers.delete(onInvalidate);
        closeIfUnused();
      };
    },
    subscribeToTrip(tripId, onInvalidate) {
      const subscribers = tripSubscribers.get(tripId) ?? new Set<(revision: number) => void>();
      subscribers.add(onInvalidate);
      tripSubscribers.set(tripId, subscribers);
      ensureSource();
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        subscribers.delete(onInvalidate);
        if (subscribers.size === 0) tripSubscribers.delete(tripId);
        closeIfUnused();
      };
    },
    reconcile,
  };
}
