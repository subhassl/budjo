import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react(), tailwind()],
  resolve: {
    alias: {
      '@budjo/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    // `npm run dev:api` runs the Worker on 8787; this proxies the API to it so
    // cookies and passkey origins line up on a single host during development.
    proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: false } },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
