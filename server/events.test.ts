import { describe, expect, it, vi } from 'vitest';
import type { RevisionEvent } from '../src/storage/revision';
import { createRevisionEventBus } from './events';

describe('createRevisionEventBus', () => {
  it('types ordinary revisions with the current epoch and rotates it for restore resets', () => {
    const events = createRevisionEventBus({
      initialEpoch: '00000000-0000-4000-8000-000000000001',
    });
    const received: RevisionEvent[] = [];
    events.subscribe((event) => received.push(event));

    events.publish({ scope: 'directory', revision: 9 });
    events.restoreReset({
      epoch: '00000000-0000-4000-8000-000000000002',
      tripIds: ['trip-removed', 'trip-restored'],
    });
    events.publish({ scope: 'trip', tripId: 'trip-restored', revision: 3 });

    expect(received).toEqual([
      {
        kind: 'revision', epoch: '00000000-0000-4000-8000-000000000001',
        scope: 'directory', revision: 9,
      },
      {
        kind: 'restore-reset', epoch: '00000000-0000-4000-8000-000000000002',
        scope: 'directory',
      },
      {
        kind: 'restore-reset', epoch: '00000000-0000-4000-8000-000000000002',
        scope: 'trip', tripId: 'trip-removed',
      },
      {
        kind: 'restore-reset', epoch: '00000000-0000-4000-8000-000000000002',
        scope: 'trip', tripId: 'trip-restored',
      },
      {
        kind: 'revision', epoch: '00000000-0000-4000-8000-000000000002',
        scope: 'trip', tripId: 'trip-restored', revision: 3,
      },
    ]);
  });

  it('publishes each invalidation event to every current subscriber', () => {
    const events = createRevisionEventBus({ initialEpoch: '00000000-0000-4000-8000-000000000001' });
    const first: RevisionEvent[] = [];
    const second: RevisionEvent[] = [];
    events.subscribe((event) => first.push(event));
    events.subscribe((event) => second.push(event));

    events.publish({ scope: 'directory', revision: 4 });
    events.publish({ scope: 'trip', tripId: 'trip-aurora', revision: 9 });

    expect(first).toEqual([
      {
        kind: 'revision', epoch: '00000000-0000-4000-8000-000000000001',
        scope: 'directory', revision: 4,
      },
      {
        kind: 'revision', epoch: '00000000-0000-4000-8000-000000000001',
        scope: 'trip', tripId: 'trip-aurora', revision: 9,
      },
    ]);
    expect(second).toEqual(first);
  });

  it('stops publishing to a subscriber after its unsubscribe function runs', () => {
    const events = createRevisionEventBus();
    const listener = vi.fn();
    const unsubscribe = events.subscribe(listener);

    unsubscribe();
    events.publish({ scope: 'directory', revision: 1 });

    expect(listener).not.toHaveBeenCalled();
  });

  it('allows healthy subscribers to receive an event when another subscriber throws', () => {
    const events = createRevisionEventBus({ initialEpoch: '00000000-0000-4000-8000-000000000001' });
    const received: RevisionEvent[] = [];
    events.subscribe(() => {
      throw new Error('listener failed');
    });
    events.subscribe((event) => received.push(event));

    expect(() => events.publish({ scope: 'directory', revision: 2 })).not.toThrow();
    expect(received).toEqual([{
      kind: 'revision', epoch: '00000000-0000-4000-8000-000000000001',
      scope: 'directory', revision: 2,
    }]);
  });
});
