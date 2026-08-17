import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const releaseDirectory = resolve(repositoryRoot, 'release');
const mappings = [
  ['dist', 'public'],
  ['server-dist', 'server'],
];

for (const [source] of mappings) {
  if (!existsSync(resolve(repositoryRoot, source))) {
    throw new Error(`Cannot assemble release: missing ${source}/.`);
  }
}

rmSync(releaseDirectory, { recursive: true, force: true });
mkdirSync(releaseDirectory, { recursive: true });
for (const [source, destination] of mappings) {
  cpSync(resolve(repositoryRoot, source), resolve(releaseDirectory, destination), { recursive: true });
}
