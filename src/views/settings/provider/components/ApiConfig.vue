<template>
  <div class="config-section">
    <AForm layout="vertical">
      <AFormItem label="API Key">
        <AInputPassword v-model:value="dataItem.apiKey" placeholder="请输入 API Key" />
      </AFormItem>
      <AFormItem label="API 代理地址">
        <AInput v-model:value="dataItem.baseUrl" placeholder="例如: https://api.example.com" />
      </AFormItem>

      <AAlert v-if="baseUrlHint" class="base-url-alert" :message="baseUrlHint" />
    </AForm>

    <div class="connection-test">
      <div class="test-info">
        <div class="test-title">
          <div>连通性检查</div>
          <ATooltip title="测试 API Key 与代理地址是否正确配置">
            <Icon icon="lucide:help-circle" width="14" height="14" class="title-icon" />
          </ATooltip>
        </div>
      </div>
      <div class="test-actions">
        <BSelect v-model:value="testModel" :options="modelOptions" placeholder="选择测试模型" class="model-select" />
        <BButton type="primary" :loading="loading" :disabled="!testModel" @click="handleTestClick">检查</BButton>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { AIProvider, AIProviderModel } from 'types/ai';
import { computed, ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import { message } from 'ant-design-vue';
import BButton from '@/components/BButton/index.vue';
import { useChat } from '@/hooks/useChat';
import { providerFormatOptions } from '../../constants';

interface Props {
  models: AIProviderModel[];
}

const props = defineProps<Props>();

const dataItem = defineModel<Partial<AIProvider>>('value', { default: () => ({}) });

const testModel = ref<string | undefined>(undefined);

const { agent } = useChat({ providerId: () => dataItem.value.id, ignoreEnabled: true });

const loading = ref(false);

/**
 * 根据当前服务商请求格式计算的 baseUrl 填写提示文案
 * @description 从 providerFormatOptions 查表，有 suffix 时补充"不要以斜杠结尾"与自动拼接的端点路径
 */
const baseUrlHint = computed<string>(() => {
  const providerType = dataItem.value.type;
  if (!providerType) return '';

  const option = providerFormatOptions.find((item) => item.value === providerType);
  if (!option) return '';

  if (option.suffix) {
    return `请填写兼容 ${option.protocol} API 的服务端点地址，不要以斜杠结尾。${option.suffix} 将会被补充到你填写的地址末尾`;
  }
  return `请填写兼容 ${option.protocol} API 的服务端点地址`;
});

const modelOptions = computed(() => {
  const _models = props.models.filter((model: AIProviderModel) => model.isEnabled);

  return _models.map((model: AIProviderModel) => ({ label: model.name, value: model.id }));
});

async function handleTestClick(): Promise<void> {
  if (!testModel.value || !dataItem.value.id || loading.value) return;

  loading.value = true;

  const [error, result] = await agent.invoke({ modelId: testModel.value, prompt: 'Hello', maxOutputTokens: 400 });

  loading.value = false;
  if (error) {
    message.error(error.message);
  } else {
    message.success(`连通性检查成功: ${result.text}`);
  }
}

watch(
  () => props.models,
  (nextModels: AIProviderModel[]) => {
    const enabledModel = nextModels.find((model) => model.isEnabled);

    const hasSelectedModel = nextModels.some((model) => model.id === testModel.value && model.isEnabled);

    if (!hasSelectedModel) {
      testModel.value = enabledModel?.id;
    }
  },
  { immediate: true, deep: true }
);
</script>

<style scoped lang="less">
.config-section {
  padding: 20px;
  container-name: api-config;
  container-type: inline-size;
  background: var(--bg-secondary);
  border-radius: var(--surface-radius);
}

.config-section :deep(.ant-form) {
  padding: 20px;
  margin-bottom: 24px;
  background: var(--bg-primary);
  border: var(--surface-border-width) solid var(--border-primary);
  border-radius: var(--surface-radius);
}

.config-section :deep(.ant-form-item) {
  margin-bottom: 20px;
}

.config-section :deep(.ant-form-item:last-child) {
  margin-bottom: 0;
}

.config-section :deep(.base-url-alert .ant-alert-message) {
  font-size: 12px;
}

.connection-test {
  display: flex;
  gap: 20px;
  align-items: center;
  justify-content: space-between;
  padding-top: 20px;
  border-top: 1px solid var(--border-primary);
}

.test-info {
  flex: 1;
}

.test-title {
  display: flex;
  gap: 4px;
  align-items: center;
  margin: 0 0 4px;
  font-weight: 500;
}

.title-icon {
  color: var(--text-secondary);
  cursor: help;
}

.test-desc {
  margin: 0;
  font-size: 12px;
  color: var(--text-secondary);
}

.test-actions {
  display: flex;
  flex-shrink: 0;
  gap: 12px;
  align-items: center;
}

.model-select {
  min-width: 200px;
}

@container api-config (max-width: 520px) {
  .connection-test {
    flex-direction: column;
    gap: 12px;
    align-items: stretch;
  }

  .test-info {
    flex: none;
  }

  .test-actions {
    flex-wrap: wrap;
    width: 100%;
  }

  .model-select {
    flex: 1 1 0;
    min-width: 0;
  }
}
</style>
