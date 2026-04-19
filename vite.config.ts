import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import vueJsx from '@vitejs/plugin-vue-jsx';
import UnoCSS from 'unocss/vite';
import { AntDesignVueResolver } from 'unplugin-vue-components/resolvers';
import Components from 'unplugin-vue-components/vite';
import { defineConfig, loadEnv } from 'vite';

// 组件根目录
const COMPONENTS_ROOT = 'src/components';

// 子组件目录列表（基于约定，自动拼接前缀）
const COMPONENT_DIRS = [
  'BChat',
  'BPanelSplitter',
  'BPromptEditor',
  'BLayout',
  'BToolbar',
  'BSelect',
  'BMessage',
  'BModal',
  'BModelIcon',
  'BButton',
  'BDropdown',
  'BEditor',
  'BScrollbar',
  'BTruncateText'
];

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [
      vue(),
      vueJsx(),
      UnoCSS(),
      Components({
        dts: 'types/components.d.ts',
        extensions: ['vue', 'tsx'],
        deep: false,
        directoryAsNamespace: true,
        dirs: [COMPONENTS_ROOT, ...COMPONENT_DIRS.map((dir) => `${COMPONENTS_ROOT}/${dir}`)],
        resolvers: [AntDesignVueResolver({ importStyle: false })]
      })
    ],

    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url))
      }
    },

    clearScreen: false,

    server: {
      host: env.DEV_SERVER_HOST || '127.0.0.1',
      port: parseInt(env.DEV_SERVER_PORT || '1420', 10),
      strictPort: true
    },

    build: {
      outDir: 'dist',
      emptyOutDir: true,
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              {
                name: 'vue',
                test: /node_modules\/(vue|vue-router|pinia)\//
              },
              {
                name: 'ant-design-vue',
                test: /node_modules\/(ant-design-vue|@ant-design\/icons-vue)\//
              },
              {
                name: 'vueuse',
                test: /node_modules\/@vueuse\/core\//
              },
              {
                name: 'lodash',
                test: /node_modules\/lodash-es\//
              },
              {
                name: 'dayjs',
                test: /node_modules\/dayjs\//
              }
            ]
          }
        }
      }
    }
  };
});
