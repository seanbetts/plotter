import { describe, expect, it, vi } from 'vitest';
import type { RevisionEvent } from '../src/storage/revision';
import { createRevisionEventBus } from './events';

describe('createRevisionEventBus', () => {
  it('publishes each invalidation event to every current subscriber', () => {
    const events = createRevisionEventBus();
    const first: RevisionEvent[] = [];
    const second: RevisionEvent[] = [];
    events.subscribe((event) => first.push(event));
    events.subscribe((event) => second.push(event));

    events.publish({ scope: 'directory', revision: 4 });
    events.publish({ scope: 'trip', tripId: 'trip-aurora', revision: 9 });

    expect(first).toEqual([
      { scope: 'directory', revision: 4 },
      { scope: 'trip', tripId: 'trip-aurora', revision: 9 },
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
    const events = createRevisionEventBus();
    const received: RevisionEvent[] = [];
    events.subscribe(() => {
      throw new Error('listener failed');
    });
    events.subscribe((event) => received.push(event));

    expect(() => events.publish({ scope: 'directory', revision: 2 })).not.toThrow();
    expect(received).toEqual([{ scope: 'directory', revision: 2 }]);
  });
});
