<!--
  @file ModelSelector.vue
  @description Chat model selector dropdown with programmatic open support.
-->
<template>
  <BDropdown v-if="groupedModels.length" v-model:open="open">
    <BButton size="small" type="text">
      <div class="model-button-content">
        <span class="model-name" :class="{ 'model-name--placeholder': !currentModelName }">{{ currentModelName || '请选择模型' }}</span>
        <BIcon class="dropdown-icon" icon="lucide:chevron-down" :rotate="open ? 180 : 0" />
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
import { computed, ref, watch } from 'vue';
import BButton from '@/components/BButton/index.vue';
import BDropdown from '@/components/BDropdown/index.vue';
import BModelIcon from '@/components/BModel/Icon.vue';
import type { ModelGroup } from '@/stores/ai/provider';
import { useProviderStore } from '@/stores/ai/provider';
import type { SelectedModel } from '@/stores/ai/serviceModel';

/**
 * 组件属性。
 */
interface Props {
  /** 当前选中的模型标识。 */
  model?: SelectedModel;
}

/**
 * 解析后的模型标识。
 */
interface ParsedModel {
  /** 提供方 ID。 */
  providerId: string;
  /** 模型 ID。 */
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
  (e: 'update:model', model: SelectedModel): void;
}>();

const open = ref(false);
const store = useProviderStore();
const internalModel = ref<string>();

const providers = computed(() => store.providers);

/**
 * 获取当前选中模型的显示名称。
 * 通过解析 internalModel 值，查找对应的 provider 和 model，返回模型的友好名称。
 * 如果未选中模型或找不到对应模型，返回空字符串。
 */
const currentModelName = computed<string>(() => {
  // 未选中任何模型时返回空字符串
  if (!internalModel.value) return '';

  // 解析模型值，格式为 "providerId:modelId"
  const parsed = parseModelValue(internalModel.value);
  if (!parsed) return '';

  // 查找对应的 provider
  const provider = providers.value.find((p) => p.id === parsed.providerId);

  // 从 provider 的模型列表中查找对应的模型名称
  return provider?.models?.find((m) => m.id === parsed.modelId)?.name ?? '';
});

/**
 * 将所有可用模型按提供方分组，用于渲染下拉菜单。
 * 数据来自 store 的 `availableModels` 事实源，过滤口径已统一。
 */
const groupedModels = computed<ModelGroup[]>(() => store.availableModels);

function handleModelChange(value: string): void {
  const parsed = parseModelValue(value);
  if (parsed) {
    emit('update:model', parsed);
  }
  open.value = false;
}

watch(
  () => props.model,
  (value) => {
    internalModel.value = value ? `${value.providerId}:${value.modelId}` : undefined;
  },
  { immediate: true }
);

/**
 * 暴露给父组件的程序化打开入口。
 */
defineExpose({
  open: (): void => {
    open.value = true;
  }
});
</script>

<style scoped lang="less">
.model-selector {
  width: 260px;
  max-height: 360px;
  padding: 6px;
  overflow-y: auto;
  background: var(--dropdown-bg);
  border-radius: var(--overlay-radius);
  box-shadow: var(--shadow-dropdown);
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
  border-radius: var(--control-radius);
  transition: background var(--motion-duration-fast) var(--motion-easing-standard);

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
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
  line-height: 16px;
  color: var(--text-primary);
  white-space: nowrap;
}

.model-name--placeholder {
  color: var(--text-secondary);
}

.dropdown-icon {
  font-size: 14px;
  color: var(--text-secondary);
}
</style>
