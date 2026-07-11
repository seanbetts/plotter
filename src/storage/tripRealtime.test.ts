import { describe, expect, it, vi } from 'vitest';
import { createSupabaseTripRealtime } from './tripRealtime';

function createSupabaseMock() {
  const handlers: Array<(payload?: unknown) => void> = [];
  const channel = {
    on: vi.fn((_event, _filter, callback) => {
      handlers.push(callback as (payload?: unknown) => void);
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

    expect(supabase.channel).toHaveBeenCalledWith('plotter-trips');
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

  it('debounces destination anchor and recovered route warning updates into one refresh', () => {
    vi.useFakeTimers();
    const { supabase, handlers } = createSupabaseMock();
    const onChange = vi.fn();
    createSupabaseTripRealtime(supabase as never).subscribeToTripData('trip-id', onChange);

    handlers[0]({
      eventType: 'UPDATE',
      new: {
        id: 'alta',
        routing_anchors: {
          'driving-car': {
            profile: 'driving-car',
            coordinates: { lat: 69.98334, lng: 23.27165 },
            originalCoordinates: { lat: 69.96887, lng: 23.27165 },
            snapDistanceKm: 1.609,
            provider: 'openrouteservice',
            resolvedAt: '2026-07-11T00:00:00.000Z',
          },
        },
      },
    });
    handlers[1]({
      eventType: 'UPDATE',
      new: {
        id: 'olderdalen-alta',
        status: 'ready',
        warnings: [{
          code: 'ROUTING_ANCHOR_ADJUSTED',
          message: 'Route target uses a routing point 1.6 km from the stop.',
        }],
      },
    });

    vi.advanceTimersByTime(149);
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('cancels pending active trip data callbacks on unsubscribe', () => {
    vi.useFakeTimers();
    const { supabase, handlers } = createSupabaseMock();
    const onChange = vi.fn();
    const unsubscribe = createSupabaseTripRealtime(supabase as never).subscribeToTripData('trip-id', onChange);

    handlers[0]();
    unsubscribe();

    vi.advanceTimersByTime(150);

    expect(onChange).not.toHaveBeenCalled();
    expect(supabase.removeChannel).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
