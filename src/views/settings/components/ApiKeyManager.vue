<template>
  <div class="api-key-manager">
    <div class="manager-header">
      <h2 class="manager-title">秘钥管理</h2>
      <BButton type="primary" icon="lucide:plus" @click="handleAdd"> 添加秘钥 </BButton>
    </div>

    <div class="manager-content">
      <ASpin :spinning="isLoading">
        <div v-if="profiles.length === 0" class="empty-state">
          <Icon icon="lucide:key-round" class="empty-icon" />
          <p>暂无秘钥配置</p>
          <p class="empty-hint">点击上方按钮添加您的第一个 API Key</p>
        </div>

        <div v-else class="profile-list">
          <div v-for="profile in profiles" :key="profile.id" class="profile-card">
            <div class="card-header">
              <div class="card-title">
                <span v-if="profile.isDefault" class="default-badge">默认</span>
                <span class="profile-name">{{ profile.name }}</span>
              </div>
              <div class="card-tags">
                <ATag :color="getProviderColor(profile.provider)">{{ getProviderLabel(profile.provider) }}</ATag>
                <ATag :color="getStatusColor(profile.connectionStatus)">
                  {{ getStatusIcon(profile.connectionStatus) }} {{ getStatusText(profile.connectionStatus) }}
                </ATag>
              </div>
            </div>

            <div class="card-body">
              <div class="info-row">
                <span class="info-label">API Key:</span>
                <span class="info-value masked">••••••••••••••••••••••••</span>
              </div>
              <div v-if="profile.baseUrl" class="info-row">
                <span class="info-label">Base URL:</span>
                <span class="info-value">{{ profile.baseUrl }}</span>
              </div>
              <div v-if="profile.lastTestedAt" class="info-row">
                <span class="info-label">上次测试:</span>
                <span class="info-value">
                  {{ formatTime(profile.lastTestedAt) }}
                  <span v-if="profile.latencyMs" class="latency">({{ profile.latencyMs }}ms)</span>
                </span>
              </div>
            </div>

            <div class="card-actions">
              <BButton size="small" :loading="testingId === profile.id" @click="handleTest(profile.id)">测试连接</BButton>
              <BButton size="small" type="secondary" @click="handleEdit(profile)">编辑</BButton>
              <APopconfirm title="确定要删除此秘钥吗？" ok-text="删除" cancel-text="取消" @confirm="handleDelete(profile.id)">
                <BButton size="small" type="secondary" @click="$event.preventDefault()">删除</BButton>
              </APopconfirm>
            </div>
          </div>
        </div>
      </ASpin>
    </div>

    <AModal v-model:open="modalVisible" :title="editingProfile ? '编辑秘钥' : '添加秘钥'" :confirm-loading="saving" @ok="handleSave" @cancel="handleCancel">
      <AForm ref="formRef" :model="formData" :rules="formRules" layout="vertical">
        <AFormItem label="名称" name="name">
          <AInput v-model:value="formData.name" placeholder="请输入秘钥名称" />
        </AFormItem>

        <AFormItem label="Provider" name="provider">
          <ASelect v-model:value="formData.provider" placeholder="请选择 Provider" :disabled="!!editingProfile">
            <ASelectOptGroup v-for="group in providerGroups" :key="group.label" :label="group.label">
              <ASelectOption v-for="opt in group.options" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </ASelectOption>
            </ASelectOptGroup>
          </ASelect>
        </AFormItem>

        <AFormItem label="API Key" name="apiKey">
          <AInputPassword v-model:value="formData.apiKey" :placeholder="editingProfile ? '留空则保持原值' : '请输入 API Key'" />
        </AFormItem>

        <AFormItem v-if="formData.provider === 'custom'" label="Base URL" name="baseUrl">
          <AInput v-model:value="formData.baseUrl" placeholder="https://api.example.com/v1" />
        </AFormItem>
        <AFormItem v-else-if="formData.provider" label="Base URL">
          <AInput v-model:value="formData.baseUrl" :placeholder="defaultBaseUrls[formData.provider] || ''" />
        </AFormItem>

        <AFormItem name="isDefault">
          <ACheckbox v-model:checked="formData.isDefault">设为默认秘钥</ACheckbox>
        </AFormItem>
      </AForm>
    </AModal>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { Icon } from '@iconify/vue';
import { message } from 'ant-design-vue';
import dayjs from 'dayjs';
import BButton from '@/components/BButton/index.vue';
import type { ApiKeyProfile, Provider, ConnectionStatus } from '@/services/settings/types';
import { useApiKeyStore } from '@/stores/settings';
import { providerGroups, defaultBaseUrls, connectionStatusConfig } from '../constants';

const apiKeyStore = useApiKeyStore();

const isLoading = ref(false);
const testingId = ref<string | null>(null);
const modalVisible = ref(false);
const saving = ref(false);
const editingProfile = ref<ApiKeyProfile | null>(null);
const formRef = ref();

const profiles = ref<ApiKeyProfile[]>([]);

const formData = reactive({
  name: '',
  provider: '' as Provider | '',
  apiKey: '',
  baseUrl: '',
  isDefault: false
});

const formRules = {
  name: [{ required: true, message: '请输入名称' }],
  provider: [{ required: true, message: '请选择 Provider' }],
  apiKey: [{ required: true, message: '请输入 API Key' }]
};

async function loadProfiles(): Promise<void> {
  isLoading.value = true;
  try {
    await apiKeyStore.loadProfiles();
    profiles.value = apiKeyStore.profiles;
  } finally {
    isLoading.value = false;
  }
}

function handleAdd(): void {
  editingProfile.value = null;
  Object.assign(formData, {
    name: '',
    provider: '',
    apiKey: '',
    baseUrl: '',
    isDefault: false
  });
  modalVisible.value = true;
}

function handleEdit(profile: ApiKeyProfile): void {
  editingProfile.value = profile;
  Object.assign(formData, {
    name: profile.name,
    provider: profile.provider,
    apiKey: '',
    baseUrl: profile.baseUrl || '',
    isDefault: profile.isDefault
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
    if (editingProfile.value) {
      const updateData: { name: string; apiKey?: string; baseUrl: string; isDefault: boolean } = {
        name: formData.name,
        baseUrl: formData.baseUrl || '',
        isDefault: formData.isDefault
      };
      if (formData.apiKey) {
        updateData.apiKey = formData.apiKey;
      }
      await apiKeyStore.updateProfile(editingProfile.value.id, updateData);
      message.success('更新成功');
    } else {
      await apiKeyStore.createProfile({
        name: formData.name,
        provider: formData.provider as Provider,
        apiKey: formData.apiKey,
        baseUrl: formData.baseUrl || undefined,
        isDefault: formData.isDefault
      });
      message.success('添加成功');
    }
    modalVisible.value = false;
    await loadProfiles();
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
    await apiKeyStore.deleteProfile(id);
    message.success('删除成功');
    await loadProfiles();
  } catch (e) {
    message.error(e instanceof Error ? e.message : '删除失败');
  }
}

async function handleTest(id: string): Promise<void> {
  testingId.value = id;
  try {
    const result = await apiKeyStore.testConnection(id);
    if (result.success) {
      message.success(`连接成功 (${result.latencyMs}ms)`);
    } else {
      message.error(result.error || '连接失败');
    }
    await loadProfiles();
  } catch (e) {
    message.error(e instanceof Error ? e.message : '测试失败');
  } finally {
    testingId.value = null;
  }
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

function getStatusColor(status: ConnectionStatus): string {
  return connectionStatusConfig[status].color;
}

function getStatusText(status: ConnectionStatus): string {
  return connectionStatusConfig[status].text;
}

function getStatusIcon(status: ConnectionStatus): string {
  return connectionStatusConfig[status].icon;
}

function formatTime(timestamp: number): string {
  return dayjs(timestamp).format('YYYY-MM-DD HH:mm');
}

onMounted(() => {
  loadProfiles();
});
</script>

<style scoped lang="less">
.api-key-manager {
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

.profile-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.profile-card {
  padding: 16px;
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-radius: 12px;
  transition: all 0.15s ease;

  &:hover {
    border-color: var(--border-primary);
    box-shadow: 0 2px 8px rgb(0 0 0 / 8%);
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

.profile-name {
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
  width: 80px;
  color: var(--text-tertiary);
}

.info-value {
  color: var(--text-secondary);
  word-break: break-all;

  &.masked {
    font-family: monospace;
    letter-spacing: 1px;
  }
}

.latency {
  color: var(--color-success);
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
  height: 20px;
  padding: 0 8px;
  font-size: 12px;
  line-height: 18px;
  border-radius: 4px;
}
</style>
