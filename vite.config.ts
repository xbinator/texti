import vue from '@vitejs/plugin-vue';
import UnoCSS from 'unocss/vite';
import { AntDesignVueResolver } from 'unplugin-vue-components/resolvers';
import Components from 'unplugin-vue-components/vite';
import { defineConfig } from 'vite';

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [
    vue(),
    UnoCSS(),
    Components({
      dts: 'types/components.d.ts',
      // 组件的有效文件扩展名
      extensions: ['vue', 'tsx'],
      // 搜索子目录
      deep: true,
      // 允许子目录作为组件的命名空间前缀。
      directoryAsNamespace: true,
      // 组件目录
      dirs: ['src/components'],
      resolvers: [
        AntDesignVueResolver({
          importStyle: false
        })
      ]
    })
  ],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ['**/src-tauri/**']
    }
  }
}));
