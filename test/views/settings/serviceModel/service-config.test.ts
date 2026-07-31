/**
 * @file service-config.test.ts
 * @description 服务模型设置组件行为测试。
 * @vitest-environment jsdom
 */
import { defineComponent, nextTick } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ServiceConfig from '@/views/settings/serviceModel/components/ServiceConfig.vue';
import ServiceModelSettings from '@/views/settings/serviceModel/index.vue';

const mockLoadProviders = vi.hoisted(() => vi.fn<() => Promise<void>>());
const mockProviders = vi.hoisted(() => [
  {
    id: 'provider-a',
    name: 'Provider A',
    isEnabled: true,
    models: [{ id: 'model-a', name: 'Model A', isEnabled: true }]
  }
]);
const mockGetConfig = vi.hoisted(() => vi.fn());
const mockSaveConfig = vi.hoisted(() => vi.fn());
const mockDispatchServiceModelUpdated = vi.hoisted(() => vi.fn());

vi.mock('@/stores/ai/provider', () => ({
  useProviderStore: () => ({
    providers: mockProviders,
    loadProviders: mockLoadProviders
  })
}));

vi.mock('@/shared/storage', () => ({
  serviceModelsStorage: {
    getConfig: mockGetConfig,
    saveConfig: mockSaveConfig
  }
}));

vi.mock('@/shared/storage/service-models/events', () => ({
  dispatchServiceModelUpdated: mockDispatchServiceModelUpdated
}));

vi.mock('@/components/BButton/index.vue', () => ({
  default: {
    name: 'BButton',
    template: '<button type="button"><slot /></button>'
  }
}));

vi.mock('@/components/BModal/index.vue', () => ({
  default: {
    name: 'BModal',
    template: '<div><slot /><slot name="footer" /></div>'
  }
}));

vi.mock('@/components/BSmart/Editor.vue', () => ({
  default: {
    name: 'BSmartEditor',
    template: '<textarea />'
  }
}));

vi.mock('@/components/BSelect/index.vue', () => ({
  default: {
    name: 'BSelect',
    props: {
      value: {
        type: String,
        default: undefined
      }
    },
    emits: ['update:value'],
    template: '<button class="select-model" type="button" @click="$emit(\'update:value\', \'provider-a:model-a\')">{{ value }}</button>'
  }
}));

/**
 * 挂载 ServiceConfig 的基础全局配置。
 */
const serviceConfigGlobal = {
  stubs: {
    SettingsSection: { template: '<section><slot /></section>' },
    BModelIcon: true
  }
};

describe('ServiceConfig', (): void => {
  beforeEach((): void => {
    vi.useFakeTimers();
    mockLoadProviders.mockResolvedValue(undefined);
    mockGetConfig.mockResolvedValue({
      providerId: 'legacy-provider',
      modelId: 'legacy-model',
      customPrompt: 'legacy prompt',
      updatedAt: 1
    });
    mockSaveConfig.mockResolvedValue({ updatedAt: 2 });
    mockDispatchServiceModelUpdated.mockReset();
  });

  afterEach((): void => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('hides prompt editing and does not persist hidden customPrompt when prompt is disabled', async (): Promise<void> => {
    const wrapper = mount(ServiceConfig, {
      props: {
        serviceType: 'polish',
        title: '内容编辑助手',
        description: '指定用于内容编辑的模型',
        showPrompt: false
      },
      global: serviceConfigGlobal
    });

    await flushPromises();
    await wrapper.find('.select-model').trigger('click');
    await nextTick();
    await vi.advanceTimersByTimeAsync(300);

    expect(wrapper.find('.prompt-row').exists()).toBe(false);
    expect(mockSaveConfig).toHaveBeenCalledWith('polish', {
      providerId: 'provider-a',
      modelId: 'model-a'
    });
  });
});

describe('ServiceModelSettings', (): void => {
  it('renders only polish service as model-only without default prompt', (): void => {
    const serviceConfigCalls: Array<Record<string, unknown>> = [];
    const ServiceConfigStub = defineComponent({
      name: 'ServiceConfig',
      props: {
        serviceType: {
          type: String,
          required: true
        },
        title: {
          type: String,
          required: true
        },
        description: {
          type: String,
          required: true
        },
        options: {
          type: Array,
          default: undefined
        },
        showPrompt: {
          type: Boolean,
          default: undefined
        }
      },
      setup(props, { attrs }) {
        serviceConfigCalls.push({ ...props, ...attrs });
        return (): null => null;
      }
    });

    mount(ServiceModelSettings, {
      global: {
        stubs: {
          SettingsPage: { template: '<main><slot /></main>' },
          ServiceConfig: ServiceConfigStub
        }
      }
    });

    const polishConfig = serviceConfigCalls.find((props) => props.serviceType === 'polish');

    expect(serviceConfigCalls).toHaveLength(1);
    expect(serviceConfigCalls.some((props) => props.serviceType === 'chat')).toBe(false);
    expect(polishConfig).toMatchObject({
      serviceType: 'polish',
      showPrompt: false
    });
    expect(polishConfig).not.toHaveProperty('defaultPrompt');
    expect(polishConfig).not.toHaveProperty('default-prompt');
  });
});
