import { defineConfig, devices } from '@playwright/test';
import { createE2eViteEnvironment } from './tests/start-service';

export default defineConfig({
  testDir: './tests',
  testIgnore: '**/*.unit.test.ts',
  globalSetup: './tests/global-setup.ts',
  webServer: {
    command: 'vite --host 127.0.0.1 --port 5174 --strictPort',
    env: createE2eViteEnvironment(process.env, 'http://127.0.0.1:5175/'),
    url: 'http://127.0.0.1:5174/plotter/',
    reuseExistingServer: false,
    timeout: 120_000,
  },
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5174/plotter/',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
