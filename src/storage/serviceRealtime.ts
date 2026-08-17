import type { DirectoryReadResponse, TripReadResponse } from '../api/contracts';
import { isCanonicalId } from '../api/identifiers';
import type { PlotterApiClient } from '../api/client';
import type { RevisionEvent, ServiceInvalidation } from './revision';

export type ServiceRealtimeSubscriptions = {
  subscribeToDirectory(onInvalidate: (invalidation: ServiceInvalidation) => void): () => void;
  subscribeToTrip(tripId: string, onInvalidate: (invalidation: ServiceInvalidation) => void): () => void;
  reconcile(): Promise<void>;
};

type RevisionMessageListener = (event: MessageEvent<string>) => void;
type TripInvalidationSubscriber = (invalidation: ServiceInvalidation) => void;
type TripSubscriberRegistrations = Map<TripInvalidationSubscriber, Set<symbol>>;

type TripReconciliation = {
  generation: number;
  promise: Promise<void>;
};

type DirectoryReconciliation = {
  resetId: string;
  promise: Promise<void>;
};

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
  const directorySubscribers = new Map<(invalidation: ServiceInvalidation) => void, number>();
  const tripSubscribers = new Map<string, TripSubscriberRegistrations>();
  const tripSubscriptionGenerations = new Map<string, number>();
  const tripReconciliations = new Map<string, TripReconciliation>();
  const latestStreamRevision = new Map<string, number>();
  const observedResetScopes = new Set<string>();
  const retiredEpochs = new Set<string>();
  const createEventSource = options.createEventSource
    ?? ((url: string) => new EventSource(url) as unknown as EventSourceLike);
  let source: EventSourceLike | null = null;
  let currentEpoch: string | null = null;
  let reconciliationSequence = 0;
  let directoryReconciliation: DirectoryReconciliation | undefined;

  function revisionKey(event: RevisionEvent): string {
    return event.scope === 'directory' ? 'directory' : `trip:${event.tripId}`;
  }

  function validRevision(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  }

  function exactKeys(record: Record<string, unknown>, expected: string[]): boolean {
    const keys = Object.keys(record).sort();
    const expectedKeys = [...expected].sort();
    return keys.length === expectedKeys.length
      && keys.every((key, index) => key === expectedKeys[index]);
  }

  function validEpoch(value: unknown): value is string {
    return typeof value === 'string'
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
  }

  function validTripId(value: unknown): value is string {
    return isCanonicalId(value);
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
    if (
      record.kind === 'revision'
      && record.scope === 'directory'
      && exactKeys(record, ['kind', 'epoch', 'scope', 'revision'])
      && validEpoch(record.epoch)
      && validRevision(record.revision)
    ) {
      return {
        kind: 'revision', epoch: record.epoch, scope: 'directory', revision: record.revision,
      };
    }
    if (
      record.kind === 'revision'
      && record.scope === 'trip'
      && exactKeys(record, ['kind', 'epoch', 'scope', 'tripId', 'revision'])
      && validEpoch(record.epoch)
      && validTripId(record.tripId)
      && validRevision(record.revision)
    ) {
      return {
        kind: 'revision', epoch: record.epoch, scope: 'trip',
        tripId: record.tripId, revision: record.revision,
      };
    }
    if (
      record.kind === 'restore-reset'
      && record.scope === 'directory'
      && exactKeys(record, ['kind', 'epoch', 'scope'])
      && validEpoch(record.epoch)
    ) {
      return { kind: 'restore-reset', epoch: record.epoch, scope: 'directory' };
    }
    if (
      record.kind === 'restore-reset'
      && record.scope === 'trip'
      && exactKeys(record, ['kind', 'epoch', 'scope', 'tripId'])
      && validEpoch(record.epoch)
      && validTripId(record.tripId)
    ) {
      return {
        kind: 'restore-reset', epoch: record.epoch, scope: 'trip', tripId: record.tripId,
      };
    }
    return null;
  }

  function publish(event: RevisionEvent, invalidation: ServiceInvalidation): void {
    if (event.scope === 'directory') {
      directorySubscribers.forEach((_count, subscriber) => subscriber(invalidation));
      return;
    }
    tripSubscribers.get(event.tripId)?.forEach((_registrations, subscriber) => subscriber(invalidation));
  }

  const onRevision = (message: MessageEvent<string>) => {
    const event = parseRevisionEvent(message.data);
    if (!event) return;
    if (event.kind === 'restore-reset') {
      if (event.epoch !== currentEpoch) {
        if (retiredEpochs.has(event.epoch)) return;
        if (currentEpoch) retiredEpochs.add(currentEpoch);
        currentEpoch = event.epoch;
        latestStreamRevision.clear();
        observedResetScopes.clear();
      }
      const resetKey = revisionKey(event);
      if (observedResetScopes.has(resetKey)) return;
      observedResetScopes.add(resetKey);
      publish(event, { kind: 'restore-reset', resetId: event.epoch });
      return;
    }
    if (currentEpoch === null) currentEpoch = event.epoch;
    if (event.epoch !== currentEpoch) return;
    const key = revisionKey(event);
    const priorRevision = latestStreamRevision.get(key);
    if (priorRevision !== undefined && event.revision <= priorRevision) return;
    latestStreamRevision.set(key, event.revision);
    publish(event, event.revision);
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
    nextSource.onopen = () => {
      currentEpoch = null;
      latestStreamRevision.clear();
      observedResetScopes.clear();
      retiredEpochs.clear();
      void reconcile().catch(() => undefined);
    };
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
    currentEpoch = null;
    latestStreamRevision.clear();
    observedResetScopes.clear();
    retiredEpochs.clear();
  }

  function tripGeneration(tripId: string): number {
    return tripSubscriptionGenerations.get(tripId) ?? 0;
  }

  function advanceTripGeneration(tripId: string): void {
    tripSubscriptionGenerations.set(tripId, tripGeneration(tripId) + 1);
  }

  function cleanUnusedTripIdentity(tripId: string): void {
    if (!tripSubscribers.has(tripId) && !tripReconciliations.has(tripId)) {
      tripSubscriptionGenerations.delete(tripId);
    }
  }

  function snapshotTripSubscribers(tripId: string): TripSubscriberRegistrations {
    const snapshot: TripSubscriberRegistrations = new Map();
    tripSubscribers.get(tripId)?.forEach((registrations, subscriber) => {
      snapshot.set(subscriber, new Set(registrations));
    });
    return snapshot;
  }

  function publishCapturedTrip(
    tripId: string,
    captured: TripSubscriberRegistrations,
    invalidation: ServiceInvalidation,
  ): void {
    const current = tripSubscribers.get(tripId);
    if (!current) return;
    captured.forEach((capturedRegistrations, subscriber) => {
      const currentRegistrations = current.get(subscriber);
      if (
        currentRegistrations
        && [...capturedRegistrations].some((registration) => currentRegistrations.has(registration))
      ) subscriber(invalidation);
    });
  }

  function startTripReconciliation(tripId: string, resetId: string): void {
    const subscribers = tripSubscribers.get(tripId);
    if (!subscribers || subscribers.size === 0) return;
    const generation = tripGeneration(tripId);
    if (tripReconciliations.get(tripId)?.generation === generation) return;
    const captured = snapshotTripSubscribers(tripId);
    let request: Promise<TripReadResponse>;
    try {
      request = options.client.request<TripReadResponse>(
        `/api/v1/trips/${encodeURIComponent(tripId)}`,
      );
    } catch (error) {
      request = Promise.reject(error);
    }
    const promise = request.then((trip) => {
      if (!validRevision(trip.revision)) return;
      publishCapturedTrip(tripId, captured, { kind: 'restore-reset', resetId });
    }).catch(() => undefined);
    const reconciliation = { generation, promise };
    tripReconciliations.set(tripId, reconciliation);
    void promise.then(() => {
      if (tripReconciliations.get(tripId) === reconciliation) {
        tripReconciliations.delete(tripId);
        cleanUnusedTripIdentity(tripId);
      }
    });
  }

  function startDirectoryReconciliation(): DirectoryReconciliation {
    const resetId = `reconcile-${++reconciliationSequence}`;
    const directoryReset: RevisionEvent = {
      kind: 'restore-reset',
      epoch: '00000000-0000-4000-8000-000000000000',
      scope: 'directory',
    };
    let request: Promise<DirectoryReadResponse>;
    try {
      request = options.client.request<DirectoryReadResponse>('/api/v1/trips');
    } catch (error) {
      request = Promise.reject(error);
    }
    const reconciliation: DirectoryReconciliation = {
      resetId,
      promise: Promise.resolve(),
    };
    reconciliation.promise = request.then((directory) => {
      if (!validRevision(directory.revision)) {
        throw new Error('Plotter service returned an invalid revision.');
      }
      publish(directoryReset, { kind: 'restore-reset', resetId });
    }).finally(() => {
      if (directoryReconciliation === reconciliation) directoryReconciliation = undefined;
    });
    directoryReconciliation = reconciliation;
    return reconciliation;
  }

  function reconcile(): Promise<void> {
    const directory = directoryReconciliation ?? startDirectoryReconciliation();
    tripSubscribers.forEach((_subscribers, tripId) => {
      startTripReconciliation(tripId, directory.resetId);
    });
    return directory.promise;
  }

  return {
    subscribeToDirectory(onInvalidate) {
      directorySubscribers.set(onInvalidate, (directorySubscribers.get(onInvalidate) ?? 0) + 1);
      ensureSource();
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        const registrationCount = directorySubscribers.get(onInvalidate) ?? 0;
        if (registrationCount <= 1) directorySubscribers.delete(onInvalidate);
        else directorySubscribers.set(onInvalidate, registrationCount - 1);
        closeIfUnused();
      };
    },
    subscribeToTrip(tripId, onInvalidate) {
      const subscribers = tripSubscribers.get(tripId)
        ?? new Map<TripInvalidationSubscriber, Set<symbol>>();
      const registrations = subscribers.get(onInvalidate) ?? new Set<symbol>();
      const registration = Symbol(tripId);
      registrations.add(registration);
      subscribers.set(onInvalidate, registrations);
      tripSubscribers.set(tripId, subscribers);
      advanceTripGeneration(tripId);
      ensureSource();
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        registrations.delete(registration);
        if (registrations.size === 0) subscribers.delete(onInvalidate);
        if (subscribers.size === 0) tripSubscribers.delete(tripId);
        advanceTripGeneration(tripId);
        cleanUnusedTripIdentity(tripId);
        closeIfUnused();
      };
    },
    reconcile,
  };
}
