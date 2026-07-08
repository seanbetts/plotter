import { describe, expect, it, vi } from 'vitest';
import { ensureNodeAnonymousSession } from './nodeSupabase';

describe('ensureNodeAnonymousSession', () => {
  it('creates an anonymous session when getUser reports no current auth session', async () => {
    const createdUser = { id: 'anon-user' };
    const sessionStore = {
      read: vi.fn(async () => null),
      write: vi.fn(),
      clear: vi.fn(),
    };
    const supabase = {
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: null },
          error: { message: 'Auth session missing!' },
        })),
        getSession: vi.fn(async () => ({
          data: { session: null },
          error: null,
        })),
        signInAnonymously: vi.fn(async () => ({
          data: { user: createdUser, session: null },
          error: null,
        })),
      },
    };

    await expect(ensureNodeAnonymousSession(supabase as never, { sessionStore })).resolves.toEqual(createdUser);
    expect(supabase.auth.signInAnonymously).toHaveBeenCalledTimes(1);
  });

  it('restores a cached session before creating a new anonymous user', async () => {
    const cachedUser = { id: 'cached-user' };
    const sessionStore = {
      read: vi.fn(async () => ({
        access_token: 'cached-access-token',
        refresh_token: 'cached-refresh-token',
      })),
      write: vi.fn(),
      clear: vi.fn(),
    };
    const supabase = {
      auth: {
        setSession: vi.fn(async () => ({
          data: { session: { access_token: 'cached-access-token', refresh_token: 'cached-refresh-token' } },
          error: null,
        })),
        getUser: vi.fn(async () => ({
          data: { user: cachedUser },
          error: null,
        })),
        signInAnonymously: vi.fn(),
      },
    };

    await expect(ensureNodeAnonymousSession(supabase as never, { sessionStore })).resolves.toEqual(cachedUser);

    expect(sessionStore.read).toHaveBeenCalledTimes(1);
    expect(supabase.auth.setSession).toHaveBeenCalledWith({
      access_token: 'cached-access-token',
      refresh_token: 'cached-refresh-token',
    });
    expect(supabase.auth.signInAnonymously).not.toHaveBeenCalled();
    expect(sessionStore.write).not.toHaveBeenCalled();
  });

  it('writes the anonymous session after creating one', async () => {
    const createdUser = { id: 'anon-user' };
    const createdSession = {
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token',
    };
    const sessionStore = {
      read: vi.fn(async () => null),
      write: vi.fn(),
      clear: vi.fn(),
    };
    const supabase = {
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: null },
          error: { message: 'Auth session missing!' },
        })),
        signInAnonymously: vi.fn(async () => ({
          data: { user: createdUser, session: createdSession },
          error: null,
        })),
      },
    };

    await expect(ensureNodeAnonymousSession(supabase as never, { sessionStore })).resolves.toEqual(createdUser);

    expect(supabase.auth.signInAnonymously).toHaveBeenCalledTimes(1);
    expect(sessionStore.write).toHaveBeenCalledWith(createdSession);
  });
});
