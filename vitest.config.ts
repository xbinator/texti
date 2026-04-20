import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
      types: new URL('./types', import.meta.url).pathname
    }
  },
  server: {
    host: '127.0.0.1'
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts']
  }
});
