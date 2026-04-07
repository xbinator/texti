import type { ProviderRequestFormat } from '@/utils/storage';

export interface ProviderFormatOption {
  value: ProviderRequestFormat;
  label: string;
}

export const providerFormatOptions: ProviderFormatOption[] = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'google', label: 'Google' }
];

export const providerFormatLabels = Object.fromEntries(providerFormatOptions.map((option) => [option.value, option.label]));
