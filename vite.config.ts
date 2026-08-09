import { localWebApp } from '@local-web/ui/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { plotterAppIdentity } from './src/config/appIdentity';
import { normalizePublicBasePath } from './src/config/publicBasePath';

const basePath = normalizePublicBasePath(process.env.VITE_PUBLIC_BASE_PATH);

export default defineConfig({
  plugins: [
    localWebApp({ appId: plotterAppIdentity.id, basePath }),
    react(),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
