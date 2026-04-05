import type { Provider } from '@/services/settings/types';

export const defaultBaseUrls: Partial<Record<Provider, string>> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta',
  deepseek: 'https://api.deepseek.com/v1',
  moonshot: 'https://api.moonshot.cn/v1',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4'
};

export function getDefaultBaseUrl(provider: Provider): string | undefined {
  return defaultBaseUrls[provider];
}

export function isProviderOpenAICompatible(provider: Provider): boolean {
  const openAICompatibleProviders: Provider[] = ['openai', 'deepseek', 'moonshot', 'zhipu', 'custom'];
  return openAICompatibleProviders.includes(provider);
}
