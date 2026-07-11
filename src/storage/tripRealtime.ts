import type { SupabaseClient } from '@supabase/supabase-js';

export type TripRealtimeSubscriptions = {
  subscribeToTrips(onChange: () => void): () => void;
  subscribeToTripData(tripId: string, onChange: () => void): () => void;
};

type CancellableDebouncedCallback = (() => void) & { cancel: () => void };

function debounce(callback: () => void, delayMs: number): CancellableDebouncedCallback {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const debounced = () => {
    if (timer) clearTimeout(timer);

    timer = setTimeout(() => {
      timer = null;
      callback();
    }, delayMs);
  };

  debounced.cancel = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
  };

  return debounced;
}

export function createSupabaseTripRealtime(supabase: SupabaseClient): TripRealtimeSubscriptions {
  return {
    subscribeToTrips(onChange) {
      const channel = supabase
        .channel('plotter-trips')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'trips' }, onChange)
        .subscribe();

      return () => {
        void supabase.removeChannel(channel);
      };
    },

    subscribeToTripData(tripId, onChange) {
      const debounced = debounce(onChange, 150);
      const channel = supabase
        .channel(`plotter-trip-${tripId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'destinations', filter: `trip_id=eq.${tripId}` }, debounced)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'route_legs', filter: `trip_id=eq.${tripId}` }, debounced)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'activities', filter: `trip_id=eq.${tripId}` }, debounced)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'media_assets', filter: `trip_id=eq.${tripId}` }, debounced)
        .subscribe();

      return () => {
        debounced.cancel();
        void supabase.removeChannel(channel);
      };
    },
  };
}
