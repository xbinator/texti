/**
 * @file use-chat-service-config.test.ts
 * @description BChat chat service config hook 测试。
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatServiceConfig } from '@/components/BChat/hooks/useChatServiceConfig';
import type { SelectedModel } from '@/stores/ai/serviceModel';

const getModelToolSupportMock = vi.hoisted(() => vi.fn());

vi.mock('@/ai/tools/policy', () => ({
  getModelToolSupport: getModelToolSupportMock
}));

describe('useChatServiceConfig', (): void => {
  beforeEach((): void => {
    getModelToolSupportMock.mockReset();
  });

  it('returns undefined when the current UI model is missing', async (): Promise<void> => {
    const resolveSelectedModel = vi.fn<() => Promise<SelectedModel | undefined>>().mockResolvedValue(undefined);
    const serviceConfig = useChatServiceConfig(resolveSelectedModel);

    await expect(serviceConfig.resolveServiceConfig()).resolves.toBeUndefined();
    expect(resolveSelectedModel).toHaveBeenCalledOnce();
    expect(getModelToolSupportMock).not.toHaveBeenCalled();
  });

  it('resolves tool support from the current UI model', async (): Promise<void> => {
    const resolveSelectedModel = vi.fn<() => Promise<SelectedModel | undefined>>().mockResolvedValue({ providerId: 'provider-1', modelId: 'model-2' });
    getModelToolSupportMock.mockResolvedValue({ supported: true });
    const serviceConfig = useChatServiceConfig(resolveSelectedModel);

    await expect(serviceConfig.resolveServiceConfig()).resolves.toEqual({
      providerId: 'provider-1',
      modelId: 'model-2',
      toolSupport: { supported: true }
    });

    expect(getModelToolSupportMock).toHaveBeenCalledWith('provider-1', 'model-2');
  });

  it('waits for session model restoration before resolving tool support', async (): Promise<void> => {
    let resolveModel: (model: SelectedModel) => void = (): void => undefined;
    const modelPromise = new Promise<SelectedModel>((resolve): void => {
      resolveModel = resolve;
    });
    const serviceConfig = useChatServiceConfig((): Promise<SelectedModel> => modelPromise);
    getModelToolSupportMock.mockResolvedValue({ supported: true });

    const resultPromise = serviceConfig.resolveServiceConfig();
    expect(getModelToolSupportMock).not.toHaveBeenCalled();
    resolveModel({ providerId: 'provider-1', modelId: 'model-2' });

    await expect(resultPromise).resolves.toEqual({
      providerId: 'provider-1',
      modelId: 'model-2',
      toolSupport: { supported: true }
    });
  });
});
