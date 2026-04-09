import { defineStore } from 'pinia';
import { local } from '@/shared/storage/base';

export type ThemeMode = 'dark' | 'light' | 'system';

type ResolvedTheme = 'dark' | 'light';

const STORAGE_KEY = 'app_theme';

interface SettingState {
  theme: ThemeMode;
}

function loadTheme(): ThemeMode {
  const saved = local.getItem<string>(STORAGE_KEY);
  if (saved === 'dark' || saved === 'light' || saved === 'system') {
    return saved;
  }
  return 'system';
}

function getSystemTheme(): ResolvedTheme {
  if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

function applyTheme(theme: ThemeMode): void {
  const resolvedTheme = theme === 'system' ? getSystemTheme() : theme;
  if (resolvedTheme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

export const useSettingStore = defineStore('setting', {
  state: (): SettingState => ({
    theme: loadTheme()
  }),

  getters: {
    isDark: (state): boolean => state.theme === 'dark',
    isLight: (state): boolean => state.theme === 'light',
    isSystem: (state): boolean => state.theme === 'system',
    resolvedTheme: (state): ResolvedTheme => {
      if (state.theme === 'system') {
        return getSystemTheme();
      }
      return state.theme;
    }
  },

  actions: {
    // 设置主题
    setTheme(newTheme: ThemeMode): void {
      this.theme = newTheme;
      local.setItem(STORAGE_KEY, newTheme);
      applyTheme(newTheme);
    },

    // 切换主题
    toggleTheme(): void {
      const themes: ThemeMode[] = ['light', 'dark', 'system'];
      const currentIndex = themes.indexOf(this.theme);
      const newTheme = themes[(currentIndex + 1) % themes.length];
      this.theme = newTheme;
      local.setItem(STORAGE_KEY, newTheme);
      applyTheme(newTheme);
    },

    // 初始化主题
    initTheme(): void {
      applyTheme(this.theme);

      // 监听系统主题变化
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (this.theme === 'system') {
          applyTheme('system');
        }
      });
    }
  }
});
