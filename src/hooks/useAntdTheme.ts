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
          colorPrimary: '#c8a98b',
          colorPrimaryBg: '#3d342d',
          colorPrimaryBorder: '#8a755f',
          colorBgBase: '#2d2d2d',
          colorBgContainer: '#1a1a1a',
          colorBgElevated: '#353535',
          colorText: '#f3efe8',
          colorTextSecondary: '#b7aea6',
          colorBorder: '#4a453f',
          controlOutline: 'rgb(200 169 139 / 20%)'
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
