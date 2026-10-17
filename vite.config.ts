import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/moonstone-successor/',
  build: { chunkSizeWarningLimit: 2000 },
  test: { include: ['tests/**/*.test.ts'] },
});
