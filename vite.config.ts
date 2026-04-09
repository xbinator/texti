import vue from '@vitejs/plugin-vue';
import vueJsx from '@vitejs/plugin-vue-jsx';
import UnoCSS from 'unocss/vite';
import { AntDesignVueResolver } from 'unplugin-vue-components/resolvers';
import Components from 'unplugin-vue-components/vite';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [
    vue(),
    vueJsx(),
    UnoCSS(),
    Components({
      dts: 'types/components.d.ts',
      extensions: ['vue', 'tsx'],
      deep: false,
      directoryAsNamespace: true,
      dirs: [
        'src/components',
        'src/components/BToolbar',
        'src/components/BSelect',
        'src/components/BModal',
        'src/components/BModelIcon',
        'src/components/BButton',
        'src/components/BDropdown',
        'src/components/BEditor',
        'src/components/BScrollbar',
        'src/components/BTruncateText'
      ],
      resolvers: [
        AntDesignVueResolver({
          importStyle: false
        })
      ]
    })
  ],
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname
    }
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: false
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
}));
