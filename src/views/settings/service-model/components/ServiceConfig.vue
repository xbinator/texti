<template>
  <div class="service-card">
    <div class="card-header">
      <div class="flex flex-col">
        <div class="service-title">{{ title }}</div>
        <div class="service-desc">{{ description }}</div>
      </div>

      <div class="header-right">
        <BSelect v-model:value="selectedModel" :options="modelOptions" placeholder="请选择模型">
          <template #option="{ modelId, modelName, providerName }">
            <div class="flex items-center gap-2">
              <BModelIcon :model="modelId" :size="18" />
              <div class="flex-1 w-0 truncate">{{ modelName }}</div>
              <div class="fs-12">{{ providerName }}</div>
            </div>
          </template>
        </BSelect>
      </div>
    </div>

    <div class="card-content">
      <div class="config-section">
        <div class="section-header" @click="togglePromptCollapsed">
          <div class="section-label">
            <Icon :icon="promptCollapsed ? 'lucide:chevron-right' : 'lucide:chevron-down'" class="label-icon" />
            <span>Prompt</span>
          </div>
          <div class="header-actions">
            <button v-if="showResetButton" class="reset-btn" type="button" @click.stop="resetToDefault">
              <Icon icon="lucide:rotate-ccw" class="reset-icon" />
              <span>恢复默认</span>
            </button>
          </div>
        </div>

        <div v-show="!promptCollapsed" class="section-control">
          <BPromptEditor v-model:value="customPrompt" :placeholder="placeholder" :options="options" />
        </div>
      </div>

      <div v-if="$slots.extra" class="config-section extra-section">
        <slot name="extra"></slot>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { AIProvider } from 'types/ai';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import BPromptEditor from '@/components/BPromptEditor/index.vue';
import type { VariableOptionGroup } from '@/components/BPromptEditor/types';
import BSelect from '@/components/BSelect/index.vue';
import { providerStorage, serviceModelsStorage } from '@/shared/storage';
import type { ServiceModelType } from '@/shared/storage/service-models';
import { dispatchServiceModelUpdated } from '@/shared/storage/service-models/events';
import { useServiceModelStore } from '@/stores/service-model';

interface Props {
  serviceType: ServiceModelType;
  title: string;
  description: string;
  placeholder?: string;
  options?: VariableOptionGroup[];
  defaultPrompt?: string;
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
  defaultPrompt: '可以使用{{变量名}}格式的变量，例如{{SELECTED_TEXT}}、{{USER_INPUT}}等',
  options: () => []
});

const serviceModelStore = useServiceModelStore();

const loading = ref(false);
const providers = ref<AIProvider[]>([]);
const selectedModel = ref<string>();
const customPrompt = ref<string>();
const initialized = ref(false);
let saveTimer: ReturnType<typeof setTimeout> | null = null;

const promptCollapsed = computed<boolean>({
  get: () => serviceModelStore.isSectionCollapsed(props.serviceType, 'prompt'),
  set: () => serviceModelStore.toggleSectionCollapsed(props.serviceType, 'prompt')
});

const modelOptions = computed<ModelOption[]>(() => {
  return providers.value.flatMap((provider) => {
    if (!provider.isEnabled || !provider.models?.length) {
      return [];
    }

    return provider.models
      .filter((model) => model.isEnabled)
      .map((model) => ({
        value: `${provider.id}:${model.id}`,
        modelId: model.id,
        modelName: model.name,
        providerName: provider.name,
        providerLogo: provider.logo
      }));
  });
});

const showResetButton = computed<boolean>(() => {
  return Boolean(props.defaultPrompt && customPrompt.value !== props.defaultPrompt);
});

function togglePromptCollapsed(): void {
  serviceModelStore.toggleSectionCollapsed(props.serviceType, 'prompt');
}

function resetToDefault(): void {
  if (props.defaultPrompt) {
    customPrompt.value = props.defaultPrompt;
  }
}

async function loadProviders(): Promise<void> {
  loading.value = true;
  providers.value = await providerStorage.listProviders();
  loading.value = false;
}

async function loadSavedConfig(): Promise<void> {
  const config = await serviceModelsStorage.getConfig(props.serviceType);

  selectedModel.value = config?.providerId && config?.modelId ? `${config.providerId}:${config.modelId}` : undefined;
  customPrompt.value = config?.customPrompt ?? props.defaultPrompt ?? '';
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
  await serviceModelsStorage.saveConfig(props.serviceType, buildConfigPayload());
  dispatchServiceModelUpdated(props.serviceType);
}

function queueSave(): void {
  if (!initialized.value) return;

  if (saveTimer) {
    clearTimeout(saveTimer);
  }

  saveTimer = setTimeout(persistConfig, 300);
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
  overflow: hidden;
  background: linear-gradient(180deg, var(--bg-primary) 0%, var(--bg-tertiary) 100%);
  border: 1px solid var(--border-secondary);
  border-radius: 12px;
  box-shadow: 0 10px 30px -24px rgb(0 0 0 / 20%);
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);

  &:hover {
    border-color: var(--color-primary-light, var(--border-primary));
    box-shadow: 0 16px 36px -26px rgb(0 0 0 / 24%);
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
  background: var(--bg-secondary);
  border-top: 1px solid var(--border-secondary);
}

.config-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  background: var(--bg-primary);
  border: 1px solid var(--border-secondary);
  border-radius: 12px;
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 24%);
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px;
  cursor: pointer;
  user-select: none;
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

.collapse-icon {
  width: 16px;
  height: 16px;
  color: var(--text-tertiary);
  transition: transform 0.2s;
}

.header-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  padding-left: 12px;
}

.reset-btn {
  display: flex;
  gap: 4px;
  align-items: center;
  padding: 4px 8px;
  font-size: 12px;
  color: var(--text-tertiary);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: 4px;
  transition: all 0.2s;

  &:hover {
    color: var(--color-primary);
    background: var(--color-primary-bg);
  }
}

.reset-icon {
  width: 12px;
  height: 12px;
}

.extra-section {
  background: linear-gradient(180deg, var(--bg-primary) 0%, var(--bg-tertiary) 100%);
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
