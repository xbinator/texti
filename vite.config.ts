/**
 * @file vite.config.ts
 * @description Vite 构建、开发服务器和前端依赖拆包配置
 */
import { fileURLToPath, URL } from 'node:url';
import { resolve } from 'path';
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
  'BTruncateText',
  'BImageViewer'
];

/**
 * 第三方依赖拆包分组。
 *
 * 按运行时职责拆分大型依赖，避免编辑器、源码编辑器、图表渲染和 UI 组件库
 * 全部挤进路由入口块，降低首屏主包体积并提升浏览器缓存命中率。
 */
const VENDOR_CHUNK_GROUPS = [
  {
    name: 'vue',
    test: /node_modules\/(vue|vue-router|pinia)\//
  },
  {
    name: 'ant-design-icons',
    test: /node_modules\/@ant-design\/icons-vue\//
  },
  {
    name: 'ant-design-vue',
    test: /node_modules\/ant-design-vue\//
  },
  {
    name: 'prosemirror',
    test: /node_modules\/(@tiptap\/pm|prosemirror-)/
  },
  {
    name: 'tiptap-extensions',
    test: /node_modules\/@tiptap\/extension-/
  },
  {
    name: 'tiptap-core',
    test: /node_modules\/@tiptap\//
  },
  {
    name: 'codemirror',
    test: /node_modules\/(@codemirror|@lezer)\//
  },
  {
    name: 'markdown',
    test: /node_modules\/(marked|js-yaml|lowlight|highlight.js)\//
  },
  {
    name: 'katex',
    test: /node_modules\/katex\//
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

    css: {
      preprocessorOptions: {
        less: {
          modifyVars: { hack: `true; @import "${resolve('src/assets/styles/global.less')}";` },
          javascriptEnabled: true
        }
      }
    },

    build: {
      outDir: 'dist',
      emptyOutDir: true,
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: VENDOR_CHUNK_GROUPS
          }
        }
      }
    }
  };
});
