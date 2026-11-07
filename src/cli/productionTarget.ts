import { execFileSync } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The installed platform owns authority; source clones need an explicit fixture URL. */
export function readProductionTarget(): unknown {
  const command = realpathSync(join(homedir(), '.codex', 'bin', 'local-web'));
  if (!statSync(command).isFile()) throw new Error('Local Web CLI is unavailable.');
  const repository = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../..'));
  const output = execFileSync(command, ['app', 'data-target', '--repository', repository], {
    timeout: 10_000, maxBuffer: 65_536, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
  return JSON.parse(output);
}
