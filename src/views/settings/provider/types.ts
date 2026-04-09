import type { Provider, ProviderModel } from '@/shared/storage';

export type { Provider };
export type Model = ProviderModel;

export interface ModelSubmitResult {
  success: boolean;
  message?: string;
}
