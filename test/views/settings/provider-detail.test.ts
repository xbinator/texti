/**
 * @file provider-detail.test.ts
 * @description Provider 详情页延迟配置写入的卸载清理测试。
 * @vitest-environment jsdom
 */
import type { AIProvider } from 'types/ai';
import { defineComponent } from 'vue';
import { flushPromises, shallowMount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProviderDetail from '@/views/settings/provider/detail.vue';

/** Provider 测试数据。 */
const providerFixture: AIProvider = {
  id: 'provider-1',
  name: 'Provider 1',
  description: 'Provider for delayed-write tests',
  type: 'openai',
  isEnabled: true,
  apiKey: 'old-key',
  baseUrl: 'https://old.example.test',
  models: []
};

const providerStoreMock = vi.hoisted(() => ({
  providers: [] as AIProvider[],
  getProviderById: vi.fn<(_providerId: string) => Promise<AIProvider | null>>(),
  loadProviders: vi.fn<() => Promise<void>>(),
  saveProviderConfig: vi.fn<(_providerId: string, _config: { apiKey?: string; baseUrl?: string }) => Promise<void>>(),
  toggleProvider: vi.fn<(_providerId: string, _enabled: boolean) => Promise<void>>()
}));

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { provider: 'provider-1' } })
}));

vi.mock('@/stores/ai/provider', () => ({
  useProviderStore: () => providerStoreMock
}));

vi.mock('ant-design-vue', () => ({
  message: { success: vi.fn() }
}));

/** 可触发 v-model 更新的 API 配置测试替身。 */
const ApiConfigStub = defineComponent({
  name: 'ApiConfig',
  props: {
    value: { type: Object, required: true }
  },
  emits: ['update:value'],
  template: '<button class="change-config" @click="$emit(\'update:value\', { ...value, apiKey: \'new-key\' })">change</button>'
});

describe('Provider detail', (): void => {
  beforeEach((): void => {
    vi.useFakeTimers();
    providerStoreMock.providers = [{ ...providerFixture }];
    providerStoreMock.getProviderById.mockReset();
    providerStoreMock.loadProviders.mockReset();
    providerStoreMock.saveProviderConfig.mockReset();
    providerStoreMock.toggleProvider.mockReset();
    providerStoreMock.getProviderById.mockResolvedValue({ ...providerFixture });
    providerStoreMock.loadProviders.mockResolvedValue(undefined);
    providerStoreMock.saveProviderConfig.mockResolvedValue(undefined);
    providerStoreMock.toggleProvider.mockResolvedValue(undefined);
  });

  afterEach((): void => {
    vi.useRealTimers();
  });

  it('cancels a pending config write when the page unmounts', async (): Promise<void> => {
    const wrapper = shallowMount(ProviderDetail, {
      global: {
        stubs: {
          ApiConfig: ApiConfigStub,
          Icon: true,
          ModelList: true,
          ProviderInfo: true,
          ProviderModal: true
        }
      }
    });
    await flushPromises();

    await wrapper.find('.change-config').trigger('click');
    await flushPromises();
    wrapper.unmount();
    await vi.advanceTimersByTimeAsync(350);

    expect(providerStoreMock.saveProviderConfig).not.toHaveBeenCalled();
  });
});
