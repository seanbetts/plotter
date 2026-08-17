import { localWebApp } from '@local-web/ui/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { plotterAppIdentity } from './src/config/appIdentity';
import { normalizePublicBasePath } from './src/config/publicBasePath';

const basePath = normalizePublicBasePath(process.env.VITE_PUBLIC_BASE_PATH);
const e2eServiceUrl = process.env.VITE_E2E_SERVICE_URL;

export default defineConfig({
  plugins: [
    localWebApp({ appId: plotterAppIdentity.id, basePath }),
    react(),
  ],
  server: e2eServiceUrl ? {
    proxy: {
      [`${basePath.replace(/\/$/, '')}/api`]: {
        target: e2eServiceUrl,
        changeOrigin: false,
        rewrite: (path) => path.replace(basePath.replace(/\/$/, ''), ''),
      },
    },
  } : undefined,
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
