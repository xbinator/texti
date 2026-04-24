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
          colorPrimary: '#cc6444',
          colorPrimaryBg: '#221510',
          colorPrimaryBorder: '#7a3a22',
          colorBgBase: '#1a1a1a',
          colorBgContainer: '#0d0d0d',
          colorBgElevated: '#222222',
          colorText: '#f2f2f2',
          colorTextSecondary: '#999999',
          colorBorder: '#2e2e2e',
          controlOutline: 'rgb(204 100 68 / 25%)'
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
