import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  globalSetup: './tests/global-setup.ts',
  webServer: {
    command: 'VITE_TRIP_STORAGE=e2e-service VITE_PUBLIC_BASE_PATH=/plotter/ VITE_E2E_SERVICE_URL=http://127.0.0.1:5175/ VITE_OPENROUTESERVICE_API_KEY=e2e-test-key vite --host 127.0.0.1 --port 5174 --strictPort',
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
