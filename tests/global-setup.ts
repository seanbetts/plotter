import { startE2eService } from './start-service';

export default async function globalSetup() {
  const service = await startE2eService();
  return async () => {
    await service.stop();
  };
}
