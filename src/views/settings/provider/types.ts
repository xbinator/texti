import type { AIProvider } from 'types/ai';

export interface Category {
  key: string;
  label: string;
  icon: string;
}

export interface ProviderOption {
  label: string;
  value: string;
  isCustom: boolean;
}

export interface ProviderComputedData {
  customProviders: ProviderOption[];
  defaultProviders: ProviderOption[];
  providerMap: Record<string, AIProvider>;
  categoryCountMap: Record<string, number>;
}
