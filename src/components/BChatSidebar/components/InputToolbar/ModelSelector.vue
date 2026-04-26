<template>
  <BDropdown v-model:open="open">
    <BButton size="small" type="text">
      <div class="model-button-content">
        <span v-if="currentModelName" class="model-name">{{ currentModelName }}</span>
        <Icon v-if="groupedModels.length" class="dropdown-icon" icon="lucide:chevron-down" :style="{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }" />
      </div>
    </BButton>

    <template #overlay>
      <div class="model-selector">
        <div class="model-group">
          <template v-for="group in groupedModels" :key="group.providerId">
            <div class="model-group__header">{{ group.providerName }}</div>
            <div
              v-for="item in group.models"
              :key="item.value"
              class="model-selector__item"
              :class="{ 'is-active': item.value === internalModel }"
              @click="handleModelChange(item.value)"
            >
              <BModelIcon :model="item.modelId" :size="16" />
              <span class="model-selector__name">{{ item.modelName }}</span>
            </div>
          </template>
        </div>
      </div>
    </template>
  </BDropdown>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import BButton from '@/components/BButton/index.vue';
import BDropdown from '@/components/BDropdown/index.vue';
import BModelIcon from '@/components/BModelIcon/index.vue';
import { serviceModelsStorage } from '@/shared/storage';
import { dispatchServiceModelUpdated } from '@/shared/storage/service-models/events';
import { useProviderStore } from '@/stores/provider';

interface ModelItem {
  value: string;
  modelId: string;
  modelName: string;
}

interface ModelGroup {
  providerId: string;
  providerName: string;
  models: ModelItem[];
}

interface Props {
  model?: string;
}

interface ParsedModel {
  providerId: string;
  modelId: string;
}

const MODEL_VALUE_RE = /^([^:]+):(.+)$/;

function parseModelValue(value: string): ParsedModel | null {
  const match = value.match(MODEL_VALUE_RE);
  if (!match) return null;
  return { providerId: match[1], modelId: match[2] };
}

const props = withDefaults(defineProps<Props>(), {
  model: undefined
});

const emit = defineEmits<{
  (e: 'update:model', value: string): void;
}>();

const open = ref(false);
const store = useProviderStore();
const internalModel = ref<string>();

const providers = computed(() => store.providers);

const currentModelName = computed<string>(() => {
  if (!internalModel.value) return '';
  const parsed = parseModelValue(internalModel.value);
  if (!parsed) return '';
  const provider = providers.value.find((p) => p.id === parsed.providerId);
  return provider?.models?.find((m) => m.id === parsed.modelId)?.name ?? '';
});

const groupedModels = computed<ModelGroup[]>(() => {
  const result: ModelGroup[] = [];

  for (const provider of providers.value) {
    if (!provider.isEnabled || !provider.models?.length) continue;

    const models = provider.models.filter((m) => m.isEnabled).map((m) => ({ value: `${provider.id}:${m.id}`, modelId: m.id, modelName: m.name }));

    if (!models.length) continue;

    result.push({ providerId: provider.id, providerName: provider.name, models });
  }

  return result;
});

async function loadSavedConfig(): Promise<void> {
  if (internalModel.value) return;
  const config = await serviceModelsStorage.getConfig('chat');
  if (config?.providerId && config?.modelId) {
    internalModel.value = `${config.providerId}:${config.modelId}`;
  }
}

function handleModelChange(value: string): void {
  const parsed = parseModelValue(value);
  if (parsed) {
    serviceModelsStorage.saveConfig('chat', parsed);
    dispatchServiceModelUpdated('chat');
  }
  emit('update:model', value);
  open.value = false;
}

watch(
  () => props.model,
  (value) => {
    internalModel.value = value;
  },
  { immediate: true }
);

onMounted(async () => {
  await Promise.all([store.loadProviders(), loadSavedConfig()]);
});
</script>

<style scoped lang="less">
.model-selector {
  width: 260px;
  max-height: 360px;
  padding: 6px;
  overflow-y: auto;
  background: var(--dropdown-bg, var(--bg-primary));
  border: 1px solid var(--dropdown-border, var(--border-color));
  border-radius: 8px;
  box-shadow: 0 8px 24px rgb(0 0 0 / 12%);
}

.model-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.model-group + .model-group {
  margin-top: 4px;
}

.model-group__header {
  padding: 4px 8px 2px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.model-selector__item {
  display: flex;
  gap: 8px;
  align-items: center;
  height: 32px;
  padding: 0 8px;
  cursor: pointer;
  border-radius: 6px;
  transition: background-color 0.15s ease;

  &:hover {
    background: var(--bg-hover);
  }

  &.is-active {
    background: var(--bg-active, var(--bg-hover));
  }
}

.model-selector__name {
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 13px;
  color: var(--text-primary);
  white-space: nowrap;
}

.model-button-content {
  display: flex;
  gap: 6px;
  align-items: center;
}

.model-name {
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
  color: var(--text-primary);
  white-space: nowrap;
}

.dropdown-icon {
  font-size: 14px;
  color: var(--text-secondary);
  transition: transform 0.2s ease;
}
</style>
