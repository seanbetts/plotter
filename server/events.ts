import type { RevisionEvent } from '../src/storage/revision';

export type RevisionEventListener = (event: RevisionEvent) => void;

export type RevisionEventBus = {
  publish(event: RevisionEvent): void;
  subscribe(listener: RevisionEventListener): () => void;
};

export function createRevisionEventBus(): RevisionEventBus {
  const listeners = new Set<RevisionEventListener>();

  return {
    publish(event) {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch {
          // A disconnected event consumer must not turn a committed write into a failure.
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
