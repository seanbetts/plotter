import { randomUUID } from 'node:crypto';
import type { RevisionChange, RevisionEvent } from '../src/storage/revision';

export type RevisionEventListener = (event: RevisionEvent) => void;

export type RevisionEventBus = {
  publish(event: RevisionChange): void;
  restoreReset(input: { epoch: string; tripIds: string[] }): void;
  subscribe(listener: RevisionEventListener): () => void;
};

export function createRevisionEventBus(options: { initialEpoch?: string } = {}): RevisionEventBus {
  const listeners = new Set<RevisionEventListener>();
  let epoch = options.initialEpoch ?? randomUUID();

  function notify(event: RevisionEvent): void {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch {
        // A disconnected event consumer must not turn a committed write into a failure.
      }
    }
  }

  return {
    publish(event) {
      notify({ kind: 'revision', epoch, ...event });
    },
    restoreReset(input) {
      epoch = input.epoch;
      notify({ kind: 'restore-reset', epoch, scope: 'directory' });
      for (const tripId of [...new Set(input.tripIds)].sort()) {
        notify({ kind: 'restore-reset', epoch, scope: 'trip', tripId });
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
