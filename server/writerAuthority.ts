import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { readProductionTarget } from '../src/cli/productionTarget';
import type { ServiceArguments } from './args';

function canonical(path: string): string {
  let anchor = resolve(path);
  const missing: string[] = [];
  while (!existsSync(anchor)) {
    const parent = dirname(anchor);
    if (parent === anchor) throw new Error('State directory ancestry is unavailable.');
    missing.unshift(basename(anchor));
    anchor = parent;
  }
  return resolve(realpathSync(anchor), ...missing);
}

function productionOwner(path: string): string | null {
  // Lexical ancestry wins when user-data itself links outside the repository.
  for (const selected of [resolve(path), canonical(path)]) {
    let ancestor = selected;
    while (dirname(ancestor) !== ancestor) {
      if (basename(ancestor) === 'user-data') {
        const source = dirname(ancestor);
        if (['local-web.json', '.git', '.local-web-platform.json'].some((name) => existsSync(resolve(source, name)))) {
          return realpathSync(source);
        }
      }
      ancestor = dirname(ancestor);
    }
  }
  return null;
}

/** Check before mkdir, env loading, ownership locks, database creation or listen. */
export function requireMacWriterAuthority(
  options: ServiceArguments,
  repositoryRoot: string,
  loadTarget: (repository: string) => unknown = readProductionTarget,
): void {
  if (options.runtime === 'nas-docker') {
    if (options.dataDir !== '/state') throw new Error('NAS state must be the explicit /state mount.');
    return;
  }
  // The working manifest is only an ownership hint; the supported RPC validates
  // the exact app from main even when that file is missing or changed locally.
  const owner = productionOwner(options.dataDir);
  const repository = owner ?? realpathSync(repositoryRoot);
  const production = canonical(resolve(repository, 'user-data'));
  const selected = canonical(options.dataDir);
  const descendant = relative(production, selected);
  if (owner === null && descendant !== '' && (descendant === '..' || descendant.startsWith(`..${sep}`) || descendant.startsWith(sep))) return;
  try {
    const target = loadTarget(repository);
    if (!target || typeof target !== 'object' || Array.isArray(target)) throw new Error();
    const value = target as Record<string, unknown>;
    if (Object.keys(value).sort().join(',') !== 'appId,baseUrl,profileRevision,schemaVersion,targetKind'
        || value.schemaVersion !== 1 || value.appId !== 'plotter' || value.targetKind !== 'macos'
        || typeof value.baseUrl !== 'string'
        || value.profileRevision !== null && (typeof value.profileRevision !== 'string' || !/^[a-f0-9]{64}$/.test(value.profileRevision))) throw new Error();
    const url = new URL(value.baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password
        || url.search || url.hash || value.baseUrl.endsWith('/')) throw new Error();
  } catch {
    throw new Error('Mac production writer authority is unavailable; use the current production API or an explicit disposable state directory.');
  }
}
