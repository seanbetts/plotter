import { describe, expect, it, vi } from 'vitest';
import { ensureNodeAnonymousSession } from './nodeSupabase';

describe('ensureNodeAnonymousSession', () => {
  it('creates an anonymous session when getUser reports no current auth session', async () => {
    const createdUser = { id: 'anon-user' };
    const supabase = {
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: null },
          error: { message: 'Auth session missing!' },
        })),
        signInAnonymously: vi.fn(async () => ({
          data: { user: createdUser },
          error: null,
        })),
      },
    };

    await expect(ensureNodeAnonymousSession(supabase as never)).resolves.toEqual(createdUser);
    expect(supabase.auth.signInAnonymously).toHaveBeenCalledTimes(1);
  });
});
