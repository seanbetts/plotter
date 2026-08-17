import { createE2eServiceLifecycle, startE2eService } from './start-service';

export default async function globalSetup() {
  const service = await startE2eService();
  const lifecycle = createE2eServiceLifecycle(service);
  return () => lifecycle.teardown();
}
