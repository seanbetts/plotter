import 'dotenv/config';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

export type NodeSupabaseSession = {
  access_token: string;
  refresh_token: string;
};

export type NodeSupabaseSessionStore = {
  read(): Promise<NodeSupabaseSession | null>;
  write(session: NodeSupabaseSession): Promise<void>;
  clear(): Promise<void>;
};

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

function createSessionPath(directoryName: '.plotter' | '.world-tour') {
  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? '';
  const host = (() => {
    try {
      return new URL(supabaseUrl).host;
    } catch {
      return 'unconfigured';
    }
  })();

  return join(homedir(), directoryName, `trip-cli-session-${host}.json`);
}

async function readSession(path: string) {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as Partial<NodeSupabaseSession>;
    if (typeof value.access_token === 'string' && typeof value.refresh_token === 'string') {
      return {
        access_token: value.access_token,
        refresh_token: value.refresh_token,
      };
    }
  } catch {
    // Missing and invalid session files are treated as an empty cache.
  }

  return null;
}

export function createNodeSupabaseSessionStore(
  path = createSessionPath('.plotter'),
  legacyPath: string | null = createSessionPath('.world-tour'),
): NodeSupabaseSessionStore {
  async function writeSession(session: NodeSupabaseSession) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(session)}\n`, { mode: 0o600 });
    await chmod(path, 0o600);
  }

  return {
    async read() {
      const currentSession = await readSession(path);
      if (currentSession) return currentSession;

      if (legacyPath) {
        const legacySession = await readSession(legacyPath);
        if (legacySession) {
          await writeSession(legacySession);
          return legacySession;
        }
      }

      return null;
    },
    write: writeSession,
    async clear() {
      await Promise.all([
        rm(path, { force: true }),
        ...(legacyPath ? [rm(legacyPath, { force: true })] : []),
      ]);
    },
  };
}

export async function ensureNodeAnonymousSession(
  supabase: ReturnType<typeof createNodeSupabaseClient>,
  options: { sessionStore?: NodeSupabaseSessionStore } = {},
) {
  const sessionStore = options.sessionStore ?? createNodeSupabaseSessionStore();
  const cachedSession = await sessionStore.read();

  if (cachedSession) {
    const restored = await supabase.auth.setSession(cachedSession);
    if (!restored.error) {
      const existing = await supabase.auth.getUser();
      if (existing.data.user) {
        return existing.data.user;
      }
    }

    await sessionStore.clear();
  }

  const existing = await supabase.auth.getUser();
  if (existing.data.user) {
    return existing.data.user;
  }

  const created = await supabase.auth.signInAnonymously();
  if (created.error || !created.data.user) {
    throw new Error(created.error?.message || 'Unable to create anonymous Supabase session.');
  }

  if (created.data.session?.access_token && created.data.session.refresh_token) {
    await sessionStore.write({
      access_token: created.data.session.access_token,
      refresh_token: created.data.session.refresh_token,
    });
  }

  return created.data.user;
}
