<template>
  <div class="model-manager">
    <div class="manager-header">
      <h2 class="manager-title">模型管理</h2>
      <BButton type="primary" :disabled="!hasApiKeys" icon="lucide:plus" @click="handleAdd"> 添加模型 </BButton>
    </div>

    <div v-if="!hasApiKeys" class="empty-keys-hint">
      <Icon icon="lucide:alert-circle" />
      <span>请先在「秘钥管理」中添加 API Key</span>
    </div>

    <div class="manager-content">
      <ASpin :spinning="isLoading">
        <div v-if="models.length === 0 && hasApiKeys" class="empty-state">
          <Icon icon="lucide:cpu" class="empty-icon" />
          <p>暂无模型配置</p>
          <p class="empty-hint">点击上方按钮添加您的第一个模型</p>
        </div>

        <div v-else class="model-list">
          <div v-for="model in models" :key="model.id" class="model-card">
            <div class="card-header">
              <div class="card-title">
                <span v-if="model.isDefault" class="default-badge">默认</span>
                <span class="model-name">{{ model.name }}</span>
              </div>
              <div class="card-tags">
                <ATag :color="getProviderColor(model.provider)">{{ getProviderLabel(model.provider) }}</ATag>
                <ATag color="default">{{ model.modelId }}</ATag>
                <ATag v-if="!model.isEnabled" color="warning">已禁用</ATag>
              </div>
            </div>

            <div class="card-body">
              <div class="info-row">
                <span class="info-label">API Key:</span>
                <span class="info-value">{{ getProfileName(model.apiKeyProfileId) }}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Temperature:</span>
                <span class="info-value">{{ model.temperature }}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Max Tokens:</span>
                <span class="info-value">{{ model.maxTokens }}</span>
              </div>
            </div>

            <div class="card-actions">
              <ASwitch :checked="model.isEnabled" size="small" @change="(checked: boolean) => handleToggleEnabled(model.id, checked)" />
              <BButton size="small" type="secondary" @click="handleEdit(model)">编辑</BButton>
              <APopconfirm title="确定要删除此模型吗？" ok-text="删除" cancel-text="取消" @confirm="handleDelete(model.id)">
                <BButton size="small" type="secondary" @click="$event.preventDefault()">删除</BButton>
              </APopconfirm>
            </div>
          </div>
        </div>
      </ASpin>
    </div>

    <AModal
      v-model:open="modalVisible"
      :title="editingModel ? '编辑模型' : '添加模型'"
      :confirm-loading="saving"
      width="520px"
      @ok="handleSave"
      @cancel="handleCancel"
    >
      <AForm ref="formRef" :model="formData" :rules="formRules" layout="vertical">
        <AFormItem label="模型名称" name="name">
          <AInput v-model:value="formData.name" placeholder="GPT-4o" />
        </AFormItem>

        <AFormItem label="Provider" name="provider">
          <ASelect v-model:value="formData.provider" placeholder="请选择 Provider" :disabled="!!editingModel">
            <ASelectOptGroup v-for="group in providerGroups" :key="group.label" :label="group.label">
              <ASelectOption v-for="opt in group.options" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </ASelectOption>
            </ASelectOptGroup>
          </ASelect>
        </AFormItem>

        <AFormItem label="Model ID" name="modelId">
          <AInput v-model:value="formData.modelId" placeholder="gpt-4o" />
        </AFormItem>

        <AFormItem label="API Key" name="apiKeyProfileId">
          <ASelect v-model:value="formData.apiKeyProfileId" placeholder="选择已保存的秘钥">
            <ASelectOption v-for="profile in apiProfiles" :key="profile.id" :value="profile.id">
              {{ profile.name }} ({{ getProviderLabel(profile.provider) }})
            </ASelectOption>
          </ASelect>
        </AFormItem>

        <ARow :gutter="16">
          <ACol :span="12">
            <AFormItem label="Temperature" name="temperature">
              <AInputNumber v-model:value="formData.temperature" :min="0" :max="2" :step="0.1" style="width: 100%" />
            </AFormItem>
          </ACol>
          <ACol :span="12">
            <AFormItem label="Max Tokens" name="maxTokens">
              <AInputNumber v-model:value="formData.maxTokens" :min="1" :max="1000000" :step="1" style="width: 100%" />
            </AFormItem>
          </ACol>
        </ARow>

        <AFormItem name="isDefault">
          <ACheckbox v-model:checked="formData.isDefault">设为默认模型</ACheckbox>
        </AFormItem>
      </AForm>
    </AModal>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { Icon } from '@iconify/vue';
import { message } from 'ant-design-vue';
import BButton from '@/components/BButton/index.vue';
import type { Model, Provider } from '@/services/settings/types';
import { useModelStore, useApiKeyStore } from '@/stores/settings';
import { providerGroups } from '../constants';

const modelStore = useModelStore();
const apiKeyStore = useApiKeyStore();

const isLoading = ref(false);
const modalVisible = ref(false);
const saving = ref(false);
const editingModel = ref<Model | null>(null);
const formRef = ref();

const models = ref<Model[]>([]);
const apiProfiles = computed(() => apiKeyStore.profiles);
const hasApiKeys = computed(() => apiProfiles.value.length > 0);

const formData = reactive({
  name: '',
  provider: '' as Provider | '',
  modelId: '',
  apiKeyProfileId: '',
  temperature: 0.7,
  maxTokens: 4096,
  isDefault: false
});

const formRules = {
  name: [{ required: true, message: '请输入模型名称' }],
  provider: [{ required: true, message: '请选择 Provider' }],
  modelId: [{ required: true, message: '请输入 Model ID' }],
  apiKeyProfileId: [{ required: true, message: '请选择 API Key' }]
};

async function loadData(): Promise<void> {
  isLoading.value = true;
  try {
    await Promise.all([modelStore.loadModels(), apiKeyStore.loadProfiles()]);
    models.value = modelStore.models;
  } finally {
    isLoading.value = false;
  }
}

function handleAdd(): void {
  editingModel.value = null;
  Object.assign(formData, {
    name: '',
    provider: '',
    modelId: '',
    apiKeyProfileId: '',
    temperature: 0.7,
    maxTokens: 4096,
    isDefault: false
  });
  modalVisible.value = true;
}

function handleEdit(model: Model): void {
  editingModel.value = model;
  Object.assign(formData, {
    name: model.name,
    provider: model.provider,
    modelId: model.modelId,
    apiKeyProfileId: model.apiKeyProfileId,
    temperature: model.temperature,
    maxTokens: model.maxTokens,
    isDefault: model.isDefault
  });
  modalVisible.value = true;
}

async function handleSave(): Promise<void> {
  try {
    await formRef.value?.validate();
  } catch {
    return;
  }

  saving.value = true;
  try {
    if (editingModel.value) {
      await modelStore.updateModel(editingModel.value.id, {
        name: formData.name,
        modelId: formData.modelId,
        apiKeyProfileId: formData.apiKeyProfileId,
        temperature: formData.temperature,
        maxTokens: formData.maxTokens,
        isDefault: formData.isDefault
      });
      message.success('更新成功');
    } else {
      await modelStore.createModel({
        name: formData.name,
        provider: formData.provider as Provider,
        modelId: formData.modelId,
        apiKeyProfileId: formData.apiKeyProfileId,
        temperature: formData.temperature,
        maxTokens: formData.maxTokens,
        isDefault: formData.isDefault
      });
      message.success('添加成功');
    }
    modalVisible.value = false;
    models.value = modelStore.models;
  } catch (e) {
    message.error(e instanceof Error ? e.message : '操作失败');
  } finally {
    saving.value = false;
  }
}

function handleCancel(): void {
  modalVisible.value = false;
}

async function handleDelete(id: string): Promise<void> {
  try {
    await modelStore.deleteModel(id);
    message.success('删除成功');
    models.value = modelStore.models;
  } catch (e) {
    message.error(e instanceof Error ? e.message : '删除失败');
  }
}

async function handleToggleEnabled(id: string, enabled: boolean): Promise<void> {
  try {
    await modelStore.setModelEnabled(id, enabled);
    models.value = modelStore.models;
  } catch (e) {
    message.error(e instanceof Error ? e.message : '操作失败');
  }
}

function getProfileName(profileId: string): string {
  const profile = apiProfiles.value.find((p) => p.id === profileId);
  return profile?.name || profileId;
}

function getProviderLabel(provider: Provider): string {
  const opt = providerGroups.flatMap((g) => g.options).find((o) => o.value === provider);
  return opt?.label || provider;
}

function getProviderColor(provider: Provider): string {
  const colors: Record<Provider, string> = {
    openai: 'green',
    anthropic: 'orange',
    google: 'blue',
    deepseek: 'purple',
    moonshot: 'cyan',
    zhipu: 'geekblue',
    custom: 'default'
  };
  return colors[provider] || 'default';
}

onMounted(() => {
  loadData();
});
</script>

<style scoped lang="less">
.model-manager {
  height: 100%;
}

.manager-header {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
}

.manager-title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: var(--text-primary);
}

.empty-keys-hint {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 12px 16px;
  margin-bottom: 24px;
  font-size: 14px;
  color: var(--color-warning);
  background: var(--color-warning-bg);
  border-radius: 8px;
  transition: all 0.15s ease;
}

.manager-content {
  flex: 1;
}

.empty-state {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
  justify-content: center;
  height: 300px;
  color: var(--text-tertiary);
}

.empty-icon {
  font-size: 48px;
  opacity: 0.5;
}

.empty-hint {
  font-size: 13px;
}

.model-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.model-card {
  padding: 16px;
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-radius: 12px;
  transition: all 0.15s ease;

  &:hover {
    box-shadow: 0 2px 8px rgb(0 0 0 / 8%);
    border-color: var(--border-primary);
  }
}

.card-header {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.card-title {
  display: flex;
  gap: 8px;
  align-items: center;
}

.default-badge {
  padding: 2px 8px;
  font-size: 12px;
  color: #fff;
  background: var(--color-primary);
  border-radius: 4px;
}

.model-name {
  font-size: 16px;
  font-weight: 500;
  color: var(--text-primary);
}

.card-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.card-body {
  margin-bottom: 12px;
}

.info-row {
  display: flex;
  gap: 8px;
  margin-bottom: 4px;
  font-size: 13px;
}

.info-label {
  flex-shrink: 0;
  width: 100px;
  color: var(--text-tertiary);
}

.info-value {
  color: var(--text-secondary);
}

.card-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: flex-end;
  padding-top: 12px;
  border-top: 1px solid var(--border-primary);
}

// 覆盖 Ant Design 组件样式
:deep(.ant-tag) {
  font-size: 12px;
  border-radius: 4px;
  padding: 0 8px;
  height: 20px;
  line-height: 18px;
}

:deep(.ant-switch) {
  margin-right: 4px;
}
</style>
