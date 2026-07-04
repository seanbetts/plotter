import { createClient } from '@supabase/supabase-js';

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? '';
export const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);

let browserSupabaseClient: ReturnType<typeof createClient> | null = null;

export function createBrowserSupabaseClient() {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.');
  }

  browserSupabaseClient ??= createClient(supabaseUrl, supabasePublishableKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true,
    },
  });

  return browserSupabaseClient;
}
