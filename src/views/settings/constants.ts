import type { AIProviderType } from 'types/ai';

export type SettingsMenuKey = 'provider' | 'service-model' | 'search' | 'mcp' | 'widget' | 'skill' | 'memory' | 'basic' | 'logger';

/**
 * 侧边栏菜单项定义
 */
export interface MenuItem {
  key: SettingsMenuKey;
  label: string;
  icon: string;
  path: string;
}

/**
 * 按 key 索引的菜单项映射，方便按分组引用
 */
export const MENU_ITEMS: Record<SettingsMenuKey, MenuItem> = {
  provider: { key: 'provider', label: '模型服务', icon: 'lucide:cloud', path: '/settings/provider' },
  'service-model': { key: 'service-model', label: '默认模型', icon: 'lucide:sparkles', path: '/settings/service-model' },
  search: { key: 'search', label: '网络搜索', icon: 'lucide:globe', path: '/settings/tools/search' },
  mcp: { key: 'mcp', label: 'MCP 服务器', icon: 'lucide:cable', path: '/settings/tools/mcp' },
  widget: { key: 'widget', label: '小组件', icon: 'lucide:blocks', path: '/settings/tools/widget' },
  skill: { key: 'skill', label: '技能', icon: 'lucide:hammer', path: '/settings/tools/skill' },
  memory: { key: 'memory', label: '全局记忆', icon: 'lucide:brain', path: '/settings/tools/memory' },
  basic: { key: 'basic', label: '基础设置', icon: 'lucide:settings-2', path: '/settings/basic' },
  logger: { key: 'logger', label: '运行日志', icon: 'lucide:file-text', path: '/settings/logger' }
};

/** 平铺列表（兼容旧引用） */
export const menuItems: MenuItem[] = Object.values(MENU_ITEMS);

/**
 * 菜单分组定义
 */
export interface MenuGroup {
  label: string;
  items: MenuItem[];
}

/**
 * 侧边栏菜单分组
 */
export const menuGroups: MenuGroup[] = [
  { label: '基础', items: ['basic'].map((k) => MENU_ITEMS[k as SettingsMenuKey]) },
  { label: 'AI 服务', items: ['provider', 'service-model'].map((k) => MENU_ITEMS[k as SettingsMenuKey]) },
  { label: '功能配置', items: ['memory', 'mcp', 'skill', 'widget', 'search'].map((k) => MENU_ITEMS[k as SettingsMenuKey]) },
  { label: '系统', items: ['logger'].map((k) => MENU_ITEMS[k as SettingsMenuKey]) }
];

export interface ProviderFormatOption {
  value: AIProviderType;
  label: string;
  /** API 兼容协议名称，用于 baseUrl 填写提示文案 */
  protocol: string;
  /** 会被自动补充到 baseUrl 末尾的路径；为空表示路径与模型相关，不展示后缀提示 */
  suffix?: string;
}

export const providerFormatOptions: ProviderFormatOption[] = [
  { value: 'openai', label: 'OpenAI', protocol: 'OpenAI', suffix: '/chat/completions' },
  { value: 'anthropic', label: 'Anthropic', protocol: 'Claude', suffix: '/v1/messages' },
  { value: 'google', label: 'Google', protocol: 'Google AI' },
  { value: 'deepseek', label: 'Deepseek', protocol: 'OpenAI', suffix: '/chat/completions' },
  { value: 'alibaba', label: '阿里云', protocol: 'OpenAI', suffix: '/chat/completions' },
  { value: 'volcengine', label: '火山引擎', protocol: 'OpenAI', suffix: '/chat/completions' },
  { value: 'moonshot', label: 'Moonshot', protocol: 'OpenAI', suffix: '/chat/completions' },
  { value: 'glm', label: 'GLM', protocol: 'OpenAI', suffix: '/chat/completions' },
  { value: 'minimax', label: 'MiniMax', protocol: 'OpenAI', suffix: '/chat/completions' },
  { value: 'mimo', label: 'MiMo', protocol: 'OpenAI', suffix: '/chat/completions' }
];

export const providerFormatLabels = Object.fromEntries(providerFormatOptions.map((option) => [option.value, option.label]));

export const CONTAINER_WIDTH_THRESHOLD = 800;

export const SIDEBAR_WIDTH_LARGE = 280;

export const SIDEBAR_WIDTH_SMALL = 60;
