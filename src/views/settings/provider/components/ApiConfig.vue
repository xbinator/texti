<template>
  <div class="config-section">
    <h3 class="section-title">API 配置</h3>
    <div class="config-form">
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
          <BSelect v-model:value="testModel" placeholder="选择测试模型" class="model-select" />
          <BButton type="primary">检查</BButton>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Provider } from '../types';
import { ref } from 'vue';
import BButton from '@/components/BButton/index.vue';

const dataItem = defineModel<Partial<Provider>>('value', { default: () => ({}) });

const testModel = ref<string | undefined>(undefined);
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

.config-form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.connection-test {
  padding: 16px;
  margin-top: 8px;
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
