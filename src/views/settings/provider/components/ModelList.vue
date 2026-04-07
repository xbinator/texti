<template>
  <div class="model-section">
    <div class="section-header">
      <h3 class="section-title">模型列表</h3>
      <div class="section-actions">
        <AInput v-model:value="searchText" placeholder="搜索模型" class="search-input" />
        <BButton @click="handleCreateModel"> 创建 AI 模型 </BButton>
      </div>
    </div>

    <div class="model-categories">
      <ASegmented v-model:value="activeCategory" :options="categoryOptions" class="w-full" />
    </div>

    <div class="model-grid">
      <div v-for="model in filteredModels" :key="model.id" class="model-item">
        <div class="model-image">
          <BModelIcon :provider="providerId" :model="model.id" :size="40" />
        </div>
        <div class="model-info">
          <h4 class="model-name">{{ model.name }}</h4>
          <p class="model-id">{{ model.id }}</p>
        </div>
        <div class="model-actions">
          <BButton type="text" size="small" square icon="lucide:edit" @click="handleEditModel(model)" />
          <BButton type="text" size="small" square danger icon="lucide:trash-2" @click="handleDeleteModel(model.id)" />
          <ASwitch :checked="model.isEnabled" size="small" @change="(checked) => handleToggleModel(model.id, checked as boolean)" />
        </div>
      </div>
    </div>

    <div v-if="filteredModels.length === 0" class="empty-models">
      <Icon icon="lucide:box" class="empty-icon" />
      <p>未找到模型</p>
    </div>
  </div>

  <ModelModal v-model:open="modalVisible" :model="currentModel" :provider-id="providerId" :models="models" @success="handleModelSuccess" />
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { Icon } from '@iconify/vue';
import { message } from 'ant-design-vue';
import BButton from '@/components/BButton/index.vue';
import BModelIcon from '@/components/BModelIcon/index.vue';
import type { ProviderModel } from '@/utils/storage/providers/types';
import { useProviders } from '../hooks/useProviders';
import ModelModal from './ModelModal.vue';

interface Category {
  key: string;
  label: string;
}

interface Props {
  providerId: string;
  models: ProviderModel[];
  categories?: Category[];
}

const props = withDefaults(defineProps<Props>(), {
  categories: () => [
    { key: 'all', label: '全 部' },
    { key: 'chat', label: '对 话' },
    { key: 'image', label: '图 片' },
    { key: 'video', label: '视 频' }
  ]
});

const emit = defineEmits<{
  (e: 'refresh'): void;
  (e: 'modelCreated', model: ProviderModel): void;
  (e: 'modelUpdated', model: ProviderModel): void;
}>();

const searchText = ref('');
const activeCategory = ref('all');
const modalVisible = ref(false);
const currentModel = ref<ProviderModel | null>(null);
const { saveProviderModels } = useProviders();

const categoryOptions = computed(() => props.categories.map((category) => ({ label: category.label, value: category.key })));

const filteredModels = computed(() => {
  let result = props.models;

  if (activeCategory.value !== 'all') {
    result = result.filter((model) => model.type === activeCategory.value);
  }

  if (searchText.value) {
    const search = searchText.value.toLowerCase();
    result = result.filter((model) => model.name.toLowerCase().includes(search) || model.id.toLowerCase().includes(search));
  }

  return result;
});

function handleCreateModel(): void {
  currentModel.value = null;
  modalVisible.value = true;
}

function handleEditModel(model: ProviderModel): void {
  currentModel.value = model;

  modalVisible.value = true;
}

function handleModelSuccess(): void {
  emit('refresh');
}

async function handleToggleModel(modelId: string, enabled: boolean): Promise<void> {
  const nextModels = props.models.map((item: ProviderModel) => (item.id === modelId ? { ...item, isEnabled: enabled } : item));
  const savedProvider = await saveProviderModels(props.providerId, nextModels);

  if (!savedProvider) {
    message.error(enabled ? '启用模型失败' : '禁用模型失败');

    return;
  }

  message.success(enabled ? '已启用模型' : '已禁用模型');
  emit('refresh');
}

async function handleDeleteModel(modelId: string): Promise<void> {
  const nextModels = props.models.filter((item: ProviderModel) => item.id !== modelId);
  const savedProvider = await saveProviderModels(props.providerId, nextModels);

  if (!savedProvider) {
    message.error('删除模型失败');
    return;
  }

  message.success('已删除模型');
  emit('refresh');
}
</script>

<style scoped lang="less">
.model-section {
  padding: 20px;
  background: var(--bg-secondary);
  border-radius: 10px;
}

.section-header {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
}

.section-title {
  margin: 0;
  font-size: 16px;
  font-weight: 500;
  color: var(--text-primary);
}

.section-actions {
  display: flex;
  gap: 12px;
  align-items: center;
}

.search-input {
  width: 200px;
}

.model-categories {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 16px 0;
}

.category-btn {
  flex-shrink: 0;
}

.model-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 12px;
  margin-top: 16px;
}

.model-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  transition: all 0.15s;

  &:hover {
    background: var(--bg-active);

    .model-actions .b-button {
      opacity: 1;
    }
  }

  .model-image {
    width: 40px;
    height: 40px;
    margin-right: 12px;
    overflow: hidden;
    border-radius: 6px;

    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  }

  .model-actions {
    display: flex;
    gap: 8px;
    align-items: center;

    .b-button {
      opacity: 0;
      transition: opacity 0.15s;
    }
  }
}

.model-info {
  flex: 1;
  min-width: 0;
}

.model-name {
  margin: 0 0 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
}

.model-id {
  display: inline-block;
  max-width: fit-content;
  padding: 2px 6px;
  margin: 0 0 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: 'SF Mono', Monaco, Inconsolata, 'Fira Code', monospace;
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
  background: var(--bg-secondary);
  border-radius: 4px;
}

.model-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.model-tag {
  padding: 2px 6px;
  font-size: 10px;
  color: var(--text-secondary);
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 4px;
}

.empty-models {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: var(--text-tertiary);
}

.empty-icon {
  margin-bottom: 8px;
  font-size: 32px;
  opacity: 0.5;
}
</style>
