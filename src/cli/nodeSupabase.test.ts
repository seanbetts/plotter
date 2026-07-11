import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createNodeSupabaseSessionStore, ensureNodeAnonymousSession } from './nodeSupabase';

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function createPaths() {
  const directory = await mkdtemp(join(tmpdir(), 'plotter-session-'));
  tempDirectories.push(directory);
  return {
    primary: join(directory, '.plotter', 'session.json'),
    legacy: join(directory, '.world-tour', 'session.json'),
  };
}

describe('createNodeSupabaseSessionStore', () => {
  it('copies a valid legacy session to the Plotter path and retains the original', async () => {
    const paths = await createPaths();
    const legacyStore = createNodeSupabaseSessionStore(paths.legacy, null);
    const session = { access_token: 'access', refresh_token: 'refresh' };
    await legacyStore.write(session);

    const store = createNodeSupabaseSessionStore(paths.primary, paths.legacy);

    await expect(store.read()).resolves.toEqual(session);
    await expect(readFile(paths.primary, 'utf8')).resolves.toBe(`${JSON.stringify(session)}\n`);
    await expect(readFile(paths.legacy, 'utf8')).resolves.toBe(`${JSON.stringify(session)}\n`);
    expect((await stat(paths.primary)).mode & 0o777).toBe(0o600);
  });

  it('prefers the Plotter session when both files exist', async () => {
    const paths = await createPaths();
    await createNodeSupabaseSessionStore(paths.primary, null).write({
      access_token: 'primary-access',
      refresh_token: 'primary-refresh',
    });
    await createNodeSupabaseSessionStore(paths.legacy, null).write({
      access_token: 'legacy-access',
      refresh_token: 'legacy-refresh',
    });

    await expect(createNodeSupabaseSessionStore(paths.primary, paths.legacy).read()).resolves.toEqual({
      access_token: 'primary-access',
      refresh_token: 'primary-refresh',
    });
  });

  it('falls back to a valid legacy session when the primary file is malformed', async () => {
    const paths = await createPaths();
    await createNodeSupabaseSessionStore(paths.primary, null).write({
      access_token: 'temporary',
      refresh_token: 'temporary',
    });
    await writeFile(paths.primary, '{malformed');
    await createNodeSupabaseSessionStore(paths.legacy, null).write({
      access_token: 'legacy-access',
      refresh_token: 'legacy-refresh',
    });

    await expect(createNodeSupabaseSessionStore(paths.primary, paths.legacy).read()).resolves.toEqual({
      access_token: 'legacy-access',
      refresh_token: 'legacy-refresh',
    });
  });

  it('clears both current and legacy session files', async () => {
    const paths = await createPaths();
    const store = createNodeSupabaseSessionStore(paths.primary, paths.legacy);
    await createNodeSupabaseSessionStore(paths.primary, null).write({ access_token: 'a', refresh_token: 'b' });
    await createNodeSupabaseSessionStore(paths.legacy, null).write({ access_token: 'c', refresh_token: 'd' });

    await store.clear();

    await expect(readFile(paths.primary, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(paths.legacy, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

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
