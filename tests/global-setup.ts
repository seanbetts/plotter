import { startE2eService, startE2eServiceLifecycle } from './start-service';

export default async function globalSetup() {
  const lifecycle = await startE2eServiceLifecycle(() => startE2eService());
  return () => lifecycle.teardown();
}
