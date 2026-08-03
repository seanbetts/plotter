import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { normalizePublicBasePath } from './src/config/publicBasePath';

export default defineConfig({
  base: normalizePublicBasePath(process.env.VITE_PUBLIC_BASE_PATH),
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
