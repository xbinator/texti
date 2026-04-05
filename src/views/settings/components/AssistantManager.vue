<template>
  <div class="assistant-manager">
    <div class="manager-header">
      <h2 class="manager-title">助理服务</h2>
      <BButton type="primary" :disabled="!hasModels" icon="lucide:plus" @click="handleAdd"> 添加助理 </BButton>
    </div>

    <div v-if="!hasModels" class="empty-models-hint">
      <Icon icon="lucide:alert-circle" />
      <span>请先在「模型管理」中添加模型</span>
    </div>

    <div class="manager-content">
      <ASpin :spinning="isLoading">
        <div v-if="assistants.length === 0 && hasModels" class="empty-state">
          <Icon icon="lucide:bot" class="empty-icon" />
          <p>暂无助理配置</p>
          <p class="empty-hint">点击上方按钮添加您的第一个助理</p>
        </div>

        <div v-else class="assistant-list">
          <div v-for="assistant in assistants" :key="assistant.id" class="assistant-card">
            <div class="card-header">
              <div class="card-title">
                <span v-if="assistant.isDefault" class="default-badge">默认</span>
                <span class="assistant-name">{{ assistant.name }}</span>
              </div>
              <div class="card-tags">
                <ATag :color="getModelColor(assistant.modelId)">{{ getModelName(assistant.modelId) }}</ATag>
              </div>
            </div>

            <div class="card-body">
              <div class="prompt-preview">
                <span class="prompt-label">System Prompt:</span>
                <span class="prompt-text">{{ assistant.systemPrompt || '未设置' }}</span>
              </div>
            </div>

            <div class="card-actions">
              <BButton size="small" type="secondary" @click="handleEdit(assistant)">编辑</BButton>
              <APopconfirm title="确定要删除此助理吗？" ok-text="删除" cancel-text="取消" @confirm="handleDelete(assistant.id)">
                <BButton size="small" type="secondary" @click="$event.preventDefault()">删除</BButton>
              </APopconfirm>
            </div>
          </div>
        </div>
      </ASpin>
    </div>

    <ADrawer v-model:open="drawerVisible" :title="editingAssistant ? '编辑助理' : '添加助理'" :width="520" :destroy-on-close="true">
      <AForm ref="formRef" :model="formData" :rules="formRules" layout="vertical">
        <AFormItem label="助理名称" name="name">
          <AInput v-model:value="formData.name" placeholder="写作助理" />
        </AFormItem>

        <AFormItem label="关联模型" name="modelId">
          <ASelect v-model:value="formData.modelId" placeholder="请选择模型">
            <ASelectOption v-for="model in enabledModels" :key="model.id" :value="model.id">
              {{ model.name }} ({{ getProviderLabel(model.provider) }})
            </ASelectOption>
          </ASelect>
        </AFormItem>

        <AFormItem label="System Prompt" name="systemPrompt">
          <ATextarea v-model:value="formData.systemPrompt" :rows="10" placeholder="你是一位专业的写作助理，帮助用户改进文章质量和表达..." />
        </AFormItem>

        <AFormItem name="isDefault">
          <ACheckbox v-model:checked="formData.isDefault">设为默认助理</ACheckbox>
        </AFormItem>
      </AForm>

      <template #footer>
        <div class="drawer-footer">
          <BButton type="secondary" @click="handleCancel">取消</BButton>
          <BButton type="primary" :loading="saving" @click="handleSave">保存</BButton>
        </div>
      </template>
    </ADrawer>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { Icon } from '@iconify/vue';
import { message } from 'ant-design-vue';
import BButton from '@/components/BButton/index.vue';
import type { Assistant } from '@/services/settings/types';
import { useAssistantStore, useModelStore } from '@/stores/settings';
import { providerGroups } from '../constants';

const assistantStore = useAssistantStore();
const modelStore = useModelStore();

const isLoading = ref(false);
const drawerVisible = ref(false);
const saving = ref(false);
const editingAssistant = ref<Assistant | null>(null);
const formRef = ref();

const assistants = ref<Assistant[]>([]);
const models = computed(() => modelStore.models);
const enabledModels = computed(() => modelStore.enabledModels);
const hasModels = computed(() => enabledModels.value.length > 0);

const formData = reactive({
  name: '',
  modelId: '',
  systemPrompt: '',
  isDefault: false
});

const formRules = {
  name: [{ required: true, message: '请输入助理名称' }],
  modelId: [{ required: true, message: '请选择模型' }]
};

async function loadData(): Promise<void> {
  isLoading.value = true;
  try {
    await Promise.all([assistantStore.loadAssistants(), modelStore.loadModels()]);
    assistants.value = assistantStore.assistants;
  } finally {
    isLoading.value = false;
  }
}

function handleAdd(): void {
  editingAssistant.value = null;
  Object.assign(formData, {
    name: '',
    modelId: '',
    systemPrompt: '',
    isDefault: false
  });
  drawerVisible.value = true;
}

function handleEdit(assistant: Assistant): void {
  editingAssistant.value = assistant;
  Object.assign(formData, {
    name: assistant.name,
    modelId: assistant.modelId,
    systemPrompt: assistant.systemPrompt || '',
    isDefault: assistant.isDefault
  });
  drawerVisible.value = true;
}

async function handleSave(): Promise<void> {
  try {
    await formRef.value?.validate();
  } catch {
    return;
  }

  saving.value = true;
  try {
    if (editingAssistant.value) {
      await assistantStore.updateAssistant(editingAssistant.value.id, {
        name: formData.name,
        modelId: formData.modelId,
        systemPrompt: formData.systemPrompt || null,
        isDefault: formData.isDefault
      });
      message.success('更新成功');
    } else {
      await assistantStore.createAssistant({
        name: formData.name,
        modelId: formData.modelId,
        systemPrompt: formData.systemPrompt || undefined,
        isDefault: formData.isDefault
      });
      message.success('添加成功');
    }
    drawerVisible.value = false;
    assistants.value = assistantStore.assistants;
  } catch (e) {
    message.error(e instanceof Error ? e.message : '操作失败');
  } finally {
    saving.value = false;
  }
}

function handleCancel(): void {
  drawerVisible.value = false;
}

async function handleDelete(id: string): Promise<void> {
  try {
    await assistantStore.deleteAssistant(id);
    message.success('删除成功');
    assistants.value = assistantStore.assistants;
  } catch (e) {
    message.error(e instanceof Error ? e.message : '删除失败');
  }
}

function getModelName(modelId: string): string {
  const model = models.value.find((m) => m.id === modelId);
  return model?.name || modelId;
}

function getModelColor(modelId: string): string {
  const model = models.value.find((m) => m.id === modelId);
  if (!model) return 'default';
  const colors: Record<string, string> = {
    openai: 'green',
    anthropic: 'orange',
    google: 'blue',
    deepseek: 'purple',
    moonshot: 'cyan',
    zhipu: 'geekblue',
    custom: 'default'
  };
  return colors[model.provider] || 'default';
}

function getProviderLabel(provider: string): string {
  const opt = providerGroups.flatMap((g) => g.options).find((o) => o.value === provider);
  return opt?.label || provider;
}

onMounted(() => {
  loadData();
});
</script>

<style scoped lang="less">
.assistant-manager {
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

.empty-models-hint {
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

.assistant-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.assistant-card {
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

.assistant-name {
  font-size: 16px;
  font-weight: 500;
  color: var(--text-primary);
}

.card-tags {
  display: flex;
  gap: 8px;
}

.card-body {
  margin-bottom: 12px;
}

.prompt-preview {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.prompt-label {
  font-size: 12px;
  color: var(--text-tertiary);
}

.prompt-text {
  display: -webkit-box;
  padding: 8px 12px;
  overflow: hidden;
  -webkit-line-clamp: 3;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-secondary);
  white-space: pre-wrap;
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  -webkit-box-orient: vertical;
}

.card-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: flex-end;
  padding-top: 12px;
  border-top: 1px solid var(--border-primary);
}

.drawer-footer {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: flex-end;
  padding: 16px;
  margin-top: 8px;
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

:deep(.ant-drawer-content) {
  border-radius: 12px;
}

:deep(.ant-drawer-header) {
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-primary);
}

:deep(.ant-drawer-body) {
  padding: 20px;
}
</style>
