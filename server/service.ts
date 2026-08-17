import { createServer } from 'node:http';
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseServiceArguments } from './args';

const repositoryRoot = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const serviceArguments = parseServiceArguments(process.argv.slice(2), repositoryRoot);

if (!existsSync(serviceArguments.dataDir)) {
  const initialDataDirectory = resolve(repositoryRoot, 'user-data');
  if (serviceArguments.dataDir !== initialDataDirectory) {
    throw new Error('The service data directory must exist or be the repository user-data directory.');
  }
  mkdirSync(initialDataDirectory);
}

if (serviceArguments.envFile !== undefined) {
  try {
    process.loadEnvFile(serviceArguments.envFile);
  } catch {
    throw new Error('The service env file could not be loaded.');
  }
}

const server = createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/healthz') {
    const body = JSON.stringify({ status: 'initializing' });
    response.writeHead(503, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(body),
    });
    response.end(body);
    return;
  }

  response.writeHead(404);
  response.end();
});

server.listen(serviceArguments.port, '127.0.0.1');
