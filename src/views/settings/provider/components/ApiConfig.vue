<template>
  <div class="config-section">
    <h3 class="section-title">API 配置</h3>
    <AForm layout="vertical">
      <AFormItem label="API Key" required>
        <AInputPassword v-model:value="dataItem.apiKey" placeholder="请输入 API Key" />
      </AFormItem>
      <AFormItem label="API 代理地址">
        <AInput v-model:value="dataItem.baseUrl" placeholder="例如: https://api.example.com" />
      </AFormItem>
    </AForm>

    <div class="connection-test">
      <h4 class="test-title">连通性检查</h4>
      <p class="test-desc">测试 API Key 与代理地址是否正确配置</p>
      <div class="test-actions">
        <BSelect v-model:value="testModel" :options="modelOptions" placeholder="选择测试模型" class="model-select" />
        <BButton type="primary" :loading="testing" :disabled="!testModel" @click="handleTestClick">检查</BButton>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Provider } from '../types';
import { computed, ref, watch } from 'vue';
import { message } from 'ant-design-vue';
import BButton from '@/components/BButton/index.vue';
import { aiService } from '@/services/ai';

interface TestModelOption {
  id: string;
  name: string;
  isEnabled: boolean;
}

interface Props {
  models: TestModelOption[];
}

const props = defineProps<Props>();

const dataItem = defineModel<Partial<Provider>>('value', { default: () => ({}) });

const testModel = ref<string | undefined>(undefined);
const testing = ref(false);

const modelOptions = computed(() => {
  const _models = props.models.filter((model: TestModelOption) => model.isEnabled);

  return _models.map((model: TestModelOption) => ({ label: model.name, value: model.id }));
});

async function handleTestClick(): Promise<void> {
  if (!testModel.value || !dataItem.value.id) return;

  testing.value = true;

  const [error, result] = await aiService.generateText({ providerId: dataItem.value.id, modelId: testModel.value, prompt: 'Hello', ignoreEnabled: true });

  testing.value = false;

  if (error) {
    message.error(error.message);
  } else {
    message.success(`连通性检查成功: ${result.text}`);
  }
}

watch(
  () => props.models,
  (nextModels: TestModelOption[]) => {
    const enabledModel = nextModels.find((model: TestModelOption) => model.isEnabled);

    const hasSelectedModel = nextModels.some((model: TestModelOption) => model.id === testModel.value && model.isEnabled);

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
  background: var(--bg-secondary);
  border-radius: 10px;
}

.section-title {
  margin: 0 0 16px;
  font-size: 16px;
  font-weight: 500;
  color: var(--text-primary);
}

.connection-test {
  padding: 16px;
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
}

.test-title {
  margin: 0 0 4px;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
}

.test-desc {
  margin: 0 0 12px;
  font-size: 12px;
  color: var(--text-secondary);
}

.test-actions {
  display: flex;
  gap: 12px;
  align-items: center;
}

.model-select {
  flex: 1;
}
</style>
