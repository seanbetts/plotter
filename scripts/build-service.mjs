import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const serverOutput = resolve(repositoryRoot, 'server-dist');

rmSync(serverOutput, { recursive: true, force: true });
execFileSync(resolve(repositoryRoot, 'node_modules', '.bin', 'esbuild'), [
  'server/service.ts',
  '--bundle',
  '--platform=node',
  '--format=esm',
  '--outfile=server-dist/service.mjs',
], { cwd: repositoryRoot, stdio: 'inherit' });
