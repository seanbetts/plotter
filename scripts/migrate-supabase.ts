import { formatMigrationError, main } from './supabase-migration/cli';

try {
  await main();
} catch (error) {
  process.stderr.write(`${formatMigrationError(error)}\n`);
  process.exitCode = 1;
}
