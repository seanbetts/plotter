import { localWebApp } from '@local-web/ui/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { plotterAppIdentity } from './src/config/appIdentity';
import { normalizePublicBasePath } from './src/config/publicBasePath';

const basePath = normalizePublicBasePath(process.env.VITE_PUBLIC_BASE_PATH);
const serviceUrl = process.env.VITE_E2E_SERVICE_URL ?? 'http://127.0.0.1:5175';
const serviceProxyPath = `${basePath.replace(/\/$/, '')}/api`;

export default defineConfig({
  plugins: [
    localWebApp({ appId: plotterAppIdentity.id, basePath }),
    react(),
  ],
  envDir: process.env.PLOTTER_ENV_DIR,
  server: {
    proxy: {
      [serviceProxyPath]: {
        target: serviceUrl,
        changeOrigin: false,
        rewrite: (path) => path.replace(basePath.replace(/\/$/, ''), ''),
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
