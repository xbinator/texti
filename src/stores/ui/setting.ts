/**
 * @file setting.ts
 * @description 应用设置 Store，负责管理主题、侧边栏和聊天侧状态等持久化设置。
 */
import { defineStore } from 'pinia';
import { defaultsDeep } from 'lodash-es';
import { native } from '@/shared/platform';
import { loadPersistedState, persistState } from '@/stores/helpers/persist';
import type { PersistConfig } from '@/stores/helpers/types';
import { getResolvedTokens, applyCssVars, validateTokens } from '@/theme';

export type ThemeMode = 'dark' | 'light' | 'system';
export type DefaultFontStyle =
  | 'theme'
  | 'heiti'
  | 'songti'
  | 'kaiti'
  | 'fangsong'
  | 'pingfang'
  | 'yuanti'
  | 'yahei'
  | 'simhei'
  | 'simsun'
  | 'youyuan'
  | 'notoSansCjk'
  | 'notoSerifCjk'
  | 'sourceHanSans'
  | 'sourceHanSerif'
  | 'wenquanyi';

type ResolvedTheme = 'dark' | 'light';

const SETTINGS_STORAGE_KEY = 'app_settings';
const LEGACY_THEME_STORAGE_KEY = 'app_theme';
const LEGACY_SIDEBAR_VISIBLE_KEY = 'sidebar_visible';
const LEGACY_SIDEBAR_WIDTH_KEY = 'sidebar_width';
export const ROOT_FONT_SIZE_DEFAULT = 14;
export const ROOT_FONT_SIZE_MIN = 12;
export const ROOT_FONT_SIZE_MAX = 18;
export const DEFAULT_FONT_STYLE_DEFAULT: DefaultFontStyle = 'theme';

/**
 * 默认 UI 字体样式到字体栈的映射。
 */
const DEFAULT_FONT_STYLE_STACKS: Record<Exclude<DefaultFontStyle, 'theme'>, string> = {
  heiti: '"Heiti SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", SimHei, "Noto Sans CJK SC", sans-serif',
  songti: '"Songti SC", STSong, SimSun, "Noto Serif CJK SC", serif',
  kaiti: '"Kaiti SC", STKaiti, KaiTi, "Noto Serif CJK SC", serif',
  fangsong: 'STFangsong, FangSong, "Noto Serif CJK SC", serif',
  pingfang: '"PingFang SC", "Hiragino Sans GB", "Heiti SC", "Microsoft YaHei", sans-serif',
  yuanti: '"Yuanti SC", YouYuan, "PingFang SC", "Microsoft YaHei", sans-serif',
  yahei: '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif',
  simhei: 'SimHei, "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif',
  simsun: 'SimSun, NSimSun, "Songti SC", "Noto Serif CJK SC", serif',
  youyuan: 'YouYuan, "Yuanti SC", "Microsoft YaHei", sans-serif',
  notoSansCjk: '"Noto Sans CJK SC", "Source Han Sans SC", "WenQuanYi Micro Hei", sans-serif',
  notoSerifCjk: '"Noto Serif CJK SC", "Source Han Serif SC", SimSun, serif',
  sourceHanSans: '"Source Han Sans SC", "Noto Sans CJK SC", "WenQuanYi Micro Hei", sans-serif',
  sourceHanSerif: '"Source Han Serif SC", "Noto Serif CJK SC", SimSun, serif',
  wenquanyi: '"WenQuanYi Micro Hei", "WenQuanYi Zen Hei", "Noto Sans CJK SC", sans-serif'
};

interface PersistedSettingState {
  chatSidebarActiveSessionId: string | null;
  /** 记忆功能是否启用 */
  memoryEnabled: boolean;
  providerSidebarCollapsed: boolean;
  settingsSidebarCollapsed: boolean;
  theme: ThemeMode;
  /** 主题预设 ID，如 'default'、'classic' */
  themePreset: string;
  /** 应用根字号，控制 rem UI 缩放 */
  rootFontSize: number;
  /** 默认 UI 字体样式，仅覆盖 --font-sans */
  defaultFontStyle: DefaultFontStyle;
  sidebarVisible: boolean;
  sidebarWidth: number;
}

interface SettingState extends PersistedSettingState {
  title: string;
}

const DEFAULT_SETTINGS: PersistedSettingState = {
  chatSidebarActiveSessionId: null,
  memoryEnabled: true,
  providerSidebarCollapsed: false,
  settingsSidebarCollapsed: true,
  theme: 'system',
  themePreset: 'default',
  rootFontSize: ROOT_FONT_SIZE_DEFAULT,
  defaultFontStyle: DEFAULT_FONT_STYLE_DEFAULT,
  sidebarVisible: false,
  sidebarWidth: 340
};

function getSystemTheme(): ResolvedTheme {
  if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

function applyTheme(theme: ThemeMode, presetId: string): void {
  const resolvedTheme = theme === 'system' ? getSystemTheme() : theme;
  const tokens = getResolvedTokens(presetId, resolvedTheme);
  applyCssVars(tokens);
  if (resolvedTheme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

/**
 * 应用根字号到文档根元素。
 * @param size - 根字号像素值
 */
function applyRootFontSize(size: number): void {
  document.documentElement.style.fontSize = `${size}px`;
}

/**
 * 应用默认 UI 字体样式到文档根元素。
 * @param style - 默认字体样式
 */
function applyDefaultFontStyle(style: DefaultFontStyle): void {
  if (style === 'theme') {
    document.documentElement.style.removeProperty('--font-sans');
    return;
  }

  document.documentElement.style.setProperty('--font-sans', DEFAULT_FONT_STYLE_STACKS[style]);
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'dark' || value === 'light' || value === 'system';
}

/**
 * 判断未知值是否为默认字体样式。
 * @param value - 未知持久化值
 * @returns 是否为默认字体样式
 */
function isDefaultFontStyle(value: unknown): value is DefaultFontStyle {
  return (
    value === 'theme' ||
    value === 'heiti' ||
    value === 'songti' ||
    value === 'kaiti' ||
    value === 'fangsong' ||
    value === 'pingfang' ||
    value === 'yuanti' ||
    value === 'yahei' ||
    value === 'simhei' ||
    value === 'simsun' ||
    value === 'youyuan' ||
    value === 'notoSansCjk' ||
    value === 'notoSerifCjk' ||
    value === 'sourceHanSans' ||
    value === 'sourceHanSerif' ||
    value === 'wenquanyi'
  );
}

/**
 * 规范化应用根字号。
 * @param value - 未知持久化值
 * @returns 合法根字号
 */
function normalizeRootFontSize(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return ROOT_FONT_SIZE_DEFAULT;
  if (value < ROOT_FONT_SIZE_MIN || value > ROOT_FONT_SIZE_MAX) return ROOT_FONT_SIZE_DEFAULT;

  return Math.round(value);
}

/**
 * 规范化默认字体样式。
 * @param value - 未知持久化值
 * @returns 合法默认字体样式
 */
function normalizeDefaultFontStyle(value: unknown): DefaultFontStyle {
  if (value === 'system') return 'heiti';
  if (value === 'serif') return 'songti';

  return isDefaultFontStyle(value) ? value : DEFAULT_FONT_STYLE_DEFAULT;
}

function normalizeSidebarWidth(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_SETTINGS.sidebarWidth;
}

/**
 * 规范化主题预设 ID。
 * @param value - 持久化主题预设值
 * @returns 当前可用主题预设 ID
 */
function normalizeThemePreset(value: unknown): string {
  if (value === 'graphite') return DEFAULT_SETTINGS.themePreset;
  if (typeof value !== 'string' || !value.trim()) return DEFAULT_SETTINGS.themePreset;

  return value;
}

/**
 * 规范化聊天侧栏持久化会话 ID。
 * @param value - 未知持久化值
 * @returns 非空会话 ID；无效值返回 null
 */
function normalizeChatSessionId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.trim() || null;
}

function normalizeSettings(value: unknown): PersistedSettingState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_SETTINGS };
  }

  const settings = value as Partial<PersistedSettingState>;
  const merged = defaultsDeep({}, settings, DEFAULT_SETTINGS) as PersistedSettingState;
  const normalized: PersistedSettingState = {
    chatSidebarActiveSessionId: normalizeChatSessionId(merged.chatSidebarActiveSessionId),
    memoryEnabled: merged.memoryEnabled,
    providerSidebarCollapsed: merged.providerSidebarCollapsed,
    settingsSidebarCollapsed: merged.settingsSidebarCollapsed,
    theme: merged.theme,
    themePreset: normalizeThemePreset(merged.themePreset),
    rootFontSize: normalizeRootFontSize(merged.rootFontSize),
    defaultFontStyle: normalizeDefaultFontStyle(merged.defaultFontStyle),
    sidebarVisible: merged.sidebarVisible,
    sidebarWidth: merged.sidebarWidth
  };

  if (!isThemeMode(normalized.theme)) {
    normalized.theme = DEFAULT_SETTINGS.theme;
  }

  normalized.sidebarWidth = normalizeSidebarWidth(normalized.sidebarWidth);

  return normalized;
}

const SETTINGS_CONFIG: PersistConfig<PersistedSettingState> = {
  storageKey: SETTINGS_STORAGE_KEY,
  defaults: DEFAULT_SETTINGS,
  normalize: normalizeSettings,
  migrations: [
    {
      legacyKey: LEGACY_THEME_STORAGE_KEY,
      migrate: (legacyValue: unknown): Record<string, unknown> => ({
        theme: legacyValue as ThemeMode
      })
    },
    {
      legacyKey: LEGACY_SIDEBAR_VISIBLE_KEY,
      migrate: (legacyValue: unknown): Record<string, unknown> => ({
        sidebarVisible: legacyValue as boolean
      })
    },
    {
      legacyKey: LEGACY_SIDEBAR_WIDTH_KEY,
      migrate: (legacyValue: unknown): Record<string, unknown> => ({
        sidebarWidth: legacyValue as number
      })
    }
  ]
};

/**
 * 应用设置 Store
 * 统一管理应用级别的设置：主题、窗口标题等
 */
export const useSettingStore = defineStore('setting', {
  state: (): SettingState => ({
    ...loadPersistedState(SETTINGS_CONFIG),
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
      native.updateMenuItem?.('theme:light', { checked: this.theme === 'light' });
      native.updateMenuItem?.('theme:dark', { checked: this.theme === 'dark' });
      native.updateMenuItem?.('theme:system', { checked: this.theme === 'system' });
    },

    persistSettings(): void {
      const settings: PersistedSettingState = {
        chatSidebarActiveSessionId: this.chatSidebarActiveSessionId,
        memoryEnabled: this.memoryEnabled,
        providerSidebarCollapsed: this.providerSidebarCollapsed,
        settingsSidebarCollapsed: this.settingsSidebarCollapsed,
        theme: this.theme,
        themePreset: this.themePreset,
        rootFontSize: this.rootFontSize,
        defaultFontStyle: this.defaultFontStyle,
        sidebarVisible: this.sidebarVisible,
        sidebarWidth: this.sidebarWidth
      };

      persistState(SETTINGS_STORAGE_KEY, settings);
    },
    // ==================== 主题设置 ====================

    /**
     * 设置主题
     * @param newTheme 主题模式
     */
    setTheme(newTheme: ThemeMode): void {
      this.theme = newTheme;
      this.persistSettings();
      applyTheme(newTheme, this.themePreset);
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

    /**
     * 设置主题预设
     * @param presetId - 预设 ID，如 'default'、'classic'
     */
    setThemePreset(presetId: string): void {
      this.themePreset = presetId;
      this.persistSettings();
      applyTheme(this.theme, presetId);
    },

    /**
     * 设置应用根字号。
     * @param size - 根字号像素值
     */
    setRootFontSize(size: number): void {
      this.rootFontSize = normalizeRootFontSize(size);
      this.persistSettings();
      applyRootFontSize(this.rootFontSize);
    },

    /**
     * 设置默认 UI 字体样式。
     * @param style - 默认字体样式
     */
    setDefaultFontStyle(style: DefaultFontStyle): void {
      this.defaultFontStyle = normalizeDefaultFontStyle(style);
      this.persistSettings();
      applyDefaultFontStyle(this.defaultFontStyle);
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
      const tokens = getResolvedTokens(this.themePreset, 'light');
      validateTokens(tokens, 'light');
      const darkTokens = getResolvedTokens(this.themePreset, 'dark');
      validateTokens(darkTokens, 'dark');
      applyTheme(this.theme, this.themePreset);

      // 监听系统主题变化
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (this.theme === 'system') {
          applyTheme('system', this.themePreset);
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
      applyRootFontSize(this.rootFontSize);
      applyDefaultFontStyle(this.defaultFontStyle);
      // 标题不保存到本地，每次启动使用默认值
      native.setWindowTitle(this.title);
      this.syncNativeMenuState();
    }
  }
});
