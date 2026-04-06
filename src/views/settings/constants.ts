export type SettingsMenuKey = 'provider' | 'service-model';

export interface MenuItem {
  key: SettingsMenuKey;
  label: string;
  icon: string;
  path: string;
}

export const menuItems: MenuItem[] = [
  { key: 'provider', label: 'AI服务商', icon: 'lucide:brain', path: '/settings/provider' },
  { key: 'service-model', label: '服务模型', icon: 'lucide:sparkles', path: '/settings/service-model' }
];

export interface ProviderOption {
  value: string;
  label: string;
  group: 'international' | 'domestic' | 'custom';
}

export const providerOptions: ProviderOption[] = [
  { value: 'openai', label: 'OpenAI', group: 'international' },
  { value: 'anthropic', label: 'Anthropic', group: 'international' },
  { value: 'google', label: 'Google AI', group: 'international' },
  { value: 'deepseek', label: 'DeepSeek', group: 'domestic' },
  { value: 'moonshot', label: 'Moonshot', group: 'domestic' },
  { value: 'zhipu', label: '智谱 AI', group: 'domestic' },
  { value: 'custom', label: '自定义', group: 'custom' }
];

export const providerGroups = [
  { label: '国际', options: providerOptions.filter((p) => p.group === 'international') },
  { label: '国内', options: providerOptions.filter((p) => p.group === 'domestic') },
  { label: '自定义', options: providerOptions.filter((p) => p.group === 'custom') }
];

export const defaultBaseUrls: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta',
  deepseek: 'https://api.deepseek.com/v1',
  moonshot: 'https://api.moonshot.cn/v1',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4'
};

export const connectionStatusConfig = {
  connected: { color: 'success' as const, text: '已连接', icon: '🟢' },
  failed: { color: 'error' as const, text: '连接失败', icon: '🔴' },
  untested: { color: 'default' as const, text: '未测试', icon: '🟡' }
};
