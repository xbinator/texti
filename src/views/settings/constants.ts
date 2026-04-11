import type { AIProviderType } from 'types/ai';

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

export interface ProviderFormatOption {
  value: AIProviderType;
  label: string;
}

export const providerFormatOptions: ProviderFormatOption[] = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'google', label: 'Google' }
];

export const providerFormatLabels = Object.fromEntries(providerFormatOptions.map((option) => [option.value, option.label]));
