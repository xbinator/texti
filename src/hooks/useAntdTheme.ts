import type { ComputedRef } from 'vue';
import { computed } from 'vue';
import theme from 'ant-design-vue/es/theme';
import { useSettingStore } from '@/stores/setting';

const { darkAlgorithm, defaultAlgorithm } = theme;

interface AntdThemeToken {
  colorPrimary: string;
  colorPrimaryBg: string;
  colorPrimaryBorder: string;
  colorBgBase: string;
  colorBgContainer: string;
  colorBgElevated: string;
  colorText: string;
  colorTextSecondary: string;
  colorBorder: string;
  controlOutline: string;
}

interface AntdThemeConfig {
  algorithm: typeof darkAlgorithm | typeof defaultAlgorithm;
  token: AntdThemeToken;
}

interface UseAntdThemeResult {
  antdTheme: ComputedRef<AntdThemeConfig>;
}

export function useAntdTheme(): UseAntdThemeResult {
  const settingStore = useSettingStore();

  const antdTheme = computed<AntdThemeConfig>(() => {
    if (settingStore.resolvedTheme === 'dark') {
      return {
        algorithm: darkAlgorithm,
        token: {
          colorBgBase: '#13151a',
          colorBgContainer: '#0d0f12',
          colorBgElevated: '#1c1f26',

          colorText: '#e8ecf2',
          colorTextSecondary: '#7a8494',

          colorBorder: '#252a35',

          // 主题色保持原样
          colorPrimary: '#c8a98b',
          colorPrimaryBg: '#0d0b09',
          colorPrimaryBorder: '#3d3028',
          controlOutline: 'rgb(200 169 139 / 15%)'
        }
      };
    }

    return {
      algorithm: defaultAlgorithm,
      token: {
        colorPrimary: '#8a6f5a',
        colorPrimaryBg: '#f3ebe3',
        colorPrimaryBorder: '#c5b19d',
        colorBgBase: '#faf9f6',
        colorBgContainer: '#fffdf8',
        colorBgElevated: '#fffdf8',
        colorText: '#1a1a1a',
        colorTextSecondary: '#6b6560',
        colorBorder: '#e3dccf',
        controlOutline: 'rgb(138 111 90 / 20%)'
      }
    };
  });

  return { antdTheme };
}
