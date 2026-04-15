import { defineStore } from 'pinia';
import { native } from '@/shared/platform';
import { local } from '@/shared/storage/base';

export type ThemeMode = 'dark' | 'light' | 'system';

type ResolvedTheme = 'dark' | 'light';

const THEME_STORAGE_KEY = 'app_theme';
const OUTLINE_STORAGE_KEY = 'editor_showOutline';
const SOURCE_MODE_STORAGE_KEY = 'editor_sourceMode';

interface SettingState {
  theme: ThemeMode;
  title: string;
  showOutline: boolean;
  sourceMode: boolean;
}

function loadTheme(): ThemeMode {
  const saved = local.getItem<string>(THEME_STORAGE_KEY);
  if (saved === 'dark' || saved === 'light' || saved === 'system') {
    return saved;
  }
  return 'system';
}

function loadShowOutline(): boolean {
  const saved = local.getItem<boolean>(OUTLINE_STORAGE_KEY);
  return typeof saved === 'boolean' ? saved : true;
}

function loadSourceMode(): boolean {
  const saved = local.getItem<boolean>(SOURCE_MODE_STORAGE_KEY);
  return typeof saved === 'boolean' ? saved : false;
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

/**
 * 应用设置 Store
 * 统一管理应用级别的设置：主题、窗口标题等
 */
export const useSettingStore = defineStore('setting', {
  state: (): SettingState => ({
    theme: loadTheme(),
    title: 'Tibis',
    showOutline: loadShowOutline(),
    sourceMode: loadSourceMode()
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
    // ==================== 主题设置 ====================

    /**
     * 设置主题
     * @param newTheme 主题模式
     */
    setTheme(newTheme: ThemeMode): void {
      this.theme = newTheme;
      local.setItem(THEME_STORAGE_KEY, newTheme);
      applyTheme(newTheme);
    },

    /**
     * 切换主题（light -> dark -> system -> light）
     */
    toggleTheme(): void {
      const themes: ThemeMode[] = ['light', 'dark', 'system'];
      const currentIndex = themes.indexOf(this.theme);
      const newTheme = themes[(currentIndex + 1) % themes.length];
      this.setTheme(newTheme);
    },

    // ==================== 大纲设置 ====================

    /**
     * 设置大纲显示状态
     * @param show 是否显示大纲
     */
    setShowOutline(show: boolean): void {
      this.showOutline = show;
      local.setItem(OUTLINE_STORAGE_KEY, show);
    },

    /**
     * 切换大纲显示状态
     */
    toggleOutline(): void {
      this.setShowOutline(!this.showOutline);
    },

    // ==================== 源代码模式设置 ====================

    /**
     * 设置源代码模式
     * @param enabled 是否启用源代码模式
     */
    setSourceMode(enabled: boolean): void {
      this.sourceMode = enabled;
      local.setItem(SOURCE_MODE_STORAGE_KEY, enabled);
    },

    /**
     * 切换源代码模式
     */
    toggleSourceMode(): void {
      this.setSourceMode(!this.sourceMode);
    },

    /**
     * 初始化主题并监听系统主题变化
     */
    initTheme(): void {
      applyTheme(this.theme);

      // 监听系统主题变化
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (this.theme === 'system') {
          applyTheme('system');
        }
      });
    },

    // ==================== 窗口标题设置 ====================

    /**
     * 设置窗口标题
     * 统一处理 Electron 和 Web 环境的标题设置
     * @param newTitle 新标题
     */
    async setWindowTitle(newTitle: string): Promise<void> {
      this.title = newTitle;

      // 调用原生接口设置窗口标题（Electron 会设置窗口标题，Web 会设置 document.title）
      await native.setWindowTitle(newTitle);
    },

    /**
     * 恢复默认标题
     */
    async resetWindowTitle(): Promise<void> {
      await this.setWindowTitle('Tibis');
    },

    // ==================== 统一初始化 ====================

    /**
     * 初始化所有设置
     * 应用启动时统一调用，避免多次初始化
     */
    init(): void {
      this.initTheme();
      // 标题不保存到本地，每次启动使用默认值
      native.setWindowTitle(this.title);
    }
  }
});
