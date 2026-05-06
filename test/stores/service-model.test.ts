/**
 * @file service-model.test.ts
 * @description 验证 service-model store 的 chatModel 状态管理和乐观更新机制
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelServiceConfig } from 'types/model';

type GetConfigMock = (serviceType: string) => Promise<ModelServiceConfig | null>;
type SaveConfigMock = (serviceType: string, config: Partial<ModelServiceConfig>) => Promise<void>;

/**
 * 模拟持久化存储行为。
 */
const mocks = vi.hoisted(() => ({
  getConfig: vi.fn<GetConfigMock>(),
  saveConfig: vi.fn<SaveConfigMock>(),
  dispatchServiceModelUpdated: vi.fn<() => void>()
}));

vi.mock('@/shared/storage/service-models/events', () => ({
  dispatchServiceModelUpdated: mocks.dispatchServiceModelUpdated
}));

vi.mock('@/shared/storage', () => ({
  providerStorage: {},
  serviceModelsStorage: {
    getConfig: mocks.getConfig,
    saveConfig: mocks.saveConfig
  }
}));

vi.mock('@/shared/storage/base', () => ({
  local: {
    getItem: vi.fn().mockReturnValue(undefined),
    setItem: vi.fn()
  }
}));

describe('service-model store — chatModel', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mocks.getConfig.mockReset();
    mocks.saveConfig.mockReset();
    mocks.dispatchServiceModelUpdated.mockReset();
    // 重置模块级 saveVersion
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('loadChatModel', () => {
    it('从 storage 读取 chat 配置并写入 store', async () => {
      mocks.getConfig.mockResolvedValue({ providerId: 'openai', modelId: 'gpt-4', updatedAt: 0 });

      const { useServiceModelStore } = await import('@/stores/serviceModel');
      const store = useServiceModelStore();

      await store.loadChatModel();

      expect(mocks.getConfig).toHaveBeenCalledWith('chat');
      expect(store.chatModel).toEqual({ providerId: 'openai', modelId: 'gpt-4' });
    });

    it('storage 无配置时 chatModel 为 undefined', async () => {
      mocks.getConfig.mockResolvedValue(null);

      const { useServiceModelStore } = await import('@/stores/serviceModel');
      const store = useServiceModelStore();

      await store.loadChatModel();

      expect(store.chatModel).toBeUndefined();
    });

    it('storage 配置缺少 providerId 时 chatModel 为 undefined', async () => {
      mocks.getConfig.mockResolvedValue({ modelId: 'gpt-4', updatedAt: 0 });

      const { useServiceModelStore } = await import('@/stores/serviceModel');
      const store = useServiceModelStore();

      await store.loadChatModel();

      expect(store.chatModel).toBeUndefined();
    });
  });

  describe('setChatModel', () => {
    it('乐观更新 store 状态并持久化', async () => {
      const { useServiceModelStore } = await import('@/stores/serviceModel');
      const store = useServiceModelStore();

      await store.setChatModel({ providerId: 'deepseek', modelId: 'v4' });

      // 乐观更新已生效
      expect(store.chatModel).toEqual({ providerId: 'deepseek', modelId: 'v4' });
      // 持久化已被调用
      expect(mocks.saveConfig).toHaveBeenCalledWith('chat', { providerId: 'deepseek', modelId: 'v4' });
      // 事件已被派发
      expect(mocks.dispatchServiceModelUpdated).toHaveBeenCalledWith('chat');
    });

    it('连续快速切换时只派发最后一次事件', async () => {
      const { useServiceModelStore } = await import('@/stores/serviceModel');
      const store = useServiceModelStore();

      // 第一次 save 延迟完成，第二次立即完成
      let resolveFirst: () => void;
      mocks.saveConfig.mockReturnValueOnce(new Promise<void>((r) => { resolveFirst = r; }));
      mocks.saveConfig.mockResolvedValue(undefined);

      // 第一次切换（save 被阻塞）
      const firstCall = store.setChatModel({ providerId: 'openai', modelId: 'gpt-4' });

      // 第二次切换（save 立即完成，await 让 microtask 执行）
      await store.setChatModel({ providerId: 'deepseek', modelId: 'v4' });

      // 第二次的事件已派发
      expect(mocks.dispatchServiceModelUpdated).toHaveBeenCalledTimes(1);
      expect(mocks.dispatchServiceModelUpdated).toHaveBeenCalledWith('chat');

      // 完成第一次 save，版本号已过期，不再派发事件
      resolveFirst();
      await firstCall;

      expect(mocks.dispatchServiceModelUpdated).toHaveBeenCalledTimes(1);
    });
  });
});
