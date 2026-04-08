<template>
  <div class="service-card">
    <!-- Header Section -->
    <div class="card-header">
      <div class="flex flex-col">
        <div class="service-title">{{ title }}</div>
        <div class="service-desc">{{ description }}</div>
      </div>

      <div class="header-right">
        <BSelect v-model:value="selectedModel" :options="modelOptions" placeholder="请选择模型">
          <template #option="{ modelId, modelName, providerName }">
            <div class="flex items-center gap-2">
              <BModelIcon :model="modelId" class="model-icon" />
              <div class="flex-1 w-0 truncate">{{ modelName }}</div>
              <div class="fs-12">{{ providerName }}</div>
            </div>
          </template>
        </BSelect>
      </div>
    </div>

    <!-- Configuration Content -->
    <div class="card-content">
      <!-- Custom Prompt -->
      <div class="config-section">
        <div class="section-header">
          <div class="section-label">
            <Icon icon="lucide:terminal" class="label-icon" />
            <span>Prompt</span>
          </div>
          <div class="save-status" :class="{ saving: saveState === 'saving', error: saveState === 'error' }">
            {{ saveStatusText }}
          </div>
        </div>

        <div class="section-control">
          <BPromptEditor v-model:value="customPrompt" :placeholder="placeholder" :options="options" />
        </div>
      </div>

      <!-- Extra Slot -->
      <div v-if="$slots.extra" class="config-section extra-section">
        <slot name="extra"></slot>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import BPromptEditor from '@/components/BPromptEditor/index.vue';
import type { VariableOptionGroup } from '@/components/BPromptEditor/types';
import BSelect from '@/components/BSelect/index.vue';
import { providerStorage, serviceModelsStorage } from '@/utils/storage';
import type { Provider } from '@/utils/storage';
import type { ServiceModelType } from '@/utils/storage/service-models';

interface Props {
  // 服务类型
  serviceType: ServiceModelType;
  // 服务标题
  title: string;
  // 服务描述
  description: string;
  // 自定义提示词占位符
  placeholder?: string;
  // 可用分组选项
  options?: VariableOptionGroup[];
}

interface ModelOption {
  value: string;
  modelId: string;
  modelName: string;
  providerName: string;
  providerLogo?: string;
}

const props = withDefaults(defineProps<Props>(), {
  placeholder: '请输入自定义 Prompt 指令...',
  options: () => []
});

const loading = ref(false);
const providers = ref<Provider[]>([]);
const selectedModel = ref<string>();
const customPrompt = ref<string>();
const initialized = ref(false);
const saveState = ref<'idle' | 'saving' | 'saved' | 'error'>('idle');
const saveStatusMessage = ref('未保存');
let saveTimer: ReturnType<typeof setTimeout> | null = null;

const modelOptions = computed<ModelOption[]>(() => {
  const result: ModelOption[] = [];

  // eslint-disable-next-line no-restricted-syntax
  for (const provider of providers.value) {
    if (!provider.isEnabled || !provider.models?.length) continue;

    // eslint-disable-next-line no-restricted-syntax
    for (const model of provider.models) {
      if (!model.isEnabled) continue;

      result.push({
        value: `${provider.id}:${model.id}`,
        modelId: model.id,
        modelName: model.name,
        providerName: provider.name,
        providerLogo: provider.logo
      });
    }
  }

  return result;
});

const saveStatusText = computed<string>(() => {
  if (saveState.value === 'saving') return '保存中...';
  if (saveState.value === 'saved') return '已自动保存';
  if (saveState.value === 'error') return saveStatusMessage.value;

  return '未保存';
});

async function loadProviders(): Promise<void> {
  loading.value = true;

  providers.value = await providerStorage.listProviders();

  loading.value = false;
}

async function loadSavedConfig(): Promise<void> {
  const config = await serviceModelsStorage.getConfig(props.serviceType);
  if (!config) return;

  selectedModel.value = config.providerId && config.modelId ? `${config.providerId}:${config.modelId}` : undefined;
  customPrompt.value = config.customPrompt || '';
  saveState.value = 'saved';
}

function buildConfigPayload(): { providerId?: string; modelId?: string; customPrompt?: string } {
  if (!selectedModel.value) {
    return {
      customPrompt: customPrompt.value?.trim() || undefined
    };
  }

  const [providerId, modelId] = selectedModel.value.split(':');

  return {
    providerId: providerId || undefined,
    modelId: modelId || undefined,
    customPrompt: customPrompt.value?.trim() || undefined
  };
}

async function persistConfig(): Promise<void> {
  saveState.value = 'saving';

  try {
    await serviceModelsStorage.saveConfig(props.serviceType, buildConfigPayload());
    saveState.value = 'saved';
  } catch (error: unknown) {
    saveState.value = 'error';
    saveStatusMessage.value = error instanceof Error ? error.message : '保存失败';
  }
}

function queueSave(): void {
  if (!initialized.value) return;

  saveState.value = 'idle';

  if (saveTimer) {
    clearTimeout(saveTimer);
  }

  saveTimer = setTimeout(() => {
    persistConfig();
  }, 300);
}

watch([selectedModel, customPrompt], () => {
  queueSave();
});

onMounted(async () => {
  await Promise.all([loadProviders(), loadSavedConfig()]);
  initialized.value = true;
});

onUnmounted(() => {
  if (saveTimer) {
    clearTimeout(saveTimer);
  }
});
</script>

<style scoped lang="less">
.service-card {
  width: 100%;
  max-width: 800px;
  background: var(--bg-primary);
  border: 1px solid var(--border-secondary);
  border-radius: 12px;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);

  &:hover {
    border-color: var(--color-primary-light, var(--border-primary));
    box-shadow: 0 4px 20px -4px rgb(0 0 0 / 8%);
  }
}

.card-header {
  display: flex;
  gap: 20px;
  align-items: center;
  justify-content: space-between;
  padding: 20px;
}

.service-icon-wrapper {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  color: var(--color-primary);
  background: var(--color-primary-bg);
  border-radius: 10px;
}

.service-icon {
  width: 22px;
  height: 22px;
}

.service-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.service-desc {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary);
}

.header-right {
  width: 300px;
}

.card-content {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 20px;
  border-top: 1px solid var(--border-secondary);
}

.config-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.save-status {
  font-size: 12px;
  color: var(--text-tertiary);

  &.saving {
    color: var(--color-primary);
  }

  &.error {
    color: var(--color-danger, #ff4d4f);
  }
}

.section-label {
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);

  .label-icon {
    width: 14px;
    height: 14px;
    color: var(--text-tertiary);
  }
}

.section-control {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.prompt-textarea {
  padding: 12px;
  font-family: inherit;
  font-size: 14px;
  line-height: 1.6;
  background: var(--bg-secondary);
  border-radius: 8px;
  transition: all 0.2s;

  &:focus {
    background: var(--bg-primary);
  }
}
</style>
