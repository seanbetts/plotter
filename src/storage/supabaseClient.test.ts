import { createClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ auth: {} })),
}));

describe('Supabase browser client', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'publishable-key');
  });

  it('reuses one browser client across repeated calls', async () => {
    const { createBrowserSupabaseClient } = await import('./supabaseClient');

    const firstClient = createBrowserSupabaseClient();
    const secondClient = createBrowserSupabaseClient();

    expect(firstClient).toBe(secondClient);
    expect(createClient).toHaveBeenCalledTimes(1);
  });
});
