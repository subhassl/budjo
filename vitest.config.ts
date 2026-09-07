import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/api/test/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: { '@budjo/shared': new URL('./packages/shared/src/index.ts', import.meta.url).pathname },
  },
});
