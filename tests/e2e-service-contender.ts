import { startE2eService } from './start-service';

const root = process.argv[2];
if (!root) throw new Error('A contender root is required.');

process.stdout.write('ready\n');
await new Promise<void>((resolve) => process.stdin.once('data', () => resolve()));

try {
  const service = await startE2eService({
    temporaryRoot: root,
    port: 0,
  });
  process.stdout.write(`${JSON.stringify({ status: 'started' })}\n`);
  await service.stop();
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    status: 'rejected',
    message: error instanceof Error ? error.message : String(error),
  })}\n`);
}
