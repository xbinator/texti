import { computed } from 'vue';
import theme from 'ant-design-vue/es/theme';
import { useSettingStore } from '@/stores/setting';

const { darkAlgorithm, defaultAlgorithm } = theme;

export function useAntdTheme() {
  const settingStore = useSettingStore();

  const antdTheme = computed(() => ({
    algorithm: settingStore.resolvedTheme === 'dark' ? darkAlgorithm : defaultAlgorithm,
    token: {
      colorPrimary: '#1677ff'
    }
  }));

  return { antdTheme };
}
