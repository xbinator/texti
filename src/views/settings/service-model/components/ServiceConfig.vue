<template>
  <div class="service-card">
    <div class="card-header">
      <div class="flex flex-col">
        <div class="service-title">{{ title }}</div>
      </div>
    </div>

    <div class="card-content">
      <div class="config-row">
        <div class="config-info">
          <div class="config-label">模型</div>
          <div class="config-desc">{{ description }}</div>
        </div>
        <BSelect v-model:value="selectedModel" :options="modelOptions" placeholder="请选择模型">
          <template #option="{ modelId, modelName, providerName }">
            <div class="flex items-center gap-6">
              <BModelIcon :model="modelId" :size="18" />
              <div class="flex-1 w-0 truncate">{{ modelName }}</div>
              <div class="fs-12">{{ providerName }}</div>
            </div>
          </template>
        </BSelect>
      </div>

      <div v-if="showPrompt" class="config-row prompt-row">
        <div class="config-info">
          <div class="config-label">提示词</div>
        </div>
        <BButton type="secondary" size="small" @click="openPromptModal">编 辑</BButton>
      </div>
    </div>

    <BModal v-model:open="promptModalVisible" title="提示词" :width="600" :main-style="{ padding: '16px 24px 10px' }">
      <div class="prompt-modal">
        <div class="prompt-modal-desc" v-text="'输入内容，支持按此格式书写变量： {{ USER_NAME }}'"></div>
        <BPromptEditor v-model:value="draftPrompt" :placeholder="placeholder" :options="options" :max-height="420" />
      </div>

      <template #footer>
        <BButton v-if="showResetButton && defaultPrompt" type="secondary" icon="lucide:rotate-ccw" @click="resetToDefault">恢复默认</BButton>
        <div class="flex-1"></div>
        <BButton type="secondary" @click="cancelPromptEdit">取消</BButton>
        <BButton @click="confirmPromptEdit">确定</BButton>
      </template>
    </BModal>
  </div>
</template>

<script setup lang="ts">
import type { AIProvider } from 'types/ai';
import type { ModelServiceType } from 'types/model';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import BButton from '@/components/BButton/index.vue';
import BModal from '@/components/BModal/index.vue';
import BPromptEditor from '@/components/BPromptEditor/index.vue';
import type { VariableOptionGroup } from '@/components/BPromptEditor/types';
import BSelect from '@/components/BSelect/index.vue';
import { providerStorage, serviceModelsStorage } from '@/shared/storage';
import { dispatchServiceModelUpdated } from '@/shared/storage/service-models/events';

interface Props {
  serviceType: ModelServiceType;
  title: string;
  description: string;
  placeholder?: string;
  options?: VariableOptionGroup[];
  defaultPrompt?: string;
  showPrompt?: boolean;
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
  defaultPrompt: '',
  options: () => [],
  showPrompt: true
});

const loading = ref(false);
const providers = ref<AIProvider[]>([]);
const selectedModel = ref<string>();
const customPrompt = ref<string>();
const draftPrompt = ref<string>();
const initialized = ref(false);
const promptModalVisible = ref(false);
let saveTimer: ReturnType<typeof setTimeout> | null = null;

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
  return Boolean(props.defaultPrompt && draftPrompt.value !== props.defaultPrompt);
});

function openPromptModal(): void {
  draftPrompt.value = customPrompt.value ?? props.defaultPrompt ?? '';
  promptModalVisible.value = true;
}

function cancelPromptEdit(): void {
  draftPrompt.value = customPrompt.value ?? props.defaultPrompt ?? '';
  promptModalVisible.value = false;
}

function confirmPromptEdit(): void {
  customPrompt.value = draftPrompt.value;
  promptModalVisible.value = false;
}

function resetToDefault(): void {
  if (props.defaultPrompt) {
    draftPrompt.value = props.defaultPrompt;
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
  draftPrompt.value = customPrompt.value;
}

function buildConfigPayload(): { providerId?: string; modelId?: string; customPrompt?: string } {
  if (!selectedModel.value) {
    return {
      customPrompt: customPrompt.value?.trim() || undefined
    };
  }

  const [, providerId, modelId] = selectedModel.value.match(/^([^:]+):(.+)$/) ?? [];

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
  border-radius: 8px;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.card-header {
  display: flex;
  gap: 20px;
  align-items: center;
  justify-content: space-between;
  padding: 20px;
}

.service-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.card-content {
  display: flex;
  flex-direction: column;
  background: var(--bg-secondary);
  border-top: 1px solid var(--border-secondary);
}

.config-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 24px;
  align-items: center;
  min-height: 68px;
  padding: 16px 20px;

  & + & {
    border-top: 1px solid var(--border-secondary);
  }
}

.prompt-row {
  grid-template-columns: minmax(0, 1fr) auto;
}

.config-info {
  min-width: 0;
}

.config-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.config-desc,
.prompt-preview,
.prompt-modal-desc {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);
}

.prompt-preview {
  display: -webkit-box;
  max-width: 100%;
  overflow: hidden;
}

.prompt-modal {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.prompt-modal-desc {
  margin-top: 0;
}

@media (width <= 720px) {
  .config-row,
  .prompt-row {
    grid-template-columns: 1fr;
    gap: 12px;
  }
}
</style>
