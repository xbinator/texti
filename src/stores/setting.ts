/**
 * @file setting.ts
 * @description 应用设置 Store，负责管理主题、侧边栏和聊天侧状态等持久化设置。
 */
import { defineStore } from 'pinia';
import { defaultsDeep } from 'lodash-es';
import { native } from '@/shared/platform';
import { local } from '@/shared/storage/base';

export type ThemeMode = 'dark' | 'light' | 'system';

type ResolvedTheme = 'dark' | 'light';

const SETTINGS_STORAGE_KEY = 'app_settings';
const LEGACY_THEME_STORAGE_KEY = 'app_theme';
const LEGACY_OUTLINE_STORAGE_KEY = 'editor_showOutline';
const LEGACY_SOURCE_MODE_STORAGE_KEY = 'editor_sourceMode';
const LEGACY_SIDEBAR_VISIBLE_KEY = 'sidebar_visible';
const LEGACY_SIDEBAR_WIDTH_KEY = 'sidebar_width';

interface PersistedSettingState {
  // 聊天侧边栏当前激活的会话 ID，null 表示没有激活会话
  chatSidebarActiveSessionId: string | null;
  // 提供商侧边栏是否折叠
  providerSidebarCollapsed: boolean;
  // 设置侧边栏是否折叠
  settingsSidebarCollapsed: boolean;
  // 主题模式：dark、light 或 system
  theme: ThemeMode;
  // 是否显示大纲，开启后在消息气泡中显示大纲按钮，点击可查看消息的大纲结构
  showOutline: boolean;
  // 源代码模式开关，开启后在消息气泡中显示源代码按钮，点击可查看消息的原始 Markdown 内容
  sourceMode: boolean;
  // 侧边栏是否可见
  sidebarVisible: boolean;
  // 侧边栏宽度，单位像素
  sidebarWidth: number;
}

interface SettingState extends PersistedSettingState {
  title: string;
}

const DEFAULT_SETTINGS: PersistedSettingState = {
  chatSidebarActiveSessionId: null,
  providerSidebarCollapsed: false,
  settingsSidebarCollapsed: false,
  theme: 'system',
  showOutline: true,
  sourceMode: false,
  sidebarVisible: false,
  sidebarWidth: 340
};

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

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'dark' || value === 'light' || value === 'system';
}

function normalizeSidebarWidth(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_SETTINGS.sidebarWidth;
}

function normalizeSettings(value: unknown): PersistedSettingState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_SETTINGS };
  }

  const settings = value as Partial<PersistedSettingState>;
  const normalized = defaultsDeep({}, settings, DEFAULT_SETTINGS) as PersistedSettingState;

  // 确保主题模式有效
  if (!isThemeMode(normalized.theme)) {
    normalized.theme = DEFAULT_SETTINGS.theme;
  }

  // 确保侧边栏宽度有效
  normalized.sidebarWidth = normalizeSidebarWidth(normalized.sidebarWidth);

  return normalized;
}

function removeLegacySettings(): void {
  local.removeItem(LEGACY_THEME_STORAGE_KEY);
  local.removeItem(LEGACY_OUTLINE_STORAGE_KEY);
  local.removeItem(LEGACY_SOURCE_MODE_STORAGE_KEY);
  local.removeItem(LEGACY_SIDEBAR_VISIBLE_KEY);
  local.removeItem(LEGACY_SIDEBAR_WIDTH_KEY);
}

function loadLegacySettings(): PersistedSettingState {
  return normalizeSettings({
    theme: local.getItem<ThemeMode>(LEGACY_THEME_STORAGE_KEY),
    showOutline: local.getItem<boolean>(LEGACY_OUTLINE_STORAGE_KEY),
    sourceMode: local.getItem<boolean>(LEGACY_SOURCE_MODE_STORAGE_KEY),
    sidebarVisible: local.getItem<boolean>(LEGACY_SIDEBAR_VISIBLE_KEY),
    sidebarWidth: local.getItem<number>(LEGACY_SIDEBAR_WIDTH_KEY)
  });
}

function loadPersistedSettings(): PersistedSettingState {
  const savedSettings = local.getItem<PersistedSettingState>(SETTINGS_STORAGE_KEY);

  if (savedSettings) {
    const normalizedSettings = normalizeSettings(savedSettings);
    local.setItem(SETTINGS_STORAGE_KEY, normalizedSettings);
    return normalizedSettings;
  }

  const legacySettings = loadLegacySettings();
  local.setItem(SETTINGS_STORAGE_KEY, legacySettings);
  removeLegacySettings();
  return legacySettings;
}

/**
 * 应用设置 Store
 * 统一管理应用级别的设置：主题、窗口标题等
 */
export const useSettingStore = defineStore('setting', {
  state: (): SettingState => ({
    ...loadPersistedSettings(),
    title: 'Tibis'
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
    syncNativeMenuState(): void {
      native.updateMenuItem?.('view:source', { checked: this.sourceMode });
      native.updateMenuItem?.('view:outline', { checked: this.showOutline });
      native.updateMenuItem?.('theme:light', { checked: this.theme === 'light' });
      native.updateMenuItem?.('theme:dark', { checked: this.theme === 'dark' });
      native.updateMenuItem?.('theme:system', { checked: this.theme === 'system' });
    },

    persistSettings(): void {
      const settings: PersistedSettingState = {
        chatSidebarActiveSessionId: this.chatSidebarActiveSessionId,
        providerSidebarCollapsed: this.providerSidebarCollapsed,
        settingsSidebarCollapsed: this.settingsSidebarCollapsed,
        theme: this.theme,
        showOutline: this.showOutline,
        sourceMode: this.sourceMode,
        sidebarVisible: this.sidebarVisible,
        sidebarWidth: this.sidebarWidth
      };

      local.setItem(SETTINGS_STORAGE_KEY, settings);
    },
    // ==================== 主题设置 ====================

    /**
     * 设置主题
     * @param newTheme 主题模式
     */
    setTheme(newTheme: ThemeMode): void {
      this.theme = newTheme;
      this.persistSettings();
      applyTheme(newTheme);
      this.syncNativeMenuState();
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
      this.persistSettings();
      this.syncNativeMenuState();
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
      this.persistSettings();
      this.syncNativeMenuState();
    },

    /**
     * 切换源代码模式
     */
    toggleSourceMode(): void {
      this.setSourceMode(!this.sourceMode);
    },

    // ==================== 侧边栏设置 ====================

    setSidebarVisible(visible: boolean): void {
      this.sidebarVisible = visible;
      this.persistSettings();
    },

    setSidebarWidth(width: number): void {
      this.sidebarWidth = width;
      this.persistSettings();
    },

    toggleSidebar(): void {
      this.setSidebarVisible(!this.sidebarVisible);
    },

    setSettingsSidebarCollapsed(collapsed: boolean): void {
      this.settingsSidebarCollapsed = collapsed;
      this.persistSettings();
    },

    setProviderSidebarCollapsed(collapsed: boolean): void {
      this.providerSidebarCollapsed = collapsed;
      this.persistSettings();
    },

    /**
     * 设置聊天侧边栏当前激活的会话 ID。
     * @param sessionId - 当前激活的会话 ID，空值表示没有激活会话
     */
    setChatSidebarActiveSessionId(sessionId: string | null): void {
      this.chatSidebarActiveSessionId = sessionId;
      this.persistSettings();
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
      this.syncNativeMenuState();
    }
  }
});
