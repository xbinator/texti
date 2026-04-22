/**
 * @file vitest.config.ts
 * @description Vitest 配置，提供测试别名和 Vue 单文件组件支持。
 */
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue()],
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
