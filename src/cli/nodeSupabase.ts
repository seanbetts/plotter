import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

export function createNodeSupabaseClient() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? '';
  const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';

  if (!supabaseUrl || !publishableKey) {
    throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.');
  }

  return createClient(supabaseUrl, publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

export async function ensureNodeAnonymousSession(
  supabase: ReturnType<typeof createNodeSupabaseClient>,
) {
  const existing = await supabase.auth.getUser();
  if (existing.data.user) {
    return existing.data.user;
  }

  const created = await supabase.auth.signInAnonymously();
  if (created.error || !created.data.user) {
    throw new Error(created.error?.message || 'Unable to create anonymous Supabase session.');
  }

  return created.data.user;
}
