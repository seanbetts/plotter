import { main } from './supabase-migration/cli';

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Supabase migration failed.'}\n`);
  process.exitCode = 1;
}
