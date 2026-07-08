import { describe, expect, it, vi } from 'vitest';
import { createSupabaseTripRealtime } from './tripRealtime';

function createSupabaseMock() {
  const handlers: Array<() => void> = [];
  const channel = {
    on: vi.fn((_event, _filter, callback) => {
      handlers.push(callback as () => void);
      return channel;
    }),
    subscribe: vi.fn(() => channel),
  };
  return {
    handlers,
    supabase: {
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(),
    },
    channel,
  };
}

describe('trip realtime', () => {
  it('subscribes to trip table changes', () => {
    const { supabase, handlers } = createSupabaseMock();
    const onChange = vi.fn();
    const unsubscribe = createSupabaseTripRealtime(supabase as never).subscribeToTrips(onChange);

    expect(supabase.channel).toHaveBeenCalledWith('world-tour-trips');
    handlers[0]();
    expect(onChange).toHaveBeenCalledTimes(1);
    unsubscribe();
    expect(supabase.removeChannel).toHaveBeenCalled();
  });

  it('debounces bursts for active trip data changes', () => {
    vi.useFakeTimers();
    const { supabase, handlers } = createSupabaseMock();
    const onChange = vi.fn();
    createSupabaseTripRealtime(supabase as never).subscribeToTripData('trip-id', onChange);

    handlers.forEach((handler) => handler());
    vi.advanceTimersByTime(149);
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
