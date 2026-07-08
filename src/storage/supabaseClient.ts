import { createClient } from '@supabase/supabase-js';

type RuntimeImportMeta = ImportMeta & {
  env?: Record<string, string | undefined>;
};

const runtimeImportMetaEnv = (import.meta as RuntimeImportMeta).env;

function readRuntimeEnv(name: string) {
  const importMetaValue = runtimeImportMetaEnv?.[name];
  if (typeof importMetaValue === 'string' && importMetaValue.length > 0) {
    return importMetaValue;
  }

  if (typeof process !== 'undefined') {
    return process.env[name] ?? '';
  }

  return '';
}

export const supabaseUrl = readRuntimeEnv('VITE_SUPABASE_URL');
export const supabasePublishableKey = readRuntimeEnv('VITE_SUPABASE_PUBLISHABLE_KEY');

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
