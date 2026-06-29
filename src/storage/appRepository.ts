import { createBrowserSupabaseClient, isSupabaseConfigured as defaultIsSupabaseConfigured } from './supabaseClient';
import { createSupabaseTripRepository } from './supabaseTripRepository';
import type { TripRepository } from './tripRepository';

type BrowserSupabaseClient = ReturnType<typeof createBrowserSupabaseClient>;

type SupabaseUser = {
  id: string;
};

type SupabaseAuthResponse = {
  data: {
    user: SupabaseUser | null;
  };
  error: {
    message: string;
  } | null;
};

type SupabaseAuthClient = {
  auth: {
    getUser(): Promise<SupabaseAuthResponse>;
    signInAnonymously(): Promise<SupabaseAuthResponse>;
  };
};

type CreateAppTripRepositoryOptions = {
  isSupabaseConfigured?: boolean;
  tripStorageMode?: string;
  localRepository?: TripRepository;
  createSupabaseClient?: () => SupabaseAuthClient;
  createSupabaseRepository?: (supabase: SupabaseAuthClient) => TripRepository;
};

export async function ensureAnonymousSession(supabase: SupabaseAuthClient) {
  const existingUser = await supabase.auth.getUser();

  if (existingUser.data.user) {
    return existingUser.data.user;
  }

  const anonymousUser = await supabase.auth.signInAnonymously();

  if (anonymousUser.error || !anonymousUser.data.user) {
    throw new Error(anonymousUser.error?.message || 'Unable to create an anonymous Supabase session.');
  }

  return anonymousUser.data.user;
}

export async function createAppTripRepository(options: CreateAppTripRepositoryOptions = {}) {
  const isSupabaseConfigured = options.isSupabaseConfigured ?? defaultIsSupabaseConfigured;

  if (!isSupabaseConfigured) {
    throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.');
  }

  const createSupabaseClient = options.createSupabaseClient ?? createBrowserSupabaseClient;
  const supabase = createSupabaseClient();
  await ensureAnonymousSession(supabase);

  return options.createSupabaseRepository
    ? options.createSupabaseRepository(supabase)
    : createSupabaseTripRepository(supabase as BrowserSupabaseClient);
}
